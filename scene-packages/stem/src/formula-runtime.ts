/**
 * Formula browser runtime - LaTeX is rendered to SVG **live** in the browser, with no
 * server-side bake.
 *
 * Why live instead of pre-rendered: in the new architecture the picture is the source code;
 * there is no build step. And a formula spec may well be computed at runtime
 * (`tex: \`${fmt(v)}\\ \\text{N}\``); extracting it statically on the server would mean
 * evaluating the whole module graph first. So rendering can only happen where it naturally
 * belongs: in the browser running the film.
 *
 * How it stays synchronous: once MathJax is loaded, `tex2svg` is a synchronous call, and the
 * `ComponentDef.render` contract is synchronous too. So the whole pipeline has only one async
 * step: pulling the modules in the first time. Before that, `render` returns a placeholder box
 * and `ready()` reports false; afterwards **any moment, any frame** can produce the real image
 * on the spot, with no gap like "scrub to 01:30 and that formula hasn't compiled yet" that only
 * reproduces on one frame. This is the same thing mpl does with Pyodide.
 *
 * Instant playback: MathJax loading starts when warmFormulaRuntime() is called from the
 * playback entry (see below), rather than waiting for the first formula to enter the frame.
 */
import type { BakedResult } from '@animspark/scene-engine';
import { requestPlaybackRedraw } from '@animspark/scene-engine/playback';

import { compileFormula, formulaInk } from './formula-compile';
import { loadMathjax, mathjaxSync } from './mathjax';

const isBrowser = typeof document !== 'undefined';

/** Load state. `failed` is terminal: it will never become ready, so gates must not wait on it forever. */
type LoadState = 'idle' | 'loading' | 'ready' | 'failed';
let state: LoadState = 'idle';
let failures = 0;
const MAX_ATTEMPTS = 3;

/**
 * Compile result cache, key = spec + ink color.
 *
 * Caching is required: `render` is called every frame, and typesetting a multi-step derivation
 * runs MathJax dozens of times.
 * Ink must be part of the key: it comes from the theme (`resolveTone`), and when the theme
 * changes the same tex should re-render in the new color.
 * A value may be null: that records "this spec cannot be rendered", which must be kept distinct
 * from "not rendered yet", or it would be retried every frame.
 */
const cache = new Map<string, BakedResult | null>();
/** Keys already warned about. The same bad LaTeX should not log a line every frame. */
const warned = new Set<string>();

function keyOf(spec: unknown, ink: string): string | null {
  try {
    return `${ink}\u0000${typeof spec === 'string' ? spec : JSON.stringify(spec)}`;
  } catch {
    /* spec contains circular refs / functions etc., so no stable key. null = no caching; compute every frame as usual. */
    return null;
  }
}

function warm(): void {
  if (!isBrowser || state === 'loading' || state === 'ready' || state === 'failed') return;
  state = 'loading';
  void loadMathjax().then(
    () => {
      state = 'ready';
      /* Once loaded, explicitly request a repaint: the picture may be static right now (paused,
         frame-by-frame export) with no other reason to re-render, and render last returned a
         placeholder box. Without this frame, the formula would stay stuck on that spinner forever. */
      requestPlaybackRedraw();
    },
    (e: unknown) => {
      failures += 1;
      state = failures >= MAX_ATTEMPTS ? 'failed' : 'idle';
      console.warn(
        `[formula] MathJax did not come up (attempt ${failures}): ${e instanceof Error ? e.message : String(e)}`
        + (state === 'failed' ? ' — not retrying; formulas will stay as placeholders.' : ''),
      );
      if (state === 'failed') requestPlaybackRedraw();
    },
  );
}

/**
 * Can this formula slot show real content yet? The playback/export gate for `ComponentDef.ready`.
 *
 * Always true in Node (director validation, `anim doc`): there is no MathJax on that path, so
 * it must not count as "not ready".
 * Also true after a load failure: waiting longer won't change anything, so let the picture
 * proceed with placeholder boxes instead of hanging the export forever.
 */
export function formulaRuntimeReady(): boolean {
  if (!isBrowser) return true;
  if (state === 'ready' || state === 'failed') return true;
  warm();
  return false;
}

/**
 * Compile one spec live (synchronously). Returns null if MathJax is not loaded yet; the caller
 * should fall back to a placeholder box.
 *
 * The default ink follows the current theme.
 */
export function formulaLive(spec: unknown, ink: string = formulaInk()): BakedResult | null {
  if (!isBrowser) return null;
  const tex2svg = mathjaxSync();
  if (!tex2svg) {
    warm();
    return null;
  }
  const key = keyOf(spec, ink);
  if (key != null) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
  }
  let out: BakedResult | null = null;
  try {
    out = compileFormula(tex2svg, spec, ink);
  } catch (e) {
    /* Bad LaTeX must not crash React rendering: this slot falls back to a placeholder; the rest of the film carries on. */
    if (key != null && !warned.has(key)) {
      warned.add(key);
      console.warn(`[formula] this LaTeX will not render: ${e instanceof Error ? e.message : String(e)}`);
    }
    out = null;
  }
  if (key != null) cache.set(key, out);
  return out;
}

/**
 * The instant-playback warm-up - **called by the scene playback entry** (playback-formula),
 * no longer run on import.
 *
 * Why it moved out: the film host bundles this module into host.js, so the import happens
 * **every time** a preview opens. Left here, a film without a single formula would still pull
 * 1.8 MB of MathJax. On the film side, ready() warms on its own the first time a Formula
 * actually renders; only that slot's first frame is slow, and the packs-ready gate covers it.
 */
export function warmFormulaRuntime(): void {
  warm();
}
