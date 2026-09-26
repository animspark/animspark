import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_API_URL, checkApiUrl, credentialsPath, deleteCredentials, maskKey, resolveCredentials, saveCredentials,
} from './credentials';

const home = (): string => mkdtempSync(join(tmpdir(), 'anim-cred-'));

test('credentials path follows XDG_CONFIG_HOME, else ~/.config', () => {
  assert.equal(credentialsPath({ XDG_CONFIG_HOME: '/x/cfg', HOME: '/h' }), '/x/cfg/animspark/credentials.json');
  assert.equal(credentialsPath({ HOME: '/h' }), '/h/.config/animspark/credentials.json');
});

test('not logged in → null', () => {
  assert.equal(resolveCredentials({ XDG_CONFIG_HOME: home() }), null);
});

test('saved file is used, written 0600 in a 0700 directory, and deleted by logout', () => {
  const env = { XDG_CONFIG_HOME: home() };
  const path = saveCredentials({ apiKey: 'sk_file_123456' }, env);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(env.XDG_CONFIG_HOME, 'animspark')).mode & 0o777, 0o700);
  const c = resolveCredentials(env);
  assert.deepEqual(c, { apiKey: 'sk_file_123456', apiUrl: DEFAULT_API_URL, source: 'file', path });
  assert.equal(deleteCredentials(env), true);
  assert.equal(resolveCredentials(env), null);
  assert.equal(deleteCredentials(env), false);
});

test('ANIMSPARK_API_KEY wins over the file; ANIMSPARK_API_URL wins over the stored URL', () => {
  const env: Record<string, string> = { XDG_CONFIG_HOME: home() };
  saveCredentials({ apiKey: 'from-file', apiUrl: 'https://staging.example.com/v1' }, env);
  assert.equal(resolveCredentials(env)?.apiUrl, 'https://staging.example.com/v1');
  env.ANIMSPARK_API_KEY = 'from-env';
  const c = resolveCredentials(env)!;
  assert.equal(c.apiKey, 'from-env');
  assert.equal(c.source, 'env');
  assert.equal(c.apiUrl, 'https://staging.example.com/v1');
  env.ANIMSPARK_API_URL = 'http://127.0.0.1:9/v1/';
  assert.equal(resolveCredentials(env)?.apiUrl, 'http://127.0.0.1:9/v1');
});

test('an env key still works when the credentials file is broken; without it the error is readable', () => {
  const dir = home();
  const env: Record<string, string> = { XDG_CONFIG_HOME: dir };
  mkdirSync(join(dir, 'animspark'), { recursive: true });
  writeFileSync(join(dir, 'animspark', 'credentials.json'), '{nope', { mode: 0o600 });
  assert.throws(() => resolveCredentials(env), /not valid JSON/);
  env.ANIMSPARK_API_KEY = 'k';
  assert.equal(resolveCredentials(env)?.apiKey, 'k');
});

test('the key is only sent over https, or http to loopback', () => {
  assert.equal(checkApiUrl('https://api.animspark.com/v1/'), 'https://api.animspark.com/v1');
  assert.equal(checkApiUrl('http://localhost:8080/v1'), 'http://localhost:8080/v1');
  assert.throws(() => checkApiUrl('http://api.animspark.com/v1'), /https/);
  assert.throws(() => checkApiUrl('https://user:pw@example.com'), /credentials/);
  assert.throws(() => checkApiUrl('not a url'), /not a URL/);
  assert.throws(() => resolveCredentials({ ANIMSPARK_API_KEY: 'k', ANIMSPARK_API_URL: 'http://evil.example/v1', XDG_CONFIG_HOME: home() }), /Refusing/);
});

test('maskKey never shows the whole key', () => {
  assert.equal(maskKey('key_example_abcdefghijkl'), 'key_ex…ijkl');
  assert.equal(maskKey('short'), '••••');
});
