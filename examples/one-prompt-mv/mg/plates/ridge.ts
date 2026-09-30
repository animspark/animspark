// Plate `ridge` — "Hear it hit, it doesn't stop" (sound department).
// The song's own spectrogram as an engraved ridgeline plot: one hairline per 1/30 s mel slice (48 bands,
// Catmull-Rom'd to M points, low frequencies left), stacked in perspective with hidden lines removed
// (ink fill strips that write depth; the lines are depth-tested). The front ridge is now: it is signal,
// the stylus (the caret, as a scope beam) sweeps it on the beats and leaves a heat wake that the history
// carries back; older slices cool bone → ash → graphite and go into the fog.
// Arrival: the four letters of "drop" keep falling on handoff.dropLetter while the camera descends onto
// the field; they hit the front ridge on "hit," and shatter into sparks along it; the impact is recorded
// as a spike in the slices of that instant (a scar that recedes) and a ripple runs back through the
// history. The lyric rides a smoothed envelope of the front ridge; each phrase, once sung, is carried
// back by the scroll ("it doesn't stop"). Exit (H3): the field flattens and the camera sinks to the plane:
// every ridge merges into one bone hairline at GROUND_H3.y, the spark parked on it at GROUND_H3.sparkX.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H, clearRT } from '../px/gl';
import { LineBatch } from '../px/lines';
import { sparkHead, sparkParticles } from '../px/motifs';
import { F, font, layout, smart, type TextLayout } from '../px/type';
import { LIN, rgba } from '../px/palette';
import { clamp, lerp, ease, prog, pulse, hash, noise1, TAU } from '../px/util';
import { wStart, wEnd, wText, charTimes } from './lyric';
import { dropLetter, GROUND_H3, frames } from './handoff';
import { FillStrips, DepthComp } from './ridge-gl';

// ------------------------------------------------------------------ the instrument
const MEL_FPS = 30;
const M = 224; // points per ridge
const XW = 3.2; // ridge half-width (world)
const HIST = 3.4; // seconds of history on screen
const S = 4.6; // world depth per second of history
const AMP = 1.8; // world height of a full-scale (shaped) band
const TILT = 0.26, FLOOR = 0.04, GAM = 1.25; // display shaping: +tilt toward the highs (≈ +4.5 dB/oct)
const TXT = 0.44; // lyric font size (world)
const LIFT = 0.05; // lyric baseline above the ridge envelope (world)
const LIFT_PRE = 0.62; // … before the snap
const MAXR = 110;
const XCOL = -XW - 0.16; // time axis / dB axis (left side)
const XRCOL = XW + 0.16; // word lane (right side)
const STRIP = { x0: 96, y0: 214, x1: 1824, y1: 318 }; // fig. 3a (px)
const STRIP_SPAN = 8, STRIP_NOW = 0.8;
const LADV = 38.4, LBASE = 17; // the prompt plate's letter cell: advance, baseline below the pivot
const Y_PRE = 230; // horizon (px) while descending onto the field

// Slaney mel (librosa default), fmin 40, fmax 12000, 48 bands: u (0..1 across the ridge) of a frequency
const melS = (f: number) => (f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27));
const MEL0 = melS(40), MELSTEP = (melS(12000) - melS(40)) / 49;
const uOfHz = (f: number) => ((melS(f) - MEL0) / MELSTEP - 1) / 47;
const taper = (u: number) => { const a = clamp(u / 0.035), b = clamp((1 - u) / 0.035); return a * a * (3 - 2 * a) * b * b * (3 - 2 * b); };
const shape = (v: number, u: number) => Math.pow(clamp(v + TILT * u - FLOOR), GAM);
const cr = (p0: number, p1: number, p2: number, p3: number, x: number) => {
  const x2 = x * x, x3 = x2 * x;
  return 0.5 * (2 * p1 + (-p0 + p2) * x + (2 * p0 - 5 * p1 + 4 * p2 - p3) * x2 + (-p0 + 3 * p1 - 3 * p2 + p3) * x3);
};
const xOfJ = (j: number) => -XW + (2 * XW * j) / (M - 1);
const jOfX = (X: number) => ((X + XW) / (2 * XW)) * (M - 1);

type Cam = { f: number; zrF: number; hC: number; yH: number; cx: number; Xc: number; sx: number; sy: number };
type P2 = { x: number; y: number };
type Sweep = { t0: number; t1: number; X0: number; X1: number; e: 'io' | 'oc' };
interface PGlyph { ch: string; X: number; w: number; wi: number; tg: number; fam: string; x62?: number; x125?: number; w62?: number; w125?: number }

const E_IO = (p: number) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p));
const E_IO_INV = (x: number) => (x < 0.5 ? Math.sqrt(x / 2) : 1 - Math.sqrt((1 - x) / 2));
const E_OC = (p: number) => 1 - (1 - p) ** 3;
const E_OC_INV = (x: number) => 1 - Math.cbrt(1 - x);

export default class Ridge extends Scene {
  // background: ink, a haze on the horizon, and fig. 3a — the same song as 48 engraved rows whose line
  // weight is the band level, scrolling past a playhead (8 s: 6.4 s heard, 1.6 s not yet, dimmer)
  bg = new FSPass(/* glsl */ `
    uniform float yH, haze, tNow, nCols, stripA;
    uniform vec4 rect; // x0, y0, x1, y1 (px, y down)
    uniform sampler2D mel;
    void main() {
      vec2 p = FRAG_PX; float y = ${H.toFixed(1)} - p.y;
      vec3 col = C_INK + C_GRAPHITE * 0.035 * haze * exp(-abs(y - yH) / 150.0);
      if (stripA > 0.0 && p.x > rect.x && p.x < rect.z && y > rect.y && y < rect.w) {
        float u = (p.x - rect.x) / (rect.z - rect.x);
        float v = 1.0 - (y - rect.y) / (rect.w - rect.y);
        float tau = tNow + (u - ${STRIP_NOW.toFixed(3)}) * ${STRIP_SPAN.toFixed(2)};
        float rb = v * 48.0, b = floor(rb), fr = abs(fract(rb) - 0.5);
        float val = texture(mel, vec2((tau * ${MEL_FPS.toFixed(1)} + 0.5) / nCols, (b + 0.5) / 48.0)).r;
        float hw = 0.06 + 0.4 * val * val;
        float aa = fwidth(rb);
        float ink = 1.0 - smoothstep(hw - aa, hw + aa, fr);
        float future = step(tNow, tau);
        float age = max(0.0, tNow - tau);
        float I = mix(0.55, 0.16, future) * (0.35 + 0.65 * exp(-age / 3.0));
        vec3 lc = mix(C_ASH, C_BONE, smoothstep(0.35, 0.8, val));
        float hot = smoothstep(0.72, 0.95, val) * exp(-age / 0.6) * (1.0 - future);
        lc = mix(lc, C_SIGNAL * 1.05, hot);
        col = mix(col, lc * I, ink * stripA);
        // the playhead
        float ph = abs(p.x - (rect.x + ${STRIP_NOW.toFixed(3)} * (rect.z - rect.x)));
        col += C_SIGNAL * 1.1 * stripA * (1.0 - smoothstep(0.6, 1.4, ph));
      }
      fragColor = vec4(col, 1.0);
    }`, { yH: { value: 500 }, haze: { value: 1 }, tNow: { value: 0 }, nCols: { value: 1 }, stripA: { value: 0 }, rect: { value: new THREE.Vector4(96, 214, 1824, 318) }, mel: { value: null } });
  melTex: THREE.DataTexture | null = null;
  strips = new FillStrips(MAXR, M);
  LR = new LineBatch(48000, { screen2D: true, blend: 'max', depthTest: true });
  LS = new LineBatch(12000, { screen2D: true, blend: 'add' });
  top = new Layer2D();
  layA = new Layer2D();
  layB = new Layer2D();
  dcomp = new DepthComp();

  // timing
  T0 = 0; T1 = 0; tHit = 0; tSnap = 0; tFlat0 = 0; tRelA = 0; tRelB = 0;
  beats: number[] = [];
  downs: number[] = [];
  events: [number, number][] = [];
  sweeps: Sweep[] = [];

  // data
  nLo = 0; colH: Float32Array[] = []; colV: Float32Array[] = [];
  // camera solve
  hA = 3; hB = 2.2;
  XcHit = 1; Xk: number[] = []; contact: { x: number; y: number; bx: number; by: number; E: number }[] = [];
  Xend = 1;
  // letters
  gm: { L: number; R: number; A: number; D: number }[] = [];
  // lyric
  gA: PGlyph[] = []; gB: PGlyph[] = [];
  envA = new Float32Array(M); envB = new Float32Array(M);
  // scratch
  fh = new Float32Array(M); fv = new Float32Array(M);
  envF = new Float32Array(M);
  xs = new Float32Array(M); ys = new Float32Array(M);
  frontXs = new Float32Array(M); frontYs = new Float32Array(M);
  tmp = new Float32Array(M); tmp2 = new Float32Array(M);

  override init() {
    const au = this.ctx.audio;
    this.T0 = this.ctx.start; this.T1 = this.ctx.end;
    this.tHit = wStart(11);
    this.beats = au.beats.filter((b) => b > this.T0 - 4 && b < this.T1 + 0.6);
    this.downs = au.downbeats;
    this.tSnap = this.beats.find((b) => b > this.tHit + 0.03) ?? this.tHit + 0.08;
    this.tFlat0 = this.beats.filter((b) => b < this.T1 - 0.9).pop() ?? this.T1 - 1;
    this.tRelA = wEnd(11) + 0.04;
    this.tRelB = wEnd(14) + 0.08;
    this.events = [...au.events('kick', this.T0 - 2, this.T1), ...au.events('snare', this.T0 - 2, this.T1).map(([a, s]) => [a, s * 0.8] as [number, number])].sort((a, b) => a[0] - b[0]);

    // ---- mel columns → shaped ridge heights (M points), for the whole window plus history
    const mel = au.mel;
    this.nLo = Math.max(0, Math.floor((this.T0 - HIST - 0.5) * MEL_FPS));
    const nHi = Math.min(mel.length - 1, Math.ceil((this.T1 + 0.5) * MEL_FPS));
    for (let n = this.nLo; n <= nHi; n++) {
      const col = mel[n] ?? mel[mel.length - 1]!;
      const h = new Float32Array(M), v = new Float32Array(M);
      for (let j = 0; j < M; j++) {
        const u = j / (M - 1), b = u * 47, i = Math.floor(b), x = b - i;
        const g = (k: number) => col[clamp(k, 0, 47)] ?? 0;
        const vv = clamp(cr(g(i - 1), g(i), g(i + 1), g(i + 2), x));
        v[j] = vv; h[j] = shape(vv, u) * taper(u);
      }
      this.colH.push(h); this.colV.push(v);
    }

    // ---- fig. 3a: the whole mel spectrogram as a texture (time across, bands up)
    {
      const nc = mel.length, data = new Uint8Array(nc * 48);
      for (let n = 0; n < nc; n++) { const col = mel[n]!; for (let b = 0; b < 48; b++) data[b * nc + n] = Math.round(clamp(col[b] ?? 0) * 255); }
      const tx = new THREE.DataTexture(data, nc, 48, THREE.RedFormat, THREE.UnsignedByteType);
      tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter; tx.wrapS = THREE.ClampToEdgeWrapping; tx.wrapT = THREE.ClampToEdgeWrapping;
      tx.generateMipmaps = false; tx.needsUpdate = true;
      this.melTex = tx;
      this.bg.u.mel!.value = tx; this.bg.u.nCols!.value = nc;
    }

    // ---- letter metrics (the prompt plate's type: Plex Mono 400, 64 px, pivot at the cell centre on
    // dropLetter's (x + adv/2, y), glyph origin at (-adv/2, +17) in the rotated frame)
    const mc = document.createElement('canvas').getContext('2d')!;
    mc.font = font(F.mono(400), 64);
    for (const ch of 'drop') {
      const m = mc.measureText(ch);
      this.gm.push({ L: m.actualBoundingBoxLeft, R: m.actualBoundingBoxRight, A: m.actualBoundingBoxAscent, D: m.actualBoundingBoxDescent });
    }

    // ---- camera solve: the front ridge under the letters is at TARGET px at the hit
    this.solveContact();

    // ---- stylus sweeps (after the hit): to the right end, then one sweep per beat (ping-pong),
    // the last one arriving at GROUND_H3.sparkX on the cut
    const c1 = this.camAt(this.T1, false);
    this.Xend = c1.Xc + ((GROUND_H3.sparkX - c1.cx) * c1.zrF) / c1.f;
    const bs = this.beats.filter((b) => b >= this.tSnap - 1e-3 && b <= this.T1 + 1e-3);
    this.sweeps.push({ t0: this.tHit, t1: this.tSnap, X0: this.XcHit, X1: XW - 0.05, e: 'oc' });
    const nS = bs.length - 1;
    for (let k = 0; k < nS; k++) {
      const last = k === nS - 1;
      const lr = (nS - 1 - k) % 2 === 0; // the last sweep runs left → right
      this.sweeps.push({ t0: bs[k]!, t1: last ? this.T1 : bs[k + 1]!, X0: lr ? -XW + 0.05 : XW - 0.05, X1: last ? this.Xend : lr ? XW - 0.05 : -XW + 0.05, e: last ? 'oc' : 'io' });
    }

    // ---- lyric layout (world X), phrase A centred "hit," on the impact, phrase B left of centre
    this.buildLyric();
  }

  // ================================================================ data access
  col(n: number) { return clamp(n - this.nLo, 0, this.colH.length - 1); }
  /** Heights (shaped, 0..1) and raw values at slice time τ (interpolated between columns). */
  sliceAt(tau: number, h: Float32Array, v: Float32Array | null) {
    const x = tau * MEL_FPS, n = Math.floor(x), fr = x - n;
    const a = this.colH[this.col(n)]!, b = this.colH[this.col(n + 1)]!;
    for (let j = 0; j < M; j++) h[j] = a[j]! + (b[j]! - a[j]!) * fr;
    if (v) {
      const va = this.colV[this.col(n)]!, vb = this.colV[this.col(n + 1)]!;
      for (let j = 0; j < M; j++) v[j] = va[j]! + (vb[j]! - va[j]!) * fr;
    }
  }
  heightAt(tau: number, X: number) {
    const x = tau * MEL_FPS, n = Math.floor(x), fr = x - n;
    const jj = clamp(jOfX(X), 0, M - 1.001), j = Math.floor(jj), fj = jj - j;
    const a = this.colH[this.col(n)]!, b = this.colH[this.col(n + 1)]!;
    const ha = a[j]! + (a[j + 1]! - a[j]!) * fj, hb = b[j]! + (b[j + 1]! - b[j]!) * fj;
    return ha + (hb - ha) * fr;
  }
  ampMul(t: number) { return 1 - prog(t, this.tFlat0, this.T1 - 0.1, ease.inOutCubic); }
  exitK(t: number) { return prog(t, this.tFlat0, this.T1 - 0.06, ease.inOutCubic); }
  /** The impact recorded in the slices of that instant (moves back with them). */
  scar(tau: number, X: number) {
    if (tau < this.tHit || !this.Xk.length) return 0;
    const e = Math.exp(-(tau - this.tHit) / 0.075);
    if (e < 0.01) return 0;
    let s = 0.28 * Math.exp(-(((X - this.XcHit) / 0.9) ** 2));
    for (const xk of this.Xk) s += 0.62 * Math.exp(-(((X - xk) / 0.12) ** 2));
    return s * e;
  }
  /** The ripple of the impact, running back through the history. */
  ripple(a: number, X: number, t: number) {
    const s = t - this.tHit;
    if (s < 0 || s > 1.4) return 0;
    const ar = s * 3.1, d = (a - ar) / 0.075;
    if (Math.abs(d) > 4) return 0;
    const across = 0.3 + 0.7 * Math.exp(-(((X - this.XcHit) / 1.5) ** 2));
    return 0.42 * Math.exp(-s / 0.5) * across * Math.exp(-d * d) * Math.cos(d * 1.3);
  }
  /** Kick/snare pulses travelling back through the slices (brightness, per age). */
  beatPulse(a: number, t: number) {
    let p = 0;
    for (const [te, s] of this.events) {
      if (te > t) break;
      const dt = t - te;
      if (dt > 1.2) continue;
      const d = (a - dt * 3.6) / 0.045;
      if (Math.abs(d) < 4) p += s * Math.exp(-d * d) * Math.exp(-dt / 0.55);
    }
    return p;
  }
  /** World height of the slice at τ (age a) at X, everything included. */
  worldY(tau: number, a: number, X: number, t: number) {
    const bp = this.beatPulse(a, t);
    return (AMP * this.heightAt(tau, X) + this.scar(tau, X) + this.ripple(a, X, t) + 0.05 * bp) * this.ampMul(t);
  }

  // ================================================================ camera
  camAt(t: number, withShake = true): Cam {
    const hit = this.tHit;
    const u = clamp((t - this.T0) / (hit - this.T0));
    const snap = prog(t, this.tSnap - 0.01, this.tSnap + 0.5, ease.outExpo);
    const creep = prog(t, this.tSnap, this.tFlat0);
    const ex = this.exitK(t);
    // descend onto the field at a constant rate from the cut, stop dead on the hit; snap to the grazing view on the next beat
    // (front-loaded: most of the descent happens early, so "Hear" is on screen when it is sung)
    const w = 1 - u;
    let hC = t < hit ? this.hB + (this.hA - this.hB) * (0.68 * w * w * w + 0.32 * w) : this.hB;
    hC = lerp(hC, 2.05, snap) - 0.2 * creep;
    hC = lerp(hC, 0, ex);
    let yH = lerp(Y_PRE, 372, snap) - 16 * creep;
    yH = lerp(yH, GROUND_H3.y, ex);
    let zrF = 5.2 - 0.3 * snap - 0.2 * prog(t, this.tSnap, this.T1, ease.inOutQuad);
    // log-zoom: a nod per sung word (a staircase), a creep after "stop", kick punches after the hit
    let lf = 0;
    for (let i = 9; i <= 14; i++) lf += 0.02 * ease.outExpo(prog(t, wStart(i), wStart(i) + 0.2));
    lf += 0.05 * prog(t, wEnd(14), this.T1, ease.inOutQuad);
    if (t > hit) lf += 0.014 * this.ctx.audio.hit('kick', t, 0.1) * (1 - ex);
    const f = 1300 * Math.exp(lf);
    const Xc = 0.3 * prog(t, hit, this.T1, ease.inOutQuad);
    let sx = 0, sy = 0;
    if (withShake) {
      const au = this.ctx.audio;
      const k = (t < hit ? 2.5 : 3.5) * (au.hit('kick', t, 0.1) + 0.8 * au.hit('snare', t, 0.12)) * (1 - ex);
      sx = k * noise1(t * 43, 3); sy = k * noise1(t * 47, 4);
    }
    return { f, zrF, hC, yH, cx: W / 2, Xc, sx, sy };
  }
  proj(c: Cam, X: number, Y: number, a: number): P2 & { s: number } {
    const zr = c.zrF + S * a, k = c.f / zr;
    return { x: c.cx + k * (X - c.Xc) + c.sx, y: c.yH + k * (c.hC - Y) + c.sy, s: k };
  }
  depth(a: number) { return -0.95 + 1.8 * clamp(a / (HIST + 0.25)); }

  /** Solve the pre-hit camera height so the letters land on the front ridge at the hit. */
  solveContact() {
    const TARGET = 1030; // px: the front ridge under the letters at the hit
    const th = this.tHit;
    const c = this.camAt(th, false);
    const bottoms = [0, 1, 2, 3].map((k) => {
      const d = dropLetter(k, th), g = this.gm[k]!;
      const cs = Math.cos(d.rot), sn = Math.sin(d.rot);
      let best = { x: 0, y: -1e9 };
      for (const [px0, py0] of [[-g.L, -g.A], [g.R, -g.A], [-g.L, g.D], [g.R, g.D]] as const) {
        const px = px0 - LADV / 2, py = py0 + LBASE;
        const rx = px * cs - py * sn, ry = px * sn + py * cs;
        if (ry > best.y) best = { x: rx, y: ry };
      }
      return { d, bx: best.x, by: best.y };
    });
    const xOf = (sx: number) => c.Xc + ((sx - c.cx) * c.zrF) / c.f;
    this.Xk = bottoms.map((b) => xOf(b.d.x + LADV / 2 + b.bx));
    this.XcHit = this.Xk.reduce((s, x) => s + x, 0) / 4;
    const Yc = AMP * this.heightAt(th, this.XcHit);
    this.hB = ((TARGET - c.yH) * c.zrF) / c.f + Yc;
    this.hA = this.hB + (220 * c.zrF) / c.f; // the front starts 220 px lower and rises, still moving when they meet
    const c2 = this.camAt(th, false);
    this.contact = bottoms.map((b, k) => {
      const yr = c2.yH + (c2.f * (c2.hC - AMP * this.heightAt(th, this.Xk[k]!))) / c2.zrF;
      const E = Math.max(0, yr - (b.d.y + b.by));
      return { x: b.d.x + LADV / 2, y: b.d.y + E, bx: b.bx, by: b.by, E };
    });
  }

  // ================================================================ stylus
  stylusX(t: number): number | null {
    if (t < this.tHit) return null;
    for (const s of this.sweeps) {
      if (t <= s.t1 + 1e-6) {
        const p = clamp((t - s.t0) / (s.t1 - s.t0));
        return lerp(s.X0, s.X1, s.e === 'io' ? E_IO(p) : E_OC(p));
      }
    }
    return this.Xend;
  }
  /** When the stylus last passed X, as of τ (or -1). */
  passTime(X: number, tau: number) {
    let n = 0;
    for (let i = this.sweeps.length - 1; i >= 0 && n < 3; i--) {
      const s = this.sweeps[i]!;
      if (s.t0 > tau) continue;
      n++;
      const lo = Math.min(s.X0, s.X1), hi = Math.max(s.X0, s.X1);
      if (X < lo || X > hi) continue;
      const q = (X - s.X0) / (s.X1 - s.X0);
      const p = s.e === 'io' ? E_IO_INV(clamp(q)) : E_OC_INV(clamp(q));
      const tp = s.t0 + p * (s.t1 - s.t0);
      if (tp <= tau) return tp;
    }
    return -1;
  }
  stylusScreen(tb: number): P2 | null {
    const X = this.stylusX(tb);
    if (X === null) return null;
    const c = this.camAt(tb);
    const p = this.proj(c, X, this.worldY(tb, 0, X, tb), 0);
    return { x: p.x, y: p.y };
  }

  // ================================================================ lyric
  buildLyric() {
    const famN = F.archivo(100, 900), famHit = F.archivo(112.5, 900);
    const gap = 0.24; // word gap (em)
    const k = TXT / 100;
    const mk = (words: number[], famOf: (wi: number) => string) => {
      const out: PGlyph[] = [];
      let x = 0;
      for (const wi of words) {
        const txt = smart(wText(wi)), fam = famOf(wi), lay = layout(txt, fam, 100);
        const ct = charTimes(wi);
        lay.glyphs.forEach((g, j) => out.push({ ch: g.ch, X: (x + g.x) * k, w: g.w * k, wi, tg: ct[j] ?? wStart(wi), fam }));
        x += lay.width + gap * 100;
      }
      return { g: out, width: (x - gap * 100) * k };
    };
    // A: "Hear it hit," — "hit," centred on the impact
    const A = mk([9, 10, 11], (wi) => (wi === 11 ? famHit : famN));
    const hitG = A.g.filter((g) => g.wi === 11);
    const hitC = (hitG[0]!.X + hitG[hitG.length - 1]!.X + hitG[hitG.length - 1]!.w) / 2;
    const x0 = clamp(this.XcHit - hitC, -XW + 0.15, XW - 0.15 - A.width);
    for (const g of A.g) g.X += x0;
    this.gA = A.g;
    // B: "it doesn't stop" — "stop" stretches 62 → 125 while it is held
    const B = mk([12, 13], () => famN);
    const stopTxt = smart(wText(14));
    const l62 = layout(stopTxt, F.archivo(62, 900), 100), l125 = layout(stopTxt, F.archivo(125, 900), 100);
    const xs = B.width / k + gap * 100;
    const ct = charTimes(14);
    const stopG: PGlyph[] = l62.glyphs.map((g, j) => ({ ch: g.ch, X: (xs + g.x) * k, w: g.w * k, wi: 14, tg: ct[j] ?? wStart(14), fam: F.archivo(62, 900), x62: (xs + g.x) * k, x125: (xs + l125.glyphs[j]!.x) * k, w62: g.w * k, w125: l125.glyphs[j]!.w * k }));
    const wB = (xs + l125.width) * k;
    const xb0 = clamp(-wB / 2 - 0.35, -XW + 0.12, XW - 0.12 - wB);
    for (const g of [...B.g, ...stopG]) { g.X += xb0; if (g.x62 !== undefined) { g.x62 += xb0; g.x125! += xb0; } }
    this.gB = [...B.g, ...stopG];
    this.envOf(this.tRelA, this.envA, 1);
    this.envOf(this.tRelB, this.envB, 1);
  }
  /** Smoothed upper envelope of the slice at τ (time-smoothed over 3 columns), world Y, unscaled by ampMul. */
  envOf(tau: number, out: Float32Array, amp: number) {
    const h = this.tmp, g = this.tmp2;
    const ws = [0.5, 0.3, 0.2];
    for (let j = 0; j < M; j++) h[j] = 0;
    ws.forEach((w, i) => {
      this.sliceAt(tau - i / MEL_FPS, g, null);
      for (let j = 0; j < M; j++) h[j] += w * g[j]!;
    });
    // max filter ±5, then a gaussian (σ 7 points)
    const R = 5;
    for (let j = 0; j < M; j++) { let m = 0; for (let q = Math.max(0, j - R); q <= Math.min(M - 1, j + R); q++) m = Math.max(m, h[q]!); g[j] = m; }
    const sg = 7, KR = 18;
    for (let j = 0; j < M; j++) {
      let s = 0, ws2 = 0;
      for (let q = -KR; q <= KR; q++) { const jj = clamp(j + q, 0, M - 1); const w = Math.exp(-(q * q) / (2 * sg * sg)); s += w * g[jj]!; ws2 += w; }
      out[j] = (AMP * s) / ws2 * amp;
    }
  }
  envY(env: Float32Array, X: number) {
    const jj = clamp(jOfX(X), 0, M - 1.001), j = Math.floor(jj), f = jj - j;
    return env[j]! + (env[j + 1]! - env[j]!) * f;
  }

  // ================================================================ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    const c = this.camAt(t);
    const ex = this.exitK(t);
    const am = this.ampMul(t);

    clearRT(renderer, out, LIN.ink);
    this.bg.u.yH!.value = c.yH; this.bg.u.haze!.value = 1 - ex;
    this.bg.u.tNow!.value = t;
    this.bg.u.stripA!.value = prog(t, this.T0, this.T0 + 0.3, ease.outCubic) * (1 - prog(t, this.tFlat0 + 0.05, this.T1 - 0.3));
    this.bg.render(renderer, out);

    // ------------------------------------------------ ridges
    const LR = this.LR; LR.clear();
    const fogClose = lerp(1, 0.18, ex); // the fog closes in on the exit: only the front survives
    let nr = 0;
    const nNow = Math.floor(t * MEL_FPS);
    for (let r = 0; r < MAXR; r++) {
      let tau: number, a: number;
      if (r === 0) { tau = t; a = 0; } else { const n = nNow - (r - 1); tau = n / MEL_FPS; a = t - tau; }
      if (a > HIST) break;
      const h = this.fh, v = this.fv;
      if (r === 0) this.sliceAt(t, h, v);
      else { const ci = this.col(Math.round(tau * MEL_FPS)); h.set(this.colH[ci]!); v.set(this.colV[ci]!); }
      const vis = Math.exp(-Math.max(0, a - 0.25) / (1.55 * fogClose)) * (1 - prog(a, HIST - 0.7, HIST)) * (r === 0 ? 1 : 1 - ex * 0.85);
      const bp = this.beatPulse(a, t);
      const zr = c.zrF + S * a, kk = c.f / zr;
      const xs = this.xs, ys = this.ys;
      const hasScar = tau >= this.tHit && tau < this.tHit + 0.4;
      const hasRip = t > this.tHit && t < this.tHit + 1.4;
      for (let j = 0; j < M; j++) {
        const X = xOfJ(j);
        let Y = AMP * h[j]! + 0.05 * bp;
        if (hasScar) Y += this.scar(tau, X);
        if (hasRip) Y += this.ripple(a, X, t);
        Y *= am;
        xs[j] = c.cx + kk * (X - c.Xc) + c.sx;
        ys[j] = c.yH + kk * (c.hC - Y) + c.sy;
      }
      if (r === 0) { this.frontXs.set(xs); this.frontYs.set(ys); }
      const dep = this.depth(a);
      this.strips.setRidge(nr, xs, ys, dep, vis);
      nr++;
      if (vis < 0.01) continue;
      // colour: heat by age, loud peaks keep warm, the stylus wake, the beat pulses; cool to bone → ash → graphite
      const cool = Math.exp(-a / 0.2);
      const k1 = clamp((a - 0.25) / 1.1), k2 = clamp((a - 1.2) / 1.5);
      const baseI = lerp(lerp(0.66, 0.46, k1), 0.3, k2);
      const bc = [lerp(lerp(LIN.bone[0], LIN.ash[0], k1), LIN.graphite[0], k2), lerp(lerp(LIN.bone[1], LIN.ash[1], k1), LIN.graphite[1], k2), lerp(lerp(LIN.bone[2], LIN.ash[2], k1), LIN.graphite[2], k2)];
      const wakeOn = t > this.tHit && a < 0.9;
      const width = r === 0 ? lerp(1.9, 1.25, ex) : lerp(1.25, 0.8, clamp(a / 2.5));
      const hotScale = am; // the flattened line cools to bone
      for (let j = 0; j < M - 1; j++) {
        const X = xOfJ(j + 0.5);
        const vv = 0.5 * (v[j]! + v[j + 1]!);
        const peak = clamp((vv - 0.52) / 0.33) * Math.exp(-a / 1.0);
        let hot = Math.max(cool, 0.75 * peak) * hotScale;
        let tip = 0, tail = 0;
        if (wakeOn) {
          const tp = this.passTime(X, tau);
          if (tp >= 0) { const since = tau - tp; const ca = Math.exp(-a / 0.22); tip = Math.exp(-since / 0.05) * ca; tail = Math.exp(-since / lerp(0.32, 0.07, ex)) * ca; }
        }
        hot = Math.max(hot, tail);
        const I = baseI * vis;
        let R = bc[0]! * I, G = bc[1]! * I, B = bc[2]! * I;
        const sI = (r === 0 ? 1.3 : 1.05) * vis;
        R = lerp(R, LIN.signal[0] * sI, hot); G = lerp(G, LIN.signal[1] * sI, hot); B = lerp(B, LIN.signal[2] * sI, hot);
        R += (LIN.ember[0] * 2.4 * tip + 0.35 * bp * LIN.bone[0]) * vis; G += (LIN.ember[1] * 2.4 * tip + 0.35 * bp * LIN.bone[1]) * vis; B += (LIN.ember[2] * 2.4 * tip + 0.35 * bp * LIN.bone[2]) * vis;
        LR.seg(xs[j]!, ys[j]!, dep - 0.0015, xs[j + 1]!, ys[j + 1]!, dep - 0.0015, width * (1 + 0.8 * tip), R, G, B, 1);
        if (r === 0 || tip > 0.05) {
          const g = (r === 0 ? 0.16 : 0) * hot + 0.25 * tip;
          if (g > 0.01) LR.seg(xs[j]!, ys[j]!, dep - 0.0012, xs[j + 1]!, ys[j + 1]!, dep - 0.0012, 7 + 6 * tip, LIN.signal[0] * g, LIN.signal[1] * g, LIN.signal[2] * g, 1);
        }
      }
    }
    this.drawWorldLines(t, c, LR, ex);
    this.strips.mat.uniforms.uHatch!.value = 1 - ex;
    this.strips.render(renderer, out, nr);
    LR.render(renderer, out);

    // ------------------------------------------------ the lyric (each phrase at its depth)
    this.envOf(t, this.envF, 1);
    const thrown = (s0: number) => (s0 <= 0 ? 0 : s0 + 1.1 * (1 - Math.exp(-s0 / 0.22)));
    const aA = thrown(t - this.tRelA), aB = thrown(t - this.tRelB);
    const A = this.layA; A.clear();
    this.drawPhrase(A.ctx, this.gA, t, c, t < this.tRelA ? this.envF : this.envA, aA, am, ex);
    // (a thrown phrase stays on top of the field until it is well back in it)
    this.dcomp.draw(renderer, A.upload(), out, this.depth(Math.max(0, aA - 0.55)) - 0.004);
    const B = this.layB; B.clear();
    this.drawPhrase(B.ctx, this.gB, t, c, t < this.tRelB ? this.envF : this.envB, aB, am, ex);
    this.dcomp.draw(renderer, B.upload(), out, this.depth(Math.max(0, aB - 0.55)) - 0.004);

    // ------------------------------------------------ annotations, letters, readouts
    const T = this.top; T.clear();
    this.drawAnnotations(T.ctx, t, c, ex);
    this.drawLetters(T.ctx, t);
    this.ctx.comp.draw(renderer, T.upload(), out);

    // ------------------------------------------------ sparks: impact bursts, embers along the ridge, the stylus
    const LS = this.LS; LS.clear();
    this.drawSparks(LS, t, c, ex);
    LS.render(renderer, out);

    // ------------------------------------------------ post
    const ph = pulse(t, this.tHit, 0.09);
    const lastFrames = prog(t, this.T1 - 0.2, this.T1 - 0.05); // the hand-off frame is still
    const shA = (16 * ph + 5 * pulse(t, this.tSnap, 0.08)) * (1 - lastFrames);
    return {
      bloom: 0.75, halation: 0.28, vignette: 0.42 - 0.12 * ex,
      shake: [shA * noise1(t * 41, 7), shA * noise1(t * 37, 8)],
      zoom: 1 + 0.04 * ph * (1 - lastFrames),
      flash: 0.018 * pulse(t, this.tHit, 0.03),
      ca: 1.2 + 1.8 * ph,
    };
  }

  // ================================================================ axes and world-attached furniture (depth-tested lines)
  drawWorldLines(t: number, c: Cam, L: LineBatch, ex: number) {
    const fade = 1 - prog(t, this.tFlat0 + 0.1, this.T1 - 0.25);
    const bone = LIN.bone, ash = LIN.ash, gr = LIN.graphite;
    const seg = (x0: number, y0: number, a0: number, x1: number, y1: number, a1: number, w: number, col: readonly number[], I: number) => {
      const p = this.proj(c, x0, y0, a0), q = this.proj(c, x1, y1, a1);
      L.seg(p.x, p.y, this.depth(Math.min(a0, a1)) - 0.006, q.x, q.y, this.depth(Math.min(a0, a1)) - 0.006, w, col[0]! * I, col[1]! * I, col[2]! * I, 1);
    };
    // the front baseline, extended across the whole frame: at the exit it is the ground line
    {
      const p = this.proj(c, -40, 0, 0), q = this.proj(c, 40, 0, 0);
      const inPlot = lerp(0.32, 0.62, ex);
      const dep = this.depth(0) - 0.006;
      const pl = this.proj(c, -XW, 0, 0), pr = this.proj(c, XW, 0, 0);
      L.seg(p.x, p.y, dep, pl.x, pl.y, dep, 1.2, bone[0] * inPlot, bone[1] * inPlot, bone[2] * inPlot, 1);
      L.seg(pr.x, pr.y, dep, q.x, q.y, dep, 1.2, bone[0] * inPlot, bone[1] * inPlot, bone[2] * inPlot, 1);
      L.seg(pl.x, pl.y, dep, pr.x, pr.y, dep, 1.0, gr[0] * 0.5 * fade, gr[1] * 0.5 * fade, gr[2] * 0.5 * fade, 1);
    }
    if (fade <= 0) return;
    // frequency axis: the 48 band centres, 1-2-5 Hz ticks, labelled majors
    for (let b = 0; b < 48; b++) { const X = xOfJ((b / 47) * (M - 1)); seg(X, 0, 0, X, -0.03, 0, 1, ash, 0.45 * fade); }
    for (const hz of HZ_MINOR) { const u = uOfHz(hz); if (u < 0 || u > 1) continue; const X = -XW + 2 * XW * u; seg(X, -0.02, 0, X, -0.075, 0, 1, bone, 0.55 * fade); }
    for (const [hz] of HZ_MAJOR) { const u = uOfHz(hz); if (u < 0 || u > 1) continue; const X = -XW + 2 * XW * u; seg(X, 0, 0, X, -0.13, 0, 1.2, bone, 0.8 * fade); }
    // dB axis (front-left): 0 .. −70 dB at the untilted scale
    seg(XCOL, 0, 0, XCOL, AMP * 1.0, 0, 1.1, bone, 0.6 * fade);
    for (let db = 0; db >= -70; db -= 5) {
      const Y = AMP * shape(1 + db / 70, 0), major = db % 10 === 0;
      seg(XCOL, Y, 0, XCOL - (major ? 0.1 : 0.05), Y, 0, 1, major ? bone : ash, (major ? 0.7 : 0.45) * fade);
    }
    // time axis (left side, receding): beats, downbeats, kick/snare lanes, the word lane (right side)
    const fogA = (a: number) => Math.exp(-a / 1.6) * (1 - prog(a, HIST - 0.8, HIST - 0.2));
    for (let q = 0; q < 48; q++) {
      const a0 = (q / 48) * (HIST - 0.2), a1 = ((q + 1) / 48) * (HIST - 0.2), fa = fogA(a0);
      seg(XCOL, 0, a0, XCOL, 0, a1, 1.1, bone, 0.42 * fade * fa);
      seg(XRCOL, 0, a0, XRCOL, 0, a1, 1.0, ash, 0.3 * fade * fa);
    }
    for (const b of this.beats) {
      const a = t - b;
      if (a < 0 || a > HIST - 0.2) continue;
      const down = this.downs.some((d) => Math.abs(d - b) < 0.02);
      seg(XCOL, 0, a, XCOL - (down ? 0.26 : 0.12), 0, a, down ? 1.4 : 1, down ? bone : ash, (down ? 0.85 : 0.6) * fade * fogA(a));
    }
    for (const [te, s] of this.events) {
      const a = t - te;
      if (a < 0 || a > HIST - 0.2) continue;
      const kick = this.ctx.audio.events('kick', te - 1e-4, te + 1e-4).length > 0;
      const Xl = kick ? XCOL - 0.4 : XCOL - 0.52;
      seg(Xl, 0, a, Xl - 0.07 * clamp(s), 0, a, 1.6, LIN.signal, 0.9 * fade * fogA(a) * Math.max(0.35, Math.exp(-a / 0.3)));
    }
    for (let wi = 9; wi <= 14; wi++) {
      const a = t - wStart(wi);
      if (a < 0 || a > HIST - 0.2) continue;
      seg(XRCOL, 0, a, XRCOL + 0.14, 0, a, 1.2, bone, 0.75 * fade * fogA(a));
    }
    // peak hold (1.5 s, falling 0.25/s) on every other band, at the front
    for (let b = 1; b < 48; b += 2) {
      let hv = 0, hot = 0;
      for (let q = 0; q < 45; q++) {
        const tau = t - q / MEL_FPS, x = tau * MEL_FPS, n = Math.floor(x);
        const col = this.ctx.audio.mel[n] ?? [];
        const vv = (col[b] ?? 0) - 0.25 * (q / MEL_FPS);
        if (vv > hv) { hv = vv; hot = Math.exp(-(q / MEL_FPS) / 0.25); }
      }
      const u = b / 47, X = -XW + 2 * XW * u;
      const Y = (AMP * shape(hv, u) * taper(u) + 0.04) * this.ampMul(t);
      const col = [lerp(bone[0] * 0.55, LIN.signal[0] * 1.2, hot), lerp(bone[1] * 0.55, LIN.signal[1] * 1.2, hot), lerp(bone[2] * 0.55, LIN.signal[2] * 1.2, hot)];
      seg(X - 0.045, Y, 0, X + 0.045, Y, 0, 1.3, col, fade);
    }
  }

  // ================================================================ lyric on the ridge
  drawPhrase(cx2: CanvasRenderingContext2D, gs: PGlyph[], t: number, c: Cam, env: Float32Array, a: number, am: number, ex: number) {
    const fog = Math.exp(-a / 1.3) * (1 - prog(a, 1.9, 2.6)) * (1 - ex);
    if (fog <= 0.01) return;
    cx2.save();
    cx2.textBaseline = 'alphabetic';
    const stopK = prog(t, wStart(14), wEnd(14), ease.inOutQuad);
    // while the camera is still coming down the lyric floats higher over the front; it settles onto it on the snap
    const lift = lerp(LIFT_PRE, LIFT, prog(t, this.tSnap - 0.01, this.tSnap + 0.5, ease.outExpo));
    for (const g of gs) {
      if (g.ch === ' ') continue;
      const w0 = wStart(g.wi);
      if (t < w0 - 0.3 || (g.wi === 11 && t < g.tg)) continue;
      const sung = t >= g.tg;
      let X = g.X, w = g.w, fam = g.fam;
      if (g.x62 !== undefined) {
        X = lerp(g.x62, g.x125!, stopK); w = lerp(g.w62!, g.w125!, stopK);
        fam = F.archivo(lerp(62, 125, stopK), 900);
      }
      const hitW = g.wi === 11;
      const sz = hitW ? 1.14 : 1;
      const yl = this.envY(env, X) * am + lift, yr = this.envY(env, X + w) * am + lift;
      const pa = this.proj(c, X, yl, a), pb = this.proj(c, X + w, yr, a);
      const ang = clamp(Math.atan2(pb.y - pa.y, pb.x - pa.x), -0.2, 0.2);
      const size = pa.s * TXT * sz;
      const since = t - g.tg;
      const pop = sung ? prog(t, g.tg, g.tg + 0.16, ease.outBack as (x: number) => number) : 1;
      const slam = hitW && sung ? 1 + 0.5 * (1 - prog(since, 0, 0.14, ease.outExpo)) : 1;
      // measured advance of this instance vs the stretched target (a spring hides the width steps)
      let sxw = 1;
      if (g.x62 !== undefined) { cx2.font = font(fam, 100); const mw = cx2.measureText(g.ch).width * (TXT / 100); sxw = w / Math.max(1e-4, mw); }
      cx2.font = font(fam, 100);
      let fill: string;
      if (!sung) fill = rgba('bone', 0.26 * fog * prog(t, w0 - 0.3, w0 - 0.18));
      else fill = heatCss(Math.exp(-since / (hitW ? 0.55 : 0.28)), 0.97 * fog);
      cx2.save();
      cx2.translate(pa.x, pa.y);
      cx2.rotate(ang);
      const s = (size / 100) * slam;
      cx2.scale(s * sxw, s * (0.35 + 0.65 * pop));
      cx2.fillStyle = fill;
      cx2.fillText(g.ch, 0, 0);
      cx2.restore();
    }
    cx2.restore();
  }

  // ================================================================ the letters of "drop"
  drawLetters(c2: CanvasRenderingContext2D, t: number) {
    if (t > this.tHit + 0.9) return;
    c2.save();
    c2.font = font(F.mono(400), 64);
    c2.textBaseline = 'alphabetic';
    c2.textAlign = 'left';
    const T = this.tHit - this.T0;
    'drop'.split('').forEach((ch, k) => {
      const ct = this.contact[k]!;
      if (t < this.tHit) {
        // H2: exactly on dropLetter at the cut, then the camera stops following and they accelerate into the ridge
        const d = dropLetter(k, t);
        const u = clamp((t - this.T0) / T);
        const y = d.y + ct.E * u * u * u;
        c2.save();
        c2.translate(d.x + LADV / 2, y); c2.rotate(d.rot);
        const hot = Math.exp(-(this.tHit - t) / 0.08);
        c2.fillStyle = heatCss(hot, 1);
        c2.fillText(ch, -LADV / 2, LBASE);
        c2.restore();
        return;
      }
      // shatter: four wedges fly off, white-hot, cooling to signal and out
      const d = dropLetter(k, this.tHit);
      const g = this.gm[k]!;
      const gx = -LADV / 2 + (g.R - g.L) / 2, gy = LBASE + (g.D - g.A) / 2;
      const s0 = t - this.tHit;
      const th0 = hash(k, 11) * TAU;
      for (let i = 0; i < 4; i++) {
        const a0 = th0 + (i * TAU) / 4, a1 = a0 + TAU / 4, am = (a0 + a1) / 2;
        const life = 0.45 + 0.35 * hash(k, i, 3);
        const s = Math.max(0, s0 - 0.025);
        if (s > life) continue;
        const dirx = Math.cos(am + d.rot), diry = Math.sin(am + d.rot);
        const vx = dirx * (180 + 260 * hash(k, i, 5)) + (hash(k, i, 6) - 0.5) * 160;
        const vy = -260 - 420 * hash(k, i, 7) + diry * 120;
        const px = ct.x + vx * s, py = ct.y + vy * s + 0.5 * 1600 * s * s;
        const rot = d.rot + (hash(k, i, 8) - 0.5) * 16 * s;
        const al = 1 - s / life;
        c2.save();
        c2.translate(px, py); c2.rotate(rot);
        c2.beginPath();
        c2.moveTo(gx, gy);
        for (let q = 0; q <= 4; q++) { const aa = lerp(a0, a1, q / 4); c2.lineTo(gx + Math.cos(aa) * 80, gy + Math.sin(aa) * 80); }
        c2.closePath();
        c2.clip();
        c2.fillStyle = hotCss(Math.exp(-s / 0.16), al);
        c2.fillText(ch, -LADV / 2, LBASE);
        c2.restore();
      }
    });
    c2.restore();
  }

  // ================================================================ sparks
  drawSparks(L: LineBatch, t: number, c: Cam, ex: number) {
    const th = this.tHit;
    if (t >= th) {
      // bursts at the four contacts
      if (t < th + 0.7) {
        this.contact.forEach((ct, k) => {
          const hx = ct.x + ct.bx, hy = ct.y + ct.by;
          sparkParticles(L, t, (tb) => (tb >= th && tb <= th + 0.09 ? { x: hx, y: hy } : null), { rate: (tb) => (tb >= th && tb <= th + 0.09 ? 700 : 0), rateMax: 700, life: 0.55, speed: 480, gravity: 1100, intensity: 1.1, seed: 40 + k });
        });
      }
      // embers sliding along the front ridge, away from each impact
      const s = t - th;
      if (s < 1.3) {
        const fy = (X: number) => {
          const jj = clamp(jOfX(X), 0, M - 1.001), j = Math.floor(jj), fr = jj - j;
          return { x: this.frontXs[j]! + (this.frontXs[j + 1]! - this.frontXs[j]!) * fr, y: this.frontYs[j]! + (this.frontYs[j + 1]! - this.frontYs[j]!) * fr };
        };
        for (let k = 0; k < 4; k++) for (let i = 0; i < 16; i++) {
          const life = 0.55 + 0.6 * hash(k, i, 21);
          if (s > life) continue;
          const dir = hash(k, i, 22) < 0.5 ? -1 : 1, v0 = 1.0 + 2.8 * hash(k, i, 23), td = 0.3 + 0.2 * hash(k, i, 24);
          const Xa = this.Xk[k]! + dir * v0 * td * (1 - Math.exp(-s / td));
          const Xb = this.Xk[k]! + dir * v0 * td * (1 - Math.exp(-Math.max(0, s - 0.03) / td));
          if (Math.abs(Xa) > XW) continue;
          const pa = fy(Xa), pb = fy(Xb);
          const kk = 1 - s / life, I = 2.4 * kk;
          L.seg2(pb.x, pb.y - 2, pa.x, pa.y - 2, 1.8 * (0.5 + kk), [(LIN.signal[0] + (1 - LIN.signal[0]) * kk * kk) * I, (LIN.signal[1] + 0.7 * kk * kk) * I, (LIN.signal[2] + 0.4 * kk * kk) * I], Math.min(1, kk * 1.5));
        }
      }
      // the stylus: born from the impact, sweeping the front ridge on the beats
      const hp = this.stylusScreen(t);
      if (hp) {
        const born = prog(t, th, th + 0.05);
        sparkParticles(L, t, (tb) => (tb < th + 0.02 ? null : this.stylusScreen(tb)), { rate: 75, life: 0.4, speed: 230, intensity: 0.9 * (1 - 0.5 * ex), seed: 7 });
        sparkHead(L, hp.x, hp.y, t, 1 + 0.9 * pulse(t, th, 0.12) + 0.25 * this.ctx.audio.hit('kick', t, 0.1) * (1 - ex), born);
      }
    }
  }

  // ================================================================ annotations (2D)
  drawAnnotations(c2: CanvasRenderingContext2D, t: number, c: Cam, ex: number) {
    const fade = 1 - prog(t, this.tFlat0 + 0.05, this.T1 - 0.3);
    const intro = prog(t, this.T0, this.T0 + 0.25);
    const A = fade * intro;
    if (A <= 0.003) return;
    const mono = F.mono(400), monoM = F.mono(500);
    c2.save();
    c2.textBaseline = 'alphabetic';
    const P = (X: number, Y: number, a: number) => this.proj(c, X, Y, a);
    const fsOf = (p: { s: number }, k: number, lo: number, hi: number) => Math.round(clamp(p.s * k, lo, hi));
    /** world-attached labels fade out as they reach the frame edge instead of being cut */
    const edge = (x: number, w = 60) => clamp((x - 24 - w) / 60) * clamp((W - 24 - w - x) / 60);
    // --- frequency labels under the front edge
    c2.textAlign = 'center';
    for (const [hz, lab] of HZ_MAJOR) {
      const u = uOfHz(hz); if (u < 0 || u > 1) continue;
      const p = P(-XW + 2 * XW * u, -0.2, 0);
      c2.font = font(mono, fsOf(p, 0.055, 11, 17));
      c2.fillStyle = rgba('bone', 0.72 * A * edge(p.x, 20));
      c2.fillText(lab, p.x, p.y + 4);
    }
    {
      const p = P(XW, -0.36, 0);
      c2.font = font(monoM, fsOf(p, 0.05, 11, 15));
      c2.textAlign = 'right'; c2.letterSpacing = '2px';
      c2.fillStyle = rgba('ash', 0.85 * A);
      c2.fillText('FREQUENCY  Hz (mel, 48 bands) →', Math.min(p.x, W - 96), Math.min(p.y + 4, H - 60));
      c2.letterSpacing = '0px';
    }
    // --- dB labels (left)
    c2.textAlign = 'right';
    for (let db = 0; db >= -70; db -= 10) {
      const p = P(XCOL - 0.14, AMP * shape(1 + db / 70, 0), 0);
      c2.font = font(mono, fsOf(p, 0.045, 10, 15));
      c2.fillStyle = rgba(db === 0 ? 'bone' : 'ash', (db === 0 ? 0.85 : 0.7) * A * edge(p.x - 20, 20));
      c2.fillText(db === 0 ? '0 dB' : `${db}`.replace('-', '−'), p.x, p.y + 4);
    }
    {
      const p = P(XCOL - 0.14, AMP * 1.0 + 0.2, 0);
      c2.font = font(monoM, fsOf(p, 0.042, 10, 14)); c2.letterSpacing = '2px';
      c2.fillStyle = rgba('ash', 0.8 * A * edge(p.x + 30, 60)); c2.textAlign = 'left';
      c2.fillText('dB re: loudest', p.x - 30, p.y);
      c2.letterSpacing = '0px';
    }
    // --- time axis labels: bars, the word lane
    const fogA = (a: number) => Math.exp(-a / 1.6) * (1 - prog(a, HIST - 0.8, HIST - 0.2));
    c2.textAlign = 'right';
    for (let i = 0; i < this.downs.length; i++) {
      const a = t - this.downs[i]!;
      if (a < 0 || a > HIST - 0.3) continue;
      const p = P(XCOL - 0.3, 0, a);
      c2.font = font(monoM, fsOf(p, 0.05, 9, 15));
      c2.fillStyle = rgba('bone', 0.8 * A * fogA(a) * edge(p.x - 25, 25));
      c2.fillText(`BAR ${i + 1}`, p.x, p.y + 4);
    }
    c2.textAlign = 'left';
    for (let wi = 9; wi <= 14; wi++) {
      const a = t - wStart(wi);
      if (a < 0 || a > HIST - 0.3) continue;
      const p = P(XRCOL + 0.2, 0, a);
      c2.font = font(mono, fsOf(p, 0.05, 9, 15));
      c2.fillStyle = rgba(wi === 11 ? 'signal' : 'bone', 0.8 * A * fogA(a) * edge(p.x + 50, 50));
      c2.fillText(`${smart(wText(wi))}  ${wStart(wi).toFixed(2)}`, p.x, p.y + 4);
    }
    {
      // kick/snare lane legend, time axis title, the playhead
      const p = P(XCOL - 0.46, 0, 0.04);
      c2.font = font(mono, fsOf(p, 0.04, 10, 13));
      c2.fillStyle = rgba('signal', 0.8 * A); c2.textAlign = 'center';
      c2.fillText('K', p.x, p.y + 20);
      const q = P(XCOL - 0.58, 0, 0.04);
      c2.fillText('S', q.x, q.y + 20);
      const r = P(XCOL - 0.3, 0, 0.45);
      c2.save(); c2.translate(r.x, r.y);
      const r2 = P(XCOL - 0.3, 0, 0.9);
      c2.rotate(Math.atan2(r2.y - r.y, r2.x - r.x));
      c2.font = font(monoM, 11); c2.letterSpacing = '2px'; c2.textAlign = 'left';
      c2.fillStyle = rgba('ash', 0.7 * A);
      c2.fillText('PAST  ·  30 slices/s  ·  no brakes', 0, -6);
      c2.restore(); c2.letterSpacing = '0px';
      const n = P(XCOL, 0, 0);
      c2.fillStyle = rgba('signal', 0.95 * A);
      c2.beginPath(); c2.moveTo(n.x - 20, n.y - 6); c2.lineTo(n.x - 8, n.y); c2.lineTo(n.x - 20, n.y + 6); c2.fill();
      c2.font = font(monoM, 13); c2.textAlign = 'right';
      c2.fillText('NOW', n.x - 26, n.y + 5);
    }
    // --- the hit, recorded: a label riding the scar slice back into the fog
    if (t > this.tHit + 0.12) {
      const a = t - (this.tHit + 0.02);
      const al = A * prog(t, this.tHit + 0.12, this.tHit + 0.25) * fogA(a);
      if (al > 0.01) {
        const Y = (AMP * this.heightAt(this.tHit + 0.02, this.XcHit) + this.scar(this.tHit + 0.02, this.XcHit)) * this.ampMul(t);
        const p = P(this.XcHit + 0.2, Y + 0.15, a), q = P(this.XcHit + 0.05, Y, a);
        c2.strokeStyle = rgba('ash', 0.8 * al); c2.lineWidth = 1;
        c2.beginPath(); c2.moveTo(q.x, q.y - 4); c2.lineTo(p.x, p.y - 10); c2.lineTo(p.x + 30, p.y - 10); c2.stroke();
        c2.font = font(mono, fsOf(p, 0.045, 11, 15)); c2.textAlign = 'left';
        c2.fillStyle = rgba('bone', 0.9 * al);
        c2.fillText(`the hit · ${this.tHit.toFixed(3)} s`, p.x + 36, p.y - 6);
        c2.fillStyle = rgba('ash', 0.9 * al);
        c2.fillText('4 glyphs, lowercase, recorded', p.x + 36, p.y + 12);
      }
    }
    // --- inbound: the letters, before the hit
    if (t < this.tHit + 0.05) {
      const al = A * (1 - prog(t, this.tHit - 0.03, this.tHit + 0.03));
      const d = dropLetter(3, t);
      const x = d.x + 70, y = d.y - 70;
      c2.strokeStyle = rgba('ash', 0.8 * al); c2.lineWidth = 1;
      c2.beginPath(); c2.moveTo(d.x + 28, d.y - 30); c2.lineTo(x, y); c2.lineTo(x + 24, y); c2.stroke();
      c2.font = font(mono, 15); c2.textAlign = 'left';
      c2.fillStyle = rgba('bone', 0.9 * al);
      c2.fillText('inbound: ‘drop’', x + 30, y + 5);
      c2.fillStyle = rgba('signal', 0.95 * al);
      c2.fillText(`ETA ${Math.max(0, this.tHit - t).toFixed(2)} s`, x + 30, y + 24);
    }
    // --- the song, pointed at
    {
      const X = XW - 0.25;
      const Y = this.envY(this.envF, X) * this.ampMul(t);
      const al = A * prog(t, this.tSnap + 0.15, this.tSnap + 0.35);
      if (al > 0.01) {
        c2.font = font(mono, 15); c2.textAlign = 'left';
        const tw = c2.measureText('← this is the song you are hearing').width;
        // point at the front ridge where the note still fits in the frame
        const xs = Math.min(P(X, 0, 0).x, W - 96 - tw - 16);
        const Xn = c.Xc + ((xs - c.cx - c.sx) * c.zrF) / c.f;
        const p = P(Xn, this.envY(this.envF, Xn) * this.ampMul(t) + 0.02, 0);
        c2.fillStyle = rgba('bone', 0.88 * al);
        c2.fillText('← this is the song you are hearing', p.x + 16, p.y - 8);
      }
    }
    // --- title block (top left) and the instrument readout with the FRAMES counter (top right)
    {
      const x = 96, y = 92;
      c2.textAlign = 'left';
      c2.font = font(monoM, 15); c2.letterSpacing = '3px';
      c2.fillStyle = rgba('bone', 0.9 * A);
      c2.fillText('SOUND DEPT.  FIG. 3', x, y);
      c2.letterSpacing = '0px';
      c2.font = font(mono, 14);
      c2.fillStyle = rgba('ash', 0.85 * A);
      c2.fillText('the song, as a ridgeline: one line per 1/30 s', x, y + 24);
      c2.fillText('48 mel bands · 40 Hz – 12 kHz · hidden lines removed', x, y + 44);
      c2.fillText('display tilt +4.5 dB/oct (for legibility)', x, y + 64);
      c2.strokeStyle = rgba('graphite', 0.9 * A); c2.lineWidth = 1;
      c2.beginPath(); c2.moveTo(x, y + 80); c2.lineTo(x + 420, y + 80); c2.stroke();
    }
    {
      const xr = W - 96, y = 92;
      const fr = frames(t);
      const rows: [string, string, string?][] = [
        ['FRAMES', fr.toLocaleString('en-US').padStart(5, ' '), 'signal'],
        ['SAMPLE', Math.round(t * 44100).toLocaleString('en-US')],
        ['t', `${t.toFixed(3)} s`],
        ['BAR · BEAT', this.barBeat(t)],
        ['PEAK HOLD', '1.5 s'],
      ];
      c2.font = font(mono, 14);
      rows.forEach(([k, v, col], i) => {
        const yy = y + i * 21;
        c2.textAlign = 'left'; c2.fillStyle = rgba('ash', 0.85 * A);
        c2.fillText(k, xr - 300, yy);
        c2.textAlign = 'right'; c2.fillStyle = rgba(col ?? 'bone', 0.92 * A);
        c2.font = font(i === 0 ? monoM : mono, i === 0 ? 16 : 14);
        c2.fillText(v, xr, yy);
        c2.font = font(mono, 14);
      });
      c2.strokeStyle = rgba('graphite', 0.9 * A); c2.lineWidth = 1;
      c2.beginPath(); c2.moveTo(xr - 300, y + 5 * 21 - 6); c2.lineTo(xr, y + 5 * 21 - 6); c2.stroke();
    }
    // --- fig. 3a: labels, beat ticks, the playhead
    {
      const { x0, y0, x1, y1 } = STRIP;
      const xNow = x0 + STRIP_NOW * (x1 - x0);
      const xOfT = (tt: number) => x0 + ((tt - t) / STRIP_SPAN + STRIP_NOW) * (x1 - x0);
      c2.strokeStyle = rgba('graphite', 0.9 * A); c2.lineWidth = 1;
      c2.beginPath(); c2.moveTo(x0, y1 + 6); c2.lineTo(x1, y1 + 6); c2.stroke();
      c2.font = font(mono, 11); c2.textAlign = 'center';
      for (const b of this.ctx.audio.beats) {
        const x = xOfT(b);
        if (x < x0 || x > x1) continue;
        const down = this.downs.findIndex((d) => Math.abs(d - b) < 0.02);
        c2.strokeStyle = rgba(down >= 0 ? 'bone' : 'ash', (down >= 0 ? 0.75 : 0.5) * A);
        c2.beginPath(); c2.moveTo(x, y1 + 6); c2.lineTo(x, y1 + (down >= 0 ? 16 : 11)); c2.stroke();
        if (down >= 0) { c2.fillStyle = rgba('ash', 0.8 * A); c2.fillText(`${down + 1}`, x, y1 + 29); }
      }
      c2.textAlign = 'left'; c2.font = font(monoM, 12); c2.letterSpacing = '2px';
      c2.fillStyle = rgba('bone', 0.8 * A);
      c2.fillText('FIG. 3a', x0, y0 - 12);
      c2.letterSpacing = '0px'; c2.font = font(mono, 12);
      c2.fillStyle = rgba('ash', 0.8 * A);
      c2.fillText('the same song, 48 rows, line weight = level (for people who prefer rectangles)', x0 + 78, y0 - 12);
      c2.fillStyle = rgba('signal', 0.95 * A); c2.textAlign = 'center';
      c2.fillText('NOW', xNow, y0 - 12);
      c2.textAlign = 'right'; c2.fillStyle = rgba('graphite', 0.95 * A);
      c2.fillText('not yet heard →', x1, y0 - 12);
    }
    // --- the instrumental, noted on the front
    {
      const al = A * prog(t, this.tRelB + 0.15, this.tRelB + 0.35);
      if (al > 0.01) {
        const X = -XW + 0.5, p = P(X, this.envY(this.envF, X) * this.ampMul(t) + 0.12, 0);
        c2.font = font(mono, 15); c2.textAlign = 'left';
        c2.fillStyle = rgba('bone', 0.85 * al * edge(p.x + 120, 120));
        c2.fillText('(instrumental. the scroll continues regardless)', Math.max(p.x, 110), p.y - 10);
      }
    }
    // --- fog, labelled
    {
      const p = P(XW - 0.3, 0.25, HIST - 0.9);
      c2.font = font(mono, 12); c2.textAlign = 'left';
      c2.fillStyle = rgba('graphite', 0.95 * A);
      c2.fillText('fog (artistic)', p.x, p.y);
    }
    c2.restore();
  }
  barBeat(t: number) {
    const d = this.downs;
    let i = 0;
    while (i + 1 < d.length && d[i + 1]! <= t + 1e-6) i++;
    const beat = Math.floor(this.ctx.audio.beatAt(t) - this.ctx.audio.beatAt(d[i]!) + 1e-6) + 1;
    return `${i + 1} · ${clamp(beat, 1, 4)}`;
  }
}

const HZ_MAJOR: [number, string][] = [[200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
const HZ_MINOR = [150, 300, 400, 700, 1500, 3000, 4000, 7000];

/** White-hot → ember → bone cooling for fresh type. */
function heatCss(heat: number, alpha: number) {
  if (heat < 0.02) return rgba('bone', alpha);
  const k = 1 - heat;
  const r = Math.round(lerp(255, 238, k)), g = Math.round(lerp(150, 233, k)), b = Math.round(lerp(70, 223, k));
  return `rgba(${r},${g},${b},${alpha})`;
}
/** White-hot → ember → signal (shards). */
function hotCss(heat: number, alpha: number) {
  const r = 255, g = Math.round(lerp(90, 245, heat)), b = Math.round(lerp(31, 225, heat));
  return `rgba(${r},${g},${b},${alpha})`;
}
