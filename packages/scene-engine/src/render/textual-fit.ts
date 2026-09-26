/**
 * Layout for textual components: the layout box is the upper bound; content that exceeds it is scaled down uniformly to fit (no overflow, no broken layout).
 */
import type { ComponentDef, Params } from '../core/types';

const FIT_EPS = 0.998;

/** Render a textual component inside the layout-assigned boxW x boxH (SVG fragment, origin top-left) */
export function renderTextualInBox(
  def: ComponentDef,
  params: Params,
  boxW: number,
  boxH: number,
): string {
  const w = Math.max(boxW, 1);
  const h = Math.max(boxH, 1);
  const [iw, ih] = def.intrinsic(params);
  const [cw, ch] = def.contentExtent?.(params, w, h) ?? [iw, ih];
  const contentW = Math.max(cw, 1);
  const contentH = Math.max(ch, 1);
  const fit = Math.min(w / contentW, h / contentH, 1);
  // Lay out within the content's natural height contentH; the component handles horizontal alignment itself (per its own align) within width w*(1/fit).
  // After scaling, the width still fills w, so a component with align=left really hugs the left instead of being re-centered by the fit
  const innerW = w / fit;
  const inner = def.render(params, innerW, contentH);
  if (fit >= FIT_EPS) {
    const ty = Math.max(0, (h - contentH) / 2);
    return ty > 0.5 ? `<g transform="translate(0,${ty.toFixed(1)})">${inner}</g>` : inner;
  }
  const ty = (h - contentH * fit) / 2;
  return `<g transform="translate(0,${ty.toFixed(1)}) scale(${fit.toFixed(4)})">${inner}</g>`;
}
