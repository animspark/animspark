// Plate `sky`: the murmuration. Thousands of letter-birds, a closed-form flock: every bird sits on a
// folded sheet that turns in 3D (edge-on it packs into the dense ribbons of a real murmuration), the
// sheet's clock surges on every beat, and each bird adds its own small noise. Pools of birds leave the
// flock to form the sung words and fall back into it; at the end every bird spirals into one point.
// Each bird is a single-stroke capital that flaps: a vertical squash and a pair of hairline wings.
import { LineBatch } from '../px/lines';
import { LIN } from '../px/palette';
import { strokeText } from '../px/stroke';
import { clamp, ease, hash, keys, lerp, noise1, prog, TAU, type Key, type V2 } from '../px/util';
import { type Cam, type RGB, w2s, mix3, mul, hotLin } from './sky-kit';

export const LETTERS = 'PAINTTHESKYINPURPLEWORDS';

export interface Target { x: number; y: number; ws: number; we: number; word: number; /** the last word: the end's condensation takes over from its release */ hold?: boolean }
export interface Bird {
  ch: number; ox: number; oy: number; type: 0 | 1; tPeel: number; pool: number;
  tg: (Target | null)[]; u: number; v: number; w: number; seed: number; fq: number; ph: number; tc: number; arc: number;
}

/** unit glyphs (cap height 1, centred), as flat segment lists */
let GLYPHS: Float32Array[] = [];
function buildGlyphs() {
  GLYPHS = Array.from(LETTERS).map((ch) => {
    const st = strokeText(ch, 'sans', 100, 0, false);
    const cap = st.capHeight || 70;
    const segs: number[] = [];
    for (const poly of st.strokes) {
      // simplify: these are drawn ~9 px tall
      const keep: V2[] = [poly[0]!];
      let acc = 0;
      for (let i = 1; i < poly.length; i++) {
        acc += Math.hypot(poly[i]!.x - poly[i - 1]!.x, poly[i]!.y - poly[i - 1]!.y);
        if (acc >= cap * 0.16 || i === poly.length - 1) { keep.push(poly[i]!); acc = 0; }
      }
      for (let i = 1; i < keep.length; i++) {
        const a = keep[i - 1]!, b = keep[i]!;
        segs.push((a.x - st.width / 2) / cap, (a.y + cap / 2) / cap, (b.x - st.width / 2) / cap, (b.y + cap / 2) / cap);
      }
    }
    return new Float32Array(segs);
  });
}

export class Flock {
  birds: Bird[] = [];
  /** peel times, sorted (the bird counter) */
  peelSorted = new Float32Array(0);
  tM2 = 0; tCd0 = 0; tCd1 = 0;
  D: V2 = { x: 960, y: 540 };
  beatAt: (t: number) => number = (t) => t;
  b0 = 0;

  constructor() { if (!GLYPHS.length) buildGlyphs(); }

  finish() {
    this.peelSorted = Float32Array.from(this.birds.map((b) => b.tPeel)).sort();
    this.b0 = this.bq(this.tM2);
  }
  /** beat-quantised beat count: floor(b) + outExpo(fract(b)/0.5), so the flock surges on every beat */
  bq(t: number) { const b = this.beatAt(t); const f = Math.floor(b); return f + ease.outExpo(clamp((b - f) / 0.75)); }
  tau(t: number) { return 0.5 * (t - this.tM2) + 0.3 * (this.bq(t) - this.b0) + 0.04 * (t - this.tM2) ** 2; }
  count(t: number) {
    const a = this.peelSorted; let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= t) lo = m + 1; else hi = m; }
    return lo;
  }
  /** where the flock is (world): keyed out of the way of the word being formed, plus a slow swoop */
  path: Key[][] = [[], []];
  centre(t: number, tau: number): V2 {
    return { x: keys(t, this.path[0]!) + 170 * Math.sin(0.9 * tau + 0.3), y: keys(t, this.path[1]!) + 55 * Math.sin(1.4 * tau + 1.1) };
  }

  /** free-flight position of bird b at flock time tau (world) */
  free(b: Bird, t: number, tau: number, o: { x: number; y: number }) {
    const u = b.u, v = b.v;
    const x = u * 840;
    const y = v * 190 + 150 * Math.sin(1.3 * u + 1.1 * tau) + 60 * Math.sin(2.7 * u - 1.7 * tau);
    const zq = b.w * 40 + 270 * Math.cos(1.1 * u - 0.9 * tau) + 80 * Math.sin(2.1 * v + 1.3 * tau);
    const yaw = 0.2 + 0.7 * Math.sin(1.1 * tau + 0.2), pitch = 0.4 * Math.sin(0.9 * tau + 1.0), rl = 0.45 * Math.sin(0.75 * tau + 0.4);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const X = x * cy + zq * sy, Z1 = -x * sy + zq * cy;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const Y = y * cp - Z1 * sp, Z = y * sp + Z1 * cp;
    const k = 1500 / (1500 + Z);
    const cr = Math.cos(rl), sr = Math.sin(rl);
    const C = this.centre(t, tau);
    const j = 6 + 6 * b.arc;
    o.x = C.x + (X * cr - Y * sr) * k + j * noise1(tau * 1.2 + b.seed * 13.7, 1);
    o.y = C.y + (X * sr + Y * cr) * k + j * noise1(tau * 1.2 + b.seed * 17.3, 2);
    return k;
  }

  /** Draw every bird. `lb` is a max-blended batch (no double brightness where birds overlap). */
  draw(lb: LineBatch, t: number, cam: Cam, kick: number) {
    const tau = this.tau(t), tau2 = this.tau(t + 0.03);
    const o = { x: 0, y: 0 }, o2 = { x: 0, y: 0 };
    const zf = cam.z / 0.87;
    const ash = LIN.ash, bone = LIN.bone, acid = LIN.acid, sig = LIN.signal;
    const cd = (b: Bird) => ease.inCubic(prog(t, this.tCd0 + 0.08 * b.tc, this.tCd1 - 0.03 * (1 - b.tc)));
    for (const b of this.birds) {
      if (t < b.tPeel) continue;
      const c = cd(b);
      if (c >= 1) continue;
      // free flight, arriving from the paint
      const k1 = this.free(b, t, tau, o);
      this.free(b, t + 0.03, tau2, o2);
      const ap = t - b.tPeel;
      const e = ease.inOutCubic(clamp(ap / (0.75 + 0.35 * b.arc)));
      const lift = Math.sin(Math.PI * e) * (60 + 140 * b.arc);
      let x = lerp(b.ox, o.x, e), y = lerp(b.oy, o.y, e) - lift;
      let vx = (o2.x - o.x) * e, vy = (o2.y - o.y) * e - 30 * Math.cos(Math.PI * e) * (1 - e);
      // formations
      let g = 0, fAge = -1;
      for (const tg of b.tg) {
        if (!tg) continue;
        const a0 = Math.max(tg.ws - 0.42 - 0.06 * b.tc, b.tPeel + 0.05);
        const on = ease.inOutCubic(prog(t, a0, tg.ws - 0.03));
        const off = tg.hold ? 0 : ease.inOutCubic(prog(t, tg.we + 0.04 + 0.08 * b.tc, tg.we + 0.42 + 0.2 * b.tc));
        const gg = on * (1 - off);
        if (gg > 0) {
          const br = 1.2 * Math.sin(t * 3.1 + b.seed * 9);
          x = lerp(x, tg.x + br, gg); y = lerp(y, tg.y + br * 0.6, gg);
          // released birds burst outward before they rejoin the flock
          if (off > 0) { const sc = Math.sin(Math.PI * off) * (50 + 110 * b.arc); x += Math.cos(b.ph) * sc; y += Math.sin(b.ph) * sc; }
          vx *= 1 - gg; vy *= 1 - gg;
          if (gg > g) { g = gg; fAge = t - tg.ws; }
        }
      }
      // the end: spiral into the one point
      if (c > 0) {
        const dx = x - this.D.x, dy = y - this.D.y, th = 2.2 * c * (0.6 + 0.4 * b.arc), cs = Math.cos(th), sn = Math.sin(th);
        const r = (1 - c) ** 1.4;
        x = this.D.x + (dx * cs - dy * sn) * r; y = this.D.y + (dx * sn + dy * cs) * r;
      }
      const P = w2s(cam, x, y);
      if (P.x < -30 || P.x > 1950 || P.y < -30 || P.y > 1110) continue;
      // colour: the paint's violet (or a glyph's bone) cooling to ash; formed words hot → bone
      const born: RGB = b.type === 1 ? mul(acid, 1.5) : mul(bone, 0.8);
      let col = mix3(born, mul(ash, 0.34 + 0.1 * k1), clamp(ap / 0.9));
      if (g > 0) {
        const fc = fAge < 0 ? mul(ash, 0.42) : hotLin(fAge, mul(bone, 0.74), 0.12);
        col = mix3(col, fc, g);
      }
      col = mix3(col, mul(sig, 1.6), c * c);
      col = mul(col, 1 + 0.22 * kick * (1 - g));
      // the bird: a capital that flaps (vertical squash) with two hairline wings
      const S = (6.2 + 2.2 * b.arc) * zf * (1 - 0.1 * g) * (1 - 0.7 * c);
      const A = (1 - 0.88 * g) * (1 - c);
      const phi = TAU * b.fq * t + b.ph;
      const sphi = Math.sin(phi);
      const sq = 1 - 0.4 * A * (0.5 + 0.5 * sphi);
      const sp = Math.hypot(vx, vy) + 1e-3;
      const rot = (1 - g) * clamp((vy / sp) * 0.7, -0.6, 0.6) * Math.sign(vx || 1);
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const gl = GLYPHS[b.ch]!;
      const wd = (0.9 + 0.3 * g) * Math.min(1, zf);
      for (let q = 0; q < gl.length; q += 4) {
        const ax = gl[q]! * S, ay = gl[q + 1]! * S * sq, bx = gl[q + 2]! * S, by = gl[q + 3]! * S * sq;
        lb.seg2(P.x + ax * cr - ay * sr, P.y + ax * sr + ay * cr, P.x + bx * cr - by * sr, P.y + bx * sr + by * cr, wd, col, 1);
      }
      if (A > 0.05) {
        const wy = -0.42 * S * sq, span = 1.05 * S, lift2 = -0.75 * S * A * sphi;
        for (const s of [-1, 1]) {
          const rx = s * 0.14 * S, tx = s * span, ty = wy + lift2;
          lb.seg2(P.x + rx * cr - wy * sr, P.y + rx * sr + wy * cr, P.x + tx * cr - ty * sr, P.y + tx * sr + ty * cr, 0.9 * Math.min(1, zf), mul(col, 0.9), A);
        }
      }
    }
  }
}

/** Pair birds (sorted by key) with targets (sorted by x): evenly chosen subset when there are more birds. */
export function assign(birds: Bird[], slot: number, targets: Target[], key: (b: Bird) => number) {
  const bs = [...birds].sort((p, q) => key(p) - key(q));
  const ts = [...targets].sort((p, q) => p.x - q.x || p.y - q.y);
  const n = Math.min(bs.length, ts.length);
  for (let i = 0; i < n; i++) {
    const bi = Math.min(bs.length - 1, Math.floor(((i + 0.5) * bs.length) / n));
    bs[bi]!.tg[slot] = ts[i]!;
  }
}

/** A deterministic "random" in [0,1) per bird and channel. */
export const hb = (i: number, k: number) => hash(i, k, 71);
