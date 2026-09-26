/**
 * The film's host page in the browser: this is the page the product plays (inside an iframe).
 *
 * Same foundation as the shoot page (code-shoot), with just three differences, each specific to
 * the product:
 *   1. `<base>`: films use workspace-relative paths (`assets/upload/x.mp4`). The shoot page lives in
 *      the workspace, so relative paths just work; this page is on the app's origin, and without a
 *      base every asset would hit the app itself and 404. With it, even a hand-written
 *      `<img src="assets/x.png">` in the film resolves.
 *   2. The clock is outside: play/pause/scrubbing is owned by the outer app (audio lives there, and
 *      audio is the master clock). This page only listens to `postMessage` and runs no rAF of its
 *      own. Whoever renders the final output (export) also wants an acknowledgement: it has to know
 *      a moment is **fully painted** before capturing, and it can't see that from another document.
 *   3. Errors must be sent out: the outer page can't see exceptions inside the iframe, and without
 *      forwarding, the picture goes white with no clue why.
 *
 * Why an iframe at all: the film output needs its own React/gsap singletons, isolated from the
 * app's; two Reacts on one page make hooks throw outright.
 *
 * **Compilation happens in this page.** The server only syncs workspace source (`/film/code`).
 * Public JS libraries come from `/api/film-vendor` (three / p5); TS source packages (like
 * @animspark/data) are bundled into the host script because they have no single-file build the
 * browser can load directly.
 */

import { build, transformSync } from 'esbuild';
import { gsapPluginSharedEntries } from '@animspark/film-build';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATHJAX_SPECS, STAGE_FONT_STACK, hostSharedMap } from './host-shared';
import { originTrialMetaTag } from './origin-trial';
import { ENGINE_ROOT } from '../package-root';
import { vendorPkgVersion } from './vendor-version';

const here = dirname(fileURLToPath(import.meta.url));
/** This package's root. react / gsap / @animspark/runtime resolve from here (see package-root). */
const PKG_ROOT = ENGINE_ROOT;

/**
 * Page script.
 *
 * Time still comes from outside; this page runs no rAF of its own. `playing` only tells the film's
 * `<video>` elements: while playing, let the decoder run ahead on its own; while stopped, pin to this
 * millisecond. Audio is in the outer page, and gsap may not advance on its own either: if it did, the
 * two clocks would drift apart, which looks like "audio and picture slipping further and further".
 */
const HOST_ENTRY = `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
/* We want a canvas, not a blob: first check whether the capture is solid black (see looksBlack),
   then convert to bytes. */
import { toCanvas as captureStage } from 'html-to-image';
import { inlinePreparedSurfaces } from './src/mg/browser-capture';
import { settleStageFonts, stageFontEmbedCSS } from './src/film/client-fonts';
import * as filmRuntime from '@animspark/runtime';
/* Thumbnail crop geometry is shared with the stamping side; see filmClipPaintOnStage. */
import { filmClipEnvelopeOnStage, filmClipPaintOnStage } from '@animspark/runtime';
import * as filmStem from '@animspark/stem/film';
import * as musparkCore from '@muspark/core';
import * as musparkUi from '@muspark/ui';
import * as musparkUiReact from '@muspark/ui/react';
import * as gsapNS from 'gsap';
import * as gsapAll from 'gsap/all';
import * as gsapReact from '@gsap/react';
import * as jsxRuntime from 'react/jsx-runtime';

/* All official plugins have been free since 2025-04 and ship in gsap/all. Register only those the
 * timeline can seek: eases (CustomEase/Bounce/Wiggle + EasePack's SlowMo/ExpoScaleEase/RoughEase),
 * SVG (DrawSVG/MorphSVG/MotionPath), physics (Physics2D/PhysicsProps), text
 * (Text/ScrambleText/SplitText), Flip.
 * Scroll/pointer/debug/other-library bridges (ScrollTrigger/ScrollSmoother/ScrollTo/Draggable/
 * Observer/Inertia/GSDevTools/MotionPathHelper/Pixi/Easel) don't fit the host clock and are not
 * registered: if they were, the first time an agent used one there would be a second clock.
 * RoughEase defaults to Math.random(), so export can't guarantee the same frame gives the same
 * picture; treat it with the same caution as ScrambleText. */
gsapNS.gsap.registerPlugin(
  gsapAll.DrawSVGPlugin, gsapAll.SplitText, gsapAll.MorphSVGPlugin, gsapAll.MotionPathPlugin,
  gsapAll.Physics2DPlugin, gsapAll.PhysicsPropsPlugin, gsapAll.ScrambleTextPlugin, gsapAll.Flip, gsapAll.TextPlugin,
  gsapAll.CustomEase, gsapAll.CustomBounce, gsapAll.CustomWiggle,
  gsapAll.RoughEase, gsapAll.SlowMo, gsapAll.ExpoScaleEase,
);

/* The host owns the clock. The runtime connects the official useGSAP context to the clip's local
   time, so preview pause, scrubbing and frame-by-frame export share one state and don't advance
   with the real time that passes between captures. */
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
  /* TS source packages are bundled with the host rather than served from /film-vendor, which needs
     single-file builds the browser can load directly (three / p5). Missing one shows up as anim look
     all green, product preview blank, and a 404 in the console. */
  /* Keys are bare names, values are film entries, pointing at the same module as film-build's
     stemFilmAliasPlugin; the three render paths must not diverge (see there for why). */
  '@animspark/stem': filmStem,
  '@muspark/core': musparkCore,
  '@muspark/ui': musparkUi,
  '@muspark/ui/react': musparkUiReact,
};

const { FilmRoot, collectFilm } = filmRuntime;

window.__filmCollect = () => {
  const Film = (window.__ANIM_FILM__ || {}).default;
  if (!Film) return null;
  const summary = collectFilm(React.createElement(Film), renderToStaticMarkup, window.__FILM_STAGE__);
  const mod = window.__ANIM_FILM__ || {};
  return Object.assign({}, summary, {
    stage: mod.stage || window.__FILM_STAGE__,
  });
};

/* Forward errors to the outer page. One slip in a film means a white screen, and nobody reads the
   iframe's console. */
const post = (msg) => { try { parent.postMessage(msg, '*'); } catch {} };
window.addEventListener('error', (e) => post({
  source: 'anim-film', type: 'error', message: String(e.message || e.error || 'error'),
}));
window.addEventListener('unhandledrejection', (e) => post({
  source: 'anim-film', type: 'error', message: String((e.reason && e.reason.message) || e.reason || 'rejection'),
}));

/* Pick font subsets by stage text instead of downloading whole CJK fonts. Hidden titles that appear
   later are preloaded too. */
const kickFonts = () => { void settleStageFonts(document.getElementById('stage')).catch(() => {}); };
const fontsIn = (done) => {
  void settleStageFonts(document.getElementById('stage')).then(done, done);
};
window.__filmFontsKick = kickFonts;
window.__filmFontsIn = fontsIn;

function Host(props) {
  const [timeMs, setTimeMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [ack, setAck] = React.useState(0);
  const [durationMs, setDurationMs] = React.useState(() => props.boot || window.__FILM_DURATION__ || 0);
  /* A doc with a few numbers changed. **Re-render, don't remount**: __filmMount changes the key and
     throws the whole tree away (videos re-decode, gsap timelines rebuild), and moving one clip
     shouldn't cost that. Each clip's key is its position in the doc, so React recognizes it as the
     same clip. */
  const [docRev, bumpDoc] = React.useState(0);
  React.useEffect(() => {
    const onMessage = (e) => {
      const data = e.data;
      if (!data || data.source !== 'anim-host') return;
      if (data.type !== 'seek') return;
      setTimeMs(data.timeMs || 0);
      setPlaying(Boolean(data.playing));
      if (typeof data.durationMs === 'number' && data.durationMs > 0) setDurationMs(data.durationMs);
      if (data.ack) setAck(data.ack);
    };
    window.addEventListener('message', onMessage);
    window.__filmSeek = (ms) => { setTimeMs(ms || 0); };
    window.__filmDoc = (doc) => {
      if (doc) window.__FILM_DOC__ = doc;
      bumpDoc((n) => n + 1);
    };
    /* Send ready only once fonts settle (see fontsIn above). By then the tree may have been replaced
       by a newer version: a full rebuild remounts, that ready belongs to the new tree, and this
       pending one must not send it on the new tree's behalf. */
    let live = true;
    fontsIn(() => {
      if (live) post({ source: 'anim-film', type: 'ready', durationMs: durationMs });
    });
    return () => { live = false; window.removeEventListener('message', onMessage); };
  }, []);

  React.useLayoutEffect(() => {
    if (!ack) return undefined;
    let cancelled = false;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(async () => {
        const start = Date.now();
        while (!cancelled && window.__filmPending?.size) {
          if (Date.now() - start > 120000) { post({source:'anim-film',type:'error',message:'MG frame did not settle'}); return; }
          await Promise.race([Promise.allSettled([...window.__filmPending]),new Promise(resolve=>setTimeout(resolve,1000))]);
        }
        if (!cancelled) await settleStageFonts(document.getElementById('stage'));
        if (!cancelled) post({ source: 'anim-film', type: 'seeked', timeMs, ack });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [ack]);

  const Film = (window.__ANIM_FILM__ || {}).default;
  /* The film element is recreated only when the version or the doc changes. The outer page pushes a
     seek every frame, and each one used to createElement(Film) anew, re-rendering Film and every clip
     under it, even clips not on screen at that moment. Time flows through TimeContext, so the clips
     that actually need it still update every frame. */
  const filmEl = React.useMemo(() => (Film ? React.createElement(Film) : null), [Film, docRev]);
  if (!Film) return null;
  return React.createElement(FilmRoot, {
    timeMs, durationMs, playing,
    stage: window.__FILM_STAGE__,
    honorHide: new URLSearchParams(location.search).get('shot') !== '1',
  }, filmEl);
}

const fit = () => {
  const el = document.getElementById('stage');
  const stage = window.__FILM_STAGE__ || { w: 1920, h: 1080 };
  if (!el) return;
  const scale = Math.min(window.innerWidth / stage.w, window.innerHeight / stage.h);
  el.style.width = stage.w + 'px';
  el.style.height = stage.h + 'px';
  el.style.setProperty('--film-w', stage.w + 'px');
  el.style.setProperty('--film-h', stage.h + 'px');
  el.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
};
window.addEventListener('resize', fit);
window.__filmFit = fit;

/**
 * Capture #stage inside this page. When the outer page runs html-to-image on nodes in the iframe, it
 * uses the outer window and can't compute styles, and WebGL canvases come out empty, so the whole
 * timeline's thumbnails were solid color blocks.
 *
 * First turn canvases into imgs (2D canvases have pixels via toDataURL; WebGL needs
 * preserveDrawingBuffer, and the shared-GL path blits to 2D), then run html-to-image in the iframe's
 * own realm.
 */
function inlineCanvases(root) {
  const restores = [];
  root.querySelectorAll('canvas').forEach((canvas) => {
    try {
      const url = canvas.toDataURL('image/png');
      if (!url || url === 'data:,') return;
      const img = canvas.ownerDocument.createElement('img');
      img.src = url;
      const win = canvas.ownerDocument.defaultView;
      const style = win ? win.getComputedStyle(canvas) : null;
      img.style.cssText = canvas.style.cssText;
      if (style) {
        img.style.width = style.width;
        img.style.height = style.height;
        img.style.position = style.position;
        img.style.left = style.left;
        img.style.top = style.top;
      }
      canvas.replaceWith(img);
      restores.push(() => { img.replaceWith(canvas); });
    } catch (e) { /* tainted */ }
  });
  return () => { restores.reverse().forEach((fn) => fn()); };
}

/**
 * When html-to-image serializes the DOM, <video> is empty: the current frame's pixels aren't in the
 * DOM. Left alone, thumbnails of footage clips on the timeline are solid black. So before capturing,
 * drawImage each video's current frame into an <img> stand-in, and swap back afterwards. Footage is
 * same-origin with the page (/film/file), so the canvas isn't tainted.
 */
/*
 * Only replace **visible** videos inside **the clip being captured this time**; stand-ins are drawn at
 * the final output size, not the source's native size.
 *
 * This used to draw every video on stage at native resolution (1080p/4K) and synchronously encode it
 * to PNG, including neighbors already hidden for isolated capture and the one mounted invisibly in
 * the warm-up window. For a 160px-wide thumbnail, the main thread first encoded several multi-MB
 * PNGs, then had html-to-image serialize them into SVG, decode them back, and finally scale to 0.08x.
 * That ran on the same main thread as the editor: most of the jank when dragging or zooming after
 * importing video came from here.
 * scale caps the stand-in's size relative to the source; lossless is for transparent export (which
 * needs lossless output, possibly with alpha).
 */
function inlineVideos(root, scale, lossless) {
  const restores = [];
  root.querySelectorAll('video').forEach((video) => {
    try {
      if (video.readyState < 2 || !video.videoWidth) return;
      const view = video.ownerDocument.defaultView;
      const shown = view ? view.getComputedStyle(video) : null;
      if (shown && (shown.visibility === 'hidden' || shown.display === 'none')) return;
      const k = Math.min(1, Math.max(0.05, scale || 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(video.videoWidth * k));
      c.height = Math.max(1, Math.round(video.videoHeight * k));
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      const url = lossless ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
      if (!url || url === 'data:,') return;
      const img = document.createElement('img');
      img.src = url;
      const win = video.ownerDocument.defaultView;
      const style = win ? win.getComputedStyle(video) : null;
      img.style.cssText = video.style.cssText;
      if (style) {
        img.style.width = style.width;
        img.style.height = style.height;
        img.style.position = style.position;
        img.style.left = style.left;
        img.style.top = style.top;
        img.style.objectFit = style.objectFit;
        img.style.transform = style.transform;
      }
      video.replaceWith(img);
      restores.push(() => { img.replaceWith(video); });
    } catch (e) { /* tainted */ }
  });
  return () => { restores.reverse().forEach((fn) => fn()); };
}

/**
 * Wait for the videos in root to decode the frame for this millisecond. The seek ack only waits two
 * rAFs, and the decoder often hasn't caught up, so drawImage at that moment gets the previous frame
 * (a black frame on cold start). Polls rather than listening for events: the order of seeked and
 * canplay varies by implementation, and all we care about is "ready yet?".
 *
 * root is **the clip being captured**, not the whole stage (see __filmCapture): waiting on the whole
 * stage means one source still being transcoded to a proxy can take down every other clip's image at
 * the same moment.
 *
 * Returns whether all are ready. If not, don't capture: a black frame would be cached as this
 * frame's permanent look, whereas returning nothing ('not-ready') only leaves one image missing this
 * round, and the capturing side retries a second later on its own (see strikeout in useThumbs).
 */
async function settleVideos(root, timeoutMs) {
  const pending = Array.prototype.slice.call(root.querySelectorAll('video'));
  /* currentSrc is still an empty string right after mount (resource selection is async), so
     checking only it would mistake "loading" for "nothing to wait for". The src attribute is
     synchronous, so use it to cover cold start. */
  const srcOf = (v) => v.currentSrc || v.src || (v.querySelector('source') ? 's' : '');
  /*
   * This video has already **errored**: unreachable, undecodable, wrong path. Waiting is pointless:
   * its readyState stays 0, so every cell would wait out the full timeout.
   *
   * The point isn't saving time as such but letting retries actually cycle: 4 s wasted per cell is
   * 8 s for a two-cell clip, and the layer above starts from a different cell each round (see
   * rotateByClip in useThumbs). The slower each round, the longer a full cycle takes, and the user
   * sees "thumbnails are always incomplete and never fill in". Giving up immediately finishes the
   * cycle in tens of ms.
   *
   * Note that useVideoReload retries load() repeatedly with backoff (see media.tsx), and each load()
   * clears error and resets readyState to zero, so "already errored" here is only a fact about **this
   * moment**, not a final verdict. When it does recover, the next round will wait for it naturally.
   */
  const broken = () => pending.some((v) => srcOf(v) && v.error);
  const unsettled = () => pending.some((v) => srcOf(v)
    && (v.seeking || v.readyState < 2 || !v.videoWidth));
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && unsettled() && !broken()) {
    await new Promise((r) => setTimeout(r, 40));
  }
  return !unsettled();
}

/** The clip on stage with this name. Scans instead of using a selector: clip names are user-chosen
 * and can't safely go into a CSS selector. */
function clipNode(stage, only) {
  const all = stage.querySelectorAll('[data-film-clip-id]');
  for (let i = 0; i < all.length; i++) {
    if (all[i].getAttribute('data-film-clip-id') === only) return all[i];
  }
  return null;
}

/**
 * Keep only this clip on stage and hide the rest; returns a function that puts them back.
 *
 * A clip's thumbnail on the timeline should look like **this clip**. Capturing the whole stage made
 * all clips on screen at the same moment share one composite, so placing footage under some MG
 * changed all those MG thumbnails, though the user never touched them. Only sibling clips are
 * hidden and the background stays, so with a single clip on stage the result is identical to before.
 *
 * Relationship is by node, not by name: the kept clip stays along with its ancestors and descendants
 * (film within a film), everything else is hidden. Comparing by name would need a separate rule for
 * nesting, and getting it wrong shows up as an all-black stage.
 *
 * Uses visibility, not display: display removes a not-yet-decoded <video> from layout and it has to
 * restart playback when it comes back; visibility just skips painting.
 */
function isolateClip(stage, keep) {
  const restores = [];
  stage.querySelectorAll('[data-film-clip-id]').forEach((el) => {
    if (el === keep || el.contains(keep) || keep.contains(el)) return;
    const before = el.style.visibility;
    el.style.visibility = 'hidden';
    /* Mark them: these whole clips are left out of the clone at capture time (see the filter in
       __filmCapture). They are all absolutely positioned wrappers, so dropping them doesn't affect
       anyone else's layout; kept, html-to-image would read styles node by node through each tree. */
    el.setAttribute('data-film-isolated', '');
    restores.push(() => { el.style.visibility = before; el.removeAttribute('data-film-isolated'); });
  });
  return () => { restores.reverse().forEach((fn) => fn()); };
}

/**
 * Which region of the canvas this clip paints; used to crop thumbnails and single-clip exports. The
 * geometry lives in the runtime (filmClipPaintOnStage); this layer only hands over the wrapper.
 *
 * ## Why thumbnails must be cropped
 *
 * Per the manual, an MG module "sets its own width/height on the root node, then uses left/top to
 * place itself on the canvas", so a 700x140 card covers only 4% of 1920x1080. Thumbnails used to
 * capture **the whole canvas**, so every cell in the library was "a big black field with a speck in
 * the top-left", with no way to tell what the clip was. The smaller the thumbnail, the blurrier, and
 * the asset library is exactly where modules most need to be recognizable.
 *
 * ## It doesn't measure the wrapper's own offsetWidth
 *
 * For an MG without a transform, the wrapper is inset:0 across the canvas and offsetWidth is the full
 * width. The real module size is on data-film-box (see filmClipPaintOnStage in the runtime). Only
 * when the wrapper has already been shrunk to the clip (footage with contain, translate/scale
 * applied) is its layout box that region.
 *
 * (This whole section lives inside the HOST_ENTRY template string: no backticks allowed in comments,
 * they would cut the string short on the spot. The symptom is a host script that won't build and a
 * blank project page.)
 */
function paintedCrop(clip, stageW, stageH) {
  return filmClipPaintOnStage(clip, { w: stageW, h: stageH });
}

window.__filmClipPaint = function (id) {
  const stage = document.getElementById('stage');
  if (!stage || !id) return null;
  const clip = clipNode(stage, id);
  if (!clip) return null;
  const w = stage.offsetWidth || (window.__FILM_STAGE__ || {}).w || 1920;
  const h = stage.offsetHeight || (window.__FILM_STAGE__ || {}).h || 1080;
  return filmClipPaintOnStage(clip, { w: w, h: h });
};

/*
 * How far this clip paints right now (transforms included). The crop box belongs to
 * __filmClipPaint, which measures layout and is the same width every frame; this one measures the
 * rendered rect and answers exactly "does the animation run outside the crop box".
 *
 * Answers for this moment only. For an animation's range, the outer page samples several points on
 * the timeline and takes the union: a single frame can't tell "always here" from "just passing
 * through". Rationale and division of labor are at filmClipEnvelopeOnStage.
 */
window.__filmClipEnvelope = function (id) {
  const stage = document.getElementById('stage');
  if (!stage || !id) return null;
  const clip = clipNode(stage, id);
  if (!clip) return null;
  const w = stage.offsetWidth || (window.__FILM_STAGE__ || {}).w || 1920;
  const h = stage.offsetHeight || (window.__FILM_STAGE__ || {}).h || 1080;
  return filmClipEnvelopeOnStage(clip, stage, { w: w, h: h });
};


/** Cut one region out of the captured image. p is the pixelRatio used for the capture. */
function cutOut(shot, box, p) {
  const w = Math.max(1, Math.round(box.w * p));
  const h = Math.max(1, Math.round(box.h * p));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { alpha: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(shot, Math.round(box.x * p), Math.round(box.y * p), w, h, 0, 0, w, h);
  return out;
}

/**
 * Whether the capture is a nearly solid black block.
 *
 * **Only guards clips containing footage** (the caller checks for a video in the subtree): footage
 * can still yield a black frame after passing the settle gate (drawImage hitting a decode gap), and
 * once handed over, a black frame is stored as that cell's permanent look. Pure-DOM clips (MG) skip
 * this gate: if one paints black at millisecond t, that is its true look at t. By convention an MG's
 * initial entrance state is "not yet visible" (see seekBuilt in film-runtime), so its first frame or
 * two are legitimately black and storing them is correct. This once flagged black regardless of clip
 * type: MG opening frames counted as "capture failed", the capturing side followed its "consecutive
 * failures mean the clip is broken" rule and skipped the remaining cells, and the whole filmstrip
 * never produced a single cell again.
 *
 * Only black counts: solid white or solid brand color are legitimate pictures (color cards, blank
 * openings) and are kept. Footage that genuinely fades to full black leaves those cells empty, and on
 * the timeline empty and black look identical.
 */
function looksBlack(canvas) {
  try {
    const w = Math.min(24, canvas.width);
    const h = Math.min(24, canvas.height);
    if (!(w > 0 && h > 0)) return true;
    const probe = document.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < data.length; i += 4) {
      /* Transparent counts as black: the timeline cell's backdrop is black. */
      if (data[i + 3] < 8) continue;
      if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) return false;
    }
    return true;
  } catch (e) {
    /* Can't read pixels (tainted canvas): assume it has content. When unsure, don't discard the
       user's image. */
    return false;
  }
}

/**
 * Capture the current picture. A Blob means success; when **a specific clip** was requested
 * (opts.only) and the capture fails, returns a string naming the reason, which the capturing side
 * handles by severity (see useThumbs):
 *   'no-node'   - the clip isn't on stage (the doc hasn't arrived yet). Clip level: don't ask for
 *                 this clip again this round.
 *   'not-ready' - footage in this clip isn't showing a picture yet (transcoding / decoding). Clip
 *                 level, as above.
 *   'blank'     - the capture is nearly solid black. **Frame level**: says nothing beyond this frame;
 *                 must not be used to skip the clip's other cells.
 * The unnamed path (legacy films / posters) keeps returning Blob or null; its callers only check
 * truthiness.
 *
 * opts.crop and opts.only are separate, don't conflate them: only decides **what stays on stage**
 * (the rest is hidden), crop decides **how the delivered image is cropped**. Asset-library MG
 * thumbnails need only crop: that page has just one clip, nothing to hide, but it must be cropped to
 * the module's own region (see paintedCrop).
 */
window.__filmCapture = async function (opts) {
  const stage = document.getElementById('stage');
  if (!stage) return null;
  /*
   * The clip isn't on stage: the picture hasn't caught up with the doc (just edited, id just changed,
   * this page still holds the previous version).
   *
   * Return nothing rather than substitute a composite. A composite would be stored under the same key
   * as an isolated capture (see ClipFrame.store: the key identifies the picture, not how it was
   * captured), so this "with neighboring clips" image would pin that cell, and every clip that looks
   * the same would get it afterwards: exactly the problem isolated capture exists to fix, back again.
   * Skipping a round is fine: the capturing side comes back shortly, and by then the doc has most
   * likely arrived.
   */
  /*
   * Right after a doc swap, the wrapper may need a frame or two to mount (bumpDoc in applyDoc is a
   * React setState). Reporting no-node immediately makes the capturing side mark the whole clip as
   * broken, leaving only the poster in the top-left on the timeline. If the clip really doesn't
   * exist (wrong id, stage still on the old doc), this costs at most this short wait before
   * returning nothing as usual.
   */
  var keep = null;
  if (opts && opts.only) {
    var until = Date.now() + 240;
    keep = clipNode(stage, opts.only);
    while (!keep && Date.now() < until) {
      await new Promise(function (r) { setTimeout(r, 40); });
      keep = clipNode(stage, opts.only);
    }
    if (!keep) return 'no-node';
  }
  /* Wait only for footage in **this clip**. Waiting on the whole stage was the previous approach, and
     it meant one source still transcoding to a proxy took down every other clip's image at that
     moment: MG has nothing to wait for, yet waited the full 4 seconds and then came back empty too,
     which users saw as "all thumbnails black". The 4 s is for footage: first appearance on stage
     fetches metadata, range-requests that second, then decodes, and a freshly uploaded source may
     still be transcoding to a proxy. */
  if (!(await settleVideos(keep || stage, 4000))) {
    return opts && opts.only ? 'not-ready' : null;
  }
  /* Hide, then capture: hide before inlining so stand-ins don't paint the hidden clips back in. */
  const restoreOthers = keep ? isolateClip(stage, keep) : function () {};
  const restore = inlineCanvases(stage);
  /* Stand-in size cap: four times the output width covers any crop box (thumbnails crop per clip,
     and the crop is smaller than the full frame). Export outputs at native size anyway, so its cap
     is naturally 1. */
  const videoScale = Math.min(1, (((opts && opts.width) || 160) * 4)
    / (stage.offsetWidth || (window.__FILM_STAGE__ || {}).w || 1920));
  const restoreVideos = inlineVideos(keep || stage, videoScale, Boolean(opts && opts.alpha));
  var undoAlpha = function () {};
  var restorePrepared = function () {};
  if (opts && opts.alpha) {
    var html = document.documentElement;
    var body = document.body;
    var prevHtml = html.style.background;
    var prevBody = body.style.background;
    var prevStage = stage.style.background;
    html.style.setProperty('background', 'transparent', 'important');
    body.style.setProperty('background', 'transparent', 'important');
    stage.style.setProperty('background', 'transparent', 'important');
    undoAlpha = function () {
      html.style.background = prevHtml;
      body.style.background = prevBody;
      stage.style.background = prevStage;
    };
  }
  try {
    restorePrepared = await inlinePreparedSurfaces(keep || stage, opts && opts.width);
    const w = stage.offsetWidth || (window.__FILM_STAGE__ || {}).w || 1920;
    const h = stage.offsetHeight || (window.__FILM_STAGE__ || {}).h || 1080;
    const width = (opts && opts.width) || 160;
    /* When cropping, width means the width of **the cropped region**, not the full frame; that is
       what a thumbnail cell needs. So pixelRatio is computed from the crop box, and the full frame
       is captured at that ratio and then cut. */
    const cropAt = opts && opts.crop ? clipNode(stage, opts.crop) : null;
    /*
     * opts.box is a frame **specified** by the caller (canvas coordinates); when given, crop to it
     * instead of measuring.
     *
     * Measuring yields the module's layout box, which can't contain the animation: GSAP animates
     * transform, which the layout ruler can't see (see filmRenderedBox in the runtime for the split).
     * So the export dialog lets people enlarge the frame enough, and that number comes in here: the
     * same box for every frame of the clip, with elements moving freely inside a fixed frame.
     * **Never** re-measure per frame: if the frame chased the element, the element would appear
     * pinned in place in the output.
     *
     * The thumbnail path doesn't pass it and measures as before.
     */
    const crop = (opts && opts.box) || (cropAt ? paintedCrop(cropAt, w, h) : null);
    const ratio = width / Math.max(1, crop ? crop.w : w);
    const shot = await captureStage(stage, {
      fontEmbedCSS: await stageFontEmbedCSS(keep || stage),
      filter: (node) => !(
        (node instanceof HTMLIFrameElement && node.hasAttribute('data-mg-surface'))
        || (node instanceof Element && node.hasAttribute('data-film-isolated'))
      ),
      width: w,
      height: h,
      /* isolation: the cloned #stage must form its own stacking context. On the real page that comes
         from position+transform, exactly what the clone has to clear (transform:none); once cleared,
         the footage layer (z:-2) ends up beneath #stage's own black background and the capture is
         solid black. */
      style: {
        transform: 'none', left: '0', top: '0', position: 'static', margin: '0',
        isolation: 'isolate',
        ...(opts && opts.alpha ? { background: 'transparent' } : {}),
      },
      pixelRatio: ratio,
      cacheBust: false,
    });
    if (!shot || !shot.width || !shot.height) return null;
    /* Cut before the black check: the check must see the image actually delivered. When nine-tenths
       of the full frame is black background and the clip itself is bright, checking first would
       discard a good image as a black frame. */
    const out = crop ? cutOut(shot, crop, ratio) : shot;
    /* The black check only guards clips **with footage** (see looksBlack for why): a pure-DOM MG
       that captures black really is black and is kept; the frames before an opening fade-in are
       legitimately black, and rejecting them would starve the whole filmstrip.
       The unnamed path (legacy films, no doc) keeps it too: a solid black image there is most
       likely the true picture at that moment, an empty stage. */
    if (opts && opts.only && keep && keep.querySelector('video') && looksBlack(out)) {
      return 'blank';
    }
    /* Thumbnails and posters (opaque, a few hundred px wide) are WebP: several times smaller than PNG
       per cell, and the thousand-cell budget in IndexedDB and memory assumes WebP (see thumb-cache in
       web). Transparent backgrounds (single-clip export) and large images stay PNG, since export needs
       lossless. If the browser can't encode WebP, toBlob falls back to PNG on its own. */
    const lossy = !(opts && opts.alpha) && width <= 640;
    return await new Promise((done) => {
      if (lossy) out.toBlob(done, 'image/webp', 0.85);
      else out.toBlob(done, 'image/png');
    });
  } catch (e) {
    return null;
  } finally {
    restorePrepared();
    undoAlpha();
    restoreVideos();
    restore();
    restoreOthers();
  }
};

/**
 * Mount the film. **Safe to call repeatedly**: in-place rebuilds after an edit go through here.
 *
 * root is kept for reuse: React 19 throws when createRoot is called twice on the same container.
 * The key changes every time so Host starts over entirely: its durationMs is a useState initial
 * value, and without a restart it would keep the previous version's duration, putting audio and
 * picture out of sync.
 */
let filmRoot = null;
let filmMountSeq = 0;
window.__filmMount = () => {
  const el = document.getElementById('stage');
  filmRoot ??= createRoot(el);
  filmMountSeq += 1;
  filmRoot.render(React.createElement(Host, {
    key: 'film-' + filmMountSeq,
    boot: window.__FILM_DURATION__ || 0,
  }));
  fit();
};
`;

/**
 * The compiler that runs in the iframe. Has no workspace content, so like the host script it is
 * read once.
 *
 * **Minified before inlining.** This page goes as-is into every user's browser, and a fifth of the
 * source file is comments, all explaining "why", which are for us and the next agent and shouldn't
 * ship. The source stays untouched; it is stripped on the way out: 19 KB -> 8 KB, no comments left.
 */
const COMPILE_ENTRY = transformSync(readFileSync(join(here, 'client-compile.js'), 'utf8'), {
  minify: true,
  legalComments: 'eof',
  target: 'chrome120',
}).code;

let hostScript: Promise<string> | null = null;

/**
 * The page script has no workspace content, so it is built once per process.
 *
 * `minify` takes it from ~2.5 MB to ~1 MB. `legalComments: 'eof'` keeps third-party license
 * banners (GSAP's `/*!` banner among them) at the end of the output, as their licenses require.
 *
 * The specs hung on `__ANIM_MG_DEPS__` are string keys, so they survive minification.
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
    /* MathJax (1.8 MB) stays out of the host. stem's formula backend loads it only via dynamic
       `import('mathjax-full/js/...')`; marked external, those calls stay as-is in the output and the
       browser resolves them through the page importmap to /film-vendor's single-file bundle (see
       vendor.ts), so **only films that actually render a Formula download it**. This is safe only
       because no static import points at it: a static one would leave a require() in the iife
       output, which the browser doesn't have, and the page would go blank. */
    external: ['mathjax-full/*'],
  }).then((r) => r.outputFiles?.[0]?.text ?? '').catch((e: unknown) => {
    hostScript = null;
    throw e;
  });
  return hostScript;
}

export function codeBaseFromFileBase(fileBase: string): string {
  return fileBase.replace(/\/(proxy|file)\/?$/, '/code/');
}

/**
 * Build the compile shell. Contains none of this film's JS; the iframe fetches and compiles the
 * source itself afterwards.
 */
export async function filmHostPage(opts: {
  fileBase: string;
  vendorBase?: string;
  /** Serve the pre-rework shell (only /dev/openbench asks for it). See filmLegacyFromUrl in film-routes. */
  legacy?: boolean;
}): Promise<string> {
  const host = await bundleHost();
  const hostRev = createHash('sha256').update(host).digest('hex').slice(0, 12);
  /* The build-cache key must include the compiler's own version: when the compiler changes,
     yesterday's cached output must not be reused. Kept separate from hostRev: mixing it into the
     host.js URL would force the host script to re-download along with the compiler.

     Hashes the **minified** version (COMPILE_ENTRY is minified before shipping): the key must follow
     the bytes actually sent. Hashing the source file would invalidate every user's build cache
     whenever a comment changed, though that version runs identically. */
  const buildRev = createHash('sha256').update(COMPILE_ENTRY).digest('hex').slice(0, 12);
  const fileBase = safeBase(opts.fileBase);
  const codeBase = codeBaseFromFileBase(fileBase);
  const vendorBase = trailingSlash(opts.vendorBase ?? '/api/film-vendor/');
  const legacy = Boolean(opts.legacy);
  /* Public packages use an immutable versioned path: one year + immutable, no expiry cliff (see
     vendor.ts). */
  const pkgBase = legacy ? vendorBase : `${vendorBase}v/${vendorPkgVersion()}/`;
  const bundleUrl = codeBase.replace(/\/code\/$/, '/code-bundle');
  /*
   * The boot snippet. **Comments go here, not into the string**: every character below appears
   * verbatim in the user's page source, and these notes are for us.
   *
   * It does two things, both to get work under way before downloads finish:
   *   1. Source fetching starts on the first line. That is a full round trip earlier than waiting
   *      for esbuild-wasm.js and host.js to download; the whole film's source is already in flight
   *      while the compiler initializes.
   *   2. The 2 MB of three used to be discovered only at the fourth import level. As soon as the
   *      bundle arrives it is preloaded, in parallel with compilation.
   */
  const boot = legacy
    ? `window.__FILM_LEGACY__=1;`
    : `window.__FILM_BUNDLE_URL__=${JSON.stringify(bundleUrl)};
var preview=new URLSearchParams(location.search).get('preview');
if(preview)window.__FILM_BUNDLE_URL__+='?preview='+encodeURIComponent(preview);
window.__FILM_BUNDLE__=fetch(window.__FILM_BUNDLE_URL__,{credentials:'same-origin'})
  .then(function(r){return r.ok?r.json():Promise.reject(new Error('code-bundle '+r.status));});
window.__FILM_BUNDLE__.then(function(b){
  var pkgs=(b&&b.packages)||[];
  for(var i=0;i<pkgs.length;i++){
    if(pkgs[i]==='three'||pkgs[i].indexOf('three/')===0){
      var l=document.createElement('link');
      l.rel='modulepreload';l.href=window.__FILM_PKG_BASE__+'three/build/three.module.js';
      document.head.appendChild(l);
      var c=document.createElement('link');
      c.rel='modulepreload';c.href=window.__FILM_PKG_BASE__+'three/build/three.core.js';
      document.head.appendChild(c);
      break;
    }
  }
}).catch(function(){});`;
  return `<!doctype html><meta charset="utf-8">
${originTrialMetaTag()}<script type="importmap">${JSON.stringify({
    imports: {
      three: `${pkgBase}three/build/three.module.js`,
      'three/addons/': `${pkgBase}three/addons/`,
      /* stem's formula backend keeps these six dynamic imports in host.js (see external in
         bundleHost). All six specifiers point at one URL: the browser dedupes by URL, the module is
         evaluated once, and each import takes its own named export. */
      ...Object.fromEntries(Object.keys(MATHJAX_SPECS).map((spec) => [spec, `${pkgBase}mathjax-tex-svg.js`])),
    },
  })}</script>
<base href="${escapeAttr(fileBase)}">
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:${STAGE_FONT_STACK}}
  #stage{position:absolute;left:50%;top:50%;transform-origin:center center;
    width:1920px;height:1080px;--film-w:1920px;--film-h:1080px;overflow:hidden;background:#000}
</style>
<div id="stage"></div>
<script>window.__FILM_STAGE__={w:1920,h:1080};window.__FILM_DURATION__=0;
window.__FILM_CODE_BASE__=${JSON.stringify(codeBase)};
window.__FILM_VENDOR_BASE__=${JSON.stringify(vendorBase)};
window.__FILM_PKG_BASE__=${JSON.stringify(pkgBase)};
window.__FILM_HOST_REV__=${JSON.stringify(hostRev)};
window.__FILM_BUILD_REV__=${JSON.stringify(buildRev)};
window.__FILM_SHARED_SPECS__=${JSON.stringify(hostSharedMap())};
${boot}</script>
<script src="${escapeAttr(pkgBase)}esbuild-wasm.js"></script>
<script src="${escapeAttr(vendorBase)}host.js?v=${hostRev}"></script>
<script>${COMPILE_ENTRY}</script>
`;
}

function trailingSlash(value: string): string {
  const v = value.trim();
  if (!/^\/[^/\\]/.test(v) || v.includes('\n')) return '/api/film-vendor/';
  return v.endsWith('/') ? v : `${v}/`;
}

function safeBase(value: string): string {
  const v = value.trim();
  return /^\/[^/\\]/.test(v) && !v.includes('\n') ? v : '/';
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
