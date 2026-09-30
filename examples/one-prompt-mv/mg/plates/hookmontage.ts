// Plate `hook` v8 — "One prompt, one film!", twice (params.n), as a montage cut to the song: a new treatment
// of the type on every sung word and on most eighths in between, each one moving all the time, all of them in
// the film's palette and type. The first chorus breathes (the filter), picks up on "One" and drops on "prompt"
// (the strongest kick of the section); the final chorus is at full weight from its first frame.
//   n=1: breath (streaks sucked into the caret, H5) · ONE as a tunnel of echoes out of the caret · slices ·
//        PROMPT stretched to the frame's height · the drop: 24 frames extruded into a vanishing point that
//        swings · copy-pasted rows · pixel smear · slot reels · through the O's counter into · a record of
//        rotating rings · ONE in op-art lines · strobe on the big kick · FILM! on running film strips · an
//        infinite cascade · 24 pastes round a ring that spins down while the caret draws the zoetrope's (H6).
//   n=2: from solid orange (H14): bars cut the orange away from ONE · kaleidoscope · cards flip in as prompt
//        is typed · a flickering grid · spotlights · halftone pumped by the bass · a width wave · a tunnel
//        pulling in · ONE split on a diagonal · a sunburst · a crop pan across a giant FILM! · the contact
//        sheet of the whole film (2,160 frames) · an iris closing onto the globe's disc (H15).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H, SCALE, scaleContext2D } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, layout, measure, type TextLayout } from '../px/type';
import { clamp, ease, lerp, noise1, prog, pulse, smoothstep, frameIdx, hash, TAU } from '../px/util';
import { sparkHead, sparkParticles } from '../px/motifs';
import { loadBytes } from '../px/load';
import { wStart, charTimes } from './lyric';
import { CARET_H5, RING_H6, GLOBE_H15, frames } from './handoff';
import { type Col, type RGB, hexRGB, heatCss, COMP } from './hook-kit';

const BEAT = 60 / 122;
const NF = 24;
const WIDTHS = [62, 75, 87.5, 100, 112.5, 125];
const nearestW = (w: number) => WIDTHS.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix3 = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const SIG = hexRGB('signal'), EMB = hexRGB('ember'), BLD = hexRGB('blood'), INK2 = hexRGB('ink2'), BONE = hexRGB('bone');
const WHITE: RGB = [255, 238, 214];
/** fresh ink type on a light field: born signal, cooling to ink */
const inkHot = (age: number) => css(mix3(SIG, hexRGB('ink'), smoothstep(0.03, 0.22, age)));
/** fresh ink type on the orange field: born bone-white, cooling to ink */
const inkHotO = (age: number) => css(mix3(mix3(BONE, WHITE, 0.5), hexRGB('ink'), smoothstep(0.02, 0.2, age)));
const SC = 48, SR = 45; // the contact sheet: 2,160 frames

interface WG { fam: string; size: number; cap: number; w: number; x0: number; base: number; lay: TextLayout; text: string }
interface Sh { t0: number; t1: number; fx: (c: CanvasRenderingContext2D, t: number, s: Sh) => void; name: string; hit: number; field: Col; age: number; u: number; dur: number; i: number }
type ShDef = [number, (c: CanvasRenderingContext2D, t: number, s: Sh) => void, string, number, Col];

export default class Plate extends Scene {
  n = 1;
  U = new Layer2D();
  A = new Layer2D();
  B = new Layer2D();
  glow = new LineBatch(8000, { blend: 'add' });
  ringLB = new LineBatch(600, { blend: 'max' });
  comp!: FSPass;
  T0 = 0; T1 = 0;
  w: number[] = [];
  ct: number[] = [];
  cf: number[] = [];
  kicks: [number, number][] = [];
  hats: [number, number][] = [];
  CAP = 0.686;
  mono = F.mono(500); monoR = F.mono(400);
  tX0 = 0; tX1 = 0; zA = 0; dropT = 0; kickB = 0;
  shots: Sh[] = [];
  counter = { x0: 0, x1: 0, y0: 0, y1: 0 };
  sheet: ImageBitmap | null = null;
  cov = new Float32Array(SC * SR); tf = new Float32Array(SC * SR);
  ht: { x: number; y: number; v: number }[] = [];
  private lays = new Map<string, TextLayout>();
  private rings = new Map<string, HTMLCanvasElement>();
  private cw = new Map<string, number>();

  override async init() {
    const { params, start, end, audio: au } = this.ctx;
    this.n = Number(params.n ?? 1);
    this.T0 = start; this.T1 = end;
    const b = this.n === 1 ? 37 : 92;
    this.w = [0, 1, 2, 3].map((i) => wStart(b + i));
    this.ct = charTimes(b + 1);
    this.cf = charTimes(b + 3);
    this.kicks = au.events('kick', start - 0.3, end + 0.01);
    this.hats = au.events('hat', start, end + 0.01);
    const mc = document.createElement('canvas').getContext('2d')!;
    mc.font = font(F.archivo(100, 900), 1000);
    this.CAP = mc.measureText('H').actualBoundingBoxAscent / 1000;
    const [w0, , w2, w3] = this.w as [number, number, number, number];
    const e8 = (x: number) => au.timeOfBeat(Math.round(au.beatAt(x) * 2) / 2);
    const next8 = (x: number) => au.timeOfBeat(Math.round(au.beatAt(x) * 2) / 2 + 0.5);
    const strongest = (a: number, z: number, fb: number) => this.kicks.filter(([k]) => k >= a && k <= z).sort((p, q) => q[1] - p[1])[0]?.[0] ?? fb;
    this.comp = new FSPass(COMP, { tex: { value: this.U.texture }, bgCol: { value: [LIN.ink[0], LIN.ink[1], LIN.ink[2]] }, hot: { value: 0 }, gain: { value: 1 } });
    let D: ShDef[];
    if (this.n === 1) {
      this.tX0 = au.timeOfBeat(au.beatAt(end) - 0.75);
      this.tX1 = end - 0.03;
      this.zA = au.timeOfBeat(Math.ceil(au.beatAt(this.cf[this.cf.length - 1]! + 0.03) - 1e-3));
      this.dropT = strongest(this.ct[0]! - 0.05, this.ct[0]! + 0.3, this.ct[1]!);
      this.kickB = strongest(w2 + 0.1, w3 - 0.02, w2 + 0.3);
      const k1 = strongest(w0 + 0.12, this.ct[0]! - 0.04, w0 + 0.26);
      const r1 = e8(this.dropT + 0.2), r2 = next8(r1), r3 = next8(r2), r4 = next8(r3), r5 = next8(r4);
      D = [
        [start, this.fxBreath, 'BREATH', 0, 'ink'],
        [w0, this.fxEcho, 'ECHO', 0.6, 'ink'],
        [k1, this.fxSlices, 'SLICE ×12', 0.6, 'ink'],
        [this.ct[0]!, this.fxStretch, 'STRETCH', 0.6, 'signal'],
        [this.dropT, this.fxExtrude, 'EXTRUDE · 24 FR', 1.2, 'ink'],
        [r1, this.fxRows, '⌘V ×7', 0.7, 'ink'],
        [r2, this.fxSmear, 'SMEAR', 0.7, 'bone'],
        [r3, this.fxSlot, 'SLOT', 0.7, 'signal'],
        [r4, this.fxThroughO, 'THROUGH THE O', 0.8, 'ink'],
        [r5, this.fxRecord, 'RECORD · 33⅓', 0.4, 'bone'],
        [w2, this.fxOpArt, '108 LINES', 1.0, 'ink'],
        [this.kickB, this.fxStrobe, 'STROBE · 1/32', 1.2, 'ink'],
        [w3, this.fxStrip, '35 MM · 24 FPS', 1.2, 'ink'],
        [e8(w3 + 0.28), this.fxCascade, 'CASCADE', 0.8, 'signal'],
        [this.zA, this.fxRing, '24 FRAMES', 0.9, 'ink'],
      ];
      this.initCounter();
    } else {
      this.tX0 = au.timeOfBeat(Math.round(au.beatAt(w3 + 0.45)));
      this.tX1 = end - 0.03;
      const a1 = next8(w0 - 0.02), a3 = e8(this.ct[this.ct.length - 1]! - 0.1), a4 = next8(a3), a5 = next8(a4), a6 = next8(a5), a7 = next8(a6);
      const b1 = next8(w2 + 0.1), c1 = next8(w3 + 0.1);
      D = [
        [start, this.fxSolid, '', 0, 'signal'],
        [w0, this.fxBars, 'CUT ×3', 1.2, 'ink'],
        [a1, this.fxKaleido, 'MIRROR ×8', 0.7, 'ink'],
        [this.ct[0]!, this.fxCards, 'FLIP', 0.8, 'bone'],
        [a3, this.fxGrid, 'GRID 7 × 3', 0.7, 'ink'],
        [a4, this.fxSpot, 'FOLLOW SPOT', 0.7, 'ink'],
        [a5, this.fxHalftone, 'HALFTONE · 65 LPI', 0.8, 'signal'],
        [a6, this.fxWave, 'WDTH 62 → 125', 0.7, 'signal'],
        [a7, this.fxTunnel, 'PULL', 0.6, 'ink'],
        [w2, this.fxSplit, 'SPLIT', 1.2, 'ink'],
        [b1, this.fxSunburst, 'SUNBURST', 0.9, 'signal'],
        [w3, this.fxCrop, 'CROP', 1.2, 'bone'],
        [c1, this.fxSheet, '2,160 FRAMES', 0.9, 'ink'],
        [this.tX0, this.fxIris, '', 0.6, 'ink'],
      ];
      await this.initSheet();
      this.initHalftone();
    }
    D.sort((p, q) => p[0] - q[0]);
    this.shots = D.map((d, i) => ({ t0: d[0], t1: i + 1 < D.length ? D[i + 1]![0] : end + 1, fx: d[1].bind(this), name: d[2], hit: d[3], field: d[4], age: 0, u: 0, dur: 0, i }));
  }

  // ------------------------------------------------------------------ type kit
  private lay(text: string, fam: string) {
    const k = fam + '|' + text;
    let l = this.lays.get(k);
    if (!l) { l = layout(text, fam, 100); this.lays.set(k, l); }
    return l;
  }
  private fit(text: string, wd: number, maxW: number, maxCap: number, cy = H / 2): WG {
    const fam = F.archivo(wd, 900), lay = this.lay(text, fam);
    const size = Math.min(maxW / (lay.width / 100), maxCap / this.CAP);
    const w = (lay.width * size) / 100, cap = size * this.CAP;
    return { fam, size, cap, w, x0: (W - w) / 2, base: cy + cap / 2, lay, text };
  }
  /** the first n glyphs of a word */
  private glyphs(c: CanvasRenderingContext2D, g: WG, n: number, fill: (j: number) => string, dx = 0, dy = 0) {
    c.font = font(g.fam, g.size);
    for (let j = 0; j < Math.min(n, g.lay.glyphs.length); j++) {
      const gl = g.lay.glyphs[j]!;
      c.fillStyle = fill(j);
      c.fillText(gl.ch, g.x0 + (gl.x * g.size) / 100 + dx, g.base + dy);
    }
  }
  private vis(st: number[], t: number) { let n = 0; for (const x of st) if (t >= x) n++; return n; }
  private cam(c: CanvasRenderingContext2D, z: number, r = 0, dx = 0, dy = 0, cx = W / 2, cy = H / 2) {
    c.translate(cx + dx, cy + dy); c.rotate(r); c.scale(z, z); c.translate(-cx, -cy);
  }
  /** a slow continuous move for every shot, so nothing ever stands still */
  private drift(c: CanvasRenderingContext2D, s: Sh, amt = 1) {
    const k = s.age / Math.max(0.2, s.dur);
    this.cam(c, 1 + 0.05 * amt * k, (s.i % 2 ? 1 : -1) * 0.012 * amt * k);
  }
  private kickPulse(t: number, hl = 0.07, from = -1e9) {
    let p = 0;
    for (const [k, s] of this.kicks) if (k >= from) p = Math.max(p, s * pulse(t, k, hl));
    return p;
  }
  private fill(c: CanvasRenderingContext2D, col: Col) { c.fillStyle = rgba(col); c.fillRect(-W, -H, 3 * W, 3 * H); }
  private adv(ch: string, fam: string, size: number) {
    const k = fam + '|' + ch;
    let v = this.cw.get(k);
    if (v === undefined) { v = measure(ch, fam, 100) / 100; this.cw.set(k, v); }
    return v * size;
  }

  // ------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    const { renderer } = this.ctx;
    this.U.clear();
    const c = this.U.ctx;
    c.textBaseline = 'alphabetic';
    const G = this.glow; G.clear(); this.ringLB.clear();
    this.G = G;
    const s = this.shotAt(t);
    c.save();
    s.fx(c, t, s);
    c.restore();
    this.label(c, t, s);
    // an impact frame on the biggest cuts
    if (s.hit >= 1 && t - s.t0 < 1 / 60 && !(this.n === 2 && s.i <= 1)) { c.fillStyle = rgba('bone', 0.5); c.fillRect(0, 0, W, H); }
    this.U.upload();
    this.comp.render(renderer, out);
    if (this.ringLB.count) this.ringLB.render(renderer, out);
    if (G.count) G.render(renderer, out);
    return this.post(f, s);
  }
  G!: LineBatch;
  private shotAt(t: number): Sh {
    let s = this.shots[0]!;
    for (const x of this.shots) if (t >= x.t0 - 1e-6) s = x;
    s.age = t - s.t0; s.dur = s.t1 - s.t0; s.u = clamp(s.age / s.dur);
    return s;
  }
  private label(c: CanvasRenderingContext2D, t: number, s: Sh) {
    if (!s.name || t < this.w[0]! || t >= this.tX0) return;
    const onDark = s.field === 'ink';
    c.save();
    c.font = font(this.mono, 13); c.letterSpacing = '3px';
    const txt = `FX ${String(s.i).padStart(2, '0')} · ${s.name}`;
    const tw = measure(txt, this.mono, 13, 3);
    const k = ease.outExpo(clamp(s.age / 0.08));
    c.fillStyle = rgba(onDark ? 'signal' : 'ink'); c.fillRect(88, 62, (tw + 20) * k, 30);
    c.fillStyle = rgba(onDark ? 'ink' : s.field === 'signal' ? 'signal' : 'bone');
    if (k > 0.6) c.fillText(txt, 98, 83);
    c.textAlign = 'right';
    c.fillStyle = rgba(onDark ? 'bone' : 'ink', 0.6);
    c.fillText(`${this.n === 1 ? 'HOOK 1 / 2' : 'HOOK 2 / 2'} · FRAMES ${String(frames(t)).padStart(4, '0')}`, W - 96, 83);
    c.restore();
  }

  // ================================================================== HOOK 1
  private fxBreath(c: CanvasRenderingContext2D, t: number, s: Sh) {
    const w0 = this.w[0]!;
    this.fill(c, 'ink');
    const k = prog(t, this.T0 + 0.1, w0, ease.inQuad);
    const cx = CARET_H5.x, cy = CARET_H5.y;
    if (k > 0) {
      c.save(); c.lineCap = 'round';
      for (let i = 0; i < 110; i++) {
        const sp = 0.6 + 1.7 * hash(i, 2);
        const ph = (hash(i, 1) + (t - this.T0) * sp * (0.4 + 2.2 * k)) % 1;
        const a = hash(i, 3) * TAU;
        const r1 = lerp(1250, 26, Math.pow(ph, 1.7)), r0 = r1 + (30 + 260 * k) * (1 - 0.6 * ph);
        const al = (0.03 + 0.4 * k) * smoothstep(0, 0.25, ph);
        c.strokeStyle = ph > 0.82 ? rgba('signal', al) : rgba('bone', al * 0.8);
        c.lineWidth = 1 + 1.6 * k * ph;
        c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
      }
      c.restore();
    }
    // the caret: H5, blinking; it inhales and flickers in the last half-beat
    const inh = prog(t, w0 - 0.24, w0, ease.inQuad);
    const tq = frameIdx(t) / 60;
    const on = t < this.T0 + 0.09 || ((((this.T0 - tq) / BEAT) % 1) + 1) % 1 < 0.5 || (inh > 0 && Math.floor(t * 32) % 2 === 0);
    if (!on) return;
    const hh = CARET_H5.h * (1 + 0.3 * inh), cw = CARET_H5.w + 4 * inh;
    c.fillStyle = rgba('signal'); c.fillRect(cx - cw / 2, cy - hh / 2, cw, hh);
    const gI = inh * (1 + inh);
    if (gI > 0.01) this.G.seg2(cx, cy - hh / 2 + cw / 2, cx, cy + hh / 2 - cw / 2, cw, [LIN.signal[0] * 0.9 * gI, LIN.signal[1] * 0.9 * gI, LIN.signal[2] * 0.9 * gI], 1);
    void s;
  }

  private fxEcho(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const g = this.fit('ONE', 125, W * 0.78, H * 0.54);
    const ms = lerp(0.18, 1, ease.outExpo(clamp(s.age / 0.2)));
    c.save();
    for (let i = 9; i >= 0; i--) {
      const sc = ms * Math.pow(1.36, i + ((s.age * 6) % 1));
      if (sc > 8) continue;
      c.save(); this.cam(c, sc); c.font = font(g.fam, g.size);
      c.strokeStyle = i < 2 ? rgba('signal', 0.95) : rgba('bone', 0.55 * (1 - i / 10)); c.lineWidth = 2.4 / sc;
      c.strokeText('ONE', g.x0, g.base); c.restore();
    }
    this.cam(c, ms * (1 + 0.03 * s.u));
    c.font = font(g.fam, g.size); c.fillStyle = heatCss(s.age, 'ink'); c.fillText('ONE', g.x0, g.base);
    c.restore();
    if (s.age < 0.5) sparkParticles(this.G, t, (tb) => (tb >= s.t0 && tb < s.t0 + 0.05 ? { x: 960, y: 540 } : null), { rate: 1200, life: 0.5, speed: 1200, gravity: 600, intensity: 1.1, seed: 4, width: 2 });
  }

  private fxSlices(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    c.save(); this.drift(c, s, 0.6);
    const g = this.fit('ONE', 125, W * 1.02, H * 0.8);
    const sy = (H * 0.8) / g.cap;
    const N = 14, sh = H / N;
    c.font = font(g.fam, g.size);
    for (let k = 0; k < N; k++) {
      const dir = k % 2 ? 1 : -1;
      const m = ease.outExpo(prog(s.age, 0.004 * k, 0.1 + 0.004 * k));
      let dx = dir * (1 - m) * W * 1.1;
      dx += dir * 60 * this.kickPulse(t, 0.04, s.t0 + 0.02) * (0.5 + hash(k, 3));
      c.save();
      c.beginPath(); c.rect(-20, k * sh + 1.5, W + 40, sh - 3); c.clip();
      c.translate(g.x0 + dx, H / 2 + (g.cap * sy) / 2); c.scale(1, sy);
      c.fillStyle = k % 5 === 2 ? rgba('signal') : heatCss(s.age + 0.2, 'ink');
      c.fillText('ONE', 0, 0);
      c.restore();
    }
    c.restore();
  }

  private fxStretch(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'signal');
    const fam = F.archivo(62, 900), lay = this.lay('PROMPT,', fam);
    const sx = (W * 0.98) / lay.width, sy = (H * 1.04) / (100 * this.CAP);
    const n = this.vis(this.ct, t);
    c.font = font(fam, 100);
    for (let j = 0; j < n; j++) {
      const gl = lay.glyphs[j]!, age = t - this.ct[j]!;
      const drop = (1 - ease.outExpo(clamp(age / 0.06))) * H;
      c.save();
      c.translate(W * 0.01 + gl.x * sx, H * 0.98 - drop); c.scale(sx, sy);
      c.fillStyle = inkHotO(age); c.fillText(gl.ch, 0, 0);
      c.restore();
    }
    // the typing head
    const x = W * 0.01 + (n < lay.glyphs.length ? lay.glyphs[n]!.x : lay.width) * sx;
    c.fillStyle = rgba('ink'); c.fillRect(x + 6, 0, 14, H);
  }

  // ---- the drop: the 24 frames
  private blockA(t: number) {
    const w0 = this.w[0]!;
    const g1 = this.fit('ONE', 125, W * 0.84, 200), fam2 = F.archivo(100, 900), l2 = this.lay('PROMPT,', fam2);
    let cap = 200;
    const w2 = (l2.width * cap) / this.CAP / 100;
    if (w2 > W * 0.84) cap *= (W * 0.84) / w2;
    const size = cap / this.CAP, gap = cap * 0.34;
    const x0 = (W - Math.max((this.lay('ONE', g1.fam).width * size) / 100, (l2.width * size) / 100)) / 2;
    return [
      { fam: g1.fam, text: 'ONE', st: [w0, w0 + 0.02, w0 + 0.04], size, x0, base: H / 2 - gap / 2 },
      { fam: fam2, text: 'PROMPT,', st: this.ct, size, x0, base: H / 2 + gap / 2 + cap },
    ].map((l) => ({ ...l, n: this.vis(l.st, t) }));
  }
  private fxExtrude(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const L = this.blockA(t);
    const k = ease.outExpo(clamp(s.age / 0.12));
    const V = { x: lerp(960, 1640, k) - 120 * s.u, y: lerp(540, 180, k) + 70 * s.u };
    const D = 1.05 * k * (1 + 0.18 * this.kickPulse(t, 0.07, s.t0 + 0.05));
    const gr = c.createRadialGradient(V.x, V.y, 0, V.x, V.y, 1100);
    gr.addColorStop(0, css(INK2, 0.9)); gr.addColorStop(1, css(INK2, 0));
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    const heat = Math.exp(-s.age / 0.16);
    c.lineWidth = 1;
    for (let q = 1; q < NF; q++) {
      const sc = 1 / (1 + (D * q) / NF);
      c.strokeStyle = rgba('bone', 0.12 * (1 - q / NF) + 0.03);
      c.strokeRect(V.x * (1 - sc), V.y * (1 - sc), W * sc, H * sc);
    }
    c.strokeStyle = css(mix3(BONE, SIG, heat), 0.14 + 0.4 * heat);
    for (const [px, py] of [[0, 0], [W, 0], [W, H], [0, H]] as const) { c.beginPath(); c.moveTo(V.x, V.y); c.lineTo(px, py); c.stroke(); }
    const draw = (col: string, stroke: string | null, lw: number) => {
      for (const l of L) {
        const lay = this.lay(l.text, l.fam);
        c.font = font(l.fam, l.size);
        for (let j = 0; j < l.n; j++) {
          const gl = lay.glyphs[j]!;
          const x = l.x0 + (gl.x * l.size) / 100;
          c.fillStyle = col; c.fillText(gl.ch, x, l.base);
          if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.strokeText(gl.ch, x, l.base); }
        }
      }
    };
    for (let q = NF - 1; q >= 1; q--) {
      const sc = 1 / (1 + (D * q) / NF), u = q / (NF - 1);
      let fl = 0;
      for (const [kt, ks] of this.kicks) if (kt >= s.t0 - 0.01) fl = Math.max(fl, ks * pulse(t, kt + q * 0.011, 0.045));
      let col = u < 0.12 ? mix3(mix3(SIG, EMB, 0.35), SIG, u / 0.12) : u < 0.6 ? mix3(SIG, BLD, (u - 0.12) / 0.48) : mix3(BLD, INK2, (u - 0.6) / 0.4);
      col = mix3(col, mix3(EMB, WHITE, fl * fl), Math.min(1, fl) * 0.8);
      c.save(); c.translate(V.x, V.y); c.scale(sc, sc); c.translate(-V.x, -V.y);
      draw(css(col), q % 3 === 0 ? rgba('ink', 0.6) : null, 1.4 / sc);
      c.restore();
    }
    for (const l of L) {
      const lay = this.lay(l.text, l.fam);
      c.font = font(l.fam, l.size);
      for (let j = 0; j < l.n; j++) {
        const gl = lay.glyphs[j]!;
        c.fillStyle = heatCss(Math.min(t - l.st[j]!, s.age), 'ink');
        c.fillText(gl.ch, l.x0 + (gl.x * l.size) / 100, l.base);
      }
    }
    // the caret flew to the vanishing point
    c.fillStyle = rgba('signal'); c.fillRect(V.x - 6, V.y - 24, 12, 48);
    this.G.seg2(V.x, V.y - 18, V.x, V.y + 18, 12, [LIN.signal[0] * 1.2, LIN.signal[1] * 1.2, LIN.signal[2] * 1.2], 1);
    if (s.age < 0.6) sparkParticles(this.G, t, (tb) => (tb >= s.t0 && tb < s.t0 + 0.06 ? { x: 1640, y: 180 } : null), { rate: 1600, life: 0.55, speed: 1400, gravity: 700, intensity: 1.3, seed: 5, width: 2.3 });
  }

  private fxRows(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const RW = 7, rh = H / RW;
    const fam = F.archivo(100, 900), unit = 'PROMPT, ', l = this.lay(unit, fam);
    const size = (0.74 * rh) / this.CAP, U = (l.width * size) / 100;
    c.save(); this.drift(c, s, 0.5);
    for (let r = 0; r < RW; r++) {
      const dir = r % 2 ? 1 : -1, mid = r === 3;
      const enter = ease.outExpo(prog(s.age, Math.abs(r - 3) * 0.012, 0.08 + Math.abs(r - 3) * 0.012));
      const off = dir * (mid ? 300 : 1500 + 300 * Math.abs(r - 3)) * s.age + dir * (1 - enter) * W;
      const y0 = r * rh, base = y0 + rh / 2 + (size * this.CAP) / 2;
      c.save(); c.beginPath(); c.rect(-40, y0 + 2, W + 80, rh - 4); c.clip();
      if (mid) { c.fillStyle = rgba('bone'); c.fillRect(-40, y0, W + 80, rh); }
      c.font = font(fam, size);
      const xc = (W - (this.lay('PROMPT,', fam).width * size) / 100) / 2;
      let x = xc + (((off % U) + U) % U) - U * Math.ceil((xc + U) / U);
      for (; x < W + U; x += U) {
        if (mid) { c.fillStyle = rgba('ink'); c.fillText(unit, x, base); }
        else if (r % 2) { c.fillStyle = rgba('signal'); c.fillText(unit, x, base); }
        else { c.strokeStyle = rgba('bone', 0.8); c.lineWidth = 2; c.strokeText(unit, x, base); }
      }
      c.restore();
    }
    c.restore();
  }

  private fxSmear(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'bone');
    const g = this.fit('PROMPT,', 100, W * 0.9, H * 0.5, H * 0.42);
    const A = this.A, B = this.B;
    A.clear(); B.clear();
    for (const [L, col] of [[A, rgba('ink')], [B, rgba('signal')]] as const) {
      L.ctx.font = font(g.fam, g.size); L.ctx.fillStyle = col; L.ctx.textBaseline = 'alphabetic';
      L.ctx.fillText('PROMPT,', g.x0, g.base);
    }
    const k = ease.inOutCubic(s.u);
    const ys = g.base - 2 - k * g.cap * 0.42;
    const jit = (hash(Math.floor(t * 40), 3) - 0.5) * 14;
    c.save(); this.drift(c, s, 0.7);
    // the smear: one row of the type, stretched down to the bottom of the frame
    c.globalAlpha = 0.85;
    c.drawImage(B.canvas, 0, ys * SCALE, W * SCALE, 2 * SCALE, 12 + jit, ys, W, H - ys);
    c.globalAlpha = 1;
    c.drawImage(A.canvas, 0, ys * SCALE, W * SCALE, 2 * SCALE, 0, ys, W, H - ys);
    // the type above the scan
    c.save(); c.beginPath(); c.rect(0, 0, W, ys); c.clip();
    c.drawImage(B.canvas, 12 + jit, 0, W, H);
    c.drawImage(A.canvas, 0, 0, W, H);
    c.restore();
    // bands knocked sideways on the hats
    for (const [ht, hs] of this.hats) {
      const a = t - ht;
      if (a < 0 || a > 0.08 || ht < s.t0) continue;
      const by = g.base - g.cap * hash(ht, 1), bh = 20 + 60 * hash(ht, 2);
      c.save(); c.beginPath(); c.rect(0, by, W, bh); c.clip();
      c.fillStyle = rgba('bone'); c.fillRect(0, by, W, bh);
      c.drawImage(A.canvas, (hash(ht, 3) - 0.5) * 160 * hs, 0, W, H);
      c.restore();
    }
    c.fillStyle = rgba('signal'); c.fillRect(0, ys - 1, W, 3);
    c.restore();
  }

  private fxSlot(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'signal');
    const g = this.fit('PROMPT,', 100, W * 0.88, H * 0.46);
    const AL = 'ONEPRMTFIL!';
    const rowH = g.cap * 1.35;
    c.save(); this.drift(c, s, 0.5);
    c.font = font(g.fam, g.size);
    for (let j = 0; j < g.lay.glyphs.length; j++) {
      const gl = g.lay.glyphs[j]!;
      const x = g.x0 + (gl.x * g.size) / 100, wj = (gl.w * g.size) / 100;
      const ts = s.t0 + 0.035 + j * 0.022;
      c.save();
      c.beginPath(); c.rect(x - 10, g.base - g.cap - 30, wj + 20, g.cap + 60); c.clip();
      c.fillStyle = rgba('ink', 0.12); c.fillRect(x - 10, g.base - g.cap - 30, wj + 20, g.cap + 60);
      if (t < ts) {
        const off = (ts - t) * 6000;
        for (let m = -1; m <= 2; m++) {
          const ch = AL[Math.abs(Math.floor(off / rowH) + m + j * 3) % AL.length]!;
          c.fillStyle = rgba('bone', 0.55);
          c.fillText(ch, x, g.base + ((off % rowH) - m * rowH));
        }
      } else {
        const a = t - ts;
        const settle = Math.exp(-a * 22) * Math.cos(a * 60) * 40;
        c.fillStyle = inkHotO(a);
        c.fillText(gl.ch, x, g.base + settle);
      }
      c.restore();
      c.fillStyle = rgba('ink'); c.fillRect(x - 12, g.base - g.cap - 32, 2, g.cap + 64);
    }
    c.restore();
  }

  private initCounter() {
    const S = 1000, cv = document.createElement('canvas');
    cv.width = 1400; cv.height = 1300;
    const gg = cv.getContext('2d', { willReadFrequently: true })!;
    gg.font = font(F.archivo(100, 900), S); gg.fillStyle = '#fff';
    gg.fillText('O', 100, 1100);
    const img = gg.getImageData(0, 0, cv.width, cv.height).data;
    const Aa = (x: number, y: number) => img[(y * cv.width + x) * 4 + 3]!;
    const midY = Math.round(1100 - (this.CAP * S) / 2);
    let x = 0;
    while (x < cv.width && Aa(x, midY) < 128) x++;
    while (x < cv.width && Aa(x, midY) >= 128) x++;
    const cl = x;
    while (x < cv.width && Aa(x, midY) < 128) x++;
    const cr = x, midX = Math.round((cl + cr) / 2);
    let y = 0;
    while (y < cv.height && Aa(midX, y) < 128) y++;
    while (y < cv.height && Aa(midX, y) >= 128) y++;
    const ctp = y;
    while (y < cv.height && Aa(midX, y) < 128) y++;
    this.counter = { x0: (cl - 100) / S, x1: (cr - 100) / S, y1: (1100 - ctp) / S, y0: (1100 - y) / S };
  }
  private fxThroughO(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const g = this.fit('PROMPT,', 100, W * 0.9, H * 0.5);
    const o = g.lay.glyphs[2]!, cb = this.counter;
    const ox = g.x0 + (o.x * g.size) / 100;
    const ccx = ox + ((cb.x0 + cb.x1) / 2) * g.size, ccy = g.base - ((cb.y0 + cb.y1) / 2) * g.size;
    const rx = ((cb.x1 - cb.x0) / 2) * g.size * 0.96, ry = ((cb.y1 - cb.y0) / 2) * g.size * 0.96;
    const z = Math.exp(Math.log(60) * ease.inCubic(s.u));
    c.save();
    // zoom about the counter while it glides to the frame's centre
    const e = ease.inOutCubic(Math.min(1, s.u * 1.4));
    c.translate(lerp(ccx, W / 2, e), lerp(ccy, H / 2, e)); c.scale(z, z); c.translate(-ccx, -ccy);
    c.font = font(g.fam, g.size);
    c.fillStyle = heatCss(s.age + 0.3, 'ink'); c.fillText('PROMPT,', g.x0, g.base);
    c.beginPath(); c.ellipse(ccx, ccy, rx, ry, 0, 0, TAU); c.clip();
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.recordBody(c, t, 0.6 + 0.4 * s.u);
    c.restore();
  }
  private fxRecord(c: CanvasRenderingContext2D, t: number, s: Sh) { this.recordBody(c, t, 1); void s; }
  private recordBody(c: CanvasRenderingContext2D, t: number, sc: number) {
    this.fill(c, 'bone');
    let rot = t * 1.6;
    for (const [k, st] of this.kicks) if (k > this.w[1]!) rot += 0.3 * st * ease.outExpo(prog(t, k, k + 0.2));
    c.save(); c.translate(W / 2, H / 2); c.scale(sc, sc);
    c.strokeStyle = rgba('ink', 0.15); c.lineWidth = 1;
    for (let r = 340; r < 1150; r += 12) { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); }
    const band = (r0: number, r1: number, col: string) => { c.fillStyle = col; c.beginPath(); c.arc(0, 0, r1, 0, TAU); c.arc(0, 0, r0, 0, TAU, true); c.fill(); };
    band(560, 640, rgba('ink'));
    this.ringImg(c, 'ONE PROMPT · ONE FILM · ', F.archivo(125, 900), 46, 400, rot, rgba('ink'));
    this.ringImg(c, 'PROMPT, PROMPT, PROMPT, ', F.archivo(100, 900), 58, 585, -rot * 1.3, rgba('bone'));
    this.ringImg(c, 'SIDE A · 122 BPM · 24 FPS · ONE LINE IN · ', this.monoR, 15, 700, rot * 2, rgba('ink', 0.7));
    this.ringImg(c, 'ONE PROMPT, ONE FILM! ', F.archivo(125, 900), 96, 820, -rot * 0.6, rgba('ink', 0.9));
    c.fillStyle = rgba('signal'); c.beginPath(); c.arc(0, 0, 330, 0, TAU); c.fill();
    c.fillStyle = rgba('ink'); c.beginPath(); c.arc(0, 0, 10, 0, TAU); c.fill();
    const g = this.fit('PROMPT,', 100, 520, 200, 0);
    c.font = font(g.fam, g.size); c.fillStyle = rgba('ink');
    c.fillText('PROMPT,', -g.w / 2, g.cap / 2);
    c.restore();
  }
  private ringImg(c: CanvasRenderingContext2D, s: string, fam: string, size: number, r: number, rot: number, fill: string) {
    const key = `${s}|${fam}|${size}|${r}|${fill}`, half = r + size * 1.5;
    let cv = this.rings.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = cv.height = Math.ceil(2 * half * SCALE);
      const g = scaleContext2D(cv.getContext('2d')!, SCALE);
      g.translate(half, half);
      const chars = Array.from(s);
      let tw = 0;
      for (const ch of chars) tw += this.adv(ch, fam, size);
      const reps = Math.max(1, Math.floor((TAU * r) / tw)), extra = (TAU * r - reps * tw) / (reps * chars.length);
      g.font = font(fam, size); g.fillStyle = fill;
      let a = 0;
      for (let q = 0; q < reps; q++) for (const ch of chars) {
        const w = this.adv(ch, fam, size) + extra;
        if (ch !== ' ') { g.save(); g.rotate(a + w / 2 / r); g.translate(0, -r); g.fillText(ch, -w / 2 + extra / 2, 0); g.restore(); }
        a += w / r;
      }
      this.rings.set(key, cv);
    }
    c.save(); c.rotate(rot); c.drawImage(cv, -half, -half, 2 * half, 2 * half); c.restore();
  }

  private fxOpArt(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const g = this.fit('ONE', 125, W * 0.86, H * 0.62);
    const P = 10;
    // the ripples live now: the word's own, and one per kick
    const act: [number, number, number, number][] = [[s.age * 1700, Math.exp(-s.age * 3) * 40, 200, 0.04]];
    for (const [k, st] of this.kicks) { const a = t - k; if (a >= 0 && a <= 0.6 && k >= s.t0 - 0.05) act.push([a * 1500, st * Math.exp(-a * 3.5) * 30, 170, 0.042]); }
    const rip = (x: number, y: number) => {
      const rr = Math.hypot(x - 960, y - 540);
      let d = 0;
      for (const [fr, amp, wd, fq] of act) { const q = (rr - fr) / wd; if (q > -3 && q < 3) d += amp * Math.exp(-q * q) * Math.sin((rr - fr) * fq); }
      return d;
    };
    const th = lerp(3.4, 2.6, clamp(s.age / 0.2));
    c.fillStyle = rgba('signal');
    for (let y = P / 2; y < H; y += P) {
      c.beginPath();
      for (let x = -10; x <= W + 10; x += 24) { const yy = y + rip(x, y); x < 0 ? c.moveTo(x, yy - th / 2) : c.lineTo(x, yy - th / 2); }
      for (let x = W + 10; x >= -10; x -= 24) { const yy = y + rip(x, y); c.lineTo(x, yy + th / 2); }
      c.closePath(); c.fill();
    }
    // inside the letters: heavy vertical bone lines
    const A = this.A; A.clear();
    const a = A.ctx;
    const heat = Math.exp(-s.age / 0.1);
    a.fillStyle = css(mix3(BONE, mix3(EMB, WHITE, heat), heat));
    const flow = s.age * 90;
    for (let x = g.x0 - 20 - (flow % P); x < g.x0 + g.w + 20; x += P) a.fillRect(x, g.base - g.cap - 20, 6, g.cap + 40);
    a.globalCompositeOperation = 'destination-in';
    a.font = font(g.fam, g.size); a.fillStyle = '#fff'; a.fillText('ONE', g.x0, g.base);
    a.globalCompositeOperation = 'source-over';
    c.save(); this.drift(c, s, 0.4);
    c.fillStyle = rgba('ink'); c.font = font(g.fam, g.size); c.fillText('ONE', g.x0, g.base);
    c.drawImage(A.canvas, 0, 0, W, H);
    c.restore();
  }

  private fxStrobe(c: CanvasRenderingContext2D, t: number, s: Sh) {
    const step = Math.floor(s.age / 0.041) % 4;
    const F0: Col[] = ['bone', 'ink', 'signal', 'ink'], T0: Col[] = ['ink', 'bone', 'ink', 'signal'];
    this.fill(c, F0[step]!);
    const g = this.fit('ONE', 125, W * 0.96, H * 0.78);
    const z = 1 + 0.38 * (1 - ease.outExpo(clamp(s.age / 0.12)));
    const r = 0.09 * (1 - ease.outExpo(clamp(s.age / 0.16)));
    c.save(); this.cam(c, z, r);
    c.font = font(g.fam, g.size);
    for (let q = 3; q >= 1; q--) { c.save(); this.cam(c, 1 + q * 0.04 * (1 - s.u)); c.fillStyle = rgba(T0[step]!, 0.18); c.fillText('ONE', g.x0, g.base); c.restore(); }
    c.fillStyle = rgba(T0[step]!); c.fillText('ONE', g.x0, g.base);
    c.restore();
    if (s.age < 0.5) sparkParticles(this.G, t, (tb) => (tb >= s.t0 && tb < s.t0 + 0.05 ? { x: 960, y: 540 } : null), { rate: 1800, life: 0.5, speed: 1600, gravity: 700, intensity: 1.3, seed: 8, width: 2.4 });
  }

  private fxStrip(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const n = this.vis(this.cf, t);
    const word = 'FILM!'.slice(0, Math.max(1, n));
    const strip = (cx: number, w: number, pitchH: number, dir: number, speedMul: number, alpha: number, big: boolean) => {
      const band = w * 0.07, imgW = w - 2 * band, imgH = pitchH * 0.88;
      const n16 = Math.floor(s.age / 0.123), f16 = (s.age % 0.123) / 0.123;
      const off = dir * pitchH * speedMul * (n16 + ease.outCubic(clamp(f16 / 0.4)));
      c.save(); c.globalAlpha = alpha;
      c.fillStyle = rgba('ink2'); c.fillRect(cx - w / 2, -10, w, H + 20);
      const y0 = ((off % pitchH) + pitchH) % pitchH - pitchH;
      for (let y = y0; y < H + pitchH; y += pitchH) {
        c.fillStyle = rgba('bone'); c.fillRect(cx - imgW / 2, y + (pitchH - imgH) / 2, imgW, imgH);
        const gw = this.fit(big ? word : 'FILM!', 125, imgW * 0.86, imgH * 0.56, y + pitchH / 2);
        c.font = font(gw.fam, gw.size); c.fillStyle = big ? inkHot(t - this.cf[Math.max(0, n - 1)]!) : rgba('ink');
        c.fillText(gw.text, cx - gw.w / 2, gw.base);
        c.fillStyle = rgba('ink');
        for (let q = 0; q < 4; q++) {
          const hy = y + (q + 0.5) * (pitchH / 4) - pitchH * 0.04;
          c.fillStyle = rgba('bone', 0.9);
          c.fillRect(cx - w / 2 + band * 0.25, hy, band * 0.5, pitchH * 0.08);
          c.fillRect(cx + w / 2 - band * 0.75, hy, band * 0.5, pitchH * 0.08);
        }
        c.font = font(this.monoR, big ? 14 : 9); c.fillStyle = rgba('ink', 0.7);
        const fr = frames(t) + Math.round((y - y0) / pitchH);
        c.fillText(`F ${String(fr).padStart(4, '0')}`, cx - imgW / 2 + 10, y + (pitchH - imgH) / 2 + (big ? 22 : 12));
      }
      c.restore();
    };
    c.save(); this.drift(c, s, 0.5);
    strip(170, 300, 190, -1, 2.2, 0.55, false);
    strip(W - 170, 300, 190, -1, 2.6, 0.55, false);
    strip(W / 2, 1180, 620, 1, 1, 1, true);
    c.restore();
  }

  private fxCascade(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'signal');
    const q = 0.6, z = s.age * 3.4;
    const FLD: Col[] = ['signal', 'ink', 'bone'];
    const fam = F.archivo(125, 900), l = this.lay('FILM!', fam);
    for (let L = Math.floor(z) - 1; L < Math.floor(z) + 8; L++) {
      const sc = Math.pow(q, L - z);
      if (sc > 3.2) continue;
      if (sc * W < 24) break;
      const fw = W * sc, fh = H * sc, x0 = W / 2 - fw / 2, y0 = H / 2 - fh / 2;
      const fld = FLD[((L % 3) + 3) % 3]!, ink: Col = fld === 'ink' ? 'bone' : 'ink';
      c.fillStyle = rgba(fld); c.fillRect(x0, y0, fw, fh);
      c.strokeStyle = rgba(ink, 0.6); c.lineWidth = Math.max(1, 3 * sc); c.strokeRect(x0 + 10 * sc, y0 + 10 * sc, fw - 20 * sc, fh - 20 * sc);
      // FILM! in the band below the next frame in
      const band = (fh * (1 - q)) / 2, cap = band * 0.66, size = cap / this.CAP;
      const tw = (l.width * size) / 100;
      c.font = font(fam, size); c.fillStyle = rgba(ink);
      c.fillText('FILM!', W / 2 - tw / 2, y0 + fh - band / 2 + cap / 2);
      c.font = font(this.monoR, Math.max(6, 16 * sc)); c.fillStyle = rgba(ink, 0.7);
      c.fillText(`F ${String(frames(t) + L).padStart(4, '0')}`, x0 + 24 * sc, y0 + 38 * sc);
    }
  }

  private fxRing(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const zA = this.zA;
    const g = this.fit('FILM!', 125, 400, 120);
    const R = 420, sc = (0.9 * TAU * R) / NF / g.w;
    const spin = -2 * ease.outCubic(prog(t, zA + 0.1, this.tX0 + 0.12));
    const fade = 1 - prog(t, this.tX0 + 0.1, this.tX1 - 0.05, ease.inQuad);
    if (fade > 0.002) {
      c.font = font(g.fam, g.size);
      for (let k = 0; k < NF; k++) {
        const ta = zA + k * 0.004;
        if (t < ta) continue;
        const p = ease.outExpo(clamp((t - ta) / 0.16));
        const a = (k / NF) * TAU + spin;
        c.save();
        c.globalAlpha = fade;
        c.translate(W / 2, H / 2); c.rotate(a); c.translate(0, -R * lerp(0.15, 1, p));
        c.scale(sc * lerp(3, 1, p), sc * lerp(3, 1, p));
        c.fillStyle = k % 2 ? rgba('signal') : heatCss(t - ta, 'ink');
        c.fillText('FILM!', -g.w / 2, g.cap / 2);
        c.restore();
      }
      c.save(); c.globalAlpha = fade * smoothstep(zA + 0.1, zA + 0.2, t);
      c.font = font(this.mono, 16); c.letterSpacing = '4px'; c.textAlign = 'center';
      c.fillStyle = rgba('bone', 0.75);
      c.fillText('24 FRAMES · ONE SECOND · ONE FILM', W / 2, H / 2 + R + 90);
      c.restore();
    }
    if (t >= this.tX0) this.drawRing(this.G, t);
    void s;
  }
  private ringT(a: number) { return lerp(this.tX0, this.tX1, lerp(0.22, 0.7, a)); }
  private drawRing(G: LineBatch, t: number) {
    const ex = prog(t, this.tX0, this.tX1);
    const R = RING_H6.r, C = { x: RING_H6.x, y: RING_H6.y };
    const u0 = 0.22, u1 = 0.7;
    const drawn = clamp((ex - u0) / (u1 - u0));
    const head = 1 - prog(ex, u1, u1 + 0.13);
    const N = 240, sig = LIN.signal, RB = this.ringLB;
    const P = (a: number) => ({ x: C.x + R * Math.sin(a * TAU), y: C.y - R * Math.cos(a * TAU) });
    for (let i = 0; i < N * drawn; i++) {
      const a0 = i / N, a1 = Math.min(drawn, (i + 1) / N);
      const age = t - this.ringT(a1);
      const tip = Math.exp(-age / 0.05) * head, wake = Math.exp(-age / 0.32);
      const I = 1.3 + 2.2 * wake * head + 5 * tip;
      const col: RGB = [sig[0] * I + tip * 1.5, sig[1] * I + tip * 1.1, sig[2] * I + tip * 0.8];
      const Ap = P(a0), Bp = P(a1);
      RB.seg2(Ap.x, Ap.y, Bp.x, Bp.y, 6 * (1 + 1.4 * tip), col, 1);
    }
    let px: number, py: number;
    if (ex < u0) { const k = ease.inOutCubic(ex / u0); px = C.x; py = lerp(C.y, C.y - R, k); }
    else { const p = P(drawn); px = p.x; py = p.y; }
    if (head > 0.01) {
      sparkHead(G, px, py, t, 0.9 * head, 1.2 * head);
      sparkParticles(G, t, (tb) => {
        const e = prog(tb, this.tX0, this.tX1);
        if (e < u0 || e > u1) return null;
        return P((e - u0) / (u1 - u0));
      }, { rate: 260, life: 0.3, speed: 260, gravity: 600, intensity: 0.9 * head, seed: 17 });
    }
  }

  // ================================================================== HOOK 2
  private fxSolid(c: CanvasRenderingContext2D) { this.fill(c, 'signal'); }

  private fxBars(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'signal');
    const ang = -0.42, ca = Math.cos(ang), sa = Math.sin(ang);
    const band = (o: number, w: number) => {
      const nx = -sa, ny = ca;
      const pts: [number, number][] = [[-2000, -w / 2], [2000, -w / 2], [2000, w / 2], [-2000, w / 2]];
      return pts.map(([u, v]) => [960 + u * ca + (v + o) * nx, 540 + u * sa + (v + o) * ny] as [number, number]);
    };
    const bands = [-620, 0, 620].map((o, i) => band(o, 720 * ease.outExpo(prog(s.age, i * 0.025, i * 0.025 + 0.12))));
    c.save();
    c.beginPath();
    for (const b of bands) { b.forEach(([x, y], q) => (q ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
    c.clip();
    this.fill(c, 'ink');
    const g = this.fit('ONE', 125, W * 0.9, H * 0.66);
    const z = 1 + 0.16 * (1 - ease.outExpo(clamp(s.age / 0.16)));
    c.save(); this.cam(c, z * (1 + 0.03 * s.u));
    c.font = font(g.fam, g.size); c.fillStyle = heatCss(s.age, 'ink'); c.fillText('ONE', g.x0, g.base);
    c.restore();
    c.restore();
    c.strokeStyle = rgba('bone'); c.lineWidth = 3;
    for (const b of bands) { c.beginPath(); b.forEach(([x, y], q) => (q ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke(); }
    void t;
  }

  private fxKaleido(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const A = this.A; A.clear();
    const a = A.ctx;
    const g = this.fit('ONE', 125, 900, 300);
    a.save(); a.translate(1300, 380); a.rotate(t * 1.2); a.translate(-960, -540);
    a.font = font(g.fam, g.size); a.fillStyle = rgba('bone'); a.fillText('ONE', g.x0, g.base);
    a.restore();
    a.fillStyle = rgba('signal'); a.save(); a.translate(1150, 700); a.rotate(-t * 2); a.fillRect(-400, -30, 800, 60); a.restore();
    a.strokeStyle = rgba('signal'); a.lineWidth = 10; a.beginPath(); a.arc(1500 + 80 * Math.sin(t * 3), 560, 160, 0, TAU); a.stroke();
    const spin = s.age * 2.2 + 0.4 * this.kickPulse(t, 0.08, s.t0);
    for (let i = 0; i < 8; i++) {
      c.save(); c.translate(960, 540); c.rotate(i * (TAU / 8) + spin); if (i % 2) c.scale(1, -1);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(1400, 0); c.lineTo(1400 * Math.cos(TAU / 8), 1400 * Math.sin(TAU / 8)); c.closePath(); c.clip();
      c.drawImage(A.canvas, -960, -540, W, H);
      c.restore();
    }
    const gm = this.fit('ONE', 125, W * 0.5, H * 0.3);
    const z = 1 + 0.2 * (1 - ease.outExpo(clamp(s.age / 0.1)));
    c.save(); this.cam(c, z);
    c.font = font(gm.fam, gm.size);
    c.fillStyle = rgba('ink'); c.fillText('ONE', gm.x0 + 12, gm.base + 12);
    c.fillStyle = rgba('bone'); c.fillText('ONE', gm.x0, gm.base);
    c.restore();
  }

  private fxCards(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'bone');
    const g = this.fit('PROMPT,', 100, W * 0.84, H * 0.4);
    const n = this.vis(this.ct, t);
    const pad = g.cap * 0.18;
    c.save(); this.drift(c, s, 0.6);
    c.font = font(g.fam, g.size);
    for (let j = 0; j < n; j++) {
      const gl = g.lay.glyphs[j]!, age = t - this.ct[j]!;
      const x = g.x0 + (gl.x * g.size) / 100, wj = (gl.w * g.size) / 100;
      const f = ease.outBack(clamp(age / 0.13), 1.6);
      const ang = Math.PI * (1 - f);
      const sx = Math.cos(ang);
      const cx = x + wj / 2, cy = g.base - g.cap / 2;
      c.save(); c.translate(cx, cy); c.scale(Math.max(0.02, Math.abs(sx)), 1 + 0.08 * Math.sin(ang)); c.translate(-cx, -cy);
      const r0 = [x - pad * 0.6, g.base - g.cap - pad, wj + pad * 1.2, g.cap + pad * 2] as const;
      c.fillStyle = rgba('ink', 0.9); c.fillRect(r0[0] + 14, r0[1] + 16, r0[2], r0[3]);
      if (sx < 0) { c.fillStyle = rgba('signal'); c.fillRect(...r0); c.fillStyle = rgba('ink', 0.35); c.font = font(this.mono, 20); c.fillText(String(j + 1).padStart(2, '0'), r0[0] + 12, r0[1] + 30); c.font = font(g.fam, g.size); }
      else {
        c.fillStyle = rgba(j % 3 === 2 ? 'ink' : 'bone'); c.fillRect(...r0);
        c.strokeStyle = rgba('ink'); c.lineWidth = 4; c.strokeRect(r0[0] + 8, r0[1] + 8, r0[2] - 16, r0[3] - 16);
        c.fillStyle = j % 3 === 2 ? rgba('signal') : inkHot(age); c.fillText(gl.ch, x, g.base);
      }
      c.restore();
    }
    c.restore();
  }

  private fxGrid(c: CanvasRenderingContext2D, t: number, s: Sh) {
    const COLS = 7, ROWS = 3, cw = W / COLS, ch = H / ROWS;
    const fam = F.archivo(100, 900), word = 'PROMPT,';
    const FL: Col[] = ['ink', 'signal', 'bone'];
    const beat16 = Math.floor(t * 16);
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const fi = (q + r * 2 + beat16) % 3, fld = FL[fi]!;
      const x = q * cw, y = r * ch;
      c.fillStyle = rgba(fld); c.fillRect(x, y, cw + 1, ch + 1);
      const L = word[(q + (r === 1 ? 0 : r === 0 ? 2 : 5)) % 7]!;
      const size = ((r === 1 ? 0.78 : 0.5) * ch) / this.CAP;
      const pop = r === 1 ? 1 + 0.25 * (1 - ease.outExpo(clamp((s.age - q * 0.012) / 0.08))) : 1;
      c.save(); c.translate(x + cw / 2, y + ch / 2); c.scale(pop, pop);
      c.font = font(fam, size);
      const aw = this.adv(L, fam, size);
      c.fillStyle = rgba(fld === 'ink' ? (r === 1 ? 'bone' : 'signal') : 'ink');
      c.fillText(L, -aw / 2, (size * this.CAP) / 2);
      c.restore();
    }
    c.fillStyle = rgba('ink');
    for (let q = 1; q < COLS; q++) c.fillRect(q * cw - 2, 0, 4, H);
    for (let r = 1; r < ROWS; r++) c.fillRect(0, r * ch - 2, W, 4);
  }

  private fxSpot(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const g = this.fit('PROMPT,', 100, W * 0.9, H * 0.5);
    c.font = font(g.fam, g.size);
    c.fillStyle = rgba('graphite', 0.8); c.fillText('PROMPT,', g.x0, g.base);
    const spots = [
      { x: lerp(-200, W + 200, ease.inOutQuad(s.u)), y: 540 + 110 * Math.sin(s.u * TAU), r: 340 },
      { x: lerp(-700, W - 300, ease.inOutQuad(s.u)), y: 540 - 90 * Math.sin(s.u * TAU + 1), r: 220 },
    ];
    for (const sp of spots) {
      c.save(); c.beginPath(); c.arc(sp.x, sp.y, sp.r, 0, TAU); c.clip();
      c.fillStyle = rgba('bone'); c.fillRect(0, 0, W, H);
      c.fillStyle = rgba('ink'); c.fillText('PROMPT,', g.x0, g.base);
      c.restore();
      c.fillStyle = rgba('signal');
      for (let k = 0; k < 90; k++) {
        const a = (k / 90) * TAU + t, rr = sp.r + 14 + (k % 3) * 12;
        c.beginPath(); c.arc(sp.x + Math.cos(a) * rr, sp.y + Math.sin(a) * rr, 4.5 - (k % 3) * 1.4, 0, TAU); c.fill();
      }
      c.strokeStyle = rgba('signal'); c.lineWidth = 4; c.beginPath(); c.arc(sp.x, sp.y, sp.r, 0, TAU); c.stroke();
    }
  }

  private initHalftone() {
    const g = this.fit('PROMPT,', 100, W * 0.92, H * 0.56);
    const S = 4, w = W / S, h = H / S;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const gg = cv.getContext('2d', { willReadFrequently: true })!;
    gg.scale(1 / S, 1 / S); gg.font = font(g.fam, g.size); gg.fillStyle = '#fff'; gg.fillText('PROMPT,', g.x0, g.base);
    const img = gg.getImageData(0, 0, w, h).data;
    const P = 15, ang = 0.21, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let v = -1200; v < 1200; v += P) for (let u = -1200; u < 1200; u += P) {
      const x = 960 + u * ca - v * sa, y = 540 + u * sa + v * ca;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const cvv = img[((Math.floor(y / S) * w) + Math.floor(x / S)) * 4 + 3]! / 255;
      this.ht.push({ x, y, v: cvv });
    }
  }
  private fxHalftone(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'signal');
    const bass = this.kickPulse(t, 0.09, s.t0 - 0.05);
    const z = 1 + 0.06 * s.u + 0.05 * bass;
    c.save(); this.cam(c, z, 0.01 * s.u);
    c.fillStyle = rgba('blood');
    for (const p of this.ht) { const rr = 2 + 2.4 * (1 - p.v); c.beginPath(); c.arc(p.x + 4, p.y + 4, rr, 0, TAU); c.fill(); }
    c.fillStyle = rgba('ink');
    for (const p of this.ht) {
      if (p.v < 0.05) continue;
      const rr = 7.6 * Math.sqrt(p.v) * (1 + 0.45 * bass);
      c.beginPath(); c.arc(p.x, p.y, rr, 0, TAU); c.fill();
    }
    c.restore();
  }

  private fxWave(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'signal');
    const NR = 7, P = H / NR;
    let jump = 0;
    for (const [k, st] of this.kicks) if (k >= s.t0 - 0.02 && k <= t) jump += st * ease.outExpo(prog(t, k, k + 0.2));
    for (let r = 0; r < NR; r++) {
      const y = r * P, dir = r % 2 ? 1 : -1;
      const ph = TAU * 1.6 * s.age + r * 0.8 + jump;
      const wd = lerp(62, 125, 0.5 + 0.5 * Math.sin(ph));
      const inst = nearestW(wd), fam = F.archivo(inst, 900);
      const size = (P * 0.8) / this.CAP, sx = wd / inst;
      const l = this.lay('PROMPT,  ', fam), unit = (l.width * size * sx) / 100;
      const off = dir * (900 * s.age + 160 * jump) + (r % 2) * unit * 0.5;
      c.save(); c.beginPath(); c.rect(0, y + 1, W, P - 2); c.clip();
      c.fillStyle = rgba(r === 3 ? 'ink' : 'ink'); c.font = font(fam, size);
      c.translate(0, y + P / 2 + (size * this.CAP) / 2); c.scale(sx, 1);
      for (let x = ((((off % unit) + unit) % unit) - unit) / sx; x * sx < W + unit; x += unit / sx) c.fillText('PROMPT,  ', x, 0);
      c.restore();
    }
    c.fillStyle = rgba('ink');
    for (let r = 1; r < NR; r++) c.fillRect(0, r * P - 1.5, W, 3);
  }

  private fxTunnel(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'ink');
    const g = this.fit('PROMPT,', 100, W * 0.9, H * 0.46);
    c.font = font(g.fam, g.size);
    for (let i = 0; i < 7; i++) {
      const sc = Math.pow(1.55, -(i + ((s.age * 6) % 1)));
      if (sc < 0.3) continue;
      c.save(); this.cam(c, sc, (i % 2 ? 1 : -1) * 0.03 * i);
      c.strokeStyle = i % 2 === 0 ? rgba('signal', 0.95) : rgba('bone', 0.8 - i * 0.08); c.lineWidth = 4 / sc;
      c.strokeText('PROMPT,', g.x0, g.base);
      c.restore();
    }
    // "one" is coming: it grows out of the far end
    const k = smoothstep(0.45, 1, s.u);
    if (k > 0) {
      const go = this.fit('ONE', 125, W * 0.6, H * 0.5);
      c.save(); this.cam(c, lerp(0.05, 0.5, k * k)); c.font = font(go.fam, go.size); c.fillStyle = rgba('bone', k); c.fillText('ONE', go.x0, go.base); c.restore();
    }
  }

  private fxSplit(c: CanvasRenderingContext2D, t: number, s: Sh) {
    const ang = -0.24, dx = Math.cos(ang), dy = Math.sin(ang);
    const g = this.fit('ONE', 125, W * 0.94, H * 0.62);
    let slip = 0;
    for (const [kt, ks] of this.kicks) if (kt > s.t0 + 0.04) slip += ks * 90 * pulse(t, kt, 0.06);
    const inT = (1 - ease.outExpo(prog(s.age, 0, 0.13))) * W * 1.4;
    const half = (top: boolean) => {
      const o = top ? -inT + slip : inT - slip;
      const nx = -dy * (top ? -1 : 1), ny = dx * (top ? -1 : 1);
      c.save();
      c.translate(o * dx, o * dy);
      c.beginPath();
      c.moveTo(W / 2 - dx * 3000, H / 2 - dy * 3000); c.lineTo(W / 2 + dx * 3000, H / 2 + dy * 3000);
      c.lineTo(W / 2 + dx * 3000 + nx * 3000, H / 2 + dy * 3000 + ny * 3000); c.lineTo(W / 2 - dx * 3000 + nx * 3000, H / 2 - dy * 3000 + ny * 3000);
      c.closePath(); c.clip();
      this.fill(c, top ? 'ink' : 'signal');
      c.fillStyle = rgba(top ? 'bone' : 'ink', 0.1);
      for (let k = -40; k <= 40; k++) { c.save(); c.translate(W / 2 + nx * k * 26, H / 2 + ny * k * 26); c.rotate(ang); c.fillRect(-3000, 0, 6000, 1); c.restore(); }
      c.save(); this.cam(c, 1 + 0.04 * s.u);
      c.font = font(g.fam, g.size); c.fillStyle = top ? rgba('signal') : rgba('ink'); c.fillText('ONE', g.x0, g.base);
      c.restore();
      c.restore();
    };
    this.fill(c, 'ink');
    half(true); half(false);
    c.save(); c.translate(W / 2, H / 2); c.rotate(ang); c.fillStyle = rgba('bone', 0.9); c.fillRect(-1400, -1.5, 2800, 3); c.restore();
  }

  private fxSunburst(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'signal');
    const spin = s.age * 1.4 + 0.25 * this.kickPulse(t, 0.08, s.t0);
    c.fillStyle = rgba('blood');
    for (let i = 0; i < 24; i += 2) {
      const a0 = spin + (i / 24) * TAU, a1 = spin + ((i + 1) / 24) * TAU;
      c.beginPath(); c.moveTo(960, 540); c.lineTo(960 + Math.cos(a0) * 1600, 540 + Math.sin(a0) * 1600); c.lineTo(960 + Math.cos(a1) * 1600, 540 + Math.sin(a1) * 1600); c.closePath(); c.fill();
    }
    const g = this.fit('ONE', 125, W * 0.82, H * 0.6);
    const z = 1 + 0.14 * this.kickPulse(t, 0.07, s.t0) + 0.2 * (1 - ease.outExpo(clamp(s.age / 0.1)));
    c.save(); this.cam(c, z);
    c.font = font(g.fam, g.size);
    for (let q = 10; q >= 1; q--) { c.fillStyle = rgba(q % 2 ? 'ink' : 'blood'); c.fillText('ONE', g.x0 + q * 6, g.base + q * 6); }
    c.fillStyle = rgba('bone'); c.fillText('ONE', g.x0, g.base);
    c.restore();
  }

  private fxCrop(c: CanvasRenderingContext2D, t: number, s: Sh) {
    this.fill(c, 'bone');
    const n = Math.max(1, this.vis(this.cf, t));
    const big = this.fit('FILM!', 125, 1e9, H * 0.95);
    // the camera frames what has been typed so far, zooming out letter by letter
    const frameOf = (m: number) => {
      const gl = big.lay.glyphs[m - 1]!;
      const x1 = big.x0 + ((gl.x + gl.w) * big.size) / 100;
      return { xm: (big.x0 + x1) / 2, sc: Math.min(1, (W * 0.86) / (x1 - big.x0)) };
    };
    const a = frameOf(Math.max(1, n - 1)), b = frameOf(n);
    const k = n > 1 ? ease.outExpo(prog(t, this.cf[n - 1]!, this.cf[n - 1]! + 0.1)) : 1;
    const xm = lerp(a.xm, b.xm, k), sc = lerp(a.sc, b.sc, k) * (1 + 0.04 * s.u);
    c.save();
    c.translate(W / 2, H / 2); c.scale(sc, sc); c.translate(-xm, -H / 2);
    c.font = font(big.fam, big.size);
    for (let j = 0; j < n; j++) { const g2 = big.lay.glyphs[j]!; c.fillStyle = inkHot(t - this.cf[j]!); c.fillText(g2.ch, big.x0 + (g2.x * big.size) / 100, big.base); }
    c.restore();
  }

  private async initSheet() {
    try {
      const bytes = await loadBytes('assets/data/film-sheet.jpg');
      this.sheet = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    } catch { this.sheet = null; }
    const S = 4, cw = W / S, ch = H / S;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    const wg = this.fit('FILM!', 125, W * 0.86, H * 0.66);
    g.scale(1 / S, 1 / S); g.font = font(wg.fam, wg.size); g.fillStyle = '#fff'; g.fillText('FILM!', wg.x0, wg.base);
    const img = g.getImageData(0, 0, cw, ch).data;
    const CW = W / SC, CH = H / SR;
    for (let j = 0; j < SR; j++) for (let i = 0; i < SC; i++) {
      let sum = 0, nS = 0;
      for (let y = Math.floor((j * CH) / S); y < Math.floor(((j + 1) * CH) / S); y++) for (let x = Math.floor((i * CW) / S); x < Math.floor(((i + 1) * CW) / S); x++) { sum += img[(y * cw + x) * 4 + 3]!; nS++; }
      const k = j * SC + i;
      this.cov[k] = sum / (255 * Math.max(1, nS));
      this.tf[k] = (this.cov[k]! > 0.45 ? 0.05 : 0.12) * (i / (SC - 1)) + 0.02 * hash(i, j, 7);
    }
  }
  private sheetBody(c: CanvasRenderingContext2D, t: number, t0: number) {
    this.fill(c, 'ink');
    const CW = W / SC, CH = H / SR;
    if (this.sheet) {
      c.save(); c.globalAlpha = 0.24; c.drawImage(this.sheet, 0, 0, W, H); c.restore();
    }
    let filled = 0;
    for (let j = 0; j < SR; j++) for (let i = 0; i < SC; i++) {
      const k = j * SC + i;
      if (t < t0 + this.tf[k]!) { c.fillStyle = rgba('ink'); c.fillRect(i * CW, j * CH, CW, CH); continue; }
      filled++;
      if (this.cov[k]! > 0.45 && this.sheet) {
        c.drawImage(this.sheet, i * CW, j * CH, CW, CH, i * CW, j * CH, CW, CH);
        c.fillStyle = rgba('bone', 0.3); c.fillRect(i * CW, j * CH, CW, CH);
      }
      const hot = Math.exp(-(t - t0 - this.tf[k]!) / 0.05);
      if (hot > 0.03) { c.fillStyle = this.cov[k]! > 0.45 ? `rgba(255,238,214,${0.8 * hot})` : rgba('ember', 0.5 * hot); c.fillRect(i * CW, j * CH, CW, CH); }
    }
    c.fillStyle = rgba('ink', 0.85);
    for (let i = 1; i < SC; i++) c.fillRect(i * CW - 1, 0, 2, H);
    for (let j = 1; j < SR; j++) c.fillRect(0, j * CH - 1, W, 2);
    const a = 1 - prog(t, this.tX0, this.tX0 + 0.1);
    if (a > 0.003) {
      const s = filled.toLocaleString('en-US');
      c.save(); c.globalAlpha = a;
      c.fillStyle = rgba('ink', 0.94); c.fillRect(64, 928, 780, 112);
      c.font = font(this.mono, 13); c.letterSpacing = '3px'; c.fillStyle = rgba('bone', 0.6);
      c.fillText('FRAMES · THIS FILM, ONE PER 1/24 s', 88, 956);
      c.font = font(this.mono, 58); c.letterSpacing = '0px';
      c.fillStyle = filled >= SC * SR ? rgba('signal') : rgba('bone'); c.fillText(s, 86, 1020);
      c.font = font(this.monoR, 15); c.letterSpacing = '1px'; c.fillStyle = rgba('bone', 0.6);
      c.fillText(filled >= SC * SR ? '/ 2,160 · THE WHOLE FILM. ALL OF IT.' : '/ 2,160', 86 + measure(s, this.mono, 58) + 18, 1018);
      c.restore();
    }
  }
  private fxSheet(c: CanvasRenderingContext2D, t: number, s: Sh) { this.sheetBody(c, t, s.t0); }
  private fxIris(c: CanvasRenderingContext2D, t: number, s: Sh) {
    const sheetT0 = this.shots[this.shots.length - 2]!.t0;
    this.sheetBody(c, t, sheetT0);
    const { x, y, r } = GLOBE_H15;
    const k = ease.outExpo(prog(t, this.tX0, this.tX0 + 0.17));
    const R = lerp(Math.hypot(W / 2, H / 2) + 30, r, k);
    const q = prog(t, this.tX0 + 0.13, this.tX1 - 0.03);
    if (q > 0) {
      const gr = c.createRadialGradient(x, y, 0, x, y, R);
      const inner = clamp(q * 1.6), outer = clamp(q * 1.6 - 0.6);
      gr.addColorStop(0, rgba('ink', inner)); gr.addColorStop(0.6, rgba('ink', clamp(q * 1.4))); gr.addColorStop(1, rgba('ink', Math.max(outer, clamp(q * 1.2) * 0.8)));
      c.fillStyle = gr; c.beginPath(); c.arc(x, y, R, 0, TAU); c.fill();
      if (q >= 1) { c.fillStyle = rgba('ink'); c.beginPath(); c.arc(x, y, R + 1, 0, TAU); c.fill(); }
    }
    c.fillStyle = rgba('ink');
    c.beginPath(); c.rect(-10, -10, W + 20, H + 20); c.arc(x, y, R, 0, TAU, true); c.fill('evenodd');
    c.strokeStyle = rgba('bone', smoothstep(0.1, 0.5, k)); c.lineWidth = 3;
    c.beginPath(); c.arc(x, y, R, 0, TAU); c.stroke();
    void s;
  }

  // ------------------------------------------------------------------ camera
  private post(f: Frame, s: Sh): PostOverrides {
    const t = f.t, n = this.n;
    const w0 = this.w[0]!;
    const settle = 1 - prog(t, this.tX0 + (n === 1 ? 0.05 : 0.1), this.tX1 - 0.05);
    const live = n === 1 ? smoothstep(w0 - 0.02, w0, t) : smoothstep(w0 - 0.01, w0, t);
    const cut = s.hit * pulse(t, s.t0, 0.06);
    const kick = f.a.kick;
    const sh = (11 * cut + 3.5 * kick) * live * settle;
    const o: PostOverrides = {
      bloom: 0.62, bloomThreshold: n === 1 ? 0.95 : 1.05, bloomKnee: 0.15, bloomRadius: 0.75, halation: 0.28,
      vignette: n === 1 ? 0.42 : 0.5, grain: 0.06,
      ca: 1.0 + (2.8 * cut + 0.8 * kick) * live * settle,
      zoom: 1 + (0.045 * cut + 0.012 * kick) * live * settle,
      shake: [noise1(t * 45, 1) * sh, noise1(t * 45, 2) * sh],
      flash: 0, fade: 0, invert: 0, exposure: 1,
    };
    if (t < w0 || t >= this.tX1 - 0.05) {
      o.shake = [0, 0]; o.zoom = 1; o.ca = 1.0; o.grain = 0.055;
      if (n === 1) o.bloomThreshold = 0.9;
    }
    return o;
  }
}
