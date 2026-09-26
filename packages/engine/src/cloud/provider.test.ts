import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { readAssetIndex } from '@animspark/film-build';

import type { CloudCommandName } from './commands';
import { availableCommands, chooseProvider, loadProviders, type MediaProvider } from './provider';
import { runCloudCommand } from './run';
import { wav } from './testing/mock-api';

const fake = (id: string, commands: CloudCommandName[], ready = true): MediaProvider => ({
  id, label: id, setup: `set ${id.toUpperCase()}_KEY`, configured: () => ready,
  supports: (c) => commands.includes(c), run: async () => ({ files: [] }),
});

const cloudIn = fake('animspark', ['audio tts', 'image gen', 'audio sfx']);
const cloudOut = fake('animspark', ['audio tts', 'image gen', 'audio sfx'], false);
const openai = fake('openai', ['audio tts']);
const eleven = fake('elevenlabs', ['audio tts', 'audio sfx']);

test('default is AnimSpark Cloud when logged in', () => {
  assert.equal(chooseProvider([cloudIn, openai], 'audio tts', undefined, {}).provider.id, 'animspark');
});

test('--provider beats ANIMSPARK_PROVIDER_<COMMAND>, which beats ANIMSPARK_PROVIDER, which beats the default', () => {
  const all = [cloudIn, openai, eleven];
  const env = { ANIMSPARK_PROVIDER_AUDIO_TTS: 'openai', ANIMSPARK_PROVIDER: 'elevenlabs' };
  assert.deepEqual(chooseProvider(all, 'audio tts', 'animspark', env), { provider: cloudIn, why: 'flag' });
  assert.deepEqual(chooseProvider(all, 'audio tts', undefined, env), { provider: openai, why: 'env-command' });
  assert.deepEqual(chooseProvider(all, 'audio sfx', undefined, env), { provider: eleven, why: 'env' });
  /* The global preference only covers what that provider can do. */
  assert.deepEqual(chooseProvider(all, 'image gen', undefined, env), { provider: cloudIn, why: 'default' });
});

test('a bring-your-own-key provider is never picked implicitly', () => {
  assert.throws(() => chooseProvider([cloudOut, openai], 'audio tts', undefined, {}),
    (e: Error) => /anim login/.test(e.message) && /--provider openai/.test(e.message) && /ANIMSPARK_PROVIDER_AUDIO_TTS=openai/.test(e.message));
});

test('not logged in and nothing else: the message points at login, own files and local music', () => {
  assert.throws(() => chooseProvider([cloudOut], 'audio music', undefined, {}),
    (e: Error) => /anim login/.test(e.message) && /assets\//.test(e.message) && /muspark/.test(e.message));
});

test('explicit choices are checked: unknown, unsupported, not set up', () => {
  assert.throws(() => chooseProvider([cloudIn, openai], 'audio tts', 'nope', {}), /does not exist.*animspark, openai/s);
  assert.throws(() => chooseProvider([cloudIn, openai], 'image gen', 'openai', {}), /cannot run anim image gen.*animspark/s);
  assert.throws(() => chooseProvider([cloudIn, fake('openai', ['audio tts'], false)], 'audio tts', 'openai', {}), /not set up: set OPENAI_KEY/);
  assert.throws(() => chooseProvider([cloudIn], 'audio tts', undefined, { ANIMSPARK_PROVIDER_AUDIO_TTS: 'ghost' }), /ANIMSPARK_PROVIDER_AUDIO_TTS names provider "ghost"/);
});

test('availableCommands lists commands with any configured provider', () => {
  assert.deepEqual(availableCommands([cloudOut, openai], {}), ['audio tts']);
});

test('ANIMSPARK_PROVIDER_MODULES loads a provider from a file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anim-prov-'));
  const path = join(dir, 'mine.mjs');
  writeFileSync(path, "export default { id: 'mine', label: 'Mine', setup: 'nothing', configured: () => true, supports: (c) => c === 'image gen', run: async () => ({ files: [] }) };\n");
  const providers = await loadProviders({ ANIMSPARK_PROVIDER_MODULES: path });
  assert.ok(providers.some((p) => p.id === 'mine'));
  assert.ok(providers.some((p) => p.id === 'openai') && providers.some((p) => p.id === 'elevenlabs') && providers.some((p) => p.id === 'animspark'));
});

/* ── reference adapters against a local stand-in for the vendor API ──────── */

interface Seen { method: string; url: string; headers: IncomingMessage['headers']; body: unknown }
const seen: Seen[] = [];
const vendor = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: text ? JSON.parse(text) : undefined });
  if (req.url?.startsWith('/v2/voices')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ voices: [
      { voice_id: 'm1', name: 'Max', labels: { gender: 'male', language: 'en' } },
      { voice_id: 'f1', name: 'Fay', description: 'Warm', labels: { gender: 'female', language: 'en' } },
    ] }));
    return;
  }
  if (req.url?.includes('bad-voice')) { res.writeHead(422, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail: { message: 'voice not found' } })); return; }
  res.writeHead(200, { 'content-type': 'audio/mpeg' });
  res.end(wav(0.4));
});
await new Promise<void>((r) => vendor.listen(0, '127.0.0.1', r));
const vendorUrl = `http://127.0.0.1:${(vendor.address() as { port: number }).port}`;
after(() => new Promise<void>((r) => { vendor.closeAllConnections(); vendor.close(() => r()); }));

function workspace(): string {
  const ws = join(mkdtempSync(join(tmpdir(), 'anim-byo-')), 'code');
  mkdirSync(join(ws, 'assets'), { recursive: true });
  writeFileSync(join(ws, 'film.json'), JSON.stringify({ stage: { w: 320, h: 180 }, tracks: [] }));
  return ws;
}
const byoEnv = { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'anim-x-')), OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${vendorUrl}/v1`, ELEVENLABS_API_KEY: 'xi-test', ELEVENLABS_BASE_URL: vendorUrl };

test('openai adapter: POST /v1/audio/speech with bearer key; file lands in assets/audio/vo and is indexed', async () => {
  const ws = workspace();
  seen.length = 0;
  const out = await runCloudCommand({ command: 'audio tts', args: { text: 'Hello there', out: 'intro' }, provider: 'openai', workspace: ws, env: byoEnv });
  const req = seen[0]!;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/v1/audio/speech');
  assert.equal(req.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(req.body, { model: 'gpt-4o-mini-tts', input: 'Hello there', voice: 'alloy', response_format: 'mp3' });
  assert.equal(out.json.provider, 'openai');
  assert.equal(readFileSync(join(ws, 'assets/audio/vo/intro.mp3')).length, wav(0.4).length);
  const entry = readAssetIndex(ws)['assets/audio/vo/intro.mp3'];
  assert.equal(entry?.text, 'Hello there');
  assert.ok(entry?.contentHash);
  assert.match(String(out.json.note), /No word timings/);
});

test('elevenlabs adapter: tts, sfx and voice search requests follow the documented shapes', async () => {
  const ws = workspace();
  seen.length = 0;
  await runCloudCommand({ command: 'audio tts', args: { text: 'Hi', voice: 'f1', out: 'hi' }, provider: 'elevenlabs', workspace: ws, env: byoEnv });
  await runCloudCommand({ command: 'audio sfx', args: { prompt: 'glass chime', sec: 1, out: 'ding' }, provider: 'elevenlabs', workspace: ws, env: byoEnv });
  const voices = await runCloudCommand({ command: 'audio voice', args: { gender: 'f', prompt: 'warm' }, provider: 'elevenlabs', workspace: ws, env: byoEnv });
  assert.equal(seen[0]!.url, '/v1/text-to-speech/f1?output_format=mp3_44100_128');
  assert.equal(seen[0]!.headers['xi-api-key'], 'xi-test');
  assert.deepEqual(seen[0]!.body, { text: 'Hi', model_id: 'eleven_multilingual_v2' });
  assert.equal(seen[1]!.url, '/v1/sound-generation?output_format=mp3_44100_128');
  assert.deepEqual(seen[1]!.body, { text: 'glass chime', model_id: 'eleven_text_to_sound_v2', duration_seconds: 1 });
  assert.match(seen[2]!.url, /^\/v2\/voices\?page_size=15&search=warm$/);
  assert.deepEqual(voices.json.results, [{ voiceId: 'f1', name: 'Fay', language: 'en', gender: 'f', description: 'Warm' }]);
  assert.ok(readAssetIndex(ws)['assets/audio/sfx/ding.mp3']);
});

test('vendor errors come back as readable CLI errors, and nothing is written', async () => {
  const ws = workspace();
  await assert.rejects(runCloudCommand({ command: 'audio tts', args: { text: 'Hi', voice: 'bad-voice' }, provider: 'elevenlabs', workspace: ws, env: byoEnv }),
    /ElevenLabs \(your key\) failed: ElevenLabs speech failed \(HTTP 422\): voice not found/);
  assert.deepEqual(Object.keys(readAssetIndex(ws)), []);
});
