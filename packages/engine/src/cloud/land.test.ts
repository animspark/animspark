import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readAssetIndex } from '@animspark/film-build';

import { checkRelativePath, landResult, readWorkspaceInput, safeDestination } from './land';
import { wav } from './testing/mock-api';

function workspace(): { ws: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), 'anim-land-'));
  const ws = join(root, 'code');
  mkdirSync(join(ws, 'assets'), { recursive: true });
  writeFileSync(join(ws, 'film.json'), JSON.stringify({ stage: { w: 320, h: 180 }, tracks: [] }));
  const outside = join(root, 'outside');
  mkdirSync(outside);
  return { ws, outside };
}

const file = (path: string, bytes: Buffer = Buffer.from('x')) => ({ path, bytes });

test('lexical path rules', () => {
  assert.equal(checkRelativePath('assets/audio/vo/a.mp3'), 'assets/audio/vo/a.mp3');
  for (const bad of ['/etc/passwd', 'C:/x', 'assets/../film.json', '../assets/x', 'assets//x', 'assets/./x',
    'assets\\x', 'film.json', 'mg/scene.tsx', 'assets/.hidden', '', 'assets/a\0b']) {
    assert.throws(() => checkRelativePath(bad), /Refusing/, bad);
  }
});

test('writes files under assets/ and indexes them (server rows merged, bytes filled in)', async () => {
  const { ws } = workspace();
  const audio = wav(0.5);
  const landed = await landResult(ws, {
    files: [file('assets/audio/vo/hi.wav', audio)],
    index: [{ src: 'assets/audio/vo/hi.wav', kind: 'audio', dur: 0.5, text: 'hi', words: [{ token: 'hi', start: 0.05, end: 0.3 }] }],
  });
  assert.deepEqual(landed.written, [{ path: 'assets/audio/vo/hi.wav', bytes: audio.length }]);
  assert.equal(landed.indexError, undefined);
  assert.deepEqual(readFileSync(join(ws, 'assets/audio/vo/hi.wav')), audio);
  const entry = readAssetIndex(ws)['assets/audio/vo/hi.wav'];
  assert.equal(entry?.bytes, audio.length);
  assert.equal(entry?.text, 'hi');
  assert.ok(entry?.contentHash, 'reconciliation stamped the new file');
  assert.match(readFileSync(join(ws, 'assets/index.jsonl'), 'utf8'), /hi\.wav/);
});

test('one bad path means nothing is written', async () => {
  const { ws } = workspace();
  await assert.rejects(landResult(ws, { files: [file('assets/ok.txt'), file('../escape.txt')] }), /Refusing/);
  assert.equal(existsSync(join(ws, 'assets/ok.txt')), false);
  await assert.rejects(landResult(ws, { files: [file('assets/a.txt'), file('assets/a.txt')] }), /twice/);
});

test('a symlinked directory cannot carry a write out of the workspace', async () => {
  const { ws, outside } = workspace();
  symlinkSync(outside, join(ws, 'assets', 'audio'));
  await assert.rejects(landResult(ws, { files: [file('assets/audio/vo/x.mp3')] }), /symbolic link/);
  assert.equal(existsSync(join(outside, 'vo')), false);
});

test('a symlinked file is not written through', async () => {
  const { ws, outside } = workspace();
  const target = join(outside, 'victim.txt');
  writeFileSync(target, 'keep');
  mkdirSync(join(ws, 'assets', 'image'), { recursive: true });
  symlinkSync(target, join(ws, 'assets', 'image', 'hero.png'));
  await assert.rejects(landResult(ws, { files: [file('assets/image/hero.png', Buffer.from('evil'))] }), /symbolic link/);
  assert.equal(readFileSync(target, 'utf8'), 'keep');
});

test('an existing directory at the destination is refused', () => {
  const { ws } = workspace();
  mkdirSync(join(ws, 'assets', 'image', 'hero.png'), { recursive: true });
  assert.throws(() => safeDestination(ws, 'assets/image/hero.png'), /not a regular file/);
});

test('inputs to upload are read only from inside the workspace', () => {
  const { ws, outside } = workspace();
  writeFileSync(join(outside, 'secret.m4a'), 'secret');
  symlinkSync(join(outside, 'secret.m4a'), join(ws, 'assets', 'link.m4a'));
  assert.throws(() => readWorkspaceInput(ws, 'assets/link.m4a', 1e6), /symbolic link/);
  assert.throws(() => readWorkspaceInput(ws, '../outside/secret.m4a', 1e6), /Refusing/);
  writeFileSync(join(ws, 'assets', 'talk.m4a'), 'audio');
  assert.equal(readWorkspaceInput(ws, 'assets/talk.m4a', 1e6).toString(), 'audio');
  assert.throws(() => readWorkspaceInput(ws, 'assets/talk.m4a', 2), /limit/);
});

test('index rows may only describe files that exist (or voice cards)', async () => {
  const { ws } = workspace();
  await landResult(ws, {
    files: [file('assets/a.txt')],
    index: [{ src: 'assets/a.txt', kind: 'file' }, { src: 'assets/ghost.mp3', kind: 'audio', dur: 3 }, { src: 'mg/fake.tsx', kind: 'mg' }],
  });
  const index = readAssetIndex(ws);
  assert.ok(index['assets/a.txt']);
  assert.equal(index['assets/ghost.mp3'], undefined);
  assert.equal(index['mg/fake.tsx'], undefined);
});
