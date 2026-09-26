/**
 * Debug / layout: the rect actually occupied by content inside its layout box (meet, centered, not stretched).
 */
import type { ComponentDef, Params } from '../core/types';

/** Fit contentW x contentH into boxW x boxH uniformly (meet); returns local coordinates [x, y, w, h]. */
export function meetRectInBox(
  boxW: number,
  boxH: number,
  contentW: number,
  contentH: number,
): [number, number, number, number] {
  const cw = Math.max(contentW, 1);
  const ch = Math.max(contentH, 1);
  const sc = Math.min(boxW / cw, boxH / ch);
  const w = cw * sc;
  const h = ch * sc;
  return [(boxW - w) / 2, (boxH - h) / 2, w, h];
}

const FIT_EPS = 0.998;

/** Resolve a component's content debug rect inside its layout box (local coordinates, origin top-left). */
export function resolveContentDebugRect(
  def: ComponentDef,
  params: Params,
  boxW: number,
  boxH: number,
): [number, number, number, number] {
  const w = Math.max(boxW, 1);
  const h = Math.max(boxH, 1);
  if (def.contentDebugRect) {
    return def.contentDebugRect(params, w, h);
  }
  if (def.contentExtent) {
    const [cw, ch] = def.contentExtent(params, w, h);
    const contentW = Math.max(cw, 1);
    const contentH = Math.max(ch, 1);
    if (def.textual) {
      const fit = Math.min(w / contentW, h / contentH, 1);
      const dw = contentW * fit;
      const dh = contentH * fit;
      const tx = (w - dw) / 2;
      const ty = fit >= FIT_EPS ? Math.max(0, (h - contentH) / 2) : (h - dh) / 2;
      return [tx, ty, fit >= FIT_EPS ? w : dw, fit >= FIT_EPS ? contentH : dh];
    }
    return meetRectInBox(w, h, contentW, contentH);
  }
  if (!def.fill) {
    const [iw, ih] = def.intrinsic(params);
    const s = Math.min(w / Math.max(iw, 1), h / Math.max(ih, 1));
    const dw = iw * s;
    const dh = ih * s;
    return [(w - dw) / 2, (h - dh) / 2, dw, dh];
  }
  return [0, 0, w, h];
}
