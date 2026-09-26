/**
 * Bundle `film.tsx` for the browser.
 *
 * This and the node build (evaluate.ts) are two outputs of the same source, differing in only two
 * ways: this one doesn't stub anything (p5 runs fine in a browser), and it **leaves react / gsap /
 * film-runtime outside, to be injected by the host**.
 *
 * Externalizing those is required because they must be singletons: two copies of React make hooks
 * throw immediately; two copies of gsap are sneakier — plugins register on one copy, the timeline
 * comes from the other, and it compiles, runs, and the plugins silently do nothing.
 *
 * Images are bundled as data URLs, so the capture page is one self-contained file that doesn't
 * depend on relative paths being fetchable.
 */

import { build, type Plugin } from 'esbuild';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { FILM_DOC_FILE, parseFilmDoc } from '@animspark/core';

import { LIB_PATHS, sharedDepsPlugin, stemFilmAliasPlugin } from '../shared-deps';
import type { MediaFactsStore, MediaResolver } from '../media-resolver';
import { FilmCliError } from '../workspace';

import { filmDocEntrySource } from './doc-entry';
import { filmRuntimeAssets, readAssetWordBook } from './asset-index';
import { collectDocMediaSec } from './doc-media';
import { projectRuntimePlugin } from './project-runtime';
import { readPublishedMgProjects } from './published-mg';
import type { FilmBuildSnapshot } from './evaluate';

/** The name the bundle hangs on window. The capture page takes the default component from it. */
export const FILM_GLOBAL = '__ANIM_FILM__';

export interface FilmBundle {
  code: string;
  /** Stylesheets the film imports (this is how font @font-face rules come in); the capture page inlines them as <style>. */
  css: string;
}

export interface FilmBundleOptions {
  liveDoc?: boolean;
  /** The exact document and immutable MG builds already used to collect audio. */
  snapshot?: FilmBuildSnapshot;
  /**
   * Rewrite the workspace's tsx files before bundling.
   *
   * Receives the file content and its **workspace-relative path** and returns the rewritten text —
   * affecting only this bundle; not one character of the source on disk changes. The live preview
   * uses it to inject source anchors (see filmSourceAnchors in the engine): double-clicking a line
   * of text on screen has to land on its source line, and this is the only source of that
   * information on that path.
   *
   * Rewrites must **not add or remove lines**: stack traces and `__loc` are line/column based, and
   * one extra line throws everything off.
   */
  rewrite?: (source: string, path: string) => string;
  /**
   * How long source clips are — asked from the **pointer metadata** instead of measuring bytes.
   *
   * Without it, durations can only be measured from the file in the workspace, and streamed media
   * has only a `.animptr` on disk (the master is in CAS). Then the `__media` baked into the bundle
   * lacks that entry, and rendering throws "no length for video" — **the whole film disappears**,
   * not just one clip.
   *
   * There is no other duration source on this path: `__media` is a literal baked into the glue,
   * and the browser can neither reach the bucket nor run ffprobe. So callers must pass it (on the
   * platform side, `workspaceMediaFacts`).
   */
  known?: MediaFactsStore;
  /** When the pointer has no duration either, use this to get a readable local path for ffprobe. */
  resolve?: MediaResolver;
}

/** Only the workspace's own tsx — dependencies and shared libraries aren't instrumented (the user didn't write them and can't click them). */
function rewritePlugin(workspace: string, rewrite: (source: string, path: string) => string): Plugin {
  /*
   * Compare real paths.
   *
   * esbuild gives resolved paths (the macOS temp dir is `/private/var/…` while the workspace passed
   * in reads `/var/…`; the same happens when the workspace sits under a symlink). Computing relative
   * paths from the unresolved one judges every file as outside the workspace, so nothing is
   * rewritten — and this failure is silent: in the UI it shows up as "double-clicking does
   * nothing", and tracing back from the UI never leads here.
   */
  let root = workspace;
  try {
    root = realpathSync(workspace);
  } catch {
    /* The directory is missing (the caller will report it); compare as-is — this layer shouldn't be the one to complain. */
  }
  return {
    name: 'film-rewrite',
    setup(build) {
      build.onLoad({ filter: /\.tsx$/ }, async (args) => {
        const path = relative(root, args.path);
        if (path.startsWith('..') || isAbsolute(path) || path.includes('node_modules')) return null;
        const source = await readFile(args.path, 'utf8');
        return { contents: rewrite(source, path), loader: 'tsx' as const };
      });
    },
  };
}

export async function compileFilmBrowser(
  workspace: string,
  options?: FilmBundleOptions,
): Promise<FilmBundle> {
  /* The doc has no module that can serve as the entry directly — the entry is freshly generated
     glue fed to esbuild on stdin, with resolveDir set to the workspace so relative specifiers
     such as `./mg/hook` resolve against it. */
  const doc = options?.snapshot?.doc ?? parseFilmDoc(await readFile(join(workspace, FILM_DOC_FILE), 'utf8'));
  const projects = options?.snapshot?.projects ?? readPublishedMgProjects(workspace);
  const media = await collectDocMediaSec(doc, {
    workspace,
    ...(options?.known ? { known: options.known } : {}),
    ...(options?.resolve ? { resolve: options.resolve } : {}),
  });
  const result = await build({
    stdin: {
      contents: filmDocEntrySource(doc, {
        resolvePath: (rel) => `./${rel}`,
        assets: filmRuntimeAssets(workspace),
        words: readAssetWordBook(workspace),
        media,
        projects,
        ...(options?.liveDoc ? { mode: 'runtime' as const } : {}),
      }),
      resolveDir: workspace,
      sourcefile: 'doc-root.js',
      loader: 'js' as const,
    },
    bundle: true,
    write: false,
    /* outdir is needed even with write:false — importing css produces two output files, and esbuild refuses without a directory name. */
    outdir: '.anim-bundle',
    format: 'iife',
    globalName: FILM_GLOBAL,
    platform: 'browser',
    target: ['chrome120', 'safari17'],
    jsx: 'automatic',
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.json': 'json' },
    /* url()s in font css are already workspace-relative (the capture page sits at the workspace
       root, so they resolve correctly once inlined); esbuild must leave them alone — resolving them
       against the css file's location would only fail. */
    external: ['*.woff2', '*.woff', '*.ttf', '*.otf'],
    plugins: [
      projectRuntimePlugin(workspace, true),
      sharedDepsPlugin(),
      stemFilmAliasPlugin(),
      ...(options?.rewrite ? [rewritePlugin(workspace, options.rewrite)] : []),
    ],
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: [...LIB_PATHS, join(workspace, 'node_modules')],
    logLevel: 'silent',
  }).catch((error: unknown) => {
    const e = error as { errors?: { text: string; location?: { file: string; line: number } }[] };
    if (Array.isArray(e.errors) && e.errors.length) {
      throw new FilmCliError(['This film does not compile:', ...e.errors.slice(0, 8).map((x) => {
        const at = x.location ? `${x.location.file}:${x.location.line} ` : '';
        return `  ${at}${x.text}`;
      })].join('\n'));
    }
    throw error;
  });
  const files = result.outputFiles ?? [];
  const code = files.filter((f) => f.path.endsWith('.js')).map((f) => f.text).join('\n');
  const css = files.filter((f) => f.path.endsWith('.css')).map((f) => f.text).join('\n');
  if (!code) throw new FilmCliError('This film compiled to nothing');
  return { code, css };
}
