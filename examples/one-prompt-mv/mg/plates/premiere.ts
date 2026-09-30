// Plate `premiere` — "One prompt, one film tonight!" and the climax. CUT.premiere → CUT.outro.
// From H17 (a dark frame, one hot point of city light at frame centre) we fall onto that point: it is
// the beacon on the blade sign of THE CARET, the picture palace in the plaza of our model city (the
// city plate's own world, now at night on premiere night). The camera plunges in a log-zoom about the
// beacon and cranes from plan to a low skyline elevation, landing on "One"; the windows light in a
// wave outward from the theatre, four searchlights sweep (engraved beams, beat-stepped), fireworks
// drawn in lines burst on the sung words and the kicks. "ONE PROMPT, / ONE FILM" is set big and kerned
// in the sky word by word; on "tonight!" the camera pulls back, the lines snap up into one line and
// TONIGHT! is written by fireworks: a rocket per glyph, whose sparks fly to the glyph's outline and
// hang there. The climax: the word bursts again and falls, shells on every kick and snare, and the
// in-world counter (FRAMES, live in the drawing's title block, a callback to the city sheet) is blown
// up and overflows one value per beat — 2,160 → 5,343 → 1,000,000 — until the spark traces ∞ on the
// last beat. Where the drums stop everything collapses onto one line: the camera drops to a pure
// elevation while the buildings sink, the sparks and the type fall onto it, the ∞ is flattened, and at
// the cut (H18) only a bone hairline at y 540 is left, the spark at x 1500.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H, clearRT } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, layout, measure } from '../px/type';
import { clamp, ease, keys, lerp, prog, pulse, hash, noise1, frameIdx, mulberry32, TAU, type Key } from '../px/util';
import { wStart, wEnd } from './lyric';
import { CUT, POINT_H17, frames } from './handoff';
import { camXf, type Cam, type Xf } from './city-cam';
import type { V3 } from './city-geo';
import { NightCity, THEATRE } from './premiere-city';
import { drawShells, drawBeam, buildWordSparks, drawWordSparks, drawWordGuides, buildCrossette, drawCrossette, type Shell, type WordSparks, type Branch } from './premiere-fx';
import {
  sc, mix3, hotType, grp, glyphOutlines, drawLine, drawSpark, sparkPlan, lemniscate, infU, flatK, POST_H18, toPost, heatCol,
  INF, LINE_Y, WHITE, type SparkPlan, type P2,
} from './premiere-kit';

const DEG = Math.PI / 180;
const W0 = 108; // "One" (… tonight!)
const ROW = ['ONE PROMPT,', 'ONE FILM'];
/** word index of each glyph run in ROW */
const ROW_WORDS = [[108, 109], [110, 111]];

const SKY_FRAG = /* glsl */ `
uniform float uHy, uSky, uFlash, uT, uK;
void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec3 c = C_INK;
  float d = uHy - p.y;                            // px above the city's far edge
  float glow = exp(-max(d, 0.0) / 260.0) * step(-400.0, d);
  c += (C_BLOOD * 0.008 + C_EMBER * 0.002) * glow * uSky;
  // an engraved night: horizontal rules, closer and heavier toward the lit horizon
  float wob = 0.35 * snoise(vec2(p.x * 0.0021, p.y * 0.013));
  float hl = hatch(p.y / 5.0 + wob, 0.06 + 0.22 * glow);
  c += C_GRAPHITE * 0.05 * hl * uSky * smoothstep(-30.0, 40.0, d);
  // smoke over the city, lit by the shells
  float sm = fbm(vec2(p.x * 0.0017, p.y * 0.0026) + vec2(uT * 0.04, -uT * 0.02), 4);
  c += (C_SIGNAL * 0.012 + C_EMBER * 0.003) * uFlash * smoothstep(0.2, 0.8, sm) * uSky * smoothstep(-100.0, 120.0, d);
  fragColor = vec4(c * (1.0 - uK), 1.0);
}`;

interface Tag { t: number; at: V3; txt: string; sub: string }

export default class Premiere extends Scene {
  sky = new FSPass(SKY_FRAG, { uHy: { value: 600 }, uSky: { value: 0 }, uFlash: { value: 0 }, uT: { value: 0 }, uK: { value: 0 } });
  city = new NightCity();
  fx = new LineBatch(24000, { blend: 'add' });
  txt = new Layer2D();
  T0 = 0; T1 = 0;
  b0 = 0;
  shells: Shell[] = [];
  tags: Tag[] = [];
  ws!: WordSparks;
  tree: Branch[] = [];
  tips = 0;
  sp!: SparkPlan;
  kicks: [number, number][] = [];
  snares: [number, number][] = [];
  capK = 0.72;
  rowA: { ch: string; x: number; y: number; w: number; word: number }[] = [];
  rowB: { x: number; y: number }[] = [];
  SA = 190; SB = 84;
  tonightA = 0;
  lz: Key[] = []; phiK: Key[] = []; psiK: Key[] = []; syK: Key[] = [];

  B(k: number) { return this.ctx.audio.timeOfBeat(this.b0 + k); }

  override async init() {
    const au = this.ctx.audio;
    this.T0 = CUT.premiere; this.T1 = CUT.outro;
    this.b0 = Math.round(au.beatAt(this.T0));
    this.sp = sparkPlan();
    this.kicks = au.events('kick', this.T0 - 0.1, this.T1);
    this.snares = au.events('snare', this.T0 - 0.1, this.T1);
    {
      const c = document.createElement('canvas').getContext('2d')!;
      c.font = font(F.archivo(100, 900), 100);
      this.capK = (c.measureText('H').actualBoundingBoxAscent || 72) / 100;
    }
    this.buildCamera();
    this.buildRow();
    this.buildShells();
    // TONIGHT!, written by fireworks: one burst per glyph across the sung word
    const tw = wStart(W0 + 4), te = wEnd(W0 + 4);
    const ST = Math.min(300, (300 * 1560) / measure('TONIGHT!', F.archivo(100, 900), 300));
    const tx0 = 960 - measure('TONIGHT!', F.archivo(100, 900), ST) / 2;
    const glyphs = glyphOutlines('TONIGHT!', ST, tx0, 575, 8.5);
    const tk = glyphs.map((_, k) => tw + (k / glyphs.length) * 0.62 * (te - tw));
    this.ws = buildWordSparks(glyphs, tk, this.B(7));
    this.tonightA = tw - 0.03;
    // the crossette: a generation on every eighth note through the climax
    const gens: number[] = [];
    for (let k = 0; k <= 7; k++) gens.push(au.timeOfBeat(this.b0 + 7 + k * 0.5) + (k === 0 ? 0 : 0));
    this.tree = buildCrossette([0, 1.5, 6.4], gens, 3301);
  }

  // ---------------------------------------------------------------- camera
  buildCamera() {
    const B = (k: number) => this.B(k), T0 = this.T0, T1 = this.T1;
    const L = Math.log;
    const lin = ease.linear, oX = ease.outExpo;
    // the plunge onto the beacon lands on "One"; creep through the words; pull back on "tonight!";
    // push in a step per beat through the climax; the collapse widens the frame onto the line
    this.lz = [
      [T0, L(0.2)], [B(1), L(16.5), (x) => ease.inCubic(x) * 0.96 + 0.04 * x], [B(1) + 0.3, L(14.2), oX],
      [B(5), L(15.2), lin], [B(5) + 0.4, L(8.6), oX],
      [B(7), L(8.9), lin], [B(7) + 0.22, L(9.6), oX], [B(8), L(9.7), lin], [B(8) + 0.22, L(10.6), oX],
      [B(9), L(10.7), lin], [B(9) + 0.22, L(11.8), oX], [B(10) + 0.08, L(11.9), lin], [T1 - 0.06, L(24), ease.inCubic],
    ];
    this.phiK = [[T0, 90], [B(1), 12, ease.inOutCubic], [B(5), 11.5, lin], [B(5) + 0.4, 14, oX], [B(10) + 0.1, 15, lin], [T1 - 0.07, 0, ease.inOutCubic]];
    this.psiK = [[T0, 0.62], [B(1), 0.34, ease.inOutCubic], [B(5), 0.27, lin], [B(5) + 0.4, 0.22, oX], [T1, 0.14, lin]];
    this.syK = [[T0, POINT_H17.y], [B(1), 792, ease.inOutCubic], [B(5), 800, lin], [B(5) + 0.4, 842, oX], [B(10) + 0.1, 842, lin], [T1 - 0.06, LINE_Y, ease.inOutCubic]];
  }
  /** the stair of per-word nods (×1.035 each, outExpo in 0.2 s) */
  nods(t: number) {
    let z = 1;
    for (let i = W0; i <= W0 + 3; i++) z *= 1 + 0.035 * ease.outExpo(prog(t, wStart(i), wStart(i) + 0.2));
    return z;
  }
  /** 0..1: the buildings sink, everything falls onto the line */
  collapse(t: number) { return ease.inQuad(prog(t, this.B(10) + 0.12, this.T1 - 0.08)); }
  camAt(t: number): { cam: Cam; m: Xf; hs: number } {
    const z = Math.exp(keys(t, this.lz)) * this.nods(t);
    let roll = 0;
    for (const [ts, s] of this.snares) if (ts > this.B(6.8) && ts < this.B(10.2)) roll += (hash(ts * 100) > 0.5 ? 1 : -1) * 0.014 * s * pulse(t, ts, 0.12);
    const cam: Cam = { P: THEATRE.beacon, sx: POINT_H17.x, sy: keys(t, this.syK), z, psi: keys(t, this.psiK), phi: keys(t, this.phiK) * DEG, roll };
    const hs = 1 - this.collapse(t);
    const m = camXf(cam);
    // squash heights (the z column) about the ground, keeping the beacon's ground point fixed
    m.ax[2] *= hs; m.ay[2] *= hs; m.ad[2] *= hs;
    const P = cam.P;
    m.bx = cam.sx - (m.ax[0] * P[0] + m.ax[1] * P[1] + m.ax[2] * P[2]);
    m.by = cam.sy - (m.ay[0] * P[0] + m.ay[1] * P[1] + m.ay[2] * P[2]);
    m.bd = -(m.ad[0] * P[0] + m.ad[1] * P[1] + m.ad[2] * P[2]);
    return { cam, m, hs };
  }

  // ---------------------------------------------------------------- the sky lyric
  buildRow() {
    const fam = F.archivo(100, 900);
    const x0 = 150, yA = [262, 262 + this.SA * 1.0];
    ROW.forEach((txt, r) => {
      const lay = layout(txt, fam, this.SA);
      const sp = txt.indexOf(' ');
      lay.glyphs.forEach((g) => { this.rowA.push({ ch: g.ch, x: x0 + g.x, y: yA[r]!, w: g.w, word: ROW_WORDS[r]![g.i < sp ? 0 : 1]! }); });
    });
    // one line at the top: "ONE PROMPT, ONE FILM"
    const one = `${ROW[0]} ${ROW[1]}`;
    const lay = layout(one, fam, this.SB);
    const xb = 960 - lay.width / 2;
    let k = 0;
    lay.glyphs.forEach((g, i) => { if (i === ROW[0]!.length) return; this.rowB.push({ x: xb + g.x, y: 176 }); k++; });
    void k;
  }

  // ---------------------------------------------------------------- shells
  buildShells() {
    const rnd = mulberry32(1608);
    const roof: V3 = [0, 2.2, 6.2];
    let no = 0;
    const NAMES = ['PEONY', 'WILLOW', 'RING', 'COMET'];
    const add = (tb: number, c: V3, v: number, n: number, kind: number, I: number, rise = 0.42, from: V3 = roof) => {
      no++;
      const size = [6, 8, 5, 3][kind]!;
      this.shells.push({ t: tb, t0: tb - rise, from, c, n, v, drag: 3.4, g: kind === 1 ? 5 : 8, life: kind === 1 ? 1.7 : kind === 3 ? 0.7 : 1.15, kind, seed: Math.floor(rnd() * 9000) + 11, I, tag: `No. ${String(no).padStart(2, '0')} · ${NAMES[kind]} ${size} IN` });
      if (kind !== 3 && tb < this.B(7) - 0.1) this.tags.push({ t: tb, at: c, txt: `No. ${String(no).padStart(2, '0')}`, sub: `${NAMES[kind]} · ${size} IN` });
    };
    // the sung words
    add(wStart(W0), [2, 26, 30], 52, 140, 0, 1.15, 0.46);
    add(wStart(W0 + 1), [-32, 24, 24], 44, 110, 0, 1.0);
    add(wStart(W0 + 1) + 0.1, [30, 30, 28], 40, 100, 2, 1.0);
    add(wStart(W0 + 2), [-6, 34, 32], 46, 120, 2, 1.1);
    add(wStart(W0 + 3), [20, 22, 26], 56, 150, 0, 1.2);
    add(wStart(W0 + 3) + 0.07, [-36, 18, 20], 40, 100, 1, 0.9);
    // kicks between the words: comets low over the roofs
    const near = (t: number) => [W0, W0 + 1, W0 + 2, W0 + 3].some((i) => Math.abs(t - wStart(i)) < 0.12);
    for (const [tk] of this.kicks) {
      if (tk < wStart(W0) + 0.1 || tk > wStart(W0 + 4) - 0.05 || near(tk)) continue;
      const x = (rnd() - 0.5) * 90, y = 14 + rnd() * 30;
      add(tk, [x, y, 11 + rnd() * 6], 22, 44, 3, 0.8, 0.3, [x * 0.9, y, 0]);
    }
    // during "tonight!": willows at the sides, so the word keeps the middle
    for (const [tk] of this.kicks) {
      if (tk < wStart(W0 + 4) + 0.2 || tk > this.B(7) - 0.05) continue;
      const sd = rnd() > 0.5 ? 1 : -1;
      add(tk, [sd * (38 + rnd() * 12), 24 + rnd() * 16, 16 + rnd() * 8], 36, 80, 1, 0.85, 0.4, [sd * 30, 10, 0]);
    }
    // the climax: a shell on every kick and snare, alternating sides, growing
    const hits = [...this.kicks, ...this.snares].filter(([t]) => t >= this.B(7) - 0.03 && t < this.B(10) - 0.02).sort((a, b) => a[0] - b[0]);
    hits.forEach(([th, s], i) => {
      if (i > 0 && th - hits[i - 1]![0] < 0.06) return;
      const sd = i % 2 ? 1 : -1, g = i / hits.length;
      const kind = i % 5 === 3 ? 2 : i % 4 === 1 ? 1 : 0;
      add(th, [sd * (8 + rnd() * 40), 16 + rnd() * 26, 22 + rnd() * 14], 50 + 20 * g, Math.round(110 + 70 * g), kind, (0.95 + 0.4 * g) * Math.min(1.2, 0.6 + s * 0.5), 0.36);
    });
  }

  // ---------------------------------------------------------------- render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, B = (k: number) => this.B(k);
    const { cam, m } = this.camAt(t);
    const proj = (p: V3): P2 => ({ x: m.ax[0] * p[0] + m.ax[1] * p[1] + m.ax[2] * p[2] + m.bx, y: m.ay[0] * p[0] + m.ay[1] * p[1] + m.ay[2] * p[2] + m.by });
    const col = this.collapse(t);
    const live = 1 - prog(t, this.T1 - 0.17, this.T1 - 0.07); // everything but the line fades once it has landed

    // ---- sky
    clearRT(renderer, out, LIN.ink);
    const light = this.lightAt(t);
    const u = this.sky.u;
    u.uHy!.value = proj([0, 60, 0]).y;
    u.uSky!.value = prog(t, B(1) - 0.25, B(1) + 0.1) * live;
    u.uFlash!.value = Math.min(2, light);
    u.uT!.value = t;
    u.uK!.value = 0;
    this.sky.render(renderer, out);

    // ---- the city
    const on = prog(t, this.T0 + 0.03, this.T0 + 0.32);
    this.city.render(renderer, out, m, {
      t, lineA: on * live, faceA: prog(t, this.T0 + 0.02, this.T0 + 0.25) * live, winA: on * live,
      w0: this.T0 + 0.06, w1: B(1) + 0.45, flash: Math.min(2, light), zoom: cam.z, beat: Math.floor(this.ctx.audio.beatAt(t)),
      chase: Math.floor(this.ctx.audio.beatAt(t) * 2), beacon: 1 + 0.8 * f.a.kick,
    });

    // ---- lights and fire
    const lb = this.fx; lb.clear();
    this.drawBeams(lb, t, proj, live);
    drawShells(lb, this.shells, t, proj, cam.z, live);
    this.tips = drawCrossette(lb, this.tree, t, proj, live);
    const launch = (tt: number) => proj([0, -1.9, 6.3 + 0 * tt]);
    drawWordGuides(lb, this.ws, t, this.tonightA, live);
    const sq = (p: P2): P2 => ({ x: p.x, y: LINE_Y + (p.y - LINE_Y) * (1 - col) });
    drawWordSparks(lb, this.ws, t, launch, live, sq);
    this.drawRings(lb, t, proj, live);
    this.drawBeacon(lb, t, proj, f);
    this.drawInfinity(lb, t);
    lb.render(renderer, out);

    // ---- type
    const L = this.txt; L.clear();
    const c = L.ctx;
    c.setTransform(1, 0, 0, 1 - col, 0, LINE_Y * col);
    c.globalAlpha = live;
    this.drawRow(c, t);
    this.drawNotes(c, t, proj, cam);
    this.drawCounter(c, t);
    c.globalAlpha = 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, L.upload(), out);

    // ---- the line and the spark (H18)
    const lb2 = this.fx; lb2.clear();
    const sp = this.sp;
    if (t >= sp.flat1 - 0.06) {
      const e = ease.outExpo(prog(t, sp.flat1 - 0.02, sp.flat1 + 0.05));
      drawLine(lb2, lerp(INF.cx - INF.A, -24, e), lerp(INF.cx + INF.A, W + 24, e), prog(t, sp.flat1 - 0.06, sp.flat1));
    }
    drawSpark(lb2, sp, t);
    lb2.render(renderer, out);

    return this.post(t, f, light);
  }

  lightAt(t: number) {
    let l = 0;
    for (const s of this.shells) if (t >= s.t && t < s.t + 0.5) l += s.I * Math.pow(0.5, (t - s.t) / 0.055);
    for (const tb of this.ws.tk) if (t >= tb && t < tb + 0.4) l += 0.6 * Math.pow(0.5, (t - tb) / 0.055);
    return l;
  }

  /** four searchlights on the roof: beat-stepped between fan, cross, V and parallel; strobing in the climax */
  drawBeams(lb: LineBatch, t: number, proj: (p: V3) => P2, live: number) {
    const a = prog(t, this.B(1) - 0.3, this.B(1) + 0.15) * live;
    if (a <= 0.001) return;
    const PAT = [[-0.55, -0.2, 0.2, 0.55], [0.45, 0.15, -0.15, -0.45], [-0.25, -0.08, 0.08, 0.25], [0.3, 0.3, -0.3, -0.3], [-0.7, -0.35, 0.35, 0.7]];
    const bt = this.ctx.audio.beatAt(t) - this.b0;
    const k = Math.floor(bt), e = ease.outExpo(clamp((bt - k) * 2.2));
    const climax = t >= this.B(7) && t < this.B(10);
    THEATRE.lights.forEach((o, i) => {
      const A0 = PAT[((k - 1) % PAT.length + PAT.length) % PAT.length]![i]!, A1 = PAT[(k % PAT.length + PAT.length) % PAT.length]![i]!;
      const th = lerp(A0, A1, e) + 0.05 * noise1(t * 0.8, i);
      const d: V3 = [Math.sin(th), 0.35 + 0.1 * i, Math.cos(th)];
      const L = 140;
      const O = proj(o), E = proj([o[0] + d[0] * L, o[1] + d[1] * L, o[2] + d[2] * L]);
      const strobe = climax ? (hash(i, Math.floor(bt * 4)) > 0.35 ? 1.5 : 0.35) : 1;
      drawBeam(lb, { o: O, e: E, w0: 2.5, w1: 70 + 0.05 * Math.hypot(E.x - O.x, E.y - O.y), I: strobe }, a);
    });
  }

  /** the climax's shock rings: one per beat from the theatre, and the flash on each counter slam */
  drawRings(lb: LineBatch, t: number, proj: (p: V3) => P2, live: number) {
    const c = proj(THEATRE.beacon);
    for (let k = 7; k <= 10; k++) {
      const tk = this.B(k), a = t - tk;
      if (a < 0 || a > 1.1) continue;
      const R = ease.outCubic(a / 1.1) * 1500, fade = (1 - a / 1.1) * live;
      const n = 160;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        lb.seg2(c.x + Math.cos(a0) * R, c.y + Math.sin(a0) * R * 0.34, c.x + Math.cos(a1) * R, c.y + Math.sin(a1) * R * 0.34, 2.2 * fade + 0.5, sc(LIN.signal, 1.8 * fade), fade);
      }
    }
  }

  drawBeacon(lb: LineBatch, t: number, proj: (p: V3) => P2, f: Frame) {
    // the one point of city light (H17), then the blade sign's beacon, pulsing with the kick
    const p = proj(THEATRE.beacon);
    const k = 1 - this.collapse(t);
    const I = (1 + 0.7 * f.a.kick) * k;
    if (I <= 0.01) return;
    lb.seg2(p.x, p.y, p.x + 0.01, p.y, 22, sc(LIN.signal, 0.45 * I), 0.35);
    lb.seg2(p.x, p.y, p.x + 0.01, p.y, 10, sc(LIN.ember, 2.2 * I), 0.8);
    lb.seg2(p.x, p.y, p.x + 0.01, p.y, 4, sc(WHITE, 4 * I), 1);
  }

  /** ∞ traced by the spark on the last beat, hot, cooling; then flattened onto the line */
  drawInfinity(lb: LineBatch, t: number) {
    const sp = this.sp;
    if (t < sp.infT0 || t > sp.flat1) return;
    const sq = flatK(sp, t), fade = 1 - prog(t, sp.flat1 - 0.06, sp.flat1);
    const N = 220;
    let prev: P2 | null = null;
    for (let k = 0; k <= N; k++) {
      const tk = lerp(sp.infT0, sp.infT1, k / N);
      if (tk > t) break;
      const p = lemniscate(infU(sp, tk), sq);
      if (prev) lb.seg2(prev.x, prev.y, p.x, p.y, 2.2 + 1.5 * Math.exp(-(t - tk) / 0.05), heatCol(t - tk, sc(LIN.bone, 0.8)), fade);
      prev = p;
    }
  }

  // ---------------------------------------------------------------- type
  drawRow(c: CanvasRenderingContext2D, t: number) {
    const fam = F.archivo(100, 900);
    const tw = wStart(W0 + 4);
    const mv = ease.outExpo(prog(t, tw, tw + 0.34));
    const size = lerp(this.SA, this.SB, mv);
    const mx2 = ease.outExpo(prog(t, tw, tw + 0.24)), my2 = ease.inOutCubic(prog(t, tw + 0.06, tw + 0.36));
    c.textBaseline = 'alphabetic';
    this.rowA.forEach((g, i) => {
      const ws = wStart(g.word);
      const ant = Math.max(ws - 0.4, this.B(1) - 0.1);
      if (t < ant) return;
      const sung = t >= ws;
      const b = this.rowB[i]!;
      const pop = sung ? 1 + 0.14 * (1 - ease.outExpo(clamp((t - ws) / 0.16))) : 1;
      const r2 = g.word >= W0 + 2;
      const x = lerp(g.x, b.x, r2 ? mx2 : mv), y = lerp(g.y, b.y, r2 ? my2 : mv);
      c.save();
      c.translate(x, y); c.scale(pop, pop);
      c.font = font(fam, size);
      c.fillStyle = sung ? hotType(t - ws) : rgba('bone', 0.26 * clamp((t - ant) / 0.12));
      c.fillText(g.ch, 0, 0);
      c.restore();
    });
  }

  drawNotes(c: CanvasRenderingContext2D, t: number, proj: (p: V3) => P2, cam: Cam) {
    const B = (k: number) => this.B(k);
    const mono = (s: string, x: number, y: number, px: number, col: string, ls = 1.5, w = 500) => {
      c.font = font(F.mono(w), px); c.letterSpacing = `${ls}px`; c.fillStyle = col; c.fillText(s, x, y); c.letterSpacing = '0px';
    };
    const typed = (s: string, t0: number, cps = 90) => s.slice(0, Math.max(0, Math.floor((t - t0) * cps)));
    // the descent: an altimeter, deadpan
    if (t < B(1) + 0.5) {
      const a = prog(t, this.T0 + 0.05, this.T0 + 0.15) * (1 - prog(t, B(1) + 0.3, B(1) + 0.5));
      const cz = this.camAt(frameIdx(t) / 60).cam.z;
      const alt = 40 * (16.5 / Math.max(0.2, cz));
      c.globalAlpha *= a;
      mono(typed('DESCENT · PREMIERE NIGHT', this.T0 + 0.05), 96, 470, 15, rgba('ash', 0.9), 3);
      mono(`ALT ${grp(alt)} M`, 96, 505, 30, rgba('bone', 0.92), 2, 400);
      mono(`PITCH ${(this.camAt(frameIdx(t) / 60).cam.phi / DEG).toFixed(1)}°  ·  TARGET 1 LIGHT`, 96, 535, 15, rgba('ash', 0.8), 2);
      c.globalAlpha /= Math.max(1e-3, a);
    }
    const sheet = prog(t, B(1) - 0.1, B(1) + 0.2);
    if (sheet > 0) {
      c.globalAlpha *= sheet;
      mono('DWG 16 — PREMIERE', 96, 50, 15, rgba('signal', 1), 4, 600);
      mono(typed('THE CARET · 20:00 · ONE SCREENING · HOUSE FULL', B(1) - 0.1), 96, 74, 13, rgba('ash', 0.85), 2);
      mono(typed('WIND 2 KT · VISIBILITY ∞ · SMOKE: EXPECTED', B(1) + 0.2), 96, 1012, 13, rgba('ash', 0.7), 2);
      c.globalAlpha /= Math.max(1e-3, sheet);
    }
    // the theatre, called out once we have landed
    const ca = prog(t, B(1) + 0.08, B(1) + 0.2) * (1 - prog(t, B(5) - 0.1, B(5) + 0.1));
    if (ca > 0) {
      const p = proj([2.7, -2.7, 1.7]);
      const q = { x: p.x + 150, y: p.y - 150 };
      c.globalAlpha *= ca;
      c.strokeStyle = rgba('bone', 0.55); c.lineWidth = 1;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.lineTo(q.x + 250 * ca, q.y); c.stroke();
      c.fillStyle = rgba('bone', 0.8); c.fillRect(p.x - 2, p.y - 2, 4, 4);
      mono('THE CARET', q.x + 4, q.y - 10, 16, rgba('bone', 0.95), 4, 600);
      mono(typed('PICTURE PALACE · 1,000 SEATS', B(1) + 0.15), q.x + 4, q.y + 22, 12, rgba('ash', 0.9), 2);
      mono(typed('NOW SHOWING: 1 PROMPT', B(1) + 0.4), q.x + 4, q.y + 42, 12, rgba('signal', 0.95), 2);
      c.globalAlpha /= Math.max(1e-3, ca);
    }
    // searchlights, labelled at the lamps
    const sa = prog(t, B(2), B(2) + 0.2) * (1 - prog(t, B(5) - 0.1, B(5) + 0.1));
    if (sa > 0) {
      const o = proj(THEATRE.lights[0]!);
      c.globalAlpha *= sa;
      mono(typed('SL 1–4 · 4 × 60 KW · AIMED AT NOTHING', B(2)), o.x - 420, o.y - 64, 12, rgba('ash', 0.85), 2);
      c.globalAlpha /= Math.max(1e-3, sa);
    }
    // each shell tagged where it bursts (caused)
    for (const tg of this.tags) {
      const a = t - tg.t;
      if (a < 0.02 || a > 0.75) continue;
      const k = (1 - prog(a, 0.5, 0.75)) * prog(a, 0.02, 0.08);
      const p = proj(tg.at);
      c.globalAlpha *= k;
      c.strokeStyle = rgba('bone', 0.5); c.lineWidth = 1;
      c.beginPath(); c.moveTo(p.x + 6, p.y + 6); c.lineTo(p.x + 40, p.y + 40); c.lineTo(p.x + 120, p.y + 40); c.stroke();
      mono(tg.txt, p.x + 44, p.y + 34, 12, rgba('bone', 0.9), 2, 600);
      mono(tg.sub, p.x + 44, p.y + 56, 11, rgba('ash', 0.85), 2);
      c.globalAlpha /= Math.max(1e-3, k);
    }
    // the crossette, counted as it doubles
    if (t >= B(7) && t < B(10) + 0.1) {
      const k = clamp(Math.floor((this.ctx.audio.beatAt(t) - this.b0 - 7) * 2), 0, 6);
      mono(`No. 27 · CROSSETTE · ${2 ** k} STARS`, 96, 612, 13, rgba('bone', 0.9), 3, 600);
      mono('×2 EVERY EIGHTH · NO CEILING', 96, 636, 12, rgba('ash', 0.85), 2);
    }
    // TONIGHT!, counted
    const ta = prog(t, wStart(W0 + 4) + 0.5, wStart(W0 + 4) + 0.6) * (1 - prog(t, B(7) - 0.05, B(7)));
    if (ta > 0) {
      c.globalAlpha *= ta;
      const n = this.ws.pts.length;
      c.textAlign = 'center';
      mono(typed(`8 GLYPHS · ${grp(n)} SPARKS · HUNG IN ${(this.ws.tk[7]! - this.ws.tk[0]! + 0.3).toFixed(2)} S`, wStart(W0 + 4) + 0.5), 960, 640, 13, rgba('ash', 0.9), 3);
      c.textAlign = 'left';
      c.globalAlpha /= Math.max(1e-3, ta);
    }
  }

  /**
   * FRAMES: live in the title block (bottom right, the city sheet's), then blown up on the climax and
   * overflowing a value per beat; the last beat's value is ∞, drawn by the spark (drawInfinity).
   */
  drawCounter(c: CanvasRenderingContext2D, t: number) {
    const B = (k: number) => this.B(k);
    const a = prog(t, B(1) - 0.1, B(1) + 0.2);
    if (a <= 0) return;
    const fr = frames(frameIdx(t) / 60);
    const X = 1330, Y = 906, BW = 494, BH = 118;
    const blow = ease.outExpo(prog(t, B(7), B(7) + 0.2));
    const mono = (s: string, x: number, y: number, px: number, col: string, ls = 1.5, w = 500) => {
      c.font = font(F.mono(w), px); c.letterSpacing = `${ls}px`; c.fillStyle = col; c.fillText(s, x, y); c.letterSpacing = '0px';
    };
    c.globalAlpha *= a;
    // the title block
    const ba = 1 - 0.7 * blow;
    c.strokeStyle = rgba('bone', 0.4 * ba); c.lineWidth = 1;
    c.strokeRect(X, Y, BW, BH);
    c.beginPath(); c.moveTo(X, Y + 44); c.lineTo(X + BW, Y + 44); c.moveTo(X + 330, Y); c.lineTo(X + 330, Y + BH); c.moveTo(X, Y + 82); c.lineTo(X + BW, Y + 82); c.stroke();
    c.font = font(F.archivo(100, 900), 27); c.fillStyle = rgba('bone', 0.95 * ba); c.fillText('DWG 16 · PREMIERE', X + 12, Y + 33);
    mono('SHEET 16 OF 16', X + 344, Y + 27, 11, rgba('ash', 0.9 * ba), 2);
    mono('SCALE 1 : 1 PROMPT', X + 12, Y + 70, 12, rgba('bone', 0.8 * ba), 2);
    const nShell = this.shells.filter((s) => s.t <= t).length + this.ws.tk.filter((x) => x <= t).length;
    mono(`SHELLS ${String(nShell).padStart(3, '0')}`, X + 344, Y + 70, 11, rgba('ash', 0.9 * ba), 2);
    const lit = Math.round(2749 * clamp(Math.pow(clamp((t - this.T0 - 0.06) / (B(1) + 0.45 - this.T0 - 0.06)), 1 / 0.7)));
    mono(`LIT ${grp(lit)} / 2,749`, X + 12, Y + 108, 12, rgba('signal', 0.95 * ba), 2);
    // FRAMES: the field, then the value blown up over the sky
    const vals = ['2,160', '5,343', '1,000,000'];
    const notes = ['¹ 90 s × 24 fps: the whole film', '² with the director’s cut', '³ every seat, every screen, every city'];
    const k = t < B(7) ? -1 : t < B(8) ? 0 : t < B(9) ? 1 : t < B(10) ? 2 : 3;
    if (blow < 1) mono(`FRAMES ${grp(fr)}`, X + 344, Y + 108, 11, rgba('bone', 0.9 * (1 - blow)), 2);
    if (k >= 0) {
      const tk = B(7 + k), age = t - tk;
      const cx = 960, by = 520;
      const S = lerp(22, k === 2 ? 210 : 260, blow);
      const fx = lerp(X + 420, cx, blow), fy = lerp(Y + 108, by, blow);
      const pop = 1 + 0.12 * (1 - ease.outExpo(clamp(age / 0.14)));
      const out3 = k === 3 ? 1 - prog(t, B(10), B(10) + 0.12) : 1;
      if (k < 3 || out3 > 0) {
        const txt = k < 3 ? vals[k]! : vals[2]!;
        // a quick roll into each value
        const roll = age < 0.07 && k > 0 && k < 3 ? Array.from(txt).map((ch, i) => (/\d/.test(ch) ? String(Math.floor(hash(i, frameIdx(t)) * 10)) : ch)).join('') : txt;
        c.save();
        c.globalAlpha *= out3;
        c.translate(fx, fy); c.scale(pop, pop * out3);
        c.textAlign = 'center';
        c.font = font(F.mono(400), S); c.fillStyle = k < 3 ? hotType(age, 1, 0.35) : rgba('bone');
        c.fillText(roll, 0, 0);
        c.letterSpacing = `${lerp(2, 10, blow)}px`;
        c.font = font(F.mono(600), lerp(11, 26, blow)); c.fillStyle = rgba('signal');
        c.fillText('FRAMES', 0, -S * 0.86);
        c.letterSpacing = '0px';
        if (k < 3 && blow > 0.5) {
          const n = notes[k]!;
          c.font = font(F.mono(400), 24); c.fillStyle = rgba('ash', 0.95);
          c.fillText(n.slice(0, Math.floor(clamp((age - 0.04) / 0.14) * n.length)), 0, 78);
        }
        c.restore();
      }
      if (k === 3) {
        const n = '⁴ the film loops';
        const na = prog(t, B(10) + 0.12, B(10) + 0.2);
        c.save();
        c.globalAlpha *= na;
        c.textAlign = 'center';
        c.letterSpacing = '10px'; c.font = font(F.mono(600), 26); c.fillStyle = rgba('signal');
        c.fillText('FRAMES', 960, 290);
        c.letterSpacing = '0px';
        c.font = font(F.mono(400), 24); c.fillStyle = rgba('ash', 0.95);
        c.fillText(n.slice(0, Math.floor(clamp((t - B(10) - 0.12) / 0.2) * n.length)), 960, 790);
        c.restore();
      }
    }
    c.globalAlpha /= Math.max(1e-3, a);
  }

  // ---------------------------------------------------------------- post
  post(t: number, f: Frame, light: number): PostOverrides {
    const B = (k: number) => this.B(k);
    const climax = t >= B(7) - 0.05 && t < B(10) + 0.15 ? 1 : 0;
    let sh = 0;
    for (const [tk, s] of this.kicks) sh += s * pulse(t, tk, 0.07) * (climax ? 9 : t > wStart(W0) ? 3.5 : 0);
    for (const [ts, s] of this.snares) sh += s * pulse(t, ts, 0.07) * (climax ? 7 : t > wStart(W0) ? 2.5 : 0);
    sh += 12 * pulse(t, B(1), 0.06); // the landing
    for (let k = 7; k <= 10; k++) sh += 10 * pulse(t, B(k), 0.06);
    const fi = frameIdx(t);
    const punch = 0.03 * pulse(t, B(1), 0.08) + 0.012 * f.a.kick * (climax ? 1.6 : 0.6) + [7, 8, 9, 10].reduce((s, k) => s + 0.028 * pulse(t, B(k), 0.08), 0);
    const o: PostOverrides = {
      bloom: 0.62 + 0.12 * Math.min(1.5, light), bloomThreshold: 0.86, halation: 0.2,
      ca: 1.2 + 2.4 * pulse(t, B(1), 0.12) + 2 * climax * f.a.snare,
      flash: 0.003 * Math.min(2, light) + [7, 8, 9, 10].reduce((s, k) => s + 0.008 * pulse(t, B(k), 0.03), 0),
      shake: [sh * (hash(fi, 21) - 0.5) * 2, sh * (hash(fi, 22) - 0.5) * 2],
      zoom: 1 + punch, vignette: 0.36, grain: 0.055,
    };
    return toPost(o, POST_H18, prog(t, this.T1 - 0.12, this.T1 - 0.04));
  }
}

void mix3; void noise1; void H;
