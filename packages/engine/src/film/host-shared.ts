/**
 * Modules the host injects into the preview iframe; a film's imports of these are not fetched as npm
 * packages.
 *
 * Three places must agree. Miss one and you get "anim look all green, product preview blank":
 *   - this list
 *   - the modules code-host actually mounts on `__ANIM_MG_DEPS__`
 *   - `window.__FILM_SHARED_SPECS__`, which the host page writes for client-compile to read
 *
 * three / p5 / d3 are not here: they ship as files the browser can load directly, via /film-vendor.
 * TS source packages like `@animspark/data` have no single-file build, so they must be bundled into
 * the host.
 */
import { GSAP_PLUGIN_SHARED_SPECS } from '@animspark/film-build';

export const HOST_SHARED_SPECS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'gsap',
  'gsap/all',
  ...GSAP_PLUGIN_SHARED_SPECS,
  /* The official hook keeps its scope, deps and cleanup semantics; the host bridges its context to
     the film clock. */
  '@gsap/react',
  '@animspark/runtime',
  /* The film face of the scene package: stem resolves to its film entry (see stem/src/film.ts).
     Formula / CodeMorph / ExecutionTrace render synchronously; Mpl is swapped for the paint-based
     version (Pyodide loads lazily, so films without mpl charts download not one extra byte);
     imgproc is not exported (it belongs to @animspark/image). Neither heavy backend adds to host
     size: bundleHost marks MathJax external and the importmap pulls it on demand from /film-vendor
     (see mathjax-tex-svg.js in vendor.ts); mpl-runtime fetches Pyodide from a CDN on first real
     render. */
  '@animspark/stem',
  '@muspark/core',
  '@muspark/ui',
  '@muspark/ui/react',
] as const;

export type HostSharedSpec = (typeof HOST_SHARED_SPECS)[number];

export function isHostShared(spec: string): boolean {
  return (HOST_SHARED_SPECS as readonly string[]).includes(spec);
}

/** Lookup table for the iframe compiler: if `SHARED[spec]` is truthy, don't fetch from /film-vendor. */
export function hostSharedMap(): Record<string, true> {
  const out: Record<string, true> = {};
  for (const spec of HOST_SHARED_SPECS) out[spec] = true;
  return out;
}

/**
 * Specifiers that stem's formula backend (formula-runtime -> mathjax.ts) dynamically imports, each
 * with the named export it destructures.
 *
 * Both consumers must use this same table:
 *   - code-host writes the keys into the page importmap, all pointing at /film-vendor's
 *     mathjax-tex-svg.js;
 *   - vendor.ts generates that single-file ESM's re-export entry as "value from key". Exports are
 *     explicit names rather than `export *` because ESM **silently drops** colliding star exports,
 *     while a colliding named export is a compile error.
 * If the table drifts from mathjax.ts: extra importmap names 404 (formulas stay placeholders
 * forever), and names missing from the entry fail in the browser with "does not provide an export
 * named ...". Both are only visible with devtools open.
 */
export const MATHJAX_SPECS: Readonly<Record<string, string>> = {
  'mathjax-full/js/mathjax.js': 'mathjax',
  'mathjax-full/js/input/tex.js': 'TeX',
  'mathjax-full/js/output/svg.js': 'SVG',
  'mathjax-full/js/adaptors/liteAdaptor.js': 'liteAdaptor',
  'mathjax-full/js/handlers/html.js': 'RegisterHTMLHandler',
  'mathjax-full/js/input/tex/AllPackages.js': 'AllPackages',
};

/**
 * How text without a `font-family` renders.
 *
 * Without this, Chromium defaults to serif: a title nobody got around to styling renders in Times,
 * and nine-tenths of the text in a film should not be Times. All three pages (preview host,
 * frame-capture page, playback bundle) must use the same string, or you get the hardest-to-debug
 * kind of mismatch: "looks right in preview, wrong in the export".
 *
 * For other fonts, set a font-library family name in style (mg manual references/fonts.md); this
 * is only the fallback.
 */
export const STAGE_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, '
  + '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
