/**
 * Where the AnimSpark Cloud API key comes from.
 *
 *   1. `ANIMSPARK_API_KEY` in the environment (CI, containers, one-off runs), else
 *   2. the credentials file written by `anim login`:
 *        $XDG_CONFIG_HOME/animspark/credentials.json   (default ~/.config/animspark/credentials.json)
 *      shaped `{ "apiKey": "…", "apiUrl"?: "…" }`, mode 0600.
 *
 * The API base URL is `ANIMSPARK_API_URL`, else the file's `apiUrl`, else the public API.
 * The key is only ever sent to that base URL, and only over https (plain http is allowed
 * for loopback addresses so a local mock server can be used in tests).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_API_URL = 'https://api.animspark.com/v1';
export const KEYS_PAGE = 'https://animspark.com';

type Env = Record<string, string | undefined>;

export interface StoredCredentials {
  apiKey: string;
  apiUrl?: string;
}

export interface ResolvedCredentials {
  apiKey: string;
  apiUrl: string;
  source: 'env' | 'file';
  /** The credentials file, when that is where the key came from. */
  path?: string;
}

export function credentialsPath(env: Env = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || homedir(), '.config');
  return join(base, 'animspark', 'credentials.json');
}

export function readCredentialsFile(env: Env = process.env): StoredCredentials | null {
  const path = credentialsPath(env);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch {
    throw new Error(`${path} is not valid JSON. Run \`anim login\` again or delete the file.`);
  }
  const { apiKey, apiUrl } = (parsed ?? {}) as { apiKey?: unknown; apiUrl?: unknown };
  if (typeof apiKey !== 'string' || !apiKey.trim()) return null;
  if (process.platform !== 'win32') {
    try {
      if (statSync(path).mode & 0o077) process.stderr.write(`[anim] warning: ${path} is readable by other users; run chmod 600 on it.\n`);
    } catch { /* stat raced a delete — the read above already succeeded */ }
  }
  return { apiKey: apiKey.trim(), ...(typeof apiUrl === 'string' && apiUrl.trim() ? { apiUrl: apiUrl.trim() } : {}) };
}

/** Throws when the URL would leak the key: anything but https, except http on loopback. */
export function checkApiUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`API URL ${JSON.stringify(raw)} is not a URL.`); }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`Refusing to send the API key to ${url.origin}: use https (plain http only for localhost).`);
  }
  if (url.username || url.password) throw new Error('The API URL must not contain credentials.');
  return url.href.replace(/\/+$/, '');
}

export function apiUrlFrom(env: Env = process.env, stored?: StoredCredentials | null): string {
  return checkApiUrl(env.ANIMSPARK_API_URL?.trim() || stored?.apiUrl || DEFAULT_API_URL);
}

/** The key to use right now, or null when the user is not logged in. */
export function resolveCredentials(env: Env = process.env): ResolvedCredentials | null {
  const fromEnv = env.ANIMSPARK_API_KEY?.trim();
  if (fromEnv) {
    let stored: StoredCredentials | null = null;
    try { stored = readCredentialsFile(env); } catch { /* the env key wins; a broken file is irrelevant */ }
    return { apiKey: fromEnv, apiUrl: apiUrlFrom(env, stored), source: 'env' };
  }
  const stored = readCredentialsFile(env);
  if (!stored) return null;
  return { apiKey: stored.apiKey, apiUrl: apiUrlFrom(env, stored), source: 'file', path: credentialsPath(env) };
}

/** Write the credentials file atomically, 0600 in a 0700 directory. Returns its path. */
export function saveCredentials(creds: StoredCredentials, env: Env = process.env): string {
  const path = credentialsPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== 'win32') chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
  return path;
}

/** Remove the credentials file. Returns whether there was one. */
export function deleteCredentials(env: Env = process.env): boolean {
  const path = credentialsPath(env);
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

/** `sk_live_abcd…wxyz` — enough to recognise a key, not enough to use it. */
export function maskKey(key: string): string {
  return key.length <= 10 ? '••••' : `${key.slice(0, 6)}…${key.slice(-4)}`;
}
