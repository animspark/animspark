/**
 * Canvas 2D frame rendering (browser player only).
 *
 * Why: injecting a whole-frame SVG via innerHTML rebuilds thousands of DOM nodes every frame
 * (parse + style + layout + paint + GC), and large 3D frames (300KB+) overwhelm the main thread.
 * Drawing directly to canvas replaces "rebuild the DOM every frame" with "repaint pixels every frame":
 * zero DOM mutations, and the canvas is GPU-composited. This is the root fix for playback stutter.
 *
 * How: the component contract is unchanged (components still output SVG strings). renderFrameSvg
 * produces the whole-frame SVG -> DOMParser parses it (parse only, no style/layout, milliseconds)
 * -> we walk the nodes and draw them with the Canvas API.
 * The vocabulary is the deterministic SVG subset the engine itself generates (exhaustively supported
 * in this file); this is not a general-purpose SVG renderer.
 *
 * Supported: rect/circle/ellipse/line/polyline/polygon/path (Path2D parses d natively)/text/tspan/
 *       g (transform/opacity)/image (async cache)/linearGradient/radialGradient/pattern/clipPath.
 * Skipped: filter (feXxx color matrices, only used for duotone image decoration)/marker (arrows have
 *       a path-based fallback).
 * Fonts: Canvas uses the webfonts already loaded via the page's @font-face (the SVG-as-image
 *       approach loses fonts, so we don't use it).
 */
import type { FrameState } from '../compile/interpolate';
import type { Registry } from '../core/registry';
import { renderFrameSvg, type RenderOptions } from './svg';

/* ───────── Entry points ───────── */

export interface CanvasRenderOptions extends RenderOptions {
  /** Device pixel ratio cap (default min(devicePixelRatio, 2); <= 2 recommended for large 3D frames) */
  maxDpr?: number;
}

/**
 * Render one frame to a canvas (browser only).
 * The host controls the canvas CSS size; the backing buffer adapts to the viewBox aspect ratio.
 */
export function renderFrameToCanvas(
  frame: FrameState,
  registry: Registry,
  canvas: HTMLCanvasElement,
  options: CanvasRenderOptions = {},
): void {
  const svg = renderFrameSvg(frame, registry, options);
  drawSvgToCanvas(svg, canvas, options.maxDpr);
}

/** Parse an engine-generated SVG string and draw it directly to a canvas */
export function drawSvgToCanvas(svgText: string, canvas: HTMLCanvasElement, maxDpr?: number): void {
  if (typeof DOMParser === 'undefined') return; // not a browser environment: skip
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg') return;
  const vb = (root.getAttribute('viewBox') ?? '0 0 1920 1080').split(/\s+/).map(Number);
  const [vx, vy, vw, vh] = [vb[0] ?? 0, vb[1] ?? 0, vb[2] ?? 1920, vb[3] ?? 1080];

  // Buffer size = display size x dpr (not reset when unchanged, to avoid a clear + realloc every frame)
  const dpr = Math.min(maxDpr ?? 2, (globalThis.devicePixelRatio || 1));
  const cssW = canvas.clientWidth || 960;
  const cssH = canvas.clientHeight || 540;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bw, bh);
  // Letterbox: map viewBox -> buffer, preserving aspect ratio
  const s = Math.min(bw / vw, bh / vh);
  ctx.setTransform(s, 0, 0, s, (bw - vw * s) / 2 - vx * s, (bh - vh * s) / 2 - vy * s);

  const r = new SvgCanvasRenderer(ctx, root);
  r.drawChildren(root);
}

/* ───────── Renderer ───────── */

/**
 * Cross-frame image cache (href -> img; drawing is skipped until loaded, and a later frame fills it in).
 * Exported so image-preload.ts can warm it in bulk before playback; a hit skips new Image, preventing
 * duplicate requests.
 */
export const imageCache = new Map<string, HTMLImageElement>();

/**
 * Get a cached image that has finished decoding (returns the HTMLImageElement on an href / resource
 * alias hit, otherwise null).
 * Client-side real-time backends (e.g. PIL imgproc) use this to read source pixels: the engine already
 * preloads images into imageCache, so the decoded result is reused directly
 * (drawImage -> getImageData -> fed into Python) with no second download/decode.
 */
export function getCachedImageSource(href: string): HTMLImageElement | null {
  const img = imageCache.get(href);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Load an image, with a CORS fallback.
 *
 * Why: export (toDataURL/getImageData) requires an untainted canvas, so crossOrigin='anonymous' is
 * preferred. But many image hosts/CDNs (runoob and various sites) don't send
 * Access-Control-Allow-Origin, and the browser then fails the CORS request outright (error instead of
 * load), naturalWidth=0 -> it never draws -> the whole shot is blank.
 * Fix: when CORS fails, retry once without crossOrigin. The image then displays normally (no more blank
 * playback); the only cost is that the canvas gets "tainted" for that frame, which only affects
 * toDataURL on that frame during export. Far better than being blank throughout.
 *
 * onReady fires on any successful load (so the host can redraw while paused).
 */
export function loadImageWithCorsFallback(href: string, onReady?: () => void): HTMLImageElement {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.addEventListener('error', () => {
    // CORS attempt failed -> retry without crossOrigin (hosts without CORS headers take this path)
    if (img.crossOrigin !== null) {
      img.crossOrigin = null;
      img.src = href; // re-issue the request (a plain image request this time, no CORS check)
    }
  });
  if (onReady) img.addEventListener('load', onReady);
  img.src = href;
  return img;
}

/** Preloaded SVG documents (href -> root node + viewBox); drawn inline on the canvas so text is preserved. */
export interface CachedSvgDoc {
  root: Element;
  vb: [number, number, number, number];
}
export const svgDocCache = new Map<string, CachedSvgDoc>();

export function isSvgImageHref(href: string): boolean {
  return /\.svg(?:[?#]|$)/i.test(href) || /[?&]path=[^&]*\.svg/i.test(href);
}

/** Parse an SVG string and store it in svgDocCache (used by preloading / after a placeholder is written). */
export function cacheSvgDocument(href: string, svgText: string): boolean {
  if (typeof DOMParser === 'undefined') return false;
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg') return false;
  const vbRaw = root.getAttribute('viewBox');
  if (vbRaw) {
    const p = vbRaw.split(/\s+/).map(Number);
    svgDocCache.set(href, {
      root,
      vb: [p[0] ?? 0, p[1] ?? 0, p[2] ?? 100, p[3] ?? 100],
    });
    return true;
  }
  const w = Number(root.getAttribute('width')) || 100;
  const h = Number(root.getAttribute('height')) || 100;
  svgDocCache.set(href, { root, vb: [0, 0, w, h] });
  return true;
}

export function aliasSvgDocCache(aliasHref: string, canonicalHref: string): void {
  const doc = svgDocCache.get(canonicalHref);
  if (doc) svgDocCache.set(aliasHref, doc);
}

/**
 * Global "new image loaded" callback: lets the host (player) trigger a redraw when an image arrives,
 * even while paused.
 * Not coupled to any particular player: whoever listens registers. When drawImage issues the first
 * request internally, it also attaches a one-shot onload.
 */
type RedrawHook = () => void;
const redrawHooks = new Set<RedrawHook>();
export function onImageReady(cb: RedrawHook): () => void {
  redrawHooks.add(cb);
  return () => redrawHooks.delete(cb);
}
function fireRedraw(): void {
  for (const cb of redrawHooks) {
    try { cb(); } catch { /* one host's failed redraw must not affect other subscribers */ }
  }
}

/** Explicitly trigger a redraw (for render backends that become ready asynchronously to request a repaint once data is in, e.g. when Pyodide finishes initializing). */
export function requestPlaybackRedraw(): void {
  fireRedraw();
}

/**
 * Synchronous bitmap source resolver (optional; default null = no behavior change).
 *
 * Background: "client-side real-time raster" backends like matplotlib/Pyodide compute pixels
 * synchronously in render(), but can't go through the SVG subset (matplotlib SVG uses style=""
 * attributes, while this renderer only reads presentation attributes).
 * Fix: the component's render() puts its pixels into its own OffscreenCanvas/Canvas and returns
 * <image href="<scheme>:token">. When this renderer meets an <image>, it first asks the resolver for a
 * synchronous CanvasImageSource; on a hit it draws in the same frame (no decode, no async), otherwise it
 * falls back to the existing svgDocCache / async Image loading path. Purely additive: with nothing
 * registered, behavior is the same as before.
 */
type SyncImageResolver = (href: string) => CanvasImageSource | null | undefined;
/** Legacy single resolver (the shared Pyodide harness registers one that dispatches by prefix). */
let syncImageResolver: SyncImageResolver | null = null;
/** Additive resolver chain (other client-side real-time backends like WebGL/three each register one; they are independent by href prefix). */
const syncImageResolvers: SyncImageResolver[] = [];
export function setSyncImageResolver(fn: SyncImageResolver | null): void {
  syncImageResolver = fn;
}
/**
 * Append a synchronous bitmap source resolver (returns an unregister function). Coexists with
 * setSyncImageResolver: each backend resolves its own href prefix (sync-mpl: / sync-three: ...),
 * returns on a hit, and never overrides the others.
 * Non-Pyodide client-side real-time backends such as three.js/WebGL register through this instead of
 * squeezing into the Pyodide harness.
 */
export function addSyncImageResolver(fn: SyncImageResolver): () => void {
  syncImageResolvers.push(fn);
  return () => {
    const i = syncImageResolvers.indexOf(fn);
    if (i >= 0) syncImageResolvers.splice(i, 1);
  };
}
function resolveSyncImage(href: string): CanvasImageSource | null {
  for (const r of syncImageResolvers) {
    const s = r(href);
    if (s) return s;
  }
  return syncImageResolver ? (syncImageResolver(href) ?? null) : null;
}

/** For the DOM/Web Runtime: resolve a synchronous bitmap source such as sync-mpl:/sync-... into a real CanvasImageSource. */
export function getSyncImageSource(href: string): CanvasImageSource | null {
  return resolveSyncImage(href);
}

/**
 * "Real frame" counter: client-side real-time backends (mpl/three) call markSyncDraw(key) each time
 * they **actually produce a new frame** (ran a Pyodide / WebGL render, rather than reusing the previous
 * frame due to throttling). The playback layer uses this to measure a component's real render FPS;
 * counting paint() calls alone would misreport throttled mpl as hundreds of FPS (when it really only
 * produces a few new frames per second).
 * key is a stable source identifier (e.g. mpl's 'sync-mpl:<codeId>' / a stable key for a piece of three code).
 */
const syncDrawTicks = new Map<string, number>();
export function markSyncDraw(key: string): void {
  syncDrawTicks.set(key, (syncDrawTicks.get(key) ?? 0) + 1);
}
export function getSyncDrawTick(key: string): number {
  return syncDrawTicks.get(key) ?? 0;
}

/**
 * "Exact frame" switch (scrubbing the timeline / paused): when true, client-side real-time raster
 * backends (mpl/three etc.) must render **the exact frame for the current time**, bypassing the
 * "reuse the previous frame" throttling meant for smooth real-time playback.
 * This makes scrubbing frame-accurate and repeatable like Remotion, never stuck on the previous
 * animation phase.
 * False during normal forward playback: throttling stays on so Python doesn't saturate the main
 * thread and playback stays smooth.
 * Toggled by the web runtime when it receives animspark:set-time with playing=false.
 */
let _seekExact = false;
export function setSeekExact(on: boolean): void { _seekExact = !!on; }
export function seekExact(): boolean { return _seekExact; }
/** Force one exact repaint after a scrub release / keyboard seek (bypasses scrub-preview throttling). */
let _forcePaint = false;
export function setForcePaint(on: boolean): void { _forcePaint = !!on; }
export function forcePaint(): boolean { return _forcePaint; }

class SvgCanvasRenderer {
  private defs = new Map<string, Element>();
  /**
   * Inherited paint (fill/stroke): unlike SVG, Canvas doesn't inherit paint attributes down the parent
   * chain, so we pass them through manually.
   * Otherwise a <path> with no fill of its own under an ancestor <g fill="none"> (Vega chart
   * backgrounds/axes etc.) falls back to default black and the whole chart gets painted black.
   * null = not declared; 'none'/a color = explicit value.
   */
  private inheritedFill: string | null = null;
  private inheritedStroke: string | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    root: Element,
  ) {
    // Collect every definition with an id (gradient/pattern/clipPath may be in defs or inline)
    for (const el of root.querySelectorAll('[id]')) this.defs.set(el.getAttribute('id')!, el);
  }

  drawChildren(parent: Element): void {
    for (const node of parent.children) this.drawElement(node);
  }

  private drawElement(el: Element): void {
    const tag = el.nodeName;
    if (tag === 'defs' || tag === 'clipPath' || tag === 'linearGradient' || tag === 'radialGradient'
      || tag === 'pattern' || tag === 'filter' || tag === 'marker' || tag === 'symbol') return;

    const ctx = this.ctx;
    ctx.save();
    // Paint inheritance: save the parent's, merge our own declarations, restore after drawing
    const prevFill = this.inheritedFill;
    const prevStroke = this.inheritedStroke;
    const ownFill = el.getAttribute('fill');
    const ownStroke = el.getAttribute('stroke');
    if (ownFill !== null) this.inheritedFill = ownFill;
    if (ownStroke !== null) this.inheritedStroke = ownStroke;
    try {
      this.applyGroupAttrs(el);
      switch (tag) {
        case 'g':
          this.drawChildren(el);
          break;
        case 'rect': this.drawRect(el); break;
        case 'circle': this.drawCircle(el); break;
        case 'ellipse': this.drawEllipse(el); break;
        case 'line': this.drawLine(el); break;
        case 'polyline': this.drawPoly(el, false); break;
        case 'polygon': this.drawPoly(el, true); break;
        case 'path': this.drawPath(el); break;
        case 'text': this.drawText(el); break;
        case 'image': this.drawImage(el); break;
        case 'svg': this.drawInlineSvg(el); break;
        case 'use': this.drawUse(el); break;
        default: break;
      }
    } finally {
      ctx.restore();
      this.inheritedFill = prevFill;
      this.inheritedStroke = prevStroke;
    }
  }

  /** transform / opacity / clip-path (the matching save/restore is in drawElement) */
  private applyGroupAttrs(el: Element): void {
    const ctx = this.ctx;
    const tr = el.getAttribute('transform');
    if (tr) this.applyTransform(tr);
    const op = el.getAttribute('opacity');
    if (op !== null) ctx.globalAlpha *= clamp01(Number(op));
    const clip = el.getAttribute('clip-path');
    if (clip) {
      const m = clip.match(/url\(#([^)]+)\)/);
      const def = m ? this.defs.get(m[1]!) : null;
      if (def) {
        const region = new Path2D();
        for (const c of def.children) appendShapeToPath(region, c);
        ctx.clip(region);
      }
    }
  }

  private applyTransform(tr: string): void {
    const ctx = this.ctx;
    const re = /(translate|scale|rotate|matrix)\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tr))) {
      const args = m[2]!.split(/[\s,]+/).filter(Boolean).map(Number);
      switch (m[1]) {
        case 'translate': ctx.translate(args[0] ?? 0, args[1] ?? 0); break;
        case 'scale': ctx.scale(args[0] ?? 1, args[1] ?? args[0] ?? 1); break;
        case 'rotate':
          if (args.length >= 3) {
            ctx.translate(args[1]!, args[2]!);
            ctx.rotate(((args[0] ?? 0) * Math.PI) / 180);
            ctx.translate(-args[1]!, -args[2]!);
          } else {
            ctx.rotate(((args[0] ?? 0) * Math.PI) / 180);
          }
          break;
        case 'matrix':
          if (args.length === 6) ctx.transform(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!);
          break;
      }
    }
  }

  /* ── Fill and stroke ── */

  /** Resolve fill/stroke (including url(#) gradients/patterns; bbox is for objectBoundingBox gradient conversion) */
  private resolvePaint(v: string, bbox: BBox | null): string | CanvasGradient | CanvasPattern | null {
    if (!v || v === 'none') return null;
    const m = v.match(/^url\(#([^)]+)\)/);
    if (!m) return v;
    const def = this.defs.get(m[1]!);
    if (!def) return null;
    const tag = def.nodeName;
    if (tag === 'linearGradient') return this.makeLinearGradient(def, bbox);
    if (tag === 'radialGradient') return this.makeRadialGradient(def, bbox);
    if (tag === 'pattern') return this.makePattern(def);
    return null;
  }

  private gradientStops(def: Element, g: CanvasGradient): void {
    for (const stop of def.querySelectorAll('stop')) {
      const off = clamp01(Number(stop.getAttribute('offset') ?? 0));
      let color = stop.getAttribute('stop-color') ?? '#000';
      const so = stop.getAttribute('stop-opacity');
      if (so !== null) color = withOpacity(color, Number(so));
      g.addColorStop(off, color);
    }
  }

  /** The first stop's color, used as a solid fallback when gradient coordinates are invalid (better than crashing the whole frame). */
  private firstStopColor(def: Element): string {
    const stop = def.querySelector('stop');
    return stop?.getAttribute('stop-color') ?? '#000';
  }

  private makeLinearGradient(def: Element, bbox: BBox | null): CanvasGradient | string | null {
    const b = bbox ?? { x: 0, y: 0, w: 1, h: 1 };
    // Authors may write objectBoundingBox coordinates (0-1 / 0%-100%); percentages and defaults are both normalized to fractions
    const frac = gradFraction(def);
    const x1 = b.x + frac('x1', 0) * b.w;
    const y1 = b.y + frac('y1', 0) * b.h;
    const x2 = b.x + frac('x2', 1) * b.w;
    const y2 = b.y + frac('y2', 0) * b.h;
    // Any non-finite coordinate (NaN/Infinity: no bbox, odd units, etc.) makes createLinearGradient throw; fall back to the first stop's solid color
    if (![x1, y1, x2, y2].every(Number.isFinite)) return this.firstStopColor(def);
    const g = this.ctx.createLinearGradient(x1, y1, x2, y2);
    this.gradientStops(def, g);
    return g;
  }

  private makeRadialGradient(def: Element, bbox: BBox | null): CanvasGradient | string | null {
    const b = bbox ?? { x: 0, y: 0, w: 1, h: 1 };
    const frac = gradFraction(def);
    const cx = b.x + frac('cx', 0.5) * b.w;
    const cy = b.y + frac('cy', 0.5) * b.h;
    const r = frac('r', 0.5) * Math.max(b.w, b.h);
    if (![cx, cy, r].every(Number.isFinite)) return this.firstStopColor(def);
    const g = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(r, 1e-6));
    this.gradientStops(def, g);
    return g;
  }

  private patternCache = new Map<Element, CanvasPattern | null>();

  private makePattern(def: Element): CanvasPattern | null {
    const hit = this.patternCache.get(def);
    if (hit !== undefined) return hit;
    const w = Number(def.getAttribute('width') ?? 20);
    const h = Number(def.getAttribute('height') ?? 20);
    let out: CanvasPattern | null = null;
    if (w > 0 && h > 0 && typeof document !== 'undefined') {
      const tile = document.createElement('canvas');
      tile.width = Math.max(1, Math.ceil(w));
      tile.height = Math.max(1, Math.ceil(h));
      const tctx = tile.getContext('2d');
      if (tctx) {
        const sub = new SvgCanvasRenderer(tctx, def);
        sub.defs = this.defs;
        sub.drawChildren(def);
        out = this.ctx.createPattern(tile, 'repeat');
        // patternTransform rotate(angle) -> DOMMatrix (used for diagonal stripes)
        const pt = def.getAttribute('patternTransform');
        const rm = pt?.match(/rotate\(([-\d.]+)\)/);
        if (out && rm && typeof DOMMatrix !== 'undefined') {
          out.setTransform(new DOMMatrix().rotate(Number(rm[1])));
        }
      }
    }
    this.patternCache.set(def, out);
    return out;
  }

  /** Generic shape painting: fill + stroke (including dasharray/linecap/linejoin/opacity) */
  private paintShape(el: Element, path: Path2D, bbox: BBox | null, evenOdd = false): void {
    const ctx = this.ctx;
    // fill resolution order: own attr -> inherited (including a parent's fill="none") -> SVG default black
    const fill = el.getAttribute('fill') ?? this.inheritedFill ?? '#000';
    const stroke = el.getAttribute('stroke') ?? this.inheritedStroke;
    const fillPaint = this.resolvePaint(fill, bbox);
    if (fillPaint) {
      const fo = el.getAttribute('fill-opacity');
      const ga = ctx.globalAlpha;
      if (fo !== null) ctx.globalAlpha = ga * clamp01(Number(fo));
      ctx.fillStyle = fillPaint;
      ctx.fill(path, evenOdd ? 'evenodd' : 'nonzero');
      ctx.globalAlpha = ga;
    }
    if (stroke && stroke !== 'none') {
      const sp = this.resolvePaint(stroke, bbox);
      if (sp) {
        const so = el.getAttribute('stroke-opacity');
        const ga = ctx.globalAlpha;
        if (so !== null) ctx.globalAlpha = ga * clamp01(Number(so));
        ctx.strokeStyle = sp;
        ctx.lineWidth = Number(el.getAttribute('stroke-width') ?? 1);
        ctx.lineCap = (el.getAttribute('stroke-linecap') as CanvasLineCap) || 'butt';
        ctx.lineJoin = (el.getAttribute('stroke-linejoin') as CanvasLineJoin) || 'miter';
        const dash = el.getAttribute('stroke-dasharray');
        ctx.setLineDash(dash ? dash.split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n)) : []);
        ctx.stroke(path);
        ctx.setLineDash([]);
        ctx.globalAlpha = ga;
      }
    }
  }

  /* ── Shapes ── */

  private drawRect(el: Element): void {
    const x = num(el, 'x');
    const y = num(el, 'y');
    const w = num(el, 'width');
    const h = num(el, 'height');
    if (w <= 0 || h <= 0) return;
    const rx = num(el, 'rx');
    const p = new Path2D();
    if (rx > 0) p.roundRect(x, y, w, h, rx);
    else p.rect(x, y, w, h);
    this.paintShape(el, p, { x, y, w, h });
  }

  private drawCircle(el: Element): void {
    const cx = num(el, 'cx');
    const cy = num(el, 'cy');
    const r = num(el, 'r');
    if (r <= 0) return;
    const p = new Path2D();
    p.arc(cx, cy, r, 0, Math.PI * 2);
    this.paintShape(el, p, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
  }

  private drawEllipse(el: Element): void {
    const cx = num(el, 'cx');
    const cy = num(el, 'cy');
    const rx = num(el, 'rx');
    const ry = num(el, 'ry');
    if (rx <= 0 || ry <= 0) return;
    const p = new Path2D();
    p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.paintShape(el, p, { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 });
  }

  private drawLine(el: Element): void {
    const p = new Path2D();
    p.moveTo(num(el, 'x1'), num(el, 'y1'));
    p.lineTo(num(el, 'x2'), num(el, 'y2'));
    // A line has no fill; make sure it never gets the default black fill
    const ctx = this.ctx;
    const stroke = el.getAttribute('stroke');
    if (!stroke || stroke === 'none') return;
    const so = el.getAttribute('stroke-opacity');
    const ga = ctx.globalAlpha;
    if (so !== null) ctx.globalAlpha = ga * clamp01(Number(so));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Number(el.getAttribute('stroke-width') ?? 1);
    ctx.lineCap = (el.getAttribute('stroke-linecap') as CanvasLineCap) || 'butt';
    const dash = el.getAttribute('stroke-dasharray');
    ctx.setLineDash(dash ? dash.split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n)) : []);
    ctx.stroke(p);
    ctx.setLineDash([]);
    ctx.globalAlpha = ga;
  }

  private drawPoly(el: Element, close: boolean): void {
    const pts = (el.getAttribute('points') ?? '').split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n));
    if (pts.length < 4) return;
    const p = new Path2D();
    p.moveTo(pts[0]!, pts[1]!);
    let x0 = pts[0]!; let x1 = pts[0]!; let y0 = pts[1]!; let y1 = pts[1]!;
    for (let i = 2; i + 1 < pts.length; i += 2) {
      p.lineTo(pts[i]!, pts[i + 1]!);
      x0 = Math.min(x0, pts[i]!); x1 = Math.max(x1, pts[i]!);
      y0 = Math.min(y0, pts[i + 1]!); y1 = Math.max(y1, pts[i + 1]!);
    }
    if (close) p.closePath();
    // polyline is unfilled by default (the SVG spec defaults fill to black, but every engine polyline sets fill="none" explicitly; defensively, a polyline without fill is treated as none)
    if (!close && el.getAttribute('fill') === null) {
      const stroked = el.cloneNode(false) as Element;
      stroked.setAttribute('fill', 'none');
      this.paintShape(stroked, p, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      return;
    }
    this.paintShape(el, p, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  private drawPath(el: Element): void {
    const d = el.getAttribute('d');
    if (!d) return;
    const p = new Path2D(d); // Path2D parses SVG path syntax natively
    // A path's bbox isn't available; a path with a gradient fill falls back to the first stop's color (the engine rarely puts gradients on paths)
    const fill = el.getAttribute('fill') ?? '';
    if (fill.startsWith('url(')) {
      const m = fill.match(/^url\(#([^)]+)\)/);
      const def = m ? this.defs.get(m[1]!) : null;
      const first = def?.querySelector('stop');
      const fb = first?.getAttribute('stop-color');
      const clone = el.cloneNode(false) as Element;
      clone.setAttribute('fill', fb ?? 'none');
      this.paintShape(clone, p, null, el.getAttribute('fill-rule') === 'evenodd');
      return;
    }
    this.paintShape(el, p, null, el.getAttribute('fill-rule') === 'evenodd');
  }

  /* ── Text ── */

  private drawText(el: Element): void {
    const ctx = this.ctx;
    const x = num(el, 'x');
    const y = num(el, 'y');
    const anchor = el.getAttribute('text-anchor');
    ctx.textAlign = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left';
    const baseline = el.getAttribute('dominant-baseline');
    ctx.textBaseline = baseline === 'central' || baseline === 'middle' ? 'middle'
      : baseline === 'hanging' ? 'hanging' : 'alphabetic';

    const fs = Number(el.getAttribute('font-size') ?? 16);
    const family = el.getAttribute('font-family') ?? 'sans-serif';
    const weight = el.getAttribute('font-weight') ?? '400';
    const style = el.getAttribute('font-style') === 'italic' ? 'italic ' : '';
    ctx.font = `${style}${weight} ${fs}px ${family}`;
    const ls = el.getAttribute('letter-spacing');
    try {
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = ls ? `${Number(ls)}px` : '0px';
    } catch { /* older browsers lack this property */ }

    const paintRun = (s: string, px: number, py: number, node: Element): void => {
      if (!s) return;
      const stroke = node.getAttribute('stroke') ?? el.getAttribute('stroke');
      if (stroke && stroke !== 'none') {
        // Text halo: stroke first, then fill (how placedLabel draws its backing)
        const ga = ctx.globalAlpha;
        const so = node.getAttribute('stroke-opacity') ?? el.getAttribute('stroke-opacity');
        if (so !== null) ctx.globalAlpha = ga * clamp01(Number(so));
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Number(node.getAttribute('stroke-width') ?? el.getAttribute('stroke-width') ?? 2);
        ctx.lineJoin = 'round';
        ctx.strokeText(s, px, py);
        ctx.globalAlpha = ga;
      }
      const fill = node.getAttribute('fill') ?? el.getAttribute('fill') ?? this.inheritedFill ?? '#000';
      if (fill !== 'none') {
        ctx.fillStyle = fill;
        ctx.fillText(s, px, py);
      }
    };

    // Plain text with no tspan
    const tspans = Array.from(el.children).filter(c => c.nodeName === 'tspan');
    if (!tspans.length) {
      paintRun(el.textContent ?? '', x, y, el);
      return;
    }
    // tspan flow layout: x/dx/dy/baseline-shift/font-size (super/subscripts)
    // text-anchor=middle needs the total width, so measure first, then draw.
    // ⚠️ Must collect in childNodes order: the <text>'s own direct text node (e.g. the "c" in c^2,
    //    before the first tspan) is not a tspan, and missing it would draw "c²" as "2".
    const runs: Array<{ s: string; fs: number; dy: number; node: Element }> = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) { // direct text node of <text> (e.g. the "c" in c^2), dy=0 on the baseline
        const s = child.textContent ?? '';
        if (s) runs.push({ s, fs, dy: 0, node: el });
        continue;
      }
      if (child.nodeName !== 'tspan') continue;
      const t = child as Element;
      const tfs = t.getAttribute('font-size') ? Number(t.getAttribute('font-size')) : fs;
      let dy = t.getAttribute('dy') ? Number(t.getAttribute('dy')) : 0;
      const shift = t.getAttribute('baseline-shift');
      if (shift === 'super') dy -= fs * 0.38;
      else if (shift === 'sub') dy += fs * 0.16;
      else if (shift?.endsWith('%')) dy -= (Number(shift.slice(0, -1)) / 100) * fs;
      runs.push({ s: t.textContent ?? '', fs: tfs, dy, node: t });
    }
    const widths = runs.map(r => {
      ctx.font = `${style}${weight} ${r.fs}px ${family}`;
      return ctx.measureText(r.s).width;
    });
    const total = widths.reduce((a, b) => a + b, 0);
    let cx = ctx.textAlign === 'center' ? x - total / 2 : ctx.textAlign === 'right' ? x - total : x;
    const align0 = ctx.textAlign;
    ctx.textAlign = 'left';
    runs.forEach((r, i) => {
      ctx.font = `${style}${weight} ${r.fs}px ${family}`;
      paintRun(r.s, cx, y + r.dy, r.node);
      cx += widths[i]!;
    });
    ctx.textAlign = align0;
  }

  /* ── Images ── */

  /** Inline <svg>: components (svg/html/chart/formula etc.) embed their content as a nested svg, so the Canvas renderer must draw it recursively. */
  private drawInlineSvg(el: Element): void {
    const vbRaw = el.getAttribute('viewBox');
    const vbParts = vbRaw ? vbRaw.trim().split(/[\s,]+/).map(Number) : [];
    const vbx = Number.isFinite(vbParts[0]) ? vbParts[0]! : 0;
    const vby = Number.isFinite(vbParts[1]) ? vbParts[1]! : 0;
    const vbw = Number.isFinite(vbParts[2]) && vbParts[2]! > 0 ? vbParts[2]! : (num(el, 'width') || 100);
    const vbh = Number.isFinite(vbParts[3]) && vbParts[3]! > 0 ? vbParts[3]! : (num(el, 'height') || 100);
    const x = num(el, 'x');
    const y = num(el, 'y');
    const w = num(el, 'width') || vbw;
    const h = num(el, 'height') || vbh;
    if (!vbw || !vbh || !w || !h) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    this.applyViewBoxTransform(vbx, vby, vbw, vbh, w, h, el.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet');
    this.drawChildren(el);
    ctx.restore();
  }

  /**
   * <use xlink:href="#id">: reference a definition in defs and draw it in place.
   * MathJax renders every glyph as a <use> pointing at a <path> inside <defs>; without this only inline
   * shapes like fraction bars/radical lines remain and all formula characters are lost.
   * x/y is the placement offset; when the referenced element has no fill/stroke it inherits from its
   * ancestors (carried by the ctx state on Canvas).
   */
  private drawUse(el: Element): void {
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
    if (!href || !href.startsWith('#')) return;
    const def = this.defs.get(href.slice(1));
    if (!def || def === el) return;
    const ctx = this.ctx;
    ctx.save();
    const x = num(el, 'x');
    const y = num(el, 'y');
    if (x || y) ctx.translate(x, y);
    this.drawElement(def);
    ctx.restore();
  }

  private drawImage(el: Element): void {
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
    if (!href || typeof Image === 'undefined') return;

    const cachedSvg = svgDocCache.get(href);
    if (cachedSvg) {
      this.drawEmbeddedSvg(el, cachedSvg);
      return;
    }

    // Synchronous bitmap source (client-side real-time raster backends such as Pyodide+matplotlib, three.js/WebGL): on a hit, draw in the same frame, no decode/no async.
    const sync = resolveSyncImage(href);
    if (sync) {
      this.drawCanvasSource(el, sync);
      return;
    }

    let img = imageCache.get(href);
    if (!img) {
      img = loadImageWithCorsFallback(href, fireRedraw);
      imageCache.set(href, img);
    }
    if (!img.complete || !img.naturalWidth) return; // not loaded yet; draw on a later frame
    const x = num(el, 'x');
    const y = num(el, 'y');
    const w = num(el, 'width') || img.naturalWidth;
    const h = num(el, 'height') || img.naturalHeight;
    const ctx = this.ctx;
    // SVG <image> defaults to preserveAspectRatio xMidYMid meet; don't stretch by default.
    // satori's Twemoji output emits <image> without preserveAspectRatio; drawing it straight into w x h
    // here would stretch the emoji non-uniformly.
    const par = el.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet';
    if (par.includes('slice')) {
      const sc = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const sw = w / sc;
      const sh = h / sc;
      ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
    } else if (par.includes('none')) {
      ctx.drawImage(img, x, y, w, h);
    } else {
      const sc = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * sc;
      const dh = img.naturalHeight * sc;
      const align = par.split(/\s+/)[0] ?? 'xMidYMid';
      const dx = align.includes('xMax') ? x + w - dw : align.includes('xMin') ? x : x + (w - dw) / 2;
      const dy = align.includes('YMax') ? y + h - dh : align.includes('YMin') ? y : y + (h - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  }

  /** Draw a synchronous bitmap source (<image> + resolver hit): fit into the box per preserveAspectRatio (meet by default). */
  private drawCanvasSource(el: Element, src: CanvasImageSource): void {
    const nw = (src as { width?: number }).width ?? 0;
    const nh = (src as { height?: number }).height ?? 0;
    if (!nw || !nh) return;
    const x = num(el, 'x');
    const y = num(el, 'y');
    const w = num(el, 'width') || nw;
    const h = num(el, 'height') || nh;
    const ctx = this.ctx;
    const par = el.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet';
    if (par.includes('none')) {
      ctx.drawImage(src, x, y, w, h);
      return;
    }
    const slice = par.includes('slice');
    const sc = slice ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh);
    const dw = nw * sc;
    const dh = nh * sc;
    const align = par.split(/\s+/)[0] ?? 'xMidYMid';
    const dx = align.includes('xMax') ? x + w - dw : align.includes('xMin') ? x : x + (w - dw) / 2;
    const dy = align.includes('YMax') ? y + h - dh : align.includes('YMin') ? y : y + (h - dh) / 2;
    ctx.drawImage(src, dx, dy, dw, dh);
  }

  /** Inline SVG (placeholders/vector assets): draw as vectors so <image href=*.svg> doesn't lose text. */
  private drawEmbeddedSvg(el: Element, cached: CachedSvgDoc): void {
    const x = num(el, 'x');
    const y = num(el, 'y');
    const w = num(el, 'width') || cached.vb[2];
    const h = num(el, 'height') || cached.vb[3];
    const [, , vbw, vbh] = cached.vb;
    if (!vbw || !vbh) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    this.applyViewBoxTransform(cached.vb[0], cached.vb[1], vbw, vbh, w, h, el.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet');
    const r = new SvgCanvasRenderer(ctx, cached.root);
    r.drawChildren(cached.root);
    ctx.restore();
  }

  private applyViewBoxTransform(
    vbx: number,
    vby: number,
    vbw: number,
    vbh: number,
    w: number,
    h: number,
    preserveAspectRatio: string,
  ): void {
    const ctx = this.ctx;
    if (preserveAspectRatio.includes('none')) {
      ctx.scale(w / vbw, h / vbh);
      ctx.translate(-vbx, -vby);
      return;
    }
    const slice = preserveAspectRatio.includes('slice');
    const sc = slice ? Math.max(w / vbw, h / vbh) : Math.min(w / vbw, h / vbh);
    const dw = vbw * sc;
    const dh = vbh * sc;
    const align = preserveAspectRatio.split(/\s+/)[0] ?? 'xMidYMid';
    const ax = align.includes('xMax') ? w - dw : align.includes('xMin') ? 0 : (w - dw) / 2;
    const ay = align.includes('YMax') ? h - dh : align.includes('YMin') ? 0 : (h - dh) / 2;
    ctx.translate(ax, ay);
    ctx.scale(sc, sc);
    ctx.translate(-vbx, -vby);
  }
}

/* ───────── Utilities ───────── */

interface BBox { x: number; y: number; w: number; h: number }

function num(el: Element, attr: string): number {
  const v = Number(el.getAttribute(attr));
  return Number.isFinite(v) ? v : 0;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

/**
 * Gradient coordinate reader: parses attributes into objectBoundingBox fractions (0-1).
 * Tolerates the percentages models often write ("0%"/"100%") and missing values; invalid values fall
 * back to the default fraction so results stay finite and createGradient never throws non-finite.
 */
function gradFraction(def: Element): (attr: string, dflt: number) => number {
  return (attr: string, dflt: number): number => {
    const raw = def.getAttribute(attr);
    if (raw == null || raw === '') return dflt;
    const pct = raw.trim().endsWith('%');
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return dflt;
    return pct ? v / 100 : v;
  };
}

/** #rrggbb + opacity → #rrggbbaa */
function withOpacity(color: string, op: number): string {
  if (color.startsWith('#') && color.length === 7) {
    return `${color}${Math.round(clamp01(op) * 255).toString(16).padStart(2, '0')}`;
  }
  return color;
}

/** Accumulate clipPath children into a Path2D */
function appendShapeToPath(p: Path2D, el: Element): void {
  switch (el.nodeName) {
    case 'rect': {
      const rx = num(el, 'rx');
      if (rx > 0) p.roundRect(num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height'), rx);
      else p.rect(num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height'));
      break;
    }
    case 'circle':
      p.moveTo(num(el, 'cx') + num(el, 'r'), num(el, 'cy'));
      p.arc(num(el, 'cx'), num(el, 'cy'), num(el, 'r'), 0, Math.PI * 2);
      break;
    case 'ellipse':
      p.ellipse(num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry'), 0, 0, Math.PI * 2);
      break;
    case 'path': {
      const d = el.getAttribute('d');
      if (d) p.addPath(new Path2D(d));
      break;
    }
    case 'polygon': {
      const pts = (el.getAttribute('points') ?? '').split(/[\s,]+/).map(Number);
      if (pts.length >= 4) {
        p.moveTo(pts[0]!, pts[1]!);
        for (let i = 2; i + 1 < pts.length; i += 2) p.lineTo(pts[i]!, pts[i + 1]!);
        p.closePath();
      }
      break;
    }
  }
}
