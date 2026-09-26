/**
 * HTML as a texture: a block of HTML laid out by the browser, turned into a bitmap you can draw
 * at any time.
 *
 * The idea is "layout belongs to the browser, deformation belongs to the canvas": let the DOM
 * handle line wrapping, bold/italic, emoji and gradient text, then treat the result as an image -
 * slice it into strips, map it onto a 3D surface, scatter it into particles, run it through a
 * shader. Two paths lead to the same bitmap:
 *
 *  - **Native**: WICG HTML-in-Canvas (`<canvas layoutsubtree>` + `drawElementImage`). The
 *    capture/export browser has the flag on; for viewers only Chrome (148-151) has it, on pages
 *    with an Origin Trial token. Each `requestPaint` yields an image within a frame, so it keeps
 *    up even when the content changes every frame.
 *  - **Fallback**: serialize the subtree into an SVG `<foreignObject>` and draw that into a canvas
 *    (html-to-image). Works in every browser. Text relies on inlining the @font-face bytes into the
 *    SVG, so the first image waits for fonts to load, and every content change re-serializes (tens
 *    of ms) - unnoticeable when the content is static and only the drawing moves; content that
 *    changes every frame will drop frames.
 *
 * Consumers don't care which path ran: they always get an `HTMLCanvasElement` (physical pixels =
 * CSS size x dpr). 2D uses `drawImage`, three uses `CanvasTexture`, p5 uses
 * `drawingContext.drawImage`, and a shader samples it.
 *
 * Why not follow the WICG pattern directly (use the visible canvas itself as the layoutsubtree
 * container)? First, only 2D could consume it - 3D and p5 couldn't. Second, in browsers without the
 * API the canvas's children aren't even laid out, so the whole block is blank with no error - which
 * is exactly how the manual's example "did nothing" in local preview. The bitmap layer folds both
 * paths into one contract.
 *
 * The capture page (frame-by-frame) waits for work registered via `registerFilmPending` before
 * pressing the shutter: both the fallback's serialization and the native path's next paint are
 * registered, so a capture always shows the content for that moment.
 */

import * as React from 'react';

import { registerFilmPending } from './pending';

/* ── Feature detection ─────────────────────────────────── */

type PaintCanvas = HTMLCanvasElement & { requestPaint?: () => void; onpaint?: ((ev: Event) => void) | null };
type ElementCtx = CanvasRenderingContext2D & {
  drawElementImage?: (el: Element, ...rest: number[]) => unknown;
};

export type HtmlTextureMode = 'native' | 'fallback';

/** Whether the page has HTML-in-Canvas. For tests and debugging, `window.__animHtmlTextureMode = 'fallback'` forces the fallback. */
export function htmlTextureMode(): HtmlTextureMode {
  if (typeof window === 'undefined') return 'fallback';
  const forced = (window as unknown as { __animHtmlTextureMode?: HtmlTextureMode }).__animHtmlTextureMode;
  if (forced === 'native' || forced === 'fallback') return forced;
  const hasPaint = typeof HTMLCanvasElement !== 'undefined' && 'requestPaint' in HTMLCanvasElement.prototype;
  const hasDraw = typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;
  return hasPaint && hasDraw ? 'native' : 'fallback';
}

/* ── Handle ──────────────────────────────────────────── */

export interface HtmlTexture {
  /** The bitmap. null = the first one isn't ready yet (the fallback is waiting for fonts). */
  raster: HTMLCanvasElement | null;
  /** CSS size of the content box (px). The bitmap's pixel size is this times dpr. */
  width: number;
  height: number;
  dpr: number;
  /** Incremented each time the bitmap content changes. three's `texture.needsUpdate` and cached particle samples key off it. */
  version: number;
  /** Which path is in use. */
  mode: HtmlTextureMode;
  /** A bitmap is available. */
  ready: boolean;
  /**
   * Draw (part of) the bitmap into a 2D context. All coordinates are CSS px (source and
   * destination alike); dpr is applied internally.
   * `draw(ctx, dx, dy)` draws the whole image at its size; `draw(ctx, dx, dy, dw, dh)` draws it
   * scaled; `draw(ctx, sx, sy, sw, sh, dx, dy, dw, dh)` draws a slice.
   */
  draw(ctx: CanvasRenderingContext2D, ...args: number[]): void;
  /** Request a fresh bitmap when the content changed but the DOM didn't (e.g. a canvas in the subtree drew something). Not needed normally. */
  update(): void;
}

interface Slot {
  raster: HTMLCanvasElement | null;
  width: number;
  height: number;
  dpr: number;
  version: number;
  mode: HtmlTextureMode;
  bump: () => void;
  request: (() => void) | null;
}

const SLOT = Symbol('html-texture-slot');
type HandleWithSlot = HtmlTexture & { [SLOT]: Slot };

const MAX_RASTER_PX = 4096;

function makeHandle(slot: Slot): HtmlTexture {
  const handle: HandleWithSlot = {
    raster: slot.raster,
    width: slot.width,
    height: slot.height,
    dpr: slot.dpr,
    version: slot.version,
    mode: slot.mode,
    ready: slot.raster != null,
    draw(ctx, ...args) {
      const r = slot.raster;
      if (!r) return;
      const k = slot.dpr;
      if (args.length >= 8) {
        const [sx, sy, sw, sh, dx, dy, dw, dh] = args as [number, number, number, number, number, number, number, number];
        ctx.drawImage(r, sx * k, sy * k, sw * k, sh * k, dx, dy, dw, dh);
      } else if (args.length >= 4) {
        const [dx, dy, dw, dh] = args as [number, number, number, number];
        ctx.drawImage(r, dx, dy, dw, dh);
      } else {
        const [dx = 0, dy = 0] = args;
        ctx.drawImage(r, dx, dy, slot.width, slot.height);
      }
    },
    update() { slot.request?.(); },
    [SLOT]: slot,
  };
  return handle;
}

function slotOf(tex: HtmlTexture): Slot {
  const slot = (tex as HandleWithSlot)[SLOT];
  if (!slot) throw new Error('HtmlTexture: `tex` must come from useHtmlTexture()');
  return slot;
}

/* ── Font inlining (fallback path) ────────────────────── */

const fontDataCache = new Map<string, Promise<string>>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function loadBytes(url: string): Promise<Blob> {
  /* The capture page is opened via file://: per spec fetch doesn't support the file scheme, but
     XHR does under --allow-file-access-from-files (see the engine's shoot.ts). http(s) always
     uses fetch. */
  if (url.startsWith('file:')) {
    return new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'blob';
      xhr.onload = () => (xhr.response ? resolve(xhr.response as Blob) : reject(new Error(`empty ${url}`)));
      xhr.onerror = () => reject(new Error(`xhr ${url}`));
      xhr.send();
    });
  }
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.blob();
  });
}

function toDataUrl(url: string): Promise<string> {
  let p = fontDataCache.get(url);
  if (!p) {
    p = loadBytes(url).then(blobToDataUrl);
    p.catch(() => fontDataCache.delete(url));
    fontDataCache.set(url, p);
  }
  return p;
}

export function parseUnicodeRange(spec: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const part of spec.split(',')) {
    const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!m) continue;
    const lo = m[1]!;
    if (lo.includes('?')) {
      out.push([parseInt(lo.replace(/\?/g, '0'), 16), parseInt(lo.replace(/\?/g, 'f'), 16)]);
    } else {
      const a = parseInt(lo, 16);
      out.push([a, m[2] ? parseInt(m[2], 16) : a]);
    }
  }
  return out;
}

const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, '').toLowerCase();

function familiesOf(root: Element): Set<string> {
  const fams = new Set<string>();
  const win = root.ownerDocument.defaultView;
  if (!win) return fams;
  const add = (el: Element): void => {
    for (const f of win.getComputedStyle(el).fontFamily.split(',')) fams.add(unquote(f));
  };
  add(root);
  root.querySelectorAll('*').forEach(add);
  return fams;
}

function codepointsOf(root: Element): Set<number> {
  const cps = new Set<number>();
  for (const ch of root.textContent ?? '') cps.add(ch.codePointAt(0)!);
  return cps;
}

/**
 * The @font-face rules this subtree needs, with their bytes inlined.
 *
 * A document can have hundreds of @font-face rules (Chinese fonts are split by unicode-range into
 * hundreds of subsets), and inlining them all means fetching hundreds of files. Only keep the rules
 * whose family is actually used in the subtree and whose unicode-range actually covers characters
 * the subtree uses.
 */
export async function fontEmbedCssFor(root: Element): Promise<string> {
  const doc = root.ownerDocument;
  const fams = familiesOf(root);
  const cps = codepointsOf(root);
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(list)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      if (!fams.has(unquote(rule.style.getPropertyValue('font-family')))) continue;
      const range = rule.style.getPropertyValue('unicode-range');
      if (range) {
        const ranges = parseUnicodeRange(range);
        let hit = false;
        for (const cp of cps) { if (ranges.some(([a, b]) => cp >= a && cp <= b)) { hit = true; break; } }
        if (!hit) continue;
      }
      rules.push(rule);
    }
  }
  const texts = await Promise.all(rules.map(async (rule) => {
    const base = rule.parentStyleSheet?.href ?? doc.baseURI;
    let text = rule.cssText;
    for (const m of Array.from(text.matchAll(/url\((["']?)([^"')]+)\1\)/g))) {
      const raw = m[2]!;
      if (raw.startsWith('data:')) continue;
      let abs: string;
      try { abs = new URL(raw, base).href; } catch { continue; }
      try {
        text = text.replace(m[0], `url("${await toDataUrl(abs)}")`);
      } catch {
        /* If a subset can't be fetched, keep the original url: those characters fall back to a system font rather than leaving the whole bitmap empty. */
      }
    }
    return text;
  }));
  return texts.join('\n');
}

/* ── Fallback path: serialization ─────────────────────── */

async function rasterizeFallback(el: HTMLElement, w: number, h: number, dpr: number): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('html-to-image');
  const fontEmbedCSS = await fontEmbedCssFor(el);
  return toCanvas(el, {
    width: w,
    height: h,
    pixelRatio: dpr,
    fontEmbedCSS,
    skipAutoScale: true,
    cacheBust: false,
    /* Make the cloned root its own stacking context so negative z-index inside it doesn't fall beneath the bitmap. */
    style: { isolation: 'isolate' },
  });
}

/* ── hook ─────────────────────────────────────────────── */

/**
 * Create an HTML texture handle. The component re-renders whenever the bitmap changes (first image
 * ready, content re-laid out); a consumer's draw effect keeps up by listing `tex.version` in its
 * dependencies.
 *
 * ```tsx
 * const tex = useHtmlTexture();
 * const t = useLocal();
 * useLayoutEffect(() => {
 *   const ctx = out.current!.getContext('2d')!;
 *   ctx.reset();
 *   tex.draw(ctx, 0, 0, tex.width, 40, 100, 200 + Math.sin(t) * 20, tex.width, 40);
 * }, [t, tex.version]);
 * return <>
 *   <HtmlTexture tex={tex} width={640}><div style={{ width: 640 }}>Some text</div></HtmlTexture>
 *   <canvas ref={out} width={1920} height={1080} style={{ position: 'absolute', inset: 0 }} />
 * </>;
 * ```
 */
export function useHtmlTexture(opts: { dpr?: number } = {}): HtmlTexture {
  const dpr = opts.dpr ?? 2;
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const slotRef = React.useRef<Slot | null>(null);
  if (!slotRef.current) {
    slotRef.current = { raster: null, width: 0, height: 0, dpr, version: 0, mode: htmlTextureMode(), bump, request: null };
  }
  const slot = slotRef.current;
  /* The handle is a snapshot: its fields follow the bitmap, and each version change yields a new object, so putting it in a dependency array triggers effects. */
  return React.useMemo(() => makeHandle(slot), [slot, slot.raster, slot.width, slot.height, slot.version, slot.dpr]);
}

/* ── Component ─────────────────────────────────────────── */

export interface HtmlTextureProps {
  /** The handle returned by `useHtmlTexture()`. */
  tex: HtmlTexture;
  /** CSS width of the content box (px). Children are laid out at this width; the height follows the laid-out content. */
  width: number;
  /** Fixed height (px). Omit to size to the content. */
  height?: number;
  children: React.ReactNode;
}

const fontsReady = (): Promise<unknown> | null =>
  (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? null;

/**
 * The host that holds the content: `<canvas layoutsubtree>` on the native path, a `<div>` on the
 * fallback. Both sit at the root's (0,0), invisible and ignoring pointer events - the layout is
 * present but not shown; the bitmap is what goes on screen.
 */
export function HtmlTexture({ tex, width, height, children }: HtmlTextureProps): React.ReactElement {
  const slot = slotOf(tex);
  const mode = slot.mode;
  const hostRef = React.useRef<HTMLElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [boxH, setBoxH] = React.useState<number>(height ?? 0);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    const content = contentRef.current;
    if (!host || !content) return undefined;

    let disposed = false;
    let pendingResolve: (() => void) | null = null;
    const settle = (): void => { pendingResolve?.(); pendingResolve = null; };
    /* The shutter must wait for this image: register a promise that settles when the bitmap is ready, with an 8 s cap so it can't stall the whole capture. */
    const announce = (): void => {
      if (pendingResolve) return;
      registerFilmPending(new Promise<void>((resolve) => {
        pendingResolve = resolve;
        setTimeout(resolve, 8000);
      }));
    };
    const measure = (): { w: number; h: number } | null => {
      const h = height ?? Math.ceil(content.offsetHeight || content.getBoundingClientRect().height);
      if (!(width > 0 && h > 0)) return null;
      setBoxH((cur) => (cur === h ? cur : h));
      return { w: width, h };
    };
    const commit = (raster: HTMLCanvasElement, m: { w: number; h: number }, dpr: number): void => {
      slot.raster = raster;
      slot.width = m.w;
      slot.height = m.h;
      slot.dpr = dpr;
      slot.version += 1;
      slot.bump();
    };

    if (mode === 'native') {
      const cv = host as PaintCanvas;
      let box: { w: number; h: number } | null = null;
      cv.onpaint = () => {
        const m = box;
        const ctx = cv.getContext('2d') as ElementCtx | null;
        if (!m || !ctx || !ctx.drawElementImage) { settle(); return; }
        ctx.reset();
        ctx.scale(cv.width / m.w, cv.height / m.h);
        try {
          ctx.drawElementImage(content, 0, 0, m.w, m.h);
          commit(cv, m, cv.width / m.w);
        } catch (err) {
          console.error('[html-texture] drawElementImage failed', err);
        }
        settle();
      };
      const request = (): void => {
        if (disposed) return;
        const m = measure();
        if (!m) return;
        box = m;
        /* Set the bitmap size here, not in paint - resizing the canvas triggers another paint. */
        const k = Math.min(slot.dpr, MAX_RASTER_PX / Math.max(m.w, m.h));
        const pw = Math.round(m.w * k);
        const ph = Math.round(m.h * k);
        if (cv.width !== pw) cv.width = pw;
        if (cv.height !== ph) cv.height = ph;
        announce();
        cv.requestPaint?.();
      };
      slot.request = request;
      request();
      const mo = new MutationObserver(request);
      mo.observe(content, { subtree: true, childList: true, characterData: true, attributes: true });
      fontsReady()?.then(() => { if (!disposed) request(); });
      return () => { disposed = true; mo.disconnect(); cv.onpaint = null; slot.request = null; settle(); };
    }

    /* Fallback: serialization is async, so multiple changes within a frame are coalesced into one; if the DOM changes while it runs, run again. */
    let scheduled = false;
    let running = false;
    let dirty = false;
    const run = async (): Promise<void> => {
      scheduled = false;
      if (disposed) return;
      if (running) { dirty = true; return; }
      running = true;
      const m = measure();
      if (m) {
        try {
          const k = Math.min(slot.dpr, MAX_RASTER_PX / Math.max(m.w, m.h));
          const raster = await rasterizeFallback(content, m.w, m.h, k);
          if (!disposed) commit(raster, m, k);
        } catch (err) {
          console.error('[html-texture] rasterize failed', err);
        }
      }
      running = false;
      if (dirty && !disposed) { dirty = false; void run(); return; }
      settle();
    };
    const request = (): void => {
      if (disposed || scheduled) return;
      scheduled = true;
      announce();
      requestAnimationFrame(() => { void run(); });
    };
    slot.request = request;
    request();
    const mo = new MutationObserver(request);
    mo.observe(content, { subtree: true, childList: true, characterData: true, attributes: true });
    fontsReady()?.then(() => { if (!disposed) request(); });
    return () => { disposed = true; mo.disconnect(); slot.request = null; settle(); };
  }, [mode, slot, width, height]);

  const content = <div ref={contentRef} style={{ width }}>{children}</div>;

  if (mode === 'native') {
    /* The native host must **actually be painted**: opacity:0, visibility:hidden, moving it
       offscreen, clipping it away with clip-path, or a zero-size overflow:hidden wrapper - tested,
       all of these make Chromium skip its paint, and drawElementImage returns an empty image
       (alpha 0) without any error. A CSS 1x1 box at 2% opacity is the smallest presence measured
       to still be painted: a nearly invisible pixel. Children still lay out at their own width, and
       the bitmap size (canvas.width/height) is independent of it. */
    const nativeStyle: React.CSSProperties = {
      position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0.02, pointerEvents: 'none',
    };
    return React.createElement(
      'canvas',
      { ref: hostRef as React.RefObject<HTMLCanvasElement>, layoutsubtree: '', style: nativeStyle, 'aria-hidden': true, 'data-film-ghost': '' } as React.CanvasHTMLAttributes<HTMLCanvasElement>,
      content,
    );
  }
  /* The fallback serializes the DOM and doesn't care whether it was painted: opacity:0 is enough. */
  const fallbackStyle: React.CSSProperties = {
    position: 'absolute', left: 0, top: 0, width, height: boxH || undefined, opacity: 0, pointerEvents: 'none',
  };
  return <div ref={hostRef as React.RefObject<HTMLDivElement>} style={fallbackStyle} aria-hidden data-film-ghost="">{content}</div>;
}
