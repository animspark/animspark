/**
 * Bake contract: the server-side pre-render mechanism (the engine defines only the interface, zero implementation).
 *
 * Some components' "standard formats" (HTML / LaTeX / Vega / DOT ...) need heavy renderers to render them to SVG server-side first,
 * which is then injected into props.params (_svg/_vbw/_vbh) of each keyframe in the compiled output; at render time (lint / per-frame) it is just pasted in as an image.
 *
 * Renderer implementations belong to each Scene package (server-only subpath, never in the browser player bundle);
 * the host takes the BakerRegistry each package exports and orchestrates uniformly (walk scenes / dedupe / inject),
 * no longer hardcoding any component names or spec param keys.
 */
export interface BakeContext {
  /** Placeholder box width from layout solving (stage px); usesBox components lay out to it, WYSIWYG. */
  boxW?: number;
  /** Placeholder box height from layout solving (stage px). */
  boxH?: number;
  /** Task resource directory (relative paths such as local images resolve here). */
  resourceDir?: string;
  /**
   * Lightness of the background the content sits on (content bakers such as markdown adapt their colors to it):
   *   'light' = light card/background, render dark text; 'dark' = dark card/background, render light text.
   * Comes from the component's tone prop; by default the baker decides from the current template background.
   */
  tone?: string;
}

export interface BakedResult {
  /** Full rendered SVG text (must contain <svg>). Used by SVG bakers (chart/diagram). */
  svg?: string;
  /**
   * Rendered real DOM HTML fragment (used by "DOM" bakers such as markdown).
   * The host injects it as _html and the Web Runtime inlines it as real DOM: it follows the page/template fonts,
   * colors adapt to tone, and child elements can be selected by GSAP. It doesn't go through the SVG/canvas path.
   */
  html?: string;
  /** viewBox width (for SVG "box fits content"; DOM bakers don't need it). */
  vbw?: number;
  /** viewBox height. */
  vbh?: number;
  /**
   * Extra private keys injected into keyframe params (underscore-prefix convention; not in docs/validation).
   * For bakers that need "structured intermediate output": e.g. formula puts the per-term layout (_parts) here
   * so the component's own interpolate can transform term by term (TransformMatchingTex) without re-parsing _svg.
   * The host Object.assigns it wholesale after writing _svg/_vbw/_vbh. Bakers that don't set it behave as before.
   */
  params?: Record<string, unknown>;
}

export interface ComponentBaker {
  /** The spec's param key (e.g. html uses 'src', formula uses 'tex'). */
  specParam: string;
  /** Whether it needs the real box size from layout solving (html/markdown/chart do). */
  usesBox?: boolean;
  /** Text bakers: only shrink when overflowing, never scale up and blow out the layout (html/markdown). */
  isText?: boolean;
  /** Box fit: 'content' = box fits content (default); 'slot' = box = slot, fill+meet centered (formula). */
  fit?: 'content' | 'slot';
  /** Render the spec to SVG; return null on failure (the host falls back to a placeholder box). */
  render(spec: unknown, ctx: BakeContext): Promise<BakedResult | null> | BakedResult | null;
}

/** Component name -> that component's server-side renderer. Exported by each Scene package from its server-only entry. */
export type BakerRegistry = Record<string, ComponentBaker>;
