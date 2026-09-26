/**
 * Core scene engine types: the single source of truth for the whole system.
 *
 * Layers (bottom up):
 *   Params (interpolatable parameters) -> ComponentDef (component contract) -> Track/CompiledScene (track / film IR)
 *
 * The authoring layer is TSX + GSAP (the authoritative doc is services/gen-video/prompts/system-prompt.md) and does not go
 * through a declarative IR:
 * scene source is compiled by the engine into a web playback bundle. The CompiledScene family in this file
 * only serves playback of existing films in keyframe playback (animspark-playback/1).
 */

/* ───────────────────── Stage constants ───────────────────── */

export const STAGE_W = 1920;
export const STAGE_H = 1080;
export const STAGE_MARGIN = 88;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SAFE_RECT: Rect = {
  x: STAGE_MARGIN,
  y: STAGE_MARGIN,
  w: STAGE_W - 2 * STAGE_MARGIN,
  h: STAGE_H - 2 * STAGE_MARGIN,
};

/* ───────────────────── Interpolatable parameters ───────────────────── */

/**
 * Component parameter value: must be lerp-interpolatable or discretely switchable.
 * - number -> linear interpolation
 * - number[] / nested objects/arrays -> recursive per-item interpolation
 * - string (token/text) -> discrete switch (a when t<0.5, otherwise b)
 * - boolean -> discrete switch
 */
export type ParamValue = number | string | boolean | ParamValue[] | { [key: string]: ParamValue };
export type Params = Record<string, ParamValue>;

/* ───────────────────── Component contract ───────────────────── */

/** Render output: SVG string (deterministic; same params, same output) */
export interface ComponentDef<P extends Params = Params> {
  /** Component name, i.e. the constructor name in the DSL */
  name: string;
  /**
   * Component summary: one sentence on "what this component does", with no API/function shape.
   * This is the only basis for picking components in match's second round, so keep it clean and precise.
   */
  doc: string;
  /**
   * Component details (optional, markdown): how to use it, key points, pitfalls, hard rules. For the director; match doesn't read it.
   * Guidance that used to be scattered across package usage and the long tail of doc goes here; simple components don't need it (a clear API is enough).
   */
  details?: string;
  /**
   * Component example (optional, DSL source): only complex components need one; it essentially fills in what the API docs can't make clear.
   * Ordinary components whose API is clear enough should not have an example.
   */
  example?: string;
  /** Parameter docs: key -> description (API docs; includes type / value range) */
  paramDocs: Record<string, string>;
  /**
   * Default parameters. **What actually appears on screen when this parameter isn't passed.**
   *
   * So any copy that "makes a factual statement about the data" (title, subtitle, unit suffix, data source credit, annotation)
   * must default to empty; pretty demo copy goes in `showcase`. The distinction isn't looks, it's truth:
   * a wrong style default is merely ugly, a wrong copy default lies to the audience.
   *
   * This really happened: Chart's subtitle defaulted to `'FY2025, USD million'`; the model drew a chart of coffee bag counts,
   * turned off title but didn't think to turn off subtitle too. The finished film showed that chart topped with "USD million", while
   * anim check was all green, because it checks the numbers, not the copy.
   */
  defaults: P;
  /**
   * Showcase params for the dev gallery only (optional). **Never merged at runtime**; only laid over defaults
   * in showcaseParams. A chart with no title set should have no title, while the gallery chart should still have one to look good.
   */
  showcase?: Partial<P>;
  /** Intrinsic size: params -> [w, h] (deterministic, DOM-independent) */
  intrinsic(params: P): [number, number];
  /**
   * Render: params + target size -> content string.
   * By default returns an SVG fragment (without an outer <g>), which the host wraps in <svg>/canvas.
   * If dom=true, returns a real DOM HTML fragment instead, which the host injects directly via innerHTML (see dom).
   */
  render(params: P, w: number, h: number): string;
  /**
   * Raster backend: paint this cell directly into the given canvas (the caller has already sized it); return true on success.
   *
   * Components implementing this skip `render` on the React path (see packComponent in scene-engine/react).
   * p5 / three output **pixels**: they keep the pixels on their own offscreen canvas and `render` only returns a
   * `sync-xxx:` token, which the old engine's canvas compositor swaps for the real image at the drawImage step. But on the film.tsx path
   * this SVG goes straight into the DOM, and the browser tries to load that token as a URL, getting
   * `ERR_UNKNOWN_URL_SCHEME`: nothing appears on screen, and that one line is all the console shows.
   */
  paint?(params: P, canvas: HTMLCanvasElement): boolean;
  /**
   * Asset readiness probe (optional, for browser playback gating): whether render can produce a "real content frame"
   * (not a loading placeholder) with the current params. Async-backend components (e.g. Pyodide rasterizers like mpl) return false until the runtime is ready and has drawn the first frame;
   * the player starts only after all components are ready, so it feels like watching an mp4. Sync components needn't implement it (treated as ready by default).
   */
  ready?(params: P): boolean;
  /**
   * DOM component: render() returns real DOM HTML (not SVG). The Web Runtime injects it into the mount layer via innerHTML,
   * so text follows the page/template webfont, colors use real CSS, and child elements can be selected by GSAP for animation,
   * bypassing the <svg>/canvas texture path (where fonts look bad, don't follow the theme, and can't animate). Typical: markdown.
   */
  dom?: boolean;
  /** Text components: actual content extent after wrapping within layout box width w (may exceed h, which triggers fit-scale) */
  contentExtent?(params: P, w: number, h: number): [number, number];
  /** Debug: actual content box [x, y, w, h] inside the layout box, in local coordinates; derived by resolveContentDebugRect by default. */
  contentDebugRect?(params: P, boxW: number, boxH: number): [number, number, number, number];
  /** Text components don't take part in "scaling up to fill the role quota" */
  textual?: boolean;
  /**
   * Fill component: at render time it fills the layout-assigned box exactly (props.w x props.h, non-uniform), without locking the intrinsic aspect ratio.
   * For "background/backing plate" components: they must fill the container rect exactly,
   * rather than scale uniformly from a square intrinsic (otherwise a square plate in a wide container is too short and content overflows).
   */
  fill?: boolean;
  /**
   * Layout scale-up cap. Defaults to the template slot's maxScale; 1 means place at natural size only,
   * shrinking only when space runs out. Suits bridge components like html whose real pixel size is set by content/CSS.
   */
  layoutMaxScale?: number;
  /**
   * Slot as canvas: fill the entire assigned slot rect directly (no intrinsic-scaled box),
   * with the component laying itself out at that size. For bridge components like html that carry their own full CSS layout:
   * lets satori lay out at the real slot pixels, so it is WYSIWYG and not squeezed into a narrow strip by the intrinsic estimate.
   * Only applies when the component is the sole top-level element in the slot; when wrapped in a container it falls back to the normal intrinsic flow.
   */
  slotFill?: boolean;
  /** Type-scale base key used by lint readability checks for text components (default 'md'); e.g. kvList/table use sm internally and can set 'sm' to avoid false positives */
  textBaseSizeKey?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'display' | 'hero';
  /** Addressable sub-objects: name -> relative bbox (0-1 fractions, for camera focus on sub-parts) */
  parts?(params: P): Record<string, Rect>;
  /**
   * Param keys that are not tweened (on morph they jump straight to the target value, no numeric interpolation).
   * For "discrete semantic" params: e.g. placeValueBlocks' value (a linear 0->999 tween would flash hundreds of intermediate numbers within a second,
   * which looks terrible); declaring stepParams: ['value'] switches to the target number as soon as morph fires, matching the expectation of "just swap to the matching figure".
   */
  stepParams?: string[];
  /**
   * Component-owned interpolation (path-level morph). When declared, morph in-between frames skip the engine's generic per-key lerp,
   * and the component itself decides the params for a->b at t (typical: math-2d samples functions/geometry into point paths, aligns point counts, then interpolates per point,
   * making "one curve smoothly bending into another" possible; generic lerp on an expr string just hard-cuts at t=0.5).
   * The returned params must be consumable by the component's own render. t is already the eased local progress.
   */
  interpolate?(a: P, b: P, t: number): P;
  /**
   * Declarative object model: container components can create child objects, and child changes are handled by system actions.
   * One catalog drives three places: the runtime handle factory (generated generically by the engine), the package docs fed to the LLM, and dev cards.
   * Declaring it turns this component into a "container object": authors get a container handle with `const fig = Component(...)`,
   * then add child objects with `fig.objectType(...)`.
   */
  objectModel?: ObjectModelDef;
}

/* ───────────────────── Function contract (not rendered directly) ───────────────────── */

export interface FunctionDef {
  /** Function name, i.e. the plain call name in TSX, e.g. imgproc() */
  name: string;
  /**
   * Function summary: one sentence on "what this function returns/processes".
   * A Function doesn't render screen elements directly; its result is used by HTML/GSAP/components.
   */
  doc: string;
  /** Function details (optional, markdown): how to use it, key points, pitfalls, hard rules. */
  details?: string;
  /** Parameter docs: key -> description (API docs; includes type / value range) */
  paramDocs: Record<string, string>;
  /** Default parameters (docs/examples only; at runtime the function decides how to merge them) */
  defaults: Params;
  /** Return value description (e.g. `{ ref, P, render }`) */
  returns?: string;
  /** Copyable example (optional; can still be shown in Dev even when not included in the main LLM docs) */
  example?: string;
}

/* ───────────────────── Object model (declarative; single source of truth) ───────────────────── */

/** Child object type (a container factory method): fig.triangle({...}) / fig.plot({...}). */
export interface ObjectTypeDef {
  /** Factory method name = object type name (e.g. 'triangle') */
  name: string;
  /** One-sentence description (goes into docs/dev) */
  doc: string;
  /** Internal kind (recognized by the render layer); defaults to name */
  kind?: string;
  /** Parameter docs: key -> description (goes into the documented call form) */
  paramDocs: Record<string, string>;
  /** Default parameters (merged in at creation) */
  defaults?: Params;
}

export interface ObjectModelDef {
  /** One-sentence positioning of the container (in docs: what a plane is) */
  doc?: string;
  /** List of child object types (factory methods) */
  objects: ObjectTypeDef[];
}

/* ───────────────────── Compiled output (film IR) ───────────────────── */

/** Full render state of an element at a given moment */
export interface ElementProps {
  component: string;
  sourcePackage?: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  opacity: number;
  /** "Content layer" scale: the layout box (w/h/cx/cy) stays put; only a scale is applied to the content. */
  scale: number;
  /** Content layer rotation in degrees, around the local origin given by scaleAt. */
  rotation?: number;
  /** Origin for scale/rotation (element-local normalized 0..1, default center [0.5, 0.5]). */
  scaleAt?: [number, number];
  params: Params;
  /** Render z-order (box background card -1, content 0); stably sorted before rendering so cards always sit underneath */
  z?: number;
}

export interface Keyframe {
  /** Absolute milliseconds */
  t: number;
  props: ElementProps;
  /** Easing step for the tween into this keyframe (EASE key name; default smooth) */
  ease?: string;
}

export interface Track {
  id: string;
  keyframes: Keyframe[];
}

export interface SayCue {
  startMs: number;
  durMs: number;
  text: string;
  anchors: Array<{ tMs: number; word: string }>;
  /**
   * Caption segments: the full narration is split into sentences of "about 15 characters + punctuation", each shown only during its own reading window
   * (absolute ms). The player shows only the current segment, lighting it up word by word. Without per-word timestamps, time is distributed proportionally.
   */
  segments?: Array<{ text: string; startMs: number; endMs: number }>;
}

export interface ShotMark {
  tMs: number;
  title: string;
  /** This beat's layout label (frame root id) */
  template?: string;
}

export interface CameraKeyframe {
  t: number;
  /** Viewport center + zoom (1 = full stage) */
  cx: number;
  cy: number;
  zoom: number;
}

export interface LayoutSlotKeyframe {
  t: number;
  template: string;
  slots: Array<{ name: string; rect: Rect }>;
}

/** Film IR: common source for the three forms (video / PPT / web page) */
export interface CompiledScene {
  title: string;
  totalMs: number;
  tracks: Track[];
  says: SayCue[];
  shotMarks: ShotMark[];
  camera: CameraKeyframe[];
  /** Extra hold ms per beat because the anchored action chain outlasts the narration (for TTS alignment) */
  shotHoldMs?: number[];
  /** Template slot rect keyframes (debug overlay; in sync with layout switches) */
  layoutSlots?: LayoutSlotKeyframe[];
}

