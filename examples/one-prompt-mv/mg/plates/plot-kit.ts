// Helpers for plate `plot`: the 2D camera (log-zoom keys), the object's orthographic projection,
// heat-by-age polylines, chalk written by the caret, a 7-segment LED and the lens barrel's scales.
import * as THREE from 'three';
import { LineBatch } from '../px/lines';
import { LIN } from '../px/palette';
import { F, font } from '../px/type';
import { type StrokeText } from '../px/stroke';
import { clamp, hash, lerp, type V2 } from '../px/util';

// ------------------------------------------------------------------ camera
/** View-plane (px, y down) point at the screen centre, zoom, roll. screen = C + z·R(r)·(P − c). */
export interface Cam { x: number; y: number; z: number; r: number }
/** Log-zoom interpolation that keeps the move's fixed point fixed (pan in proportion to Δ(1/z)). */
export function zlerp(a: Cam, b: Cam, u: number): Cam {
  const z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), u));
  const den = 1 / a.z - 1 / b.z;
  const w = Math.abs(den) < 1e-6 ? u : (1 / a.z - 1 / z) / den;
  return { x: lerp(a.x, b.x, w), y: lerp(a.y, b.y, w), z, r: lerp(a.r, b.r, u) };
}
export type Aff = [number, number, number, number, number, number]; // canvas order a b c d e f
export function camAff(c: Cam): Aff {
  const a = c.z * Math.cos(c.r), b = c.z * Math.sin(c.r);
  return [a, b, -b, a, 960 - (a * c.x - b * c.y), 540 - (b * c.x + a * c.y)];
}
export const apply = (m: Aff, x: number, y: number): V2 => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
export function mul(m: Aff, n: Aff): Aff {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
export function inv(m: Aff): Aff {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
/** Translate · rotate · scale. */
export const trs = (x: number, y: number, r: number, s: number): Aff => [s * Math.cos(r), s * Math.sin(r), -s * Math.sin(r), s * Math.cos(r), x, y];

// ------------------------------------------------------------------ the object (orthographic)
/** Row-major M = Rx(pitch)·Ry(yaw): object (y up, z to viewer) → view. */
export function rotM(yaw: number, pitch: number): number[] {
  const c = Math.cos(yaw), s = Math.sin(yaw), cp = Math.cos(pitch), spp = Math.sin(pitch);
  return [c, 0, s, spp * s, cp, -spp * c, -cp * s, spp, cp * c];
}
export interface Obj { M: number[]; ox: number; oy: number; s: number }
/** Object point → view plane (px, y down). */
export function objToView(o: Obj, x: number, y: number, z: number): V2 {
  const M = o.M;
  const vx = M[0]! * x + M[1]! * y + M[2]! * z, vy = M[3]! * x + M[4]! * y + M[5]! * z;
  return { x: o.ox + o.s * vx, y: o.oy - o.s * vy };
}
/** Canvas affine: a disc lying in the object plane z = z1 (disc coords x right, y DOWN) → view plane. */
export function discAff(o: Obj, z1: number): Aff {
  const M = o.M, s = o.s;
  return [s * M[0]!, -s * M[3]!, -s * M[1]!, s * M[4]!, o.ox + s * M[2]! * z1, o.oy - s * M[5]! * z1];
}
export const mat3 = (M: number[]) => new THREE.Matrix3().set(M[0]!, M[1]!, M[2]!, M[3]!, M[4]!, M[5]!, M[6]!, M[7]!, M[8]!);

// ------------------------------------------------------------------ heat-by-age polylines
export type RGB = [number, number, number];
/** Base colour cooling from a white-hot tip and a signal wake (age in s since the pen passed). */
export function heatCol(base: RGB, age: number, k = 1): RGB {
  const h1 = Math.exp(-age / 0.05) * k, h2 = Math.exp(-age / 0.32) * k;
  const S = LIN.signal, E = LIN.ember;
  return [base[0] * (1 - h2) + S[0] * 1.3 * h2 + E[0] * 2.2 * h1, base[1] * (1 - h2) + S[1] * 1.3 * h2 + E[1] * 2.2 * h1, base[2] * (1 - h2) + S[2] * 1.3 * h2 + E[2] * 2.2 * h1];
}
export interface Item { pts: V2[]; L: number[]; t0: number; dur: number; w: number; a: number; dash?: number; base?: RGB }
export function mkItem(pts: V2[], t0: number, w = 1, a = 0.5, dash = 0, speed = 2600, base?: RGB): Item {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return { pts, L, t0, dur: Math.max(0.04, Math.min(0.4, L[L.length - 1]! / speed)), w, a, dash, base };
}
/** Draw an item written on from its start (world coords, mapped by `m`). */
export function drawItem(lb: LineBatch, it: Item, t: number, m: Aff, alpha = 1, bone: RGB = LIN.bone) {
  const p = clamp((t - it.t0) / it.dur);
  if (p <= 0 || alpha <= 0.003) return;
  const tot = it.L[it.L.length - 1]!, head = p * tot;
  const base = it.base ?? bone;
  for (let i = 1; i < it.pts.length; i++) {
    const s0 = it.L[i - 1]!, s1 = it.L[i]!;
    if (s0 >= head) break;
    const a = it.pts[i - 1]!, b = it.pts[i]!;
    const segs = it.dash ? Math.max(1, Math.ceil((s1 - s0) / it.dash)) : 1;
    for (let k = 0; k < segs; k++) {
      if (it.dash && k % 2 === 1) continue;
      const u0 = k / segs, u1 = Math.min(1, (k + 1) / segs);
      const sa = s0 + (s1 - s0) * u0;
      if (sa >= head) break;
      const sb = Math.min(head, s0 + (s1 - s0) * u1);
      const ub = (sb - s0) / Math.max(1e-6, s1 - s0);
      const pa = apply(m, lerp(a.x, b.x, u0), lerp(a.y, b.y, u0)), pb = apply(m, lerp(a.x, b.x, ub), lerp(a.y, b.y, ub));
      const tw = it.t0 + it.dur * ((sa + sb) / 2 / tot);
      const c = heatCol(base, t - tw);
      lb.seg2(pa.x, pa.y, pb.x, pb.y, it.w, c, it.a * alpha);
    }
  }
}

// ------------------------------------------------------------------ chalk written by the caret
export interface Chalk { st: StrokeText; ox: number; oy: number; ct: [number, number][]; w: number }
/** Song time at which the pen reaches arc length s. */
export function timeAtLen(ch: Chalk, s: number) {
  const cr = ch.st.charRange;
  for (let i = 0; i < cr.length; i++) {
    const [a, b] = cr[i]!;
    if (s <= b + 1e-6 && b > a) { const [t0, t1] = ch.ct[i]!; return t0 + ((s - a) / (b - a)) * (t1 - t0); }
  }
  return ch.ct[ch.ct.length - 1]![1];
}
/** Pen position (local) at arc length len. */
export function penAt(ch: Chalk, len: number): V2 {
  const st = ch.st;
  let last: V2 = { x: ch.ox, y: ch.oy };
  for (let i = 0; i < st.strokes.length; i++) {
    const s0 = st.startLen[i]!, pts = st.strokes[i]!, L = st.lens[i]!;
    const tot = L[L.length - 1] ?? 0;
    if (len <= s0 + tot) {
      const r = Math.max(0, len - s0);
      let j = 1;
      while (j < pts.length - 1 && L[j]! < r) j++;
      const a = pts[j - 1] ?? pts[0]!, b = pts[j] ?? a;
      const u = clamp((r - (L[j - 1] ?? 0)) / Math.max(1e-6, (L[j] ?? 0) - (L[j - 1] ?? 0)));
      return { x: ch.ox + lerp(a.x, b.x, u), y: ch.oy + lerp(a.y, b.y, u) };
    }
    const e = pts[pts.length - 1]!;
    last = { x: ch.ox + e.x, y: ch.oy + e.y };
  }
  return last;
}
/** Draw the chalk written so far: dust spread, then the stroke, both cooling from the pen. */
export function drawChalk(lb: LineBatch, ch: Chalk, t: number, m: Aff, scale: number, alpha: number, seed: number) {
  const st = ch.st;
  const chalk: RGB = [LIN.bone[0] * 0.8, LIN.bone[1] * 0.8, LIN.bone[2] * 0.78];
  for (let i = 0; i < st.strokes.length; i++) {
    const pts = st.strokes[i]!, L = st.lens[i]!, s0 = st.startLen[i]!;
    for (let j = 1; j < pts.length; j++) {
      const sa = s0 + L[j - 1]!, sb = s0 + L[j]!;
      const ta = timeAtLen(ch, sa);
      if (ta > t) return;
      let b = pts[j]!;
      const tb = timeAtLen(ch, sb);
      if (tb > t) {
        const u = clamp((t - ta) / Math.max(1e-6, tb - ta));
        b = { x: lerp(pts[j - 1]!.x, b.x, u), y: lerp(pts[j - 1]!.y, b.y, u) };
      }
      const a = pts[j - 1]!;
      const pa = apply(m, ch.ox + a.x, ch.oy + a.y), pb = apply(m, ch.ox + b.x, ch.oy + b.y);
      const age = t - (ta + Math.min(t, tb)) / 2;
      const grain = 0.72 + 0.28 * hash(i, j, seed);
      const c = heatCol(chalk, age);
      lb.seg2(pa.x, pa.y, pb.x, pb.y, ch.w * scale * 2.4, chalk, 0.07 * alpha);
      lb.seg2(pa.x, pa.y, pb.x, pb.y, ch.w * scale * (0.85 + 0.3 * hash(j, i, seed + 1)), c, grain * alpha);
    }
  }
}

// ------------------------------------------------------------------ 7-segment LED
//  segments: a top, b upper right, c lower right, d bottom, e lower left, f upper left, g middle
const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g' };
export function drawLED(lb: LineBatch, text: string, x: number, y: number, dw: number, dh: number, m: Aff, on: RGB, off: RGB, alpha: number, width: number) {
  let cx = x;
  const segPts = (s: string, ox: number): [number, number, number, number] => {
    const w = dw, h = dh, sk = 0.12 * h; // italic skew
    const P = (u: number, v: number) => [ox + u * w + (1 - v / h) * sk, y + v] as const;
    const g = 0.12 * w;
    switch (s) {
      case 'a': { const p = P(g, 0), q = P(1 - g, 0); return [p[0], p[1], q[0], q[1]]; }
      case 'b': { const p = P(1, h * 0.08), q = P(1, h * 0.46); return [p[0], p[1], q[0], q[1]]; }
      case 'c': { const p = P(1, h * 0.54), q = P(1, h * 0.92); return [p[0], p[1], q[0], q[1]]; }
      case 'd': { const p = P(g, h), q = P(1 - g, h); return [p[0], p[1], q[0], q[1]]; }
      case 'e': { const p = P(0, h * 0.54), q = P(0, h * 0.92); return [p[0], p[1], q[0], q[1]]; }
      case 'f': { const p = P(0, h * 0.08), q = P(0, h * 0.46); return [p[0], p[1], q[0], q[1]]; }
      default: { const p = P(g, h * 0.5), q = P(1 - g, h * 0.5); return [p[0], p[1], q[0], q[1]]; }
    }
  };
  for (const ch of text) {
    if (ch === ':' || ch === '.') {
      for (const v of ch === ':' ? [0.3, 0.72] : [1]) {
        const p = apply(m, cx + dw * 0.18, y + v * dh);
        lb.seg2(p.x, p.y, p.x + 0.01, p.y, width * 1.1, on, alpha);
      }
      cx += dw * 0.45;
      continue;
    }
    const lit = SEG[ch] ?? '';
    for (const s of 'abcdefg') {
      const [ax, ay, bx, by] = segPts(s, cx);
      const p = apply(m, ax, ay), q = apply(m, bx, by);
      const isOn = lit.includes(s);
      lb.seg2(p.x, p.y, q.x, q.y, width, isOn ? on : off, alpha * (isOn ? 1 : 0.5));
    }
    cx += dw * 1.38;
  }
}

// ------------------------------------------------------------------ the lens barrel's scales
/** Object angle of the witness mark on the barrel (faces the camera in the three-quarter view). */
export const WITNESS = 0.75;
/** Focus distances (m) → rotation of the focus ring that puts them under the witness mark (0 = ∞). */
export const focusAng = (d: number) => (d === Infinity ? 0 : 3.2 / (d + 0.6));
export const T_STOPS = ['2', '2.8', '4', '5.6', '8', '11', '16', '22'];
export const tAng = (i: number) => i * 0.23;
/**
 * Skin texture (alpha = engraving), u around the ring (canvas x = 0.75 − angle/TAU at the witness mark),
 * rows 0..256 the focus ring (back → front), 256..512 the T-stop ring.
 */
export function makeSkin(): THREE.CanvasTexture {
  const Wd = 2048, Hd = 512;
  const cv = document.createElement('canvas');
  cv.width = Wd; cv.height = Hd;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff'; c.strokeStyle = '#fff';
  const ux = (ang: number) => (((1 - (WITNESS + ang) / (Math.PI * 2)) % 1) + 1) % 1 * Wd;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  // ---- focus ring (rows 0..256): feet above, metres below, ticks at the front edge
  c.fillRect(0, 196, Wd, 2);
  const metres: [number, string][] = [[Infinity, '∞'], [10, '10'], [6, '6'], [4, '4'], [3, '3'], [2, '2'], [1.5, '1.5'], [1.2, '1.2'], [1, '1'], [0.8, '.8m']];
  c.font = font(F.mono(600), 40);
  for (const [d, s] of metres) {
    const x = ux(focusAng(d));
    c.fillText(s, x, 170);
    c.fillRect(x - 1.5, 198, 3, 58);
  }
  const feet: [number, string][] = [[Infinity, '∞'], [30, '30'], [15, '15'], [10, '10'], [7, '7'], [5, '5'], [4, '4'], [3, '3'], [2.5, "2'6"]];
  c.font = font(F.mono(400), 24);
  for (const [f, s] of feet) c.fillText(s, ux(focusAng(f === Infinity ? Infinity : f * 0.3048)), 92);
  for (let d = 0.8; d < 12; d *= 1.06) { const x = ux(focusAng(d)); c.fillRect(x - 0.8, 212, 1.6, 44); }
  // ---- T-stop ring (rows 256..512)
  c.fillRect(0, 256 + 196, Wd, 2);
  c.font = font(F.mono(600), 40);
  T_STOPS.forEach((s, i) => {
    const x = ux(tAng(i));
    c.fillText(i === 0 ? 'T2' : s, x, 256 + 170);
    c.fillRect(x - 1.5, 256 + 198, 3, 58);
    if (i < T_STOPS.length - 1) for (const f of [1 / 3, 2 / 3]) { const xx = ux(tAng(i + f)); c.fillRect(xx - 0.8, 256 + 216, 1.6, 40); }
  });
  c.font = font(F.mono(400), 22);
  c.fillText('ONE PROMPT OPTICS', ux(-0.9), 256 + 92);
  c.fillText('CINE 35 mm', ux(2.4), 256 + 92);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}
