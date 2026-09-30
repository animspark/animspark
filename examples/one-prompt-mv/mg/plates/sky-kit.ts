// Plate `sky`: shared kit — the camera, colour helpers, and the matte painting's brush strokes
// (spines, bristles, the words set along them, and when the brush reaches every point).
import { LIN, rgba } from '../px/palette';
import { F, layout, textPoints } from '../px/type';
import { clamp, hash, lerp, noise1, smoothstep, type V2 } from '../px/util';
import { wStart, wEnd, wText, charTimes } from './lyric';

export type RGB = [number, number, number];
export const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mix3 = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const add3 = (a: RGB, b: RGB): RGB => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const WHITE: RGB = [1, 0.93, 0.85];
const mixc = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** Fresh type (sRGB css): ember → signal → bone over ~0.35 s. */
export function hotCss(age: number, a = 1): string {
  if (age < 0) return rgba('bone', 0);
  const E: RGB = [255, 154, 77], S: RGB = [255, 90, 31], B: RGB = [238, 233, 223];
  const c = age < 0.08 ? mixc(E, S, age / 0.08) : mixc(S, B, smoothstep(0.08, 0.36, age));
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
/** "purple": violet-hot. White-violet → hot violet, settling on a light violet that reads on the paint. */
export function violetCss(age: number, a = 1): string {
  if (age < 0) return rgba('bone', 0);
  const Wv: RGB = [244, 236, 255], Hv: RGB = [182, 142, 255], Sv: RGB = [160, 118, 255];
  const c = age < 0.1 ? mixc(Wv, Hv, age / 0.1) : mixc(Hv, Sv, smoothstep(0.1, 0.5, age));
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
/** Fresh light (linear): white-hot tip → signal wake → base. */
export function hotLin(age: number, base: RGB, cool = 0.3): RGB {
  if (age < 0) return base;
  const h1 = Math.exp(-age / 0.05), h2 = Math.exp(-age / cool);
  return add3(add3(mul(base, 1 - h2), mul(LIN.signal, 1.8 * h2)), mul(WHITE, 1.6 * h1));
}
export const grp = (n: number, w = 6) => String(Math.max(0, Math.floor(n))).padStart(w, '0').replace(/(\d{3})(?=\d)/g, '$1 ');
export const comma = (n: number) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------------------------------------------------------------- camera (log zoom about the centre)
export interface Cam { x: number; y: number; z: number; r: number }
export function w2s(c: Cam, x: number, y: number): V2 {
  const dx = x - c.x, dy = y - c.y, cs = Math.cos(c.r), sn = Math.sin(c.r);
  return { x: 960 + c.z * (cs * dx - sn * dy), y: 540 + c.z * (sn * dx + cs * dy) };
}
export function s2w(c: Cam, x: number, y: number): V2 {
  const dx = (x - 960) / c.z, dy = (y - 540) / c.z, cs = Math.cos(c.r), sn = Math.sin(c.r);
  return { x: c.x + cs * dx + sn * dy, y: c.y - sn * dx + cs * dy };
}
/** Canvas2D transform that maps world → screen for camera c. */
export function camMatrix(c: Cam): [number, number, number, number, number, number] {
  const cs = Math.cos(c.r) * c.z, sn = Math.sin(c.r) * c.z;
  return [cs, sn, -sn, cs, 960 - (cs * c.x - sn * c.y), 540 - (sn * c.x + cs * c.y)];
}

// ---------------------------------------------------------------- the strokes
export const STEP = 8; // spine sampling (world px)

export interface BigGlyph { ch: string; x: number; y: number; a: number; w: number; s: number; tg: number; word: number; size: number; fam: string; cap: number }
export interface Chunk { text: string; x: number; y: number; a: number; th: number; size: number }
export interface Bristle { X: Float32Array; Y: Float32Array; D: Float32Array; b: number; w: number }
export interface Stroke {
  id: number; run: boolean;
  pts: V2[]; ang: Float32Array; nx: Float32Array; ny: Float32Array; prof: Float32Array; tot: number; n: number;
  w: number;
  keys: [number, number][]; // (arc length, time) of the head
  tS: Float32Array; // time the head reaches sample i
  t0: number; t1: number;
  br: Bristle[];
  glyphs: BigGlyph[];
  chunks: Chunk[];
  ticks: { i: number; label: string }[];
}

type Spine = (u: number) => V2;

function resample(f: Spine): V2[] {
  const dense: V2[] = [];
  for (let i = 0; i <= 2000; i++) dense.push(f(i / 2000));
  const out: V2[] = [dense[0]!];
  let acc = 0, next = STEP;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1]!, b = dense[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    while (acc + d >= next) {
      const k = (next - acc) / d;
      out.push({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
      next += STEP;
    }
    acc += d;
  }
  return out;
}

/** Piecewise-linear t(s) through the keys. */
function timeAtS(keys: [number, number][], s: number) {
  if (s <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [s1, t1] = keys[i]!, [s0, t0] = keys[i - 1]!;
    if (s <= s1) return lerp(t0, t1, (s - s0) / Math.max(1e-6, s1 - s0));
  }
  return keys[keys.length - 1]![1];
}
/** Head arc length at time t (inverse of the keys). */
export function headS(st: Stroke, t: number) {
  const k = st.keys;
  if (t <= k[0]![1]) return 0;
  for (let i = 1; i < k.length; i++) {
    const [s1, t1] = k[i]!, [s0, t0] = k[i - 1]!;
    if (t <= t1) return lerp(s0, s1, (t - t0) / Math.max(1e-6, t1 - t0));
  }
  return st.tot;
}
/** Point, tangent angle and width profile on the spine at arc length s. */
export function spineAt(st: Stroke, s: number) {
  const f = clamp(s / STEP, 0, st.n - 1);
  const i = Math.min(st.n - 2, Math.floor(f)), k = f - i;
  const a = st.pts[i]!, b = st.pts[i + 1]!;
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), a: st.ang[i]!, nx: st.nx[i]!, ny: st.ny[i]!, p: lerp(st.prof[i]!, st.prof[i + 1]!, k) };
}

const MICRO = 'PAINT THE SKY IN PURPLE WORDS · ';

function build(id: number, run: boolean, f: Spine, w: number, seed: number): Stroke {
  const pts = resample(f);
  const n = pts.length;
  const ang = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), prof = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 2)]!, b = pts[Math.min(n - 1, i + 2)]!;
    const an = Math.atan2(b.y - a.y, b.x - a.x);
    ang[i] = an; nx[i] = -Math.sin(an); ny[i] = Math.cos(an);
    const u = i / (n - 1);
    // pressure: the brush lands, holds, lifts (and swells a little on the way)
    prof[i] = (0.42 + 0.58 * smoothstep(0, 0.04, u)) * (1 - 0.4 * smoothstep(0.86, 1, u)) * (1 + 0.07 * Math.sin(u * 9 + seed));
  }
  const tot = (n - 1) * STEP;
  const nb = run ? 46 : 34;
  const br: Bristle[] = [];
  for (let k = 0; k < nb; k++) {
    const o0 = ((k + 0.5) / nb - 0.5) * w * (0.94 + 0.08 * hash(k, seed, 1)) + (hash(k, seed, 2) - 0.5) * 3;
    const edge = Math.abs(o0) / (w / 2);
    const X = new Float32Array(n), Y = new Float32Array(n), D = new Float32Array(n);
    const thr0 = 0.1 + 0.28 * edge * edge + (run ? 0 : 0.08);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), s = i * STEP;
      const splay = 1 + 0.25 * smoothstep(0.8, 1, u);
      const o = o0 * prof[i]! * splay + 2.4 * noise1(s / 70 + k * 3.1, seed + k);
      X[i] = pts[i]!.x + nx[i]! * o; Y[i] = pts[i]!.y + ny[i]! * o;
      const nz = 0.5 + 0.5 * noise1(s / 38 + k * 11.3, seed * 7 + k);
      const thr = thr0 + 0.45 * smoothstep(0.78, 1, u) + 0.3 * (1 - smoothstep(0, 0.05, u));
      D[i] = smoothstep(thr - 0.07, thr + 0.07, nz);
    }
    const b = 0.3 + 0.7 * hash(k, seed, 3) ** 1.6;
    br.push({ X, Y, D, b, w: 0.9 + 0.9 * hash(k, seed, 4) });
  }
  const ticks: { i: number; label: string }[] = [];
  if (run) for (let s = 100; s < tot - 20; s += 100) ticks.push({ i: Math.round(s / STEP), label: s % 500 === 0 ? `${s}` : '' });
  return { id, run, pts, ang, nx, ny, prof, tot, n, w, keys: [], tS: new Float32Array(n), t0: 0, t1: 0, br, glyphs: [], chunks: [], ticks };
}

function setKeys(st: Stroke, keys: [number, number][]) {
  st.keys = keys;
  for (let i = 0; i < st.n; i++) st.tS[i] = timeAtS(keys, i * STEP);
  st.t0 = keys[0]![1]; st.t1 = keys[keys.length - 1]![1];
}

/** Lay words [w0..w1] along a run from arc length s0: glyphs sit on the spine, times are the sung char times. */
function setWords(st: Stroke, w0: number, w1: number, s0: number, fam: string, size: number, cap: number) {
  const words: string[] = [];
  for (let i = w0; i <= w1; i++) words.push(wText(i).toUpperCase());
  const text = words.join(' ');
  const lay = layout(text, fam, size, size * 0.01);
  const keys: [number, number][] = [];
  let gi = 0;
  for (let wi = 0; wi < words.length; wi++) {
    const idx = w0 + wi, ct = charTimes(idx);
    const d = Math.min(0.5, Math.max(0.12, wEnd(idx) - wStart(idx)));
    const chars = Array.from(words[wi]!);
    chars.forEach((ch, ci) => {
      const g = lay.glyphs[gi + ci]!;
      const sL = s0 + g.x, sC = sL + g.w / 2;
      const q = spineAt(st, sC);
      st.glyphs.push({ ch, x: q.x, y: q.y, a: q.a, w: g.w, s: sL, tg: ct[ci]!, word: idx, size, fam, cap });
      keys.push([sL, ct[ci]!]);
      if (ci === chars.length - 1) keys.push([sL + g.w, ct[ci]! + d / chars.length]);
    });
    gi += chars.length + 1;
  }
  return { keys, width: lay.width };
}

/** Micro lettering rows along the stroke (the paint is made of the lyric): word-sized chunks. */
function setRows(st: Stroke, offs: number[], size: number, seed: number) {
  const words = MICRO.trim().split(' ');
  const fam = F.archivo(87.5, 700);
  offs.forEach((of, ri) => {
    let s = 20 + 40 * hash(ri, seed);
    let wi = Math.floor(hash(ri, seed, 2) * words.length) + words.length * 50;
    while (s < st.tot - 60) {
      const txt = words[wi % words.length]!;
      const wd = layout(txt, fam, size, 1.2).width;
      const q = spineAt(st, s + wd / 2);
      const o = of * st.w * 0.5 * q.p;
      const flip = st.run ? 0 : Math.PI; // returns run right→left: the lettering still reads left→right
      st.chunks.push({ text: txt, x: q.x + q.nx * o, y: q.y + q.ny * o, a: q.a + flip, th: st.tS[Math.min(st.n - 1, Math.round((s + wd) / STEP))]!, size });
      s += wd + size * 0.7;
      wi += st.run ? 1 : -1;
    }
  });
}

export interface Paint { strokes: Stroke[]; tStart: number; tEnd: number; fam: string; famP: string; size: number; cap: number }

/**
 * The matte painting: run A "PAINT THE SKY" (top), a slashed return, run B "IN PURPLE WORDS" (middle),
 * a return along the horizon. The head reaches every glyph on its sung char time.
 */
export function buildPaint(T0: number): Paint {
  const size = 138, fam = F.archivo(112.5, 900), famP = F.archivo(112.5, 900);
  const cap = size * 0.72;
  const yA = (u: number) => 228 - 34 * Math.sin(Math.PI * u) + 9 * Math.sin(u * 7.1);
  const A = build(0, true, (u) => ({ x: lerp(70, 1850, u), y: yA(u) }), 206, 11);
  const R1 = build(1, false, (u) => ({ x: lerp(1850, 90, u), y: lerp(yA(1), 505, u) - 60 * Math.sin(Math.PI * u) }), 150, 23);
  const yB = (u: number) => lerp(505, 556, u) - 30 * Math.sin(Math.PI * u) + 7 * Math.sin(u * 6.3);
  const B = build(2, true, (u) => ({ x: lerp(90, 1850, u), y: yB(u) }), 214, 37);
  const R2 = build(3, false, (u) => ({ x: lerp(1850, 70, u), y: yB(1) + (788 - yB(1)) * smoothstep(0, 0.42, u) + 8 * Math.sin(u * 5) }), 172, 41);

  // run A: the text ends just short of the stroke's end, the head arrives on "Paint"
  {
    const tA0 = T0 + 0.07;
    const meas = layout(['PAINT', 'THE', 'SKY'].join(' '), fam, size, size * 0.01).width;
    const s0 = Math.max(120, A.tot - 70 - meas);
    const { keys } = setWords(A, 58, 60, s0, fam, size, cap);
    const tEnd = Math.max(keys[keys.length - 1]![1] + 0.03, wEnd(60) + 0.02);
    setKeys(A, [[0, tA0], ...keys, [A.tot, tEnd]]);
  }
  // return 1: a slash, between "sky" and "in"
  setKeys(R1, [[0, A.t1], [R1.tot * 0.5, lerp(A.t1, wStart(61) - 0.035, 0.42)], [R1.tot, wStart(61) - 0.035]]);
  // run B: "IN" arrives at once; the held "words" drags the brush to the end
  {
    const s0 = 40;
    const { keys } = setWords(B, 61, 63, s0, fam, size, cap);
    setKeys(B, [[0, R1.t1], ...keys, [B.tot, wEnd(63)]]);
  }
  // return 2: along the horizon, finished before the downbeat
  setKeys(R2, [[0, B.t1], [R2.tot, B.t1 + 0.26]]);

  setRows(A, [-0.74, 0.76], 15, 1);
  setRows(R1, [-0.55, 0.05, 0.6], 14, 2);
  setRows(B, [-0.76, 0.74], 15, 3);
  setRows(R2, [-0.55, 0.02, 0.58], 14, 4);
  const strokes = [A, R1, B, R2];
  return { strokes, tStart: A.t0, tEnd: R2.t1, fam, famP, size, cap };
}

/** Where the brush is at t (world), which stroke, and its tangent; null outside the painting. */
export function brushAt(p: Paint, t: number) {
  for (const st of p.strokes) {
    if (t >= st.t0 && t <= st.t1) {
      const s = headS(st, t), q = spineAt(st, s);
      return { st, s, x: q.x, y: q.y, a: q.a, nx: q.nx, ny: q.ny, p: q.p };
    }
  }
  return null;
}

/** Points filling one glyph of a painted word (world), for its letter-birds. */
export function glyphPoints(g: BigGlyph, step: number, seed: number): V2[] {
  const pts = textPoints(g.ch, g.fam, g.size, step, seed);
  const cs = Math.cos(g.a), sn = Math.sin(g.a);
  return pts.map((q) => {
    const lx = q.x - g.w / 2, ly = q.y + g.cap / 2;
    return { x: g.x + cs * lx - sn * ly, y: g.y + sn * lx + cs * ly };
  });
}
