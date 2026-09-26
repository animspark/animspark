/**
 * AnimSpark Cloud — the default media provider, reached through the public API:
 *
 *   GET  /v1/anim/session?tier=   balance, spend cap, tier and the price card (as the server words it)
 *   POST /v1/anim/quote           the most one command can cost; runs nothing
 *   POST /v1/anim/run             runs one command; `Idempotency-Key` required
 *
 * Authentication is a developer API key with the `videos:write` scope (`anim login`).
 * Pricing and billing live entirely on the server: this client never computes a price, it
 * only shows what the server returns.
 *
 * Retries: network errors, timeouts, 5xx, 429 and 409 are retried with the **same**
 * Idempotency-Key, so the server charges a call at most once however often it is retried.
 */
import { FilmCliError } from '@animspark/film-build';

import { KEYS_PAGE, resolveCredentials, type ResolvedCredentials } from './credentials';
import { CLOUD_COMMAND_NAMES, type CloudCommandName } from './commands';
import type { MediaContext, MediaProvider, MediaQuote, MediaRequest, MediaResult } from './provider';

type Env = Record<string, string | undefined>;

export interface CloudSession {
  balance: number;
  budget: { spent: number; cap: number | null } | null;
  tier?: string;
  tiers?: Array<{ tier: string; allowed: boolean }>;
  plan?: string;
  prices?: Array<{ command: string; price: string }>;
}

export interface CloudRunResponse {
  call_id: string;
  command: string;
  receipt: unknown;
  files: Array<{ path: string; base64: string; bytes?: number }>;
  index?: Array<Record<string, unknown>>;
  credits?: { quoted: number; charged: number; metered: number; refunded: number; cost: number };
  budget?: unknown;
  balance?: number | null;
  idempotent_replay?: boolean;
  files_unavailable?: true;
}

export class CloudApiError extends FilmCliError {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export interface CloudCallOptions {
  creds: ResolvedCredentials;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  /** Retries after the first attempt. */
  retries?: number;
  /** Base backoff in ms (tests set it to ~0). */
  backoffMs?: number;
}

const RETRYABLE = (status: number): boolean => status >= 500 || status === 429 || status === 409;
const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((done, fail) => {
  const t = setTimeout(done, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); fail(signal.reason); }, { once: true });
});

type ErrorBody = { error?: string; message?: string; spent?: number; cap?: number | null; needed?: number; balance?: number; refunded?: number };

function explain(status: number, body: ErrorBody | null, creds: ResolvedCredentials): CloudApiError {
  const said = body?.message ?? body?.error;
  const where = creds.source === 'env' ? 'ANIMSPARK_API_KEY' : 'the key saved by anim login';
  if (status === 401) {
    return new CloudApiError(`AnimSpark Cloud did not accept ${where} (HTTP 401). Create an API key with the videos:write scope at ${KEYS_PAGE}, then run \`anim login\`.`, status, 'unauthorized');
  }
  if (status === 402 && body?.error === 'cap_reached') {
    return new CloudApiError(`This key's spend cap is used up (${body.spent ?? '?'} of ${body.cap ?? '∞'} credits; this call needs up to ${body.needed ?? '?'}). Raise the cap for this key at ${KEYS_PAGE} or use another key.`, status, 'cap_reached');
  }
  if (status === 402) {
    return new CloudApiError(`Not enough AnimSpark credits${body?.balance !== undefined ? `: balance ${body.balance}` : ''}${body?.needed !== undefined ? `, this call needs up to ${body.needed}` : ''}. Top up at ${KEYS_PAGE}; \`anim credits\` shows your balance.`, status, body?.error ?? 'insufficient_credits');
  }
  if (status === 403 && body?.error === 'tier_not_allowed') {
    return new CloudApiError(`${said ?? 'This tier is not available on your plan.'} Try --tier flash, or see \`anim credits\` for the tiers your plan allows.`, status, 'tier_not_allowed');
  }
  if (status === 403) return new CloudApiError(`AnimSpark Cloud refused: ${said ?? 'forbidden'} (HTTP 403).`, status, body?.error);
  if (status === 400) return new CloudApiError(`AnimSpark Cloud rejected the request: ${said ?? 'bad request'}`, status, body?.error);
  return new CloudApiError(`AnimSpark Cloud answered HTTP ${status}${said ? `: ${said}` : ''}${body?.refunded ? ` (${body.refunded} credits refunded)` : ''}.`, status, body?.error);
}

/** One API call with timeouts, retries (same Idempotency-Key) and readable errors. */
export async function cloudCall<T>(method: 'GET' | 'POST', path: string, opts: CloudCallOptions): Promise<T> {
  const url = `${opts.creds.apiUrl}${path}`;
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 1000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    opts.signal?.throwIfAborted();
    if (attempt > 0) await sleep(backoff * 3 ** (attempt - 1), opts.signal);
    let res: Response;
    try {
      res = await (opts.fetch ?? fetch)(url, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${opts.creds.apiKey}`,
          'user-agent': 'anim-cli (animspark open-source engine)',
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 30_000), ...(opts.signal ? [opts.signal] : [])]),
      });
    } catch (error) {
      if (opts.signal?.aborted) throw error;
      lastError = error;
      continue; // network error or our own timeout: the same key makes a retry safe
    }
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON — handled below */ }
    if (res.ok) {
      if (json === null || typeof json !== 'object') throw new CloudApiError(`AnimSpark Cloud returned a response that is not JSON (HTTP ${res.status}).`, res.status);
      return json as T;
    }
    if (RETRYABLE(res.status) && attempt < retries) {
      lastError = explain(res.status, json as ErrorBody | null, opts.creds);
      const after = Number(res.headers.get('retry-after'));
      if (res.status === 429 && Number.isFinite(after) && after > 0) await sleep(Math.min(after, 30) * 1000, opts.signal);
      continue;
    }
    throw explain(res.status, json as ErrorBody | null, opts.creds);
  }
  if (lastError instanceof CloudApiError) throw lastError;
  const why = lastError instanceof Error ? (lastError.name === 'TimeoutError' ? 'timed out' : lastError.message) : String(lastError);
  throw new CloudApiError(`Could not reach AnimSpark Cloud at ${opts.creds.apiUrl} (${why}) after ${retries + 1} attempts.`, 0, 'network');
}

export function requireCredentials(env: Env = process.env): ResolvedCredentials {
  const creds = resolveCredentials(env);
  if (!creds) throw new FilmCliError(`Not logged in to AnimSpark Cloud. Run \`anim login\` (API keys at ${KEYS_PAGE}) or set ANIMSPARK_API_KEY.`);
  return creds;
}

export const tierOf = (tier: string | undefined, env: Env = process.env): string | undefined => tier ?? (env.ANIMSPARK_TIER?.trim() || undefined);

export function getSession(creds: ResolvedCredentials, opts: { tier?: string; fetch?: typeof fetch; signal?: AbortSignal; backoffMs?: number } = {}): Promise<CloudSession> {
  return cloudCall<CloudSession>('GET', `/anim/session${opts.tier ? `?tier=${encodeURIComponent(opts.tier)}` : ''}`, {
    creds, timeoutMs: 15_000, retries: 2, ...opts,
  });
}

function wireBody(req: MediaRequest, env: Env) {
  const tier = tierOf(req.tier, env);
  return {
    command: req.command,
    args: req.args,
    ...(req.inputs?.length ? { inputs: req.inputs.map((f) => ({ path: f.path, base64: f.bytes.toString('base64') })) } : {}),
    ...(req.context && Object.keys(req.context).length ? { context: req.context } : {}),
    ...(tier ? { tier } : {}),
  };
}

const RUN_TIMEOUT_MS = 360_000;
/** ANIMSPARK_RETRY_BACKOFF_MS: base delay between retries (1 s, then ×3). Tests set it low. */
const backoffFrom = (env: Env | undefined): number | undefined => {
  const n = Number((env ?? process.env).ANIMSPARK_RETRY_BACKOFF_MS);
  return Number.isFinite(n) && n >= 0 && (env ?? process.env).ANIMSPARK_RETRY_BACKOFF_MS !== undefined ? n : undefined;
};

export const animsparkCloud: MediaProvider = {
  id: 'animspark',
  label: 'AnimSpark Cloud',
  setup: 'run `anim login`',
  configured: (env) => {
    try { return resolveCredentials(env) !== null; } catch { return false; }
  },
  supports: (command: CloudCommandName) => (CLOUD_COMMAND_NAMES as readonly string[]).includes(command),

  async quote(req: MediaRequest, ctx: MediaContext): Promise<MediaQuote> {
    const creds = requireCredentials(ctx.env);
    const { inputs: _inputs, ...rest } = wireBody(req, ctx.env ?? process.env);
    const res = await cloudCall<{ quote: unknown; budget?: unknown; tier?: string }>('POST', '/anim/quote', {
      creds, body: rest, timeoutMs: 15_000, retries: 2, signal: ctx.signal, fetch: ctx.fetch,
    });
    return { quote: { ...res.quote as object, ...(res.tier ? { tier: res.tier } : {}), ...(res.budget ? { budget: res.budget } : {}) } };
  },

  async run(req: MediaRequest, ctx: MediaContext): Promise<MediaResult> {
    const creds = requireCredentials(ctx.env);
    const res = await cloudCall<CloudRunResponse>('POST', '/anim/run', {
      creds,
      body: wireBody(req, ctx.env ?? process.env),
      idempotencyKey: ctx.idempotencyKey,
      timeoutMs: RUN_TIMEOUT_MS,
      backoffMs: backoffFrom(ctx.env),
      signal: ctx.signal,
      fetch: ctx.fetch,
    });
    if (!Array.isArray(res.files)) throw new CloudApiError('AnimSpark Cloud returned a run result without files.', 200);
    const files = res.files.map((f) => {
      if (typeof f?.path !== 'string' || typeof f.base64 !== 'string') throw new CloudApiError('AnimSpark Cloud returned a malformed file entry.', 200);
      const bytes = Buffer.from(f.base64, 'base64');
      if (typeof f.bytes === 'number' && f.bytes !== bytes.length) {
        throw new CloudApiError(`${f.path} arrived with ${bytes.length} bytes, the server said ${f.bytes}. Nothing was written; run the command again.`, 200);
      }
      return { path: f.path, bytes };
    });
    return {
      files,
      index: Array.isArray(res.index) ? res.index : [],
      receipt: res.receipt,
      ...(res.credits ? { credits: res.credits } : {}),
      ...(res.balance !== undefined ? { balance: res.balance } : {}),
      ...(res.budget ? { budget: res.budget } : {}),
      ...(res.files_unavailable ? { note: 'This call had already completed earlier, so the server did not send the files again. Run it with a new --out name if you need them.' } : {}),
    };
  },
};
