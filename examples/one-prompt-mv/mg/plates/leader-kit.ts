// Shared by the `leader` and `prompt` plates: the caret at the H1 hand-off, pen strokes with heat by
// age, the log-zoom keyframe camera, hot type colours, and the post values both plates settle to at
// their common cut (so the cut is invisible: same caret pixels, same post).
import { LineBatch } from '../px/lines';
import { W, H } from '../px/gl';
import { LIN, rgba } from '../px/palette';
import { clamp, ease, lerp } from '../px/util';
import type { PostOverrides } from '../px/scene';
import { CARET_H1 } from './handoff';

export type RGB = [number, number, number];
export type P = { x: number; y: number };
export type Ease = (x: number) => number;
export const pt = (x: number, y: number): P => ({ x, y });

// ------------------------------------------------------------------ the caret (H1)
/** The caret block exactly at CARET_H1 (centre x/y, w x h), in screen px. `a` = signal opacity, `hk` = 0..1 of its height. */
export function drawCaretH1(c: CanvasRenderingContext2D, a: number, hk = 1) {
  if (a <= 0 || hk <= 0) return;
  const { x, y, w, h } = CARET_H1;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = rgba('signal', a);
  c.fillRect(x - w / 2, y - (h / 2) * hk, w, h * hk);
}

/** Post values at the leader → prompt cut (both plates return exactly these on their boundary frames). */
export const EDGE_POST = {
  exposure: 1, bloom: 0.6, bloomThreshold: 0.88, bloomKnee: 0.12, bloomRadius: 0.75, halation: 0.25,
  ca: 1.2, grain: 0.055, vignette: 0.38, flash: 0, fade: 0, zoom: 1, invert: 0,
};
/** Blend a plate's post overrides toward EDGE_POST by k (1 = exactly EDGE_POST, no shake). */
export function toEdge(o: PostOverrides, k: number): PostOverrides {
  if (k <= 0) return o;
  const r: PostOverrides = { ...o };
  for (const key of Object.keys(EDGE_POST) as (keyof typeof EDGE_POST)[]) {
    const v = (o[key] as number | undefined) ?? EDGE_POST[key];
    (r as Record<string, number>)[key] = lerp(v, EDGE_POST[key], k);
  }
  const s = o.shake ?? [0, 0];
  r.shake = [s[0] * (1 - k), s[1] * (1 - k)];
  if (k >= 1) { Object.assign(r, EDGE_POST); r.shake = [0, 0]; }
  return r;
}

// ------------------------------------------------------------------ colours
export function mixCss(a: string, b: string, k: number, alpha = 1) {
  const pa = rgba(a).match(/\d+/g)!.map(Number), pb = rgba(b).match(/\d+/g)!.map(Number);
  k = clamp(k);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},${alpha})`;
}
/** Fresh type: an ember flash, signal, then cooled to bone about 0.3 s after it landed. */
export function hotType(age: number, a = 1, cool = 0.3): string {
  if (age < 0) return rgba('bone', a);
  if (age < 0.05) return mixCss('ember', 'signal', age / 0.05, a);
  return mixCss('signal', 'bone', clamp((age - 0.05) / Math.max(0.05, cool - 0.05)), a);
}
export const scale3 = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

// ------------------------------------------------------------------ pen strokes with heat by age
export interface Stroke {
  pts: P[]; L: Float32Array; tot: number;
  /** time at which the pen reaches each point */
  tD: Float32Array;
  t0: number; t1: number;
  base: RGB; a0: number; hot: number; width: number; dash: number; group: string;
}
export interface StrokeOpts { base?: RGB; a0?: number; hot?: number; width?: number; dash?: number; group?: string; ez?: Ease }

export function lengths(pts: P[]) {
  const L = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) L[i] = L[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return L;
}
export function at(pts: P[], L: Float32Array, s: number): P {
  const n = pts.length;
  if (n === 1 || s <= 0) return pts[0]!;
  if (s >= L[n - 1]!) return pts[n - 1]!;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m]! < s) lo = m; else hi = m; }
  const u = (s - L[lo]!) / Math.max(1e-6, L[hi]! - L[lo]!);
  return pt(lerp(pts[lo]!.x, pts[hi]!.x, u), lerp(pts[lo]!.y, pts[hi]!.y, u));
}
/** A stroke drawn by the pen from t0 to t1 along an ease (per-point times by inverting the ease). */
export function mkStroke(pts: P[], t0: number, t1: number, o: StrokeOpts = {}): Stroke {
  const L = lengths(pts), tot = L[L.length - 1]!;
  const ez = o.ez ?? ease.linear;
  const tD = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const target = tot > 0 ? L[i]! / tot : 1;
    let lo = 0, hi = 1;
    for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (ez(m) < target) lo = m; else hi = m; }
    tD[i] = t0 + (t1 - t0) * hi;
  }
  return mkTimed(pts, tD, o);
}
/** A stroke with explicit per-point pen times. */
export function mkTimed(pts: P[], tD: Float32Array, o: StrokeOpts = {}): Stroke {
  const L = lengths(pts);
  return {
    pts, L, tot: L[L.length - 1]!, tD, t0: tD[0]!, t1: tD[tD.length - 1]!,
    base: o.base ?? LIN.bone, a0: o.a0 ?? 0.8, hot: o.hot ?? 1, width: o.width ?? 1.2, dash: o.dash ?? 0, group: o.group ?? 'main',
  };
}
/** Heat by age: tip exp(-age/0.05) white-hot, wake exp(-age/0.32) signal, cooling to the base colour. */
export function heat(base: RGB, age: number, hot: number): { col: RGB; h1: number; h2: number } {
  const h1 = hot * Math.exp(-age / 0.05), h2 = hot * Math.exp(-age / 0.32);
  const sig = LIN.signal, emb = LIN.ember;
  return {
    col: [
      base[0] * (1 - h2) + sig[0] * 1.5 * h2 + emb[0] * 2.6 * h1,
      base[1] * (1 - h2) + sig[1] * 1.5 * h2 + emb[1] * 2.6 * h1,
      base[2] * (1 - h2) + sig[2] * 1.5 * h2 + emb[2] * 2.6 * h1,
    ],
    h1, h2,
  };
}
/**
 * Draw the part of a stroke the pen has reached by t, each segment coloured by how long ago the pen
 * passed it. `xf` maps a stroke point (and its index) to screen px; `ga` is the group opacity.
 * Returns the head position (screen), or null if nothing is drawn yet.
 */
export function drawStroke(L: LineBatch, s: Stroke, t: number, xf: (p: P, i: number) => [number, number], ga: number, hotMul = 1): [number, number] | null {
  if (t < s.t0 || ga <= 0.002) return null;
  const A = s.a0 * ga;
  let prev: [number, number] | null = null;
  let acc = 0;
  const n = s.pts.length;
  for (let i = 0; i < n; i++) {
    let cur: [number, number];
    let stop = false;
    if (s.tD[i]! > t) {
      if (i === 0) break;
      // partial segment up to the head
      const a = s.tD[i - 1]!, b = s.tD[i]!;
      const u = clamp((t - a) / Math.max(1e-6, b - a));
      const pa = xf(s.pts[i - 1]!, i - 1), pb = xf(s.pts[i]!, i);
      cur = [lerp(pa[0], pb[0], u), lerp(pa[1], pb[1], u)];
      stop = true;
    } else cur = xf(s.pts[i]!, i);
    if (prev) {
      const age = Math.max(0, t - Math.min(s.tD[i]!, t));
      const { col, h1, h2 } = heat(s.base, age, s.hot * hotMul);
      const al = Math.min(1, A + h2 * 0.8 * ga);
      const wd = s.width * (1 + 0.6 * h1);
      const segLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      if (s.dash > 0) {
        let u0 = 0;
        while (u0 < segLen) {
          const ph = (acc + u0) % s.dash;
          const on = ph < s.dash * 0.55;
          const run = Math.min(segLen - u0, on ? s.dash * 0.55 - ph : s.dash - ph);
          if (on && run > 0.05) {
            const a1 = u0 / segLen, b1 = (u0 + run) / segLen;
            L.seg2(lerp(prev[0], cur[0], a1), lerp(prev[1], cur[1], a1), lerp(prev[0], cur[0], b1), lerp(prev[1], cur[1], b1), wd, col, al);
          }
          u0 += Math.max(run, 0.05);
        }
      } else L.seg2(prev[0], prev[1], cur[0], cur[1], wd, col, al);
      acc += segLen;
    }
    prev = cur;
    if (stop) break;
  }
  return prev;
}

// ------------------------------------------------------------------ camera (2D, y down)
export interface Cam { cx: number; cy: number; z: number; roll: number }
export interface CamKey extends Cam { t: number; ez?: Ease }
export const K = (t: number, cx: number, cy: number, z: number, roll = 0, ez?: Ease): CamKey => ({ t, cx, cy, z, roll, ez });
/** Keyframed camera; zooms interpolate in log space about the move's fixed point (dives read as one gesture). */
export function camAt(ks: CamKey[], t: number): Cam {
  if (t <= ks[0]!.t) return ks[0]!;
  for (let i = 1; i < ks.length; i++) {
    const b = ks[i]!;
    if (t > b.t) continue;
    const a = ks[i - 1]!;
    const k = (b.ez ?? ease.inOutCubic)(clamp((t - a.t) / Math.max(1e-4, b.t - a.t)));
    const z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), k));
    const roll = lerp(a.roll, b.roll, k);
    if (Math.abs(b.z - a.z) > a.z * 0.04) {
      const fx = (b.z * b.cx - a.z * a.cx) / (b.z - a.z), fy = (b.z * b.cy - a.z * a.cy) / (b.z - a.z);
      return { cx: fx - (a.z / z) * (fx - a.cx), cy: fy - (a.z / z) * (fy - a.cy), z, roll };
    }
    return { cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), z, roll };
  }
  return ks[ks.length - 1]!;
}
/** World (y down) → screen px. */
export function w2s(c: Cam, x: number, y: number): [number, number] {
  const dx = (x - c.cx) * c.z, dy = (y - c.cy) * c.z;
  const co = Math.cos(c.roll), si = Math.sin(c.roll);
  return [W / 2 + co * dx - si * dy, H / 2 + si * dx + co * dy];
}
/** Canvas transform for the camera (world coordinates drawn directly). */
export function camTransform(ctx: CanvasRenderingContext2D, c: Cam) {
  const co = Math.cos(c.roll) * c.z, si = Math.sin(c.roll) * c.z;
  ctx.setTransform(co, si, -si, co, W / 2 - (co * c.cx - si * c.cy), H / 2 - (si * c.cx + co * c.cy));
}
/** A thin filled right-pointing triangle (Plex Mono has no ▸). */
export function tri(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.beginPath(); c.moveTo(x - r * 0.8, y - r); c.lineTo(x + r * 0.9, y); c.lineTo(x - r * 0.8, y + r); c.closePath(); c.fill();
}
