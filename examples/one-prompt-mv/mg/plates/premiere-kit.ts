// Shared by the `premiere` and `outro` plates: the H18 line and its spark (both sides of the cut draw
// them through these, so the cut is the same pixels), the post both plates settle to at H18, glyph
// contours from the typeface outlines, and small colour helpers.
import { LineBatch } from '../px/lines';
import { W } from '../px/gl';
import { LIN, rgba } from '../px/palette';
import { sparkHead, sparkParticles } from '../px/motifs';
import { F, layout } from '../px/type';
import { clamp, ease, lerp, prog, TAU } from '../px/util';
import type { PostOverrides } from '../px/scene';
import { font as font3d } from '../type3d';
import { CUT, LINE_H18, CARET_H1, MARK_C, beatBefore } from './handoff';
import { BEAT } from '../lyrics';
import { wEnd } from './lyric';

export type RGB = [number, number, number];
export type P2 = { x: number; y: number };
export const sc = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mix3 = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
export const WHITE: RGB = [1, 0.93, 0.85];

/** CSS mix of two palette colours (or #hex). */
export function mixCss(a: string, b: string, k: number, alpha = 1) {
  const pa = rgba(a).match(/[\d.]+/g)!.map(Number), pb = rgba(b).match(/[\d.]+/g)!.map(Number);
  k = clamp(k);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},${alpha})`;
}
/** Fresh type: an ember flash, signal, then cooled to bone ~0.3 s after it landed. */
export function hotType(age: number, a = 1, cool = 0.3): string {
  if (age < 0) return rgba('bone', a);
  if (age < 0.05) return mixCss('ember', 'signal', age / 0.05, a);
  return mixCss('signal', 'bone', clamp((age - 0.05) / Math.max(0.05, cool - 0.05)), a);
}
/** Heat by age for a drawn line: white-hot tip, signal wake, cooling to `base`. */
export function heatCol(age: number, base: RGB, gain = 1): RGB {
  if (age < 0) return base;
  const tip = Math.exp(-age / 0.05), wake = Math.exp(-age / 0.32);
  const c = mix3(base, sc(LIN.signal, 1.6 * gain), wake);
  return mix3(c, sc(WHITE, 2.4 * gain), tip);
}
export const grp = (n: number) => Math.floor(n).toLocaleString('en-US');

// ------------------------------------------------------------------ H18: the line and its spark
export const LINE_Y = LINE_H18.y;
export const LINE_W = 1.5;
export const LINE_C: RGB = sc(LIN.bone, 0.78);
/** One bone hairline across the frame at y 540 (x0..x1), alpha a. */
export function drawLine(lb: LineBatch, x0 = -24, x1 = W + 24, a = 1, y = LINE_Y) {
  if (a <= 0.001 || x1 <= x0) return;
  lb.seg2(x0, y, x1, y, LINE_W, LINE_C, a);
}

/**
 * The spark's path across the H18 cut, as a function of time (so its sputter is identical on both
 * sides). Premiere: it traces ∞ (a lemniscate about the frame centre whose right tip is LINE_H18.sparkX)
 * from `infT0`, the ∞ flattens onto y 540; then it rests at x 1500 until the end of the sung "line",
 * travels back along the line (a backspace) and parks on the caret (x 300) at `parkT`.
 */
export const INF = { cx: 960, cy: 540, A: LINE_H18.sparkX - 960 };
export interface SparkPlan { infT0: number; infT1: number; flat0: number; flat1: number; back0: number; parkT: number; caretX: number }
export function sparkPlan(): SparkPlan {
  const infT0 = CUT.outro - BEAT; // the last beat of the premiere (where the drums stop)
  const infT1 = infT0 + 0.3;
  const back0 = wEnd(118); // end of the sung "line"
  // it parks on the caret on the downbeat after that
  return { infT0, infT1, flat0: infT1 - 0.04, flat1: infT1 + 0.14, back0, parkT: beatBefore(back0) + 2 * BEAT, caretX: MARK_C.x };
}
/** 0..1 flattening of the ∞ onto the line */
export const flatK = (sp: SparkPlan, t: number) => ease.inOutCubic(prog(t, sp.flat0, sp.flat1));
export function lemniscate(u: number, squash: number): P2 {
  const d = 1 + Math.sin(u) ** 2;
  return { x: INF.cx + (INF.A * Math.cos(u)) / d, y: INF.cy + (1 - squash) * (INF.A * Math.sin(u) * Math.cos(u)) / d };
}
/** u along the ∞ at time t (0 → 2π, starting and ending on the right tip) */
export const infU = (sp: SparkPlan, t: number) => TAU * ease.inOutCubic(prog(t, sp.infT0, sp.infT1));
/** x of the spark while it runs back along the line */
export function backX(sp: SparkPlan, t: number) {
  return lerp(LINE_H18.sparkX, sp.caretX, ease.inOutCubic(prog(t, sp.back0, sp.parkT)));
}
export function sparkAt(sp: SparkPlan, t: number): P2 | null {
  if (t < sp.infT0) return null;
  if (t < sp.infT1) return lemniscate(infU(sp, t), flatK(sp, t));
  if (t < sp.back0) return { x: LINE_H18.sparkX, y: LINE_Y };
  return { x: backX(sp, t), y: LINE_Y };
}
/** The spark and its sputter (rate 70/s while it lives; `until` = when it goes out). */
export function drawSpark(lb: LineBatch, sp: SparkPlan, t: number, I = 1, until = 1e9, scale = 1) {
  const p = sparkAt(sp, t);
  if (!p || t >= until) return;
  sparkParticles(lb, t, (tb) => (tb >= until ? null : sparkAt(sp, tb)), { rate: 70, intensity: 0.9 * I, speed: 210, seed: 18, life: 0.4 });
  sparkHead(lb, p.x, p.y, t, scale, I);
}

/** Post both plates return at the H18 cut. */
export const POST_H18 = {
  exposure: 1, bloom: 0.62, bloomThreshold: 0.86, bloomKnee: 0.12, bloomRadius: 0.75, halation: 0.25,
  ca: 1.2, grain: 0.055, vignette: 0.36, flash: 0, fade: 0, zoom: 1, invert: 0,
};
/** Blend overrides toward a target post by k (1 = exactly the target, no shake). */
export function toPost(o: PostOverrides, target: Record<string, number>, k: number): PostOverrides {
  if (k <= 0) return o;
  const r: PostOverrides = { ...o };
  for (const key of Object.keys(target)) {
    const v = ((o as Record<string, unknown>)[key] as number | undefined) ?? target[key]!;
    (r as Record<string, number>)[key] = lerp(v, target[key]!, k);
  }
  const s = o.shake ?? [0, 0];
  r.shake = [s[0] * (1 - k), s[1] * (1 - k)];
  if (k >= 1) { Object.assign(r, target); r.shake = [0, 0]; }
  return r;
}

// ------------------------------------------------------------------ glyph contours
/**
 * Contours (polylines, screen px, y down) of `text` set in Archivo Black at `size` px with its left
 * edge at x0 and baseline at y0. Letters sit at the kerned positions of Archivo 900 (the same design),
 * outlines come from the typeface JSON. Returns one entry per glyph: its contours and its centre.
 */
export interface GlyphOutline { ch: string; i: number; x: number; w: number; contours: P2[][]; cx: number; cy: number }
export function glyphOutlines(text: string, size: number, x0: number, y0: number, step = 8): GlyphOutline[] {
  const f = font3d('block');
  const lay = layout(text, F.archivo(100, 900), size);
  const out: GlyphOutline[] = [];
  for (const g of lay.glyphs) {
    if (g.ch === ' ') continue;
    const shapes = f.generateShapes(g.ch, size);
    const contours: P2[][] = [];
    let sx = 0, sy = 0, n = 0;
    const take = (path: { getLength(): number; getPointAt(u: number): { x: number; y: number } }) => {
      const len = path.getLength();
      const m = Math.max(4, Math.round(len / step));
      const pts: P2[] = [];
      for (let k = 0; k <= m; k++) {
        const p = path.getPointAt(Math.min(1, k / m));
        const q = { x: x0 + g.x + p.x, y: y0 - p.y };
        pts.push(q);
        if (k < m) { sx += q.x; sy += q.y; n++; }
      }
      contours.push(pts);
    };
    for (const s of shapes) { take(s); for (const h of s.holes) take(h); }
    out.push({ ch: g.ch, i: g.i, x: x0 + g.x, w: g.w, contours, cx: n ? sx / n : x0 + g.x, cy: n ? sy / n : y0 });
  }
  return out;
}
