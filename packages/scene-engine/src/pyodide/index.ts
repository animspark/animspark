/**
 * @animspark/scene-engine/pyodide: the shared in-browser Pyodide runtime (harness manager).
 *
 * Why centralize: several Scene packages want to run Python in the browser (matplotlib for scientific
 *   plots, PIL for image processing...). Pyodide (WASM) is heavy and must never be loaded once per
 *   package; and the engine's synchronous raster seam, setSyncImageResolver, is a last-registration-wins
 *   singleton, so packages registering separately would overwrite each other. So this module owns:
 *     1. one Pyodide instance (a singleton, lazy-loaded on demand, warmed up for instant playback);
 *     2. one harness registry (matplotlib / pil / ...), where each harness declares its core packages,
 *        warm-up packages and Python harness;
 *     3. one dispatching resolver that routes by href prefix (sync-mpl: / sync-pil: ...) to the right
 *        harness's slot image;
 *     4. palette broadcast: pushes the current runtime palette to every harness (each maps it into its
 *        own domain, e.g. rcParams / a THEME dict).
 *
 * Key fact: once Pyodide is ready, runPython is a synchronous call, which fits the synchronous contract
 * of ComponentDef.render.
 *
 * Browser only: every DOM/Pyodide access is guarded at call time; Node (the validation pass) never gets
 * here (component render checks for document first).
 */
import { setSyncImageResolver, requestPlaybackRedraw } from '../render/canvas';
import { currentTheme, type ThemePalette } from '../core/tokens';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js';
const PYODIDE_CACHE_NAME = 'animspark-pyodide-0.27.2';

/**
 * Get Cache Storage, or null if unavailable.
 *
 * The read itself must be wrapped in try: a public playback iframe (showcase/share) is
 * sandbox="allow-scripts" without allow-same-origin, i.e. an opaque origin, where reading window.caches
 * throws SecurityError. Even `typeof caches` throws (typeof only protects undeclared identifiers, not a
 * getter that throws). That path has no Cache Storage and falls back to the browser HTTP cache
 * (jsDelivr's max-age is long enough).
 */
function cacheStorageOrNull(): CacheStorage | null {
  try {
    return typeof caches === 'undefined' ? null : caches;
  } catch {
    return null;
  }
}

/** Pyodide packages and CJK fonts: both are heavy and both gate mpl playback start, so both go through the cache + heartbeat. */
function isHeavyRuntimeAsset(url: string): boolean {
  return url.includes('cdn.jsdelivr.net/pyodide/')
    || url.includes('cdn.jsdelivr.net/gh/notofonts/');
}

/**
 * Pin jsDelivr Pyodide/font assets into Cache Storage (shared per playback origin).
 * The parent page (web) and the iframe (the engine's blob) are cross-origin, so HTTP cache partitioning
 * does not help; caching has to happen inside the iframe. The first open downloads and stores; later
 * films on the same origin, or reopening, go through cache.match instead of re-fetching tens of MB.
 * Sandboxed playback has no Cache Storage (see cacheStorageOrNull); then only the heartbeat runs, no caching.
 * The heartbeat __animsparkPyodideFetchInflight / LastActiveTs is the only signal the readiness gate has
 * for "still actively loading"; without it the timeout fallback would falsely declare ready mid-download
 * (audio starts, visuals freeze), so it must be installed whether or not there is a cache.
 */
function installPyodideFetchCache(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & {
    __animsparkPyodideFetchCached?: boolean;
    __animsparkPyodideFetchInflight?: number;
    __animsparkPyodideLastActiveTs?: number;
  };
  if (w.__animsparkPyodideFetchCached) return;
  if (typeof fetch !== 'function') return;
  w.__animsparkPyodideFetchInflight = 0;
  w.__animsparkPyodideLastActiveTs = Date.now();
  const cacheApi = cacheStorageOrNull();
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input);
    if (!isHeavyRuntimeAsset(url)) {
      return nativeFetch(input, init);
    }
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    w.__animsparkPyodideFetchInflight = (w.__animsparkPyodideFetchInflight ?? 0) + 1;
    w.__animsparkPyodideLastActiveTs = Date.now();
    try {
      if (cacheApi && method === 'GET') {
        const cache = await cacheApi.open(PYODIDE_CACHE_NAME);
        const hit = await cache.match(url);
        if (hit) return hit.clone();
        const res = await nativeFetch(input, init);
        if (res.ok) {
          try { await cache.put(url, res.clone()); } catch { /* quota */ }
        }
        return res;
      }
      return await nativeFetch(input, init);
    } catch {
      return nativeFetch(input, init);
    } finally {
      w.__animsparkPyodideFetchInflight = Math.max(0, (w.__animsparkPyodideFetchInflight ?? 1) - 1);
      w.__animsparkPyodideLastActiveTs = Date.now();
    }
  };
  // Set the flag only once the wrapped fetch is really in place: setting it early would, on an error midway,
  // deadlock the bootstrap script in <head> against this code; the flag would say "installed" while
  // window.fetch was still native, and the heartbeat would never move.
  w.__animsparkPyodideFetchCached = true;
}

/** Minimal Pyodide runtime contract (harnesses use it to run Python / install packages / write the FS). */
export interface PyodideAPI {
  loadPackage(names: string[]): Promise<void>;
  loadPackagesFromImports(code: string): Promise<void>;
  runPython(code: string): unknown;
  globals: { get(name: string): unknown };
  FS: { mkdir(path: string): void; writeFile(path: string, data: Uint8Array): void };
  /** Pyodide's authoritative table of installed packages (name → source channel); harnesses use it to tell exactly whether a package is ready. */
  loadedPackages?: Record<string, string>;
}

/** Theme broadcast payload: a palette normalized from the current ThemePalette (each harness maps it itself). */
export type PyodideThemePayload = Record<string, string>;

/**
 * A Python render backend harness. Every Scene package that wants to run Python registers one.
 * - id/syncPrefix: identity and sync raster href prefix (e.g. 'mpl' / 'sync-mpl:').
 * - corePackages: needed for the first frame, installed eagerly (merged into the core loadPackage and installed in one go).
 * - warmPackages: heavier, warmed up in the background once ready (download + cache) so they play instantly when used.
 * - init: runs once when the core packages are ready (exec your Python harness, capture _load/_draw etc. in a closure).
 * - warmup: async background work (e.g. fetching CJK fonts); the engine redraws a frame when it finishes.
 * - applyTheme: called when the theme changes (maps the palette into the domain, e.g. matplotlib rcParams).
 * - resolve: resolves a sync href known to belong to this harness into a directly drawable bitmap source.
 */
export interface PyodideHarness {
  id: string;
  syncPrefix: string;
  corePackages: string[];
  warmPackages?: string[];
  init(py: PyodideAPI): void;
  warmup?(py: PyodideAPI): Promise<void> | void;
  applyTheme?(py: PyodideAPI, theme: PyodideThemePayload): void;
  resolve(href: string): CanvasImageSource | null;
}

let pyodide: PyodideAPI | null = null;
let initState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let resolverRegistered = false;

const harnesses: PyodideHarness[] = [];
const inited = new Set<string>();
const warmStarted = new Set<string>();
const warmComplete = new Set<string>();
const lastThemeSig = new Map<string, string>();

export type PyodideLoadPhase = 'idle' | 'loading' | 'core_ready' | 'warming' | 'warm' | 'failed';

export interface PyodideLoadStatus {
  phase: PyodideLoadPhase;
  detail: string;
  /** Coarse 0–1, for the player to show download progress */
  progress: number;
}

let loadStatus: PyodideLoadStatus = { phase: 'idle', detail: '', progress: 0 };
const statusListeners = new Set<(s: PyodideLoadStatus) => void>();

function emitPyodideStatus(phase: PyodideLoadPhase, detail: string, progress: number): void {
  loadStatus = { phase, detail, progress: Math.max(0, Math.min(1, progress)) };
  for (const cb of statusListeners) cb(loadStatus);
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: 'animspark:pyodide-status', ...loadStatus }, '*');
    } catch { /* noop */ }
  }
}

/** Current Pyodide load/warm-up progress (browser only). */
export function getPyodideLoadStatus(): PyodideLoadStatus {
  return loadStatus;
}

/** Subscribe to progress changes; if loading is already under way, calls back once immediately. */
export function subscribePyodideStatus(cb: (s: PyodideLoadStatus) => void): () => void {
  statusListeners.add(cb);
  if (loadStatus.phase !== 'idle') cb(loadStatus);
  return () => { statusListeners.delete(cb); };
}

/** Start the Pyodide download as early as possible (idempotent); callable from the playback entry and the player. */
export function preloadPyodide(): void {
  if (typeof document === 'undefined') return;
  if (initState === 'idle') void init();
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-pyodide]')) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.pyodide = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load pyodide.js'));
    document.head.appendChild(s);
  });
}

/** The single dispatching resolver: routes by prefix to the right harness (registered once so packages never overwrite each other). */
function registerResolver(): void {
  if (resolverRegistered) return;
  resolverRegistered = true;
  setSyncImageResolver((href: string) => {
    for (const h of harnesses) {
      if (href.startsWith(h.syncPrefix)) return h.resolve(href) ?? null;
    }
    return null;
  });
}

function unionCorePackages(): string[] {
  const set = new Set<string>();
  for (const h of harnesses) for (const p of h.corePackages) set.add(p);
  return [...set];
}

function themePayload(): PyodideThemePayload | null {
  let t: ThemePalette;
  try {
    t = currentTheme();
  } catch {
    return null;
  }
  return {
    ink: t.ink,
    muted: t.muted,
    faint: t.faint,
    primary: t.primary,
    secondary: t.secondary ?? t.primary,
    accent: t.accent,
    magenta: t.magenta ?? t.accent,
    positive: t.positive,
    negative: t.negative,
    surface: t.surface,
    surfaceStroke: t.surfaceStroke ?? t.faint,
    accentBg: t.accentBg,
    bg: t.bg,
  };
}

/**
 * Broadcast the current theme to every initialized harness (free when the signature is unchanged).
 * Harnesses just call it before each frame's draw so the frame uses the right colors; skipped when the theme has not changed.
 */
export function syncPyodideTheme(): void {
  if (!pyodide) return;
  const payload = themePayload();
  if (!payload) return;
  const sig = JSON.stringify(payload);
  for (const h of harnesses) {
    if (!inited.has(h.id) || !h.applyTheme) continue;
    if (lastThemeSig.get(h.id) === sig) continue;
    try {
      h.applyTheme(pyodide, payload);
      lastThemeSig.set(h.id, sig);
    } catch {
      /* A failed theme mapping is not fatal: the image still draws, just with stale colors */
    }
  }
}

function initHarness(h: PyodideHarness): void {
  if (!pyodide || inited.has(h.id)) return;
  try {
    h.init(pyodide);
    inited.add(h.id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[pyodide] harness "${h.id}" init failed`, e);
  }
}

async function runWarm(h: PyodideHarness): Promise<void> {
  if (!pyodide || warmStarted.has(h.id)) return;
  warmStarted.add(h.id);
  const warmPkgs = h.warmPackages ?? [];
  emitPyodideStatus('warming', warmPkgs.length ? 'Pre-downloading scientific libraries…' : 'Pre-downloading resources…', 0.72);
  for (let i = 0; i < warmPkgs.length; i++) {
    const pkg = warmPkgs[i]!;
    emitPyodideStatus('warming', `Downloading ${pkg}…`, 0.72 + 0.18 * (i / Math.max(1, warmPkgs.length)));
    try {
      await pyodide.loadPackage([pkg]);
      requestPlaybackRedraw();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[pyodide] warm-up package "${pkg}" did not finish (it will be fetched on demand when used)`, e);
    }
  }
  emitPyodideStatus('warming', 'Downloading CJK fonts…', 0.93);
  try {
    await h.warmup?.(pyodide);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[pyodide] harness "${h.id}" warmup did not finish`, e);
  }
  warmComplete.add(h.id);
  emitPyodideStatus('warm', 'Chart resources ready', 1);
  requestPlaybackRedraw();
}

async function init(): Promise<void> {
  if (initState !== 'idle') return;
  initState = 'loading';
  emitPyodideStatus('loading', 'Downloading the Python engine…', 0.08);
  registerResolver();
  installPyodideFetchCache();
  try {
    await injectScript(PYODIDE_URL);
    emitPyodideStatus('loading', 'Initializing WASM…', 0.28);
    const loadPyodide = (globalThis as unknown as { loadPyodide: (o?: unknown) => Promise<PyodideAPI> }).loadPyodide;
    pyodide = await loadPyodide();
    emitPyodideStatus('loading', 'Loading numpy / matplotlib…', 0.48);
    const core = unionCorePackages();
    if (core.length) await pyodide.loadPackage(core);
    for (const h of harnesses) initHarness(h);
    initState = 'ready';
    emitPyodideStatus('core_ready', 'Chart engine ready, can play', 0.68);
    syncPyodideTheme();
    requestPlaybackRedraw();
    for (const h of harnesses) void runWarm(h);
  } catch (e) {
    initState = 'failed';
    emitPyodideStatus('failed', 'Failed to load the Python engine', 0);
    // eslint-disable-next-line no-console
    console.error('[pyodide] initialization failed', e);
  }
}

/**
 * Register a harness. Idempotent (each id registers once).
 * - Pyodide already ready: install this harness's core packages → init → broadcast theme → redraw → warm up in the background.
 * - Not ready yet: just record it; init() picks it up (package modules register on load, and the first
 *   ensurePyodide triggers the shared initialization).
 */
export function registerPyodideHarness(h: PyodideHarness): void {
  if (harnesses.some((x) => x.id === h.id)) return;
  harnesses.push(h);
  if (initState === 'ready' && pyodide) {
    void (async () => {
      try {
        if (h.corePackages.length) await pyodide!.loadPackage(h.corePackages);
        initHarness(h);
        syncPyodideTheme();
        requestPlaybackRedraw();
        void runWarm(h);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[pyodide] registering harness "${h.id}" failed`, e);
      }
    })();
  }
}

/** Trigger initialization (idempotent); while not ready the caller should draw a placeholder, and the engine is asked to redraw once ready. */
export function ensurePyodide(): void {
  if (typeof document === 'undefined') return;
  if (initState === 'idle') void init();
}

/** Whether Pyodide is ready (runPython/draw can be called synchronously). */
export function pyodideReady(): boolean {
  return initState === 'ready' && !!pyodide;
}

/** Get the raw Pyodide handle (for harnesses that need loadPackagesFromImports / FS etc.); null if not ready. */
export function getPyodide(): PyodideAPI | null {
  return pyodide;
}

/** Whether a harness's background warm-up has fully finished (gates whether code with heavy imports can compile synchronously). */
export function isHarnessWarm(id: string): boolean {
  return warmComplete.has(id);
}

/** Pass-through: ask the engine to redraw the current frame (to swap a placeholder for the real image once async resources are ready). */
export function requestPyodideRedraw(): void {
  requestPlaybackRedraw();
}
