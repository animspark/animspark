/**
 * p5.js (2D generative art) synchronous raster runtime.
 *
 * Author code provides draw(p, P) / optional setup(p); this package handles canvas creation, per-frame determinism
 * (automatic randomSeed/noiseSeed reseeding every frame), seek accuracy and the sync-p5: canvas seam.
 * Same structure as three-runtime; differences:
 *   - 2D canvases have no GPU context quota, so each code gets its own p5 instance with its own canvas, with no shared renderer/snapshot pool;
 *   - the p5 UMD crashes on a top-level import in Node (it reads window), so it must be dynamically imported behind a document guard;
 *     for the same reason p5 (~1MB min) is bundled only via this package's playback entry, only when used (zero cost otherwise).
 */
import {
  addSyncImageResolver,
  currentTheme,
  forcePaint,
  requestPlaybackRedraw,
  seekExact,
} from '@animspark/scene-engine/playback';

/** Logical canvas size (16:9); the component is fitted proportionally into its allotted box with preserveAspectRatio=meet. */
const BUF_W = 960;
const BUF_H = 540;
const SYNC_PREFIX = 'sync-p5:';
/** Max p5 instances kept resident at once (beyond this, LRU remove() frees the canvas and listeners). */
const SKETCH_CACHE_MAX = 4;

type ThemeMap = Record<string, string>;
/** Author-written setup()/draw(): evaluated at runtime via new Function, no static types. */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface SketchState {
  p: any;
  draw: (p: any, P: any) => void;
  themeSig: string;
  /** Default seed (code hash); a numeric P.seed scalar overrides it. */
  seed: number;
  host: HTMLDivElement;
}

/** p5 constructor (loaded dynamically); null = not ready. */
let P5Ctor: any = null;
let loading: Promise<void> | null = null;
let initFailed = false;
let resolverRegistered = false;

const sketchCache = new Map<string, SketchState>();
const hrefToCanvas = new Map<string, HTMLCanvasElement>();

/* Same redraw throttling as three-runtime: reuse the previous frame for the same P signature; yield the main thread
 * only when drawing truly can't keep up; seekExact guarantees an exact landing.
 *
 * Throttling only applies to scenes where a single frame truly exceeds the budget. The player runtime already merges
 * onUpdate/set-time into at most one paint per display frame, so adding a fixed floor only drops frames for nothing:
 * if the reference point is "when drawing finished", the next vsync is always one drawMs short of the previous one and
 * always just misses the threshold, so 60Hz drops to 30 and 120Hz drops to 40. The reference point must be "when this draw started". */
const REDRAW_BUDGET_MS = 8;
const lastSigByCode = new Map<string, string>();
const lastHrefByCode = new Map<string, string>();
const lastDrawAtByCode = new Map<string, number>();
const lastDrawMsByCode = new Map<string, number>();
let counter = 0;
const perfNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const THEME_FALLBACK: ThemeMap = {
  ink: '#e7ecf5', muted: '#94a3c4', faint: '#39426a',
  primary: '#4ea1ff', secondary: '#7cc4ff', accent: '#f4c542', magenta: '#c77dff',
  positive: '#46d39a', negative: '#ff6b6b', surface: '#1d2440', bg: '#0b1020',
};

function themePayload(): ThemeMap {
  try {
    const t = currentTheme();
    return {
      ink: t.ink, muted: t.muted, faint: t.faint,
      primary: t.primary, secondary: t.secondary ?? t.primary,
      accent: t.accent, magenta: t.magenta ?? t.accent,
      positive: t.positive, negative: t.negative,
      surface: t.surface, bg: t.bg,
    };
  } catch {
    return THEME_FALLBACK;
  }
}

/** Register the sync-p5: synchronous bitmap resolver (idempotent). */
function ensureResolver(): void {
  if (resolverRegistered) return;
  resolverRegistered = true;
  addSyncImageResolver((href: string) =>
    href.startsWith(SYNC_PREFIX) ? (hrefToCanvas.get(href) ?? null) : null,
  );
}
ensureResolver();

/**
 * Physical resolution: logical coordinates are always 960×540 (= half the native 1920×1080 stage).
 * Protocol: s in __animsparkDisplayScale = "multiplier relative to the native stage":
 *   s=1 → density 2 (1920×1080 physical, 1080p 1:1, the sharpness baseline);
 *   s=2 → density 4 (3840×2160 physical, 4K export);
 *   low-end devices may drop to s≈0.45 to keep frame rate. Default s=1.
 */
const STAGE_SCALE_DEFAULT = 1;
const STAGE_SCALE_MAX = 2;

function displayScale(): number {
  const raw = typeof window !== 'undefined'
    ? (window as unknown as { __animsparkDisplayScale?: number }).__animsparkDisplayScale
    : STAGE_SCALE_DEFAULT;
  const s = Number.isFinite(raw) && (raw as number) > 0
    ? Math.min(STAGE_SCALE_MAX, Math.max(0.45, raw as number))
    : STAGE_SCALE_DEFAULT;
  // density = 2×s: logical 960 → physical 1920×s.
  return 2 * s;
}

let lastDisplayScale = 1;
function syncDisplayScale(): void {
  const sc = displayScale();
  if (sc === lastDisplayScale) return;
  lastDisplayScale = sc;
  // Logical coordinates stay 960×540 and physical resolution goes through pixelDensity; after a change, clear the signature cache to force a redraw.
  for (const st of sketchCache.values()) {
    try { st.p.pixelDensity(sc); } catch { /* one broken instance must not block the rest */ }
  }
  lastSigByCode.clear();
  lastHrefByCode.clear();
}

/**
 * Whether the library can produce real frames yet (a failed load also counts as "ready": a placeholder frame beats never starting playback).
 * Used by the component's ready probe as a playback gate: a film containing <P5> broadcasts animspark:ready only once the library is in place.
 */
export function p5LibReady(): boolean {
  return P5Ctor != null || initFailed;
}

/**
 * Trigger loading of the p5 library (idempotent); callers draw a placeholder until ready.
 * Once loaded, it proactively requests a repaint so the placeholder is replaced with the real frame even while paused.
 */
export function p5EnsureInit(): void {
  if (P5Ctor || initFailed || typeof document === 'undefined') return;
  if (loading) return;
  loading = import('p5')
    .then((mod) => {
      P5Ctor = (mod as { default?: unknown }).default ?? mod;
      requestPlaybackRedraw();
    })
    .catch((error) => {
      initFailed = true;
      // eslint-disable-next-line no-console
      console.error('[animspark/p5] p5 failed to load', error);
    });
}

function hashCode(code: string): string {
  let h = 5381;
  for (let i = 0; i < code.length; i++) {
    h = ((h << 5) + h + code.charCodeAt(i)) | 0;
  }
  return 'p' + (h >>> 0).toString(36) + code.length.toString(36);
}

function disposeSketch(st: SketchState): void {
  try { st.p.remove(); } catch { /* failing to release is not fatal */ }
}

/** Compile author code and create the p5 instance (canvas created by the system, noLoop; redraws are driven only by the timeline). */
function buildSketch(code: string, theme: ThemeMap, themeSig: string): SketchState | null {
  let setup: unknown;
  let draw: unknown;
  try {
    const factory = new Function(
      'THEME', 'WIDTH', 'HEIGHT',
      `${code}\n;return {`
      + `setup: typeof setup === 'function' ? setup : null,`
      + `draw: typeof draw === 'function' ? draw : null };`,
    );
    const fns = factory(theme, BUF_W, BUF_H) as { setup: unknown; draw: unknown };
    setup = fns.setup;
    draw = fns.draw;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[animspark/p5] code failed to compile', error);
    return null;
  }
  if (typeof draw !== 'function') {
    // eslint-disable-next-line no-console
    console.error('[animspark/p5] no draw(p, P): define function draw(p, P) to repaint the whole frame at the current moment.');
    return null;
  }
  // Mount on a detached div: the canvas never enters the document, 2D drawing works as usual, and snapshots go through the sync-p5: seam.
  const host = document.createElement('div');
  let ready: any = null;
  let setupError: unknown = null;
  try {
    const instance = new P5Ctor((p: any) => {
      p.setup = () => {
        p.createCanvas(BUF_W, BUF_H);
        p.pixelDensity(displayScale());
        p.noLoop();
        p.clear();
        try {
          (setup as ((p: any) => void) | null)?.(p);
        } catch (error) {
          setupError = error;
        }
        ready = p;
      };
    }, host);
    void instance;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[animspark/p5] could not create the p5 instance', error);
    return null;
  }
  if (setupError) {
    // eslint-disable-next-line no-console
    console.error('[animspark/p5] setup(p) threw', setupError);
  }
  if (!ready || !ready.canvas) {
    // Without preload, p5 1.x finishes setup synchronously; reaching here means the version behaves unexpectedly.
    // eslint-disable-next-line no-console
    console.error('[animspark/p5] the canvas is not ready (p5 setup did not finish synchronously)');
    return null;
  }
  return {
    p: ready,
    draw: draw as SketchState['draw'],
    themeSig,
    seed: hashSeed(code),
    host,
  };
}

/** code → stable numeric seed (the default seed; P.seed can override it). */
function hashSeed(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getSketchState(
  codeId: string,
  code: string,
  theme: ThemeMap,
  themeSig: string,
): SketchState | null {
  const cached = sketchCache.get(codeId);
  if (cached && cached.themeSig === themeSig) return cached;
  if (cached) {
    disposeSketch(cached);
    sketchCache.delete(codeId);
  }
  const state = buildSketch(code, theme, themeSig);
  if (!state) return null;
  sketchCache.set(codeId, state);
  if (sketchCache.size > SKETCH_CACHE_MAX) {
    const oldest = sketchCache.keys().next().value as string | undefined;
    if (oldest && oldest !== codeId) {
      disposeSketch(sketchCache.get(oldest)!);
      sketchCache.delete(oldest);
    }
  }
  return state;
}

/**
 * Synchronously render one frame and return a sync-p5: href; returns null when the p5 library isn't ready or compilation
 * failed (the caller draws a placeholder).
 *
 * Determinism contract: randomSeed/noiseSeed are reseeded before every frame's draw, so the same P always yields the same
 * image regardless of seek order. Randomness that changes over time must come from the author feeding a P scalar into
 * noise coordinates, not from advancing the random() sequence across frames.
 */
export function p5RenderHref(code: string, p: unknown): string | null {
  if (!P5Ctor) {
    p5EnsureInit();
    return null;
  }
  if (typeof document === 'undefined') return null;
  try {
    syncDisplayScale();
    const theme = themePayload();
    const themeSig = JSON.stringify(theme);
    const codeId = hashCode(code);
    const sig = JSON.stringify(p ?? {});
    const held = lastHrefByCode.get(codeId) ?? null;
    const now = perfNow();
    if (!seekExact()) {
      if (held && lastSigByCode.get(codeId) === sig) return held;
      // Previous frame within budget → no throttling, keep up with the full display refresh rate; only over budget do we leave an equal main-thread gap.
      const lastMs = lastDrawMsByCode.get(codeId) ?? 0;
      if (held && lastMs > REDRAW_BUDGET_MS
        && now - (lastDrawAtByCode.get(codeId) ?? -1e9) < lastMs) return held;
    } else if (held && !forcePaint()) {
      if (lastSigByCode.get(codeId) === sig) return held;
      if (now - (lastDrawAtByCode.get(codeId) ?? -1e9) < 33) return held;
    }

    const state = getSketchState(codeId, code, theme, themeSig);
    if (!state) return null;

    const params = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const seed = typeof params.seed === 'number' && Number.isFinite(params.seed)
      ? params.seed
      : state.seed;

    const startedAt = perfNow();
    const sketch = state.p;
    sketch.randomSeed(seed);
    sketch.noiseSeed(seed);
    sketch.push();
    sketch.clear();
    try {
      state.draw(sketch, params);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[animspark/p5] draw(p, P) threw', error);
    } finally {
      sketch.pop();
      // Defensive: if author code called loop()/frameRate(), switch the self-driven loop back off.
      try { if (sketch.isLooping?.()) sketch.noLoop(); } catch { /* ignore */ }
    }

    const prev = lastHrefByCode.get(codeId);
    if (prev) hrefToCanvas.delete(prev);
    const href = `${SYNC_PREFIX}${codeId}:${++counter}`;
    hrefToCanvas.set(href, sketch.canvas as HTMLCanvasElement);
    lastSigByCode.set(codeId, sig);
    lastHrefByCode.set(codeId, href);
    lastDrawMsByCode.set(codeId, perfNow() - startedAt);
    lastDrawAtByCode.set(codeId, startedAt);
    return href;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[animspark/p5] render failed', error);
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
