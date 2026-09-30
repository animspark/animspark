// Plate `sky` — "Paint the sky in purple words / Watch the letters fly like birds" (CUT.sky → CUT.mix).
// VFX: a matte painting, then a murmuration. One continuous camera.
//   H9      the first frame is the marquee's last: the roofline hairline at y = ROOF_H9.y, open night sky
//           above, the cornice below. The roofline is the matte line of shot VFX 042.
//   matte   on the first kick the sky is keyed out (the viewer's alpha checker wipes up from the matte
//           line), trackers pop on as the keyer's front passes them, roto points run along the roof, the
//           safe frames and shot data come up. The caret is the brush: a flat caret as wide as the stroke,
//           dragging ~40 bristle hairlines of violet paint (heat by age: signal tip → violet-hot wake →
//           paint) and lettering the lyric along the stroke. Run A "PAINT THE SKY" across the top, a
//           slashed return, run B "IN PURPLE WORDS", a return along the horizon. Each word is set on the
//           stroke's spine where the head passes it on its sung time (hot → bone); "PURPLE" is violet-hot
//           and flares the whole painting. Paint covers the trackers; the counters say so. The camera
//           nods on every word (a zoom staircase).
//   murmur  on the downbeat the camera snaps up and back (outExpo). The paint peels from where the brush
//           stopped: every painted letter becomes a letter-bird (violet cooling to ash), the painted big
//           words dissolving into the birds that then form "LETTERS"; a flock of ~5,000 turns in 3D (a
//           folded sheet, a beat-stepped clock), and pools of it form WATCH, THE, LETTERS, FLY, LIKE,
//           BIRDS on their sung times (hot → bone), then fall back into the swirl. Wind vectors, a bird
//           counter and an ornithology plate caption.
//   H11     from the end of "birds" everything spirals into one point while the camera pushes in on it:
//           at CUT.mix one hot dot, DOT_H11 (960, 540, r 6), on a dark frame.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, layout, textPoints } from '../px/type';
import { clamp, ease, hash, lerp, noise1, noise2, prog, pulse, TAU, type V2 } from '../px/util';
import { sparkParticles } from '../px/motifs';
import { wStart, wEnd, wText } from './lyric';
import { ROOF_H9, DOT_H11, frames, beatBefore } from './handoff';
import { FRAG_SKY } from './sky-glsl';
import {
  type Cam, type RGB, type Stroke, type Paint, STEP, mul, add3, WHITE, hotCss, violetCss, hotLin, grp, comma,
  w2s, s2w, camMatrix, buildPaint, headS, spineAt, brushAt, glyphPoints,
} from './sky-kit';
import { Flock, type Bird, type Target, LETTERS, assign, hb } from './sky-flock';

const ROOF = ROOF_H9.y;
const NODS1: [number, number][] = [[58, 0.015], [59, 0.012], [60, 0.015], [61, 0.012], [62, 0.03], [63, 0.02]];
const NODS2: [number, number][] = [[64, 0.012], [65, 0.01], [66, 0.014], [67, 0.012], [68, 0.012], [69, 0.02]];
/** the words the flock forms: word, screen centre at its time, size, pool */
const FORMS = [
  { w: 64, sx: 560, sy: 300, size: 220, pool: 1 },
  { w: 65, sx: 1400, sy: 262, size: 220, pool: 2 },
  { w: 66, sx: 960, sy: 590, size: 250, pool: 3 },
  { w: 67, sx: 610, sy: 330, size: 300, pool: 1 },
  { w: 68, sx: 1345, sy: 345, size: 265, pool: 2 },
  { w: 69, sx: 960, sy: 650, size: 330, pool: 3 },
];
const PURPLE = 62;

interface Tracker { x: number; y: number; id: number; tOn: number; tCover: number }
interface Form { w: number; box: [number, number, number, number]; n: number }

export default class Sky extends Scene {
  bg = new FSPass(FRAG_SKY, {
    uCam: { value: new THREE.Vector4(960, 540, 1, 0) }, uT: { value: 0 }, uChkY: { value: ROOF }, uChkA: { value: 0 },
    uStar: { value: 1 }, uHold: { value: 0 }, uRoofA: { value: 1 }, uDark: { value: 1 }, uGlow: { value: 0 },
  });
  body = new LineBatch(8000, { blend: 'max' });
  lines = new LineBatch(52000);
  birdsLB = new LineBatch(110000, { blend: 'max' });
  glow = new LineBatch(4000);
  L = new Layer2D();

  T0 = 0; T1 = 0; tM2 = 0; tCd0 = 0; tCd1 = 0;
  paint!: Paint;
  tpS: Float32Array[] = []; // peel time per spine sample
  tpG: number[][] = []; // peel time per big glyph
  trackers: Tracker[] = [];
  flock = new Flock();
  forms: Form[] = [];
  P0: V2 = { x: 0, y: 0 };
  D: V2 = { x: 960, y: 440 };
  winds: V2[] = [];

  override init() {
    const au = this.ctx.audio;
    this.T0 = this.ctx.start; this.T1 = this.ctx.end;
    this.tM2 = beatBefore(wStart(64));
    this.tCd0 = wEnd(69) + 0.02;
    this.tCd1 = this.T1 - 0.07;
    const P = (this.paint = buildPaint(this.T0));
    const R2 = P.strokes[3]!;
    this.P0 = { ...R2.pts[R2.n - 1]! };
    const tp = (x: number, y: number) => this.tM2 + 0.03 + 0.42 * clamp(Math.hypot(x - this.P0.x, (y - this.P0.y) * 1.3) / 2000);
    this.tpS = P.strokes.map((st) => Float32Array.from(st.pts.map((q) => tp(q.x, q.y))));
    this.tpG = P.strokes.map((st) => st.glyphs.map((g) => tp(g.x, g.y)));

    // trackers: a jittered grid over the sky; the paint covers them when the head passes over
    let id = 1;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
      if (hash(r, c, 5) < 0.18) continue;
      const x = 170 + c * 263 + (hash(r, c, 1) - 0.5) * 90, y = 110 + r * 205 + (hash(r, c, 2) - 0.5) * 70;
      let tCover = Infinity;
      for (const st of P.strokes) for (let i = 0; i < st.n; i++) {
        const q = st.pts[i]!;
        if (Math.hypot(q.x - x, q.y - y) < 0.44 * st.w * st.prof[i]!) tCover = Math.min(tCover, st.tS[i]!);
      }
      this.trackers.push({ x, y, id: id++, tOn: this.T0 + 0.03 + 0.26 * ((ROOF - y) / ROOF) ** 0.7, tCover });
    }

    // ---- the flock
    const fl = this.flock;
    fl.tM2 = this.tM2; fl.tCd0 = this.tCd0; fl.tCd1 = this.tCd1; fl.D = this.D;
    fl.beatAt = (t) => au.beatAt(t);
    {
      // screen targets under the M2 camera, converted to world: out of the way of each word as it forms
      const at = (tt: number, sx: number, sy: number) => { const w = s2w(this.camAt(tt), sx, sy); return [tt, w.x, w.y] as const; };
      const io = ease.inOutCubic;
      const K = [
        at(this.tM2 + 0.05, 900, 700), at(wStart(64), 1000, 740), at(wEnd(65) - 0.05, 1000, 740),
        at(wStart(66) + 0.25, 1000, 250), at(wEnd(66) + 0.05, 1000, 250),
        at(wStart(67) + 0.1, 980, 770), at(wStart(69) - 0.3, 980, 770), at(wStart(69) + 0.3, 900, 250), at(this.tCd0, 900, 250),
      ];
      fl.path = [K.map(([tt, x]) => [tt, x, io]), K.map(([tt, , y]) => [tt, y, io])];
    }
    const famW = F.archivo(100, 900);
    const T: Target[][] = FORMS.map((sp) => {
      const cam = this.camAt(wStart(sp.w));
      const txt = wText(sp.w).toUpperCase().replace(/[^A-Z]/g, '');
      const lay = layout(txt, famW, sp.size);
      const pts = textPoints(txt, famW, sp.size, 9.5, sp.w);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const out = pts.map((q) => {
        const p = s2w(cam, sp.sx - lay.width / 2 + q.x, sp.sy + q.y + sp.size * 0.36);
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
        return { x: p.x, y: p.y, ws: wStart(sp.w), we: wEnd(sp.w), word: sp.w, hold: sp.w === 69 };
      });
      this.forms.push({ w: sp.w, box: [x0, y0, x1, y1], n: out.length });
      return out;
    });
    const n1 = Math.max(T[0]!.length, T[3]!.length), n2 = Math.max(T[1]!.length, T[4]!.length), n3 = Math.max(T[2]!.length, T[5]!.length);
    const mk = (i: number, ox: number, oy: number, type: 0 | 1, tPeel: number, ch: number): Bird => ({
      ch, ox, oy, type, tPeel, pool: 0, tg: [],
      u: (hb(i, 1) + hb(i, 2) + hb(i, 3)) / 1.5 - 1, v: (hb(i, 4) + hb(i, 5) + hb(i, 6)) / 1.5 - 1, w: hb(i, 7) - 0.5,
      seed: hb(i, 8) * 97, fq: 5.5 + 3 * hb(i, 9), ph: TAU * hb(i, 10), tc: hb(i, 11), arc: hb(i, 12),
    });
    // the painted words dissolve into letter-birds (pool 3: LETTERS, then BIRDS)
    const gl: { p: V2; tp: number; ch: number }[][] = [];
    const glyphsAll = P.strokes.flatMap((st, si) => st.glyphs.map((g, gi) => ({ g, tp: this.tpG[si]![gi]! })));
    const count = (step: number) => glyphsAll.reduce((a, { g }) => a + glyphPoints(g, step, 3).length, 0);
    const want = n3 * 1.12;
    const step = 8 * Math.sqrt(count(8) / want);
    glyphsAll.forEach(({ g, tp: tpg }, k) => gl.push(glyphPoints(g, step, k + 5).map((p) => ({ p, tp: tpg, ch: Math.max(0, LETTERS.indexOf(g.ch)) }))));
    const gpts = gl.flat();
    const birds: Bird[] = [];
    let bi = 0;
    const pool3: Bird[] = [];
    gpts.forEach((q, k) => {
      const b = mk(bi++, q.p.x, q.p.y, 0, q.tp + 0.02 * hb(k, 20), q.ch);
      birds.push(b);
    });
    // every n-th glyph bird joins pool 3 (the rest fly free)
    const take = Math.min(n3, birds.length);
    for (let i = 0; i < take; i++) { const b = birds[Math.floor(((i + 0.5) * birds.length) / take)]!; b.pool = 3; pool3.push(b); }
    // the paint's lettering peels into the rest
    const nFree = 2000;
    const cand: Bird[] = [];
    const wsum = P.strokes.reduce((a, st) => a + st.tot * st.w, 0);
    for (let k = 0; k < n1 + n2 + nFree; k++) {
      let r = hb(k, 30) * wsum, st: Stroke = P.strokes[0]!;
      for (const s of P.strokes) { r -= s.tot * s.w; if (r <= 0) { st = s; break; } }
      const i = Math.min(st.n - 1, Math.floor(hb(k, 31) * st.n));
      const o = (hb(k, 32) - 0.5) * 0.9 * st.w * Math.max(0.3, st.prof[i]!);
      const x = st.pts[i]!.x + st.nx[i]! * o, y = st.pts[i]!.y + st.ny[i]! * o;
      cand.push(mk(bi++, x, y, 1, tp(x, y) + 0.05 * hb(k, 33), Math.floor(hb(k, 34) * LETTERS.length)));
    }
    cand.sort((a, b) => a.tPeel - b.tPeel);
    const pool1 = cand.slice(0, n1), pool2 = cand.slice(n1, n1 + n2);
    pool1.forEach((b) => (b.pool = 1)); pool2.forEach((b) => (b.pool = 2));
    birds.push(...cand);
    assign(pool1, 0, T[0]!, (b) => b.ox); assign(pool1, 1, T[3]!, (b) => b.tg[0]?.x ?? b.ox);
    assign(pool2, 0, T[1]!, (b) => b.ox); assign(pool2, 1, T[4]!, (b) => b.tg[0]?.x ?? b.ox);
    assign(pool3, 0, T[2]!, (b) => b.ox); assign(pool3, 1, T[5]!, (b) => b.tg[0]?.x ?? b.ox);
    fl.birds = birds;
    fl.finish();

    for (let y = -260; y <= 860; y += 150) for (let x = -170; x <= 2100; x += 172) this.winds.push({ x: x + (Math.floor(y / 150) % 2) * 86, y });
  }

  // ------------------------------------------------------------------ camera
  camAt(t: number): Cam {
    const tM2 = this.tM2;
    let z1 = 1 + 0.02 * prog(t, this.T0 + 0.1, tM2, ease.inQuad);
    for (const [i, a] of NODS1) z1 *= 1 + a * ease.outExpo(clamp((t - wStart(i)) / 0.22));
    let z2 = 0.86 * (1 + 0.04 * prog(t, tM2, this.tCd0));
    for (const [i, a] of NODS2) z2 *= 1 + a * ease.outExpo(clamp((t - wStart(i)) / 0.22));
    const k = t < tM2 ? 0 : ease.outExpo(clamp((t - tM2) / 0.6));
    const ant = ease.inQuad(prog(t, tM2 - 0.18, tM2)) * (1 - k);
    let x = 960, y = lerp(540, 380, k) + 14 * ant;
    let z = Math.exp(lerp(Math.log(z1), Math.log(z2), k)) * (1 - 0.012 * ant);
    let r = t > tM2 ? 0.03 * Math.exp(-(t - tM2) * 4) * Math.sin((t - tM2) * 11) : 0;
    const e = this.endK(t);
    x = lerp(x, this.D.x, e); y = lerp(y, this.D.y, e); z *= Math.exp(Math.log(1.7) * e); r *= 1 - e;
    return { x, y, z, r };
  }
  endK(t: number) { return ease.inOutCubic(prog(t, this.tCd0 - 0.05, this.tCd1 + 0.02)); }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, T0 = this.T0, tM2 = this.tM2;
    const cam = this.camAt(t);
    const m = camMatrix(cam);
    const X = (x: number, y: number) => m[0] * x + m[2] * y + m[4];
    const Y = (x: number, y: number) => m[1] * x + m[3] * y + m[5];
    const eEnd = this.endK(t);
    const live = 1 - eEnd;
    const vfx = prog(t, T0 + 0.015, T0 + 0.06) * (1 - prog(t, tM2, tM2 + 0.22));
    const orn = prog(t, tM2 + 0.26, tM2 + 0.6) * (1 - prog(t, this.tCd0, this.tCd0 + 0.18));
    const kick = f.a.kick;
    // the violet: dim paint until "purple", violet-hot after it
    const tP = wStart(PURPLE);
    const vio = (t < tP ? 0.75 : 1.15) + 1.3 * pulse(t, tP, 0.28) + 0.18 * kick;

    // ---- background
    const u = this.bg.u;
    (u.uCam!.value as THREE.Vector4).set(cam.x, cam.y, cam.z, cam.r);
    u.uT!.value = t;
    u.uChkY!.value = lerp(ROOF, -700, ease.outCubic(prog(t, T0 + 0.02, T0 + 0.4)));
    u.uChkA!.value = vfx;
    u.uStar!.value = live;
    u.uHold!.value = vfx;
    u.uGlow!.value = this.coverage(t) * vio * (1 - prog(t, tM2, tM2 + 0.8));
    this.bg.render(renderer, out);

    // ---- paint bodies (max) and bristles (add)
    const body = this.body, lb = this.lines;
    body.clear(); lb.clear();
    this.drawPaint(t, cam, X, Y, vio, kick);
    this.drawFurniture(t, cam, X, Y, vfx, orn);
    body.render(renderer, out);
    lb.render(renderer, out);

    // ---- lettering
    this.L.clear();
    this.drawText(t, cam, vfx, orn, live);
    comp.draw(renderer, this.L.upload(), out);

    // ---- the flock (max) and the light (add)
    const bl = this.birdsLB; bl.clear();
    if (t >= tM2) this.flock.draw(bl, t, cam, kick);
    bl.render(renderer, out);
    const gw = this.glow; gw.clear();
    this.drawBrush(t, cam, X, Y);
    this.drawDot(t, cam);
    gw.render(renderer, out);

    const shA = live * (2.2 * kick + 6 * pulse(t, tM2, 0.1) + 3 * pulse(t, tP, 0.12));
    return {
      bloom: 0.72 + 0.3 * pulse(t, tP, 0.35), bloomThreshold: 0.8, bloomKnee: 0.12, halation: 0.25,
      vignette: 0.38, grain: 0.055, ca: 1.2 + 1.8 * pulse(t, tM2, 0.12),
      shake: [shA * noise1(t * 45, 1), shA * noise1(t * 45, 2)],
      zoom: 1 + live * (0.008 * kick + 0.012 * pulse(t, tP, 0.15)),
    };
  }

  /** share of the sky under paint (for the counter and the haze) */
  coverage(t: number) {
    let a = 0;
    for (const st of this.paint.strokes) a += headS(st, t) * st.w * 0.85;
    return a / (W * ROOF);
  }

  // ------------------------------------------------------------------ paint
  drawPaint(t: number, cam: Cam, X: (x: number, y: number) => number, Y: (x: number, y: number) => number, vio: number, kick: number) {
    const acid = LIN.acid, emb = LIN.ember;
    const body = this.body, lb = this.lines;
    const zw = cam.z;
    this.paint.strokes.forEach((st, si) => {
      if (t < st.t0) return;
      const tp = this.tpS[si]!;
      if (t > tp[0]! + 0.6 && t > Math.max(...[tp[0]!, tp[st.n - 1]!]) + 0.3) return;
      const hs = headS(st, t);
      const hi = Math.min(st.n - 1, Math.ceil(hs / STEP));
      // body: the paint film, dim violet under the bristles
      for (let i = 2; i <= hi; i += 2) {
        const pa = 1 - prog(t, tp[i]!, tp[i]! + 0.25);
        if (pa <= 0) continue;
        const a = st.pts[i - 2]!, b = i * STEP > hs ? spineAt(st, hs) : st.pts[i]!;
        const age = t - st.tS[i]!;
        const k = 0.11 * vio * pa * (1 + 0.8 * Math.exp(-age / 0.25));
        // the film is laid in narrow lanes, so its round caps never run ahead of the brush
        const wd = st.w * st.prof[i]! * 0.92, nl = 8, nx = st.nx[i]!, ny = st.ny[i]!;
        for (let l = 0; l < nl; l++) {
          const o = ((l + 0.5) / nl - 0.5) * wd;
          body.seg2(X(a.x + nx * o, a.y + ny * o), Y(a.x + nx * o, a.y + ny * o), X(b.x + nx * o, b.y + ny * o), Y(b.x + nx * o, b.y + ny * o), (wd / nl) * 1.45 * zw, mul(acid, k), 1);
        }
      }
      // bristles, heat by age
      for (const br of st.br) {
        let px = X(br.X[0]!, br.Y[0]!), py = Y(br.X[0]!, br.Y[0]!);
        const base = 0.25 + 0.6 * br.b;
        for (let i = 1; i <= hi; i++) {
          let wx = br.X[i]!, wy = br.Y[i]!;
          const s = i * STEP;
          if (s > hs) { const k = 1 - (s - hs) / STEP; wx = lerp(br.X[i - 1]!, wx, k); wy = lerp(br.Y[i - 1]!, wy, k); }
          const cx = X(wx, wy), cy = Y(wx, wy);
          const D = br.D[i]!;
          const pa = 1 - prog(t, tp[i]! + 0.04 * br.b, tp[i]! + 0.2);
          if (D > 0.02 && pa > 0) {
            const age = Math.max(0, t - st.tS[i]!);
            const h1 = Math.exp(-age / 0.05), h2 = Math.exp(-age / 0.32);
            const I = D * pa;
            const col: RGB = add3(mul(acid, (base * vio * (1 - h2) + 2.6 * h2) * I), mul(emb, 2.4 * h1 * I));
            lb.seg2(px, py, cx, cy, br.w * (1 + 0.7 * h1) * Math.min(1.3, zw), col, 1);
          }
          px = cx; py = cy;
        }
      }
      // length ticks along the outer edge, laid as the head passes
      const vfx = 1 - prog(t, this.tM2, this.tM2 + 0.4);
      if (vfx > 0) for (const tk of st.ticks) {
        if (tk.i > hi) break;
        const q = st.pts[tk.i]!, o = -(0.5 * st.w * st.prof[tk.i]! + 8), L = tk.label ? 10 : 5;
        const x0 = q.x + st.nx[tk.i]! * o, y0 = q.y + st.ny[tk.i]! * o;
        const age = t - st.tS[tk.i]!;
        const col = hotLin(age, mul(LIN.ash, 0.4));
        lb.seg2(X(x0, y0), Y(x0, y0), X(x0 - st.nx[tk.i]! * L, y0 - st.ny[tk.i]! * L), Y(x0 - st.nx[tk.i]! * L, y0 - st.ny[tk.i]! * L), 1, mul(col, vfx), 1);
      }
    });
  }

  // ------------------------------------------------------------------ VFX furniture + wind
  drawFurniture(t: number, cam: Cam, X: (x: number, y: number) => number, Y: (x: number, y: number) => number, vfx: number, orn: number) {
    const lb = this.lines, T0 = this.T0;
    const ash = LIN.ash, bone = LIN.bone, gr = LIN.graphite;
    if (vfx > 0) {
      // safe frames (screen space, dashed)
      const dash = (x0: number, y0: number, x1: number, y1: number, per: number, col: RGB) => {
        const L = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(L / per);
        for (let i = 0; i < n; i++) {
          const a = i / n, b = (i + 0.55) / n;
          lb.seg2(lerp(x0, x1, a), lerp(y0, y1, a), lerp(x0, x1, b), lerp(y0, y1, b), 1, col, 1);
        }
      };
      const rect = (ix: number, iy: number, col: RGB) => {
        dash(ix, iy, W - ix, iy, 14, col); dash(W - ix, iy, W - ix, 1080 - iy, 14, col);
        dash(W - ix, 1080 - iy, ix, 1080 - iy, 14, col); dash(ix, 1080 - iy, ix, iy, 14, col);
      };
      const sf = prog(t, T0 + 0.02, T0 + 0.12);
      rect(W * 0.05, 1080 * 0.05, mul(gr, 0.35 * vfx * sf));
      rect(W * 0.1, 1080 * 0.1, mul(gr, 0.22 * vfx * sf));
      // the matte line guide, wiped in left → right
      const wx = lerp(-40, 1960, ease.outCubic(prog(t, T0 + 0.02, T0 + 0.3)));
      const gy = ROOF - 12;
      for (let x = -200; x < wx; x += 20) lb.seg2(X(x, gy), Y(x, gy), X(x + 11, gy), Y(x + 11, gy), 1, mul(ash, 0.34 * vfx), 1);
      // roto spline on the roofline: points with tangent handles, hot where just laid
      for (let k = 0; k <= 12; k++) {
        const x = 60 + 150 * k, tk = T0 + 0.03 + 0.22 * (k / 12);
        if (t < tk) continue;
        const col = mul(hotLin(t - tk, mul(bone, 0.6)), vfx);
        const y = ROOF;
        const sx = X(x, y), sy = Y(x, y), s = 4;
        lb.seg2(sx - s, sy - s, sx + s, sy - s, 1.1, col, 1); lb.seg2(sx + s, sy - s, sx + s, sy + s, 1.1, col, 1);
        lb.seg2(sx + s, sy + s, sx - s, sy + s, 1.1, col, 1); lb.seg2(sx - s, sy + s, sx - s, sy - s, 1.1, col, 1);
        const h = 36 * cam.z * ease.outExpo(clamp((t - tk) / 0.2));
        lb.seg2(sx - h, sy, sx + h, sy, 1, mul(col, 0.7), 1);
        for (const e of [-h, h]) lb.seg2(sx + e - 1.6, sy, sx + e + 1.6, sy, 3.2, col, 1);
        if (k > 0) {
          const x0 = 60 + 150 * (k - 1);
          lb.seg2(X(x0 + 4, y - 1.5), Y(x0 + 4, y - 1.5), X(x - 4, y - 1.5), Y(x - 4, y - 1.5), 1, mul(col, 0.55), 1);
        }
      }
      // trackers: small crosses, covered by the paint
      for (const tr of this.trackers) {
        if (t < tr.tOn) continue;
        const cov = t - tr.tCover;
        if (cov > 0.16) continue;
        const col = cov > 0 ? hotLin(cov, mul(bone, 0.3)) : hotLin(t - tr.tOn, mul(ash, 0.55));
        const k = cov > 0 ? 1 - cov / 0.16 : 1;
        const sx = X(tr.x, tr.y), sy = Y(tr.x, tr.y), a = 8 * k;
        lb.seg2(sx - a, sy, sx - 2.5, sy, 1.2, mul(col, vfx), 1); lb.seg2(sx + 2.5, sy, sx + a, sy, 1.2, mul(col, vfx), 1);
        lb.seg2(sx, sy - a, sx, sy - 2.5, 1.2, mul(col, vfx), 1); lb.seg2(sx, sy + 2.5, sx, sy + a, 1.2, mul(col, vfx), 1);
      }
    }
    // wind vectors: the field the flock rides, lit where the flock is
    if (orn > 0) {
      const tau = this.flock.tau(t), C = this.flock.centre(t, tau);
      for (let i = 0; i < this.winds.length; i++) {
        const p = this.winds[i]!;
        const th = -0.25 + 1.5 * noise2(p.x / 700 + tau * 0.12, p.y / 600, 9);
        const L = 20 + 16 * Math.abs(noise2(p.x / 400, p.y / 400 + tau * 0.2, 4));
        const near = Math.exp(-((p.x - C.x) ** 2 + (p.y - C.y) ** 2) / (2 * 520 * 520));
        const I = orn * (0.16 + 0.34 * near);
        const x0 = X(p.x, p.y), y0 = Y(p.x, p.y);
        const dx = Math.cos(th) * L * cam.z, dy = Math.sin(th) * L * cam.z;
        const col = mul(ash, I);
        lb.seg2(x0 - dx / 2, y0 - dy / 2, x0 + dx / 2, y0 + dy / 2, 1, col, 1);
        const hx = x0 + dx / 2, hy = y0 + dy / 2, ca = Math.cos(th), sa = Math.sin(th);
        for (const s of [-1, 1]) lb.seg2(hx, hy, hx - 5 * (ca * 0.87 - s * sa * 0.5), hy - 5 * (sa * 0.87 + s * ca * 0.5), 1, col, 1);
        lb.seg2(x0 - dx / 2 - 1, y0 - dy / 2, x0 - dx / 2 + 1, y0 - dy / 2, 2, mul(col, 1.2), 1);
      }
    }
  }

  // ------------------------------------------------------------------ the brush (the caret) and the end dot
  drawBrush(t: number, cam: Cam, X: (x: number, y: number) => number, Y: (x: number, y: number) => number) {
    const gw = this.glow, P = this.paint, sg = LIN.signal, em = LIN.ember;
    const A = P.strokes[0]!;
    const tOn = this.T0 + 0.02;
    if (t < tOn) return;
    const tOff = this.tM2 + 0.12;
    if (t > tOff) return;
    const b = brushAt(P, t);
    let x: number, y: number, a: number, len: number;
    if (b) { x = b.x; y = b.y; a = b.a; len = b.st.w * Math.max(0.35, b.p) * 0.96; }
    else if (t < A.t0) {
      // the caret lands where the first stroke starts
      const q = A.pts[0]!; x = q.x; y = q.y; a = A.ang[0]!;
      len = lerp(58, A.w * 0.35, ease.outExpo(prog(t, tOn, A.t0)));
    } else {
      const R2 = P.strokes[3]!, q = R2.pts[R2.n - 1]!; x = q.x; y = q.y; a = R2.ang[R2.n - 1]!;
      len = lerp(R2.w * 0.6, 12, ease.outExpo(prog(t, R2.t1, R2.t1 + 0.12)));
    }
    const fade = 1 - prog(t, this.tM2 - 0.02, tOff);
    const nx = -Math.sin(a), ny = Math.cos(a);
    const sx = X(x, y), sy = Y(x, y), hl = 0.5 * len * cam.z;
    const land = pulse(t, tOn, 0.1);
    const I = fade * (1 + 1.5 * land + 0.4 * this.ctx.audio.hit('snare', t, 0.1));
    gw.seg2(sx - nx * hl, sy - ny * hl, sx + nx * hl, sy + ny * hl, 14, mul(sg, 0.2 * I), 0.6);
    gw.seg2(sx - nx * hl, sy - ny * hl, sx + nx * hl, sy + ny * hl, 8, mul(sg, 1.6 * I), 1);
    gw.seg2(sx - nx * hl * 0.96, sy - ny * hl * 0.96, sx + nx * hl * 0.96, sy + ny * hl * 0.96, 2.8, mul(add3(em, WHITE), 1.1 * I), 1);
    // sparks off the bristle ends
    sparkParticles(gw, t, (tb) => {
      const q = brushAt(P, tb);
      if (!q) return null;
      const side = hash(Math.floor(tb * 150), 3) - 0.5;
      const o = side * q.st.w * q.p;
      return { x: X(q.x + q.nx * o, q.y + q.ny * o), y: Y(q.x + q.nx * o, q.y + q.ny * o) };
    }, { rate: 150, speed: 220, gravity: 380, intensity: 0.8 * fade, seed: 7, life: 0.35 });
    // the peel starts where the brush stopped: a ring
    const ra = t - this.tM2;
    if (ra > 0 && ra < 0.6) {
      const R = 30 + 1400 * ease.outCubic(ra / 0.6), I2 = (1 - ra / 0.6) ** 2;
      const px = X(this.P0.x, this.P0.y), py = Y(this.P0.x, this.P0.y);
      let pvx = 0, pvy = 0;
      for (let i = 0; i <= 120; i++) {
        const an = (i / 120) * TAU, cx = px + Math.cos(an) * R * cam.z, cy = py + Math.sin(an) * R * cam.z;
        if (i) gw.seg2(pvx, pvy, cx, cy, 1.2, mul(LIN.acid, 1.4 * I2), 1);
        pvx = cx; pvy = cy;
      }
    }
  }

  /**
   * H11: the murmuration's one point, as the mix plate picks it up — a 12 px ember core (×2.6 linear),
   * a white-hot centre, a soft signal halo ~5× the radius; it grows out of the last birds' arrival.
   */
  drawDot(t: number, cam: Cam) {
    const k = prog(t, this.tCd1 - 0.14, this.tCd1);
    if (k <= 0) return;
    const P = w2s(cam, this.D.x, this.D.y);
    const r = DOT_H11.r * (0.4 + 0.6 * ease.outCubic(k));
    const flare = 1 + 0.8 * (1 - k); // the last arrivals land hot
    const g = this.glow;
    for (let i = 0; i < 5; i++) {
      const R = r * 5 * (1 - i * 0.17);
      g.seg2(P.x, P.y, P.x + 0.01, P.y, 2 * R, mul(LIN.signal, 0.045 * k), 1);
    }
    g.seg2(P.x, P.y, P.x + 0.01, P.y, 2 * r, mul(LIN.ember, 2.6 * flare * k), 1);
    g.seg2(P.x, P.y, P.x + 0.01, P.y, 0.75 * r, mul(WHITE, 3.2 * k), 1);
  }

  // ------------------------------------------------------------------ lettering
  drawText(t: number, cam: Cam, vfx: number, orn: number, live: number) {
    const c = this.L.ctx, P = this.paint, tM2 = this.tM2;
    const m = camMatrix(cam);
    // ---- screen space: the shot data, then the plate's caption
    c.save();
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '2px';
    const L = (s: string, x: number, y: number, col: string) => { c.fillStyle = col; c.fillText(s, x, y); };
    const type = (s: string, t0: number) => s.slice(0, Math.floor(clamp((t - t0) / 0.012, 0, s.length)));
    const panel = (x: number, y: number, w: number, h: number, a: number) => { c.fillStyle = rgba('ink', 0.78 * a); c.fillRect(x, y, w, h); };
    if (vfx > 0) {
      const t0 = this.T0 + 0.02;
      const pk = vfx * ease.outExpo(prog(t, t0, t0 + 0.12));
      panel(80, 752, 470 * pk, 104, vfx); panel(W - 80 - 540 * pk, 704, 540 * pk, 152, vfx);
      c.textAlign = 'left';
      L(type('VFX 042 · SKY REPLACE · v003', t0), 96, 774, rgba('bone', 0.9 * vfx));
      L(type('PLATE   EXT. PICTURE PALACE — NIGHT', t0 + 0.08), 96, 798, rgba('ash', 0.85 * vfx));
      L(type('MATTE   PAINTED, ONE BRUSH, BY HAND', t0 + 0.14), 96, 822, rgba('ash', 0.85 * vfx));
      const sw = type('SWATCH  #8B5CFF   USE: ONCE', t0 + 0.2);
      L(sw, 96, 846, rgba('ash', 0.85 * vfx));
      if (sw.length > 16) { c.fillStyle = rgba('acid', vfx); c.fillRect(96 + c.measureText('SWATCH  #8B5CFF ').width + 2, 835, 12, 12); }
      c.textAlign = 'right';
      const tr = this.trackers.filter((q) => t >= q.tOn).length, under = this.trackers.filter((q) => t >= q.tCover + 0.1).length;
      L(`TRACKERS  ${String(tr).padStart(2, '0')}  ·  SOLVED ${String(tr - under).padStart(2, '0')}`, W - 96, 750, rgba('ash', 0.85 * vfx));
      L(`UNDER PAINT  ${String(under).padStart(2, '0')}`, W - 96, 774, under > 0 ? rgba('bone', 0.85 * vfx) : rgba('ash', 0.6 * vfx));
      const cov = this.coverage(t) * 100;
      L(`SKY REPLACED  ${cov.toFixed(0).padStart(2, ' ')} %`, W - 96, 798, rgba('ash', 0.85 * vfx));
      // the brush's own data, riding above the head
      const b = brushAt(P, t);
      const flow = 0.62 + 0.3 * Math.abs(noise1(t * 3, 3));
      L(b ? `BRUSH ${Math.round(b.st.w * b.p)} PX · FLOW ${flow.toFixed(2)} · STROKE ${String(b.st.id + 1).padStart(2, '0')}/04` : 'BRUSH  UP', W - 96, 822, b ? rgba('bone', 0.85 * vfx) : rgba('ash', 0.6 * vfx));
    }
    if (orn > 0) {
      panel(80, 56, 470, 104, orn); panel(W - 80 - 470, 56, 470, 80, orn);
      const n = this.flock.count(t);
      c.textAlign = 'left';
      L('ORNITHOLOGY · PLATE XI', 96, 78, rgba('bone', 0.9 * orn));
      L('SPECIES   STURNUS LITTERATUS', 96, 102, rgba('ash', 0.85 * orn));
      L(`BIRDS     ${comma(n).padStart(5, ' ')}`, 96, 126, rgba('ash', 0.85 * orn));
      L(`LETTERS   ${comma(n).padStart(5, ' ')}   Δ 0`, 96, 150, rgba('ash', 0.85 * orn));
      c.textAlign = 'right';
      const tau = this.flock.tau(t);
      const beat = this.ctx.audio.beatAt(t);
      L(`WIND  ${(3.8 + 0.6 * Math.sin(tau * 0.7)).toFixed(1)} m/s  NNE`, W - 96, 102, rgba('ash', 0.85 * orn));
      L(`FLOCK CLOCK  BEAT ${Math.floor(beat) - Math.floor(this.ctx.audio.beatAt(tM2)) + 1}`, W - 96, 126, rgba('ash', 0.85 * orn));
      // the plate's caption
      c.textAlign = 'left';
      c.letterSpacing = '0px';
      c.font = font(F.serif(400, true), 30);
      L('Pl. XI. — The lettered starling, in murmuration over a picture palace.', 96, 1080 - 118, rgba('bone', 0.82 * orn));
      c.font = font(F.mono(500), 12);
      c.letterSpacing = '1.5px';
      L('FIG. 11  ·  DRAWN FROM LIFE AT 24 FPS  ·  EACH BIRD IS ONE LETTER  ·  NO LETTERS WERE HARMED', 96, 1080 - 88, rgba('ash', 0.8 * orn));
    }
    // FRAMES: the viewer's frame counter (the film's count), all through the plate: in the shot data, then in the plate's
    {
      c.font = font(F.mono(500), 15);
      c.letterSpacing = '2px';
      c.textAlign = 'right';
      const fr = (y: number, a: number) => {
        if (a <= 0) return;
        L('FRAMES', W - 96 - c.measureText(' 000 000').width - 6, y, rgba('ash', 0.85 * a));
        L(grp(frames(t)), W - 96, y, rgba('bone', 0.95 * a));
      };
      fr(846, vfx);
      fr(78, orn);
    }
    c.restore();
    // ---- in the paint (world space)
    c.save();
    c.setTransform(...m);
    c.textBaseline = 'alphabetic';
    P.strokes.forEach((st, si) => {
      if (t < st.t0) return;
      // micro lettering: the paint is made of the lyric
      c.font = font(F.archivo(87.5, 700), st.chunks[0]?.size ?? 15);
      c.textAlign = 'center';
      c.letterSpacing = '1.2px';
      for (const ch of st.chunks) {
        if (t < ch.th) continue;
        const pa = 1 - prog(t, this.peelAt(ch.x, ch.y), this.peelAt(ch.x, ch.y) + 0.15);
        if (pa <= 0) continue;
        c.save();
        c.translate(ch.x, ch.y); c.rotate(ch.a);
        c.fillStyle = violetCss(t - ch.th, 0.5 * pa);
        c.fillText(ch.text, 0, ch.size * 0.36);
        c.restore();
      }
      // the sung words, set on the spine where the head passed them
      c.textAlign = 'left';
      c.letterSpacing = '0px';
      const hs = headS(st, t);
      st.glyphs.forEach((g, gi) => {
        const age = t - g.tg;
        if (age < 0) return;
        const tpg = this.tpG[si]![gi]!;
        const pa = 1 - prog(t, tpg, tpg + 0.12);
        if (pa <= 0) return;
        c.save();
        c.translate(g.x, g.y); c.rotate(g.a);
        // painted in by the brush: the glyph shows only where the head has been
        const fr = clamp((hs - g.s) / g.w);
        if (fr < 1) { c.beginPath(); c.rect(-g.w / 2 - 30, -g.size, fr * g.w + 30, g.size * 2); c.clip(); }
        c.font = font(g.fam, g.size);
        c.fillStyle = g.word === PURPLE ? violetCss(age, pa) : hotCss(age, pa);
        c.fillText(g.ch, -g.w / 2, g.cap / 2);
        c.restore();
      });
    });
    // world-anchored labels
    c.font = font(F.mono(500), 12);
    c.letterSpacing = '1.5px';
    c.textAlign = 'left';
    if (vfx > 0) {
      c.fillStyle = rgba('ash', 0.8 * vfx);
      for (const tr of this.trackers) {
        if (t < tr.tOn + 0.02 || t > tr.tCover) continue;
        c.fillText(`T${String(tr.id).padStart(2, '0')}`, tr.x + 7, tr.y - 7);
      }
      const wx = lerp(-40, 1960, ease.outCubic(prog(t, this.T0 + 0.02, this.T0 + 0.3)));
      c.save();
      c.beginPath(); c.rect(-400, 0, wx + 400, 2000); c.clip();
      c.fillStyle = rgba('ash', 0.85 * vfx);
      c.fillText('MATTE LINE  y 900  ·  PAINT ABOVE ONLY', 1330, ROOF - 20);
      c.fillStyle = rgba('graphite', 0.9 * vfx);
      c.fillText('HOLDOUT  ·  PLATE KEPT AS SHOT', 96, ROOF + 60 + 70);
      c.restore();
      // stroke length labels
      for (const st of P.strokes) for (const tk of st.ticks) {
        if (!tk.label || t < st.tS[tk.i]!) continue;
        const q = st.pts[tk.i]!, o = -(0.5 * st.w * st.prof[tk.i]! + 22);
        c.fillStyle = rgba('ash', 0.7 * vfx);
        c.fillText(tk.label, q.x + st.nx[tk.i]! * o - 12, q.y + st.ny[tk.i]! * o + 4);
      }
    }
    // M2: the formed words' counts
    if (orn > 0) {
      for (const fm of this.forms) {
        const ws = wStart(fm.w), we = wEnd(fm.w);
        const a = orn * prog(t, ws, ws + 0.06) * (1 - prog(t, we + 0.1, we + 0.3)) * (fm.w === 69 ? 1 - prog(t, this.tCd0, this.tCd0 + 0.1) : 1);
        if (a <= 0) continue;
        const [x0, y0] = fm.box;
        const lx = x0 - 18, ly = y0 - 26;
        c.strokeStyle = rgba('ash', 0.6 * a); c.lineWidth = 1 / cam.z;
        c.beginPath(); c.moveTo(x0 - 2, y0 - 2); c.lineTo(lx, ly); c.lineTo(lx - 40, ly); c.stroke();
        c.fillStyle = rgba('ash', 0.9 * a);
        c.textAlign = 'right';
        c.fillText(`n = ${comma(fm.n)}`, lx - 46, ly + 4);
      }
      c.textAlign = 'left';
      // a few wind speeds
      const tau = this.flock.tau(t);
      c.fillStyle = rgba('graphite', 0.95 * orn);
      for (let i = 3; i < this.winds.length; i += 9) {
        const p = this.winds[i]!;
        const v = 2.6 + 3.2 * Math.abs(noise2(p.x / 400, p.y / 400 + tau * 0.2, 4));
        c.fillText(`${v.toFixed(1)} m/s`, p.x + 16, p.y + 16);
      }
    }
    c.restore();

    c.restore();
  }

  /** the paint's peel time at a world point (a front from where the brush stopped) */
  peelAt(x: number, y: number) { return this.tM2 + 0.03 + 0.42 * clamp(Math.hypot(x - this.P0.x, (y - this.P0.y) * 1.3) / 2000); }
}

