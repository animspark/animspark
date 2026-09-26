/**
 * Interrogate `film.tsx` — without a browser.
 *
 * Once a film is code, questions like "how long is it, what sounds when, how many scenes" can only
 * be answered by **running** it. This layer is that run: esbuild builds a bundle node can execute,
 * it is imported, rendered once, and the manifest is collected.
 *
 * Two things make it cheaper than it sounds:
 *
 * · **Effects don't run.** `renderToStaticMarkup` only renders. So gsap timelines, canvas and
 *   `<video>` are never touched — all of that happens in effects.
 * · **Libraries that can't draw here are replaced with dummy stubs.** Libraries like `p5` blow up
 *   the moment they are imported in node (`window is not defined`), but they are only really used
 *   inside effects. So in this bundle they are replaced with a Proxy that says yes to everything:
 *   the import succeeds, render doesn't need it, collection proceeds. A module that really calls
 *   one during render gets a clear error instead of `window is not defined`.
 */

import { type Plugin, build } from 'esbuild';
import { existsSync } from 'node:fs';
import { Module } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  FILM_DOC_FILE,
  filmDocShape,
  filmSrcIsStill,
  parseFilmDoc,
  type FilmDoc,
} from '@animspark/core';
import type { FilmSummary } from '@animspark/runtime';

import { LIB_PATHS, resolveFromLibPaths, stemFilmAliasPlugin } from '../shared-deps';
import { resolveAll, type MediaFactsStore, type MediaResolver } from '../media-resolver';
import { probe } from '../probe';
import { FilmCliError } from '../workspace';

import { createHash } from 'node:crypto';
import { FILM_DOC_GLOBAL, filmDocEntrySource } from './doc-entry';
import { projectRuntimePlugin } from './project-runtime';
import { readPublishedMgProjects } from './published-mg';
import { filmDocAssetFacts, filmRuntimeAssets, readAssetWordBook, assetWordBookStamp } from './asset-index';
import { collectDocMediaSec } from './doc-media';
import { syncScoreAudio } from './score-audio';

/**
 * Libraries that blow up when imported in node — replaced with dummy stubs in this node bundle only.
 *
 * The criterion is "touches the DOM at import time", not "has to do with graphics": `three` /
 * `matter-js` / `roughjs` / `simplex-noise` all import fine in node, and are often genuinely called
 * in `useMemo` (which is render time), so stubbing them would break working modules. Hence this
 * list is kept as short as possible.
 */
const BROWSER_ONLY = ['p5'];

export interface FilmEval extends FilmSummary {
  stage: { w: number; h: number };
  /**
   * Source frame rate (only present when every video asset in the film has the same rate).
   *
   * Export follows it rather than the default: exporting 25 fps footage at 30 fps repeats one frame
   * in every five, and the result is choppier than the original. Absent with mixed frame rates —
   * then any choice is wrong, so the default is used.
   */
  sourceFps?: number;
}
export interface FilmBuildSnapshot { doc: FilmDoc; projects: ReturnType<typeof readPublishedMgProjects> }
const filmSnapshots = new WeakMap<FilmEval, FilmBuildSnapshot>();
/** Host-only state: never serialized into an agent report or editable document. */
export function filmBuildSnapshot(film: FilmEval): FilmBuildSnapshot | undefined { return filmSnapshots.get(film); }

/**
 * A stub that says yes to everything.
 *
 * Not `{}`, because the error has to be attributable: `new P5(...)` in a module gets "p5 is a stub
 * in this pass" instead of `X is not a constructor` — whose stack has no clue pointing to "you used
 * a browser-only library during render".
 */
function stubSource(name: string): string {
  return `
const fail = (op) => {
  throw new Error(
    '\`${name}\` is a stub in this collecting pass (importing it in node blows up, so it got swapped out), '
    + 'and you used it during render (' + op + '). Move it into useGSAP / useEffect — that is where '
    + 'it belongs, and this pass does not run effects, so once it is in there it is fine.',
  );
};
const stub = new Proxy(function () {}, {
  get: (_t, prop) => (prop === 'default' || prop === '__esModule' ? stub : stub),
  apply: () => fail('called as a function'),
  construct: () => fail('called with new'),
});
export default stub;
export { stub };
`;
}

function stubPlugin(names: readonly string[]): Plugin {
  const filter = new RegExp(`^(${names.map((n) => n.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})$`);
  return {
    name: 'anim-browser-only-stub',
    setup(b) {
      b.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'anim-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'anim-stub' }, (args) => ({
        contents: stubSource(args.path),
        loader: 'js',
      }));
    },
  };
}

/**
 * Keep three out of this throwaway film.cjs.
 *
 * The preview is compiled in the browser; this pass only collects scenes and durations. Copying
 * three in would mean the server bundles three again every time a project is opened, when Node can
 * import it straight from node_modules.
 */
function threeOnDiskPlugin(): Plugin {
  const req = { resolve: resolveFromLibPaths };
  return {
    name: 'anim-three-on-disk',
    setup(b) {
      b.onResolve({ filter: /^three(\/|$)/ }, (args) => {
        try {
          if (args.path === 'three') {
            return { path: req.resolve('three'), external: true };
          }
          if (args.path.startsWith('three/addons/')) {
            const rest = args.path.slice('three/addons/'.length);
            if (!rest || rest.includes('..')) return null;
            const root = join(dirname(req.resolve('three')), '..');
            const abs = join(root, 'examples/jsm', rest);
            return existsSync(abs) ? { path: abs, external: true } : null;
          }
        } catch {
          return null;
        }
        return null;
      });
    },
  };
}

/**
 * The generated entry.
 *
 * The collector and `react-dom/server` are bundled into the same output and share **the same
 * React** as the film — with two copies, contexts wouldn't match: the collector's provider and the
 * film's hooks would each read their own, and the collected result would always be empty.
 *
 * `evaluateFilm(doc)` takes a doc: a doc-form bundle reads it from a global (see runtime mode in
 * doc-entry), so one imported module can run several times with different docs — that is how moving
 * a clip on the timeline saves an esbuild run. There is **no await** between setting the global and
 * rendering: one process has several projects open at once, and yielding in between would render
 * someone else's doc.
 */
function entrySource(filmPath: string): string {
  return `
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { collectFilm } from '@animspark/runtime';
import * as film from ${JSON.stringify(filmPath)};

export const mgSounds = film.mgSounds;

export function evaluateFilm(doc) {
  if (doc !== undefined) globalThis.${FILM_DOC_GLOBAL} = doc;
  if (typeof film.default !== 'function') {
    throw new Error('the generated film entry lost its default export — this is a bug in doc-entry, not in your film.');
  }
  const summary = collectFilm(React.createElement(film.default), renderToStaticMarkup, film.stage);
  return { ...summary, stage: film.stage };
}
`;
}

interface FilmModule {
  evaluateFilm(doc?: unknown): FilmEval;
  mgSounds?: Record<string, unknown>;
}

/**
 * Compiled and executed modules — the latest one per workspace.
 *
 * Kept for this case: moving a clip on the timeline changes not one character of code, only one
 * number in the doc. Then the whole `mkdtemp → esbuild → execute module` sequence (measured
 * 140–170 ms, longer for big films) can be skipped; just hand the new doc to the previous module
 * and render again.
 *
 * The key is "code stamp + doc shape": the former covers MG code, asset bytes and the ledger; the
 * latter covers which modules and assets get bundled and the stage size (see filmDocShape in core).
 * If neither changed, the bundle would be byte-for-byte identical — recompiling would just redo
 * the same work.
 *
 * The cap is 8 workspaces, like the route LRU. Modules are retained only by this table; a film is a
 * few MB, so eight is an acceptable ceiling; beyond that the oldest entry is dropped.
 */
const MAX_MODULES = 8;
const modules = new Map<string, { key: string; mod: FilmModule }>();

function cachedModule(workspace: string, key: string): FilmModule | null {
  const hit = modules.get(workspace);
  if (!hit || hit.key !== key) return null;
  /* Move it to the end: Map iteration order is insertion order, and the oldest one gets dropped. */
  modules.delete(workspace);
  modules.set(workspace, hit);
  return hit.mod;
}

function rememberModule(workspace: string, key: string, mod: FilmModule): void {
  modules.delete(workspace);
  modules.set(workspace, { key, mod });
  while (modules.size > MAX_MODULES) modules.delete(modules.keys().next().value!);
}

/**
 * Build a node bundle and execute it.
 *
 * `resolve` locates asset bytes. Without it, the old rule of reading from disk — on the standalone
 * workbench all assets are on disk anyway. The platform side must pass it: directly uploaded
 * footage leaves only a pointer in the working tree, and this pass needs to ffprobe their
 * durations; failing to probe means the film's duration is wrong.
 *
 * `known` is the free answer to the same question. With it, most assets don't even need their
 * bytes fetched — this pass runs every time the editor opens and every time a line of code
 * changes, and it used to cost downloading every master in the film once.
 */
export async function evaluateFilm(
  workspace: string,
  opts: EvaluateOpts = {},
): Promise<FilmEval> {
  return runEvaluate(workspace, opts);
}

export interface EvaluateOpts {
  /** Internal snapshot shared with browser compilation for one export. */
  snapshot?: FilmBuildSnapshot;
  resolve?: MediaResolver;
  known?: MediaFactsStore;
  /**
   * Stamp of this version of the **code** — excluding `film.json` (see sourceStamps in the engine).
   *
   * Passing it enables the cache: when neither the code stamp nor the doc shape changed, the
   * previously imported module is reused and this pass just re-renders with the new doc. Without
   * it, recompile every time as before — the CLI commands are one-shot anyway, and an unreliable
   * cache is worse than none.
   */
  codeStamp?: string | null;
}

async function runEvaluate(
  workspace: string,
  opts: EvaluateOpts = {},
): Promise<FilmEval> {
  try {
    /* Check the schema before compiling — a broken doc then gets the clip-by-clip error without waiting for esbuild. */
    const doc = opts.snapshot?.doc ?? parseFilmDoc(await readFile(join(workspace, FILM_DOC_FILE), 'utf8'));
    const snapshot = opts.snapshot ?? { doc, projects: readPublishedMgProjects(workspace) };
    opts = { ...opts, snapshot };
    const mod = await filmModule(workspace, doc, opts);
    /* No await between setting the global (inside evaluateFilm) and finishing the render — see the header comment of entrySource. */
    const result = mod.evaluateFilm(doc);
    await syncScoreAudio(workspace, mod.mgSounds);
    filmSnapshots.set(result, snapshot);
    assertStage(result);
    relativizeLocs(result);
    const resolve: MediaResolver = opts.resolve ?? (async (rel) => {
      const abs = join(workspace, rel);
      return existsSync(abs) ? abs : null;
    });
    await measureSounds(result, resolve, opts.known);
    await measureSourceFps(result, resolve, opts.known);
    return result;
  } catch (error) {
    /* Attach the original error as cause: the message that surfaces is for the film's author, while debugging this chain itself needs the original stack. */
    throw new FilmCliError(explain(error, workspace), { cause: error });
  }
}

/** The module for this version: use the cached one if there is one, otherwise compile a new one. */
async function filmModule(
  workspace: string,
  doc: FilmDoc,
  opts: EvaluateOpts,
): Promise<FilmModule> {
  const key = opts.codeStamp
    ? `${opts.codeStamp}\n${assetWordBookStamp(workspace)}\n${createHash('sha256').update(JSON.stringify(filmRuntimeAssets(workspace))).digest('hex')}\n${JSON.stringify(Object.entries(opts.snapshot?.projects ?? {}).map(([src, value]) => [src, value.buildId]))}\n${filmDocShape(doc, { facts: filmDocAssetFacts(doc, workspace) })}`
    : null;
  const hit = key ? cachedModule(workspace, key) : null;
  if (hit) return hit;
  const mod = await buildFilmModule(workspace, doc, opts);
  if (key) rememberModule(workspace, key, mod);
  return mod;
}

/** Build a node bundle and execute it. Once evicted from the LRU, the module can be garbage-collected. */
async function buildFilmModule(
  workspace: string,
  doc: FilmDoc,
  opts: EvaluateOpts,
): Promise<FilmModule> {
  const dir = await mkdtemp(join(tmpdir(), 'anim-film-'));
  const entry = join(dir, 'entry.mjs');
  const out = join(dir, 'film.cjs');
  try {
    /* The root module is freshly generated glue (imports the ledger and picture modules and
       assembles a component). The doc itself isn't imported — it is read on every render
       (runtime mode), so one bundle works with different docs. */
    const media = await collectDocMediaSec(doc, {
      workspace,
      resolve: opts.resolve,
      known: opts.known,
    });
    const filmPath = join(dir, 'doc-root.mjs');
    await writeFile(filmPath, filmDocEntrySource(doc, {
      resolvePath: (rel) => join(workspace, rel),
      assets: filmRuntimeAssets(workspace),
      words: readAssetWordBook(workspace),
      media,
      projects: opts.snapshot?.projects ?? readPublishedMgProjects(workspace),
      mode: 'runtime',
    }), 'utf8');
    await writeFile(entry, entrySource(filmPath), 'utf8');
    await build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      jsx: 'automatic',
      /* Use our own jsx runtime, which injects `__loc` (the source line) into the components that
         go on the timeline — that is what lets a drag on the timeline land back in the source.
         See runtime/jsx-dev-runtime. */
      jsxDev: true,
      jsxImportSource: '@animspark/runtime',
      /* File names in locations are **relative to cwd**. With cwd set to the workspace we get
         `film.tsx` / `mg/hook.tsx` directly — exactly the coordinates the frontend and the
         write-back side use. Without it they'd be `../../../private/var/…`, useless to everyone. */
      absWorkingDir: workspace,
      nodePaths: [...LIB_PATHS, join(workspace, 'node_modules')],
      plugins: [projectRuntimePlugin(workspace, false), stubPlugin(BROWSER_ONLY), threeOnDiskPlugin(), stemFilmAliasPlugin()],
      logLevel: 'silent',
      /* Runtime errors need to point at the source. Without this the stack is all line numbers
         in the temporary bundle — `document is not defined` with `/var/folders/…/film.cjs:81037`,
         in a film with hundreds of files. The temp directory gets deleted, so the sourcemap must
         be inline; an external file can't be read back later. */
      sourcemap: 'inline',
      /* Translating stacks only needs the mappings and file names. By default the full text of
         every source file (React, gsap, the runtime…) is copied into the map too, bringing one
         film's bundle to 11 MB; modules stay in the LRU per workspace and Node keeps its own
         decoded copy of the map — eight workspaces means hundreds of MB of source nobody reads. */
      sourcesContent: false,
      /* json is imported directly (word books and such); css is empty in this node pass — font
         stylesheets only matter to the browser and collection doesn't need them, and without a
         loader esbuild would split them out as a second output. */
      loader: { '.json': 'json', '.css': 'empty' },
      // Preserve import.meta.url for bundled code that resolves resources relative to the output.
      define: { 'import.meta.url': JSON.stringify(pathToFileURL(out).href) },
    });
    /* Have node translate stacks using the inline sourcemap. It is off by default (it has a cost),
       but this pass exists precisely to find out "what's wrong where" — that cost is exactly what
       it is paying for. */
    process.setSourceMapsEnabled(true);
    // A new ESM URL is retained by Node forever, even after our LRU evicts it.
    // Compile a detached CommonJS module: no global require.cache entry and no
    // persistent parent's children array. Its code and inline map can be collected
    // when the last FilmModule reference is released. This is not a sandbox.
    const source = await readFile(out, 'utf8');
    const compiled = new Module(out);
    compiled.filename = out;
    compiled.paths = [...LIB_PATHS, join(workspace, 'node_modules')];
    (compiled as Module & { _compile(source: string, filename: string): void })
      ._compile(source, out);
    return compiled.exports as FilmModule;
  } finally {
    /* Errors aren't caught at this layer: failing to compile and failing to run are two ends of
       the same thing, and the message for the film's author should come from one place only
       (the catch in runEvaluate). */
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Make absolute paths in locations workspace-relative.
 *
 * esbuild gives absolute compile-time paths, which mean nothing to the frontend — it uses them to
 * request source and write back edits, so both sides must use the same coordinates.
 *
 * The compile sets cwd to the workspace (see absWorkingDir), so paths are already relative. This
 * only removes the ones **pointing outside the workspace** — the runtime's own files carry
 * locations too, but they aren't something the user can edit, and passing them on would only let
 * someone open a file they can't change.
 */
function relativizeLocs(film: FilmEval): void {
  const fix = <T extends { loc?: string }>(x: T): void => {
    if (!x.loc) return;
    if (x.loc.startsWith('..') || x.loc.startsWith('/')) delete x.loc;
  };
  film.scenes.forEach(fix);
  film.sounds.forEach(fix);
  film.videos.forEach(fix);
  film.captions.forEach(fix);
}

/**
 * Fill in sound durations with measured values.
 *
 * In code `src` is just a path, and the film's author doesn't care how long the file is — entries
 * that "play the whole file" have durMs Infinity at collection time. Here each file is ffprobed
 * once, each entry is clamped to the measured length, and the film duration is recomputed.
 * check (black tail, overlaps), hear (plotting) and render (mixdown) all consume this completed
 * list.
 */
async function measureSounds(
  film: FilmEval,
  resolve: MediaResolver,
  known?: MediaFactsStore | undefined,
): Promise<void> {
  const byId = new Map<string, number>();
  const srcs = [...new Set(film.sounds.map((s) => s.src))];
  /*
   * Footage audio doesn't count as "a sound file".
   *
   * `<Video>` unconditionally registers a sound for itself (see media in the runtime), so every
   * footage clip looks just like a `<Vo>` here. But the consequences differ by an order of
   * magnitude: a voice-over that can't be found means the whole timeline is laid out wrong, while
   * footage audio that can't be found at worst leaves that stretch silent — the picture is fine.
   *
   * The two throws below were written for voice-over; footage hitting them makes **the whole film
   * fail to evaluate**: the user drags a video from the asset shelf onto the timeline, the server
   * returns 422, the timeline pops up "can't place it", and nothing is wrong with the video at all
   * — it may just have been uploaded with its bytes still hydrating, or have no audio track.
   *
   * So footage audio takes a different tier: its duration is borrowed from its own picture duration
   * (measured before this step), and if that isn't available the sound is dropped rather than
   * blocking the whole film.
   */
  const videoDur = new Map<string, number>();
  for (const v of film.videos) {
    const dur = v.sourceDurMs;
    if (dur != null && dur > 0) videoDur.set(v.src, dur);
  }
  const ownVideo = new Set(film.videos.map((v) => v.src));

  /* Ask the pointers first. Whatever they answer needs not one byte fetched — and not asking
     would mean pulling every master the film references onto disk each time the editor opens,
     just to read their durations.
     Note: skipping the fetch also skips the "can this file actually be fetched" check. A pointer
     in the tree is evidence the file exists, and unfetchable bytes (an orphaned pointer) are an
     anomaly that fails loudly at the mixdown step. Downloading hundreds of GB to catch that rare
     failure thirty seconds earlier isn't worth it. */
  const missing: string[] = [];
  for (const src of srcs) {
    const durMs = (await known?.get(src))?.durMs;
    if (durMs != null && durMs > 0) byId.set(src, durMs);
    else missing.push(src);
  }

  if (missing.length) {
    const found = await resolveAll(missing, resolve);
    for (const src of missing) {
      const abs = found.get(src);
      if (!abs) {
        if (ownVideo.has(src)) continue;
        throw new Error(`the sound file is not there: ${src} — the code references it, but none of its bytes can be fetched.`);
      }
      const facts = await probe(abs).catch(() => null);
      if (facts?.durMs == null) {
        if (ownVideo.has(src)) continue;
        throw new Error(`cannot probe a duration: ${src}`);
      }
      byId.set(src, facts.durMs);
      // Record it back to the pointer: existing assets have no meta, and without writing back they'd be downloaded again every round.
      await known?.put?.(src, facts).catch(() => undefined);
    }
  }
  /* Footage audio that couldn't be measured: borrow the picture's duration first; failing that, drop the entry. Only the sound goes; the picture stays. */
  const kept = film.sounds.filter((s) => byId.has(s.src) || videoDur.has(s.src));
  film.sounds = kept;
  for (const s of film.sounds) {
    const fileDur = byId.get(s.src) ?? videoDur.get(s.src)!;
    s.durMs = Math.min(s.durMs, Math.max(0, fileDur - s.inMs));
    /* Report the asset's full length too: the timeline uses it to decide how far a clip can still
       be extended to the right. Past the end is silence, while on the timeline it looks like the
       clip got longer — an error only noticed by listening. */
    s.sourceDurMs = fileDur;
  }
  let end = film.visualEndMs;
  for (const s of film.sounds) end = Math.max(end, s.startMs + s.durMs);
  film.durationMs = Math.round(end);
}

/**
 * Source frame rate: accepted only if every video asset reports the same number.
 *
 * With a mix of 25 and 60 there is no answer — either choice makes the other half judder, and the
 * film's author should decide. Assets that can't be probed (animated images, broken files) are
 * skipped so they don't spoil an otherwise consistent result.
 */
async function measureSourceFps(
  film: FilmEval,
  resolve: MediaResolver,
  known?: MediaFactsStore | undefined,
): Promise<void> {
  const rates = new Set<number>();
  const durBySrc = new Map<string, number>();
  const missing: string[] = [];
  /* Don't probe stills. Picture tracks hold images as well as footage, and for a jpg ffprobe
     answers "one frame, 25 fps, 0.04 s" — three numbers that all look normal and all go wrong:
     25 joins rates, so a picture's fake frame rate votes on the film's frame rate; 0.04 s becomes
     the clip's sourceDurMs, so the timeline thinks the image can only be extended to 40 ms; and
     recordFilmFacts writes it back to the asset ledger, leaving "this jpg is 0.04 s long" on
     disk. Images have neither frame rate nor duration; not asking is correct. */
  for (const src of new Set(film.videos.map((v) => v.src).filter((s) => !filmSrcIsStill(s)))) {
    const facts = await known?.get(src);
    if (facts?.durMs != null && facts.durMs > 0) durBySrc.set(src, facts.durMs);
    if (facts?.fps != null && facts.fps > 0) rates.add(facts.fps);
    /* Probe if either duration or frame rate is missing: frame rate is best effort, duration is the limit for extending a clip on the timeline. */
    if (
      facts?.durMs == null || facts.durMs <= 0
      || facts.fps == null || facts.fps <= 0
    ) {
      missing.push(src);
    }
  }
  /* This tier is "better to know, fine without" — so bytes that can't be fetched are skipped, not
     reported. The difference from the sound tier is the consequence: a missing frame rate just
     means export falls back to the default, while a missing duration lays out the whole timeline
     wrong. */
  const found = await resolveAll(missing, resolve);
  for (const src of missing) {
    const abs = found.get(src);
    if (!abs) continue;
    const facts = await probe(abs).catch(() => null);
    if (!facts) continue;
    if (facts.fps != null && facts.fps > 0) rates.add(facts.fps);
    if (facts.durMs != null && facts.durMs > 0 && !durBySrc.has(src)) {
      durBySrc.set(src, facts.durMs);
    }
    await known?.put?.(src, facts).catch(() => undefined);
  }
  if (rates.size === 1) film.sourceFps = [...rates][0]!;
  for (const v of film.videos) {
    const fileDur = durBySrc.get(v.src);
    if (fileDur != null) v.sourceDurMs = fileDur;
  }
}

function assertStage(result: FilmEval): void {
  const s = result.stage;
  if (!s || !Number.isFinite(s.w) || !Number.isFinite(s.h) || s.w <= 0 || s.h <= 0) {
    throw new Error(
      'film.json needs `"stage": { "w": 1920, "h": 1080 }` — the stage is the one thing that cannot be worked out from the picture.',
    );
  }
}

/**
 * Errors have to point at the source.
 *
 * esbuild errors carry their own file and line, and are most useful passed through as-is; for
 * runtime errors the message must be kept — it is most likely one of the runtime's own messages
 * (a scene reported no duration, the root isn't a component), which were written for the reader.
 *
 * Runtime errors also include the stack frames **pointing at the workspace's own files**. With
 * hundreds of files in a film, `document is not defined` alone is as good as no report — the
 * reader would have to go through the files one by one. Frames from react-dom, the runtime and node
 * internals are all filtered out: they are the same every time, and none of them can be edited.
 */
function explain(error: unknown, workspace: string): string {
  const e = error as { errors?: { text: string; location?: { file: string; line: number } }[] };
  if (Array.isArray(e.errors) && e.errors.length) {
    return ['This film does not compile:', ...e.errors.slice(0, 8).map((x) => {
      const at = x.location ? `${x.location.file}:${x.location.line} ` : '';
      return `  ${at}${x.text}`;
    })].join('\n');
  }
  const msg = error instanceof Error ? error.message : String(error);
  /* An invalid doc (over-trimmed, duplicate id, wrong track) isn't "it crashed". The two messages
     point at different places: one sends the reader into the animation code, the other to the
     film doc — getting it wrong costs a whole round of searching the wrong file. Match on the
     prefix rather than the error type: these messages are thrown from two places, core's
     validation and the doc assembly, and what they share, stably, is the leading coordinate
     (`film.json …` / `tracks[0].clips[1]…`). */
  /* The doc's own validation (film-doc) already throws with a "film.json has N problems:"
     header; wrapping it again would stack two headers — this was called out in testing. Only add
     one to messages that don't have it yet. */
  if (/^film\.json /.test(msg)) return msg;
  if (/^tracks\[\d+\]/.test(msg)) return `film.json is not valid:\n  ${msg}`;
  const where = filmFrames(error, workspace);
  return [`This film broke while running:\n  ${msg}`, ...where].join('\n');
}

/** The stack frames inside the workspace, with workspace-relative paths. */
function filmFrames(error: unknown, workspace: string): string[] {
  const stack = error instanceof Error ? error.stack : null;
  if (!stack) return [];
  const prefix = workspace.endsWith('/') ? workspace : `${workspace}/`;
  const hits: string[] = [];
  for (const line of stack.split('\n').map((l) => l.trim())) {
    const at = /\(?((?:file:\/\/)?\/[^\s()]+):(\d+):\d+\)?$/.exec(line);
    if (!at) continue;
    /* Search for a substring rather than check a prefix: paths in the stack may carry macOS's
       `/private` prefix, and then startsWith would miss every frame — showing up as "there is a
       stack but not one frame is shown". */
    const i = at[1]!.indexOf(prefix);
    if (i < 0) continue;
    const fn = /^at\s+(?:async\s+)?(.+?)\s+\(/.exec(line)?.[1];
    hits.push(`  ${at[1]!.slice(i + prefix.length)}:${at[2]}${fn ? `  ${fn}` : ''}`);
    if (hits.length >= 6) break;
  }
  return hits.length ? ['  ↓ where the film called it (innermost first)', ...hits] : [];
}
