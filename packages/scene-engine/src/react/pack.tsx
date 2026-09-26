/**
 * How package components live in React: the `<Formula>` / `<Chart>` / `<Collage>` kind.
 *
 * They are not ordinary React components but a **declaration** (`PackComponentDef`): given params and a
 * size, return an SVG or HTML string. So this layer does only three things: compute the size, call
 * `render`, and mount the string into the DOM.
 *
 * Why not let each package write its own React: twenty-eight components would mean twenty-eight copies of
 * "how to size, how to mount the string, how to expose the handle", which should be identical. A package
 * only declares "what these params look like when drawn" and should not care about anything else.
 *
 * **The collection pass (node) goes through here too.** `render` returns a placeholder when there is no
 * document, and `intrinsic` never touches the DOM, so the whole path works under `renderToStaticMarkup`
 * with no stubs.
 */

import * as React from 'react';

import { onImageReady, setSeekExact } from '../render/canvas';

/** Param dictionary. The package knows what it accepts; this layer does not interpret it. */
export type PackParams = Record<string, unknown>;

/**
 * A package component's declaration.
 *
 * This is a **structural subset** of `@animspark/scene-engine`'s `ComponentDef`, listing only the fields
 * this layer actually reads. That type is not imported because it lives in a package that drags in
 * typescript (see scene-engine/authoring), and the runtime should not bundle a compiler for one type.
 */
export interface PackComponentDef {
  name: string;
  defaults: PackParams;
  /** Intrinsic size. Deterministic, no DOM dependency. */
  intrinsic(params: PackParams): [number, number];
  /** What these params look like when drawn. An SVG fragment by default; HTML when `dom` is true. */
  render(params: PackParams, w: number, h: number): string;
  /**
   * Raster backend: paint this cell straight into the given canvas (already sized); return true if it painted.
   *
   * Components with this method skip `render`: p5 and three produce **pixels**, not vectors. They used to
   * hide the pixels in an offscreen canvas while `render` returned only a `sync-xyz:` token, which the old
   * engine's canvas compositor swapped for the real image at drawImage time. In the new architecture that
   * SVG goes straight into the DOM, so the browser loads the token as a URL and gets
   * `ERR_UNKNOWN_URL_SCHEME`: nothing on screen, and that single line in the console.
   */
  paint?(params: PackParams, canvas: HTMLCanvasElement): boolean;
  /** False for async backends (Pyodide, p5 init) until they really draw. Synchronous components do not implement it. */
  ready?(params: PackParams): boolean;
  /** render returns HTML rather than an SVG fragment. */
  dom?: boolean;
  /**
   * Fill the allotted box without locking the intrinsic aspect ratio (backgrounds, plates, full-frame rasters).
   *
   * These render at the **measured box**, not the intrinsic size: the latter is only a default, and their
   * real size is set in outside CSS (`inset: 0` and the like). Rendering at intrinsic size looks right, just
   * smaller and tucked into the top-left corner.
   */
  fill?: boolean;
}

/** Keys this layer consumes itself and does not pass on as params. */
const RESERVED = new Set(['ref', 'id', 'style', 'className', 'children', '__loc']);

export interface PackHandle {
  /** Param dictionary that gsap can tween. Change it, call `render()`, and the visuals follow. */
  P: PackParams;
  /** Redraw a frame from the current `P`. Hook it to gsap's `onUpdate`. */
  render: () => void;
  /** Can this cell show real content yet (false until an async backend is ready). */
  ready: () => boolean;
}

/**
 * Live handles, by id.
 *
 * Why this cross-module line exists: the shot file renders `<Three id="ll">`, while the choreography
 * function that drives `ll.P.gt` lives in another module; it is a plain function, cannot use hooks and
 * has no context.
 *
 * A duplicate id throws on the spot instead of overwriting: when two visuals claim the same id, the later
 * one would push out the earlier one's handle while **both still render**; one timeline would just be
 * driving an instance nobody sees any more. That bug has no symptoms at all.
 */
const HANDLES = new Map<string, PackHandle>();
/** Async readiness is tracked per mounted instance, including components used only through a React ref with no id. */
const ACTIVE_HANDLES = new Set<PackHandle>();

/** Get a package component's handle. For choreography functions; `id` is the one written in JSX. */
export function packHandle(id: string): PackHandle | null {
  return HANDLES.get(id) ?? null;
}

/**
 * Handles are also exposed as bare globals: the `cherry` in `tl.to(cherry.P, …)` is one.
 *
 * This is the authoring contract package components inherited from the previous generation (every def's
 * docs use this form), and existing films are all written this way, so `packHandle(id)` alone is not enough.
 *
 * There is one more reason it must be set: **browsers already expose an element with `id="cherry"` as
 * `window.cherry`**. Without an explicit override, `cherry` in choreography would get that DOM element and
 * the error would be `cherry.render is not a function`, which points nowhere near "the handle was not attached".
 */
function setGlobalHandle(id: string, handle: PackHandle | null): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (handle) g[id] = handle;
  else delete g[id];
}

/** Can every handle show real content yet. Frame-by-frame export waits on this before capturing (see the export page's frameWait). */
export function packsReady(): boolean {
  for (const h of ACTIVE_HANDLES) if (!h.ready()) return false;
  return true;
}

/* The same probe is also exposed as a global: the film's shooter (shoot.ts) asks "is this frame done?" from
   **another realm**, and two separate bundles sit between it and this module (one for the host script, one
   for the film build), so an import cannot reach across. Whichever loads last wins: on the shooting page the
   film build runs after the host, which is exactly the copy holding the real handles.
   Without it: the shutter fires while Formula is still loading MathJax, the contact sheet shows a
   placeholder in that cell, and nothing reports an error.

   __animSetSeekExact is the same: heavy raster backends like mpl throttle in realtime playback ("rest as
   long as you drew", reusing the previous frame; see mpl-runtime's seekExact branch), and the shooting page
   must switch that off completely. Real time passes between frame captures, so with throttling on you
   capture "the last one that finished drawing". The switch itself is a module global in render/canvas that
   the shooting page's shell cannot import, so it goes through this window line (code-shoot's __filmMount calls it). */
if (typeof document !== 'undefined') {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__animPacksReady = packsReady;
  g.__animSetSeekExact = setSeekExact;
}

/** Size: a fixed size in style wins, then the measured box, and only then the component's own intrinsic size. */
function sizeOf(
  def: PackComponentDef,
  params: PackParams,
  style: React.CSSProperties | undefined,
  box: readonly [number, number] | null,
): [number, number] {
  const sw = typeof style?.width === 'number' ? style.width : null;
  const sh = typeof style?.height === 'number' ? style.height : null;
  if (sw != null && sh != null) return [sw, sh];
  if (box) return [sw ?? box[0], sh ?? box[1]];
  const [iw, ih] = def.intrinsic(params);
  return [sw ?? iw, sh ?? ih];
}

/**
 * Measure our own box (fill components only).
 *
 * The size is set in outside CSS (`position:absolute; inset:0`), which React cannot see, so it can only be
 * measured after mounting. Until then one frame renders at intrinsic size; the update happens in
 * `useLayoutEffect`, so the user never sees that in-between frame.
 */
function useBoxSize(enabled: boolean): [React.RefObject<HTMLElement | null>, [number, number] | null] {
  const ref = React.useRef<HTMLElement | null>(null);
  const [box, setBox] = React.useState<[number, number] | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return undefined;
    const read = (): void => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setBox((old) => (old && old[0] === w && old[1] === h ? old : [w, h]));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return [ref, box];
}

/**
 * Turn a declaration into a real React component.
 *
 * A package's author entry calls this once per component: `export const Formula = packComponent(FORMULA_DEF)`.
 * The React ref exposes this instance's PackHandle, so copies of a scene still hold independent params.
 */
export interface PackComponentProps extends PackParams {
  id?: string;
  style?: React.CSSProperties;
  className?: string;
}

export type PackedComponent = React.ForwardRefExoticComponent<PackComponentProps & React.RefAttributes<PackHandle>> & {
  /**
   * Which declaration this component is bound to.
   *
   * Kept because it is really used: `anim doc` renders docs from it, the dev panel lists params from it, and
   * tests use it to check "this export is bound to that def". It hangs on the component rather than in a
   * separate table, which would sooner or later drift from the exports.
   */
  def: PackComponentDef;
};

export function packComponent(def: PackComponentDef): PackedComponent {
  const Pack = React.forwardRef<PackHandle, PackComponentProps>((props, componentRef) => {
    const { id, style, className } = props as {
      id?: string; style?: React.CSSProperties; className?: string;
    };

    /* Params live in a ref instead of being recomputed each time: gsap tweens fields of **this very object**
       (`tl.to(ll.P, { gt: 1 })`), and swapping in a new object would attach the tween to something nobody reads. */
    const P = React.useRef<PackParams>({});
    const [, bump] = React.useReducer((n: number) => n + 1, 0);

    /* Props are written into P only when **the value actually changed**, not overwritten on every render.
     *
     * Blindly overwriting would wipe out the values gsap tweened in, and silently: choreography
     * `tl.to(ll.P, { gt: 1 })` reaches 0.5 → calls `render()` → triggers a re-render → this line resets gt to
     * the initial value from props → the first frame is drawn again. It shows up as "the picture barely
     * moves" while every frame still pays the full render cost: slow, static, and no error.
     *
     * In the contract `P` is the **initial value** (every def's paramDocs say "initial param values") and
     * belongs to gsap after that. But a real props change must still be honored (films pass params computed
     * from `useLocalMs()` this way), so the comparison is "did props change since the last render", not
     * "do props differ from P now". The latter would treat every gsap tween as "props unchanged but P
     * changed" and overwrite it every frame, as if nothing had happened. */
    const seeded = React.useRef(false);
    const lastProps = React.useRef<PackParams>({});
    const incoming: PackParams = {};
    for (const [k, v] of Object.entries(props)) if (!RESERVED.has(k)) incoming[k] = v;
    if (!seeded.current) {
      Object.assign(P.current, def.defaults, incoming);
      seeded.current = true;
    } else {
      for (const [k, v] of Object.entries(incoming)) {
        if (!Object.is(lastProps.current[k], v)) P.current[k] = v;
      }
    }
    lastProps.current = incoming;

    const handle = React.useRef<PackHandle | null>(null);
    if (!handle.current) {
      handle.current = {
        P: P.current,
        render: () => bump(),
        ready: () => def.ready?.(P.current) ?? true,
      };
    }
    React.useImperativeHandle(componentRef, () => handle.current!, []);

    React.useLayoutEffect(() => {
      const current = handle.current!;
      const live = id ? HANDLES.get(id) : undefined;
      if (live && live !== current) {
        throw new Error(
          `Two visuals share id="${id}" (<${def.name} />). Choreography uses the id to grab a handle; `
          + 'with a duplicate, one timeline would drive an instance that is no longer on screen while everything still renders, so it could never be tracked down.',
        );
      }
      ACTIVE_HANDLES.add(current);
      if (id) {
        HANDLES.set(id, current);
        setGlobalHandle(id, current);
      }
      return () => {
        ACTIVE_HANDLES.delete(current);
        if (!id || HANDLES.get(id) !== current) return;
        HANDLES.delete(id);
        setGlobalHandle(id, null);
      };
    }, [id]);

    /* Once an async backend is ready, render one more frame.
       p5 has to dynamically import its library, Pyodide has to start wasm, three has to create a context;
       until then `render()` returns the "initializing…" placeholder. Readiness happens **asynchronously**,
       and at that moment this layer has no reason to re-render: props did not change and time did not move
       (paused playback and frame-by-frame export are both static). So the picture would stay on the
       placeholder forever, with no error: the contact sheet would show a cell reading "Initializing WebGL…".
       Every backend reports readiness on the single `onImageReady` channel (image decoding uses it too),
       so subscribing to it is enough. */
    React.useEffect(() => {
      if (!def.ready) return undefined;
      if (def.ready(P.current)) return undefined;
      return onImageReady(() => { if (def.ready?.(P.current)) bump(); });
    });

    const [hostRef, measured] = useBoxSize(!!def.fill && !def.paint);
    const [w, h] = sizeOf(def, P.current, style, measured);
    /* Fill components must really fill. `inset: 0` does not stretch a **replaced element** like canvas: with
       auto width/height it uses its intrinsic size (300×150), so the picture shrinks into the box's top-left
       corner, with no error. */
    const boxStyle: React.CSSProperties = def.fill
      ? { display: 'block', width: '100%', height: '100%', ...style }
      : { display: 'block', ...style };

    /* Raster backends (p5 / three) paint into this canvas themselves.
       Painting happens in a layout effect rather than in render: only then is the canvas in the DOM with a real size. */
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    React.useLayoutEffect(() => {
      const cv = canvasRef.current;
      if (!def.paint || !cv) return;
      /* The backing store is sized to the on-screen size **after transforms** (getBoundingClientRect already
         includes the stage scale), times dpr. Sizing it in stage coordinates does not work: a bleed box is
         easily 2560×1440 while the stage itself is only 1920 wide, so every visual would waste tens of MB of
         GPU memory with no gain in quality. Conversely, using the CSS size without dpr gives high-DPI screens
         and 2× exports an upscaled blurry image, again with no error. */
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const pw = Math.max(1, Math.round(rect.width * dpr));
      const ph = Math.max(1, Math.round(rect.height * dpr));
      if (cv.width !== pw || cv.height !== ph) {
        cv.width = pw;
        cv.height = ph;
      }
      def.paint(P.current, cv);
    });

    if (def.paint) {
      return (
        <canvas
          id={id}
          ref={(el) => { canvasRef.current = el; }}
          className={className}
          style={boxStyle}
        />
      );
    }

    const html = def.render(P.current, w, h);

    /* dom components output real HTML (it must follow page fonts and be selectable by gsap); the rest output
       an SVG fragment that this layer wraps in <svg>, where viewBox fixes the render coordinates and scaling
       is left to outside styles. */
    const attach = (el: Element | null): void => { hostRef.current = el as HTMLElement | null; };
    return def.dom
      ? (
        <div
          id={id}
          ref={attach}
          className={className}
          style={boxStyle}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )
      : (
        <svg
          id={id}
          ref={attach}
          className={className}
          style={boxStyle}
          viewBox={`0 0 ${w} ${h}`}
          width={w}
          height={h}
          xmlns="http://www.w3.org/2000/svg"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
  });

  Pack.displayName = `Pack(${def.name})`;
  return Object.assign(Pack, { def });
}
