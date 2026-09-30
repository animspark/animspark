// Plate `beam` — "Every word becomes a light" (CUT.beam → CUT.marquee).
// Projection. One continuous take through a dark engraved picture house, from the booth to the screen:
//   hand-off  (H7) the zoetrope's last slit is the gap between the projector's douser blades, seen head-on
//             from the house, a hand's breadth from the port: 12 × 300 px of lamp, everything else dark.
//   Every     the douser snaps open; the camera cranes back out of the beam and swings round (log-distance
//             about the port) to stand broadside to it: a volumetric beam across the hall, ruled like an
//             engraving, a ring of light riding it on every beat. The dust in it assembles into the word.
//   word      more dust, further down the beam and bigger (the beam widens): the word. The camera creeps.
//   becomes   the word forms near the screen and stretches on the held note; the camera tracks with the
//             stream — "Every word" peels off letter by letter and streams down the beam; on the downbeat
//             the camera turns in the stalls to face the screen.
//   a light   the motes land on the screen, each on its letter, arriving with the syllables: "a", then
//             l-i-g-h-t, hot, cooling to bone; the screen lights the hall (area light on the seats' rims,
//             the proscenium, the row letters and the seat numbers come up).
//   hand-off  (H8) the image burns out to clear white — the word dissolves into the light it became —
//             the haze clears, the house goes dark, and the camera settles on the screen: a bone rectangle
//             exactly SCREEN_H8, the next plate's marquee board.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H, SS_TAP } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, layout, textPoints, fitSize } from '../px/type';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep, keys, TAU, frameIdx } from '../px/util';
import { wStart, wEnd, charTimes } from './lyric';
import { CUT, SLIT_H7, SCREEN_H8, frames } from './handoff';
import { HALL_FRAG, EXITS } from './beam-glsl';
import {
  type Cam, type V3, HALL, APEX, SG, GATE_HH, GATE_HW, THROW, AXIS_L, ROWS,
  add, mul, mix3, lookAt, project, projSeg, beamPt, frustumPlanes, floorY, rowZ, lamOfZ,
} from './beam-kit';

type RGB = [number, number, number];
const V3v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const V4v = () => new THREE.Vector4();
const oe = (t: number, t0: number, d = 0.2) => ease.outExpo(clamp((t - t0) / d));
const logLerp = (a: number, b: number, k: number) => Math.exp(lerp(Math.log(a), Math.log(b), k));
/** fresh light: white-hot tip → ember → signal → bone (linear rgb) */
function hot(age: number, base: number): RGB {
  if (age < 0) return [LIN.bone[0] * base, LIN.bone[1] * base, LIN.bone[2] * base];
  const h1 = Math.exp(-age / 0.04), h2 = Math.exp(-age / 0.13);
  const b = base * (1 - h2);
  return [
    LIN.bone[0] * b + LIN.signal[0] * 1.7 * h2 + (1.0 - LIN.signal[0] * 0.4) * 2.2 * h1,
    LIN.bone[1] * b + LIN.signal[1] * 1.7 * h2 + (0.62) * 2.2 * h1,
    LIN.bone[2] * b + LIN.signal[2] * 1.7 * h2 + (0.3) * 2.2 * h1,
  ];
}
const grp = (n: number, w = 6) => String(n).padStart(w, '0').replace(/(\d{3})(?=\d)/g, '$1 ');
const comma = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** the camera's final pose: head-on, level; the screen projects to exactly SCREEN_H8 */
const F_END = 1300;
const Z_END = (F_END * HALL.SHW * 2) / SCREEN_H8.w;
const Y_END = HALL.SC[1] - ((H / 2 - SCREEN_H8.y) * Z_END) / F_END;
/** the opening pose: head-on to the gate, d0 away; the gap projects to exactly SLIT_H7 */
const D0 = 1.2;
const F0 = (SLIT_H7.h / 2) * D0 / GATE_HH;
const OPEN0 = ((SLIT_H7.w / 2) * D0) / (F0 * GATE_HW);
/** screen image: 1000 × 420 units over the screen */
const IMG_W = 1000, IMG_H = 420;
const SIDE_D = 8.4;

interface Mote {
  w: number; // word 0..2, or -1 for dust
  lam: number; v: number; // target in the word (frustum coords, u = 0)
  lamC: number; // word centre λ (for the stretch)
  du: number; dv: number; dl: number; // dust home
  ta: number; tl: number; tr: number; // formed, leaves, lands
  su: number; sv: number; g: number; // lands at (su, sv) on the screen, in glyph g
  seed: number; size: number;
}
interface WordInfo { i: number; text: string; lam0: number; lam1: number; vTop: number; vBot: number; n: number; ta0: number; ta1: number; tl0: number }

export default class Beam extends Scene {
  hall = new FSPass(HALL_FRAG, {
    res: { value: new THREE.Vector2(W, H) }, ssTap: SS_TAP,
    camPos: { value: V3v() }, camR: { value: V3v() }, camU: { value: V3v() }, camF: { value: V3v() }, focal: { value: 1000 },
    time: { value: 0 }, jit: { value: 0 },
    openK: { value: 1 }, gateI: { value: 1 }, hazeK: { value: 0 }, beamI: { value: 1 }, scrS: { value: 0 }, scrLum: { value: 0 },
    imageK: { value: 0 }, endMask: { value: 0 }, fillI: { value: 0 }, exitI: { value: 1 }, gain: { value: 1 },
    fr: { value: [0, 1, 2, 3, 4, 5].map(V4v) },
    gA: { value: [0, 0, 0, 0, 0, 0] }, gCol: { value: [0, 1, 2, 3, 4, 5].map(() => V3v()) }, gB: { value: [0, 0, 0, 0, 0, 0, 1] },
    imgTex: { value: null }, maskR: { value: new THREE.Vector4(SCREEN_H8.x, SCREEN_H8.y, SCREEN_H8.w / 2, SCREEN_H8.h / 2) },
  });
  glow = new LineBatch(40000, { blend: 'add' });
  L = new Layer2D();
  imgCv = document.createElement('canvas');
  imgTex!: THREE.CanvasTexture;

  T = {
    t0: 0, t1: 0, every: 0, eEvery: 0, word: 0, eWord: 0, bec: 0, eBec: 0, a: 0, light: 0, eLight: 0,
    b1: 0, turn0: 0, turn1: 0, push0: 0,
  };
  motes: Mote[] = [];
  words: WordInfo[] = [];
  glyphT: number[] = []; // arrival (reveal) time of each screen glyph
  glyphU: [number, number][] = []; // glyph extents (screen u, −1..1)
  zEvery = 0; zEW = 0; zBec = 0;
  imgFam = F.archivo(112.5, 900); imgSize = 200; imgBase = 0; imgX0 = 0;

  override init() {
    const T = this.T, au = this.ctx.audio;
    T.t0 = CUT.beam; T.t1 = CUT.marquee;
    T.every = wStart(48); T.eEvery = wEnd(48); T.word = wStart(49); T.eWord = wEnd(49);
    T.bec = wStart(50); T.eBec = wEnd(50); T.a = wStart(51); T.light = wStart(52); T.eLight = wEnd(52);
    T.b1 = T.every + 0.4;
    // the turn: from the downbeat inside the held "becomes" to the beat of "a"
    T.turn0 = au.downbeats.find((d) => d > T.bec + 0.2 && d < T.eBec) ?? lerp(T.bec, T.eBec, 0.55);
    T.turn1 = au.nearestBeat(T.a);
    if (T.turn1 < T.turn0 + 0.3) T.turn1 = T.turn0 + 0.45;
    // the push to the hand-off: from the first beat after "light" ends, landing on the cut
    T.push0 = au.timeOfBeat(Math.ceil(au.beatAt(T.eLight + 0.02)));
    if (T.push0 > T.t1 - 0.6) T.push0 = T.t1 - 0.8;

    this.buildImage();
    this.buildWords();
  }

  // ------------------------------------------------------------------ the screen's image: "a light"
  buildImage() {
    const text = 'a light';
    const fam = this.imgFam;
    const size = Math.min(300, fitSize(text, fam, IMG_W * 0.8, 400));
    const pts0 = textPoints(text, fam, size, 5, 3);
    let y0 = 1e9, y1 = -1e9;
    for (const p of pts0) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const lay = layout(text, fam, size);
    this.imgSize = size;
    this.imgX0 = (IMG_W - lay.width) / 2;
    this.imgBase = IMG_H / 2 - (y0 + y1) / 2;
    const S = 2;
    this.imgCv.width = IMG_W * S; this.imgCv.height = IMG_H * S;
    const c = this.imgCv.getContext('2d')!;
    c.scale(S, S);
    c.fillStyle = '#000'; c.fillRect(0, 0, IMG_W, IMG_H);
    c.fillStyle = '#fff'; c.font = font(fam, size); c.textBaseline = 'alphabetic';
    c.fillText(text, this.imgX0, this.imgBase);
    this.imgTex = new THREE.CanvasTexture(this.imgCv);
    this.imgTex.minFilter = THREE.LinearFilter; this.imgTex.magFilter = THREE.LinearFilter; this.imgTex.generateMipmaps = false;
    this.hall.u.imgTex!.value = this.imgTex;
    // glyphs (no space): a, l, i, g, h, t
    const gl = lay.glyphs.filter((g) => g.ch !== ' ');
    const ct = charTimes(52);
    this.glyphT = [this.T.a, ...ct];
    this.glyphU = gl.map((g) => [((this.imgX0 + g.x) / IMG_W) * 2 - 1, ((this.imgX0 + g.x + g.w) / IMG_W) * 2 - 1]);
    const gB = this.hall.u.gB!.value as number[];
    gB[0] = 0; gB[6] = 1;
    for (let k = 1; k < 6; k++) {
      const a = (this.imgX0 + gl[k - 1]!.x + gl[k - 1]!.w) / IMG_W, b = (this.imgX0 + gl[k]!.x) / IMG_W;
      gB[k] = (a + b) / 2;
    }
  }

  /** screen targets: points of "a light" as (su, sv, glyph), sorted by glyph then x */
  screenTargets() {
    const text = 'a light', fam = this.imgFam, size = this.imgSize;
    const lay = layout(text, fam, size);
    const gl = lay.glyphs.filter((g) => g.ch !== ' ');
    const out: { su: number; sv: number; g: number; x: number }[] = [];
    for (const p of textPoints(text, fam, size, 3.4, 11)) {
      let gi = -1;
      gl.forEach((g, k) => { if (p.x >= g.x - 3 && p.x <= g.x + g.w + 3) gi = gi < 0 ? k : gi; });
      if (gi < 0) continue;
      const X = this.imgX0 + p.x, Y = this.imgBase + p.y;
      out.push({ su: (X / IMG_W) * 2 - 1, sv: 1 - (Y / IMG_H) * 2, g: gi, x: X });
    }
    out.sort((a, b) => a.g - b.g || a.x - b.x);
    return out;
  }

  // ------------------------------------------------------------------ the dust and the words in it
  buildWords() {
    const T = this.T;
    const fam = F.archivo(100, 900), size = 200, capPx = 0.72 * size;
    const defs = [
      { i: 48, text: 'Every', cap: 0.56, gap: 0, step: 4.4 },
      { i: 49, text: 'word', cap: 0.56, gap: 0.5, step: 3.8 },
      { i: 50, text: 'becomes', cap: 0.42, gap: 0.75, step: 3.4 },
    ];
    let s = 0.25 * AXIS_L;
    const src: Mote[] = [];
    defs.forEach((d, wi) => {
      const lay = layout(d.text, fam, size);
      s += d.gap * (wi > 0 ? 1 : 0);
      // metres per layout px: cap = d.cap × the beam's local height at the word's centre (solved for mpp)
      const k = (d.cap * 2 * HALL.SHH) / (AXIS_L * capPx);
      const mpp = (k * s) / (1 - k * 0.5 * lay.width);
      const lam0 = s / AXIS_L, lam1 = (s + lay.width * mpp) / AXIS_L;
      const lamC = (lam0 + lam1) / 2;
      const capW = mpp * capPx;
      const pts = textPoints(d.text, fam, size, d.step, 17 + wi);
      const dur = wEnd(d.i) - wStart(d.i);
      const sweep = d.i === 50 ? Math.min(0.5, dur * 0.6) : Math.min(0.28, dur * 0.8);
      let vTop = -9, vBot = 9;
      const list: Mote[] = [];
      for (const p of pts) {
        const lam = (s + p.x * mpp) / AXIS_L;
        const up = (-p.y - capPx / 2) * mpp; // metres above the axis (the word is centred on it)
        const v = up / (HALL.SHH * lam);
        vTop = Math.max(vTop, v); vBot = Math.min(vBot, v);
        const seed = src.length + list.length + 1;
        const u = p.x / lay.width;
        list.push({
          w: wi, lam, v, lamC, du: (hash(seed, 1) - 0.5) * 1.5, dv: v + (hash(seed, 2) - 0.5) * 0.9, dl: lam + (hash(seed, 3) - 0.5) * 0.09,
          ta: wStart(d.i) + u * sweep, tl: 0, tr: 0, su: 0, sv: 0, g: 0, seed, size: 0.8 * d.step * mpp,
        });
      }
      list.sort((a, b) => a.lam - b.lam);
      src.push(...list);
      this.words.push({ i: d.i, text: d.text, lam0, lam1, vTop, vBot, n: list.length, ta0: wStart(d.i), ta1: wStart(d.i) + sweep, tl0: 0 });
      s += lay.width * mpp + capW * 0.0;
    });
    const w = this.words;
    this.zEvery = APEX[2] * (1 - (w[0]!.lam0 + w[0]!.lam1) / 2);
    this.zEW = APEX[2] * (1 - (w[0]!.lam0 + w[1]!.lam1) / 2);
    this.zBec = APEX[2] * (1 - (w[2]!.lam0 + w[2]!.lam1) / 2);
    // assignment: sources in reading order → screen targets in glyph order; arrivals follow the singing
    const tg = this.screenTargets();
    const Ns = src.length, Nt = tg.length;
    const nEW = w[0]!.n + w[1]!.n;
    src.forEach((m, j) => {
      const q = tg[Math.min(Nt - 1, Math.floor((j / Ns) * Nt))]!;
      m.su = q.su; m.sv = q.sv; m.g = q.g;
      const gu = this.glyphU[q.g]!;
      const xf = clamp((q.su - gu[0]) / Math.max(1e-3, gu[1] - gu[0]));
      m.tr = this.glyphT[q.g]! - 0.03 + 0.1 * xf + 0.02 * (hash(m.seed, 9) - 0.5);
      if (m.w < 2) m.tl = T.bec + 0.45 * (j / nEW) + 0.04 * hash(m.seed, 8);
      else m.tl = T.eBec + 0.14 * ((j - nEW) / (Ns - nEW)) + 0.03 * hash(m.seed, 8);
      m.tl = Math.min(m.tl, m.tr - 0.3);
      m.tl = Math.max(m.tl, m.ta + 0.12);
    });
    w[0]!.tl0 = T.bec; w[1]!.tl0 = T.bec + 0.45 * (w[0]!.n / nEW); w[2]!.tl0 = T.eBec;
    // ambient dust: uniform in the beam's volume
    for (let i = 0; i < 2600; i++) {
      const seed = 50000 + i;
      const lam = Math.cbrt(SG ** 3 + hash(seed, 3) * (1 - SG ** 3));
      src.push({ w: -1, lam, v: 0, lamC: 0, du: hash(seed, 1) * 2 - 1, dv: hash(seed, 2) * 2 - 1, dl: lam, ta: 0, tl: 0, tr: 0, su: 0, sv: 0, g: 0, seed, size: 0.02 + 0.02 * hash(seed, 4) ** 2 });
    }
    this.motes = src;
  }

  // ------------------------------------------------------------------ the camera
  axisY(z: number) { const lam = lamOfZ(z); return APEX[1] + lam * (HALL.SC[1] - APEX[1]); }
  sidePose(t: number, nod: number, roll: number): Cam {
    const T = this.T;
    const z = t < T.bec ? lerp(this.zEvery, this.zEW, prog(t, T.b1, T.bec, ease.inOutQuad)) : lerp(this.zEW, this.zBec, prog(t, T.bec, T.turn0, ease.inOutCubic));
    const y = this.axisY(z);
    return lookAt([SIDE_D, y, z], [0, y, z], 1300 * nod, roll);
  }
  stallPose(t: number, nod: number): Cam {
    const T = this.T;
    const z = lerp(17.8, 17.35, prog(t, T.turn1, T.push0));
    return lookAt([0, 4.4, z], [0, 4.3, 0], 880 * nod);
  }
  camAt(t: number): Cam {
    const T = this.T;
    const G = HALL.G;
    if (t <= T.every) return lookAt([G[0], G[1], G[2] - D0], G, F0);
    if (t < T.b1) {
      // the crane: log-distance about a pivot that runs from the port to the first word, swinging 90°
      const k = 1 - Math.pow(1 - prog(t, T.every, T.b1), 4);
      const P1: V3 = [0, this.axisY(this.zEvery), this.zEvery];
      const piv = mix3(G, P1, k);
      const a = lerp(Math.PI, Math.PI / 2, k);
      const d = logLerp(D0, SIDE_D, k);
      return lookAt(add(piv, mul([Math.sin(a), 0, Math.cos(a)], d)), piv, logLerp(F0, 1300, k));
    }
    const nodSide = (1 + 0.05 * oe(t, T.word)) * (1 + 0.04 * oe(t, T.bec));
    const nodStall = (1 + 0.035 * oe(t, T.a)) * (1 + 0.06 * oe(t, T.light)) * (1 + 0.02 * oe(t, this.glyphT[3]!)) * (1 + 0.02 * oe(t, this.glyphT[5]!));
    const roll = 0.01 * pulse(t, T.word, 0.12) - 0.008 * pulse(t, T.bec, 0.12);
    if (t < T.turn0) return this.sidePose(t, nodSide, roll);
    if (t < T.turn1) {
      const u = ease.inOutCubic(prog(t, T.turn0, T.turn1));
      const a = this.sidePose(T.turn0, nodSide, 0), b = this.stallPose(T.turn1, nodStall);
      const tgA: V3 = [0, a.pos[1], a.pos[2]], tgB: V3 = [0, 4.3, 0];
      // the path bows out over the seats (an arc, not a chord)
      const pos = add(mix3(a.pos, b.pos, u), [0, 0.5 * Math.sin(Math.PI * u), 0]);
      return lookAt(pos, mix3(tgA, tgB, ease.inOutQuad(u)), logLerp(a.focal, b.focal, u));
    }
    const s = this.stallPose(t, nodStall);
    if (t < T.push0) return s;
    const u = ease.inOutCubic(prog(t, T.push0, T.t1));
    const b = this.stallPose(T.push0, 1);
    const pos = mix3(b.pos, [0, Y_END, Z_END], u);
    const tgt = mix3([0, 4.3, 0], [0, Y_END, 0], u);
    return lookAt(pos, tgt, logLerp(s.focal, F_END, u));
  }

  // ------------------------------------------------------------------ state
  open(t: number) { return t <= this.T.every ? OPEN0 : lerp(OPEN0, 1, ease.outExpo(prog(t, this.T.every, this.T.every + 0.32))); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, T = this.T;
    const cam = this.camAt(t);
    const o = this.open(t);
    const endMask = prog(t, T.t1 - 0.42, T.t1 - 0.05, ease.inOutQuad);
    const live = 1 - endMask;
    const hazeK = keys(t, [[T.every, 0], [T.every + 0.35, 1, ease.outCubic], [T.push0 + 0.2, 1, ease.linear], [T.t1 - 0.3, 0, ease.inOutQuad]]);
    const beamI = 1 + 0.22 * f.a.kick * smoothstep(T.every, T.every + 0.3, t);
    // the screen: the beam's grey, then the arrivals, then the image burns out to clear white
    const arr = prog(t, T.a - 0.05, T.eLight, ease.inOutQuad);
    const burn = prog(t, T.push0, T.push0 + 0.55, ease.inOutCubic);
    const scrS = 0.09 + 0.26 * arr + 0.55 * burn;
    const gA = this.hall.u.gA!.value as number[], gCol = this.hall.u.gCol!.value as THREE.Vector3[];
    let hotSum = 0;
    for (let g = 0; g < 6; g++) {
      const tg = this.glyphT[g]!;
      gA[g] = prog(t, tg - 0.04, tg + 0.09) * (1 - prog(t, T.push0 + 0.3, T.push0 + 0.62, ease.inOutQuad));
      const c = hot(t - tg, 0.9);
      gCol[g]!.set(c[0], c[1], c[2]);
      hotSum += gA[g]! * Math.max(c[0], c[1], c[2]);
    }
    const scrLum = scrS * o + 0.05 * hotSum;
    const imageK = prog(t, T.light, T.eLight) * (1 - burn);

    // ---- the hall
    const u = this.hall.u;
    (u.camPos!.value as THREE.Vector3).set(...cam.pos);
    (u.camR!.value as THREE.Vector3).set(...cam.R);
    (u.camU!.value as THREE.Vector3).set(...cam.U);
    (u.camF!.value as THREE.Vector3).set(...cam.F);
    u.focal!.value = cam.focal;
    u.time!.value = t; u.jit!.value = frameIdx(t) % 97;
    u.openK!.value = o; u.gateI!.value = 1; u.hazeK!.value = hazeK; u.beamI!.value = beamI;
    u.scrS!.value = scrS; u.scrLum!.value = scrLum; u.imageK!.value = imageK; u.endMask!.value = endMask;
    u.fillI!.value = 0.0022 * smoothstep(T.every, T.every + 0.5, t);
    u.exitI!.value = smoothstep(T.every, T.every + 0.3, t);
    const planes = frustumPlanes(o), fr = u.fr!.value as THREE.Vector4[];
    planes.forEach((p, i) => fr[i]!.set(p[0], p[1], p[2], p[3]));
    this.hall.render(renderer, out);

    // ---- light: the ruled beam, the beat ring, the throw, the dust and the words
    const lb = this.glow; lb.clear();
    const lit = smoothstep(T.every, T.every + 0.15, t) * live;
    const head = this.drawMotes(lb, t, cam, o, hazeK, lit, f.a.kick);
    this.drawRays(lb, t, cam, o, lit);
    this.drawRing(lb, t, cam, o, lit);
    const reach = this.drawThrow(lb, t, cam, head, lit);
    lb.render(renderer, out);

    // ---- lettering
    const L = this.L; L.clear();
    this.drawLabels(L.ctx, t, cam, o, reach, head, scrLum, live);
    comp.draw(renderer, L.upload(), out);

    const shK = smoothstep(T.every + 0.1, T.every + 0.4, t) * (1 - smoothstep(T.push0, T.push0 + 0.4, t));
    const kick = f.a.kick * shK;
    return {
      bloom: 0.7, bloomThreshold: 0.85, bloomKnee: 0.12,
      vignette: 0.4, grain: 0.055, halation: 0.25,
      shake: [noise1(t * 45, 1) * 3.5 * kick, noise1(t * 45, 2) * 3.5 * kick],
      zoom: 1 + 0.012 * kick + 0.015 * pulse(t, T.light, 0.1) * shK,
      flash: 0.03 * pulse(t, T.light, 0.08),
    };
  }

  // ------------------------------------------------------------------ motes
  /** draws the dust and the word motes; returns the stream's head λ (the furthest streaming mote) */
  drawMotes(lb: LineBatch, t: number, cam: Cam, o: number, hazeK: number, lit: number, kick: number) {
    const T = this.T;
    let head = 0;
    const bone = LIN.bone;
    const dustK = hazeK * lit * (1 + 0.5 * kick);
    const stretch = 1 + 0.1 * prog(t, T.bec + 0.15, T.eBec, ease.inOutQuad);
    const broad = 0.22 + 0.78 * Math.abs(cam.F[0]); // the words' plane seen edge-on piles its motes up: dim them
    for (const m of this.motes) {
      let uu: number, vv: number, ll: number;
      let col: RGB;
      let size: number;
      const sd = m.seed;
      if (m.w < 0) {
        if (dustK <= 0.002) continue;
        uu = clamp(m.du + 0.05 * noise1(t * 0.22 + sd * 0.13, sd), -0.98, 0.98);
        vv = clamp(m.dv + 0.04 * noise1(t * 0.2 + sd * 0.29, sd + 7) - 0.01 * t, -0.98, 0.98);
        ll = m.dl;
        const P = beamPt(uu, vv, ll, o);
        const q = project(cam, P);
        if (q.z < 0.15 || q.x < -10 || q.x > W + 10 || q.y < -10 || q.y > H + 10) continue;
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (2.5 + 5 * hash(sd, 5)) + sd));
        let I = Math.min(0.022 / (ll * ll), 0.9) * tw * dustK;
        size = (m.size * cam.focal) / q.z;
        if (size > 3.5) I /= 1 + (size - 3.5) * (size - 3.5) * 0.12;
        size = clamp(size, 1.1, 8);
        if (I < 0.004) continue;
        lb.seg2(q.x, q.y, q.x + 0.01, q.y, size, [bone[0] * I, bone[1] * 0.95 * I, bone[2] * 0.85 * I], 1);
        continue;
      }
      if (t > m.tr + 0.14) continue;
      // the dust it was, drifting near its place in the word
      const du = m.du + 0.05 * noise1(t * 0.3 + sd * 0.11, sd);
      const dv = m.dv + 0.05 * noise1(t * 0.27 + sd * 0.17, sd + 3);
      const dl = m.dl + 0.012 * noise1(t * 0.2 + sd * 0.07, sd + 5);
      const kf = ease.inOutCubic(prog(t, m.ta - 0.34, m.ta));
      const lamW = m.w === 2 ? m.lamC + (m.lam - m.lamC) * stretch : m.lam;
      const jx = 0.004 * noise1(t * 3 + sd, sd + 11);
      uu = lerp(du * o, 0, kf); vv = lerp(dv, m.v + jx, kf); ll = lerp(dl, lamW, kf);
      const us = m.tr > m.tl ? clamp((t - m.tl) / (m.tr - m.tl)) : 0;
      let heat = 0;
      if (us > 0) {
        const e1 = 0.3 * us + 0.7 * us * us, e2 = ease.inOutCubic(us);
        const sw = 0.1 * Math.sin(Math.PI * us), ph = hash(sd, 12) * TAU + 3 * us;
        uu = lerp(uu, m.su, ease.outQuad(us)) + sw * Math.cos(ph);
        vv = lerp(vv, m.sv, e2) + sw * Math.sin(ph);
        ll = lerp(ll, 1, e1);
        head = Math.max(head, ll);
        heat = Math.sin(Math.PI * Math.min(1, us * 1.1)) * 0.7;
      }
      const landed = t >= m.tr;
      const P = landed ? beamPt(m.su, m.sv, 1, 1) : beamPt(uu, vv, ll, 1);
      const q = project(cam, P);
      if (q.z < 0.15 || q.x < -10 || q.x > W + 10 || q.y < -10 || q.y > H + 10) continue;
      size = clamp((m.size * cam.focal) / q.z, 1.2, 6);
      if (landed) {
        const k = pulse(t, m.tr, 0.03);
        col = [LIN.ember[0] * 1.5 * k, LIN.ember[1] * 1.5 * k, LIN.ember[2] * 1.5 * k];
        size *= 1 + k;
      } else if (t < m.ta) {
        // not yet sung: dust, then (≤ 0.34 s early) a dim outline of the word
        const I = Math.max(Math.min(0.022 / (ll * ll), 0.9) * 0.5 * hazeK, 0.3 * kf * 0.8);
        col = [bone[0] * I, bone[1] * I, bone[2] * I];
      } else {
        col = hot(t - m.ta, 0.78);
        if (heat > 0) {
          col = [lerp(col[0], LIN.ember[0] * 1.4, heat), lerp(col[1], LIN.ember[1] * 1.4, heat), lerp(col[2], LIN.ember[2] * 1.4, heat)];
        }
      }
      const a = lit * (landed ? 1 : broad);
      if (a <= 0) continue;
      lb.seg2(q.x, q.y, q.x + 0.01, q.y, size, [col[0] * a, col[1] * a, col[2] * a], 1);
    }
    return head;
  }

  // ------------------------------------------------------------------ the ruled beam
  drawRays(lb: LineBatch, t: number, cam: Cam, o: number, lit: number) {
    const T = this.T;
    const reach = ease.outCubic(prog(t, T.every + 0.02, T.every + 0.7));
    if (reach <= 0 || lit <= 0) return;
    const fade = 1 - 0.6 * prog(t, T.turn0, T.turn1);
    const lamEnd = lerp(SG, 1, reach);
    const NS = 8;
    for (let iu = 0; iu <= 10; iu++) for (let iv = 0; iv <= 4; iv++) {
      const uR = -1 + iu * 0.2, vR = -1 + iv * 0.5;
      const edge = (iu === 0 || iu === 10) && (iv === 0 || iv === 4);
      const rim = iu === 0 || iu === 10 || iv === 0 || iv === 4;
      const base = (edge ? 0.11 : rim ? 0.06 : 0.035) * (0.8 + 0.4 * hash(iu, iv, 3)) * lit * fade;
      for (let s = 0; s < NS; s++) {
        const la = lerp(SG, lamEnd, s / NS), lb2 = lerp(SG, lamEnd, (s + 1) / NS);
        const seg = projSeg(cam, beamPt(uR, vR, la, o), beamPt(uR, vR, lb2, o));
        if (!seg) continue;
        const age = (lamEnd - lb2) / 1.2;
        const hk = reach < 1 ? Math.exp(-age / 0.06) : 0;
        const I = base * (1 + 6 * hk);
        lb.seg2(seg.x0, seg.y0, seg.x1, seg.y1, edge ? 1.2 : 1, [lerp(LIN.bone[0], LIN.ember[0] * 2, hk) * I, lerp(LIN.bone[1], LIN.ember[1] * 2, hk) * I, lerp(LIN.bone[2], LIN.ember[2] * 2, hk) * I], 1);
      }
    }
  }

  /** a ring of light (the frame's outline) rides the beam from the gate to the screen on every beat */
  drawRing(lb: LineBatch, t: number, cam: Cam, o: number, lit: number) {
    const T = this.T, au = this.ctx.audio;
    const env = smoothstep(T.every + 0.25, T.every + 0.45, t) * (1 - smoothstep(T.push0 - 0.2, T.push0 + 0.15, t)) * lit;
    if (env <= 0) return;
    const b = au.beatAt(t), ph = b - Math.floor(b);
    const near = ease.inQuad(ph);
    const lam = lerp(SG, 1, near);
    const I = env * (0.25 + 0.9 * near) * (1 - smoothstep(0.93, 1, ph));
    const c: RGB = [lerp(LIN.bone[0] * 0.5, LIN.ember[0] * 1.8, near) * I, lerp(LIN.bone[1] * 0.5, LIN.ember[1] * 1.8, near) * I, lerp(LIN.bone[2] * 0.5, LIN.ember[2] * 1.8, near) * I];
    const cs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [u0, v0] = cs[k]!, [u1, v1] = cs[(k + 1) % 4]!;
      for (let s = 0; s < 6; s++) {
        const seg = projSeg(cam, beamPt(lerp(u0, u1, s / 6), lerp(v0, v1, s / 6), lam, o), beamPt(lerp(u0, u1, (s + 1) / 6), lerp(v0, v1, (s + 1) / 6), lam, o));
        if (seg) lb.seg2(seg.x0, seg.y0, seg.x1, seg.y1, 1.4, c, 1);
      }
    }
    // landing: the screen's edge flares on the beat
    const tb = au.timeOfBeat(Math.floor(b));
    const fl = pulse(t, tb, 0.07) * env * (tb > T.every + 0.4 ? 1 : 0);
    if (fl > 0.02) {
      const cf: RGB = [LIN.ember[0] * 2 * fl, LIN.ember[1] * 2 * fl, LIN.ember[2] * 2 * fl];
      for (let k = 0; k < 4; k++) {
        const [u0, v0] = cs[k]!, [u1, v1] = cs[(k + 1) % 4]!;
        const seg = projSeg(cam, beamPt(u0, v0 * 1.0, 1, o), beamPt(u1, v1, 1, o));
        if (seg) lb.seg2(seg.x0, seg.y0, seg.x1, seg.y1, 1.6, cf, 1);
      }
    }
  }

  // ------------------------------------------------------------------ the throw, ticked off as the light passes
  throwPt(s: number, off = 0): V3 {
    const a: V3 = [0, HALL.G[1] - GATE_HH - 0.35, HALL.G[2]], b: V3 = [0, HALL.SC[1] - HALL.SHH - 0.35, 0.02];
    const p = mix3(a, b, s / THROW);
    return [p[0], p[1] + off, p[2]];
  }
  drawThrow(lb: LineBatch, t: number, cam: Cam, head: number, lit: number) {
    const T = this.T;
    // reach: the formed words' far edges, then the stream's head
    let lamR = SG;
    for (const w of this.words) lamR = Math.max(lamR, lerp(w.lam0, w.lam1, prog(t, w.ta0, w.ta1)) * (t >= w.ta0 ? 1 : 0));
    lamR = Math.max(lamR, head);
    const reach = clamp((lamR - SG) / (1 - SG)) * THROW;
    const vis = lit * (1 - prog(t, T.turn0 + 0.1, T.turn1 - 0.1));
    if (reach <= 0.01 || vis <= 0) return reach;
    const sg = projSeg(cam, this.throwPt(0), this.throwPt(reach));
    if (sg) lb.seg2(sg.x0, sg.y0, sg.x1, sg.y1, 1, [LIN.bone[0] * 0.3 * vis, LIN.bone[1] * 0.3 * vis, LIN.bone[2] * 0.3 * vis], 1);
    for (let m = 0; m <= Math.floor(THROW); m++) {
      if (m > reach) break;
      const major = m % 5 === 0;
      const hk = Math.exp(-(reach - m) / 0.9);
      const I = (major ? 0.45 : 0.25) * vis * (1 + 4 * hk);
      const s2 = projSeg(cam, this.throwPt(m, 0), this.throwPt(m, major ? -0.22 : -0.1));
      if (s2) lb.seg2(s2.x0, s2.y0, s2.x1, s2.y1, 1, [lerp(LIN.bone[0], LIN.ember[0] * 2, hk) * I, lerp(LIN.bone[1], LIN.ember[1] * 2, hk) * I, lerp(LIN.bone[2], LIN.ember[2] * 2, hk) * I], 1);
    }
    return reach;
  }

  // ------------------------------------------------------------------ lettering
  drawLabels(c: CanvasRenderingContext2D, t: number, cam: Cam, o: number, reach: number, head: number, scrLum: number, live: number) {
    const T = this.T;
    if (live <= 0) return;
    const on = (p: { x: number; y: number; z: number }, m = 40) => p.z > 0.2 && p.x > -m && p.x < W + m && p.y > -m && p.y < H + m;
    c.save();
    c.textBaseline = 'alphabetic';
    const side = 1 - prog(t, T.turn0 + 0.05, T.turn0 + 0.3);
    const facing = prog(t, T.turn1 - 0.2, T.turn1 + 0.05);

    // the projector's plate beside the port (lit by the lamp once the douser opens); the frame counter
    const plateK = prog(t, T.every + 0.06, T.every + 0.3) * side * live;
    if (plateK > 0) {
      const G = HALL.G;
      const pa = project(cam, [G[0] - 0.62, G[1] + 0.3, HALL.backZ - 0.01]);
      const pg = project(cam, [G[0] - (GATE_HW + 0.02) * o, G[1] + GATE_HH, G[2]]);
      const edgeK = smoothstep(-20, 40, pa.x) * (1 - smoothstep(W - 520, W - 460, pa.x));
      if (on(pa, 400) && edgeK > 0) {
        c.globalAlpha = edgeK;
        const lines = [
          'PROJECTOR 1  ·  XENON 3 kW  ·  24 fps  ·  2.39:1',
          `LENS 100 mm f/2  ·  THROW ${THROW.toFixed(2)} m  ·  FOCUS SET`,
        ];
        const fsz = 14;
        c.font = font(F.mono(500), fsz);
        const typed = prog(t, T.every + 0.06, T.every + 0.5);
        c.strokeStyle = rgba('bone', 0.35 * plateK); c.lineWidth = 1;
        c.beginPath(); c.moveTo(pg.x, pg.y); c.lineTo(pa.x - 6, pa.y - 30); c.lineTo(pa.x - 2, pa.y - 30); c.stroke();
        lines.forEach((s, i) => {
          const n = Math.floor(s.length * clamp(typed * 1.4 - i * 0.3));
          c.fillStyle = rgba('bone', 0.72 * plateK);
          c.fillText(s.slice(0, n), pa.x, pa.y - 26 + i * 19);
        });
        c.font = font(F.mono(600), 16);
        c.fillStyle = rgba('bone', 0.8 * plateK);
        c.fillText('SHOW 1  ·  FEATURE: ONE PROMPT', pa.x, pa.y + 26);
        c.font = font(F.mono(400), 12);
        c.fillStyle = rgba('bone', 0.45 * plateK);
        c.fillText('REEL 1 OF 1  ·  CHANGEOVER: NONE  ·  DOUSER OPEN', pa.x, pa.y + 46);
        c.globalAlpha = 1;
      }
    }

    // the in-world counter, pinned to the beam's top edge near the gate; it flares as each beat's ring passes it
    {
      const au = this.ctx.audio;
      const env = smoothstep(T.every + 0.2, T.every + 0.4, t) * side * live;
      if (env > 0.02) {
        const LAMC = 0.2;
        const b = au.beatAt(t), ph = b - Math.floor(b);
        const lamRing = lerp(SG, 1, ease.inQuad(ph));
        const pass = Math.exp(-Math.abs(lamRing - LAMC) / 0.03);
        const p = project(cam, beamPt(0, 1.08, LAMC, 1));
        if (on(p, 0) && p.x < W - 260) {
          c.font = font(F.mono(600), 17);
          c.fillStyle = rgba('bone', 0.7 * env);
          c.fillText('FRAME', p.x, p.y - 8);
          c.fillStyle = pass > 0.3 ? rgba('ember', env) : rgba('signal', 0.9 * env);
          c.fillText(grp(frames(frameIdx(t) / 60)), p.x + 62, p.y - 8);
          c.font = font(F.mono(400), 11);
          c.fillStyle = rgba('bone', 0.4 * env);
          c.fillText('24 fps · 11.8 FRAMES PER BEAT AT 122 BPM', p.x, p.y + 8);
        }
      }
    }

    // the words' own data, set as each forms, struck as it leaves
    c.font = font(F.mono(500), 13);
    for (const w of this.words) {
      const k = prog(t, w.ta0, w.ta0 + 0.12) * (1 - prog(t, w.tl0, w.tl0 + 0.2)) * side * live;
      if (k <= 0) continue;
      const p = project(cam, beamPt(0, w.vBot - 0.12, w.lam0, 1));
      if (!on(p)) continue;
      const age = t - w.ta0;
      c.fillStyle = age < 0.3 ? rgba('signal', k) : rgba('bone', 0.6 * k);
      c.fillText(`WORD ${w.i}  ·  ${comma(w.n)} MOTES`, p.x, p.y + 16);
      c.fillStyle = rgba('bone', 0.35 * k);
      c.fillRect(p.x, p.y + 2, 1, 8);
    }

    // throw labels
    const thK = live * (1 - prog(t, T.turn0 + 0.1, T.turn1 - 0.1));
    if (thK > 0) {
      c.font = font(F.mono(400), 12);
      for (let m = 5; m <= THROW; m += 5) {
        if (m > reach) break;
        const p = project(cam, this.throwPt(m, -0.3));
        if (!on(p)) continue;
        const hk = Math.exp(-(reach - m) / 0.9);
        c.fillStyle = hk > 0.3 ? rgba('ember', thK) : rgba('bone', 0.55 * thK);
        c.fillText(`${m} m`, p.x - 10, p.y + 12);
      }
      if (reach > THROW - 0.5) {
        const p = project(cam, this.throwPt(THROW * 0.8, -0.3));
        if (on(p)) { c.fillStyle = rgba('bone', 0.7 * thK); c.fillText(`THROW ${THROW.toFixed(2)} m, LENS TO SCREEN`, p.x - 60, p.y + 30); }
      }
    }

    // the seat plan: row letters down the centre aisle (lit as the light passes over, or by the screen)
    c.font = font(F.mono(600), 13);
    const lamHead = Math.max(head, SG);
    let lastY = 1e9;
    for (let k = 0; k < HALL.NROW; k++) {
      const z = rowZ(k);
      const passed = smoothstep(lamOfZ(z) - 0.02, lamOfZ(z) + 0.04, lamHead);
      const a = Math.max(passed * 0.55 * side, clamp(scrLum * 1.2) * 0.6 * facing) * live;
      if (a < 0.02) continue;
      const p = project(cam, [0.62, floorY(z) + 1.02, z + 0.3]);
      if (!on(p, 10)) continue;
      const sz = clamp((0.2 * cam.focal) / p.z, 0, 16);
      if (sz < 8 || Math.abs(p.y - lastY) < sz * 1.1) continue;
      lastY = p.y;
      c.font = font(F.mono(600), sz);
      c.fillStyle = rgba('bone', a);
      c.fillText(ROWS[k]!, p.x - sz * 0.3, p.y);
    }
    // seat numbers on the backs of the rows in front of the camera (odd left, even right)
    const seatK = clamp(scrLum * 1.5) * facing * live;
    if (seatK > 0.03) {
      for (let k = 3; k < HALL.NROW; k++) {
        const z = rowZ(k) + 0.33;
        if (z > cam.pos[2] - 1.2) break;
        for (let j = 0; j < 12; j++) for (const sx of [-1, 1]) {
          const x = sx * (1.12 + j * HALL.seatP);
          const p = project(cam, [x, floorY(rowZ(k)) + 0.9, z]);
          if (!on(p, 0)) continue;
          const sz = clamp((0.075 * cam.focal) / p.z, 6, 12);
          if (sz < 6.5) continue;
          c.font = font(F.mono(500), sz);
          c.fillStyle = rgba('bone', 0.4 * seatK);
          c.fillText(String(sx < 0 ? 2 * j + 1 : 2 * j + 2), p.x - sz * 0.3, p.y);
        }
      }
    }

    // the proscenium's inscription, lit by the screen
    if (facing > 0) {
      const a = project(cam, [-8.3, 9.94, 1.7]), b = project(cam, [8.3, 8.9, 1.7]);
      const fh = b.y - a.y, fw = b.x - a.x;
      if (a.z > 0 && fh > 4) {
        const txt = 'THE ONE PROMPT PICTURE HOUSE';
        const fam = F.serif(600, false);
        let sz = fh * 0.46;
        c.font = font(fam, sz);
        c.letterSpacing = `${sz * 0.22}px`;
        const tw = c.measureText(txt).width;
        if (tw > fw * 0.78) { sz *= (fw * 0.78) / tw; c.font = font(fam, sz); c.letterSpacing = `${sz * 0.22}px`; }
        c.textAlign = 'center';
        c.fillStyle = rgba('bone', (0.06 + 0.5 * clamp(scrLum * 1.3)) * facing * live);
        c.fillText(txt, (a.x + b.x) / 2 + sz * 0.11, a.y + fh * 0.5 + sz * 0.33);
        c.textAlign = 'left';
        c.letterSpacing = '0px';
      }
    }

    // EXIT: ink letters on the lit signs
    c.font = font(F.mono(700), 10);
    for (const e of EXITS) {
      const p = project(cam, [e[0] - Math.sign(e[0]) * 0.05, e[1], e[2]]);
      if (!on(p, 0) || p.z > 12) continue;
      const sz = clamp((0.16 * cam.focal) / p.z, 5, 30);
      if (sz < 6) continue;
      c.font = font(F.mono(700), sz);
      c.textAlign = 'center';
      c.fillStyle = rgba('ink', 0.85 * live);
      c.fillText('EXIT', p.x, p.y + sz * 0.35);
      c.textAlign = 'left';
    }

    // the footnote
    const fn = prog(t, T.light + 0.15, T.light + 0.45) * live;
    if (fn > 0) {
      c.fillStyle = rgba('ink', 0.82 * fn);
      c.fillRect(80, 984, 800, 48);
      c.font = font(F.mono(400), 13);
      c.fillStyle = rgba('bone', 0.55 * fn);
      c.fillText('¹ Dust in the beam is normal. Dust in the shape of words should be reported to the booth.', 96, 1004);
      c.fillStyle = rgba('bone', 0.32 * fn);
      c.fillText('CAMERA: ROW N, CENTRE AISLE (NOT A SEAT)  ·  HOUSE LIGHTS: OUT  ·  HAZE: 0.2 mg/m³', 96, 1024);
    }
    c.restore();
  }
}
