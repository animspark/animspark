import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { cloudCall, getSession } from './animspark';
import type { ResolvedCredentials } from './credentials';
import { runCloudCommand } from './run';
import { startMockApi } from './testing/mock-api';

const apis: Array<{ close(): Promise<void> }> = [];
after(async () => { await Promise.all(apis.map((a) => a.close())); });

async function api(opts: Parameters<typeof startMockApi>[0] = {}) {
  const a = await startMockApi(opts);
  apis.push(a);
  return a;
}

function workspace(): string {
  const ws = join(mkdtempSync(join(tmpdir(), 'anim-cloud-')), 'code');
  mkdirSync(join(ws, 'assets'), { recursive: true });
  writeFileSync(join(ws, 'film.json'), JSON.stringify({ stage: { w: 320, h: 180 }, tracks: [] }));
  return ws;
}

const creds = (url: string, apiKey = 'test'): ResolvedCredentials => ({ apiKey, apiUrl: url, source: 'env' });
const envFor = (url: string, key = 'test') => ({ ANIMSPARK_API_URL: url, ANIMSPARK_API_KEY: key, ANIMSPARK_RETRY_BACKOFF_MS: '1', XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'anim-x-')) });

test('run retries 5xx with the same Idempotency-Key and succeeds', async () => {
  const a = await api({ failRuns: 2 });
  const ws = workspace();
  const out = await runCloudCommand({
    command: 'audio tts', args: { text: 'hello world', voice: 'v1' }, workspace: ws, env: envFor(a.url),
  });
  const runs = a.calls.filter((c) => c.path === '/v1/anim/run');
  assert.equal(runs.length, 3);
  assert.ok(runs[0]!.idempotencyKey);
  assert.ok(runs.every((c) => c.idempotencyKey === runs[0]!.idempotencyKey), 'every attempt carries the same key');
  assert.equal((out.json.files as Array<{ path: string }>)[0]!.path, 'assets/audio/vo/hello-world.wav');
  assert.equal(runs[0]!.body!.args && (runs[0]!.body!.args as Record<string, unknown>).out, 'hello-world');
});

test('a dropped connection is retried with the same key; two invocations use two keys', async () => {
  const a = await api({ dropRuns: 1 });
  const ws = workspace();
  const env = envFor(a.url);
  await runCloudCommand({ command: 'audio sfx', args: { prompt: 'ding', out: 'ding' }, workspace: ws, env });
  await runCloudCommand({ command: 'audio sfx', args: { prompt: 'ding', out: 'ding2' }, workspace: ws, env });
  const keys = a.calls.filter((c) => c.path === '/v1/anim/run').map((c) => c.idempotencyKey);
  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test('a replayed key reports that the files were not sent again', async () => {
  const a = await api();
  const ws = workspace();
  const env = envFor(a.url);
  await runCloudCommand({ command: 'audio sfx', args: { prompt: 'ding', out: 'x' }, workspace: ws, env, idempotencyKey: 'fixed' });
  const again = await runCloudCommand({ command: 'audio sfx', args: { prompt: 'ding', out: 'x' }, workspace: ws, env, idempotencyKey: 'fixed' });
  assert.match(String(again.json.note), /already completed/);
});

test('4xx is not retried, and errors read like advice', async () => {
  const a = await api();
  const c = creds(a.url);
  await assert.rejects(cloudCall('POST', '/anim/run', { creds: c, body: {}, idempotencyKey: 'k', backoffMs: 1 }), /rejected the request: command is required/);
  assert.equal(a.calls.filter((x) => x.path === '/v1/anim/run').length, 1);
  await assert.rejects(getSession(creds(a.url, 'wrong'), { backoffMs: 1 }), /did not accept ANIMSPARK_API_KEY.*videos:write.*anim login/s);
  await assert.rejects(cloudCall('POST', '/anim/quote', { creds: c, body: { command: 'audio tts', tier: 'ultra' }, backoffMs: 1 }), /not on the mock plan.*--tier flash/s);
});

test('402 explains the balance or the cap', async () => {
  const fake = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status });
  const c = creds('http://127.0.0.1:1/v1');
  await assert.rejects(cloudCall('POST', '/anim/run', { creds: c, fetch: fake(402, { error: 'insufficient_credits', balance: 3, needed: 40 }), backoffMs: 1 }), /Not enough AnimSpark credits: balance 3, this call needs up to 40/);
  await assert.rejects(cloudCall('POST', '/anim/run', { creds: c, fetch: fake(402, { error: 'cap_reached', spent: 500, cap: 500, needed: 9 }), backoffMs: 1 }), /spend cap is used up \(500 of 500/);
});

test('network failure gives up after the retries with a clear message', async () => {
  let n = 0;
  const failing: typeof fetch = async () => { n += 1; throw new TypeError('fetch failed'); };
  await assert.rejects(cloudCall('GET', '/anim/session', { creds: creds('http://127.0.0.1:1/v1'), fetch: failing, retries: 2, backoffMs: 1 }), /Could not reach AnimSpark Cloud .* after 3 attempts/);
  assert.equal(n, 3);
});

test('audio asr uploads the source file; quote needs no workspace and sends no Idempotency-Key', async () => {
  const a = await api();
  const ws = workspace();
  writeFileSync(join(ws, 'assets', 'talk.m4a'), 'pretend audio');
  const env = envFor(a.url);
  await runCloudCommand({ command: 'audio asr', args: { src: 'assets/talk.m4a' }, workspace: ws, env });
  const run = a.calls.find((c) => c.path === '/v1/anim/run')!;
  assert.deepEqual(run.body!.inputs, [{ path: 'assets/talk.m4a', base64: Buffer.from('pretend audio').toString('base64') }]);
  const q = await runCloudCommand({ command: 'image gen', args: { prompt: 'a key' }, quote: true, env, tier: 'pro' });
  assert.equal(q.json.credits, 3);
  const quote = a.calls.find((c) => c.path === '/v1/anim/quote')!;
  assert.equal(quote.idempotencyKey, undefined);
  assert.equal(quote.body!.tier, 'pro');
});

test('files outside assets/ from the server are refused', async () => {
  const a = await api({ runFiles: () => [{ path: '../../.bashrc', base64: Buffer.from('x').toString('base64') }] });
  const ws = workspace();
  await assert.rejects(runCloudCommand({ command: 'audio sfx', args: { prompt: 'x' }, workspace: ws, env: envFor(a.url) }), /will not accept.*Refusing/s);
});
