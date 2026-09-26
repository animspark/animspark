/**
 * three.js (WebGL) synchronous raster runtime.
 *
 * Author code provides setup() / update(s, P); this package handles the shared WebGLRenderer, per-frame rendering,
 * seek accuracy and the sync-three: canvas seam. Enters the player bundle with the animspark/three package, only when used.
 */
import * as THREE from 'three';
import {
  addSyncImageResolver,
  currentTheme,
  forcePaint,
  seekExact,
} from '@animspark/scene-engine/playback';

/**
 * Logical coordinate system of author code (16:9), i.e. the injected WIDTH/HEIGHT; physical render size = this × displayScale.
 * The component is fitted proportionally into its allotted box with preserveAspectRatio=meet.
 */
const BUF_W = 960;
const BUF_H = 540;
/**
 * Each three instance (keyed by code) owns one snapshot canvas, so multiple instances in the same frame never overwrite each other.
 * No rotating pool: rotation would grow every slot to render resolution (4 slots ≈ 130MB at 4K), while usually only one instance is on screen.
 */
const SYNC_PREFIX = 'sync-three:';
/** Number of href → canvas entries kept: enough to resolve across a few frames; only prevents the Map from growing forever. */
const HREF_RETAIN = 8;
/** Max compiled scenes kept resident at once (beyond this, GPU resources are released LRU). */
const SCENE_CACHE_MAX = 4;

type ThemeMap = Record<string, string>;
/** Author-written setup()/update(): typed as any (evaluated at runtime via new Function, no static types). */
/* eslint-disable @typescript-eslint/no-explicit-any */
type SceneRaw = Record<string, any> & { scene?: unknown; camera?: unknown };
interface SceneState {
  scene: THREE.Scene;
  camera: THREE.Camera;
  raw: SceneRaw;
  update: ((s: SceneRaw, P: any) => void) | null;
  /** Author-provided frame output (EffectComposer etc.); defaults to renderer.render. */
  render: ((r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera) => void) | null;
  /** Notifies the author when the render size changes (composer/RT must setSize accordingly). */
  resize: ((w: number, h: number) => void) | null;
  /** Frees author-created GPU resources (a composer's RenderTarget etc.) when the scene is evicted. */
  dispose: (() => void) | null;
  sizedW: number;
  sizedH: number;
  themeSig: string;
}

/**
 * Official three addons (Sky / Reflector / EffectComposer / the Loaders...).
 *
 * This package cannot import them itself: examples/jsm has 268 modules, and pulling them all in would saddle every
 * film with several MB of dead code. Instead the player runtime injects what this film actually uses: the bundler
 * only includes the submodules the author imported, and that small set is what arrives here.
 */
const addonRegistry: Record<string, unknown> = Object.create(null);

/** Called by the player runtime before building the film; hands this film's bundled addons to the <Three /> code scope. */
export function threeRegisterAddons(ns: Record<string, unknown> | null | undefined): void {
  if (!ns) return;
  for (const key of Object.keys(ns)) addonRegistry[key] = ns[key];
  // Compiled scenes were built in the old scope; a new set of addons means rebuilding them.
  for (const st of sceneCache.values()) disposeScene(st);
  sceneCache.clear();
  lastSigByCode.clear();
  lastHrefByCode.clear();
}

let renderer: THREE.WebGLRenderer | null = null;
let initFailed = false;
let resolverRegistered = false;

const snapshotByCode = new Map<string, HTMLCanvasElement>();
const slotById = new Map<string, HTMLCanvasElement>();
let counter = 0;

const sceneCache = new Map<string, SceneState>();

/* Decouple WebGL redraw rate from display frame rate:
 * ① reuse the previous frame for the same P signature; ② yield the main thread only when drawing truly can't keep up;
 * ③ guarantee an exact landing on seekExact.
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
const perfNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const THEME_FALLBACK: ThemeMap = {
  ink: '#e7ecf5', muted: '#94a3c4', faint: '#39426a',
  primary: '#4ea1ff', secondary: '#7cc4ff', accent: '#f4c542', magenta: '#c77dff',
  positive: '#46d39a', negative: '#ff6b6b', surface: '#1d2440', bg: '#0b1020',
};

/** Normalize the current theme palette into a flat hex map (the THEME injected into author code). */
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

/** Register the sync-three: synchronous bitmap resolver (idempotent). */
function ensureResolver(): void {
  if (resolverRegistered) return;
  resolverRegistered = true;
  addSyncImageResolver((href: string) =>
    href.startsWith(SYNC_PREFIX) ? (slotById.get(href) ?? null) : null,
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
function invalidateIfDisplayScaleChanged(): void {
  const sc = displayScale();
  if (sc === lastDisplayScale) return;
  lastDisplayScale = sc;
  lastSigByCode.clear();
  lastHrefByCode.clear();
}

/** Lazily create the shared WebGLRenderer. Returns null outside a browser or if initialization fails. */
function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer) {
    const sc = displayScale();
    const w = Math.max(320, Math.round(BUF_W * sc));
    const h = Math.max(180, Math.round(BUF_H * sc));
    renderer.setSize(w, h, false);
    return renderer;
  }
  if (initFailed || typeof document === 'undefined') return null;
  try {
    const sc = displayScale();
    const w = Math.max(320, Math.round(BUF_W * sc));
    const h = Math.max(180, Math.round(BUF_H * sc));
    const r = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    r.setClearColor(0x000000, 0);
    renderer = r;
    return r;
  } catch (error) {
    initFailed = true;
    // eslint-disable-next-line no-console
    console.error('[animspark/three] WebGL failed to initialise', error);
    return null;
  }
}

/** Trigger initialization (idempotent); callers draw a placeholder until ready. */
export function threeEnsureInit(): void {
  getRenderer();
}

function hashCode(code: string): string {
  let h = 5381;
  for (let i = 0; i < code.length; i++) {
    h = ((h << 5) + h + code.charCodeAt(i)) | 0;
  }
  return 't' + (h >>> 0).toString(36) + code.length.toString(36);
}

/** Release a scene's GPU resources to avoid leaks after a code or theme change. */
function disposeScene(st: SceneState): void {
  // Author-created RenderTargets (composer, Reflector...) are not in the scene graph and traverse can't find them,
  // so only the author can free them; one 4K RT is tens of MB of VRAM, and leaking a few rounds runs out of memory.
  try {
    st.dispose?.();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[animspark/three] dispose() threw', error);
  }
  try {
    st.scene.traverse((obj: THREE.Object3D) => {
      const candidate = obj as unknown as {
        geometry?: { dispose?(): void };
        material?: { dispose?(): void } | Array<{ dispose?(): void }>;
      };
      candidate.geometry?.dispose?.();
      const material = candidate.material;
      if (Array.isArray(material)) material.forEach((item) => item?.dispose?.());
      else material?.dispose?.();
    });
  } catch {
    /* failing to release is not fatal */
  }
}

/**
 * Compile author code and run setup(). Returns null on failure.
 *
 * setup(ctx) gets the shared renderer and this film's addons, so native techniques that "must hold the renderer",
 * like Reflector and EffectComposer, work here too; returning render() takes over frame output.
 */
function buildScene(
  code: string,
  theme: ThemeMap,
  themeSig: string,
  activeRenderer: THREE.WebGLRenderer,
): SceneState | null {
  let setup: unknown;
  let update: unknown;
  const w = activeRenderer.domElement.width;
  const h = activeRenderer.domElement.height;
  try {
    const factory = new Function(
      'THREE', 'ADDONS', 'RENDERER', 'THEME', 'WIDTH', 'HEIGHT',
      `${code}\n;return {`
      + `setup: typeof setup === 'function' ? setup : null,`
      + `update: typeof update === 'function' ? update : null };`,
    );
    const fns = factory(THREE, addonRegistry, activeRenderer, theme, BUF_W, BUF_H) as {
      setup: unknown;
      update: unknown;
    };
    setup = fns.setup;
    update = fns.update;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[animspark/three] code failed to compile', error);
    return null;
  }
  if (typeof setup !== 'function') {
    // eslint-disable-next-line no-console
    console.error('[animspark/three] no setup(): define function setup() returning { scene, camera, ... }');
    return null;
  }
  let raw: SceneRaw;
  try {
    raw = ((setup as (ctx: unknown) => SceneRaw)({
      renderer: activeRenderer, addons: addonRegistry, width: w, height: h, THREE,
    }) ?? {}) as SceneRaw;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[animspark/three] setup() threw', error);
    return null;
  }
  const scene = raw.scene;
  const camera = raw.camera;
  if (!(scene instanceof THREE.Scene) || !(camera instanceof THREE.Camera)) {
    // eslint-disable-next-line no-console
    console.error('[animspark/three] setup() has to return a THREE.Scene and a THREE.Camera');
    return null;
  }
  return {
    scene,
    camera,
    raw,
    update: typeof update === 'function' ? (update as SceneState['update']) : null,
    render: typeof raw.render === 'function' ? (raw.render as SceneState['render']) : null,
    resize: typeof raw.resize === 'function' ? (raw.resize as SceneState['resize']) : null,
    dispose: typeof raw.dispose === 'function' ? (raw.dispose as SceneState['dispose']) : null,
    sizedW: w,
    sizedH: h,
    themeSig,
  };
}

/** Get or lazily build scene state; rebuilt on theme change to keep colors in sync. */
function getSceneState(
  codeId: string,
  code: string,
  theme: ThemeMap,
  themeSig: string,
  activeRenderer: THREE.WebGLRenderer,
): SceneState | null {
  const cached = sceneCache.get(codeId);
  if (cached && cached.themeSig === themeSig) return cached;
  if (cached) {
    disposeScene(cached);
    sceneCache.delete(codeId);
  }
  const state = buildScene(code, theme, themeSig, activeRenderer);
  if (!state) return null;
  sceneCache.set(codeId, state);
  if (sceneCache.size > SCENE_CACHE_MAX) {
    const oldest = sceneCache.keys().next().value as string | undefined;
    if (oldest && oldest !== codeId) {
      disposeScene(sceneCache.get(oldest)!);
      sceneCache.delete(oldest);
      // The scene is gone and nothing references its snapshot canvas anymore; hand the pixel buffer back to the browser.
      const stale = snapshotByCode.get(oldest);
      if (stale) {
        stale.width = 0;
        stale.height = 0;
        snapshotByCode.delete(oldest);
      }
    }
  }
  return state;
}

/**
 * Synchronously render one frame and return a sync-three: href.
 * render() and the following canvas drawImage happen in the same synchronous frame, so the snapshot stays fresh.
 */
export function threeRenderHref(code: string, p: unknown): string | null {
  invalidateIfDisplayScaleChanged();
  const activeRenderer = getRenderer();
  if (!activeRenderer) {
    threeEnsureInit();
    return null;
  }
  try {
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

    const state = getSceneState(codeId, code, theme, themeSig, activeRenderer);
    if (!state) return null;

    const startedAt = perfNow();
    // The renderer size changed after a display density change: composer/RT are owned by the author, who must setSize them.
    const curW = activeRenderer.domElement.width;
    const curH = activeRenderer.domElement.height;
    if (state.resize && (curW !== state.sizedW || curH !== state.sizedH)) {
      try {
        state.resize(curW, curH);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[animspark/three] resize() threw', error);
      }
    }
    state.sizedW = curW;
    state.sizedH = curH;
    try {
      state.update?.(state.raw, p ?? {});
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[animspark/three] update(P) threw', error);
    }
    if (state.render) {
      try {
        state.render(activeRenderer, state.scene, state.camera);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[animspark/three] render() threw', error);
      }
      // The renderer is shared across the film: the author's composer may leave a different RT bound,
      // and without resetting it the next <Three /> instance would draw into someone else's texture.
      activeRenderer.setRenderTarget(null);
    } else {
      activeRenderer.render(state.scene, state.camera);
    }

    // Copy the snapshot 1:1 at the renderer's physical size. Shrinking to logical 960×540 and letting the host scale it
    // back up would throw away half the linear resolution (physical is already 1920×1080 at displayScale=1) and blur every edge.
    const rendererWidth = activeRenderer.domElement.width;
    const rendererHeight = activeRenderer.domElement.height;
    let canvas = snapshotByCode.get(codeId);
    if (!canvas) {
      canvas = document.createElement('canvas');
      snapshotByCode.set(codeId, canvas);
    }
    if (canvas.width !== rendererWidth || canvas.height !== rendererHeight) {
      canvas.width = rendererWidth;
      canvas.height = rendererHeight;
    }
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, rendererWidth, rendererHeight);
      context.drawImage(activeRenderer.domElement, 0, 0);
    }
    // href is unique per frame: the player layer uses whether it changed to tell "is this frame really a new image".
    const href = `${SYNC_PREFIX}${codeId}:${++counter}`;
    slotById.set(href, canvas);
    if (slotById.size > HREF_RETAIN) {
      const firstKey = slotById.keys().next().value as string | undefined;
      if (firstKey) slotById.delete(firstKey);
    }
    lastSigByCode.set(codeId, sig);
    lastHrefByCode.set(codeId, href);
    lastDrawMsByCode.set(codeId, perfNow() - startedAt);
    lastDrawAtByCode.set(codeId, startedAt);
    return href;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[animspark/three] render failed', error);
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
