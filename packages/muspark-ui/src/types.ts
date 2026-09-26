/**
 * The shape of a component declaration - **declared locally, not imported from anywhere.**
 *
 * These types are structurally equivalent to the ones in `@animspark/scene-engine`, so a host can use them as
 * `ComponentDef` directly (TypeScript is structurally typed). Copied on purpose rather than imported: muspark is a
 * standalone third-party package and should not pull AnimSpark into its dependency tree just to "borrow a type" -
 * then it would no longer be something you can take out and use on its own.
 *
 * The cost is that these few dozen lines must track upstream. Acceptable: they are a **rendering contract**, not an
 * implementation detail, and almost never change; if they do drift, the host fails at compile time, not at runtime.
 */

export type ParamValue = number | string | boolean | ParamValue[] | { [key: string]: ParamValue };
export type Params = Record<string, ParamValue>;

/** The full contract of a visual component: docs, params, and how to draw it. */
export interface ComponentDef<P extends Params = Params> {
  name: string;
  doc: string;
  details?: string;
  example?: string;
  /** Param docs: key -> description. `anim doc` renders docs from this. */
  paramDocs: Record<string, string>;
  defaults: P;
  /** Intrinsic size: params -> [w, h]. Deterministic, no DOM dependency. */
  intrinsic(params: P): [number, number];
  /** What these params draw. Returns an SVG fragment (without the outer `<svg>`). */
  render(params: P, w: number, h: number): string;
  /** Text components: the actual space used after wrapping inside the layout box. */
  contentExtent?(params: P, w: number, h: number): [number, number];
  /** Debug: the actual content box `[x, y, w, h]` within the allocated box (local coordinates). */
  contentDebugRect?(params: P, boxW: number, boxH: number): [number, number, number, number];
  stepParams?: string[];
  textual?: boolean;
  fill?: boolean;
}

/** A function that produces no pixels. */
export interface FunctionDef {
  name: string;
  doc: string;
  details?: string;
  example?: string;
  paramDocs: Record<string, string>;
  defaults: Params;
  /** Return value docs (e.g. `{ ref, P, render }`). */
  returns?: string;
}

/** A set of components and functions. Hosts load packages of this shape. */
export interface ScenePackage {
  name: string;
  doc: string;
  components?: ComponentDef[];
  functions?: FunctionDef[];
}
