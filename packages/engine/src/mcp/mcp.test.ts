/**
 * Round trip through the real `anim mcp` process: initialize, tools/list, tools/call check,
 * look (an image comes back), a cloud tool against the mock API, and the error path.
 * Needs Chromium (Playwright) like `anim look` itself.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startMockApi } from '../cloud/testing/mock-api';
import { createMcpServer } from './protocol';

const BIN = fileURLToPath(new URL('../../bin/anim.mjs', import.meta.url));

/* check and look drive Chromium; without it (a bare CI runner) those two calls are skipped. */
const { chromium } = await import('playwright');
const HAS_BROWSER = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();

const SCENE = `import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
gsap.registerPlugin(useGSAP);
export const durationSec = 2;
export default function Scene() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => { gsap.timeline().fromTo('.dot', { x: 0 }, { x: 100, duration: 2, ease: 'none' }, 0); }, { scope: ref });
  return <div ref={ref} style={{ position: 'absolute', inset: 0, background: '#123' }}><div className="dot" style={{ width: 40, height: 40, background: '#fc0' }} /></div>;
}
`;

let child: ChildProcessWithoutNullStreams;
let ws: string;
let api: Awaited<ReturnType<typeof startMockApi>>;
const waiting = new Map<number, (msg: Record<string, unknown>) => void>();
let nextId = 1;

function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
  });
}

before(async () => {
  api = await startMockApi();
  const root = mkdtempSync(join(tmpdir(), 'anim-mcp-'));
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'xdg'), ANIMSPARK_API_URL: api.url, ANIMSPARK_API_KEY: 'test', ANIMSPARK_RETRY_BACKOFF_MS: '1' };
  const made = spawnSync(process.execPath, [BIN, 'new', 'A two second test', '--dir', join(root, 'film'), '--sec', '2'], { env, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  ws = join(root, 'film', 'code');
  mkdirSync(join(ws, 'mg'), { recursive: true });
  writeFileSync(join(ws, 'mg', 'dot.tsx'), SCENE);
  writeFileSync(join(ws, 'film.json'), JSON.stringify({ stage: { w: 640, h: 360 }, tracks: [{ kind: 'mg', clips: [{ src: 'mg/dot', id: 'dot', at: 0 }] }] }));
  child = spawn(process.execPath, [BIN, 'mcp'], { cwd: ws, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line) as Record<string, unknown>;
    if (typeof msg.id === 'number') waiting.get(msg.id)?.(msg);
  });
});

after(async () => {
  child?.stdin.end();
  await new Promise((r) => child?.once('exit', r));
  await api?.close();
});

test('initialize → tools/list → check → look → audio_tts over stdio', { timeout: 180_000 }, async (t) => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const result = init.result as Record<string, unknown>;
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.equal((result.serverInfo as { name: string }).name, 'animspark');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const list = await rpc('tools/list');
  const tools = (list.result as { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }> }).tools;
  const names = tools.map((t) => t.name);
  for (const n of ['new', 'check', 'look', 'render', 'clip', 'preview_url', 'audio_tts', 'image_gen']) assert.ok(names.includes(n), n);
  const tts = tools.find((t) => t.name === 'audio_tts')!;
  assert.deepEqual(tts.inputSchema.required, ['text', 'voice']);
  assert.ok('workspace' in tts.inputSchema.properties && 'quote' in tts.inputSchema.properties);

  const spoken = await rpc('tools/call', { name: 'audio_tts', arguments: { text: 'hello there', voice: 'v-mock-1', out: 'hi' } });
  const sr = spoken.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(sr.isError, undefined, sr.content[0]?.text);
  assert.ok(existsSync(join(ws, 'assets/audio/vo/hi.wav')));
  assert.equal(JSON.parse(sr.content[0]!.text).balance, 4998);

  if (!HAS_BROWSER) { t.diagnostic('Chromium not installed: check/look over MCP skipped'); return; }
  const check = await rpc('tools/call', { name: 'check', arguments: {} });
  const cr = check.result as { content: Array<{ type: string; text: string }>; isError?: boolean; structuredContent?: { status: string } };
  assert.equal(cr.isError, undefined, cr.content[0]?.text);
  assert.equal(cr.structuredContent?.status, 'Pass');

  const look = await rpc('tools/call', { name: 'look', arguments: { at: 1, workspace: ws } });
  const lr = look.result as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
  assert.equal(lr.isError, undefined, lr.content[0]?.text);
  const image = lr.content.find((c) => c.type === 'image');
  assert.ok(image, 'look returns image content');
  assert.equal(image.mimeType, 'image/png');
  assert.equal(Buffer.from(image.data!, 'base64').subarray(1, 4).toString(), 'PNG');
  assert.equal(JSON.parse(lr.content[0]!.text!).mode, 'frame');
});

test('tool errors come back as isError results; unknown tools and methods as protocol errors', { timeout: 60_000 }, async () => {
  const bad = await rpc('tools/call', { name: 'clip', arguments: { clip_id: 'nope' } });
  assert.equal((bad.result as { isError?: boolean }).isError, true);
  const missing = await rpc('tools/call', { name: 'audio_tts', arguments: { text: 'hi' } });
  assert.match((missing.result as { content: Array<{ text: string }> }).content[0]!.text, /needs --voice/);
  const unknown = await rpc('tools/call', { name: 'nope', arguments: {} });
  assert.equal((unknown.error as { code: number }).code, -32602);
  const method = await rpc('resources/list');
  assert.equal((method.error as { code: number }).code, -32601);
  const ping = await rpc('ping');
  assert.deepEqual(ping.result, {});
});

test('new creates a workspace and becomes the default for later calls', { timeout: 60_000 }, async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'anim-mcp-new-')), 'second');
  const made = await rpc('tools/call', { name: 'new', arguments: { prompt: 'Another film', dir, sec: 3 } });
  const r = made.result as { structuredContent: { workspace: string }; isError?: boolean };
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.workspace, join(dir, 'code'));
  assert.ok(existsSync(join(dir, 'code', 'AGENTS.md')));
  /* The new film is empty, so check fails — on the new workspace, not the server's cwd. */
  const check = await rpc('tools/call', { name: 'check', arguments: {} });
  const cr = check.result as { content: Array<{ text: string }>; isError?: boolean };
  assert.equal(cr.isError, true);
  assert.match(cr.content[0]!.text, /"status": "Fail"/);
});

test('protocol: modern requests, version errors, cancellation, parse errors (in process)', async () => {
  const sent: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const server = createMcpServer({
    serverInfo: { name: 't', version: '0' },
    send: (line) => sent.push(JSON.parse(line)),
    tools: () => [{
      name: 'slow', description: 'waits', inputSchema: { type: 'object' },
      execute: (_args, ctx) => new Promise((resolve) => {
        release = () => resolve({ content: [{ type: 'text', text: 'done' }] });
        ctx.signal.addEventListener('abort', () => resolve({ content: [{ type: 'text', text: 'stopped' }], isError: true }));
      }),
    }],
  });
  await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }));
  assert.equal((sent[0]!.result as { resultType: string }).resultType, 'complete');
  await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1999-01-01' } } }));
  assert.equal((sent[1]!.error as { code: number }).code, -32022);
  await server.handleLine('{not json');
  assert.equal((sent[2]!.error as { code: number }).code, -32700);
  const pending = server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'slow', arguments: {} } }));
  await new Promise((r) => setImmediate(r));
  await server.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } }));
  await pending;
  assert.equal(sent.length, 3, 'a cancelled request gets no response');
  const finishing = server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'slow', arguments: {} } }));
  await new Promise((r) => setImmediate(r));
  release();
  await finishing;
  assert.deepEqual(sent[3], { jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: 'done' }] } });
});
