// Plate `zoetrope` — "Say it once and watch it spin" (CUT.zoetrope → CUT.beam).
// FIG. 7: an engraved zoetrope (drum on a spindle and a turned base) on a dark table.
//   H6      the hook's signal ring is the drum's rim bead seen from straight above; it cools as the
//           engraving comes up.
//   crane   on the beats the camera cranes from top-down to a low oblique view of the whole instrument
//           (Say → 50°, once → 29°, and → 11°), log-zoom keys, a nod on every word.
//   lyric   printed round the drum's outer band (in the drum's own texture, so it is foreshortened and lit
//           with the drum); each word shows as a dim print 0.4 s early and is inked hot as sung, widening
//           from Archivo 87.5 to 100 (SPIN to 125 on the held note); the drum turns so the sung word reads
//           at the front.
//   spin    the drum whips up to 90 rpm on a spring (16 slits × 1.5 rev/s = 24 fps); the lamp on the pin
//           strikes; the slit band becomes the persistence-of-vision window and the strip inside plays
//           (the caret bouncing), sampled at the strobe instants; the lyric smears into rings.
//   H7      the camera climbs aboard (co-rotates with the drum), pushes into one slit; the lit strip
//           burns out white behind it and everything else goes dark: one slit, 12 × 300 at centre.
// Caused detail: rim/height/slit dimensions drawn in by a hot pen when the camera reveals them, a
// turntable scale on the table, leaders to the strip, spindle and pedestal, the rpm tachometer, the
// spec line `16 SLITS · 16 FRAMES · 24 FPS`, the patent caption, and the FRAMES counter.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H, SS_TAP } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font } from '../px/type';
import { clamp, ease, lerp, prog, pulse, noise1, smoothstep, springStep, keys, TAU, type Key } from '../px/util';
import { wStart, wEnd, wText, charTimes } from './lyric';
import { CUT, SLIT_H7, RING_H6, frames } from './handoff';
import { FRAG_ZOE, Z } from './zoetrope-glsl';
import {
  type V3, type Cam, FOCAL0, orbitCam, project, onDrum, Table, makeStripTexture, LyricBand, LYR_W, LYR_H,
  LYR_PX_PER_RAD, lyrY, nearestW, kern100, adv100,
} from './zoetrope-kit';

const V3u = () => new THREE.Vector3();
const DELTA = TAU / Z.NS;
const W0 = 41; // first word index ("Say")
const NW = 7;
const OMEGA_SPIN = 3 * Math.PI; // 90 rpm
const BETA = 0.1; // the final view looks through the slit 0.1 rad off radial (misses the far slit)
const D_END = (FOCAL0 * (Z.SLIT_Y1 - Z.SLIT_Y0)) / SLIT_H7.h; // the slit is exactly SLIT_H7.h px tall
const SLIT_YC = 0.5 * (Z.SLIT_Y0 + Z.SLIT_Y1);
const RING_TOP = Z.H_TOP + Z.BEAD_r;
const RING_H6_W = 6; // the hook's ring stroke (px) at the cut

type RGB = [number, number, number];
const sc = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mixc = (a: RGB, b: RGB, u: number): RGB => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
/** fresh type / fresh lines: ember → signal → bone over ~0.35 s (CSS) */
function hotCss(age: number, a = 1, cool = 'bone'): string {
  if (age < 0) return rgba(cool, 0);
  const E: RGB = [255, 154, 77], S: RGB = [255, 90, 31];
  const B: RGB = cool === 'bone' ? [238, 233, 223] : cool === 'ash' ? [156, 151, 143] : [94, 91, 87];
  const c = age < 0.08 ? mixc(E, S, age / 0.08) : mixc(S, B, smoothstep(0.08, 0.36, age));
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
function hotLin(age: number, k = 0.55): RGB {
  if (age < 0) return [0, 0, 0];
  const b = sc(LIN.bone, k);
  if (age < 0.08) return mixc(sc(LIN.ember, 2.2), sc(LIN.signal, 1.5), age / 0.08);
  return mixc(sc(LIN.signal, 1.5), b, smoothstep(0.08, 0.4, age));
}

interface Glyph { ch: string; word: number; tg: number; ws: number; we: number; stretch: boolean }

export default class Zoetrope extends Scene {
  pass = new FSPass(FRAG_ZOE, {
    res: { value: new THREE.Vector2(W, H) }, ssTap: SS_TAP,
    camPos: { value: V3u() }, camR: { value: V3u() }, camU: { value: V3u() }, camF: { value: V3u() }, focal: { value: FOCAL0 },
    th: { value: 0 }, thQ: { value: 0 }, strobeK: { value: 0 }, phiS: { value: 0 }, veilK: { value: 0.78 },
    keyDir: { value: V3u() }, rimDir: { value: V3u() }, keyI: { value: 1 }, rimI: { value: 1 }, litK: { value: 0 }, tableK: { value: 1 },
    lampI: { value: 0 }, gateF: { value: 0 }, slitK: { value: 0 }, ringHeat: { value: 1 }, bladeK: { value: 0 }, ringHW: { value: (0.5 * RING_H6_W * Z.BEAD_R) / RING_H6.r },
    beatBand: { value: new THREE.Vector4(0, 0.02, 0, 0) },
    lyricTex: { value: null }, stripTex: { value: null },
    trailD: { value: new Array(Z.N_TRAIL).fill(0) }, trailW: { value: new Array(Z.N_TRAIL).fill(0) }, nTrail: { value: 1 }, trailSp: { value: 0 }, ringK: { value: 0 }, ringTex: { value: null },
    time: { value: 0 },
  });
  lines = new LineBatch(24000, { blend: 'normal' });
  glow = new LineBatch(4000);
  hud = new Layer2D();
  band = new LyricBand();

  T0 = 0; T1 = 0;
  ws: number[] = []; we: number[] = [];
  tSpin = 0; tPush = 0; tHold = 0; tCo0 = 0; tCo1 = 0;
  beats: number[] = [];
  glyphs: Glyph[] = [];
  size = 180;
  thT!: Table; psiT!: Table; relT!: Table;
  phiS = 0;
  kSlitCall = 0;
  emblem = '';

  override init() {
    const au = this.ctx.audio;
    this.T0 = CUT.zoetrope; this.T1 = CUT.beam;
    for (let i = 0; i < NW; i++) { this.ws.push(wStart(W0 + i)); this.we.push(wEnd(W0 + i)); }
    this.beats = au.beats.filter((b) => b > this.T0 - 0.01 && b < this.T1 + 0.01);
    // hold, then snap: SPIN is inked at the front while the drum winds back, then it whips on the beat
    this.tSpin = this.beats.find((b) => b > this.ws[6]! + 0.25) ?? this.ws[6]! + 0.35;
    // the push starts on the second beat after "spin" ends; co-rotation ramps in before it
    this.tPush = this.beats.find((b) => b > this.we[6]! + 0.2) ?? this.T1 - 1;
    this.tHold = this.T1 - 0.075;
    this.tCo0 = this.tPush + 0.02; this.tCo1 = this.tPush + 0.56;
    this.pass.u.stripTex!.value = makeStripTexture();
    this.pass.u.lyricTex!.value = this.band.tex;

    // ---- glyphs of the line, per-character sung times
    for (let i = 0; i < NW; i++) {
      const word = wText(W0 + i).toUpperCase().replace(/[^A-Z]/g, '');
      const ct = charTimes(W0 + i);
      [...word].forEach((ch, j) => this.glyphs.push({ ch, word: i, tg: ct[j]!, ws: this.ws[i]!, we: this.we[i]!, stretch: i === 6 }));
    }
    // type size: cap height 0.2 world on the band, shrunk if the line would not fit 82% of the round
    const capK = 0.72;
    this.size = (0.2 * LYR_PX_PER_RAD) / capK;
    const full = this.layoutAt(1e9);
    const len = full.x[full.x.length - 1]! + full.adv[full.adv.length - 1]!;
    if (len > LYR_W * 0.82) this.size *= (LYR_W * 0.82) / len;

    // ---- the drum's rotation: the head of the sung text reads just right of the front (smoothed)
    const lay = this.layoutAt(1e9);
    const hk: [number, number][] = [];
    const g0 = this.glyphs[0]!;
    hk.push([this.T0 - 0.8, lay.x[0]! - 0.55 * LYR_PX_PER_RAD]);
    hk.push([g0.ws, lay.x[0]!]);
    for (let i = 0; i < NW; i++) {
      const idx = this.glyphs.map((g, k) => (g.word === i ? k : -1)).filter((k) => k >= 0);
      const a = idx[0]!, b = idx[idx.length - 1]!;
      if (i > 0) hk.push([this.ws[i]!, lay.x[a]!]);
      hk.push([Math.max(this.ws[i]! + 0.05, Math.min(this.we[i]!, this.glyphs[b]!.tg + 0.12)), lay.x[b]! + lay.adv[b]!]);
    }
    const hAt = (t: number) => {
      if (t <= hk[0]![0]) return hk[0]![1] + (t - hk[0]![0]) * 0.4 * LYR_PX_PER_RAD;
      for (let i = 1; i < hk.length; i++) if (t <= hk[i]![0]) return lerp(hk[i - 1]![1], hk[i]![1], (t - hk[i - 1]![0]) / (hk[i]![0] - hk[i - 1]![0]));
      return hk[hk.length - 1]![1];
    };
    const dt = 0.001, t0 = this.T0 - 1.0, n = Math.ceil((this.T1 + 1.0 - t0) / dt);
    const th = new Float64Array(n), psi = new Float64Array(n), rel = new Float64Array(n);
    let hs = hAt(t0), spin = 0, co = 0;
    const FRONT = 0.1;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * dt;
      // critically damped follow of the head (two cascaded 1st-order lags)
      hs += (hAt(t) - hs) * (1 - Math.exp(-dt / 0.11));
      const x = t - this.tSpin;
      const xa = x + 0.18;
      const wSpin = x > 0 ? OMEGA_SPIN * springStep(x, 1.2, 0.62) : xa > 0 ? -1.6 * Math.sin((Math.PI * xa) / 0.18) : 0;
      spin += wSpin * dt;
      th[i] = FRONT - hs / LYR_PX_PER_RAD - spin;
    }
    const thTab = new Table(t0, dt, th);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * dt;
      const kc = prog(t, this.tCo0, this.tCo1, ease.inOutCubic);
      co += kc * thTab.d(t) * dt;
      psi[i] = this.yawBase(t) + co;
      rel[i] = th[i]! - psi[i]!;
    }
    this.thT = thTab;
    this.psiT = new Table(t0, dt, psi);
    this.relT = new Table(t0, dt, rel);
    // slit phase: at the cut the camera looks through a slit, BETA off radial
    const tE = this.T1;
    this.phiS = mod(this.psiT.at(tE) - BETA - this.thT.at(tE), DELTA);
    this.pass.u.phiS!.value = this.phiS;
    // the slit the callout follows: front-right when it appears
    const tc = this.ws[2]! + 0.35;
    this.kSlitCall = Math.round((this.psiT.at(tc) + 0.55 - this.thT.at(tc) - this.phiS) / DELTA);
    this.emblem = '✦ ONE PROMPT FILM CO. · WHEEL OF LIFE · PAT. PEND. ✦';
    // the rings: row averages of the fully sung band; the rows above the median become the lit rings
    {
      this.drawBand(1e9);
      const img = this.band.c.getImageData(0, 0, LYR_W, LYR_H).data;
      const y0 = Math.floor(lyrY(0.28)), y1 = Math.ceil(lyrY(0.06));
      const rows: number[] = [];
      const fl = this.layoutAt(1e9);
      const xEnd = Math.min(LYR_W, Math.ceil(fl.x[fl.x.length - 1]! + fl.adv[fl.adv.length - 1]!));
      for (let y = y0; y <= y1; y++) {
        let sm = 0;
        for (let x = 0; x < xEnd; x += 2) sm += img[(y * LYR_W + x) * 4]!;
        rows.push(sm / (xEnd / 2) / 255);
      }
      const all: number[] = [];
      for (let y = 0; y < LYR_H; y++) {
        let sm = 0;
        for (let x = 0; x < xEnd; x += 2) sm += img[(y * LYR_W + x) * 4]!;
        all.push(sm / (xEnd / 2) / 255);
      }
      const sorted = [...rows].sort((p, q) => p - q);
      const lo = sorted[Math.floor(sorted.length * 0.62)]!, hi = lerp(lo, sorted[sorted.length - 1]!, 0.7);
      // one texel per band row (texture v runs up the drum, canvas y runs down)
      const data = new Float32Array(LYR_H);
      for (let y = 0; y < LYR_H; y++) data[LYR_H - 1 - y] = smoothstep(lo, hi, all[y]!);
      const rt = new THREE.DataTexture(data, LYR_H, 1, THREE.RedFormat, THREE.FloatType);
      rt.minFilter = THREE.LinearFilter; rt.magFilter = THREE.LinearFilter; rt.needsUpdate = true;
      this.pass.u.ringTex!.value = rt;
    }
  }

  yawBase(t: number) {
    return keys(t, [[this.T0, 0], [this.ws[0]! - 0.02, -0.06, ease.outExpo], [this.ws[3]! + 0.4, 0.1, ease.outExpo], [this.tPush, 0.16, ease.linear]]);
  }

  /** glyph advances (texture px) and positions at time t; widths animate as sung */
  layoutAt(t: number) {
    const x: number[] = [], adv: number[] = [], wd: number[] = [], fam: string[] = [], sf: number[] = [];
    let s = 0;
    const gap = this.size * 0.3;
    this.glyphs.forEach((g, i) => {
      let w = 87.5;
      if (t >= g.tg) {
        const k = g.stretch ? prog(t, g.tg, g.we, ease.outCubic) : springStep(t - g.tg, 3.2, 0.55);
        w = g.stretch ? lerp(87.5, 125, k) : lerp(87.5, 100, k);
      }
      const fw = nearestW(w);
      const fm = F.archivo(fw, 900);
      const f = w / fw;
      const a = (adv100(g.ch, fm) / 100) * this.size * f;
      if (i > 0) {
        const p = this.glyphs[i - 1]!;
        if (p.word !== g.word) s += gap;
        else s += (0.5 * (kern100(p.ch, g.ch, fam[i - 1]!) * sf[i - 1]! + kern100(p.ch, g.ch, fm) * f) / 100) * this.size;
      }
      x.push(s); adv.push(a); wd.push(w); fam.push(fm); sf.push(f);
      s += a;
    });
    return { x, adv, wd, fam, sf };
  }

  // ---------------------------------------------------------------- camera
  camAt(t: number): Cam & { T: V3; el: number; dist: number } {
    const [s0, , s2, s3] = this.ws;
    const tS = this.tSpin, tP = this.tPush, tH = this.tHold;
    const d0 = (FOCAL0 * Z.BEAD_R) / RING_H6.r;
    const deg = Math.PI / 180;
    const lin = ease.linear, ox = ease.outExpo;
    const el = keys(t, [
      [this.T0, 90], [this.T0 + 0.07, 89.6, lin], [s0! - 0.02, 47, ox], [s2! - 0.03, 44, lin], [s2! + 0.34, 32, ox],
      [s3! - 0.03, 30, lin], [s3! + 0.4, 16.5, ox], [tS - 0.02, 15.2, lin], [tS + 0.35, 14.2, ox], [tP, 13.8, lin],
      [tP + 0.5, 2.5, ox], [tH, 0, ease.inOutCubic],
    ]) * deg;
    const dist = Math.exp(keys(t, ([
      [this.T0, d0], [this.T0 + 0.07, d0 * 0.99, lin], [s0! - 0.02, 4.45, ox], [s2! - 0.03, 4.2, lin], [s2! + 0.34, 4.1, ox],
      [s3! - 0.03, 3.95, lin], [s3! + 0.4, 4.75, ox], [tS - 0.02, 4.3, lin], [tS + 0.35, 4.5, ox], [tP, 4.4, lin],
      [tP + 0.5, 2.3, ox], [tH, D_END, ease.inOutCubic],
    ] as Key[]).map(([a, b, c]) => [a, Math.log(b), c] as Key)));
    const Ty = keys(t, [
      [this.T0, RING_TOP], [this.T0 + 0.07, RING_TOP, lin], [s0! - 0.02, -0.12, ox], [s2! + 0.34, -0.06, ox], [s3! + 0.4, -0.17, ox],
      [tS + 0.35, -0.14, ox], [tP, -0.13, lin], [tP + 0.5, 0.43, ox], [tH, SLIT_YC, ease.inOutCubic],
    ]);
    const rT = keys(t, [[tP, 0], [tP + 0.5, 0.78, ox], [tH, Z.R_OUT, ease.inOutCubic]]);
    const beta = keys(t, [[tP, 0], [tH, BETA, ease.inOutCubic]]);
    let roll = keys(t, [[this.T0, 0], [this.T0 + 0.07, 0, lin], [s0! - 0.02, -0.035, ox], [s3! + 0.4, 0.018, ox], [tP, 0.012, lin], [tH, 0, ease.inOutCubic]]);
    if (t > tS) roll += 0.055 * Math.exp(-(t - tS) * 5.5) * Math.sin((t - tS) * 15);
    // per-word nods (a zoom bump, outExpo in 0.2 s, then it relaxes)
    let z = 1;
    this.ws.forEach((w, i) => { z *= 1 + (i === 6 ? 0.075 : 0.042) * ease.outExpo(prog(t, w, w + 0.2)) * (1 - prog(t, w + 0.22, w + 0.95, ease.inOutQuad)); });
    const psi = this.psiT.at(t);
    const dirT = psi - beta;
    const T: V3 = [rT * Math.sin(dirT), Ty, rT * Math.cos(dirT)];
    const cam = orbitCam(T, psi, el, dist, roll, FOCAL0 * z);
    return { ...cam, T, el, dist };
  }

  // ---------------------------------------------------------------- lyric band texture
  drawBand(t: number) {
    const c = this.band.c;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000';
    c.fillRect(0, 0, LYR_W, LYR_H);
    c.globalCompositeOperation = 'lighter';
    const R = 'rgb(255,0,0)';
    // printed rules round the band
    c.fillStyle = R;
    c.fillRect(0, lyrY(0.294) - 1.6, LYR_W, 3.2);
    c.fillRect(0, lyrY(0.285) - 0.6, LYR_W, 1.2);
    c.fillRect(0, lyrY(0.046) - 1.6, LYR_W, 3.2);
    c.fillRect(0, lyrY(0.055) - 0.6, LYR_W, 1.2);
    // slit numbers and ticks above the band
    c.font = font(F.mono(600), 15);
    c.textAlign = 'center';
    for (let k = 0; k < Z.NS; k++) {
      const x = mod((k * DELTA + this.phiS) * LYR_PX_PER_RAD, LYR_W);
      for (const xx of [x, x - LYR_W, x + LYR_W]) {
        c.fillRect(xx - 0.8, lyrY(0.334), 1.6, lyrY(0.3) - lyrY(0.334));
        c.fillText(String(k + 1).padStart(2, '0'), xx + 22, lyrY(0.305));
      }
    }
    // the lyric
    const lay = this.layoutAt(t);
    const base = lyrY(0.066);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    this.glyphs.forEach((g, i) => {
      const pre = prog(t, g.ws - 0.4, g.ws - 0.25);
      if (pre <= 0) return;
      const sung = t >= g.tg;
      const age = t - g.tg;
      const heat = sung ? Math.pow(clamp(1 - age / 0.34), 1.3) : 0;
      c.save();
      c.translate(lay.x[i]!, base);
      c.scale(lay.sf[i]!, 1);
      c.font = font(lay.fam[i]!, this.size);
      c.fillStyle = sung ? `rgb(255,${Math.round(255 * heat)},0)` : `rgba(0,0,255,${pre})`;
      for (const dx of [0, -LYR_W / lay.sf[i]!]) c.fillText(g.ch, dx, 0);
      c.restore();
    });
    // the maker's emblem in the rest of the round
    const end = lay.x[lay.x.length - 1]! + lay.adv[lay.adv.length - 1]!;
    const fullEnd = this.layoutAt(1e9);
    const e1 = Math.max(end, fullEnd.x[fullEnd.x.length - 1]! + fullEnd.adv[fullEnd.adv.length - 1]!);
    const room = LYR_W - e1;
    if (room > 300) {
      // fitted to the arc left over (margins either side)
      const fit = (txt: string, px: number, wt: number) => {
        c.font = font(F.mono(wt), px);
        const w = c.measureText(txt).width;
        const k = Math.min(1, (room * 0.8) / w);
        c.font = font(F.mono(wt), px * k);
        return px * k;
      };
      c.fillStyle = R;
      c.textAlign = 'center';
      fit(this.emblem, 30, 500);
      c.fillText(this.emblem, e1 + room / 2, lyrY(0.14));
      const l2 = 'SAY IT ONCE · IT LOOPS';
      fit(l2, 24, 400);
      c.fillText(l2, e1 + room / 2, lyrY(0.2));
    }
    c.globalCompositeOperation = 'source-over';
    this.band.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const cam = this.camAt(t);
    const u = this.pass.u;
    const th = this.thT.at(t), psi = this.psiT.at(t);
    const wD = this.thT.d(t), wRel = this.relT.d(t);
    const rel = th - psi;
    (u.camPos!.value as THREE.Vector3).set(...cam.pos);
    (u.camR!.value as THREE.Vector3).set(...cam.R);
    (u.camU!.value as THREE.Vector3).set(...cam.U);
    (u.camF!.value as THREE.Vector3).set(...cam.F);
    u.focal!.value = cam.focal;
    u.th!.value = th;
    u.thQ!.value = Math.floor(rel / DELTA) * DELTA + psi;
    const strobe = smoothstep(2.6, 6.8, Math.abs(wRel));
    u.strobeK!.value = strobe;
    u.time!.value = t;
    // lights: the key from the upper left of the camera's side, the backlight behind the drum
    const kyaw = psi - 0.85;
    const key: V3 = [Math.sin(kyaw) * 0.62, 0.66, Math.cos(kyaw) * 0.62];
    const kl = Math.hypot(...key);
    (u.keyDir!.value as THREE.Vector3).set(key[0] / kl, key[1] / kl, key[2] / kl);
    const byaw = psi + Math.PI + 0.7;
    (u.rimDir!.value as THREE.Vector3).set(Math.sin(byaw) * 0.85, 0.42, Math.cos(byaw) * 0.85).normalize();
    const lit = prog(t, this.T0 + 0.04, this.ws[0]! - 0.06, ease.inOutQuad) * (1 - 0.75 * prog(t, this.tHold - 0.4, this.tHold, ease.inQuad));
    u.litK!.value = lit;
    u.rimI!.value = 0.95 * prog(t, this.T0 + 0.1, this.ws[0]!);
    u.ringHeat!.value = t < this.T0 + 0.1 ? 1 : Math.exp(-(t - this.T0 - 0.1) / 0.2);
    u.tableK!.value = prog(t, this.ws[1]!, this.ws[3]! + 0.3);
    const snare = this.ctx.audio.hit('snare', t, 0.09);
    const lampOn = t < this.tSpin ? 0.14 * prog(t, this.ws[0]!, this.ws[0]! + 0.3) : 1.5;
    const lampI = lampOn * (1 + (t > this.tSpin ? 1.6 * pulse(t, this.tSpin, 0.12) + 0.3 * snare : 0));
    u.lampI!.value = lampI;
    u.bladeK!.value = t < this.tSpin ? 0 : 1.0 * lampI * prog(t, this.tSpin, this.tSpin + 0.1) * (1 - prog(t, this.T1 - 0.55, this.T1 - 0.25));
    u.gateF!.value = prog(t, this.T1 - 0.32, this.T1 - 0.07, ease.inQuad);
    u.slitK!.value = prog(t, this.T1 - 0.45, this.T1 - 0.06, ease.inOutCubic);
    // beat pulses: a heat band runs down the burin lines from the rim; the bead flashes
    let bb = 0, by = 0, bf = 0;
    for (const b of this.beats) {
      if (t < b || b < this.ws[0]! - 0.1 || b > this.tPush) continue;
      const p = pulse(t, b, 0.16);
      if (p > bb) { bb = p; by = Z.H_TOP - (t - b) * 1.5; }
      bf = Math.max(bf, pulse(t, b, 0.07));
    }
    (u.beatBand!.value as THREE.Vector4).set(by, 0.03, 0.8 * bb * lit, 0.4 * bf * lit);
    // persistence trails (the eye rides the camera): the lyric smears into rings
    const trailT = 0.2 * smoothstep(1.6, 7.5, Math.abs(wRel));
    const tw = u.trailW!.value as number[], td = u.trailD!.value as number[];
    if (trailT > 0.01) {
      let sw = 0;
      for (let i = 0; i < Z.N_TRAIL; i++) {
        const tau = (i / (Z.N_TRAIL - 1)) * trailT;
        td[i] = rel - this.relT.at(t - tau);
        tw[i] = Math.exp(-tau / 0.12);
        sw += tw[i]!;
      }
      const gain = 1 + 0.25 * smoothstep(0.1, 0.4, trailT);
      for (let i = 0; i < Z.N_TRAIL; i++) tw[i] = (tw[i]! / sw) * gain;
      u.nTrail!.value = Z.N_TRAIL;
      u.trailSp!.value = Math.abs(td[Z.N_TRAIL - 1]! - td[0]!) / (Z.N_TRAIL - 1);
    } else u.nTrail!.value = 1;
    u.ringK!.value = prog(t, this.tSpin + 0.18, this.tSpin + 0.55, ease.inOutQuad) * smoothstep(3, 7.5, Math.abs(wRel));

    this.drawBand(t);
    this.pass.render(renderer, out);

    // ---- the drawing: callouts, dimensions, scales, readouts
    this.lines.clear(); this.glow.clear();
    const L = this.hud; L.clear();
    this.drawCallouts(L.ctx, t, cam, th, psi, wD);
    this.drawReadouts(L.ctx, t, wD, rel);
    this.lines.render(renderer, out);
    if (this.glow.count) this.glow.render(renderer, out);
    comp.draw(renderer, L.upload(), out);

    // ---- post: kicks shake, the whip kicks harder; still at both hand-offs
    const calm = prog(t, this.T0 + 0.12, this.T0 + 0.3) * (1 - prog(t, this.tPush + 0.3, this.tPush + 0.6));
    const kick = f.a.kick;
    const whip = pulse(t, this.tSpin, 0.14);
    const sa = (2.2 * kick + 9 * whip) * calm;
    // the finish starts as the engine's defaults (the hook's ring glows the same across the cut)
    const k0 = prog(t, this.T0 + 0.1, this.T0 + 0.4);
    return {
      bloom: lerp(0.55, 0.62, k0), halation: lerp(0.25, 0.28, k0), vignette: lerp(0.35, 0.42, k0), grain: 0.055,
      ca: lerp(1.2, 1.1, k0) + 2.2 * whip,
      shake: [sa * noise1(t * 43, 1), sa * noise1(t * 47, 2)],
    };
  }

  // ---------------------------------------------------------------- the drawing
  /** a hairline drawn in by a pen from a to b (heat by age at the head); returns 0..1 progress */
  pen(a: { x: number; y: number }, b: { x: number; y: number }, t: number, t0: number, dur: number, alpha: number, w = 1) {
    const k = prog(t, t0, t0 + dur, ease.outCubic);
    if (k <= 0 || alpha <= 0) return 0;
    const hx = lerp(a.x, b.x, k), hy = lerp(a.y, b.y, k);
    const age = t - (t0 + dur * 0.5);
    const col = hotLin(age, 0.5);
    this.lines.seg2(a.x, a.y, hx, hy, w, sc(col, 1), alpha);
    if (k < 1) this.glow.seg2(hx, hy, hx + 0.01, hy, 5, sc(LIN.ember, 2.2 * alpha), 0.9);
    return k;
  }
  label(c: CanvasRenderingContext2D, s: string, x: number, y: number, t: number, t0: number, alpha: number, o: { size?: number; align?: CanvasTextAlign; cool?: string; w?: number } = {}) {
    if (alpha <= 0 || t < t0) return;
    const n = Math.min(s.length, Math.floor((t - t0) * 70));
    if (n <= 0) return;
    c.font = font(F.mono(o.w ?? 500), o.size ?? 13);
    c.letterSpacing = '1.5px';
    const al = o.align ?? 'left';
    const full = al === 'left' ? 0 : c.measureText(s).width;
    c.textAlign = 'left';
    c.fillStyle = hotCss(t - t0 - n / 70, alpha, o.cool ?? 'bone');
    c.fillText(s.slice(0, n), x - (al === 'right' ? full : al === 'center' ? full / 2 : 0), y);
    c.letterSpacing = '0px';
  }

  drawCallouts(c: CanvasRenderingContext2D, t: number, cam: Cam, th: number, psi: number, _wD: number) {
    const [s0, s1, s2, s3, s4] = this.ws;
    const P = (p: V3) => project(cam, p);
    const hudA = 1 - prog(t, this.tPush + 0.1, this.tPush + 0.45);
    if (hudA <= 0) return;
    const bone = LIN.bone;
    c.save();
    c.textBaseline = 'alphabetic';

    // rim diameter: across the ring, drawn from the centre outward as the ring cools
    {
      const tA = this.T0 + 0.16;
      const a = hudA * (1 - prog(t, s3! + 0.2, s3! + 0.6));
      const y = RING_TOP + 0.03;
      const pc = P([0, y, 0]), pl = P([-1.0, y, 0]), pr = P([1.0, y, 0]);
      if (a > 0 && pc.z > 0) {
        this.pen(pc, pl, t, tA, 0.3, 0.8 * a); this.pen(pc, pr, t, tA, 0.3, 0.8 * a);
        for (const s of [-1, 1]) {
          const e0 = P([s * 1.0, y - 0.05, 0]), e1 = P([s * 1.0, y + 0.06, 0]);
          this.pen(e0, e1, t, tA + 0.28, 0.1, 0.7 * a);
          // arrowheads
          const q0 = P([s * 0.94, y, 0.03]), q1 = P([s * 0.94, y, -0.03]), tip = P([s * 1.0, y, 0]);
          if (t > tA + 0.3) { this.lines.seg2(q0.x, q0.y, tip.x, tip.y, 1, sc(bone, 0.5), a); this.lines.seg2(q1.x, q1.y, tip.x, tip.y, 1, sc(bone, 0.5), a); }
        }
        const m = P([0.45, y, 0]);
        this.label(c, 'Ø 300', m.x, m.y - 10, t, tA + 0.2, 0.9 * a, { size: 15, align: 'center', w: 600 });
        this.label(c, 'RIM · ROLLED BRASS BEAD Ø 6', m.x, m.y + 20, t, tA + 0.35, 0.55 * a, { size: 11, align: 'center', cool: 'ash' });
      }
    }
    // the axis: a chain line through the whole instrument
    {
      const a = 0.35 * hudA * prog(t, s1!, s1! + 0.4);
      if (a > 0) {
        const n = 26;
        for (let i = 0; i < n; i++) {
          const y0 = lerp(-1.12, 1.05, i / n), y1 = y0 + (i % 2 ? 0.02 : 0.055);
          const p0 = P([0, y0, 0]), p1 = P([0, y1, 0]);
          if (p0.z > 0 && p1.z > 0) this.lines.seg2(p0.x, p0.y, p1.x, p1.y, 0.9, sc(bone, 0.6), a);
        }
      }
    }
    // the reading index: where the sung word is inked (the drum turns the line past it)
    {
      const a = hudA * prog(t, s0! - 0.05, s0! + 0.1) * (1 - prog(t, this.tSpin, this.tSpin + 0.15));
      if (a > 0) {
        const tip = P(onDrum(0.1, Z.BAND_Y1 + 0.02, 1.02)), l0 = P(onDrum(0.07, Z.BAND_Y1 + 0.055, 1.02)), l1 = P(onDrum(0.13, Z.BAND_Y1 + 0.055, 1.02));
        if (tip.z > 0) {
          const hot = sc(LIN.signal, 1.3 + 1.2 * this.ctx.audio.hit('kick', t, 0.08));
          this.lines.seg2(l0.x, l0.y, tip.x, tip.y, 1.6, hot, a); this.lines.seg2(l1.x, l1.y, tip.x, tip.y, 1.6, hot, a);
          this.lines.seg2(l0.x, l0.y, l1.x, l1.y, 1.6, hot, a);
          this.label(c, 'READ HERE', tip.x, l0.y - 10, t, s0! + 0.05, 0.6 * a, { size: 10, align: 'center', cool: 'ash' });
        }
      }
    }
    // the slit: a leader that follows one slit as the drum turns
    {
      const tA = s2! + 0.35;
      const a = hudA * prog(t, tA, tA + 0.1) * (1 - prog(t, this.tSpin, this.tSpin + 0.2));
      if (a > 0) {
        const ang = th + this.phiS + this.kSlitCall * DELTA;
        const face = Math.cos(ang - psi);
        const q = P(onDrum(ang, Z.SLIT_Y1 + 0.005));
        const qb = P(onDrum(ang, Z.SLIT_Y0 - 0.005));
        const aa = a * smoothstep(0.1, 0.4, face);
        const lx = 1500, ly = 430;
        this.pen(q, { x: lx - 40, y: ly + 8 }, t, tA, 0.22, 0.75 * aa);
        this.pen({ x: lx - 40, y: ly + 8 }, { x: lx + 250, y: ly + 8 }, t, tA + 0.2, 0.2, 0.75 * aa);
        // bracket the slit's length
        this.lines.seg2(q.x - 7, q.y, q.x + 7, q.y, 1, sc(bone, 0.6), aa * prog(t, tA + 0.1, tA + 0.2));
        this.lines.seg2(qb.x - 7, qb.y, qb.x + 7, qb.y, 1, sc(bone, 0.6), aa * prog(t, tA + 0.1, tA + 0.2));
        this.label(c, 'SLIT 1.8 × 45', lx - 30, ly, t, tA + 0.2, 0.9 * aa, { size: 15, w: 600 });
        this.label(c, '×16 · ONE EVERY 22.5°', lx - 30, ly + 26, t, tA + 0.35, 0.6 * aa, { size: 11, cool: 'ash' });
      }
    }
    // the drum's height (left) and the overall height (right)
    {
      const tA = s3! + 0.25;
      const a = hudA * prog(t, tA, tA + 0.05);
      if (a > 0) {
        const la = psi - 1.62;
        const r1 = 1.2;
        const b0 = P(onDrum(la, 0, r1)), b1 = P(onDrum(la, Z.H_TOP, r1));
        this.pen(b0, b1, t, tA, 0.28, 0.75 * a);
        for (const y of [0, Z.H_TOP]) this.pen(P(onDrum(la, y, 1.04)), P(onDrum(la, y, r1 + 0.06)), t, tA + 0.05, 0.15, 0.55 * a);
        const m = P(onDrum(la, Z.H_TOP * 0.5, r1 + 0.05));
        this.label(c, 'H 99', m.x - 14, m.y + 5, t, tA + 0.2, 0.9 * a, { size: 14, align: 'right', w: 600 });
        this.label(c, 'DRUM', m.x - 14, m.y + 24, t, tA + 0.3, 0.55 * a, { size: 11, align: 'right', cool: 'ash' });
        const ra = psi + 1.5, r2 = 1.34, tB = tA + 0.12;
        const o0 = P(onDrum(ra, Z.TABLE_Y, r2)), o1 = P(onDrum(ra, RING_TOP, r2));
        this.pen(o0, o1, t, tB, 0.36, 0.75 * a);
        this.pen(P(onDrum(ra, RING_TOP, 1.05)), P(onDrum(ra, RING_TOP, r2 + 0.06)), t, tB + 0.05, 0.15, 0.55 * a);
        this.pen(P(onDrum(ra, Z.TABLE_Y, 0.62)), P(onDrum(ra, Z.TABLE_Y, r2 + 0.06)), t, tB + 0.05, 0.2, 0.55 * a);
        const mo = P(onDrum(ra, -0.2, r2 + 0.05));
        this.label(c, '252', mo.x + 14, mo.y + 5, t, tB + 0.25, 0.9 * a, { size: 14, w: 600 });
        this.label(c, 'OVERALL, mm', mo.x + 14, mo.y + 24, t, tB + 0.33, 0.55 * a, { size: 11, cool: 'ash' });
      }
    }
    // leaders: pedestal, spindle, the strip seen through the slits
    {
      const lead = (anchor: V3, lx: number, ly: number, l1: string, l2: string, tA: number, aK: number, right = true) => {
        const a = hudA * aK * prog(t, tA, tA + 0.05);
        if (a <= 0) return;
        const q = P(anchor);
        const ex = right ? lx - 16 : lx + 16;
        this.glow.seg2(q.x, q.y, q.x + 0.01, q.y, 4, sc(LIN.ember, 1.4 * a * prog(t, tA, tA + 0.1)), 1);
        this.pen(q, { x: ex, y: ly - 5 }, t, tA, 0.2, 0.7 * a);
        this.label(c, l1, lx, ly, t, tA + 0.15, 0.85 * a, { size: 13, align: right ? 'left' : 'right', w: 600 });
        this.label(c, l2, lx, ly + 20, t, tA + 0.28, 0.55 * a, { size: 11, align: right ? 'left' : 'right', cool: 'ash' });
      };
      const q = project(cam, onDrum(psi + 1.1, -0.9, 0.44));
      lead(onDrum(psi + 1.1, -0.905, 0.44), Math.max(q.x + 120, 1300), q.y + 70, 'PEDESTAL', 'TURNED WALNUT · FELT FOOT', s3! + 0.45, 1);
      const qs = project(cam, [0, -0.45, 0]);
      lead([0.07 * Math.sin(psi - 0.5), -0.45, 0.07 * Math.cos(psi - 0.5)], Math.min(qs.x - 150, 700), qs.y + 30, 'SPINDLE', 'BALL RACE · RUNS TRUE TO 0.02', s3! + 0.6, 1, false);
      const dl = project(cam, onDrum(psi - Math.PI / 2, SLIT_YC)), dr = project(cam, onDrum(psi + Math.PI / 2, SLIT_YC));
      const qv = project(cam, onDrum(psi - 0.3, SLIT_YC));
      lead(onDrum(psi - 0.3, SLIT_YC), Math.min(dl.x - 30, 560), 222, 'STRIP · 16 FRAMES', 'THE CARET, BOUNCING · SEEN THROUGH THE SLITS', s4!, 1, false);
      if (t > this.tSpin) {
        const qa = project(cam, onDrum(psi + 0.25, SLIT_YC + 0.08));
        lead(onDrum(psi + 0.25, SLIT_YC + 0.08), Math.max(dr.x + 40, 1400), Math.max(qa.y - 20, 400), 'PERSISTENCE OF VISION', 'ENGAGED · EACH SLIT SHOWS ONE FRAME', this.tSpin + 0.3, 1);
      }
    }
    // a turntable scale on the table, drawn round by the pen
    {
      const tA = s3! + 0.12;
      const a = hudA * prog(t, tA, tA + 0.05);
      if (a > 0) {
        const r0 = 1.42, n = 120;
        const k = prog(t, tA, tA + 0.55, ease.inOutCubic);
        const a0 = psi + Math.PI * 0.5;
        c.font = font(F.mono(500), 11);
        c.textAlign = 'center';
        for (let i = 0; i < n * k; i++) {
          const ang = a0 + (i / n) * TAU;
          const big = i % 10 === 0, mid = i % 5 === 0;
          const len = big ? 0.09 : mid ? 0.055 : 0.03;
          const p0 = P(onDrum(ang, Z.TABLE_Y, r0)), p1 = P(onDrum(ang, Z.TABLE_Y, r0 + len));
          if (p0.z <= 0) continue;
          const age = t - (tA + (i / n) * 0.55);
          const facing = 0.35 + 0.65 * smoothstep(-0.2, 0.6, Math.cos(ang - psi));
          this.lines.seg2(p0.x, p0.y, p1.x, p1.y, big ? 1.1 : 0.8, hotLin(age, big ? 0.55 : 0.4), a * facing);
          if (big) {
            const pl = P(onDrum(ang, Z.TABLE_Y, r0 + 0.17));
            c.fillStyle = hotCss(age, 0.55 * a * facing, 'ash');
            c.fillText(`${Math.round(mod(((ang - psi) * 180) / Math.PI, 360))}°`, pl.x, pl.y + 4);
          }
        }
        // the ring itself
        const m = 180;
        for (let i = 0; i < m * k; i++) {
          const a1 = a0 + (i / m) * TAU, a2 = a0 + ((i + 1) / m) * TAU;
          const p0 = P(onDrum(a1, Z.TABLE_Y, r0)), p1 = P(onDrum(a2, Z.TABLE_Y, r0));
          if (p0.z > 0 && p1.z > 0) this.lines.seg2(p0.x, p0.y, p1.x, p1.y, 0.8, sc(bone, 0.4), a * (0.35 + 0.65 * smoothstep(-0.2, 0.6, Math.cos(a1 - psi))));
        }
        // index mark: where the drum's slit 01 is now (it moves)
        const ai = th + this.phiS;
        const pi0 = P(onDrum(ai, Z.TABLE_Y, r0 - 0.06)), pi1 = P(onDrum(ai, Z.TABLE_Y, r0 - 0.2));
        if (t > tA + 0.55 && pi0.z > 0) this.lines.seg2(pi0.x, pi0.y, pi1.x, pi1.y, 1.6, sc(LIN.signal, 1.4), a * smoothstep(-0.3, 0.3, Math.cos(ai - psi)));
      }
    }
    c.restore();
  }

  drawReadouts(c: CanvasRenderingContext2D, t: number, wD: number, rel: number) {
    const [s0, , s2] = this.ws;
    const hudA = (1 - prog(t, this.tPush + 0.1, this.tPush + 0.45)) * prog(t, this.T0 + 0.2, this.T0 + 0.35);
    if (hudA <= 0) return;
    c.save();
    c.textBaseline = 'alphabetic';
    const x0 = 96, y0 = 92;
    // spec line (top left)
    this.label(c, 'FIG. 7 — ZOETROPE', x0, y0, t, this.T0 + 0.2, 0.95 * hudA, { size: 16, w: 600 });
    this.label(c, '16 SLITS · 16 FRAMES · 24 FPS', x0, y0 + 26, t, s0! + 0.05, 0.8 * hudA, { size: 13 });
    this.label(c, 'Ø 300 × H 99 · STRIP 16 × 22.5° · LAMP 1 SPARK', x0, y0 + 48, t, s2! + 0.1, 0.5 * hudA, { size: 11, cool: 'ash' });
    // rpm tachometer (top right)
    const rpm = (Math.abs(wD) * 60) / TAU;
    const tx = W - 96, ty = 96;
    const a = hudA * prog(t, s0!, s0! + 0.2);
    if (a > 0) {
      const cx = tx - 70, cy = ty + 44, R = 58;
      const acc = Math.abs(this.thT.d(t + 0.02) - this.thT.d(t - 0.02)) / 0.04;
      const hot = smoothstep(4, 30, acc);
      for (let i = 0; i <= 24; i++) {
        const v = i * 5;
        const ang = Math.PI * (1 + v / 120);
        const len = i % 6 === 0 ? 11 : 6;
        const on = v <= rpm + 0.1;
        const col = on && t > this.tSpin ? sc(LIN.signal, 1.2) : sc(LIN.bone, on ? 0.6 : 0.2);
        this.lines.seg2(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, cx + Math.cos(ang) * (R - len), cy + Math.sin(ang) * (R - len), i % 6 === 0 ? 1.3 : 0.9, col, a);
      }
      const na = Math.PI * (1 + Math.min(rpm, 125) / 120);
      this.lines.seg2(cx, cy, cx + Math.cos(na) * (R - 4), cy + Math.sin(na) * (R - 4), 1.6, t > this.tSpin ? sc(LIN.ember, 1.6) : sc(LIN.bone, 0.8), a);
      this.glow.seg2(cx, cy, cx + 0.01, cy, 5, sc(LIN.ember, 1.0 * a), 1);
      c.font = font(F.mono(600), 11);
      c.textAlign = 'center';
      c.fillStyle = rgba('ash', 0.6 * a);
      for (const v of [0, 30, 60, 90, 120]) {
        const ang = Math.PI * (1 + v / 120);
        c.fillText(String(v), cx + Math.cos(ang) * (R + 14), cy + Math.sin(ang) * (R + 14) + 4);
      }
      c.textAlign = 'right';
      c.font = font(F.mono(600), 40);
      c.fillStyle = hot > 0.05 ? hotCss(0.36 * (1 - hot), a) : rgba('bone', 0.92 * a);
      c.fillText(rpm.toFixed(1).padStart(5, '0'), tx + 20, ty + 104);
      c.font = font(F.mono(500), 12);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('ash', 0.75 * a);
      c.fillText('RPM', tx + 20, ty + 124);
      c.fillText(`ω ${Math.abs(wD).toFixed(2)} rad/s`, tx + 20, ty + 142);
      c.letterSpacing = '0px';
      if (t > this.tSpin + 0.1) this.label(c, 'SPUN UP IN 0.3 s. NO ONE TOUCHED IT.', tx + 20, ty + 164, t, this.tSpin + 0.25, 0.6 * a, { size: 11, align: 'right', cool: 'ash' });
      if (t > this.tSpin + 0.3) this.label(c, '16 SLITS × 1.5 REV/S = 24 FPS', tx + 20, ty + 232, t, this.tSpin + 0.4, 0.75 * a, { size: 12, align: 'right', w: 600 });
    }
    // strobe readout: the frame now in the window
    if (t > this.tSpin + 0.15) {
      const k = Math.round((-rel - this.phiS) / DELTA);
      const fr = mod(k + 8, 16) + 1;
      const b = hudA * prog(t, this.tSpin + 0.15, this.tSpin + 0.3);
      c.textAlign = 'right';
      c.font = font(F.mono(600), 13);
      c.fillStyle = rgba('bone', 0.85 * b);
      c.fillText(`FRAME ${String(fr).padStart(2, '0')} / 16`, W - 76, 292);
    }
    // FRAMES, the in-world counter, on the maker's plate (bottom right)
    {
      const b = hudA * prog(t, s0! + 0.1, s0! + 0.3);
      const bx = W - 96, by = H - 96;
      c.textAlign = 'right';
      c.font = font(F.mono(500), 12);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('ash', 0.7 * b);
      c.fillText('FRAMES', bx, by - 34);
      c.letterSpacing = '0px';
      c.font = font(F.mono(600), 30);
      const n = frames(t);
      const ft = 1 - ((t * 24) % 1);
      c.fillStyle = rgba('bone', 0.92 * b);
      c.fillText(n.toLocaleString('en-US').padStart(5, '0'), bx, by);
      this.lines.seg2(bx - 150, by + 12, bx, by + 12, 1, sc(LIN.bone, 0.35), b);
      this.lines.seg2(bx - 150 * ft, by + 12, bx, by + 12, 1.4, sc(LIN.signal, 1.3), b);
    }
    // the patent plate caption (bottom left)
    {
      const b = hudA * prog(t, s2!, s2! + 0.2);
      if (b > 0) {
        c.textAlign = 'left';
        c.font = font(F.serif(400, true), 30);
        c.fillStyle = rgba('bone', 0.85 * b);
        const s = 'Fig. 7 — say it once, it loops.';
        const n = Math.min(s.length, Math.floor((t - s2!) * 45));
        c.fillText(s.slice(0, n), x0, H - 110);
        this.label(c, 'ONE PROMPT FILM CO. · PATENT PENDING · SHEET 7 OF 16', x0, H - 82, t, s2! + 0.5, 0.5 * b, { size: 11, cool: 'ash' });
      }
    }
    c.restore();
  }
}

function mod(x: number, m: number) { return ((x % m) + m) % m; }
