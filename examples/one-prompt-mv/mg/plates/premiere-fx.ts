// Premiere plate: fireworks drawn in lines (stateless: every spark is a pure function of its shell's
// burst time and its index), the searchlights (engraved beams), and the sparks that write TONIGHT!.
import { LineBatch } from '../px/lines';
import { LIN } from '../px/palette';
import { clamp, ease, frameIdx, hash, lerp, prog, TAU } from '../px/util';
import { type V3 } from './city-geo';
import { mix3, sc, WHITE, type P2, type RGB, type GlyphOutline } from './premiere-kit';

export interface Shell {
  /** burst time, launch time */
  t: number; t0: number;
  /** launch point and burst centre (world) */
  from: V3; c: V3;
  n: number; v: number; drag: number; g: number; life: number;
  /** 0 peony, 1 willow (long falling tails), 2 ring (a flat ring, tilted), 3 comet (small, low) */
  kind: number; seed: number; I: number;
  /** a label for the shell's tag (caused annotation) */
  tag: string;
}

/** A spark's colour by age (0..1 of its life): white-hot, ember, signal, fading to blood. */
function sparkCol(u: number, I: number): RGB {
  const hot = Math.exp(-u / 0.05);
  let c = mix3(sc(LIN.signal, 1.5), sc(LIN.ember, 2.2), Math.exp(-u / 0.25));
  c = mix3(sc(LIN.blood, 0.7), c, 1 - smooth01((u - 0.55) / 0.45));
  return sc(mix3(c, sc(WHITE, 3), hot), I);
}
const smooth01 = (x: number) => { const k = clamp(x); return k * k * (3 - 2 * k); };

/** world position of spark j of shell s at age a (s) */
export function sparkPos(s: Shell, j: number, a: number): V3 {
  const h1 = hash(j, s.seed), h2 = hash(j, s.seed + 1), h3 = hash(j, s.seed + 2);
  let dx: number, dy: number, dz: number;
  if (s.kind === 2) {
    // a ring, tilted towards the viewer
    const ang = (j / s.n) * TAU + h1 * 0.05;
    const tl = 0.5 + 0.4 * hash(s.seed, 9);
    dx = Math.cos(ang); dy = Math.sin(ang) * Math.cos(tl); dz = Math.sin(ang) * Math.sin(tl);
  } else {
    const zc = 2 * h1 - 1, ph = h2 * TAU, r = Math.sqrt(1 - zc * zc);
    dx = r * Math.cos(ph); dy = r * Math.sin(ph); dz = zc;
  }
  const v = s.v * (s.kind === 2 ? 1 : 0.82 + 0.18 * h3);
  const k = s.drag;
  const d = (v * (1 - Math.exp(-k * a))) / k;
  const fall = 0.5 * s.g * a * a;
  return [s.c[0] + dx * d, s.c[1] + dy * d, s.c[2] + dz * d - fall];
}

type Proj = (p: V3) => P2;

/** Draw every live shell at t: rockets rising, bursts, falling tails. Returns the light they cast. */
export function drawShells(lb: LineBatch, shells: Shell[], t: number, proj: Proj, zoom: number, alpha = 1): number {
  let light = 0;
  for (const s of shells) {
    if (t < s.t0 || t > s.t + s.life + 0.2) continue;
    if (t < s.t) {
      // the rocket: a hot head decelerating up to the burst point, a sputtering trail
      const u = (t - s.t0) / (s.t - s.t0);
      const at = (uu: number): V3 => { const e = ease.outQuad(clamp(uu)); return [lerp(s.from[0], s.c[0], e), lerp(s.from[1], s.c[1], e), lerp(s.from[2], s.c[2], e) + 0.6 * Math.sin(uu * 9 + s.seed) * (1 - uu)]; };
      let prev = proj(at(u));
      for (let k = 1; k <= 8; k++) {
        const q = proj(at(u - k * 0.035));
        const f = 1 - k / 9;
        lb.seg2(prev.x, prev.y, q.x, q.y, 1.6 * f + 0.4, sc(LIN.ember, 2.2 * f * s.I), f * alpha);
        prev = q;
      }
      const h = proj(at(u));
      lb.seg2(h.x, h.y, h.x + 0.01, h.y, 4, sc(WHITE, 2.5 * s.I), alpha);
      continue;
    }
    const a = t - s.t;
    light += s.I * Math.pow(0.5, a / 0.09);
    const tail = s.kind === 1 ? 0.16 : s.kind === 3 ? 0.05 : 0.06;
    const w = s.kind === 3 ? 1.2 : 1.6;
    for (let j = 0; j < s.n; j++) {
      const lf = s.life * (0.6 + 0.4 * hash(j, s.seed + 3));
      if (a > lf) continue;
      const u = a / lf;
      // crackle: the last third twinkles on the frame clock
      const tw = u > 0.65 ? (hash(j, frameIdx(t), s.seed) > 0.45 ? 1.4 : 0.15) : 1;
      const col = sparkCol(u, s.I * tw);
      const al = Math.min(1, (1 - u) * 2.2) * alpha;
      const p = proj(sparkPos(s, j, a));
      const q = proj(sparkPos(s, j, Math.max(0, a - tail)));
      lb.seg2(q.x, q.y, p.x, p.y, w * (1 - 0.5 * u), col, al);
      if (s.kind === 1) {
        const r = proj(sparkPos(s, j, Math.max(0, a - tail * 2.6)));
        lb.seg2(r.x, r.y, q.x, q.y, 1, sc(LIN.ember, 0.55 * s.I * (1 - u)), al * 0.7);
      }
    }
    // the burst flash and its shock ring, flat in the screen
    if (a < 0.3) {
      const c = proj(s.c);
      const R = ((s.v * (1 - Math.exp(-s.drag * a))) / s.drag) * zoom * 1.12 + 6;
      const k = Math.pow(1 - a / 0.3, 2);
      const n = 72;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        lb.seg2(c.x + Math.cos(a0) * R, c.y + Math.sin(a0) * R, c.x + Math.cos(a1) * R, c.y + Math.sin(a1) * R, 1 + 1.5 * k, sc(LIN.signal, 1.2 * k * s.I), k * 0.6 * alpha);
      }
      if (a < 0.06) lb.seg2(c.x, c.y, c.x + 0.01, c.y, 30 * (1 - a / 0.06), sc(WHITE, 2 * s.I), (1 - a / 0.06) * alpha);
    }
  }
  return light;
}

// ------------------------------------------------------------------ searchlights
export interface Beam { o: P2; e: P2; w0: number; w1: number; I: number }
/** An engraved searchlight beam: two edge hairlines and hatching across the cone, fading with distance. */
export function drawBeam(lb: LineBatch, b: Beam, alpha: number) {
  const dx = b.e.x - b.o.x, dy = b.e.y - b.o.y, L = Math.hypot(dx, dy);
  if (L < 4 || alpha <= 0.001) return;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const edge = sc(LIN.bone, 0.2 * b.I), hat = sc(LIN.bone, 0.075 * b.I);
  const N = 14;
  for (let k = 0; k < N; k++) {
    const s0 = k / N, s1 = (k + 1) / N;
    const w0 = lerp(b.w0, b.w1, s0), w1 = lerp(b.w0, b.w1, s1);
    const f = Math.exp(-s0 * 2.2) * alpha;
    for (const sg of [-1, 1]) {
      lb.seg2(b.o.x + dx * s0 + nx * w0 * sg, b.o.y + dy * s0 + ny * w0 * sg, b.o.x + dx * s1 + nx * w1 * sg, b.o.y + dy * s1 + ny * w1 * sg, 1, edge, f);
    }
  }
  // the hatch: strokes across the cone every 7 px, slightly slanted (a burin's cut), dimmer far out
  const n = Math.min(260, Math.floor(L / 7));
  for (let k = 1; k < n; k++) {
    const s = k / n, w = lerp(b.w0, b.w1, s) * 0.92;
    const f = Math.exp(-s * 2.6) * alpha;
    const cx = b.o.x + dx * s, cy = b.o.y + dy * s, sl = 0.18 * w;
    lb.seg2(cx - nx * w - ux * sl, cy - ny * w - uy * sl, cx + nx * w + ux * sl, cy + ny * w + uy * sl, 0.8, hat, f);
  }
  // the core: a faint hot axis near the lamp
  lb.seg2(b.o.x, b.o.y, b.o.x + dx * 0.25, b.o.y + dy * 0.25, 1.2, sc(LIN.ember, 0.5 * b.I), alpha * 0.6);
  lb.seg2(b.o.x, b.o.y, b.o.x + 0.01, b.o.y, 5, sc(WHITE, 1.4 * b.I), alpha);
}

// ------------------------------------------------------------------ TONIGHT!, written by fireworks
export interface WordSparks {
  glyphs: GlyphOutline[];
  /** burst time per glyph */
  tk: number[];
  /** the targets: glyph index, point */
  pts: { g: number; p: P2; j: number }[];
  /** when they burst again and fall (the climax), and the word's centre */
  tRe: number; c: P2;
}

export function buildWordSparks(glyphs: GlyphOutline[], tk: number[], tRe: number, every = 1): WordSparks {
  const pts: WordSparks['pts'] = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  glyphs.forEach((g, gi) => {
    for (const ct of g.contours) for (let k = 0; k < ct.length - 1; k += every) {
      const p = ct[k]!;
      pts.push({ g: gi, p, j: pts.length });
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
  });
  return { glyphs, tk, pts, tRe, c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } };
}

/** where spark j is at time t (null: not born / gone). `fly` = seconds to reach the outline. */
export function wordSparkAt(ws: WordSparks, i: number, t: number, launch: (t: number) => P2): { p: P2; q: P2; heat: number; I: number } | null {
  const sp = ws.pts[i]!, g = ws.glyphs[sp.g]!, tb = ws.tk[sp.g]!;
  if (t < tb) return null;
  const j = sp.j;
  const C = { x: g.cx + (hash(sp.g, 3) - 0.5) * 20, y: g.cy + (hash(sp.g, 4) - 0.5) * 20 };
  const T = sp.p;
  const path = (a: number): P2 => {
    const e = 1 - Math.exp(-Math.max(0, a) / 0.075);
    const dx = T.x - C.x, dy = T.y - C.y;
    const bul = (hash(j, 11) - 0.5) * 0.5 * Math.sin(Math.PI * Math.min(1, e));
    // a little overshoot outward, then the spark settles on its point
    const ov = 1 + 0.12 * Math.sin(Math.min(1, a / 0.34) * Math.PI) * hash(j, 12);
    return { x: C.x + dx * e * ov - dy * bul, y: C.y + dy * e * ov + dx * bul };
  };
  void launch;
  const a = t - tb;
  if (t < ws.tRe) {
    const p = path(a), q = path(a - 0.03);
    const heat = Math.exp(-a / 0.12);
    const tw = 0.62 + 0.38 * hash(j, frameIdx(t));
    return { p, q, heat, I: tw };
  }
  // the second break: the word blows apart and falls (drag, gravity), fading
  const ar = t - ws.tRe, lf = 0.9 + 0.7 * hash(j, 13);
  if (ar > lf) return null;
  const P0 = path(ws.tRe - tb);
  const ox = P0.x - ws.c.x, oy = P0.y - ws.c.y, r = Math.hypot(ox, oy) + 1;
  const v = 380 + 520 * hash(j, 14), k = 2.4;
  const d = (v * (1 - Math.exp(-k * ar))) / k;
  const ang = Math.atan2(oy, ox) + (hash(j, 15) - 0.5) * 0.6;
  const at = (x: number) => { const dd = (v * (1 - Math.exp(-k * x))) / k; return { x: P0.x + Math.cos(ang) * dd, y: P0.y + Math.sin(ang) * dd + 0.5 * 640 * x * x }; };
  void r; void d;
  const p = at(ar), q = at(Math.max(0, ar - 0.05));
  const u = ar / lf;
  return { p, q, heat: Math.exp(-ar / 0.06), I: (1 - u) * (u > 0.6 ? (hash(j, frameIdx(t), 3) > 0.4 ? 1.3 : 0.2) : 1) };
}

export function drawWordSparks(lb: LineBatch, ws: WordSparks, t: number, launch: (t: number) => P2, alpha = 1, squash: (p: P2) => P2 = (p) => p) {
  // rockets for each glyph
  ws.tk.forEach((tb, gi) => {
    const t0 = tb - 0.3;
    if (t < t0 || t >= tb) return;
    const g = ws.glyphs[gi]!;
    const L = launch(t);
    const at = (tt: number) => { const e = ease.outQuad(clamp((tt - t0) / 0.3)); return { x: lerp(L.x, g.cx, e) + Math.sin(tt * 40 + gi) * 3 * (1 - e), y: lerp(L.y, g.cy, e) }; };
    let prev = squash(at(t));
    for (let k = 1; k <= 7; k++) {
      const q = squash(at(t - k * 0.03));
      const f = 1 - k / 8;
      lb.seg2(prev.x, prev.y, q.x, q.y, 1.5 * f + 0.4, sc(LIN.ember, 2.2 * f), f * alpha);
      prev = q;
    }
    const h = squash(at(t));
    lb.seg2(h.x, h.y, h.x + 0.01, h.y, 4, sc(WHITE, 2.5), alpha);
  });
  for (let i = 0; i < ws.pts.length; i++) {
    const s = wordSparkAt(ws, i, t, launch);
    if (!s || s.I <= 0.01) continue;
    const col = mix3(mix3(sc(LIN.signal, 1.25), sc(LIN.ember, 2.0), 0.35), sc(WHITE, 3.2), s.heat);
    const p = squash(s.p), q = squash(s.q);
    const moving = Math.hypot(p.x - q.x, p.y - q.y) > 0.6;
    if (moving) lb.seg2(q.x, q.y, p.x, p.y, 1.6, sc(col, s.I), alpha);
    else {
      const dl = 3 + 7 * hash(i, 21);
      lb.seg2(p.x, p.y, p.x, p.y + dl * (1 - col[0] * 0), 1.1, sc(LIN.signal, 0.9 * s.I), alpha * 0.8);
      lb.seg2(p.x, p.y, p.x + 0.01, p.y, 3.0, sc(col, 1.25 * s.I), alpha);
    }
  }
  // each glyph's burst: a flash and a small ring
  ws.tk.forEach((tb, gi) => {
    const a = t - tb;
    if (a < 0 || a > 0.3) return;
    const g = ws.glyphs[gi]!, c = squash({ x: g.cx, y: g.cy });
    const k = 1 - a / 0.3, R = 30 + 180 * ease.outCubic(a / 0.3);
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * TAU, a1 = ((i + 1) / 48) * TAU;
      lb.seg2(c.x + Math.cos(a0) * R, c.y + Math.sin(a0) * R, c.x + Math.cos(a1) * R, c.y + Math.sin(a1) * R, 1 + k, sc(LIN.signal, 1.3 * k), k * alpha);
    }
    if (a < 0.05) lb.seg2(c.x, c.y, c.x + 0.01, c.y, 40 * (1 - a / 0.05), sc(WHITE, 2), (1 - a / 0.05) * alpha);
  });
}

/** The unsung word's construction outline: a dim hairline over each glyph until its sparks arrive. */
export function drawWordGuides(lb: LineBatch, ws: WordSparks, t: number, a0: number, alpha = 1) {
  ws.glyphs.forEach((g, gi) => {
    const tb = ws.tk[gi]!;
    const a = alpha * clamp((t - a0) / 0.2) * (1 - prog(t, tb, tb + 0.12));
    if (a <= 0.005) return;
    for (const ct of g.contours) for (let k = 1; k < ct.length; k++) {
      if (k % 2) continue; // dashed
      lb.seg2(ct[k - 1]!.x, ct[k - 1]!.y, ct[k]!.x, ct[k]!.y, 1, sc(LIN.bone, 0.3), a);
    }
  });
}

// ------------------------------------------------------------------ the crossette: exponential branching
/**
 * The climax's big shell (the reference room's FOOM, as a firework): one streak out of the theatre
 * that splits on every eighth note, 1 → 2 → 4 → … → 64, in the vertical plane through the theatre
 * (world x, z), so it scales with the camera and falls onto the line with the rest.
 */
export interface Branch { g: number; pts: V3[]; t0: number; t1: number }
export function buildCrossette(root: V3, gens: number[], seed = 77): Branch[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: Branch[] = [];
  const N = gens.length - 1;
  const make = (g: number, x: number, z: number, a: number) => {
    const len = (g === 0 ? 16 : 15 * Math.pow(0.86, g)) * (0.8 + 0.4 * rnd());
    const pts: V3[] = [[x, root[1], z]];
    let ang = a, px = x, pz = z;
    const bend = (rnd() - 0.5) * 0.25;
    for (let i = 1; i <= 5; i++) { ang += bend * 0.2; px += (Math.cos(ang) * len) / 5; pz += (Math.sin(ang) * len) / 5; pts.push([px, root[1], pz]); }
    out.push({ g, pts, t0: gens[g]!, t1: gens[g + 1]! });
    if (g + 1 < N) {
      // outward from the root, fanning over the sky
      const rad = Math.atan2(pz - root[2] + 6, px - root[0]);
      let d = rad - ang; d = Math.atan2(Math.sin(d), Math.cos(d));
      const base = ang + d * (g < 1 ? 0 : 0.3);
      const sp = (g < 2 ? 0.7 : 0.42) + rnd() * 0.25;
      make(g + 1, px, pz, base - sp); make(g + 1, px, pz, base + sp);
    }
  };
  make(0, root[0], root[2], Math.PI / 2);
  return out;
}
export function drawCrossette(lb: LineBatch, br: Branch[], t: number, proj: Proj, alpha: number): number {
  let tips = 0;
  const base = sc(LIN.bone, 0.32);
  for (const b of br) {
    if (t < b.t0) continue;
    const u = clamp((t - b.t0) / (b.t1 - b.t0));
    const pu = 1 - Math.pow(1 - u, 1.6);
    const n = b.pts.length - 1, reach = pu * n;
    const w = Math.max(1.1, 3.6 * Math.pow(0.8, b.g));
    let prev = proj(b.pts[0]!);
    for (let i = 0; i < n && reach > i; i++) {
      const a = b.pts[i]!, c = b.pts[i + 1]!, k = Math.min(1, reach - i);
      const cur = proj([a[0] + (c[0] - a[0]) * k, a[1], a[2] + (c[2] - a[2]) * k]);
      const tw = b.t0 + (b.t1 - b.t0) * (1 - Math.pow(1 - (i + k) / n, 1 / 1.6));
      const age = Math.max(0, t - tw);
      const hot = Math.exp(-age / 0.06), warm = Math.exp(-age / 0.4);
      const col = mix3(mix3(base, sc(LIN.signal, 1.5), warm), sc(WHITE, 3), hot);
      lb.seg2(prev.x, prev.y, cur.x, cur.y, w * (1 + 0.8 * hot), col, alpha);
      prev = cur;
    }
    if (u < 1) {
      tips++;
      const I = Math.max(0.5, 1.6 * Math.pow(0.85, b.g));
      lb.seg2(prev.x, prev.y, prev.x + 0.01, prev.y, 12 * I, sc(LIN.ember, 1.6 * I), 0.6 * alpha);
      lb.seg2(prev.x, prev.y, prev.x + 0.01, prev.y, 4, sc(WHITE, 3 * I), alpha);
    }
    // node rings at the first splits (a diagram of the explosion)
    if (b.g >= 1 && b.g <= 4) {
      const o = proj(b.pts[0]!), r = 6 - b.g;
      for (let k = 0; k < 10; k++) {
        const a0 = (k / 10) * TAU, a1 = ((k + 1) / 10) * TAU;
        lb.seg2(o.x + Math.cos(a0) * r, o.y + Math.sin(a0) * r, o.x + Math.cos(a1) * r, o.y + Math.sin(a1) * r, 1, sc(LIN.bone, 0.6), alpha);
      }
    }
  }
  return tips;
}
