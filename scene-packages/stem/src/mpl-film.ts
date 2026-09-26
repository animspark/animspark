/**
 * The film side of Mpl - same Pyodide/matplotlib raster backend, a different output path.
 *
 * The scene MPL_DEF's render returns `<image href="sync-mpl:...">`: that is the old canvas compositor's protocol,
 * where the engine's resolver swaps the token for the real image at drawImage time. Film pack components emit real DOM
 * `<svg>`; the browser loads the token as a URL and gets ERR_UNKNOWN_URL_SCHEME - nothing on screen,
 * just one line in the console. So film uses the other half of the pack protocol: `paint(params, canvas)`, where the raster
 * backend draws straight into its own canvas (the same shape p5 / three had in the old engine).
 *
 * We don't import './mpl' but assemble a slim def instead: MPL_DEF drags along thousands of characters of
 * author docs in doc/details/paramDocs plus the placeholder skeleton - those belong to scene authoring, and the film host's bundle should not pay for them.
 *
 * Determinism comes from both ends:
 *   - once Pyodide has loaded, pyDraw is a **synchronous** call - every frame is a pure function of the current P;
 *   - until loading finishes ready() is false, and framing's (shoot.ts) packs-ready gate waits - the shutter never
 *     lands on a placeholder frame. In realtime preview mpl-runtime throttles heavy figures ("rest as long as you drew", reusing the
 *     previous frame); the framing page turns seekExact on to disable that (see code-shoot's __animSetSeekExact).
 */
import type { PackComponentDef, PackParams } from '@animspark/scene-engine/react';

import { mplEnsureInit, mplRasterSource, mplRenderHref, mplReadyFor } from './mpl-runtime';

const isBrowser = typeof document !== 'undefined';

function codeOf(p: PackParams): string {
  const v = p.code;
  return typeof v === 'string' ? v : '';
}

/**
 * Python's `P` dict = the flattened top-level props (minus the two reserved keys code/blit).
 *
 * The scene-side Mpl takes a nested `P={{ grow: 0 }}`, but the film pack handle exposes the **whole props
 * dict**: `tl.to(fig.P, { grow: 1 })` writes to the top level, and the nested copy stays at its initial value forever - in practice
 * "the curve never moves", with no error at all. So the film side flattens the channels (same contract as Chart/Spreadsheet:
 * props are spread out, and the handle is tweened exactly as the def docs describe); a nested `P` is still accepted (applied first, top-level keys of the same name override it),
 * so authors arriving with scene habits don't get a blank screen.
 */
function pythonParams(p: PackParams): Record<string, unknown> {
  const nested = p.P;
  const merged: Record<string, unknown> =
    nested && typeof nested === 'object' ? { ...(nested as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'code' || k === 'blit' || k === 'P') continue;
    /* gsap attaches a `_gsap` bookkeeping object (GSCache, whose target points back - a cycle) to tween targets, and the film
       handle exposes exactly this tweened dict - if we don't skip it, sig's JSON.stringify blows up on the spot,
       the whole React page unmounts, and framing ends in a 30s timeout. Same for functions (onUpdate etc. must never reach Python). */
    if (k === '_gsap' || typeof v === 'function') continue;
    merged[k] = v;
  }
  delete merged._gsap;
  return merged;
}

/* Two instances of the same code each need their own offscreen canvas, otherwise the lastSig short-circuit makes them clobber each other.
   Pack paint only gets (params, canvas), and the canvas element happens to be the most stable anchor for "this component instance". */
let nextInstance = 1;
const instanceIds = new WeakMap<HTMLCanvasElement, string>();
function instanceOf(cv: HTMLCanvasElement): string {
  let id = instanceIds.get(cv);
  if (!id) {
    id = `film${nextInstance++}`;
    instanceIds.set(cv, id);
  }
  return id;
}

export const MPL_FILM_DEF: PackComponentDef = {
  name: 'mpl',
  defaults: { code: '', P: {}, blit: false },
  fill: true,
  intrinsic() {
    return [960, 720];
  },
  /* Paint components never take this path (pack checks paint first); Node evaluation (anim check) renders only a <canvas> shell
     and does not call it either. The empty implementation just satisfies the type. */
  render() {
    return '';
  },
  ready(p: PackParams): boolean {
    const code = codeOf(p);
    if (!code || !isBrowser) return true;
    return mplReadyFor(code);
  },
  paint(p: PackParams, cv: HTMLCanvasElement): boolean {
    const code = codeOf(p);
    if (!code) return false;
    /* mplRenderHref takes the **logical** box (stage coordinates) and applies density internally; cv.width is rect x dpr
       physical pixels - passing it directly would render the figure one size too large and scale it back down, a wasted Python pass. */
    const rect = cv.getBoundingClientRect();
    const w = rect.width || cv.width;
    const h = rect.height || cv.height;
    const href = mplRenderHref(code, pythonParams(p), p.blit === true, instanceOf(cv), w, h);
    if (!href) {
      mplEnsureInit();
      return false;
    }
    const src = mplRasterSource(href);
    const ctx = cv.getContext('2d');
    if (!src || !ctx) return false;
    /* The raster is produced at the mount box size, which usually equals the canvas; we still draw centered with meet to absorb
       rounding differences between the logical box and physical pixels - the same geometry as the scene's <image preserveAspectRatio="xMidYMid meet">. */
    const sw = (src as { width: number }).width;
    const sh = (src as { height: number }).height;
    if (!sw || !sh) return false;
    const k = Math.min(cv.width / sw, cv.height / sh);
    const dw = sw * k;
    const dh = sh * k;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src as CanvasImageSource, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
    return true;
  },
};
