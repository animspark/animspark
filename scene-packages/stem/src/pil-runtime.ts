/**
 * pil runtime - browser-side Pillow (PIL) + numpy live image-processing backend (running on the shared Pyodide).
 *
 * Same design as matplotlib: authors write a standard PIL/numpy def render(P, img) that processes one frame; the engine feeds the interpolated P back each frame,
 *   Pyodide recomputes synchronously -> RGBA -> offscreen canvas -> the engine's dispatching resolver (sync-pil: prefix) draws it in the same frame.
 *   Adding noise/denoising/pixelation/forward diffusion are one-liners in numpy/PIL; morphing a scalar in P animates them frame by frame (the go-to for diffusion topics).
 *
 * How the source image gets into Python: before playback the engine has already pre-decoded the workspace images (assets/...) into imageCache; we reuse that decoded result directly
 *   (getCachedImageSource -> drawImage -> getImageData -> feed the RGBA bytes to PIL), with no second download/decode.
 *
 * The Pyodide instance/lifecycle/single resolver dispatch/theme broadcast are managed by @animspark/scene-engine/pyodide;
 *   this file only declares the "pil harness" (core packages numpy+Pillow, the Python harness, source-image upload, per-frame recompute).
 */
import { getCachedImageSource } from '@animspark/scene-engine';
import {
  registerPyodideHarness,
  ensurePyodide,
  pyodideReady,
  getPyodide,
  syncPyodideTheme,
  type PyodideAPI,
  type PyodideThemePayload,
} from '@animspark/scene-engine/pyodide';

/** A single frame may contain several processed images (cells of a gallery grid); each slotKey gets its own persistent canvas (redrawn in place every frame),
 *  so a rotating pool cannot overwrite itself within one frame. The LRU cap keeps memory bounded in long sessions. */
const MAX_CANVASES = 64;
const SYNC_PREFIX = 'sync-pil:';

/**
 * Resident on the Python side: source-image cache + scene code cache + per-frame recompute + theme dict.
 * Authors write standard PIL/numpy: def render(P, img) - img is a PIL.Image (RGBA); return the processed PIL.Image or numpy array;
 * the engine normalizes it to a contiguous RGBA uint8 array and writes it back to the canvas. The injected THEME dict provides theme colors (frames/annotations stay consistent with the film).
 */
const PY_HARNESS = `
import json
import numpy as np
from PIL import Image

_theme = {}        # active theme palette (render can read THEME["primary"] etc.)
_srcs = {}         # src_id -> PIL.Image(RGBA)  source image (uploaded only once)
_scenes = {}       # code_id -> render(P, img)

def _apply_theme(theme_json):
    t = json.loads(theme_json); _theme.clear(); _theme.update(t)

def _set_src(src_id, w, h, buf):
    # buf: RGBA bytes from canvas getImageData (R,G,B,A per pixel)
    _srcs[src_id] = Image.frombytes("RGBA", (int(w), int(h)), bytes(buf))

def _has_src(src_id):
    return src_id in _srcs

def _load(code_id, code):
    if code_id in _scenes:
        return
    g = {"THEME": _theme, "np": np, "Image": Image}   # np/Image are preset; authors may also import them
    exec(code, g)
    _scenes[code_id] = g["render"]                     # must define render(P, img)

def _to_rgba_u8(res, out_w, out_h):
    # Normalize render's return value (PIL.Image or numpy array; RGB/RGBA/grayscale) to a contiguous (H,W,4) uint8 array.
    if isinstance(res, Image.Image):
        return np.ascontiguousarray(np.asarray(res.convert("RGBA")), dtype=np.uint8)
    arr = np.asarray(res)
    if arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    if arr.ndim == 2:                                  # grayscale -> RGBA
        a = np.full(arr.shape, 255, np.uint8)
        arr = np.stack([arr, arr, arr, a], axis=-1)
    elif arr.shape[-1] == 3:                           # RGB -> RGBA
        a = np.full(arr.shape[:2] + (1,), 255, np.uint8)
        arr = np.concatenate([arr, a], axis=-1)
    return np.ascontiguousarray(arr, dtype=np.uint8)

def _draw(code_id, src_id, p_json, out_w, out_h):
    P = json.loads(p_json)
    img = _srcs.get(src_id)
    if img is None:                                    # no source image: use a transparent canvas, so authors can generate from scratch
        img = Image.new("RGBA", (max(1, int(out_w)), max(1, int(out_h))), (0, 0, 0, 0))
    res = _scenes[code_id](P, img)
    return _to_rgba_u8(res, out_w, out_h)
`;

type PyDrawResult = { getBuffer(t: string): { data: Uint8Array; shape: number[]; release(): void } };
type PyDraw = (codeId: string, srcId: string, pJson: string, outW: number, outH: number) => PyDrawResult;
type PySetSrc = (srcId: string, w: number, h: number, buf: Uint8Array) => void;
type PyHasSrc = (srcId: string) => boolean;

let pyLoad: ((codeId: string, code: string) => void) | null = null;
let pyDraw: PyDraw | null = null;
let pySetSrc: PySetSrc | null = null;
let pyHasSrc: PyHasSrc | null = null;
let pyApplyTheme: ((themeJson: string) => void) | null = null;

const loadedCodeIds = new Set<string>();
const uploadedSrcs = new Set<string>();
const srcDims = new Map<string, [number, number]>();
const canvasByKey = new Map<string, HTMLCanvasElement>(); // slotKey -> persistent canvas (redrawn in place every frame)

const pilHarness = {
  id: 'pil',
  syncPrefix: SYNC_PREFIX,
  corePackages: ['numpy', 'Pillow'],
  init(py: PyodideAPI): void {
    py.runPython(PY_HARNESS);
    pyLoad = py.globals.get('_load') as typeof pyLoad;
    pyDraw = py.globals.get('_draw') as typeof pyDraw;
    pySetSrc = py.globals.get('_set_src') as typeof pySetSrc;
    pyHasSrc = py.globals.get('_has_src') as typeof pyHasSrc;
    pyApplyTheme = py.globals.get('_apply_theme') as typeof pyApplyTheme;
  },
  applyTheme(_py: PyodideAPI, theme: PyodideThemePayload): void {
    pyApplyTheme?.(JSON.stringify(theme));
  },
  resolve(href: string): CanvasImageSource | null {
    const key = decodeURIComponent(href.slice(SYNC_PREFIX.length));
    return canvasByKey.get(key) ?? null;
  },
};

/** Trigger initialization (idempotent); while not ready the caller should draw a placeholder, and the engine is asked to redraw once ready. */
export function pilEnsureInit(): void {
  ensurePyodide();
}

function hashCode(code: string): string {
  let h = 5381;
  for (let i = 0; i < code.length; i++) h = ((h << 5) + h + code.charCodeAt(i)) | 0;
  return 'c' + (h >>> 0).toString(36) + code.length.toString(36);
}

/** Compile a render snippet into Python (synchronous; core packages are installed eagerly); returns false if not ready. */
function ensureCodeLoaded(codeId: string, code: string): boolean {
  if (loadedCodeIds.has(codeId)) return true;
  if (!pyLoad) return false;
  pyLoad(codeId, code);
  loadedCodeIds.add(codeId);
  return true;
}

/**
 * Upload the source image (the decoded assets/ image) into Python (only once).
 * Returns false if decoding has not finished (preload not in yet) -> the caller draws a placeholder and the engine redraws later. An empty src passes straight through (pure generation).
 */
function ensureSrc(src: string): boolean {
  if (!src) return true;
  if (uploadedSrcs.has(src)) return true;
  if (!pySetSrc) return false;
  const img = getCachedImageSource(src);
  if (!img) return false;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data; // Uint8ClampedArray RGBA
  pySetSrc(src, w, h, new Uint8Array(data.buffer));
  uploadedSrcs.add(src);
  srcDims.set(src, [w, h]);
  return true;
}

/**
 * Asset readiness probe (playback gate): Pyodide ready + this code compiles + the source image is decoded and uploaded.
 * The check also pushes the code/source image into Python (synchronous, idempotent), so the first render has zero wait.
 */
export function pilReadyFor(code: string, src: string): boolean {
  if (typeof document === 'undefined') return true;
  if (!code) return true;
  if (!pyodideReady() || !pyDraw) {
    pilEnsureInit();
    return false;
  }
  try {
    if (!ensureCodeLoaded(hashCode(code), code)) return false;
    return ensureSrc(src);
  } catch {
    // The code itself is broken: render falls back to the error placeholder; don't block the whole film from starting.
    return true;
  }
}

/**
 * Process one frame synchronously: run Pyodide (PIL/numpy) -> RGBA -> offscreen canvas -> return a stable <image href>.
 * Returns null when not ready / the source image hasn't arrived (the caller draws a placeholder). render() and the following drawImage happen in the same synchronous frame, so the offscreen content is fresh.
 *
 * slotKey: each "logical unit" (a standalone imgproc element / one gallery cell) gets a stable key and its own persistent canvas,
 *   redrawn in place every frame - so multiple processed images in one frame (a gallery grid) don't overwrite each other, and the href stays stable. Defaults to a key derived from code+src.
 */
export function pilRenderHref(code: string, src: string, p: unknown, slotKey?: string): string | null {
  if (!pyodideReady() || !pyDraw) {
    pilEnsureInit();
    return null;
  }
  try {
    const codeId = hashCode(code);
    if (!ensureCodeLoaded(codeId, code)) return null;
    if (!ensureSrc(src)) return null;
    syncPyodideTheme();
    const dims = srcDims.get(src);
    const outW = dims?.[0] ?? 1024;
    const outH = dims?.[1] ?? 1024;
    const arr = pyDraw(codeId, src, JSON.stringify(p ?? {}), outW, outH);
    const buf = arr.getBuffer('u8');
    const ih = buf.shape[0] ?? outH;
    const iw = buf.shape[1] ?? outW;
    const key = slotKey || `${codeId}|${src}`;
    let cv = canvasByKey.get(key);
    if (!cv) {
      if (canvasByKey.size >= MAX_CANVASES) {
        const oldest = canvasByKey.keys().next().value as string | undefined;
        if (oldest) canvasByKey.delete(oldest);
      }
      cv = document.createElement('canvas');
      canvasByKey.set(key, cv);
    }
    if (cv.width !== iw) cv.width = iw;
    if (cv.height !== ih) cv.height = ih;
    const cctx = cv.getContext('2d');
    if (cctx) {
      const data = new Uint8ClampedArray(buf.data.slice().buffer);
      cctx.putImageData(new ImageData(data, iw, ih), 0, 0);
    }
    buf.release();
    (arr as unknown as { destroy?(): void }).destroy?.();
    return `${SYNC_PREFIX}${encodeURIComponent(key)}`;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[pil] render failed', e);
    return null;
  }
}

// Register the pil harness + instant playback: warm up the shared Pyodide as soon as the module loads (when the playback package starts).
registerPyodideHarness(pilHarness);
pilEnsureInit();

/** Mark a src for prewarm upload (optional; if the image is already decoded before the first frame, feed it into Python early). Currently triggered lazily by the render path. */
export { hashCode as pilHashCode };
