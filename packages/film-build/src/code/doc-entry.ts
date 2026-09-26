/**
 * The bundle entry for the film doc — generates the glue that turns `film.json` into a component.
 *
 * The doc is plain data, imported directly through esbuild's json loader (both compile sides
 * already configure it). The real entry is this generated code: it imports the doc and the MG
 * modules it uses and hands them, together with the asset facts supplied by the host
 * (`filmRuntimeAssets`, inlined as a literal), to the runtime's `filmFromDoc`.
 *
 * The two edit-time paths (preview iframe, server-side evaluation) use `runtime` mode instead: the
 * doc isn't imported but read from a global. The reason is latency — baking the doc into the
 * bundle means "move a clip = new source = recompile the whole film", when moving a clip only
 * changes one number. See `FilmDocEntryMode`.
 *
 * **All three compiles share this one generator** (server-side evaluation, browser iframe, capture
 * page), because the entry is semantics: with three separate copies, which modules get bundled and
 * whether the ledger is passed would sooner or later diverge — and that kind of divergence shows up
 * as bugs like "the preview has sound, the export doesn't", found only by listening side by side.
 *
 * Asset facts aren't imported from the workspace: the ledger is jsonl (which esbuild doesn't
 * understand), and word timings and full transcripts live in private storage, so the host has to
 * hand them in anyway.
 */

import { filmAudioRoleOf, filmDocMgSrcs, filmDocScoreSrcs, FILM_DOC_FILE, type FilmDoc, type FilmWord } from '@animspark/core';

import type { FilmAssetIndex, FilmPreparedMgProject } from '@animspark/runtime';

/**
 * Where the doc comes from.
 *
 * `bake` (default): `import`ed and baked into the bundle once. Final renders use this — a
 * delivered film must carry its own doc and can't rely on someone putting something on a global
 * at runtime.
 *
 * `runtime`: read from `globalThis.__FILM_DOC__`. One bundle can serve different docs, so moving a
 * clip on the timeline only needs the new doc sent over and a re-render, not a recompile (one
 * compile takes hundreds of milliseconds to seconds). Used by the two **edit-time** paths: the
 * preview iframe and server-side evaluation.
 */
export type FilmDocEntryMode = 'bake' | 'runtime';

/** In runtime mode, the global name the doc hangs on. Both sides use this one string. */
export const FILM_DOC_GLOBAL = '__FILM_DOC__';

export interface FilmDocEntryOptions {
  /**
   * Workspace-relative path → an import specifier this compile understands.
   *
   * The server-side evaluation entry lives in a temp directory and needs absolute paths; the
   * browser bundle and the capture page are rooted at the workspace and need `./` relative paths.
   * What a specifier looks like is up to the compile environment; the semantics (what gets
   * imported) must not change.
   */
  resolvePath: (rel: string) => string;
  /** Asset facts (`filmRuntimeAssets`). Defaults to an empty table. */
  assets?: FilmAssetIndex;
  /** Private timing metadata supplied by the host, never imported from the workspace. */
  words?: Readonly<Record<string, readonly FilmWord[]>>;
  /** Durations (seconds) of source clips / direct-link audio. Probed before evaluation; used when a resolve has no `to`. */
  media?: Record<string, number>;
  /** Defaults to `bake`. */
  mode?: FilmDocEntryMode;
  projects?: Record<string, FilmPreparedMgProject>;
}

export function filmDocEntrySource(doc: FilmDoc, opts: FilmDocEntryOptions): string {
  const spec = (rel: string): string => JSON.stringify(opts.resolvePath(rel));
  const modules = filmDocMgSrcs(doc);
  const scores = filmDocScoreSrcs(doc);
  const media = opts.media ?? {};
  const live = opts.mode === 'runtime';
  return [
    `import { ${live ? 'filmFromLiveDoc' : 'filmFromDoc'}, filmAssetsWithWords, filmScoreAssets } from '@animspark/runtime';`,
    ...(live ? [] : [`import __doc from ${spec(FILM_DOC_FILE)};`]),
    ...modules.map((src, i) => `import __mg${i}, * as __mgNs${i} from ${spec(src)};`),
    ...scores.map((src, i) => `import __score${i} from ${spec(src)};`),
    `const __index = ${JSON.stringify(opts.assets ?? {})};`,
    `const __words = ${JSON.stringify(opts.words ?? {})};`,
    'const __assets = { ...filmAssetsWithWords(__index, __words), ...filmScoreAssets({',
    ...scores.map((src, i) => `  ${JSON.stringify(src)}: __score${i},`),
    '}) };',
    `const __media = ${JSON.stringify(media)};`,
    `const __projects = ${JSON.stringify(opts.projects ?? {})};`,
    live
      ? `const __film = filmFromLiveDoc(() => globalThis.${FILM_DOC_GLOBAL}, {`
      : 'const __film = filmFromDoc(__doc, {',
    ...modules.map((src, i) => `  ${JSON.stringify(src)}: Object.assign(__mg${i}, { duration: __mg${i}.duration ?? __mgNs${i}.durationSec, sounds: __mgNs${i}.sounds }),`),
    live ? '}, __assets, __media, {projects:__projects});' : '}, __assets, __media, __projects);',
    /* The stage size is baked in as a literal rather than read from the doc live: it is part of
       the **shape** (`filmDocShape` includes stage precisely for this line), so changing it
       requires a recompile anyway. This keeps the module off the global between import and first
       render — on the server one process has several projects open at once, and import is async. */
    live
      ? `export const stage = ${JSON.stringify(doc.stage)};`
      : 'export const stage = __film.stage;',
    /* The host prepares score sources; the same declarations drive every playback instance. */
    'export const mgSounds = {',
    ...modules.map((src, i) => `  ${JSON.stringify(src)}: __mgNs${i}.sounds,`),
    ...scores.map((src, i) => `  ${JSON.stringify(src)}: [{ kind: ${JSON.stringify(filmAudioRoleOf(src))}, score: __score${i} }],`),
    '};',
    'export default __film.Film;',
    '',
  ].join('\n');
}

/**
 * The entry used when the doc itself is broken (won't run, fails the schema): a module that
 * throws the validation error verbatim as soon as it executes. The browser path needs it — the
 * compile pipeline only accepts "give me an entry that compiles", and in this case the most useful
 * output is exactly that clip-by-clip error, which then travels through the existing error channel
 * (iframe postMessage) to the user.
 */
export function filmDocErrorEntry(message: string): string {
  return `throw new Error(${JSON.stringify(message)});\n`;
}
