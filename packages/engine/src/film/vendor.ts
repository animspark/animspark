/**
 * Shared packages for the preview: esbuild-wasm, three, etc.
 *
 * Client-side compilation depends on these files having a **long-term cacheable URL**, rather than
 * copying three into a film's HTML every time a project opens. This serves files from this package's
 * dependencies as-is (resolved by package, independent of repository layout).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { bundleHost } from './code-host';
import { MATHJAX_SPECS } from './host-shared';
import { allowedVendorSpec, pkgName } from './vendor-allowlist';
import { VENDOR_IMMUTABLE_PREFIX, vendorPkgVersion } from './vendor-version';
import { engineRequire, packageDir } from '../package-root';

export { allowedVendorSpec } from './vendor-allowlist';

const require = engineRequire;

const WASM_NAME = 'esbuild.wasm';
const WASM_JS = 'esbuild-wasm.js';

function mimeOf(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function exportTarget(exp: unknown, kind: 'import' | 'default' | 'require'): string | null {
  if (typeof exp === 'string') return exp;
  if (!exp || typeof exp !== 'object') return null;
  const rec = exp as Record<string, unknown>;
  const pick = rec[kind] ?? rec.import ?? rec.default ?? rec.require;
  if (typeof pick === 'string') return pick;
  if (pick && typeof pick === 'object') return exportTarget(pick, kind);
  return null;
}

function resolvePkgDir(name: string): string | null {
  try {
    const pkgJsonPath = require.resolve(`${name}/package.json`);
    return dirname(pkgJsonPath);
  } catch {
    try {
      let dir = dirname(require.resolve(name));
      for (let i = 0; i < 8; i++) {
        const pkgJsonPath = join(dir, 'package.json');
        if (existsSync(pkgJsonPath)) {
          const pkg = readJson(pkgJsonPath);
          if (pkg.name === name) return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function resolveThree(spec: string): string | null {
  const dir = resolvePkgDir('three');
  if (!dir) return null;
  const pkgJsonPath = join(dir, 'package.json');
  const pkg = existsSync(pkgJsonPath) ? readJson(pkgJsonPath) : {};
  const exportsField = pkg.exports;
  if (spec === 'three') {
    const exp = exportsField && typeof exportsField === 'object'
      ? (exportsField as Record<string, unknown>)['.']
      : null;
    const rel = exportTarget(exp, 'import') ?? (typeof pkg.module === 'string' ? pkg.module : './build/three.module.js');
    const abs = join(dir, rel.replace(/^\.\//, ''));
    return existsSync(abs) ? abs : null;
  }
  if (spec.startsWith('three/addons/')) {
    const rest = spec.slice('three/addons/'.length);
    if (!rest || rest.includes('..') || rest.includes('\\')) return null;
    const abs = join(dir, 'examples/jsm', rest);
    return existsSync(abs) ? abs : null;
  }
  if (spec.startsWith('three/')) {
    const rest = spec.slice('three/'.length);
    if (!rest || rest.includes('..')) return null;
    const abs = join(dir, rest);
    return existsSync(abs) ? abs : null;
  }
  return null;
}

function resolveEsbuildFile(kind: 'wasm' | 'js'): string | null {
  try {
    if (kind === 'wasm') return require.resolve('esbuild-wasm/esbuild.wasm');
    return require.resolve('esbuild-wasm/lib/browser.min.js');
  } catch {
    return null;
  }
}

/** Resolve `three` / `three/addons/…` / `esbuild.wasm` to a real file on disk. */
export function resolveVendorFile(spec: string): string | null {
  const clean = normalize(spec).replace(/^[/\\]+/, '');
  if (!clean || clean.includes('..')) return null;
  if (!allowedVendorSpec(clean)) return null;
  if (clean === 'host.js') return null;
  if (clean === WASM_NAME) return resolveEsbuildFile('wasm');
  if (clean === WASM_JS) return resolveEsbuildFile('js');
  /* three.module.js imports ./three.core.js relatively. If the import map points at
     /vendor/three (no directory), the browser requests /vendor/three.core.js. */
  if (clean === 'three.core.js' || clean === 'three.module.js') {
    return resolveThree(`three/build/${clean}`);
  }
  if (clean === 'three' || clean.startsWith('three/')) return resolveThree(clean);
  try {
    return require.resolve(clean);
  } catch {
    try {
      const pkgJson = require.resolve(`${pkgName(clean)}/package.json`);
      const dir = dirname(pkgJson);
      const rest = clean.slice(pkgName(clean).length).replace(/^\//, '');
      if (!rest) {
        const pkg = readJson(pkgJson);
        const rel = typeof pkg.module === 'string' ? pkg.module : 'index.js';
        const abs = join(dir, rel.replace(/^\.\//, ''));
        return existsSync(abs) ? abs : null;
      }
      const abs = join(dir, rest);
      return existsSync(abs) ? abs : null;
    } catch {
      return null;
    }
  }
}

/**
 * With only a one-day `max-age` and neither ETag nor Last-Modified, once it expires the browser
 * can't even send a conditional request and has to re-download all 15.8 MB. These files are bytes
 * from node_modules and don't change while the process is alive, so the versioned path
 * `/v1/vendor/v/<version>/…` can be served with one year + immutable.
 */
const IMMUTABLE_PREFIX = VENDOR_IMMUTABLE_PREFIX;
const ONE_YEAR = 31_536_000;

/** The version segment is only a cache key and plays no part in resolution: same file either way. */
function stripVersion(spec: string): { spec: string; immutable: boolean } {
  if (!spec.startsWith(IMMUTABLE_PREFIX)) return { spec, immutable: false };
  const rest = spec.slice(IMMUTABLE_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return { spec, immutable: false };
  return { spec: rest.slice(slash + 1), immutable: true };
}

/**
 * Keep bytes once read, along with their ETag.
 *
 * Previously every request did `readFileSync`; esbuild.wasm is 11.8 MB and opening a project read it
 * three times (player, thumbnails, and the next open). Freshness is keyed on mtime, so a package
 * replaced on disk is re-read.
 */
type VendorFile = { bytes: Buffer; etag: string; mtimeMs: number };
const fileCache = new Map<string, VendorFile>();

function loadVendorFile(abs: string): VendorFile | null {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(abs).mtimeMs;
  } catch {
    return null;
  }
  const hit = fileCache.get(abs);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  let bytes: Buffer;
  try {
    bytes = readFileSync(abs);
  } catch {
    return null;
  }
  const entry: VendorFile = {
    bytes,
    etag: `"v-${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`,
    mtimeMs,
  };
  fileCache.set(abs, entry);
  return entry;
}

function ifNoneMatch(req: IncomingMessage, etag: string): boolean {
  const raw = req.headers['if-none-match'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return false;
  return value.split(',').some((v: string) => v.trim() === etag || v.trim() === '*');
}

function cacheControlFor(immutable: boolean): string {
  return immutable ? `public, max-age=${ONE_YEAR}, immutable` : 'public, max-age=86400';
}


/**
 * Single-file ESM bundle of MathJax; all six mathjax-full specifiers in the page importmap point here.
 *
 * Why bundle on the fly instead of serving the files from node_modules: mathjax-full is CJS, which
 * the browser can't load directly, and it's 300+ small modules, much slower fetched one by one over
 * HTTP than a single immutable 1.8 MB file.
 * It resolves from @animspark/stem's own directory: mathjax-full is a dependency of that
 * package only (do not add a second copy to the CLI's package.json — the formula output must
 * match the version stem compiles against). The directory comes from package resolution, so
 * this works in the repository and from an npm install alike.
 */
const MATHJAX_BUNDLE = 'mathjax-tex-svg.js';
const stemPkgDir = (): string => packageDir('@animspark/stem');
let mathjaxBundle: Promise<Buffer> | null = null;

/**
 * Exported for tests only: a test really builds and imports this bundle, so any drift between
 * MATHJAX_SPECS and mathjax.ts breaks right away.
 */
export function bundleMathjax(): Promise<Buffer> {
  mathjaxBundle ??= (async () => {
    const { build } = await import('esbuild');
    const entry = Object.entries(MATHJAX_SPECS)
      .map(([spec, name]) => `export { ${name} } from ${JSON.stringify(spec)};`)
      .join('\n');
    const result = await build({
      stdin: { contents: entry, resolveDir: stemPkgDir(), loader: 'js' },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: ['chrome120'],
      minify: true,
      legalComments: 'eof',
      logLevel: 'silent',
    });
    return Buffer.from(result.outputFiles?.[0]?.text ?? '');
  })();
  mathjaxBundle.catch(() => { mathjaxBundle = null; });
  return mathjaxBundle;
}

async function sendMathjaxBundle(
  req: IncomingMessage,
  res: ServerResponse,
  immutable: boolean,
): Promise<void> {
  try {
    const bytes = await bundleMathjax();
    const etag = `"mj-${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`;
    if (ifNoneMatch(req, etag)) {
      res.writeHead(304, { etag, 'cache-control': cacheControlFor(immutable) });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': cacheControlFor(immutable),
      'content-length': String(bytes.byteLength),
      etag,
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) {
    if (res.headersSent) return;
    res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * Bundle multi-file ESM packages (d3-geo / d3-scale / topojson-client…) into a single file.
 *
 * These packages' entry points are a list of `export … from './x.js'`. Served as-is, the browser
 * requests `/vendor/x.js`, which reads as a different package name and 404s; the film's whole module
 * graph fails to link, leaving a black frame and a single vague "a chunk didn't composite" error.
 * three / matter-js / p5 are single-file builds and skip this. Built once, cached by (spec, mtime).
 */
const RELATIVE_ESM = /\b(?:import|export)\b[^;'"]*\bfrom\s*['"]\.{1,2}\/|\bimport\s*\(\s*['"]\.{1,2}\//;
const bundledVendor = new Map<string, Promise<Buffer>>();
function needsBundling(abs: string, text: string): boolean {
  return /\.m?js$/.test(abs) && RELATIVE_ESM.test(text);
}
function bundleVendorEntry(abs: string, key: string): Promise<Buffer> {
  let job = bundledVendor.get(key);
  if (!job) {
    job = (async () => {
      const { build } = await import('esbuild');
      const result = await build({
        entryPoints: [abs],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        target: ['chrome120'],
        minify: true,
        legalComments: 'eof',
        logLevel: 'silent',
      });
      return Buffer.from(result.outputFiles?.[0]?.text ?? '');
    })();
    job.catch(() => { bundledVendor.delete(key); });
    bundledVendor.set(key, job);
  }
  return job;
}
async function sendBundledVendor(
  req: IncomingMessage,
  res: ServerResponse,
  abs: string,
  file: VendorFile,
  immutable: boolean,
): Promise<void> {
  try {
    const bytes = await bundleVendorEntry(abs, `${abs}@${file.mtimeMs}`);
    const etag = `"b-${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`;
    if (ifNoneMatch(req, etag)) {
      res.writeHead(304, { etag, 'cache-control': cacheControlFor(immutable) });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': cacheControlFor(immutable),
      'content-length': String(bytes.byteLength),
      etag,
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) {
    if (res.headersSent) return;
    res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}

async function sendHostJs(
  req: IncomingMessage,
  res: ServerResponse,
  immutable: boolean,
): Promise<void> {
  try {
    const js = await bundleHost();
    const bytes = Buffer.from(js);
    const etag = `"h-${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}"`;
    if (ifNoneMatch(req, etag)) {
      res.writeHead(304, { etag, 'cache-control': cacheControlFor(immutable) });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': cacheControlFor(immutable),
      'content-length': String(bytes.byteLength),
      etag,
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (e) {
    if (res.headersSent) return;
    res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}

export function handleVendorRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!pathname.startsWith('/v1/vendor/')) return false;
  const raw = decodeURIComponent(pathname.slice('/v1/vendor/'.length));
  const { spec, immutable } = stripVersion(raw);
  const clean = normalize(spec).replace(/^[/\\]+/, '').split('?')[0] ?? '';
  /**
   * Manifest of this batch of packages, for background precaching when the site is opened (see
   * web's film-vendor-sw.js).
   *
   * A separate endpoint rather than hard-coding the version in the frontend: `pnpm install` decides
   * the version, and hard-coding it in two places means one day precaching bytes **nobody wants**
   * while the ones actually needed still download on demand.
   */
  if (clean === 'manifest') {
    const body = JSON.stringify({
      version: vendorPkgVersion(),
      files: [
        'esbuild-wasm.js',
        'esbuild.wasm',
        'three/build/three.module.js',
        'three/build/three.core.js',
      ],
    });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }
  if (clean === 'host.js') {
    void sendHostJs(req, res, immutable);
    return true;
  }
  if (clean === MATHJAX_BUNDLE) {
    void sendMathjaxBundle(req, res, immutable);
    return true;
  }
  const abs = resolveVendorFile(spec);
  const file = abs ? loadVendorFile(abs) : null;
  if (!abs || !file) {
    res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'not found' }));
    return true;
  }
  /* three handles its own relative imports (three.core.js is allowed separately); other ESM with
     relative imports is bundled into a single file on the fly. */
  if (!clean.startsWith('three') && needsBundling(abs, file.bytes.toString('utf8', 0, Math.min(file.bytes.length, 200_000)))) {
    void sendBundledVendor(req, res, abs, file, immutable);
    return true;
  }
  if (ifNoneMatch(req, file.etag)) {
    res.writeHead(304, { etag: file.etag, 'cache-control': cacheControlFor(immutable) });
    res.end();
    return true;
  }
  res.writeHead(200, {
    'content-type': mimeOf(abs),
    'cache-control': cacheControlFor(immutable),
    'content-length': String(file.bytes.byteLength),
    etag: file.etag,
  });
  res.end(req.method === 'HEAD' ? undefined : file.bytes);
  return true;
}
