/**
 * The shoot page for code-based films.
 *
 * Shares the browser driver (`withShot`) with the old path: its few dozen lines of "wait two frames,
 * then wait for every `<video>` to finish seeking" were learned the hard way and should not exist
 * twice. This layer only assembles the page: inject the shared deps, run the `film.tsx` output,
 * mount `FilmRoot`, and expose seek to playwright.
 *
 * No rAF runs in the page. We want the exact answer for "millisecond N"; letting it run and then
 * screenshotting captures N plus or minus a frame, and measuring that number precisely is the whole
 * point of the shoot page.
 */

import { overrideAnchorRewriteFor } from './override-anchors';
import {
  filmFrameBox,
  type FilmFrameFill,
  type FilmFrameId,
  type FilmSubtitleCue,
  type FilmSubtitleStyle,
} from '@animspark/core';
import { filmSubtitleText } from '@animspark/core/film';
import { compileFilmBrowser, gsapPluginSharedEntries, type FilmBuildSnapshot } from '@animspark/film-build';
import { fontLinksFor } from '../scene/font-library';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { workspaceMediaFacts, workspaceMediaResolver } from '../workspace-media';
import { STAGE_FONT_STACK } from './host-shared';
import { originTrialMetaTag } from './origin-trial';
import { ENGINE_ROOT } from '../package-root';
import { build } from 'esbuild';
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This package's root. react / gsap / @animspark/runtime resolve from here (see package-root). */
const PKG_ROOT = ENGINE_ROOT;

const CAP_DIVISOR = 22;

/** Page shell. `__ANIM_FILM__` is the film.tsx output; `__ANIM_MG_DEPS__` is the injected shared deps. */
const HOST_ENTRY = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { capturePreparedSurface } from './src/mg/browser-capture';
import * as filmRuntime from '@animspark/runtime';
import { filmSubtitleAt, filmSubtitleCss, filmSubtitleFontSizePx, filmSubtitleStyleFor, filmSubtitleText, filmSubtitleWordCss, filmSubtitleWords } from '@animspark/core/film';
import * as gsapNS from 'gsap';
import * as gsapAll from 'gsap/all';
import * as gsapReact from '@gsap/react';
import * as jsxRuntime from 'react/jsx-runtime';

/* Same as code-host: register only official plugins the timeline can seek; no scroll, pointer,
   debug or other-library bridge plugins. */
gsapNS.gsap.registerPlugin(
  gsapAll.DrawSVGPlugin, gsapAll.SplitText, gsapAll.MorphSVGPlugin, gsapAll.MotionPathPlugin,
  gsapAll.Physics2DPlugin, gsapAll.PhysicsPropsPlugin, gsapAll.ScrambleTextPlugin, gsapAll.Flip, gsapAll.TextPlugin,
  gsapAll.CustomEase, gsapAll.CustomBounce, gsapAll.CustomWiggle,
  gsapAll.RoughEase, gsapAll.SlowMo, gsapAll.ExpoScaleEase,
);

/* Same rule as code-host: hold the global timeline paused, so the picture follows only the time
   __filmSeek gives. The shoot page especially: real time passes between frame captures, and if the
   timeline ran, each capture would show "wherever it had got to when this frame was shot". */
gsapNS.gsap.globalTimeline.pause();

window.__ANIM_MG_DEPS__ = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react/jsx-dev-runtime': jsxRuntime,
  'react-dom': { createRoot },
  gsap: gsapNS,
  'gsap/all': gsapAll,
  ${gsapPluginSharedEntries('gsapAll')}
  '@gsap/react': { ...gsapReact, useGSAP: filmRuntime.createUseGSAPBridge(gsapReact.useGSAP, gsapNS.gsap) },
  '@animspark/runtime': filmRuntime,
};

const { FilmRoot, filmClipEnvelopeOnStage, filmClipPaintOnStage } = filmRuntime;
window.__filmCollect = () => {
  const Film = (window.__ANIM_FILM__ || {}).default;
  if (!Film) throw new Error('Film is not loaded.');
  return filmRuntime.collectFilm(React.createElement(Film), renderToStaticMarkup, window.__FILM_STAGE__);
};
/** The film's own canvas (the reference frame for all its internal coordinates). */
const stage = window.__FILM_STAGE__;
/**
 * Delivery frame: the outer box. Equals stage when no frame is applied.
 *
 * Captures grab #anim-stage, so **the outer frame carries that id**: the film is scaled to contain
 * and centered inside, with the leftover area black. Not a pixel inside the film changes: it renders
 * at its native size and is scaled as a whole.
 */
const frame = window.__FILM_FRAME__ || { w: stage.w, h: stage.h, inner: { w: stage.w, h: stage.h, left: 0, top: 0, scale: 1 } };
const durationMs = window.__FILM_DURATION__;
/* Burned-in subtitles. When not burning in, __FILM_SUBS__ is null and this layer doesn't exist. */
const subs = window.__FILM_SUBS__;

/**
 * The subtitle layer. Follows the same table as the preview layer (core's film-subtitle), so what
 * you see is what you get.
 *
 * The stage is in native pixels (e.g. 1920x1080), so percentages are multiplied straight into px
 * here. The preview layer uses container units because its size follows the window: two coordinate
 * systems, one set of numbers.
 */
function Subtitle({ timeMs }) {
  if (!subs) return null;
  const cue = filmSubtitleAt(subs.cues, timeMs);
  if (!cue) return null;
  /* Size and position are computed against the **outer frame**, not the film: subtitles are a layer
     over the delivery frame. In a 9:16 frame they sit at the bottom of the new picture (on the black
     bar) instead of being pushed to the middle along with the film.
     Apart from this (the coordinate system), everything comes from that one core function and
     matches the preview layer exactly. */
  const style = filmSubtitleStyleFor(subs.style, frame);
  const css = filmSubtitleCss(style, {
    fontSize: filmSubtitleFontSizePx(style, frame) + 'px',
  });
  return React.createElement(
    'div',
    { style: css.box },
    React.createElement(
      'span',
      { style: css.text },
      /* Per-word highlight: same split and same style as the preview layer (see core's filmSubtitleWords). */
      style.karaoke
        ? filmSubtitleWords(cue, timeMs).map((w, i) => (w.active
          ? React.createElement('span', { key: i, style: filmSubtitleWordCss(style) }, w.text)
          : w.text))
        : filmSubtitleText(cue),
    ),
  );
}

function Shot() {
  const [state, setState] = React.useState({ timeMs: 0, label: '' });
  React.useEffect(() => {
    window.__filmSeek = (ms, label) => { setState({ timeMs: ms, label: label || '' }); };
    window.__filmReady = true;
  }, []);
  const Film = (window.__ANIM_FILM__ || {}).default;
  const capH = state.label ? Math.round(frame.w / ${CAP_DIVISOR}) : 0;
  return React.createElement('div', { id: 'anim-shot', style: { width: frame.w, background: '#111' } }, [
    React.createElement('div', {
      key: 'stage',
      id: 'anim-stage',
      style: { position: 'relative', width: frame.w, height: frame.h, overflow: 'hidden', background: '#000' },
    }, [
      /* The film renders at native size and is scaled as a whole into the outer frame, so its
         layout doesn't move a pixel. Shrinking the container instead would misplace every px the
         film hard-codes against stage. */
      Film
        ? React.createElement('div', {
          key: 'film',
          id: 'anim-film',
          style: {
            position: 'absolute',
            left: frame.inner.left,
            top: frame.inner.top,
            width: stage.w,
            height: stage.h,
            transformOrigin: 'top left',
            transform: 'scale(' + frame.inner.scale + ')',
            overflow: 'hidden',
          },
        }, React.createElement(FilmRoot, {
          timeMs: state.timeMs, durationMs, playing: false,
          stage: stage,
        }, React.createElement(Film)))
        : null,
      /* Subtitles sit on the **outer frame**, not the film: they are a layer over the delivery frame. */
      React.createElement(Subtitle, { key: 'subs', timeMs: state.timeMs }),
    ]),
    state.label ? React.createElement('div', {
      key: 'cap',
      style: {
        height: capH,
        lineHeight: capH + 'px',
        font: '600 ' + Math.round(capH * 0.62) + 'px ui-monospace, SFMono-Regular, Menlo, monospace',
        color: '#fff',
        background: '#111',
        paddingLeft: Math.round(capH * 0.4),
        letterSpacing: '0.02em',
      },
    }, state.label) : null,
  ]);
}

/* Mounting waits until the film output has loaded. The output is in the next script tag, so
   window.__ANIM_FILM__ doesn't exist yet; rendering now would get undefined and leave the page blank
   forever, with no error at all. */
window.__filmMount = () => {
  /* The shoot page captures frame by frame rather than playing continuously: turn off the realtime
     throttling of pack raster backends (mpl and the like) so every frame is a pure function of the
     current time. The hook is installed by the pack module in the film output (see scene-engine
     react/pack), which has already run by now; films without pack components have no hook, hence
     the optional call. */
  if (window.__animSetSeekExact) window.__animSetSeekExact(true);
  createRoot(document.getElementById('root')).render(React.createElement(Shot));
};
window.__filmCapture = (options) => capturePreparedSurface(document.getElementById('anim-stage'), options?.width);

function clipOnStage(id) {
  const root = document.getElementById('anim-stage');
  if (!root || !id) return null;
  const all = root.querySelectorAll('[data-film-clip-id]');
  let clip = null;
  for (let i = 0; i < all.length; i++) {
    if (all[i].getAttribute('data-film-clip-id') === id) clip = all[i];
  }
  if (!clip) return null;
  const canvas = window.__FILM_STAGE__ || { w: root.offsetWidth, h: root.offsetHeight };
  return { root: root, clip: clip, canvas: canvas };
}

window.__filmClipPaint = (id) => {
  const at = clipOnStage(id);
  return at ? filmClipPaintOnStage(at.clip, at.canvas) : null;
};

/* How far this clip paints right now (transforms included). The crop box belongs to
   __filmClipPaint, which measures layout and is the same width every frame; this one measures the
   rendered rect and answers exactly "does the animation run outside the crop box". See the two
   rulers in the runtime for the split.

   The preview host has a pair with the same names (see code-host). Each page has its own copy
   because the mount shells differ, but **the interfaces must match**: probes and the CLI use the
   shoot page, export uses the preview host, and missing one side means only one side can measure. */
window.__filmClipEnvelope = (id) => {
  const at = clipOnStage(id);
  return at ? filmClipEnvelopeOnStage(at.clip, at.root, at.canvas) : null;
};
`;

let hostScript: Promise<string> | null = null;

/**
 * The page script has no workspace content, so it is built once per process. The look/render
 * page and the preview share this host bundle, so both go through one rendering path.
 *
 * `minify` keeps the bundle small; `legalComments: 'eof'` keeps third-party license banners
 * (GSAP's `/*!` banner among them) at the end of the output, as their licenses require.
 */
export function bundleHost(): Promise<string> {
  hostScript ??= build({
    stdin: { contents: HOST_ENTRY, resolveDir: PKG_ROOT, loader: 'js' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    legalComments: 'eof',
    logLevel: 'silent',
  }).then((r) => r.outputFiles?.[0]?.text ?? '').catch((e: unknown) => {
    hostScript = null;
    throw e;
  });
  return hostScript;
}

/**
 * Write the shoot page.
 *
 * Order matters: the shared deps must be on window before the film output, which reads
 * `__ANIM_MG_DEPS__` right at the start. Attached too late, it gets undefined and reports "Cannot
 * read properties of undefined" with a stack pointing at the film's first line, one step removed
 * from the real cause.
 */
export async function writeCodeShotPage(
  workspace: string,
  stage: { w: number; h: number },
  durationMs: number,
  /**
   * Subtitles to burn in. Omit to skip burning in; subtitles can still be delivered as an SRT
   * sidecar for the player to lay out.
   */
  subtitles?: { cues: readonly FilmSubtitleCue[]; style: FilmSubtitleStyle } | null,
  /** Delivery frame. Defaults to native (outer frame equals the film). */
  frame: FilmFrameId = 'native',
  fill: FilmFrameFill = 'contain',
  snapshot?: FilmBuildSnapshot,
  options: { liveDoc?: boolean } = {},
): Promise<string> {
  /* Durations must come along (see FilmBundleOptions.known). When a source is only a pointer, this
     page can't even start without them: `anim look` reports "shoot page failed to start: no length
     for video ...", while the file sits right there in the asset table with its duration listed, so
     the most likely-looking explanation (a wrong path) is exactly the wrong one. */
  const [host, film] = await Promise.all([
    bundleHost(),
    compileFilmBrowser(workspace, {
      snapshot,
      liveDoc: options.liveDoc,
      known: workspaceMediaFacts(workspace),
      resolve: workspaceMediaResolver(workspace),
      /* For films with overrides, shooting / export must also recognize the layer each override targets
         (see override-anchors). */
      rewrite: overrideAnchorRewriteFor(workspace, snapshot?.doc),
    }),
  ]);
  const subs = subtitles?.cues.length && subtitles.style.on ? subtitles : null;
  const box = filmFrameBox(stage, frame, fill);
  /* Font-library families are linked by the names that appear in source, with the same corpus and
     stylesheets as the playback bundle (pack-playback), so look, export and the user's preview get
     the same type. Subtitle family and text aren't in the compiled output, so they are fed in
     separately. */
  const subtitleCorpus = subs ? `${subs.style.font.family}\n${subs.cues.map((c) => filmSubtitleText(c)).join('\n')}` : '';
  const fontLinks = fontLinksFor(`${film.code}\n${film.css ?? ''}\n${subtitleCorpus}`)
    .map((font) => `<link rel="stylesheet" href="${font.href.replace(/"/g, '&quot;')}">`).join('\n');
  const html = `<!doctype html><meta charset="utf-8">
${originTrialMetaTag()}<style>html,body{margin:0;background:#000;overflow:hidden;font-family:${STAGE_FONT_STACK}}#root{width:${box.w}px}</style>
${fontLinks ? `${fontLinks}\n` : ''}${film.css ? `<style>${film.css}</style>\n` : ''}<div id="root"></div>
<script>window.__FILM_DOC__=${JSON.stringify(snapshot?.doc ?? JSON.parse(readFileSync(join(workspace, 'film.json'), 'utf8')))};window.__FILM_STAGE__=${JSON.stringify(stage)};window.__FILM_FRAME__=${JSON.stringify(box)};window.__FILM_DURATION__=${durationMs};window.__FILM_SUBS__=${JSON.stringify(subs)};window.__FILM_ERRORS__=[];</script>
<script>${host}</script>
<script>${film.code}</script>
<script>window.__filmMount()</script>
`;
  // An export may outlive an edit. Its page must not be overwritten by a newer
  // preview compiled in the same workspace while Chromium is opening it.
  // The name also carries randomness: two looks of the same content each open and delete their own
  // page, and never delete the one the other is about to open.
  const out = join(workspace, snapshot ? `.anim-look-${createHash('sha256').update(html).update(randomUUID()).digest('hex').slice(0, 20)}.html` : '.anim-look.html');
  writeFileSync(out, html, 'utf8');
  if (snapshot) { sweepStaleShotPages(workspace, out); trackShotPage(out); }
  return out;
}

/* Every hashed page this process wrote. Callers dispose a page as soon as its frames are taken; whatever is
   left (a render that threw, an interrupted command) is removed when the process exits, so no
   `.anim-look-*.html` is left in the workspace. */
const livePages = new Set<string>();
let exitHook = false;
function trackShotPage(page: string): void {
  livePages.add(page);
  if (exitHook) return;
  exitHook = true;
  process.once('exit', () => { for (const p of livePages) { try { rmSync(p, { force: true }); } catch { /* gone */ } } });
}

/**
 * Clean up after use. A shoot page is 1-2 MB and sits at the root of the user's project folder; an
 * external agent looks dozens of times per session, which shows up as a row of files in Finder
 * (with hidden files shown). Only hash-named pages are removed; `.anim-look.html` is a fixed name
 * that gets overwritten, kept for debugging.
 */
export function disposeShotPage(page: string): void {
  if (!SHOT_PAGE_NAME.test(basename(page))) return;
  livePages.delete(page);
  try { rmSync(page, { force: true }); } catch { /* the next sweep gets it */ }
}

/** Hash-named shoot pages older than this are swept (those that never reached disposeShotPage, e.g.
 * the process was killed midway). Export and look open their pages within minutes; an hour is ample. */
const SHOT_PAGE_TTL_MS = 60 * 60_000;
const SHOT_PAGE_NAME = /^\.anim-look-[0-9a-f]{20}\.html$/;

/**
 * Sweep expired shoot pages.
 *
 * Every `look` / `check` / export writes a page named by content hash (~1 MB) without overwriting
 * old ones, for the reason in the comment above. Nothing used to clean them up: an external agent
 * looks dozens of times per session, leaving tens of MB of `.anim-look-*.html` at the project root,
 * visible to the user in Finder. Only deletes pages **in this workspace**, with this name, older than
 * the TTL; the page just written and pages others are using are left alone.
 */
function sweepStaleShotPages(workspace: string, keep: string): void {
  let names: string[];
  try {
    names = readdirSync(workspace);
  } catch {
    return;
  }
  const deadline = Date.now() - SHOT_PAGE_TTL_MS;
  for (const name of names) {
    if (!SHOT_PAGE_NAME.test(name)) continue;
    const path = join(workspace, name);
    if (path === keep) continue;
    try {
      if (statSync(path).mtimeMs < deadline) rmSync(path, { force: true });
    } catch { /* being read or already gone: try next time */ }
  }
}
