/**
 * Version of the shared vendor packages, used as a cache key in the URL so those bytes can be served
 * `immutable`.
 *
 * A separate file so the host page and the vendor route don't import each other (both need it).
 *
 * Uses the packages' own versions rather than a content hash: esbuild.wasm is 11.8 MB, not worth
 * hashing just to build a URL. These files only change together with a `pnpm install`, so a new
 * version means a new set.
 *
 * Deliberately leaves out host.js's hash: that follows this repository's code and changes daily.
 * Mixing it in would make the browser re-download the 11.8 MB wasm after a one-line host-script
 * change. host.js's own URL carries its own hash.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(PKG_ROOT, 'package.json'));

/** Prefix of the version segment. The route uses it to recognize an immutable path. */
export const VENDOR_IMMUTABLE_PREFIX = 'v/';

let cached: string | null = null;

export function vendorPkgVersion(): string {
  if (cached) return cached;
  const parts: string[] = [];
  for (const name of ['esbuild-wasm', 'three']) {
    try {
      const raw = readFileSync(require.resolve(`${name}/package.json`), 'utf8');
      const pkg = JSON.parse(raw) as { version?: string };
      parts.push(`${name}@${pkg.version ?? '0'}`);
    } catch {
      parts.push(`${name}@?`);
    }
  }
  cached = createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);
  return cached;
}
