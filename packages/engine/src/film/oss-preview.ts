/**
 * `anim preview` — watch a film in the browser while you (or your agent) write it.
 *
 * The picture is the same host page the AnimSpark app plays: an iframe that compiles the
 * workspace in the browser (esbuild-wasm) and is told the time by its parent. The parent here
 * is a small player (src/preview/app.tsx): transport, a read-only timeline, audio and errors.
 * Saving a file refreshes the picture in place; nothing is re-rendered on the server.
 *
 * Everything is served from one local origin:
 *   /                    the player
 *   /_anim/film          the evaluated film (durations, scenes, sounds) or the compile error
 *   /_anim/events        server-sent events: `change` whenever the workspace changes
 *   /film/host           the host page (iframe)
 *   /film/code-bundle    the workspace sources, one request, ETag'd
 *   /film/code/<path>    one source file
 *   /film/file/<path>    media, with Range
 *   /v1/vendor/…         host.js, esbuild-wasm, three, MathJax
 *   /font/…              the font library, materialized on demand (font-fetch.ts)
 */
import { evaluateFilm } from '@animspark/film-build';
import { build } from 'esbuild';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sendFileWithRange, staticContentType } from '../http-range';
import { fontLinksFor } from '../scene/font-library';
import { ensureFontLibraryFile } from '../scene/font-fetch';
import { workspaceMediaFacts, workspaceMediaResolver } from '../workspace-media';
import { recordFilmFacts, syncAssetIndex } from './asset-sync';
import { bundleBody, bundleEtag, collectCodeBundle, dropCodeBundle } from './code-bundle';
import { filmHostPage } from './code-host';
import { sourceStamps } from './source-stamp';
import { filmSourceAnchors } from './source-anchors';
import { handleVendorRoute } from './vendor';

const here = dirname(fileURLToPath(import.meta.url));
const APP_ENTRY = join(here, '..', 'preview', 'app.tsx');
const CODE_TEXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.css', '.json']);
/* Output folders and tool state: writing into them must not look like an edit. */
const IGNORED = /^(?:\.anim-[^/]*|\.git|node_modules|\.DS_Store)(?:\/|$)/;

export interface PreviewServer {
  url: string;
  close(): Promise<void>;
}

let appScript: Promise<string> | null = null;
function bundleApp(): Promise<string> {
  appScript ??= build({
    entryPoints: [APP_ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120', 'safari17', 'firefox120'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    logLevel: 'silent',
  }).then((r) => r.outputFiles?.[0]?.text ?? '').catch((e: unknown) => { appScript = null; throw e; });
  return appScript;
}

const APP_HTML = (title: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · anim preview</title>
<style>html,body{margin:0;height:100%;background:#0b0b0d;color:#e8e8ea;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}#app{height:100%}</style>
</head><body><div id="app"></div><script src="/_anim/app.js"></script></body></html>`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** A path from the URL → an absolute path inside the workspace, or null. */
function inside(ws: string, rel: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  if (!decoded || decoded.includes('\0')) return null;
  const abs = resolve(ws, decoded);
  if (abs !== ws && !abs.startsWith(ws + sep)) return null;
  if (IGNORED.test(relative(ws, abs).split(sep).join('/'))) return null;
  return abs;
}

/**
 * Name each sound after its clip in film.json. A rendered score arrives as
 * `assets/audio/music/score-<sha>.wav`; the timeline should say `bed`, not the hash.
 */
async function labelSounds<T extends { loc?: string; src: string }>(ws: string, sounds: T[]): Promise<Array<T & { label: string }>> {
  let doc: { tracks?: Array<{ clips?: Array<{ id?: string; src?: string }> }> } | null = null;
  try { doc = JSON.parse(await readFile(join(ws, 'film.json'), 'utf8')); } catch { /* code-form film */ }
  return sounds.map((s) => {
    const m = /^film\.json#(\d+)\.(\d+)$/.exec(s.loc ?? '');
    const clip = m ? doc?.tracks?.[Number(m[1])]?.clips?.[Number(m[2])] : undefined;
    return { ...s, label: clip?.id || (clip?.src ?? s.src).split('/').pop() || s.src };
  });
}

/**
 * 1-based line of each clip in film.json, keyed `film.json#<track>.<clip>` like the evaluator's
 * `loc`. A small JSON reader that remembers where each value starts; invalid JSON → {}.
 */
function clipLines(text: string): Record<string, number> {
  let i = 0;
  const lineAt = (at: number): number => { let n = 1; for (let k = 0; k < at; k += 1) if (text.charCodeAt(k) === 10) n += 1; return n; };
  const ws = () => { while (i < text.length && /\s/.test(text[i]!)) i += 1; };
  type Node = { at: number; kind: 'obj' | 'arr' | 'val'; obj?: Record<string, Node>; arr?: Node[] };
  const str = (): string => {
    let out = ''; i += 1;
    while (i < text.length && text[i] !== '"') { if (text[i] === '\\') { out += text[i + 1] ?? ''; i += 2; } else { out += text[i]; i += 1; } }
    i += 1; return out;
  };
  const value = (): Node => {
    ws();
    const at = i;
    const ch = text[i];
    if (ch === '{') {
      i += 1; const obj: Record<string, Node> = {};
      ws(); if (text[i] === '}') { i += 1; return { at, kind: 'obj', obj }; }
      for (;;) { ws(); const key = str(); ws(); i += 1; obj[key] = value(); ws(); if (text[i] === ',') { i += 1; continue; } i += 1; break; }
      return { at, kind: 'obj', obj };
    }
    if (ch === '[') {
      i += 1; const arr: Node[] = [];
      ws(); if (text[i] === ']') { i += 1; return { at, kind: 'arr', arr }; }
      for (;;) { arr.push(value()); ws(); if (text[i] === ',') { i += 1; continue; } i += 1; break; }
      return { at, kind: 'arr', arr };
    }
    if (ch === '"') { str(); return { at, kind: 'val' }; }
    while (i < text.length && !/[,\]}\s]/.test(text[i]!)) i += 1;
    return { at, kind: 'val' };
  };
  try { JSON.parse(text); } catch { return {}; }
  const root = value();
  const out: Record<string, number> = {};
  root.obj?.tracks?.arr?.forEach((track, t) => {
    track.obj?.clips?.arr?.forEach((clip, c) => { out[`film.json#${t}.${c}`] = lineAt(clip.at); });
  });
  return out;
}

/** The scene file an MG clip plays: `mg/title` → `mg/title.tsx` (or index.tsx in a folder). */
function sceneFile(ws: string, src: string): string | null {
  const bare = src.replace(/\.[cm]?[jt]sx?$/, '');
  for (const cand of [src, `${bare}.tsx`, `${bare}.ts`, `${bare}.jsx`, `${bare}.js`, `${bare}/index.tsx`, `${bare}/index.ts`]) {
    if (existsSync(join(ws, cand)) && /\.[cm]?[jt]sx?$/.test(cand)) return cand;
  }
  return null;
}

export async function startPreview(workspace: string, opts: { port?: number; host?: string } = {}): Promise<PreviewServer> {
  const ws = resolve(workspace);
  const host = opts.host ?? '127.0.0.1';
  const clients = new Set<ServerResponse>();
  let fontSig = '';
  let stamp: string | null = null;
  let rendering: Promise<void> | null = null;
  const broadcast = (event: string, data: unknown): void => {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(line);
  };

  /* One evaluation per source version; a burst of requests shares it. */
  let evaluated: { stamp: string | null; film: Promise<unknown> } | null = null;
  const evaluate = async (): Promise<unknown> => {
    await syncAssetIndex(ws).catch(() => undefined);
    const { all } = await sourceStamps(ws);
    if (evaluated && all && evaluated.stamp === all) return evaluated.film;
    const film = evaluateFilm(ws, { resolve: workspaceMediaResolver(ws), known: workspaceMediaFacts(ws) })
      .then(async (f) => {
        try { recordFilmFacts(ws, f); } catch { /* bookkeeping only */ }
        return { ...f, sounds: await labelSounds(ws, f.sounds), srcHash: all ?? undefined };
      });
    evaluated = { stamp: all, film };
    film.catch(() => { if (evaluated?.film === film) evaluated = null; });
    return film;
  };

  const fontLinks = async (): Promise<string> => {
    const bundle = await collectCodeBundle(ws);
    /* Raw sources, not compiled output: esbuild escapes '得意黑' to \\uXXXX. */
    const corpus = Object.entries(bundle.files ?? {})
      .filter(([path, v]) => typeof v === 'string' && !path.startsWith('skills/'))
      .map(([, v]) => v).join('\n');
    return fontLinksFor(corpus).map((f) => `<link rel="stylesheet" href="${escapeHtml(f.href)}">`).join('\n');
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;

    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(APP_HTML(basename(ws) === 'code' ? basename(dirname(ws)) : basename(ws)));
      return;
    }
    if (path === '/_anim/app.js') {
      const js = await bundleApp();
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(js);
      return;
    }
    if (path === '/_anim/film') {
      try { sendJson(res, 200, await evaluate()); } catch (e) {
        sendJson(res, 422, { error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (path === '/_anim/info') {
      type Facts = { sourceFps?: number; assets?: string[]; scenes?: Array<{ src?: string }> };
      const film = await (evaluate() as Promise<Facts>).catch((): Facts | null => null); // the film route reports errors
      let lines: Record<string, number> = {};
      try { lines = clipLines(await readFile(join(ws, 'film.json'), 'utf8')); } catch { /* code-form film */ }
      const sceneFiles: Record<string, string> = {};
      for (const sc of film?.scenes ?? []) if (sc.src?.startsWith('mg/') && !sceneFiles[sc.src]) { const f = sceneFile(ws, sc.src); if (f) sceneFiles[sc.src] = f; }
      const missing = [...new Set(film?.assets ?? [])].filter((a) => !/^https?:/.test(a) && !existsSync(join(ws, a)));
      sendJson(res, 200, {
        name: basename(ws) === 'code' ? basename(dirname(ws)) : basename(ws),
        root: ws,
        fps: film?.sourceFps ?? 30,
        lines, sceneFiles, missing,
      });
      return;
    }
    if (path === '/_anim/render' && req.method === 'POST') {
      if (rendering) { sendJson(res, 409, { error: 'A render is already running.' }); return; }
      sendJson(res, 202, { state: 'running' });
      broadcast('render', { state: 'running' });
      rendering = (async () => {
        const started = Date.now();
        try {
          const { runCodeCli } = await import('./oss-cli');
          const out = await runCodeCli(ws, 'render', []);
          let file = '.anim-out/film.mp4';
          try { const j = JSON.parse(out) as { video?: string; path?: string }; file = j.video ?? j.path ?? file; } catch { /* plain text */ }
          broadcast('render', { state: 'done', path: relative(ws, resolve(ws, file)).split(sep).join('/'), took: (Date.now() - started) / 1000 });
        } catch (e) {
          broadcast('render', { state: 'error', message: e instanceof Error ? e.message : String(e) });
        } finally { rendering = null; }
      })();
      return;
    }
    if (path.startsWith('/_anim/out/')) {
      const outDir = join(ws, '.anim-out');
      let rel: string;
      try { rel = decodeURIComponent(path.slice('/_anim/out/'.length)); } catch { sendJson(res, 400, { error: 'bad path' }); return; }
      const abs = resolve(outDir, rel);
      if (!abs.startsWith(outDir + sep) || !sendFileWithRange(req, res, abs, { 'content-type': staticContentType(abs), 'cache-control': 'no-store' })) {
        sendJson(res, 404, { error: 'not found' });
      }
      return;
    }
    if (path === '/_anim/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ stamp, fontSig })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/film/host') {
      const page = await filmHostPage({ fileBase: '/film/file/', vendorBase: '/v1/vendor/' });
      const links = await fontLinks().catch(() => '');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${links}`));
      return;
    }
    if (path === '/film/code-bundle') {
      await syncAssetIndex(ws).catch(() => undefined);
      const bundle = await collectCodeBundle(ws, { preview: url.searchParams.get('preview') });
      const etag = bundleEtag(bundle);
      const inm = req.headers['if-none-match'];
      if (etag && typeof inm === 'string' && inm.split(',').some((v) => v.trim() === etag)) {
        res.writeHead(304, { etag, 'cache-control': 'no-cache' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', ...(etag ? { etag } : {}) });
      res.end(bundleBody(bundle));
      return;
    }
    if (path.startsWith('/film/code/')) {
      const abs = inside(ws, path.slice('/film/code/'.length));
      const ext = abs ? extname(abs).toLowerCase() : '';
      if (!abs || !CODE_TEXT.has(ext)) { sendJson(res, 404, { error: 'not found' }); return; }
      let body: string;
      try { body = await readFile(abs, 'utf8'); } catch { sendJson(res, 404, { error: 'not found' }); return; }
      if (ext === '.tsx' || ext === '.jsx') body = filmSourceAnchors(body, relative(ws, abs).split(sep).join('/'));
      res.writeHead(200, { 'content-type': staticContentType(abs), 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    if (path.startsWith('/film/file/')) {
      const abs = inside(ws, path.slice('/film/file/'.length));
      if (!abs || !sendFileWithRange(req, res, abs, { 'content-type': staticContentType(abs), 'cache-control': 'no-store' })) {
        sendJson(res, 404, { error: 'not found' });
      }
      return;
    }
    if (path.startsWith('/font/')) {
      const file = await ensureFontLibraryFile(decodeURIComponent(path.slice('/font/'.length)));
      if (!file) { sendJson(res, 404, { error: 'not found' }); return; }
      res.writeHead(200, {
        'content-type': file.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2',
        'cache-control': 'public, max-age=31536000, immutable',
      });
      res.end(await readFile(file));
      return;
    }
    if (handleVendorRoute(req, res, path)) return;
    sendJson(res, 404, { error: 'not found' });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    });
  });

  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, host, done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('preview server has no address');
  const origin = `http://${host}:${address.port}`;
  /* Font stylesheets point at this origin; /font/ answers them from the local cache. */
  process.env.ANIMSPARK_FONT_BASE = origin;

  ({ all: stamp } = await sourceStamps(ws));
  fontSig = await fontLinks().catch(() => '');

  /* Tell the player when sources change. Writes the engine makes itself (the asset index,
     output folders) are filtered by comparing the source stamp, not by guessing paths. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onChange = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void (async () => {
        const next = (await sourceStamps(ws)).all;
        if (next === stamp) return;
        stamp = next;
        dropCodeBundle(ws);
        const sig = await fontLinks().catch(() => fontSig);
        const payload = JSON.stringify({ stamp, fontSig: sig, fontsChanged: sig !== fontSig });
        fontSig = sig;
        broadcast('change', JSON.parse(payload));
      })().catch(() => undefined);
    }, 120);
  };
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(ws, { recursive: true }, (_event, file) => {
      const rel = typeof file === 'string' ? file.split(sep).join('/') : '';
      if (rel && IGNORED.test(rel)) return;
      onChange();
    });
  } catch {
    /* No recursive watch on this platform: poll the stamp instead. */
    const poll = setInterval(onChange, 1000);
    server.on('close', () => clearInterval(poll));
  }
  const keepAlive = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20_000);

  return {
    url: origin,
    async close() {
      clearInterval(keepAlive);
      watcher?.close();
      for (const c of clients) c.end();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
