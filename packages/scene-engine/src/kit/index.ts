/**
 * @animspark/scene-engine/kit: toolkit for package authors (pure functions, zero external dependencies).
 *
 * Shared escaping/value-reading/embedding/bounding-box logic for any Scene package component that is a
 * thin "standard format -> SVG" wrapper.
 * Exported from the engine (subpath @animspark/scene-engine/kit) so domain packages don't depend on each other.
 */
export { resolveCssVars } from '../core/tokens';

export const num = (v: unknown, dflt: number): number =>
  Number.isFinite(Number(v)) ? Number(v) : dflt;

export const str = (v: unknown, dflt = ''): string => (v == null ? dflt : String(v));

export const bool = (v: unknown, dflt: boolean): boolean =>
  typeof v === 'boolean' ? v : v == null ? dflt : v === 'true' || v === '1';

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** XML text escaping (for <text> content / attribute values) */
export const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Embed an already-rendered "complete SVG document string" into a w x h box.
 * - Parse the root <svg>'s viewBox (or width/height) to get its intrinsic coordinate system;
 * - Strip the root tag and wrap its children in a new <svg>, locking viewBox + preserveAspectRatio.
 * The returned fragment has no outer <g> (the engine renderer handles positioning/scaling).
 */
/**
 * Per-frame render cache: embedSvg's parseSvgRoot + contentBounds are full regex scans, and rerunning them
 * on the same input every frame for static (non-morphing) svg elements is pure waste (a noticeable share
 * of stutter in svg projects). Keying on "input string with template colors already resolved + box size +
 * alignment" is enough to hit: when morphing, src changes -> a natural miss; after a template re-skin,
 * svgDoc already carries the new colors -> the key changes, so stale colors are never served and there's
 * no theme-invalidation risk. An LRU cap prevents memory growth in long sessions.
 */
const embedSvgCache = new Map<string, string>();

export function embedSvg(svgDoc: string, w: number, h: number, align = 'xMidYMid meet'): string {
  const key = `${align}|${w.toFixed(1)}|${h.toFixed(1)}|${svgDoc}`;
  const cached = embedSvgCache.get(key);
  if (cached !== undefined) return cached;
  const out = embedSvgUncached(svgDoc, w, h, align);
  embedSvgCache.set(key, out);
  if (embedSvgCache.size > 256) {
    const first = embedSvgCache.keys().next().value;
    if (first !== undefined) embedSvgCache.delete(first);
  }
  return out;
}

function embedSvgUncached(svgDoc: string, w: number, h: number, align: string): string {
  const parsed = parseSvgRoot(svgDoc);
  if (!parsed) {
    return `<rect x="0" y="0" width="${w}" height="${h}" fill="none"/>`;
  }
  let { vbx, vby, vbw, vbh } = parsed;
  const { inner } = parsed;
  // "Layout must not overflow": models often draw outside the declared viewBox (out-of-range coordinates / strokes extending outward).
  // Here we expand the viewBox to "declared box U the content's real bounding box", then let preserveAspectRatio=meet scale it uniformly into the box.
  // Overflowing content is shrunk to the largest visible extent while the layout box (outer w/h) stays fixed; animation goes through the outer transform and is unaffected.
  const cb = contentBounds(inner);
  if (cb) {
    const x0 = Math.min(vbx, cb.x0);
    const y0 = Math.min(vby, cb.y0);
    const x1 = Math.max(vbx + vbw, cb.x1);
    const y1 = Math.max(vby + vbh, cb.y1);
    vbx = x0; vby = y0; vbw = x1 - x0; vbh = y1 - y0;
  }
  // Keep the viewBox origin (MathJax etc. use negative offsets; forcing 0 0 would clip part of it); declare the xlink namespace (MathJax/Vega use xlink:href)
  return `<svg x="0" y="0" width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="${fmt(vbx)} ${fmt(vby)} ${fmt(vbw)} ${fmt(vbh)}" preserveAspectRatio="${align}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;
}

/**
 * Inline an SVG whose viewBox is self-consistent and authoritative (e.g. Mafs output) into a w x h box.
 *
 * Key point: use <g transform="translate scale"> rather than a nested <svg> or a data-URI <image>.
 *  - Nested <svg>: resvg has a bug with it (empty bounding box unwrap -> panic), and we don't need a second clipping level anyway.
 *  - data-URI <image>: resvg doesn't render <text> inside images (labels/coordinates/integral values would all be lost).
 *  - <g transform>: resvg renders it reliably and text is rasterized normally via the main font library. We manually replicate
 *    preserveAspectRatio="xMidYMid meet" uniform scaling + centering math to fit the whole source viewBox into the box.
 *    contentBounds is not run (Mafs carries data coordinates in a matrix; scanning raw coordinates would mistake them for
 *    pixels and skew the bounding box). Morph re-renders every frame, and inlining adds no decode cost.
 */
export function embedSvgInline(svgDoc: string, w: number, h: number): string {
  const parsed = parseSvgRoot(svgDoc);
  if (!parsed) return `<rect x="0" y="0" width="${w}" height="${h}" fill="none"/>`;
  const { vbx, vby, vbw, vbh, inner } = parsed;
  const sStr = fmtScaleDown(Math.min(w / vbw, h / vbh) || 1);  // meet: uniform scale to fit the box
  const s = Number(sStr);            // centering must use the exact number written into the transform, or content drifts out of the box
  const tx = (w - vbw * s) / 2 - vbx * s;               // center + cancel the source viewBox origin offset
  const ty = (h - vbh * s) / 2 - vby * s;
  return `<g transform="translate(${fmt(tx)}, ${fmt(ty)}) scale(${sStr})">${inner}</g>`;
}

const svgImageHrefCache = new Map<string, string>();

/**
 * Embed a heavy baked SVG as a static image sprite.
 *
 * If the player's Canvas path nested the full SVG directly, every frame would make DOMParser parse the many
 * path/use/text nodes from MathJax/Vega/Graphviz and replay them node by node onto the Canvas. As an image,
 * the browser decodes it once and later animation frames only need drawImage + the outer transform/opacity,
 * leaving room for a steady 60fps.
 */
export function embedSvgImage(svgDoc: string, w: number, h: number, align = 'xMidYMid meet', opacity = 1): string {
  const href = svgImageHref(svgDoc);
  if (!href) return `<rect x="0" y="0" width="${w}" height="${h}" fill="none"/>`;
  // opacity<1: during an src transition (crossfade) the old/new layers are stacked; both Canvas and resvg honor <image opacity>.
  const op = opacity < 1 ? ` opacity="${Math.max(0, opacity).toFixed(3)}"` : '';
  return `<image x="0" y="0" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="${esc(align)}" href="${esc(href)}"${op}/>`;
}

/**
 * Baked SVG document -> a stable data:image/svg+xml href (identical to what embedSvgImage uses internally, same LRU cache).
 * Exported for player preloading: convert _svg to a data URL ahead of time and decode it into imageCache, so a set that swaps
 * content doesn't decode on its first frame -> flicker.
 */
export function svgImageHref(svgDoc: string): string | null {
  const cached = svgImageHrefCache.get(svgDoc);
  if (cached) return cached;
  const parsed = parseSvgRoot(svgDoc);
  if (!parsed) return null;
  // ⚠️ Must keep all attributes of the original root <svg> (especially id / class):
  // some renderers put fill/stroke into <style> using selectors scoped by the root id, like `#<rootId> ...{fill:...}`.
  // Wrapping the children in a brand-new <svg> and dropping the root id -> none of those CSS rules match -> nodes fall back to default black fill.
  // Graphviz/Vega use inline fill and aren't affected, but keeping root attributes is the general, safe approach.
  //
  // Also: a baked renderer's root viewBox is always authoritative and self-consistent (content may use <g transform> to move negative coordinates into positive range),
  // so never use contentBounds to scan raw coordinates and "fix" the viewBox: it can't see transforms and would stretch 254x50 into 254x91.6,
  // and the image would then be letterboxed a second time inside a box sized to the declared aspect ratio -> content shrinks to a small blob. Use the declared viewBox as-is.
  //
  // Only normalize width/height to the viewBox's pixel values (the MathJax root uses ex units, so as an <img> source its size can't be computed).
  const { vbx, vby, vbw, vbh } = parsed;
  const normalized = svgDoc.replace(/<svg\b([^>]*)>/i, (_full, rawAttrs: string) => {
    let attrs = rawAttrs
      .replace(/\s(?:width|height)\s*=\s*"[^"]*"/gi, '')
      .replace(/\s(?:width|height)\s*=\s*'[^']*'/gi, '');
    if (!/\bviewBox\s*=/i.test(attrs)) attrs += ` viewBox="${fmt(vbx)} ${fmt(vby)} ${fmt(vbw)} ${fmt(vbh)}"`;
    if (!/\bxmlns\s*=/i.test(attrs)) attrs += ' xmlns="http://www.w3.org/2000/svg"';
    if (!/\bxmlns:xlink\s*=/i.test(attrs)) attrs += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    return `<svg${attrs} width="${fmt(vbw)}" height="${fmt(vbh)}">`;
  });
  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
  svgImageHrefCache.set(svgDoc, href);
  // Keep the cache from growing without bound during long dev sessions that generate tasks repeatedly.
  if (svgImageHrefCache.size > 256) {
    const first = svgImageHrefCache.keys().next().value;
    if (first) svgImageHrefCache.delete(first);
  }
  return href;
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Formatting specifically for scale factors: coordinates can be rounded to two decimals (absolute error), scale factors can't (relative error).
 *
 * A MathJax formula's viewBox can be nearly ten thousand units wide while the box is only a few hundred px, so the meet ratio lands around 0.05-0.2.
 * In that range the quantization step of toFixed(2) is 5%-20% of the ratio itself; once it rounds up, content is enlarged past the
 * box and then cut off by overflow:hidden (that's how the "= 0" at the right end of a formula lost half a glyph).
 *
 * So we keep enough significant digits and only round down: better half a pixel of blank margin than any overflow clipping.
 */
export function fmtScaleDown(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '1';
  const q = 1e6;
  return String(Math.max(1 / q, Math.floor(s * q) / q));
}

/**
 * Estimate the bounding box of some SVG content (pure string scan, no DOM, identical on server and browser).
 * Approach: collect every coordinate pair from rect/circle/ellipse/line/polygon/path etc. and take the extremes.
 * Curves (C/Q/A) are bounded by their control points: the control points' convex hull always contains the curve, so this is a
 * conservative bounding box (may be slightly large, never misses anything).
 * Only used to decide whether content goes outside the declared viewBox; when unsure it returns null (keeping the original viewBox behavior).
 */
function contentBounds(inner: string): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const see = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  const attr = (tag: string, name: string): number => {
    // Accept both single and double quotes (models often use single quotes to avoid JSON escaping)
    const m = new RegExp(`${name}\\s*=\\s*["']([-\\d.eE]+)["']`).exec(tag);
    return m ? Number(m[1]) : NaN;
  };

  // rect / circle / ellipse / line (read each one's coordinate attributes)
  for (const m of inner.matchAll(/<rect\b[^>]*>/gi)) {
    const t = m[0]; const x = attr(t, 'x') || 0; const y = attr(t, 'y') || 0;
    const wv = attr(t, 'width'); const hv = attr(t, 'height');
    if (Number.isFinite(wv) && Number.isFinite(hv)) { see(x, y); see(x + wv, y + hv); }
  }
  for (const m of inner.matchAll(/<circle\b[^>]*>/gi)) {
    const t = m[0]; const cx = attr(t, 'cx') || 0; const cy = attr(t, 'cy') || 0; const r = attr(t, 'r');
    if (Number.isFinite(r)) { see(cx - r, cy - r); see(cx + r, cy + r); }
  }
  for (const m of inner.matchAll(/<ellipse\b[^>]*>/gi)) {
    const t = m[0]; const cx = attr(t, 'cx') || 0; const cy = attr(t, 'cy') || 0;
    const rx = attr(t, 'rx'); const ry = attr(t, 'ry');
    if (Number.isFinite(rx) && Number.isFinite(ry)) { see(cx - rx, cy - ry); see(cx + rx, cy + ry); }
  }
  for (const m of inner.matchAll(/<line\b[^>]*>/gi)) {
    const t = m[0]; see(attr(t, 'x1'), attr(t, 'y1')); see(attr(t, 'x2'), attr(t, 'y2'));
  }
  // polygon / polyline points (single or double quotes)
  for (const m of inner.matchAll(/<(?:polygon|polyline)\b[^>]*\bpoints\s*=\s*["']([^"']*)["']/gi)) {
    const nums = m[1]!.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    for (let i = 0; i + 1 < nums.length; i += 2) see(nums[i]!, nums[i + 1]!);
  }
  // path d: collect points using accumulated coordinates for both absolute and relative commands; command letters switch mode, numbers pair up (H/V single values handled separately)
  for (const m of inner.matchAll(/\bd\s*=\s*["']([^"']*)["']/gi)) {
    accumulatePath(m[1]!, see);
  }
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1 };
}

/** Scan a path d: split by command; absolute commands take points directly, relative commands accumulate from the current point; curve control points are included too (conservative bounds). */
function accumulatePath(d: string, see: (x: number, y: number) => void): void {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return;
  let cx = 0, cy = 0;
  let i = 0;
  let cmd = '';
  const nextNum = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const tk = tokens[i]!;
    if (/[a-zA-Z]/.test(tk)) { cmd = tk; i++; }
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    if (up === 'M' || up === 'L' || up === 'T') {
      const x = nextNum(); const y = nextNum();
      cx = rel ? cx + x : x; cy = rel ? cy + y : y; see(cx, cy);
    } else if (up === 'H') {
      const x = nextNum(); cx = rel ? cx + x : x; see(cx, cy);
    } else if (up === 'V') {
      const y = nextNum(); cy = rel ? cy + y : y; see(cx, cy);
    } else if (up === 'C') {
      const a = nextNum(), b = nextNum(), c = nextNum(), e = nextNum(), f = nextNum(), g = nextNum();
      see(rel ? cx + a : a, rel ? cy + b : b); see(rel ? cx + c : c, rel ? cy + e : e);
      cx = rel ? cx + f : f; cy = rel ? cy + g : g; see(cx, cy);
    } else if (up === 'S' || up === 'Q') {
      const a = nextNum(), b = nextNum(), c = nextNum(), e = nextNum();
      see(rel ? cx + a : a, rel ? cy + b : b);
      cx = rel ? cx + c : c; cy = rel ? cy + e : e; see(cx, cy);
    } else if (up === 'A') {
      nextNum(); nextNum(); nextNum(); nextNum(); nextNum();
      const x = nextNum(); const y = nextNum();
      cx = rel ? cx + x : x; cy = rel ? cy + y : y; see(cx, cy);
    } else if (up === 'Z') {
      /* close: no coordinates */
    } else {
      // Unknown command: skip one token to avoid an infinite loop
      i++;
    }
  }
}

/** Parse the root <svg> tag and extract the viewBox (including origin) and inner children (shared by embedSvg / bake) */
export function parseSvgRoot(svgDoc: string): { vbx: number; vby: number; vbw: number; vbh: number; inner: string } | null {
  const open = svgDoc.match(/<svg\b[^>]*>/i);
  if (!open) return null;
  const tag = open[0];
  const start = (open.index ?? 0) + tag.length;
  const end = svgDoc.lastIndexOf('</svg>');
  const inner = end > start ? svgDoc.slice(start, end) : svgDoc.slice(start);
  let vbx = 0;
  let vby = 0;
  let vbw = 0;
  let vbh = 0;
  // Attribute values may use single or double quotes (we encourage models to use single quotes to avoid JSON escaping), so accept both.
  const vb = tag.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  if (vb) {
    const parts = vb[1]!.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      vbx = parts[0]!;
      vby = parts[1]!;
      vbw = parts[2]!;
      vbh = parts[3]!;
    }
  }
  if (!vbw || !vbh) {
    const ww = tag.match(/\bwidth\s*=\s*["']?([\d.]+)/i);
    const hh = tag.match(/\bheight\s*=\s*["']?([\d.]+)/i);
    vbw = ww ? Number(ww[1]) : 100;
    vbh = hh ? Number(hh[1]) : 100;
  }
  return { vbx, vby, vbw: vbw || 100, vbh: vbh || 100, inner };
}

/**
 * Loading state: the fallback when bake isn't ready (during lint / before an async re-render) or the spec is missing.
 * Instead of placeholder text it draws a clean "breathing spinner ring", self-driven by SMIL (the overlay is a real DOM <svg>,
 * so the animation runs in the browser on its own); translucent neutral gray looks fine on light and dark backgrounds.
 * label/hint are kept only for signature compatibility and are no longer drawn.
 */
export function placeholder(_label: string, w: number, h: number, _hint = ''): string {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.max(14, Math.min(w, h) * 0.06);
  const sw = Math.max(3, r * 0.32);
  const circ = 2 * Math.PI * r;
  const arc = (circ * 0.72).toFixed(1);
  const gap = (circ * 0.28).toFixed(1);
  const c = `${cx.toFixed(1)} ${cy.toFixed(1)}`;
  return (
    `<rect x="1" y="1" width="${(w - 2).toFixed(1)}" height="${(h - 2).toFixed(1)}" rx="${Math.min(28, r).toFixed(1)}" fill="#9ca3af14" stroke="#9ca3af2e" stroke-width="1.5"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#9ca3af26" stroke-width="${sw.toFixed(1)}"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#94a3b8" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-dasharray="${arc} ${gap}">` +
    `<animateTransform attributeName="transform" type="rotate" from="0 ${c}" to="360 ${c}" dur="0.9s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0.9;0.35;0.9" dur="1.5s" repeatCount="indefinite"/>` +
    `</circle>`
  );
}

/** Private param keys injected by bake (underscore prefix; excluded from docs/validation, read at render time) */
export const BAKED_SVG = '_svg';
/** The real HTML fragment bake injects for DOM components (markdown); the Web Runtime injects it directly via innerHTML. */
export const BAKED_HTML = '_html';
export const BAKED_VBW = '_vbw';
export const BAKED_VBH = '_vbh';
/** Transient private keys for src transitions (crossfade): injected by interpolate only on intermediate morph frames; render reads them and stacks two layers. */
export const BAKED_SVG_FROM = '_svgFrom';
export const BAKED_MIX = '_mix';
