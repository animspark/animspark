/**
 * mpl runtime - browser-side live matplotlib raster backend (running on the shared Pyodide).
 *
 * Why it's wired this way:
 *   matplotlib's SVG export uses style="" attributes, while the engine's canvas SVG-subset renderer only understands presentation attributes
 *   (fill=/stroke=), so inlining it paints everything black. Hence "direct raster drawing": render() runs Pyodide synchronously to draw the current frame into
 *   an offscreen canvas and returns <image href="sync-mpl:slot">; the engine's dispatching resolver matches it and calls drawImage in the same frame.
 *
 * The Pyodide instance, init lifecycle, single resolver dispatch and theme broadcast are all managed by @animspark/scene-engine/pyodide:
 *   this file only declares the "mpl harness" (core packages numpy+matplotlib, the Python harness, the CJK font, heavy-library gating).
 *   That way matplotlib and image (PIL) etc. share one Pyodide instead of each loading its own or overwriting each other's resolver.
 *
 * Key fact: once Pyodide has loaded, runPython is a synchronous call - which fits ComponentDef.render's synchronous contract exactly.
 *
 * Instant playback: Pyodide is warmed up early (see warmMplRuntime); the core (numpy+matplotlib) becomes ready first,
 *   then the heavier scipy/sympy/pandas/networkx are installed + cached in the background, and a CJK font is fetched and registered with matplotlib (so CJK text in figures is no longer tofu boxes).
 *
 * Browser only: every DOM/Pyodide access is guarded at call time; Node (validation-time renderFrameSvg) never gets here (mpl.ts checks for document first).
 */
import {
  registerPyodideHarness,
  ensurePyodide,
  pyodideReady,
  getPyodide,
  syncPyodideTheme,
  requestPyodideRedraw,
  type PyodideAPI,
  type PyodideThemePayload,
} from '@animspark/scene-engine/pyodide';
import { markSyncDraw, seekExact } from '@animspark/scene-engine/playback';
import { MPL_CJK_FONT_URL, mplPythonHarnessSource } from './mpl-harness';

// Matplotlib's default figure is 6.4×4.8 in (≈4:3); used only as the harness cold-start placeholder.
// The real raster size = the mount box (logical pixels): the figure fills the box, margins are computed once by constrained layout from the decorations.
const BUF_W = 960;
const BUF_H = 720;
/** Cap on resident offscreen canvases (LRU eviction): one per figure, enough for every mpl figure in a film. */
const MAX_CANVASES = 16;
/**
 * These packages are large: they stay out of the eager core set (so they don't slow the first frame); once ready they are prewarmed + cached one by one in the background, and installed on demand when actually used.
 * This is only the fast path - packages not on the list (shapely / statsmodels / skimage ...) fall back to loadPackagesFromImports when the first exec raises
 * ModuleNotFoundError, so anything in the Pyodide distribution can be installed.
 * matplotlib_venn is not in the Pyodide distribution; don't list it here: loadPackage on a nonexistent name only raises.
 */
const HEAVY_IMPORTS = /\b(?:import|from)\s+(scipy|sympy|pandas|networkx|sklearn)\b/g;
const PYODIDE_PACKAGE_BY_IMPORT: Record<string, string> = {
  sklearn: 'scikit-learn',
};

/** Parse the heavy packages this code actually imports (only the ones really used, not the whole group). */
function neededHeavyPackages(code: string): string[] {
  const set = new Set<string>();
  for (const m of code.matchAll(HEAVY_IMPORTS)) set.add(PYODIDE_PACKAGE_BY_IMPORT[m[1]!] ?? m[1]!);
  return [...set];
}

/** Whether these packages are all installed in the current Pyodide (loadedPackages is Pyodide's authoritative installed table). */
function pyPackagesLoaded(py: PyodideAPI, names: string[]): boolean {
  if (!names.length) return true;
  const loaded = py.loadedPackages;
  if (!loaded) return false;
  return names.every((n) => n in loaded);
}
/**
 * CJK font: matplotlib's bundled DejaVu has no CJK glyphs, so CJK text in figures becomes tofu boxes. The browser can't fall back to system fonts the way a web page does,
 * so a CJK font must actually be loaded into matplotlib. By default we fetch Noto Sans CJK SC (OFL, ~16MB, background download + browser cache).
 * To self-host/swap the font: call mplSetCjkFontUrl('/fonts/xxx.otf') before the page opens to override it.
 */
let cjkFontUrl: string = MPL_CJK_FONT_URL;
/** Override the CJK font source (a self-hosted .otf/.ttf URL). Must be called before the first mpl render. */
export function mplSetCjkFontUrl(url: string): void { cjkFontUrl = url; }

/**
 * Resident on the Python side: one reusable transparent figure + scene cache + two per-frame redraw paths (modeled on matplotlib's official animation API) + theme styling.
 *
 * Author contract (= official FuncAnimation init_func / func; the old single render function is gone entirely):
 *   def init(ax, P) -> list[Artist]   draws the static background once (axes/title/grid/static elements), creates and returns the "artists that will move".
 *   def update(P, artists)            each frame only changes those artists' data (set_data / set_offsets / set_text ...).
 *
 * Two paths (chosen by the author's blit flag, same as the official blit=True/False):
 *   (1) blit=True (fixed axes/view, the vast majority): measured ~1.2ms/frame.
 *      First frame: init -> canvas.draw() -> copy_from_bbox caches the "clean background"; after that each frame does restore_region(bg) ->
 *      update -> draw_artist for each artist -> canvas.blit. Skips recomputing axes/ticks/layout (70-80% of the cost).
 *   (2) blit=False (animated axis ranges / autoscale / 3D view rotation): measured ~22ms/frame (still faster than the old full redraw + per-frame layout at 36ms).
 *      Each frame: clf -> init -> update -> canvas.draw(), a full redraw. Axis decorators can follow along every frame.
 *      Key saving: margins are computed with constrained_layout on the first frame and then pinned (subplots_adjust reused), with no per-frame layout.
 *
 * The engine does only three things: (1) transparent background (composited over the scene background); (2) polished default rcParams that follow the runtime palette;
 *   (3) takes one of the two paths above according to blit. Authors can also read the injected THEME dict for theme colors, keeping the whole film visually consistent without looking cookie-cutter.
 */
const PY_HARNESS = mplPythonHarnessSource(BUF_W, BUF_H);

type PyBuffer = { data: Uint8Array; shape?: number[]; release(): void };
type PyDraw = (
  codeId: string, pJson: string, blit: boolean, outW: number, outH: number, density: number,
  instanceId: string,
) => { getBuffer(t: string): PyBuffer };

let pyLoad: ((codeId: string, code: string) => void) | null = null;
let pyDraw: PyDraw | null = null;
let pyApplyTheme: ((themeJson: string) => void) | null = null;
let pyInvalidateAll: (() => void) | null = null;
let pyDropScene: ((sceneId: string) => void) | null = null;

const loadedCodeIds = new Set<string>();
const pendingCodeIds = new Set<string>();
/** One resident offscreen canvas per component instance (renderKey = codeId or codeId:instanceId); multiple instances of the same code never overwrite each other. */
const canvasByKey = new Map<string, HTMLCanvasElement>();
/** renderKeys that have drawn at least one frame successfully. */
const renderedKeys = new Set<string>();

/* -- Performance: decouple "Python redraw rate" from the "60fps display rate" ---------------------------------
 * Problem: Pyodide/matplotlib runs synchronously on the main thread, and the engine calls render()->pyDraw() every display frame;
 *   a single _canvas.draw() easily takes tens of ms (streamplot etc. even more), so re-running it every frame saturates the main thread -> stuttering video.
 * Fix: a render() that hits the resident canvas is nearly free (the engine only calls drawImage), so:
 *   (1) Exact memo: if the same (renderKey, P) is already on the canvas, reuse it and never re-run Python (covers static/paused/repeated frames).
 *   (2) Adaptive throttle: during animation P changes every frame, but a figure's actual redraws are spaced at least max(MIN, last duration) apart -
 *      i.e. Python never takes more than ~50% of the main thread, and the display layer keeps 60fps with the previous frame's canvas;
 *      if the target P still hasn't been reached after the throttle window, we call requestPyodideRedraw() as a fallback redraw (so even a paused frame eventually draws correctly).
 */
/**
 * Budget for "how long one redraw takes". Figures under it count as light and simply follow the full display refresh rate.
 *
 * This used to be `Math.max(33, last duration)` - that 33ms floor pinned even light figures to ~26fps:
 * a figure that draws in 5ms still had to idle another 33ms before its next frame, a 13% duty cycle, throwing away half the frames.
 * The throttle only exists to "keep synchronous Python from monopolizing the main thread", which holds for heavy figures; for light ones it is pure self-harm.
 */
const REDRAW_BUDGET_MS = 8;
const lastSigByKey = new Map<string, string>();
const lastDrawAtByKey = new Map<string, number>();
const lastDrawMsByKey = new Map<string, number>();
const pendingRedrawKeys = new Set<string>();
/** Pixel size of the most recent successful raster (for the debug content rect). */
const lastRasterByKey = new Map<string, [number, number]>();
/** init / update runtime errors already reported (renderKey + error text); each one reaches the console only once. */
const renderErrorsSeen = new Set<string>();
const perfNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function renderKeyFor(codeId: string, instanceId?: string): string {
  return instanceId ? `${codeId}:${instanceId}` : codeId;
}

/** Get/create the resident canvas for a renderKey (LRU eviction; the oldest is dropped when over the cap). */
function getRenderCanvas(renderKey: string, w: number, h: number): HTMLCanvasElement {
  const hit = canvasByKey.get(renderKey);
  if (hit) {
    canvasByKey.delete(renderKey);
    canvasByKey.set(renderKey, hit);
    if (hit.width !== w || hit.height !== h) { hit.width = w; hit.height = h; }
    return hit;
  }
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  canvasByKey.set(renderKey, cv);
  while (canvasByKey.size > MAX_CANVASES) {
    const oldest = canvasByKey.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    canvasByKey.delete(oldest);
    renderedKeys.delete(oldest);
    lastSigByKey.delete(oldest);
    lastDrawAtByKey.delete(oldest);
    lastDrawMsByKey.delete(oldest);
    lastRasterByKey.delete(oldest);
    pendingRedrawKeys.delete(oldest);
    for (const key of renderErrorsSeen) if (key.startsWith(`${oldest}:`)) renderErrorsSeen.delete(key);
    pyDropScene?.(oldest);
  }
  return cv;
}

/** Whether the CJK font has settled (registered successfully or failed to download): used to gate playback of mpl figures with CJK text; a failure never blocks forever. */
let cjkFontSettled = false;

/** Fetch the CJK font in the background and register it with matplotlib (doesn't block the first frame). Once downloaded, the shared runtime redraws once, replacing tofu boxes with real glyphs. */
async function loadCjkFont(py: PyodideAPI): Promise<void> {
  try {
    const res = await fetch(cjkFontUrl);
    if (!res.ok) throw new Error(`font download failed ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    try { py.FS.mkdir('/fonts'); } catch { /* already exists */ }
    py.FS.writeFile('/fonts/cjk.otf', bytes);
    py.runPython('_register_font("/fonts/cjk.otf")');
    // Frames rendered before the font arrived drew CJK text as tofu boxes: the blit path even baked them into the cached background, and the JS-side lastSig remembers that frame.
    // We must (1) clear the exact memo (otherwise the same P reuses the old boxed frame and never redraws) and (2) invalidate every scene (re-run init to rebuild
    //   Text artists with the new font + re-bake the background). Only then does the requestPlaybackRedraw after runWarm actually redraw with the new font - boxes become real glyphs.
    lastSigByKey.clear();
    pyInvalidateAll?.();
  } finally {
    cjkFontSettled = true;
  }
}

const mplHarness = {
  id: 'mpl',
  syncPrefix: 'sync-mpl:',
  corePackages: ['numpy', 'matplotlib'],
  // Prewarmed one by one in the background (see the pyodide manager's runWarm): networkx (graphs/networks, small) first, scipy next,
  // sympy/pandas are large and rarely used, so they go last; any single failure doesn't hold up the others, and each one triggers a redraw once installed. Installed on demand when actually used.
  // Note: the standard Pyodide distribution has no matplotlib-venn; don't prewarm it by default, or every playback emits a noisy warning.
  warmPackages: ['networkx', 'scipy', 'sympy', 'pandas'],
  init(py: PyodideAPI): void {
    py.runPython(PY_HARNESS);
    pyLoad = py.globals.get('_load') as typeof pyLoad;
    pyDraw = py.globals.get('_draw') as typeof pyDraw;
    pyApplyTheme = py.globals.get('_apply_theme') as typeof pyApplyTheme;
    pyInvalidateAll = py.globals.get('_invalidate_all') as typeof pyInvalidateAll;
    pyDropScene = py.globals.get('_drop_scene') as typeof pyDropScene;
  },
  warmup(py: PyodideAPI): Promise<void> {
    return loadCjkFont(py);
  },
  applyTheme(_py: PyodideAPI, theme: PyodideThemePayload): void {
    pyApplyTheme?.(JSON.stringify(theme));
    // After a theme change the colors differ: (1) the exact memo is invalid (clear signatures, force a redraw next frame);
    //   (2) the background baked by the blit path / margins pinned by the full-redraw path use the old theme colors, so invalidate -> every scene rebuilds with the new theme next frame.
    lastSigByKey.clear();
    pyInvalidateAll?.();
  },
  resolve(href: string): CanvasImageSource | null {
    return canvasByKey.get(href.slice('sync-mpl:'.length)) ?? null;
  },
};

/** Trigger initialization (idempotent); while not ready the caller should draw a placeholder, and the engine is asked to redraw once ready. */
export function mplEnsureInit(): void {
  ensurePyodide();
}

function hashCode(code: string): string {
  // Only a cache key for "exec each render source once"; no cryptographic strength needed.
  let h = 5381;
  for (let i = 0; i < code.length; i++) h = ((h << 5) + h + code.charCodeAt(i)) | 0;
  return 'c' + (h >>> 0).toString(36) + code.length.toString(36);
}

/**
 * Tolerance: decode HTML entities that slipped into Python source back into real characters.
 * Origin: when an LLM stuffs Python into a double-quoted JS string/array, it often mis-escapes inner " as &quot; (instead of \" or switching to single quotes),
 *   so exec sees `THEME[&quot;primary&quot;]` - an immediate Python SyntaxError, and the whole beat falls back to the placeholder card.
 * HTML entities never belong in Python source, so decoding them unconditionally is safe (bitwise & is written `&`, never `&amp;`).
 * Named/numeric entities are decoded first and &amp; last, so double escapes like &amp;quot; leave nothing behind.
 */
function decodeCodeEntities(code: string): string {
  if (code.indexOf('&') === -1) return code;
  return code
    .replace(/&quot;|&#0*34;/g, '"')
    .replace(/&apos;|&#0*39;/g, "'")
    .replace(/&lt;|&#0*60;/g, '<')
    .replace(/&gt;|&#0*62;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Code that failed to compile, and why.
 *
 * This must be terminal: a syntax error, or importing a package Pyodide doesn't have, gives the same result no matter how many retries. These failures used to
 * just console.error once and drop the pending flag, so the next frame tried again - one failed download and one log line per frame,
 * while ready() kept reporting false and framing's packs-ready gate waited forever: the export hung with nothing on screen.
 * Now a failure is recorded: ready() lets it through (this cell stays empty, the rest of the film plays normally), and the log is printed once.
 */
const failedCodeIds = new Map<string, string>();

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isModuleNotFound(e: unknown): boolean {
  return /ModuleNotFoundError|No module named/.test(errorMessage(e));
}

function markCodeFailed(codeId: string, why: string): void {
  failedCodeIds.set(codeId, why);
  // eslint-disable-next-line no-console
  console.error(`[mpl] this figure's Python will not run: ${why}`);
}

/** Whether this code has already been declared dead (will never become ready). */
function codeLoadFailed(codeId: string): boolean {
  return failedCodeIds.has(codeId);
}

/** Compile a render snippet into Python (first fetching the heavy deps it actually uses, if needed); returns false if not ready or dead. */
function ensureCodeLoaded(codeId: string, code: string): boolean {
  if (loadedCodeIds.has(codeId)) return true;
  if (pendingCodeIds.has(codeId) || failedCodeIds.has(codeId)) return false;
  const py = getPyodide();
  if (!py || !pyLoad) return false;
  const loadAsync = (job: () => Promise<void>): false => {
    pendingCodeIds.add(codeId);
    void (async () => {
      try {
        await job();
        pyLoad!(codeId, code);
        loadedCodeIds.add(codeId);
      } catch (e) {
        markCodeFailed(codeId, errorMessage(e));
      } finally {
        pendingCodeIds.delete(codeId);
        requestPyodideRedraw();
      }
    })();
    return false;
  };
  // Only check whether the heavy packages this code "actually imports" are installed - decoupled from overall prewarm progress:
  //   a networkx figure need not wait for sympy/pandas, and one package failing to prewarm doesn't affect other figures. If all are installed, compile synchronously with no placeholder flash.
  const missing = neededHeavyPackages(code).filter((n) => !pyPackagesLoaded(py, [n]));
  if (missing.length) {
    // The heavy packages it needs haven't arrived: asynchronously install just those, then redraw; meanwhile render() reuses the previous frame (no card).
    return loadAsync(() => py.loadPackage(missing));
  }
  try {
    pyLoad(codeId, code);
  } catch (e) {
    /* Packages outside the fast-path list (shapely / statsmodels / skimage ...): let Pyodide install them from the import statements,
       then compile again. Packages missing from the Pyodide distribution (matplotlib_venn) still raise ModuleNotFoundError the second time;
       that's terminal, and the error names the package. */
    if (isModuleNotFound(e)) return loadAsync(() => py.loadPackagesFromImports(code));
    markCodeFailed(codeId, errorMessage(e));
    return false;
  }
  loadedCodeIds.add(codeId);
  return true;
}

/**
 * Output density, shared with three/p5 via window.__animsparkDisplayScale (playback package default 1, max 2).
 *
 * three returns 2×s because its author coordinate system is 960 logical and must first fill the 1920 stage. mpl is different:
 * the mount box boxW/boxH passed in is already in stage logical coordinates (stage width 1920), and s means exactly
 * "render the stage at s× density" - s=1 outputs 1080p, s=2 outputs 4K. So physical pixels = box × s, with no extra ×2.
 * Thus at s=1 the output is pixel-identical to before the change, with no performance regression; only real 4K pays the extra cost.
 */
const STAGE_SCALE_DEFAULT = 1;
const STAGE_SCALE_MAX = 2;

function displayScale(): number {
  const raw = typeof window !== 'undefined'
    ? (window as unknown as { __animsparkDisplayScale?: number }).__animsparkDisplayScale
    : STAGE_SCALE_DEFAULT;
  return Number.isFinite(raw) && (raw as number) > 0
    ? Math.min(STAGE_SCALE_MAX, Math.max(0.45, raw as number))
    : STAGE_SCALE_DEFAULT;
}

let lastDensity = STAGE_SCALE_DEFAULT;
/** When density changes, the previous frame's pixels can't be reused (on the Python side _set_density invalidates the scene cache itself). */
function invalidateIfDensityChanged(): void {
  const d = displayScale();
  if (d === lastDensity) return;
  lastDensity = d;
  lastSigByKey.clear();
}

/** Logical side cap (the box should never exceed the stage anyway) and physical side cap (4K long edge). */
const LOGICAL_CAP = 1920;
const PHYS_CAP = 3840;

/** Returns the logical raster size; the Python side multiplies by density to get physical pixels, and neither cap may be exceeded. */
function renderPixels(w: number, h: number, density: number): [number, number] {
  let bw = Math.max(64, Math.round(w));
  let bh = Math.max(64, Math.round(h));
  const cap = Math.min(LOGICAL_CAP, PHYS_CAP / Math.max(0.45, density));
  const m = Math.max(bw, bh);
  if (m > cap) {
    const s = cap / m;
    bw = Math.max(64, Math.round(bw * s));
    bh = Math.max(64, Math.round(bh * s));
  }
  return [bw, bh];
}

/**
 * Synchronous render: figure = mount box (boxW×boxH logical pixels) -> Python init/update -> raster.
 *
 * We no longer infer a "content aspect ratio" from xlim/ylim and meet it into the box: the data range is not the frame aspect ratio (a bar chart with x∈[0.5,8.5],
 * y∈[0,1.25] would be computed as a 6.4:1 strip). Figures that need locked geometric proportions call ax.set_aspect('equal') themselves.
 */
export function mplRenderHref(rawCode: string, p: unknown, blit = false, instanceId?: string, boxW = BUF_W, boxH = BUF_H): string | null {
  const code = decodeCodeEntities(rawCode);
  const codeId = hashCode(code);
  const renderKey = renderKeyFor(codeId, instanceId);
  const href = `sync-mpl:${renderKey}`;
  const held = renderedKeys.has(renderKey) ? href : null;
  if (!pyodideReady() || !pyDraw) {
    mplEnsureInit();
    return held;
  }
  invalidateIfDensityChanged();
  const pJson = JSON.stringify(p ?? {});
  const sig = JSON.stringify([pJson, blit]);
  if (held && lastSigByKey.get(renderKey) === sig) return held;
  if (!seekExact()) {
    const now = perfNow();
    // Light figures (previous frame within budget - the blit path almost always) are not rate-limited at all and follow the full display refresh rate;
    // only heavy figures stay capped at ~50% duty cycle via "rest as long as you drew" - Pyodide runs synchronously on the main thread,
    // and leaving no gaps would starve gsap, the compositor and every other component on screen. The timestamp is still taken at the end of the draw,
    // which is exactly how this duty cycle is defined (unlike three/p5: GPU submission is async, so there the reference point must be the start of the draw).
    const lastMs = lastDrawMsByKey.get(renderKey) ?? 0;
    const window = lastMs > REDRAW_BUDGET_MS ? lastMs : 0;
    if (window > 0 && held && now - (lastDrawAtByKey.get(renderKey) ?? -1e9) < window) {
      if (!pendingRedrawKeys.has(renderKey)) {
        pendingRedrawKeys.add(renderKey);
        const wait = window - (now - (lastDrawAtByKey.get(renderKey) ?? 0));
        setTimeout(() => {
          pendingRedrawKeys.delete(renderKey);
          requestPyodideRedraw();
        }, Math.max(1, Math.ceil(wait)));
      }
      return held;
    }
  }
  try {
    if (!ensureCodeLoaded(codeId, code)) return held;
    syncPyodideTheme();
    const density = displayScale();
    const [capW, capH] = renderPixels(boxW, boxH, density);
    const t0 = perfNow();
    const arr = pyDraw(codeId, pJson, blit, capW, capH, density, renderKey);
    const buf = arr.getBuffer('u8');
    const bh = buf.shape?.[0] ?? capH;
    const bw = buf.shape?.[1] ?? capW;
    const cv = getRenderCanvas(renderKey, bw, bh);
    const cctx = cv.getContext('2d');
    if (cctx) {
      const data = new Uint8ClampedArray(buf.data.slice().buffer);
      cctx.putImageData(new ImageData(data, bw, bh), 0, 0);
    }
    lastRasterByKey.set(renderKey, [bw, bh]);
    buf.release();
    (arr as unknown as { destroy?(): void }).destroy?.();
    renderedKeys.add(renderKey);
    lastSigByKey.set(renderKey, sig);
    lastDrawMsByKey.set(renderKey, perfNow() - t0);
    lastDrawAtByKey.set(renderKey, perfNow());
    markSyncDraw(href);
    return href;
  } catch (e) {
    /* A Python error in init / update. Each one is reported only once: render runs every frame, and one line per frame would use up all six
       pageErrors slots in the framing receipt, hiding every other error. */
    const why = errorMessage(e);
    if (!renderErrorsSeen.has(`${renderKey}:${why}`)) {
      renderErrorsSeen.add(`${renderKey}:${why}`);
      // eslint-disable-next-line no-console
      console.error(`[mpl] render failed: ${why}`);
    }
    return held;
  }
}

/** Most recent raster size (null if none); used to meet the debug content rect into the mount box. */
export function mplLastRasterForCode(rawCode: string, instanceId?: string): [number, number] | null {
  const code = decodeCodeEntities(rawCode);
  const renderKey = renderKeyFor(hashCode(code), instanceId);
  return lastRasterByKey.get(renderKey) ?? null;
}

/**
 * Asset readiness probe (playback gate): can this code produce a real frame synchronously right now?
 * If ready, it also compiles the code into Python (synchronous, idempotent); if heavy packages are missing, it triggers on-demand install and returns false.
 * If the figure draws CJK text, it also waits for the CJK font to be registered (otherwise the first frame shows tofu boxes).
 * The player starts only once every probe is ready - users never see the warming placeholder.
 */
export function mplReadyFor(rawCode: string): boolean {
  if (typeof document === 'undefined') return true;
  const code = decodeCodeEntities(rawCode);
  if (!code) return true;
  if (!pyodideReady() || !pyDraw) {
    mplEnsureInit();
    return false;
  }
  if (/[\u3000-\u9fff\uf900-\ufaff]/.test(code) && !cjkFontSettled) return false;
  const codeId = hashCode(code);
  // The code itself is broken (syntax error, missing package): this cell will never render and must not hold up the whole film's start or export.
  if (codeLoadFailed(codeId)) return true;
  try {
    return ensureCodeLoaded(codeId, code) || codeLoadFailed(codeId);
  } catch {
    return true;
  }
}

/* Harness registration stays at import time: it is pure bookkeeping, downloads nothing, and must happen before the first ensurePyodide
   (it declares which packages to install). The step that actually starts fetching Pyodide (mplEnsureInit) isn't here -
   the film host imports this module too, and nine out of ten films have no mpl figure; they shouldn't all download a dozen-plus MB of wasm.
   The scene playback package wants instant playback, so playback-mpl calls warmMplRuntime() explicitly; on the film side
   the first real Mpl render's ready()/render() ensures it itself - only the first frame is slower, and the packs-ready gate covers that. */
registerPyodideHarness(mplHarness);

/** The warmup for instant playback - called by the scene playback entry (playback-mpl), no longer an import side effect. */
export function warmMplRuntime(): void {
  mplEnsureInit();
}

/**
 * Get this figure's offscreen canvas by href (mplRenderHref's return value is the key here).
 *
 * For film's paint path: film pack components emit real DOM `<svg>`, where the `sync-mpl:` token is dead
 * (the browser loads it as a URL, ERR_UNKNOWN_URL_SCHEME) - so the film side skips the render token and
 * drawImages this canvas straight into its own canvas (see stem's mpl-film.ts).
 */
export function mplRasterSource(href: string): CanvasImageSource | null {
  return canvasByKey.get(href.slice('sync-mpl:'.length)) ?? null;
}
