/**
 * A stand-in for the AnimSpark Cloud `/v1/anim/*` API, for tests and for trying the CLI
 * without an account. All numbers it returns are made up.
 *
 *   node --import tsx packages/engine/src/cloud/testing/mock-api.ts [port]
 *   ANIMSPARK_API_URL=http://127.0.0.1:<port>/v1 anim login --key test
 *
 * `audio tts` returns a short generated WAV with word timings; other commands return a
 * small placeholder file under their usual folder.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

export interface MockCall {
  method: string;
  path: string;
  idempotencyKey?: string;
  body?: Record<string, unknown>;
}

export interface MockApiOptions {
  key?: string;
  /** Answer the first N run attempts with 503 (to exercise retries). */
  failRuns?: number;
  /** Drop the connection on the first N run attempts. */
  dropRuns?: number;
  balance?: number;
  /** Override the files a run returns (e.g. to test path safety). */
  runFiles?: (body: Record<string, unknown>) => Array<{ path: string; base64: string; bytes?: number }>;
}

/** A mono 16-bit PCM WAV: a quiet tone, so ffprobe sees a real duration. */
export function wav(seconds: number, rate = 16000): Buffer {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 3000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const FOLDERS: Record<string, string> = {
  'audio sfx': 'assets/audio/sfx', 'audio music': 'assets/audio/music', 'image search': 'assets/image',
  'image gen': 'assets/image', 'font search': 'assets/fonts/mock',
};

function runResult(body: Record<string, unknown>): { receipt: unknown; files: Array<{ path: string; base64: string; bytes: number }>; index: Array<Record<string, unknown>> } {
  const command = String(body.command);
  const args = (body.args ?? {}) as Record<string, unknown>;
  if (command === 'audio tts') {
    const text = String(args.text ?? '');
    const words = text.split(/\s+/).filter(Boolean);
    const dur = Math.max(0.5, words.length * 0.4);
    const bytes = wav(dur);
    const src = `assets/audio/vo/${String(args.out)}.wav`;
    return {
      receipt: { src, dur, voiceId: args.voice, alignment: 'ready', transcript: `assets/transcripts/audio/vo/${String(args.out)}.wav.vtt` },
      files: [{ path: src, base64: bytes.toString('base64'), bytes: bytes.length }],
      index: [{ src, kind: 'audio', dur, text, voiceId: args.voice, words: words.map((token, i) => ({ token, start: i * 0.4 + 0.05, end: i * 0.4 + 0.35 })) }],
    };
  }
  if (command === 'audio voice') {
    return { receipt: [{ voiceId: 'v-mock-1', name: 'Mock Narrator', language: 'en', gender: 'f', description: 'A calm mock voice' }], files: [], index: [] };
  }
  const dir = FOLDERS[command] ?? 'assets/data';
  const ext = command.startsWith('audio') ? 'wav' : command.startsWith('image') ? 'png' : command === 'font search' ? 'css' : 'md';
  const bytes = ext === 'wav' ? wav(1) : Buffer.from(`mock ${command}\n`);
  const src = `${dir}/${String(args.out ?? 'mock')}.${ext}`;
  return { receipt: { src }, files: [{ path: src, base64: bytes.toString('base64'), bytes: bytes.length }], index: [] };
}

export async function startMockApi(opts: MockApiOptions = {}, port = 0): Promise<{ url: string; calls: MockCall[]; close(): Promise<void> }> {
  const key = opts.key ?? 'test';
  const calls: MockCall[] = [];
  const done = new Map<string, Record<string, unknown>>();
  let balance = opts.balance ?? 5000;
  let failRuns = opts.failRuns ?? 0;
  let dropRuns = opts.dropRuns ?? 0;

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown> | undefined> => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (!chunks.length) return undefined;
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const body = await readBody(req).catch(() => undefined);
    const idem = req.headers['idempotency-key'];
    calls.push({ method: req.method ?? '', path: url.pathname, ...(typeof idem === 'string' ? { idempotencyKey: idem } : {}), ...(body ? { body } : {}) });
    if (req.headers.authorization !== `Bearer ${key}`) return send(res, 401, { error: 'unauthorized', message: 'Invalid API key' });
    if (req.method === 'GET' && url.pathname === '/v1/anim/session') {
      const tier = url.searchParams.get('tier') ?? 'flash';
      return send(res, 200, {
        balance, budget: null, tier, plan: 'mock',
        tiers: [{ tier: 'flash', allowed: true }, { tier: 'pro', allowed: true }, { tier: 'ultra', allowed: false }],
        prices: [{ command: 'audio tts', price: '(mock) 1 credit per 10 characters' }, { command: 'image gen', price: '(mock) 20 credits' }],
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/anim/quote') {
      if (!body?.command) return send(res, 400, { error: 'bad_request', message: 'command is required' });
      if (body.tier === 'ultra') return send(res, 403, { error: 'tier_not_allowed', message: 'The ultra tier is not on the mock plan.' });
      return send(res, 200, { quote: { command: body.command, credits: 3, usd: 0.003, basis: 'mock', settles: true }, budget: null, tier: body.tier ?? 'flash' });
    }
    if (req.method === 'POST' && url.pathname === '/v1/anim/run') {
      if (typeof idem !== 'string' || !idem) return send(res, 400, { error: 'bad_request', message: 'Idempotency-Key header is required' });
      if (dropRuns > 0) { dropRuns -= 1; req.socket.destroy(); return; }
      if (failRuns > 0) { failRuns -= 1; return send(res, 503, { error: 'unavailable', message: 'mock outage' }); }
      if (!body?.command) return send(res, 400, { error: 'bad_request', message: 'command is required' });
      if (body.tier === 'ultra') return send(res, 403, { error: 'tier_not_allowed', message: 'The ultra tier is not on the mock plan.' });
      const earlier = done.get(idem);
      if (earlier) return send(res, 200, { ...earlier, files: [], idempotent_replay: true, files_unavailable: true });
      const made = runResult(body);
      const files = opts.runFiles ? opts.runFiles(body) : made.files;
      balance -= 2;
      const result = {
        call_id: `anim_mock_${done.size + 1}`, command: body.command, receipt: made.receipt, files, index: made.index,
        credits: { quoted: 3, charged: 3, metered: 2, refunded: 1, cost: 2 }, budget: null, balance, idempotent_replay: false,
      };
      done.set(idem, result);
      return send(res, 200, result);
    }
    return send(res, 404, { error: 'not_found', message: `${req.method} ${url.pathname}` });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    calls,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const api = await startMockApi({}, Number(process.argv[2] ?? 0));
  process.stdout.write(`mock AnimSpark API at ${api.url} (key: test)\n`);
}
