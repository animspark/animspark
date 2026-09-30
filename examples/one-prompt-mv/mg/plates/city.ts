// Plate `city` (TREATMENT: blueprint + nightcity). "Stack the letters brick by brick / Build a city,
// click click click / (instrumental) / Turn the lights on one by one".
// One axonometric drawing, one continuous camera:
//  1. Blueprint. From H3 (ink, one bone hairline at y 780, the spark at x 1500) the camera is a front
//     elevation, so the whole ground plane is that one line; the bone paper floods out of it and the
//     camera tilts up into an axonometric. The sung letters drop as letter-bricks, course by course,
//     the spark climbing the dimension line; plumb bob, mason's line, dust, callouts. "Build a city,":
//     the view snaps to isometric, the lot plan is plotted out of the stack, the words are painted on
//     the avenue, north arrow, section line, title block (FRAMES). "click click click": a cursor clicks
//     three lots, towers spring up, APPROVED stamps slam.
//  2. Dusk. Beat-stepped pull-back while the spark spirals out and draws the city (hot lines cooling
//     to ink), the river and the streets; the night comes over the sheet from the far side and the
//     lines invert as it passes.
//  3. Night. Rooftop signs light word by word (TURN THE / LIGHTS / ON), windows light outward from the
//     caret, counted in the title block. A whip to the slab by the river: ONE / BY / ONE painted down
//     its wall, the camera descending and zooming about each; the view turns to a front elevation and
//     pushes into the one lit window (H4).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H, makeRT, clearRT } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN } from '../px/palette';
import { F, font, measure } from '../px/type';
import { sparkHead, sparkParticles } from '../px/motifs';
import { clamp, ease, keys, lerp, prog, pulse, hash, noise1, springStep, frameIdx, TAU } from '../px/util';
import { wStart, wEnd, wText, charTimes } from './lyric';
import { CUT, GROUND_H3, WINDOW_H4, frames } from './handoff';
import { buildWorld, layoutStack, BRICK, PL, RCITY, SLAB, HERO_C, WIN, TOWERS, riverY, type World, type BrickDef, type V3, type Bldg } from './city-geo';
import { type Cam, mixCam, zoomAbout, camXf, apply, applyV, setThreeCam, groundInverse, type Xf } from './city-cam';
import { makeBoxMaterial, makeWindowMaterial, additivePreserveAlpha, PAPER_FRAG } from './city-gl';

const DEG = Math.PI / 180;
const PERF_PROBE = false;
type Ctx2 = CanvasRenderingContext2D;
const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
const lerp3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
/** channel-coded Canvas2D colour: r = hairline, g = type, b = orange */
const C3 = (r: number, g: number, b: number, a = 1) => `rgba(${Math.round(clamp(r) * 255)},${Math.round(clamp(g) * 255)},${Math.round(clamp(b) * 255)},${a})`;
/** heat by age: 1 at the pen, signal wake, cooled by ~0.3 s */
const heat = (age: number) => (age < 0 ? 0 : Math.exp(-age / 0.3));
/** beat-quantised step: a short anticipation creep, then outExpo */
const bstep = (t: number, tb: number, dur = 0.42) => (t < tb - 0.12 ? 0 : t < tb ? 0.1 * ease.inQuad((t - tb + 0.12) / 0.12) : 0.1 + 0.9 * ease.outExpo(clamp((t - tb) / dur)));

interface Shot { t0: number; key: (t: number) => Cam; snap: number; ease?: (x: number) => number; about?: V3; dip?: number }
interface Stamp { t: number; at: V3; rot: number; seed: number; n: number }

export default class City extends Scene {
  // ---- GPU
  inkRT = makeRT();
  boxCam = new THREE.OrthographicCamera();
  lineCam = new THREE.OrthographicCamera();
  boxScene = new THREE.Scene();
  winScene = new THREE.Scene();
  boxMat = makeBoxMaterial();
  winMat = makeWindowMaterial();
  boxes!: THREE.InstancedMesh;
  winMesh!: THREE.Mesh;
  lines = new LineBatch(60000, { screen2D: false, blend: 'add', depthTest: true });
  glow = new LineBatch(8000, { blend: 'add' });
  txt = new Layer2D();
  paper = new FSPass(PAPER_FRAG, {
    inkTex: { value: null }, txtTex: { value: null }, floodY: { value: 780 }, floodR: { value: -10 },
    gA: { value: new THREE.Vector3() }, gB: { value: new THREE.Vector3() },
    dA: { value: new THREE.Vector3(0.7071, 0.7071, 1e4) }, dW: { value: 14 }, dAll: { value: 0 },
    lineNight: { value: 1 }, lineFade: { value: 1 }, typeFade: { value: 1 }, hotGain: { value: 1 }, lightGain: { value: 1 },
    pA: { value: new THREE.Vector3(1, 0, 0) }, pB: { value: new THREE.Vector3(0, 1, 0) }, pz: { value: 1 },
    st: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    sb: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  });

  // ---- world
  world!: World;
  bricks: BrickDef[] = [];
  courseDone: number[] = [];
  courseWords: string[] = [];
  winTLit!: Float32Array;
  litSorted!: Float32Array;
  nLit = 0;
  capK = 0.72;
  stamps: Stamp[] = [];
  shots: Shot[] = [];
  heroSigns: { txt: string; word: number; c: V3; cap: number }[] = [];
  towerSigns: { rows: { txt: string; word: number }[]; c: V3; cap: number; w: number; tower: number }[] = [];

  T = {
    t0: 0, t1: 0, build: 0, a: 0, city: 0, click: [0, 0, 0], clickE: 0,
    d0: 0, d1: 0, dk0: 0, dk1: 0, night: 0, turn: 0, the: 0, lights: 0, on: 0, one1: 0, by: 0, one2: 0,
    whip0: 0, whip1: 0, fin: 0, plan0: 0, plan1: 0,
  };
  beats: number[] = [];
  duskBeats: number[] = [];

  override async init() {
    const T = this.T, au = this.ctx.audio;
    T.t0 = CUT.city; T.t1 = CUT.plot;
    for (const b of au.beats) if (b > T.t0 - 1 && b < T.t1 + 1) this.beats.push(b);
    const beatAfter = (t: number) => this.beats.find((b) => b >= t - 1e-4) ?? t;
    T.build = wStart(21); T.a = wStart(22); T.city = wStart(23);
    T.click = [wStart(24), wStart(25), wStart(26)]; T.clickE = wEnd(26);
    T.turn = wStart(27); T.the = wStart(28); T.lights = wStart(29); T.on = wStart(30);
    T.one1 = wStart(31); T.by = wStart(32); T.one2 = wStart(33);
    T.d0 = beatAfter(T.clickE - 0.05); // the pen starts drawing the city on the beat after the last click
    T.night = beatAfter(T.turn - 0.6); // the push into the night, on the downbeat before "Turn"
    T.d1 = T.night - 0.3;
    T.dk0 = beatAfter(T.d0 + 0.3); T.dk1 = T.night - 0.05;
    T.whip1 = beatAfter(T.one1 - 0.05); T.whip0 = T.whip1 - 0.27;
    T.fin = T.t1 - 0.05;
    T.plan0 = T.build; T.plan1 = T.click[0] - 0.05;
    this.duskBeats = this.beats.filter((b) => b >= T.d0 - 1e-3 && b < T.night - 0.1);

    // ---- type metrics
    {
      const c = document.createElement('canvas').getContext('2d')!;
      c.font = font(F.archivo(100, 900), 100);
      this.capK = (c.measureText('H').actualBoundingBoxAscent || 72) / 100;
    }

    // ---- the stack: one course per word of "Stack the letters brick by brick"
    const idx = [15, 16, 17, 18, 19, 20];
    this.courseWords = idx.map((i) => wText(i).toUpperCase().replace(/[^A-Z]/g, ''));
    const times = idx.map((i, c) => {
      const ct = charTimes(i);
      const n = this.courseWords[c]!.length;
      return Array.from({ length: n }, (_, k) => ct[Math.min(k, ct.length - 1)]!);
    });
    this.bricks = layoutStack(this.courseWords, idx, times);
    this.courseDone = times.map((tt) => tt[tt.length - 1]! + 0.06);

    // ---- the world and its schedule
    this.world = buildWorld();
    this.schedule();
    this.buildSigns();
    this.buildStamps();
    this.buildGPU();
    this.buildShots();
  }

  // ======================================================================= schedule
  /** radius of the lot plan plotted out of the stack during "Build a city," (beat-stepped) */
  planR(t: number) {
    const T = this.T;
    const steps = [T.build, T.a, T.city, T.city + 0.25];
    let s = 0;
    for (const b of steps) s += bstep(t, b, 0.35);
    return t < T.build - 0.12 ? 0 : 4.5 + (24 - 4.5) * (s / steps.length);
  }
  /** radius of the city drawn by the dusk pen (beat-stepped) */
  duskR(t: number) {
    const B = this.duskBeats;
    if (!B.length) return 0;
    let s = 0;
    for (const b of B) s += bstep(t, b, 0.4);
    return 9 + (RCITY + 3 - 9) * (s / B.length);
  }
  /** the dusk pen's angle: steady revolutions */
  duskA(t: number) { return 0.6 + TAU * 2.4 * (t - this.T.d0); }
  /** the night front, along the NE diagonal (far side first) */
  nightEdge(t: number) {
    const T = this.T;
    const B = this.beats.filter((b) => b >= T.dk0 - 1e-3 && b < T.dk1);
    if (t < T.dk0 - 0.2 || !B.length) return 1e4;
    let s = 0;
    for (const b of B) s += bstep(t, b, 0.45);
    return lerp(95, -100, s / B.length);
  }

  schedule() {
    const T = this.T, w = this.world;
    // plan footprints: the plan front (inner), or just before the pen extrudes (outer)
    const invPlan = (r: number) => {
      for (let t = T.build - 0.12; t < T.plan1; t += 0.004) if (this.planR(t) >= r) return t;
      return Infinity;
    };
    // dusk pen: sweep angle, draw what the swept wedge covers inside the front
    const undrawn = new Set<number>();
    w.bl.forEach((b, i) => {
      b.tPlan = b.r < 24 ? invPlan(b.r) : Infinity;
      if (b.kind === 1) b.tDraw = T.click[b.tower]!;
      else undrawn.add(i);
    });
    const dt = 0.002;
    for (let t = T.d0; t < T.d1 && undrawn.size; t += dt) {
      const a0 = this.duskA(t), a1 = this.duskA(t + dt), R = this.duskR(t);
      for (const i of undrawn) {
        const b = w.bl[i]!;
        const half = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.5;
        if (b.r - half > R) continue;
        let d = (b.ang - a0) % TAU; if (d < 0) d += TAU;
        if (d <= a1 - a0 + 1e-6) { b.tDraw = t; undrawn.delete(i); }
      }
    }
    for (const i of undrawn) w.bl[i]!.tDraw = T.d1;
    for (const b of w.bl) if (!isFinite(b.tPlan)) b.tPlan = b.tDraw - 0.07;
    // the slab is drawn with its block; its signs wait for the night

    // ---- windows: which light, and when (outward from the caret on the stack)
    const wins = w.wins;
    const n = wins.length;
    const iC = new Float32Array(n * 3), iU = new Float32Array(n * 3), iV = new Float32Array(n * 3), iT = new Float32Array(n * 4);
    this.winTLit = new Float32Array(n);
    // the first few, one by one, on the hits between "lights" and "on"
    const au = this.ctx.audio;
    const firsts = [T.lights, ...au.events('hat', T.lights + 0.06, T.lights + 0.3).map((e) => e[0]), ...au.events('kick', T.lights + 0.06, T.lights + 0.3).map((e) => e[0])]
      .sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1]! > 0.07);
    const order = wins.map((_, i) => i).filter((i) => {
      const b = w.bl[wins[i]!.b]!;
      return b.kind !== 2;
    }).sort((a, b) => {
      const ca = wins[a]!.c, cb = wins[b]!.c;
      return Math.hypot(ca[0], ca[1], ca[2] - 5) - Math.hypot(cb[0], cb[1], cb[2] - 5);
    });
    let k = 0;
    for (const i of order) {
      const wi = wins[i]!;
      const hsh = hash(i, 77);
      const b = w.bl[wi.b]!;
      const pLit = b.kind === 1 ? 0.75 : 0.64;
      if (hsh > pLit) continue;
      const d = Math.hypot(wi.c[0], wi.c[1]);
      if (k < firsts.length) wi.tLit = firsts[k]!;
      // then the rest fast, in rings outward, one ring per sixteenth (the whole city is on just after "on")
      else wi.tLit = T.lights + 0.12 + Math.floor(Math.min(0.999, Math.pow(d / RCITY, 0.7)) * 6) * (60 / au.bpm / 4) + 0.035 * hash(i, 78);
      wi.lit = true;
      k++;
    }
    const hw = wins[w.heroWin]!;
    hw.lit = true; hw.tLit = T.one2;
    wins.forEach((wi, i) => {
      iC.set(wi.c, i * 3); iU.set(wi.u, i * 3); iV.set(wi.v, i * 3);
      const b = w.bl[wi.b]!;
      const tA = b.kind === 1 ? b.tDraw + 0.75 : b.tDraw + 0.34 + 0.12 * hash(i, 3);
      iT.set([tA, wi.hero ? 1e9 : wi.tLit, hash(i, 5), wi.hero ? 1 : 0], i * 4);
      this.winTLit[i] = wi.tLit;
    });
    this.litSorted = Float32Array.from(wins.filter((x) => x.lit).map((x) => x.tLit)).sort();
    this.nLit = this.litSorted.length;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(2, 2);
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 3));
    geo.setAttribute('iU', new THREE.InstancedBufferAttribute(iU, 3));
    geo.setAttribute('iV', new THREE.InstancedBufferAttribute(iV, 3));
    geo.setAttribute('iT', new THREE.InstancedBufferAttribute(iT, 4));
    geo.instanceCount = n;
    this.winMesh = new THREE.Mesh(geo, this.winMat);
    this.winMesh.frustumCulled = false;
    this.winScene.add(this.winMesh);
  }

  litCount(t: number) {
    const a = this.litSorted;
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= t) lo = m + 1; else hi = m; }
    return lo;
  }

  buildSigns() {
    const w = this.world;
    // rooftop billboards on the three towers
    const rows = [[{ txt: 'TURN', word: 27 }, { txt: 'THE', word: 28 }], [{ txt: 'LIGHTS', word: 29 }], [{ txt: 'ON', word: 30 }]];
    const caps = [1.25, 1.3, 1.7];
    w.towers.forEach((bi, k) => {
      const b = w.bl[bi]!;
      const cap = caps[k]!;
      const r = rows[k]!;
      const wd = Math.max(...r.map((x) => measure(x.txt, F.archivo(100, 900), 100) / 100 * cap / this.capK)) + cap * 0.9;
      const hgt = r.length * cap * 1.45 + cap * 0.5;
      this.towerSigns.push({ rows: r, c: v3(b.cx, b.y0 + 0.3, b.h + 0.55 + hgt / 2), cap, w: wd, tower: k });
    });
    // ghost signs down the slab's wall, above the H4 window
    const x = HERO_C[0], y = SLAB.y0 - 0.004, z = HERO_C[2];
    this.heroSigns = [
      { txt: 'ONE', word: 31, c: v3(x, y, z + 11.5), cap: 3.2 },
      { txt: 'BY', word: 32, c: v3(x, y, z + 7.2), cap: 2.0 },
      { txt: 'ONE', word: 33, c: v3(x, y, z + 3.9), cap: 1.1 },
    ];
  }

  buildStamps() {
    const T = this.T, w = this.world;
    w.towers.forEach((bi, k) => {
      const b = w.bl[bi]!;
      this.stamps.push({ t: T.click[k]! + 0.07, at: v3(b.cx, b.cy, b.h * 0.22), rot: [-0.12, 0.09, -0.05][k]!, seed: 3.7 + k * 5.1, n: k + 1 });
    });
  }

  buildGPU() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    const n = this.world.bl.length + this.bricks.length + 4;
    this.boxes = new THREE.InstancedMesh(geo, this.boxMat, n);
    this.boxes.frustumCulled = false;
    this.boxScene.add(this.boxes);
    for (const c of [this.boxCam, this.lineCam]) { c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false; }
    additivePreserveAlpha(this.lines.mat);
    this.txt.texture.colorSpace = THREE.NoColorSpace;
  }

  // ======================================================================= camera
  nods(t: number, words: number[], k = 0.035) {
    let z = 1;
    for (const i of words) z *= 1 + k * ease.outExpo(prog(t, wStart(i) - 0.01, wStart(i) + 0.2));
    return z;
  }
  camStack(t: number): Cam {
    const T = this.T;
    const z = lerp(128, 101, prog(t, T.t0, T.build)) * this.nods(t, [15, 16, 17, 18, 19, 20]);
    const phi = keys(t, [[T.t0 + 0.05, 0], [this.beats.find((b) => b > T.t0 + 0.1) ?? T.t0 + 0.5, 15 * DEG, ease.inOutCubic], [T.build, 21 * DEG, ease.linear]]);
    return { P: [0, 0, 0], sx: 820, sy: GROUND_H3.y, z, psi: lerp(28, 33, prog(t, T.t0, T.build)) * DEG, phi, roll: 0 };
  }
  camBuild(t: number): Cam {
    const T = this.T;
    const z = 60 * (1 - 0.06 * prog(t, T.build, T.click[0]!)) * this.nods(t, [22, 23], 0.04);
    return { P: [0, -2.2, 1], sx: 900, sy: 560, z, psi: lerp(40, 42.5, prog(t, T.build, T.click[0]!)) * DEG, phi: 34.5 * DEG, roll: -0.03 + 0.03 * springStep(t - T.build, 1.4, 0.45) };
  }
  towerTop(k: number): V3 {
    const b = this.world.bl[this.world.towers[k]!]!;
    return [b.cx, b.cy, b.h];
  }
  camClick(k: number, t: number): Cam {
    const T = this.T;
    const base = this.camBuild(T.click[0]! - 0.06);
    const tt = this.towerTop(k);
    const P = lerp3(base.P, [tt[0], tt[1], tt[2] * 0.5], 0.45 + 0.1 * k);
    let z = base.z * Math.pow(0.9, k + 1);
    if (k === 2) { z *= 1 - 0.36 * prog(t, T.click[2]!, T.clickE + 0.1, ease.inOutQuad); P[2] += 5 * prog(t, T.click[2]!, T.clickE + 0.1, ease.inOutQuad); }
    const roll = base.roll + [0.018, -0.016, 0.012][k]! * (1 - springStep(t - T.click[k]!, 1.8, 0.5));
    return { ...base, P, z, roll, psi: base.psi + k * 0.6 * DEG };
  }
  camDusk(t: number): Cam {
    const T = this.T;
    const a = this.camClick(2, T.d0);
    const B = this.duskBeats;
    let s = 0;
    for (const b of B) s += bstep(t, b, 0.45);
    const k = B.length ? s / B.length : 0;
    const z = Math.exp(lerp(Math.log(a.z), Math.log(13.2), k));
    const P = lerp3(a.P, [0.5, 5, 1], ease.inOutQuad(k));
    const u = prog(t, T.d0, T.night);
    let roll = a.roll * (1 - k);
    for (const b of B) if (this.ctx.audio.downbeats.some((d) => Math.abs(d - b) < 0.05)) roll += 0.012 * Math.sin(TAU * 1.7 * (t - b)) * Math.exp(-(t - b) * 5) * (t > b ? 1 : 0);
    return { P, sx: lerp(a.sx, 960, k), sy: lerp(a.sy, 585, k), z, psi: lerp(a.psi, 49 * DEG, u), phi: lerp(a.phi, 37 * DEG, u), roll };
  }
  signsCentre(): V3 {
    const s = this.towerSigns;
    const c = s.reduce((a, x) => [a[0] + x.c[0], a[1] + x.c[1], a[2] + x.c[2]] as V3, [0, 0, 0] as V3);
    return [c[0] / s.length, c[1] / s.length, c[2] / s.length - 3.0];
  }
  camNight(t: number): Cam {
    const T = this.T;
    // the caret on top of the stack sits low in frame; the three rooftop signs rise behind it, left to right
    const caret: V3 = [0, BRICK.D / 2, this.courseDone.length * BRICK.H + 0.35];
    const drift = keys(t, [[T.turn - 0.05, 0], [T.turn + 0.2, 0.33, ease.outExpo], [T.lights - 0.02, 0.4], [T.lights + 0.22, 0.7, ease.outExpo], [T.on - 0.02, 0.75], [T.on + 0.22, 1, ease.outExpo]]);
    const z = 35 * (1 + 0.05 * prog(t, T.night, T.whip0)) * this.nods(t, [27, 28, 29, 30], 0.03);
    return { P: caret, sx: lerp(930, 860, drift), sy: lerp(975, 990, drift), z, psi: 45 * DEG, phi: 33 * DEG, roll: -0.01 + 0.012 * Math.sin(TAU * 0.9 * (t - T.turn)) * Math.exp(-(t - T.turn) * 2) * (t > T.turn ? 1 : 0) };
  }
  camSign(i: number, t: number): Cam {
    const T = this.T;
    const s = this.heroSigns[i]!;
    const zs = [64, 96, 122][i]!;
    const psi = [27, 17, 8][i]! * DEG, phi = [17, 10, 4][i]! * DEG;
    const t0 = [T.one1, T.by, T.one2][i]!;
    const P: V3 = i === 2 ? [HERO_C[0], HERO_C[1], HERO_C[2] + 1.95] : s.c;
    return { P, sx: 960, sy: 540, z: zs * (1 + 0.05 * prog(t, t0, t0 + 0.6)), psi, phi, roll: [0.02, -0.012, 0.006][i]! * (1 - prog(t, t0, t0 + 0.5, ease.outCubic)) };
  }
  camWindow(): Cam {
    return { P: [HERO_C[0], HERO_C[1], HERO_C[2]], sx: WINDOW_H4.x, sy: WINDOW_H4.y, z: WINDOW_H4.w / WIN.w, psi: 0, phi: 0, roll: 0 };
  }

  buildShots() {
    const T = this.T;
    this.shots = [
      { t0: T.t0 - 1, key: (t) => this.camStack(t), snap: 0 },
      { t0: T.build - 0.02, key: (t) => this.camBuild(t), snap: 0.45 },
      { t0: T.click[0]! - 0.06, key: (t) => this.camClick(0, t), snap: 0.24 },
      { t0: T.click[1]! - 0.06, key: (t) => this.camClick(1, t), snap: 0.22 },
      { t0: T.click[2]! - 0.06, key: (t) => this.camClick(2, t), snap: 0.22 },
      { t0: T.d0 - 0.05, key: (t) => this.camDusk(t), snap: 0.1 },
      { t0: T.night - 0.12, key: (t) => this.camNight(t), snap: 0.5, about: [0, BRICK.D / 2, 5] },
      { t0: T.whip0, key: (t) => this.camSign(0, t), snap: T.whip1 - T.whip0 + 0.03, ease: ease.inOutExpo, dip: 0.3 },
      { t0: T.by - 0.03, key: (t) => this.camSign(1, t), snap: 0.3 },
      { t0: T.one2 - 0.03, key: (t) => this.camSign(2, t), snap: 0.28 },
      { t0: T.one2 + 0.24, key: () => this.camWindow(), snap: T.fin - (T.one2 + 0.24), ease: ease.inOutCubic },
    ];
  }

  camAt(t: number): Cam {
    const S = this.shots;
    let i = 0;
    while (i + 1 < S.length && t >= S[i + 1]!.t0) i++;
    const s = S[i]!;
    let c = s.key(t);
    if (i > 0 && s.snap > 0 && t - s.t0 < s.snap) {
      const k = (s.ease ?? ease.outExpo)(clamp((t - s.t0) / s.snap));
      const prev = S[i - 1]!.key(t);
      c = s.about ? zoomAbout(prev, c, k, s.about) : mixCam(prev, c, k);
      if (s.dip) c.z *= 1 - s.dip * Math.sin(Math.PI * k);
    }
    return c;
  }

  // ======================================================================= the pen
  /** where the spark (the pen, the caret) is, in world coordinates; null while it is the cursor */
  penW(t: number): V3 | null {
    const T = this.T;
    const cam0 = this.camStack(T.t0);
    if (t < T.t0 + 0.3) {
      // riding the ground line leftward from H3's x 1500
      const s0 = (GROUND_H3.sparkX - cam0.sx) / cam0.z;
      const s = s0 - 2.1 * (t - T.t0) - 0.6 * Math.max(0, t - T.t0 - 0.1) ** 2;
      const psi = this.camStack(t).psi;
      return [s * Math.cos(psi), -s * Math.sin(psi), 0];
    }
    const dimX = 4.35;
    if (t < T.build) {
      // hop to the dimension line, then climb it a course at a time
      let z = 0;
      for (let c = 0; c < this.courseDone.length; c++) z += BRICK.H * ease.outExpo(prog(t, this.courseDone[c]!, this.courseDone[c]! + 0.16));
      const sEnd = this.penW(T.t0 + 0.2999)!;
      const k = ease.inOutCubic(prog(t, T.t0 + 0.3, T.t0 + 0.42));
      return lerp3(sEnd, [dimX, 0, z], k);
    }
    if (t < T.click[0]! - 0.25) {
      // the plan: spiralling out of the stack with the plan front
      const R = Math.max(2.5, this.planR(t) - 1.2), a = -0.9 + TAU * 1.6 * (t - T.build);
      const p: V3 = [Math.cos(a) * R, Math.sin(a) * R, 0];
      const top: V3 = [dimX, 0, this.courseDone.length * BRICK.H];
      return lerp3(top, p, ease.inOutCubic(prog(t, T.build, T.build + 0.16)));
    }
    if (t < T.d0 - 0.05) return null;
    if (t < T.d1 + 0.05) {
      const R = Math.max(3, this.duskR(t) - 2.5), a = this.duskA(t);
      const p: V3 = [Math.cos(a) * R, Math.sin(a) * R, 0.2];
      const tt = this.towerTop(2);
      return lerp3(tt, p, ease.inOutCubic(prog(t, T.d0 - 0.05, T.d0 + 0.18)));
    }
    const caret: V3 = [0, BRICK.D / 2, this.courseDone.length * BRICK.H + 0.35];
    if (t < T.whip0 - 0.1) {
      const a = this.duskA(T.d1 + 0.05), R = Math.max(3, this.duskR(T.d1 + 0.05) - 2.5);
      const from: V3 = [Math.cos(a) * R, Math.sin(a) * R, 0.2];
      return lerp3(from, caret, ease.inOutCubic(prog(t, T.d1 + 0.05, T.night + 0.1)));
    }
    // the flight to the slab, then into the window on the last "one"
    const hero: V3 = [HERO_C[0], HERO_C[1] - 0.25, HERO_C[2]];
    const k = ease.inOutCubic(prog(t, T.whip0 - 0.1, T.by + 0.2));
    const p = lerp3(caret, hero, k);
    p[2] += 7 * Math.sin(Math.PI * k);
    return p;
  }
  penOn(t: number) {
    const T = this.T;
    if (t < T.one2 - 0.2) return 1;
    return 1 - prog(t, T.one2 - 0.04, T.one2 + 0.06);
  }

  // ======================================================================= render
  private perfN = 0; private perfMs = 0;
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const p0 = performance.now();
    const r = this.render1(f, out);
    this.ctx.renderer.getContext().finish();
    this.perfMs += performance.now() - p0; this.perfN++;
    return r;
  }
  render1(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, T = this.T;
    const cam = this.camAt(t);
    const m = camXf(cam);
    setThreeCam(this.boxCam, m, 0);
    setThreeCam(this.lineCam, m, 0.06);

    // ---- global states
    const floodR = t < T.t0 + 0.02 ? -12 : lerp(-12, 1300, ease.outExpo(prog(t, T.t0 + 0.02, T.t0 + 0.55)) * 0.85 + 0.15 * prog(t, T.t0 + 0.02, T.t0 + 0.55));
    const nEdge = this.nightEdge(t);
    const dAll = prog(t, T.night - 0.25, T.night + 0.1);
    const night = Math.max(dAll, clamp((95 - nEdge) / 195));
    const lineFade = 1 - prog(t, T.one2 + 0.2, T.fin - 0.02, ease.inOutQuad);
    const typeFade = 1 - prog(t, T.one2 + 0.34, T.fin - 0.02, ease.inOutQuad);

    // ---- boxes (depth + tone)
    this.updateBoxes(t);
    this.boxMat.uniforms.zoom!.value = cam.z;
    this.boxMat.uniforms.tone!.value = 1;
    clearRT(renderer, this.inkRT, [0, 0, 0], 0);
    renderer.setRenderTarget(this.inkRT);
    renderer.render(this.boxScene, this.boxCam);

    // ---- windows
    const wu = this.winMat.uniforms;
    wu.t!.value = t;
    (wu.dA!.value as THREE.Vector3).set(Math.SQRT1_2, Math.SQRT1_2, nEdge);
    wu.dW!.value = 5; wu.dAll!.value = dAll;
    wu.others!.value = 1 - prog(t, T.one2 + 0.1, T.fin - 0.03, ease.inOutQuad);
    // lights on the last "one" with a flash, settling to a flat ember fill at linear 1.0 (the H4 contract)
    wu.hero!.value = t < T.one2 ? 0 : t >= T.fin ? 1 : 1 + 2.2 * Math.exp(-(t - T.one2) / 0.1) * (1 - prog(t, T.fin - 0.15, T.fin));
    wu.unlitK!.value = 0.42;
    wu.zoom!.value = cam.z;
    renderer.render(this.winScene, this.lineCam);

    // ---- hairlines
    const lb = this.lines; lb.clear();
    this.drawLines(lb, t, cam, m, night);
    lb.render(renderer, this.inkRT, this.lineCam);

    // ---- type layer
    const L = this.txt; L.clear('#000');
    const c = L.ctx;
    c.globalCompositeOperation = 'lighter';
    this.drawType(c, t, cam, m, night);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';

    // ---- paper / night
    const P = this.paper.u;
    P.inkTex!.value = this.inkRT.texture;
    P.txtTex!.value = L.upload();
    P.floodY!.value = apply(m, [0, 0, 0]).y;
    P.floodR!.value = floodR;
    const gi = groundInverse(m);
    (P.gA!.value as THREE.Vector3).set(...gi.gA);
    (P.gB!.value as THREE.Vector3).set(...gi.gB);
    (P.dA!.value as THREE.Vector3).set(Math.SQRT1_2, Math.SQRT1_2, nEdge);
    P.dW!.value = 5; P.dAll!.value = dAll;
    P.lineNight!.value = t < T.t0 + 0.6 ? 1 : 0.4;
    P.lineFade!.value = lineFade; P.typeFade!.value = typeFade;
    {
      const k = Math.sqrt(60 / cam.z), cr = Math.cos(-cam.roll), sr = Math.sin(-cam.roll);
      (P.pA!.value as THREE.Vector3).set(cr * k, -sr * k, -(cr * cam.sx - sr * cam.sy) * k + 3000);
      (P.pB!.value as THREE.Vector3).set(sr * k, cr * k, -(sr * cam.sx + cr * cam.sy) * k + 2000);
      P.pz!.value = 1 / k;
    }
    this.setStamps(t, m, cam);
    this.paper.render(renderer, out);

    // ---- the spark (glow)
    const g = this.glow; g.clear();
    this.drawSpark(g, t);
    g.render(renderer, out);

    // ---- post
    const [shx, shy] = this.shake(t);
    const paperK = 1 - night;
    const end = 1 - prog(t, T.one2 + 0.1, T.fin - 0.1);
    return {
      bloom: lerp(0.62, 0.3, paperK), bloomThreshold: lerp(0.85, 1.25, paperK), halation: lerp(0.25, 0.06, paperK),
      vignette: lerp(0.35, 0.2, paperK), grain: lerp(0.055, 0.045, paperK), ca: lerp(1.2, 0.6, paperK) + 2.5 * this.whipK(t),
      paper: paperK > 0.5 && t > T.t0 + 0.3 ? 1 : 0,
      shake: [shx * end, shy * end],
      zoom: 1 + (0.018 * pulse(t, T.build, 0.1) + 0.02 * Math.max(...T.click.map((x) => pulse(t, x + 0.07, 0.08)))) * end,
    };
  }

  whipK(t: number) {
    const T = this.T;
    return prog(t, T.whip0, T.whip0 + 0.08) * (1 - prog(t, T.whip1 - 0.06, T.whip1 + 0.04));
  }

  shake(t: number): [number, number] {
    const T = this.T;
    let a = 0;
    for (const b of this.bricks) if (t >= b.t && t < b.t + 0.3) a += 1.6 * pulse(t, b.t, 0.035);
    for (const d of this.courseDone) a += 2.5 * pulse(t, d, 0.05);
    a += 7 * pulse(t, T.build, 0.07) + 3 * pulse(t, T.city, 0.05);
    for (const s of this.stamps) a += 15 * pulse(t, s.t, 0.06);
    a += 4 * pulse(t, T.night + 0.3, 0.08) + 5 * pulse(t, T.whip1, 0.06);
    for (const w of [27, 28, 29, 30, 31, 32]) a += 2 * pulse(t, wStart(w), 0.05);
    const ph = frameIdx(t);
    return [a * (hash(ph, 11) - 0.5) * 2, a * (hash(ph, 12) - 0.5) * 2];
  }

  // ======================================================================= boxes
  private mtx = new THREE.Matrix4();
  private setBox(i: number, x0: number, x1: number, y0: number, y1: number, z0: number, h: number) {
    const e = this.mtx.elements;
    e[0] = x1 - x0; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = y1 - y0; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = Math.max(h, 1e-4); e[11] = 0;
    e[12] = (x0 + x1) / 2; e[13] = (y0 + y1) / 2; e[14] = z0; e[15] = 1;
    this.boxes.setMatrixAt(i, this.mtx);
  }

  /** current height of a building (extrusion by the pen / the click springs) */
  bHeight(b: Bldg, t: number) {
    const age = t - b.tDraw;
    if (age < 0.05) return 0;
    if (b.kind === 1) return b.h * clamp(springStep(age - 0.02, 1.7, 0.42), 0, 1.3);
    return b.h * ease.outBack(clamp((age - 0.05) / 0.26), 1.4);
  }
  /** a brick's current base height (dropping in, then a small settle) */
  brickZ(b: BrickDef, t: number) {
    const u = (t - (b.t - 0.2)) / 0.2;
    if (u < 1) return b.z0 + 2.4 * (1 - u * u);
    const a = t - b.t;
    return b.z0 + 0.07 * Math.exp(-a / 0.06) * Math.abs(Math.sin(a * 38));
  }

  updateBoxes(t: number) {
    let n = 0;
    for (const b of this.bricks) {
      if (t < b.t - 0.2) continue;
      const z = this.brickZ(b, t), g = BRICK.gap / 2;
      this.setBox(n++, b.x0 + g, b.x0 + BRICK.L - g, 0, BRICK.D, z + g, BRICK.H - 2 * g);
    }
    for (const b of this.world.bl) {
      const h = this.bHeight(b, t);
      if (h <= 0.001) continue;
      this.setBox(n++, b.x0, b.x1, b.y0, b.y1, 0, h);
    }
    this.boxes.count = n;
    this.boxes.instanceMatrix.needsUpdate = true;
    this.boxes.instanceMatrix.clearUpdateRanges();
    this.boxes.instanceMatrix.addUpdateRange(0, n * 16);
  }

  // ======================================================================= hairlines
  private lb!: LineBatch;
  private seg(a: V3, b: V3, w: number, r: number, g: number, bl: number, al = 1) {
    this.lb.seg(a[0], a[1], a[2], b[0], b[1], b[2], w, r, g, bl, al);
  }
  /** a line with heat by age: `ta`/`tb` are when the pen passed its ends */
  private hotLine(a: V3, b: V3, ta: number, tb: number, t: number, w = 1.1, al = 1, n = 4) {
    if (t < ta) return;
    const u = tb > ta ? clamp((t - ta) / (tb - ta)) : 1;
    for (let k = 0; k < n; k++) {
      const s0 = k / n, s1 = (k + 1) / n;
      if (s0 >= u) break;
      const e = Math.min(s1, u);
      const age = t - lerp(ta, tb, (s0 + e) / 2);
      const h = heat(age);
      this.seg(lerp3(a, b, s0), lerp3(a, b, e), w * (1 + 0.6 * Math.exp(-age / 0.05)), 1 - h, 0, h, al);
    }
  }
  /** box edges the viewer can see (the hidden back edges are left out; the depth test does the rest) */
  private boxEdges(x0: number, x1: number, y0: number, y1: number, z0: number, h: number, w: number, r: number, bl: number, al = 1) {
    const z1 = z0 + h;
    const S = (a: V3, b: V3) => this.seg(a, b, w, r, 0, bl, al);
    S([x0, y0, z1], [x1, y0, z1]); S([x1, y0, z1], [x1, y1, z1]); S([x1, y1, z1], [x0, y1, z1]); S([x0, y1, z1], [x0, y0, z1]);
    S([x0, y0, z0], [x0, y0, z1]); S([x1, y0, z0], [x1, y0, z1]); S([x0, y1, z0], [x0, y1, z1]);
    S([x0, y0, z0], [x1, y0, z0]); S([x0, y0, z0], [x0, y1, z0]);
  }

  drawLines(lb: LineBatch, t: number, cam: Cam, m: Xf, night: number) {
    this.lb = lb;
    const T = this.T, w = this.world;
    const pitchK = clamp(cam.phi / (8 * DEG));
    // --- the ground line (a sheet-space datum: the view's horizontal through the stack)
    {
      const al = 1 - prog(t, T.build + 0.2, T.click[0]!);
      if (al > 0) {
        const hd: V3 = [Math.cos(cam.psi), -Math.sin(cam.psi), 0];
        const L = 60;
        this.seg([-hd[0] * L, -hd[1] * L, 0], [hd[0] * L, hd[1] * L, 0], 1.5, 1, 0, 0, al);
        // scale ticks, travelling out from the spark's start
        const s0 = (GROUND_H3.sparkX - 820) / 128;
        for (let k = -24; k <= 16; k++) {
          const s = k * 0.5;
          const ta = T.t0 + 0.04 + Math.abs(s - s0) / 14;
          if (t < ta) continue;
          const len = (k % 2 === 0 ? 0.2 : 0.1) * ease.outCubic(prog(t, ta, ta + 0.08));
          const p: V3 = [hd[0] * s, hd[1] * s, 0];
          const h = heat(t - ta);
          this.seg(p, [p[0], p[1], -len], 1.1, 1 - h, 0, h, al);
        }
        // the datum: a small triangle standing on the line under the stack's axis
        const dt0 = T.t0 + 0.3;
        if (t > dt0) {
          const q = 0.22 * ease.outBack(prog(t, dt0, dt0 + 0.15));
          const o: V3 = [hd[0] * 6.5, hd[1] * 6.5, 0];
          const a: V3 = [o[0] - hd[0] * q, o[1] - hd[1] * q, q * 1.2], b: V3 = [o[0] + hd[0] * q, o[1] + hd[1] * q, q * 1.2];
          this.seg(o, a, 1.1, 1, 0, 0, al); this.seg(a, b, 1.1, 1, 0, 0, al); this.seg(b, o, 1.1, 1, 0, 0, al);
        }
      }
    }
    // --- brick-module drafting grid, opening with the pitch
    {
      const al = pitchK * (1 - prog(t, T.build, T.build + 0.5));
      if (al > 0.01) {
        for (let k = -8; k <= 8; k++) {
          for (let s = -6; s < 6; s++) {
            for (const [a, b] of [[[k, s, 0], [k, s + 1, 0]], [[s, k, 0], [s + 1, k, 0]]] as [V3, V3][]) {
              const r = Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
              const ta = T.t0 + 0.35 + r / 12;
              if (t < ta) continue;
              const fall = clamp(1 - r / 9);
              if (fall <= 0) continue;
              this.hotLine(a, b, ta, ta + 0.05, t, 0.7, al * fall * 0.5, 1);
            }
          }
        }
      }
    }
    // --- the stack
    for (const b of this.bricks) {
      if (t < b.t - 0.2) continue;
      const z = this.brickZ(b, t), g = BRICK.gap / 2;
      const age = Math.max(0, t - b.t);
      const h = t < b.t ? 0 : heat(age);
      const al = t < b.t ? 0.35 + 0.65 * prog(t, b.t - 0.2, b.t) : 1;
      this.boxEdges(b.x0 + g, b.x0 + BRICK.L - g, 0, BRICK.D, z + g, BRICK.H - 2 * g, 1.3 * (1 + 0.5 * Math.exp(-age / 0.05)), 1 - h, h, al);
      // dust: hairlines kicked out along the course under it
      if (age > 0 && age < 0.4) {
        const k = ease.outCubic(clamp(age / 0.25)), fa = 1 - age / 0.4;
        for (let j = 0; j < 5; j++) {
          const side = j < 2 ? -1 : 1;
          const x = side < 0 ? b.x0 : b.x0 + BRICK.L;
          const ang = (j % 2 ? 0.35 : -0.25) + hash(j, b.k, b.course) * 0.4;
          const L0 = 0.08 + 0.05 * j, L1 = L0 + 0.32 * k * (0.6 + 0.6 * hash(j, b.k));
          const dx = side * Math.cos(ang), dy = -Math.abs(Math.sin(ang)) - 0.2;
          const y = j === 4 ? -0.02 : BRICK.D * 0.2;
          const zz = b.z0 + 0.01 + (j === 4 ? 0.06 * k : 0);
          this.seg([x + dx * L0, y + dy * L0 * (j === 4 ? 1 : 0.3), zz], [x + dx * L1, y + dy * L1 * (j === 4 ? 1 : 0.3), zz + 0.05 * k * (j % 2)], 0.9, 1, 0, 0, fa * 0.9);
        }
      }
    }
    // --- mason's line: a taut string at the working course, pinned beyond the ends
    {
      const on = prog(t, this.bricks[0]!.t - 0.3, this.bricks[0]!.t - 0.1) * (1 - prog(t, T.build, T.build + 0.3));
      if (on > 0) {
        let z = BRICK.H;
        for (let c = 0; c < this.courseDone.length - 1; c++) z += BRICK.H * clamp(springStep(t - this.courseDone[c]!, 3.2, 0.4), 0, 1.2);
        const y = -0.06, x0 = -4.9, x1 = 4.0;
        this.seg([x0, y, z], [x1, y, z], 0.8, 1, 0, 0, on * 0.9);
        for (const x of [x0, x1]) this.seg([x, y, z - 0.35], [x, y, z + 0.2], 1.3, 1, 0, 0, on);
      }
    }
    // --- plumb line and bob
    {
      const tp = this.bricks[0]!.t + 0.02;
      const on = prog(t, tp, tp + 0.2) * (1 - prog(t, T.build, T.build + 0.3));
      if (on > 0) {
        let sw = 0;
        for (const b of this.bricks) if (t > b.t) sw += 0.045 * Math.exp(-(t - b.t) / 0.55) * Math.sin(TAU * 1.25 * (t - b.t));
        const top: V3 = [-4.45, 0.31, 8.5];
        const Lp = 8.5 - 0.62;
        const bob: V3 = [top[0] + Math.sin(sw) * Lp, 0.31, top[2] - Math.cos(sw) * Lp * on];
        this.seg(top, bob, 0.8, 1, 0, 0, on);
        const r = 0.13, hb = 0.36;
        const p0: V3 = [bob[0], bob[1], bob[2]], p1: V3 = [bob[0] - r, bob[1], bob[2] - hb * 0.35], p2: V3 = [bob[0] + r, bob[1], bob[2] - hb * 0.35], p3: V3 = [bob[0], bob[1], bob[2] - hb];
        for (const [a, b] of [[p0, p1], [p0, p2], [p1, p3], [p2, p3], [p1, p2]] as [V3, V3][]) this.seg(a, b, 1.2, 1, 0, 0, on);
      }
    }
    // --- dimension line: the spark climbs it; ticks at the courses
    {
      const on = 1 - prog(t, T.click[0]!, T.click[0]! + 0.4);
      if (on > 0 && t > T.t0 + 0.42) {
        const x = 4.35;
        const pz = t < T.build ? (this.penW(t)?.[2] ?? 0) : this.courseDone.length * BRICK.H;
        this.seg([x, 0, 0], [x, 0, pz], 1, 1, 0, 0, on);
        for (let c = 0; c <= this.courseDone.length; c++) {
          const tc = c === 0 ? T.t0 + 0.42 : this.courseDone[c - 1]!;
          if (t < tc) continue;
          const zc = c * BRICK.H;
          const h = heat(t - tc);
          const k = ease.outCubic(prog(t, tc, tc + 0.1));
          // architect's slash tick + extension line back to the bricks
          this.seg([x - 0.12, 0, zc - 0.12], [x + 0.12, 0, zc + 0.12], 1.6, 1 - h, 0, h, on);
          const xe = c === 0 ? 3.6 : Math.max(...this.bricks.filter((b) => b.course === c - 1).map((b) => b.x0 + BRICK.L)) + 0.12;
          this.seg([xe, 0, zc], [lerp(xe, x + 0.3, k), 0, zc], 0.7, 1 - h, 0, h, on * 0.8);
        }
      }
    }
    // --- callout leaders
    for (const co of this.callouts()) {
      if (t < co.t) continue;
      const on = 1 - prog(t, T.build, T.build + 0.3);
      const k = ease.outExpo(prog(t, co.t, co.t + 0.18));
      const h = heat(t - co.t);
      const mid = lerp3(co.a, co.knee, k);
      this.seg(co.a, mid, 0.9, 1 - h, 0, h, on);
      if (k > 0.98) this.seg(co.knee, lerp3(co.knee, co.end, ease.outExpo(prog(t, co.t + 0.1, co.t + 0.3))), 0.9, 1 - h, 0, h, on);
    }

    // --- the city: plan footprints, then extrusions; streets, river, limit
    const onScreen = (b: Bldg) => {
      const p = apply(m, [b.cx, b.cy, 0]);
      const r = (Math.max(b.x1 - b.x0, b.y1 - b.y0) + b.h) * cam.z;
      return p.x > -r && p.x < W + r && p.y > -r && p.y < H + r * 1.5;
    };
    const far = cam.z < 22;
    for (const b of w.bl) {
      if (t < b.tPlan || !onScreen(b)) continue;
      const hh = this.bHeight(b, t);
      if (hh <= 0.001) {
        // footprint only (the plan): drawn by the front, hot
        const ta = b.tPlan;
        const c: V3[] = [[b.x0, b.y0, 0], [b.x1, b.y0, 0], [b.x1, b.y1, 0], [b.x0, b.y1, 0]];
        for (let k = 0; k < 4; k++) this.hotLine(c[k]!, c[(k + 1) % 4]!, ta + k * 0.02, ta + (k + 1) * 0.02, t, 0.8, 0.85, 1);
        continue;
      }
      const age = t - b.tDraw;
      const hot = heat(age - 0.05);
      const wd = (far ? 0.85 : 1.05) * (1 + 0.8 * Math.exp(-age / 0.06));
      this.boxEdges(b.x0, b.x1, b.y0, b.y1, 0, hh, wd, 1 - hot, hot, 1);
      // the towers' rooftop sign frames and the slab's sign borders
      if (b.kind === 1) this.signFrame(b, t, hh);
    }
    // the slab's painted sign borders
    this.slabFrames(t);
    // ground: streets, river, limit. Revealed by the plan front (inner) or the dusk front (outer).
    const rP = this.planR(t), rD = t > T.d0 ? this.duskR(t) : 0;
    for (const g of w.ground) {
      let ta: number;
      if (g.cls <= 1 && g.r < 24) {
        if (g.r > rP) continue;
        ta = T.build + 0.1 + (g.r / 24) * (T.city + 0.3 - T.build);
      } else {
        if (g.r > rD) continue;
        ta = T.d0 + 0.1;
      }
      // keep the painted words' lane clean
      if (g.cls === 1 && Math.abs(g.a[1] + 2 * PL) < 0.2 && Math.abs(g.a[0]) < 13) continue;
      const wd = g.cls === 0 ? 0.8 : g.cls === 2 ? 1.1 : 0.6;
      const al = g.cls === 1 ? 0.55 : g.cls === 3 ? 0.5 : g.cls === 4 ? 0.7 : 0.8;
      const h = heat(t - Math.max(ta, 0) - (g.cls >= 2 ? (g.r / RCITY) * 0.2 : 0));
      this.seg(g.a, g.b, wd, 1 - h * 0.6, 0, h * 0.6, al);
    }
    // north arrow and section marks (drawn by the pen on "city,")
    this.drawNorth(t);
    void night;
  }

  callouts() {
    const b0 = this.bricks[0]!;
    const byC = this.bricks.find((b) => b.course === 1)!;
    return [
      { t: wStart(17), a: v3(b0.x0 + 0.2, -0.01, 0.3), knee: v3(-4.7, -0.01, 1.1), end: v3(-6.6, -0.01, 1.1), label: '1 BRICK = 1 TOKEN', sub: 'NOMINAL 1.00 × 0.62 × 0.78' },
      { t: wStart(19), a: v3(byC.x0 + 0.1, -0.01, BRICK.H * 1.5), knee: v3(-4.7, -0.01, 2.5), end: v3(-6.6, -0.01, 2.5), label: '‘THE’ IS LOAD-BEARING', sub: 'DO NOT REMOVE' },
      { t: this.courseDone[5]! + 0.05, a: v3(-1.0, -0.01, BRICK.H * 5.6), knee: v3(-4.7, -0.01, 3.9), end: v3(-6.6, -0.01, 3.9), label: 'MORTAR: NONE', sub: 'HELD BY ATTENTION' },
    ];
  }

  signFrame(b: Bldg, t: number, hh: number) {
    const s = this.towerSigns[b.tower]!;
    const t0 = b.tDraw + 0.55;
    if (t < t0) return;
    const k = ease.outCubic(prog(t, t0, t0 + 0.25));
    const hgt = s.rows.length * s.cap * 1.45 + s.cap * 0.5;
    const zb = hh + 0.55, zt = zb + hgt * k;
    const x0 = s.c[0] - s.w / 2, x1 = s.c[0] + s.w / 2, y = s.c[1];
    const S = (a: V3, c: V3, w = 1) => this.seg(a, c, w, 1, 0, 0, 0.9);
    // posts from the roof, the board, a catwalk
    for (const x of [x0 + 0.3, s.c[0], x1 - 0.3]) S([x, y + 0.25, hh], [x, y + 0.25, zb], 0.9);
    S([x0, y, zb], [x1, y, zb]); S([x0, y, zt], [x1, y, zt]); S([x0, y, zb], [x0, y, zt]); S([x1, y, zb], [x1, y, zt]);
    S([x0, y - 0.35, zb - 0.05], [x1, y - 0.35, zb - 0.05], 0.7);
  }

  slabFrames(t: number) {
    const b = this.world.bl[this.world.slab]!;
    const age = t - b.tDraw - 0.4;
    if (age < 0) return;
    for (const s of this.heroSigns) {
      const wd = (measure(s.txt, F.archivo(100, 900), 100) / 100) * (s.cap / this.capK) + s.cap * 0.9;
      const hg = s.cap * 1.7;
      const x0 = s.c[0] - wd / 2, x1 = s.c[0] + wd / 2, z0 = s.c[2] - hg / 2, z1 = s.c[2] + hg / 2, y = s.c[1];
      const al = 0.55 * prog(age, 0, 0.2);
      for (const [a, c] of [[[x0, y, z0], [x1, y, z0]], [[x1, y, z0], [x1, y, z1]], [[x1, y, z1], [x0, y, z1]], [[x0, y, z1], [x0, y, z0]]] as [V3, V3][]) this.seg(a, c, 0.8, 1, 0, 0, al);
    }
  }

  northAt(): V3 { return [-11.5, -12.5, 0]; }
  drawNorth(t: number) {
    const T = this.T;
    const t0 = T.city - 0.02;
    if (t < t0) return;
    const al = 1 - prog(t, T.d0 + 0.5, T.d0 + 1.2);
    if (al <= 0) return;
    const o = this.northAt(), R = 1.5;
    const n = 36;
    const u = prog(t, t0, t0 + 0.24);
    for (let k = 0; k < n; k++) {
      const s = k / n;
      if (s > u) break;
      const a0 = s * TAU, a1 = (k + 1) / n * TAU;
      const ta = t0 + s * 0.24;
      const h = heat(t - ta);
      this.seg([o[0] + Math.cos(a0) * R, o[1] + Math.sin(a0) * R, 0], [o[0] + Math.cos(a1) * R, o[1] + Math.sin(a1) * R, 0], 1, 1 - h, 0, h, al);
    }
    const ta = t0 + 0.24;
    if (t > ta) {
      const k = ease.outExpo(prog(t, ta, ta + 0.15)), h = heat(t - ta);
      const tip: V3 = [o[0], o[1] + R * 1.35 * k, 0], l: V3 = [o[0] - 0.45, o[1] - R * 0.7, 0], r: V3 = [o[0] + 0.45, o[1] - R * 0.7, 0], c0: V3 = [o[0], o[1] - R * 0.35, 0];
      for (const [a, b] of [[l, tip], [tip, r], [r, c0], [c0, l]] as [V3, V3][]) this.seg(a, b, 1.3, 1 - h, 0, h, al);
    }
    // section line A–A through the stack: long-short dashes, arrows looking north
    const ts = T.city + 0.12;
    if (t > ts) {
      const y = BRICK.D / 2, xA = -10, xB = 10;
      const u2 = prog(t, ts, ts + 0.3);
      let x = xA;
      let i = 0;
      while (x < xB) {
        const len = i % 2 ? 0.25 : 1.2;
        const x1 = Math.min(xB, x + len);
        const s = (x - xA) / (xB - xA);
        if (s > u2) break;
        const h = heat(t - (ts + s * 0.3));
        this.seg([x, y, 0.02], [x1, y, 0.02], 1.2, 1 - h, 0, h, al);
        x = x1 + 0.3; i++;
      }
      for (const xe of [xA, xB]) {
        const k = prog(t, ts + 0.25, ts + 0.35);
        if (k <= 0) continue;
        this.seg([xe, y, 0.02], [xe, y + 1.1 * k, 0.02], 1.4, 1, 0, 0, al);
        this.seg([xe - 0.3, y + 0.75 * k, 0.02], [xe, y + 1.1 * k, 0.02], 1.4, 1, 0, 0, al);
        this.seg([xe + 0.3, y + 0.75 * k, 0.02], [xe, y + 1.1 * k, 0.02], 1.4, 1, 0, 0, al);
      }
    }
  }

  // ======================================================================= type (Canvas2D, channel-coded)
  /** set a canvas transform so that (u, v) in world units map onto a plane: +u along ex, canvas-down along ey */
  private planeXf(c: Ctx2, m: Xf, o: V3, ex: V3, ey: V3, k = 1) {
    const p = apply(m, o), a = applyV(m, ex), b = applyV(m, ey);
    c.setTransform(a.x * k, a.y * k, b.x * k, b.y * k, p.x, p.y);
  }
  /** Archivo 900 set on a plane, cap height `cap` world units, centred on o */
  private planeWord(c: Ctx2, m: Xf, txt: string, o: V3, ex: V3, ey: V3, cap: number, fill: string, fam = F.archivo(100, 900), sx = 1) {
    const k = cap / (this.capK * 100);
    this.planeXf(c, m, o, ex, ey, k);
    c.font = font(fam, 100);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillStyle = fill;
    if (sx !== 1) c.scale(sx, 1);
    c.fillText(txt, 0, this.capK * 50);
  }

  drawType(c: Ctx2, t: number, cam: Cam, m: Xf, night: number) {
    const T = this.T;
    const FRONT: V3 = [1, 0, 0], DOWN: V3 = [0, 0, -1], TOWARD: V3 = [0, -1, 0];
    // --- letters on the bricks
    for (const b of this.bricks) {
      if (t < b.t - 0.2) continue;
      const z = this.brickZ(b, t);
      const h = heat(t - b.t);
      const fall = t < b.t ? 0.3 : 1;
      const o: V3 = [b.x0 + BRICK.L / 2, -0.003, z + BRICK.H / 2];
      this.planeWord(c, m, b.ch, o, FRONT, DOWN, BRICK.H * 0.56, C3(0, (1 - h) * fall, h * fall));
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    const mono = (s: string, x: number, y: number, px: number, col: string, align: CanvasTextAlign = 'left', wt = 500, sp = 1) => {
      c.font = font(F.mono(wt), px); c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillStyle = col;
      c.letterSpacing = `${sp}px`; c.fillText(s, x, y); c.letterSpacing = '0px';
    };
    // --- ground line labels (movement 1)
    {
      const al = 1 - prog(t, T.build + 0.2, T.click[0]!);
      if (al > 0 && t > T.t0 + 0.12) {
        const hd: V3 = [Math.cos(cam.psi), -Math.sin(cam.psi), 0];
        const s0 = (GROUND_H3.sparkX - 820) / 128;
        for (let k = -12; k <= 8; k++) {
          const ta = T.t0 + 0.04 + Math.abs(k - s0) / 14;
          if (t < ta + 0.04) continue;
          const p = apply(m, [hd[0] * k, hd[1] * k, 0]);
          const h = heat(t - ta);
          mono(`${k >= 0 ? '' : '−'}${Math.abs(k)}`, p.x, p.y + 22, 11, C3(0, (1 - h) * al * 0.8, h * al), 'center', 500);
        }
        const d = apply(m, [hd[0] * 6.5, hd[1] * 6.5, 0]);
        if (t > T.t0 + 0.32) {
          mono('G.L. ±0.000', d.x + 18, d.y - 12, 13, C3(0, al, 0), 'left', 600, 2);
          mono('DATUM · ONE LINE', d.x + 18, d.y - 34, 10, C3(0, al * 0.7, 0), 'left', 400, 2);
        }
      }
    }
    // --- stack annotations (dimension labels, callouts)
    if (t < T.build + 0.35) {
      const al = 1 - prog(t, T.build, T.build + 0.3);
      let total = 0;
      for (let ci = 0; ci < this.courseDone.length; ci++) {
        const tc = this.courseDone[ci]!;
        if (t < tc) continue;
        total += this.courseWords[ci]!.length;
        const p = apply(m, [4.35, 0, (ci + 0.5) * BRICK.H]);
        const h = heat(t - tc);
        mono(`C${ci + 1}`, p.x + 16, p.y - 2, 12, C3(0, (1 - h) * al, h * al), 'left', 600, 1);
        mono(`${this.courseWords[ci]!.length} TOK · 0.78`, p.x + 46, p.y - 2, 11, C3(0, al * 0.72, 0), 'left', 400, 1);
      }
      if (total > 0) {
        const p = apply(m, [4.35, 0, this.courseDone.filter((x) => x <= t).length * BRICK.H]);
        mono(`Σ ${String(total).padStart(2, '0')} TOKENS`, p.x + 16, p.y - 16, 13, C3(0, al, 0), 'left', 600, 2);
      }
      for (const co of this.callouts()) {
        if (t < co.t + 0.12) continue;
        const e = apply(m, co.knee);
        const h = heat(t - co.t - 0.12);
        const k = prog(t, co.t + 0.12, co.t + 0.2);
        mono(co.label, e.x - 6, e.y - 9, 14, C3(0, (1 - h) * al * k, h * al * k), 'right', 600, 1.5);
        mono(co.sub, e.x - 6, e.y + 17, 11, C3(0, al * k * 0.7, 0), 'right', 400, 1.5);
      }
      // schedule of bricks: one row per letter, counted as they land
      {
        const rows: { ch: string; n: number; t: number }[] = [];
        for (const b of this.bricks) {
          if (t < b.t) continue;
          const r = rows.find((x) => x.ch === b.ch);
          if (r) { r.n++; r.t = b.t; } else rows.push({ ch: b.ch, n: 1, t: b.t });
        }
        if (rows.length) {
          const x0 = 1590, y0 = 170;
          mono('SCHEDULE OF BRICKS', x0, y0, 12, C3(0, al, 0), 'left', 600, 2);
          c.fillStyle = C3(al * 0.8, 0, 0); c.fillRect(x0, y0 + 8, 232, 1);
          mono('MK   QTY  SPEC', x0, y0 + 26, 10, C3(0, al * 0.6, 0), 'left', 500, 1);
          rows.forEach((r, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            const x = x0 + col * 120, y = y0 + 48 + row * 20;
            const h = heat(t - r.t);
            mono(r.ch, x, y, 13, C3(0, (1 - h) * al, h * al), 'left', 700, 1);
            mono(`×${String(r.n).padStart(2, '0')}  A900`, x + 22, y, 10, C3(0, al * 0.75, 0), 'left', 400, 1);
          });
          const yb = y0 + 48 + Math.ceil(rows.length / 2) * 20;
          c.fillStyle = C3(al * 0.8, 0, 0); c.fillRect(x0, yb - 8, 232, 1);
          mono('WASTE 0 · SPARES 0 · TYPOS 0', x0, yb + 8, 10, C3(0, al * 0.6, 0), 'left', 400, 1);
        }
      }
      // the plumb bob's tag
      const tp = this.bricks[0]!.t + 0.25;
      if (t > tp) {
        const p = apply(m, [-4.45, 0.31, 0.1]);
        mono('PLUMB · TRUE', p.x - 12, p.y + 20, 10, C3(0, al * 0.75 * prog(t, tp, tp + 0.1), 0), 'center', 500, 2);
      }
    }
    // --- BUILD A CITY, painted along the avenue in front of the plaza
    this.drawAvenue(c, t, m);
    // --- north arrow N, section bubbles
    if (t > T.city + 0.2 && t < T.d0 + 1.2) {
      const al = 1 - prog(t, T.d0 + 0.5, T.d0 + 1.2);
      const o = this.northAt();
      this.planeWord(c, m, 'N', [o[0], o[1] + 2.6, 0], FRONT, TOWARD, 0.9, C3(0, al, 0));
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (t > T.city + 0.45) for (const xe of [-10, 10]) {
        const p = apply(m, [xe, BRICK.D / 2 + 1.6, 0]);
        c.strokeStyle = C3(0, al, 0); c.lineWidth = 1.2;
        c.beginPath(); c.arc(p.x, p.y, 13, 0, TAU); c.stroke();
        mono('A', p.x, p.y + 5, 14, C3(0, al, 0), 'center', 600);
      }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    // --- the clicks: cursor, CLICK tags, stamps
    this.drawClicks(c, t, m, cam);
    // --- caused density at dusk: the pen tags what it has just drawn
    this.drawDuskTags(c, t, m, cam);
    // --- signs
    this.drawSigns(c, t, m);
    c.setTransform(1, 0, 0, 1, 0, 0);
    // --- title block
    this.drawTitle(c, t, night);
    if (PERF_PROBE && this.perfN > 0 && t < 0) mono(`PERF ${(this.perfMs / this.perfN).toFixed(1)} ms / ${this.perfN}`, 40, 60, 28, C3(0, 1, 0), 'left', 600, 1);
  }

  drawAvenue(c: Ctx2, t: number, m: Xf) {
    const T = this.T;
    if (t < T.build - 0.02) return;
    const al = 1 - prog(t, T.d0 + 0.3, T.d0 + 1.0);
    if (al <= 0) return;
    const y = -2 * PL, cap = 1.3;
    const words = [{ s: 'BUILD', w: 21 }, { s: 'A', w: 22 }, { s: 'CITY,', w: 23 }];
    const fam = F.archivo(112.5, 900);
    const k = cap / (this.capK * 100);
    const widths = words.map((x) => measure(x.s, fam, 100) * k);
    const gap = cap * 0.55;
    const tot = widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
    let x = -tot / 2 - 1.2;
    words.forEach((wd, i) => {
      const t0 = wStart(wd.w);
      const cx = x + widths[i]! / 2;
      x += widths[i]! + gap;
      if (t < t0) return;
      const h = heat(t - t0);
      const slam = 1 + 0.22 * Math.exp(-(t - t0) / 0.05);
      // lettered on the road: baseline along +X, letters stand toward +Y (away from the viewer)
      this.planeWord(c, m, wd.s, [cx, y - 0.05, 0], [slam, 0, 0], [0, -slam, 0], cap, C3(0, (1 - h) * al, h * al), fam);
    });
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  cursorAt(t: number): { x: number; y: number; press: number; on: number } | null {
    const T = this.T;
    const t0 = T.click[0]! - 0.3;
    if (t < t0 || t > T.d0 + 0.05) return null;
    const cam = this.camAt(t), m = camXf(cam);
    const tgt = (k: number): V3 => { const b = this.world.bl[this.world.towers[k]!]!; return [b.cx - 0.3, b.cy - 0.3, this.bHeight(b, t) + 0.05]; };
    let p = apply(m, tgt(0));
    const start = apply(m, [4.35, 0, this.courseDone.length * BRICK.H]);
    p = { x: lerp(start.x, p.x, ease.outExpo(prog(t, t0, t0 + 0.2))), y: lerp(start.y, p.y, ease.outExpo(prog(t, t0, t0 + 0.2))) };
    for (let k = 1; k < 3; k++) {
      const ta = T.click[k]! - 0.16;
      const q = apply(m, tgt(k));
      const u = ease.outExpo(prog(t, ta, ta + 0.12));
      p = { x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u) };
    }
    let press = 0;
    for (const tc of T.click) press = Math.max(press, prog(t, tc - 0.02, tc) * (1 - prog(t, tc + 0.05, tc + 0.1)));
    const on = prog(t, t0, t0 + 0.06) * (1 - prog(t, T.d0 - 0.1, T.d0 + 0.05));
    return { x: p.x, y: p.y, press, on };
  }

  drawClicks(c: Ctx2, t: number, m: Xf, cam: Cam) {
    const T = this.T;
    // stamps
    for (const s of this.stamps) {
      if (t < s.t) continue;
      const al = 1 - prog(t, T.d0 + 1.0, T.dk1 - 0.4);
      if (al <= 0) continue;
      const p = apply(m, s.at);
      const k = prog(t, s.t, s.t + 0.05, ease.outQuad);
      const sc = (cam.z / 58) * lerp(1.12, 1, k);
      c.save();
      c.translate(p.x, p.y); c.rotate(s.rot + cam.roll); c.scale(sc, sc);
      const hw = 150, hh = 50;
      c.strokeStyle = C3(0, 0, al * 0.78); c.lineWidth = 7; c.strokeRect(-hw, -hh, hw * 2, hh * 2);
      c.lineWidth = 2.2; c.strokeRect(-hw + 11, -hh + 11, hw * 2 - 22, hh * 2 - 22);
      c.fillStyle = C3(0, 0, al * 0.78); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      const fam = F.archivo(87.5, 900);
      const size = Math.min(56, (100 * (hw * 2 - 44)) / measure('APPROVED', fam, 100));
      c.font = font(fam, size); c.fillText('APPROVED', 0, size * 0.36 + 2);
      c.font = font(F.mono(700), 10); c.letterSpacing = '4px';
      c.fillText(`PERMIT Nº 000${s.n} · REVIEW 0.00 s`, 0, -hh + 26);
      c.fillText('DEPT. OF ONE PROMPT', 0, hh - 17);
      c.letterSpacing = '0px';
      c.restore();
    }
    // CLICK tags on the towers
    this.world.towers.forEach((bi, k) => {
      const tc = T.click[k]!;
      if (t < tc) return;
      const al = 1 - prog(t, T.d0 + 0.2, T.d0 + 0.8);
      if (al <= 0) return;
      const b = this.world.bl[bi]!;
      const hh = this.bHeight(b, t);
      const a = apply(m, [b.x1, b.y0, hh * 0.93]);
      const kx = ease.outExpo(prog(t, tc, tc + 0.14));
      const ex = a.x + 70 * kx, ey = a.y - 36 * kx;
      c.strokeStyle = C3(0.9 * al, 0, 0); c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(ex, ey); c.lineTo(ex + 22 * kx, ey); c.stroke();
      const h = heat(t - tc);
      // the held third click stretches (Archivo width 100 -> 125; a spring hides the steps)
      const held = k === 2 ? ease.outCubic(prog(t, tc + 0.05, T.clickE)) : 0;
      const wAx = lerp(100, 125, held);
      const fam = F.archivo(wAx, 900);
      const base = measure('CLICK', F.archivo(100, 900), 44);
      const want = base * lerp(1, 1.3, held) * (1 + 0.05 * Math.sin(TAU * 3 * (t - tc)) * Math.exp(-(t - tc) * 4));
      const got = measure('CLICK', fam, 44);
      const slam = 1 + 0.25 * Math.exp(-(t - tc) / 0.05);
      c.save();
      c.translate(ex + 28, ey + 15);
      c.scale((want / got) * slam, slam);
      c.font = font(fam, 44); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.fillStyle = C3(0, (1 - h) * al, h * al);
      c.fillText('CLICK', 0, 0);
      c.restore();
      c.font = font(F.mono(500), 11); c.letterSpacing = '1.5px'; c.textAlign = 'left';
      c.fillStyle = C3(0, 0.72 * al * prog(t, tc + 0.1, tc + 0.2), 0);
      c.fillText(`LOT ${TOWERS[k]!.i}·${TOWERS[k]!.j} · +${Math.round(hh / 0.9)} FL · 1 CLICK`, ex + 30, ey + 34);
      c.letterSpacing = '0px';
    });
    // the cursor (the caret, as a pointer), orange
    const cu = this.cursorAt(t);
    if (cu && cu.on > 0) {
      c.save();
      c.translate(cu.x, cu.y);
      const s = 1.9 * (1 - 0.14 * cu.press);
      c.scale(s, s);
      c.beginPath();
      c.moveTo(0, 0); c.lineTo(0, 18); c.lineTo(4.4, 13.9); c.lineTo(7.6, 21); c.lineTo(10.4, 19.8); c.lineTo(7.3, 12.9); c.lineTo(13, 12.9); c.closePath();
      c.fillStyle = C3(0, 0, cu.on * 0.78); c.fill();
      c.restore();
      // click ripples
      for (const tc of T.click) {
        const e = t - tc;
        if (e < 0 || e > 0.35) continue;
        const r = 10 + 70 * ease.outCubic(e / 0.35);
        c.strokeStyle = C3(0, 0, (1 - e / 0.35) * cu.on * 0.78); c.lineWidth = 2;
        c.beginPath(); c.ellipse(cu.x, cu.y, r, r * 0.55, 0, 0, TAU); c.stroke();
      }
    }
  }

  drawDuskTags(c: Ctx2, t: number, m: Xf, cam: Cam) {
    const T = this.T;
    if (t < T.d0 || t > T.night + 0.3) return;
    const w = this.world;
    let n = 0;
    c.font = font(F.mono(500), 10); c.textAlign = 'left'; c.letterSpacing = '1px';
    for (let i = 0; i < w.bl.length && n < 60; i++) {
      const b = w.bl[i]!;
      if (b.kind !== 0 || i % 5 !== 0) continue;
      const age = t - b.tDraw;
      if (age < 0.05 || age > 0.6) continue;
      const p = apply(m, [b.x1, b.y0, b.h]);
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) continue;
      const al = prog(age, 0.05, 0.1) * (1 - prog(age, 0.4, 0.6));
      const h = heat(age - 0.05);
      c.strokeStyle = C3((1 - h) * al * 0.8, 0, h * al); c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 14, p.y - 12); c.lineTo(p.x + 20, p.y - 12); c.stroke();
      c.fillStyle = C3(0, (1 - h) * al * 0.85, h * al);
      c.fillText(`B-${String(i).padStart(3, '0')} · ${Math.round(b.h / 0.9)} FL`, p.x + 23, p.y - 9);
      n++;
    }
    c.letterSpacing = '0px';
    void cam;
  }

  drawSigns(c: Ctx2, t: number, m: Xf) {
    const T = this.T;
    const FRONT: V3 = [1, 0, 0], DOWN: V3 = [0, 0, -1];
    const lit = (word: number) => {
      const t0 = wStart(word);
      if (t < t0 - 0.4) return null;
      if (t < t0) return C3(0, 0.3 * prog(t, t0 - 0.4, t0 - 0.2), 0);
      const h = heat(t - t0);
      return C3(0, 1 - h, h);
    };
    // rooftop billboards
    for (const s of this.towerSigns) {
      const b = this.world.bl[this.world.towers[s.tower]!]!;
      if (t < b.tDraw + 0.8 || t < T.night - 0.5) continue;
      s.rows.forEach((r, i) => {
        const col = lit(r.word);
        if (!col) return;
        const n = s.rows.length;
        const z = s.c[2] + ((n - 1) / 2 - i) * s.cap * 1.45;
        const t0 = wStart(r.word);
        const slam = t >= t0 ? 1 + 0.18 * Math.exp(-(t - t0) / 0.05) : 1;
        this.planeWord(c, m, r.txt, [s.c[0], s.c[1] - 0.02, z], [slam, 0, 0], [0, 0, -slam], s.cap, col);
      });
    }
    // ghost signs on the slab
    for (const s of this.heroSigns) {
      const col = lit(s.word);
      if (!col) continue;
      const t0 = wStart(s.word);
      const slam = t >= t0 ? 1 + 0.14 * Math.exp(-(t - t0) / 0.05) : 1;
      this.planeWord(c, m, s.txt, s.c, [slam, 0, 0], [0, 0, -slam], s.cap, col);
    }
    void FRONT; void DOWN;
  }

  drawTitle(c: Ctx2, t: number, night: number) {
    const T = this.T;
    const t0 = T.city + 0.05;
    if (t < t0) return;
    const al = 1 - prog(t, T.by, T.by + 0.3);
    if (al <= 0) return;
    const x0 = 1318, y0 = 902, w = 506, h = 118;
    const u = ease.outExpo(prog(t, t0, t0 + 0.35));
    c.setTransform(1, 0, 0, 1, 0, 0);
    // ruled by a wipe with a hot front
    const R = (xa: number, ya: number, xb: number, yb: number, ta: number) => {
      if (t < ta) return;
      const k = ease.outExpo(prog(t, ta, ta + 0.25)), hh = heat(t - ta);
      c.strokeStyle = C3((1 - hh) * al, 0, hh * al); c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(xa, ya); c.lineTo(lerp(xa, xb, k), lerp(ya, yb, k)); c.stroke();
    };
    R(x0, y0, x0 + w, y0, t0); R(x0, y0 + h, x0 + w, y0 + h, t0 + 0.04); R(x0, y0, x0, y0 + h, t0 + 0.02); R(x0 + w, y0, x0 + w, y0 + h, t0 + 0.06);
    R(x0, y0 + 44, x0 + w, y0 + 44, t0 + 0.08); R(x0, y0 + 80, x0 + w, y0 + 80, t0 + 0.1); R(x0 + 330, y0 + 44, x0 + 330, y0 + h, t0 + 0.12);
    if (u < 0.3) return;
    const ty = (s: string, x: number, y: number, px: number, wt: number, a = 1, sp = 2) => {
      c.font = font(F.mono(wt), px); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.letterSpacing = `${sp}px`;
      c.fillStyle = C3(0, a * al, 0); c.fillText(s, x, y); c.letterSpacing = '0px';
    };
    c.font = font(F.archivo(125, 900), 30); c.textAlign = 'left'; c.fillStyle = C3(0, al, 0); c.fillText('DWG 03 · CITY', x0 + 14, y0 + 34);
    ty('SHEET 3 OF ∞', x0 + 350, y0 + 30, 12, 500, 0.8);
    ty('SCALE 1 : 1 PROMPT', x0 + 14, y0 + 68, 14, 600);
    ty('DRAWN  CARET', x0 + 344, y0 + 68, 11, 500, 0.8);
    ty(t < T.lights ? 'CHKD   —' : `FRAMES ${String(frames(t)).padStart(4, '0')}`, x0 + 344, y0 + 104, 11, 500, 0.8);
    const lit = this.litCount(t);
    if (t < T.lights) ty(`FRAMES ${String(frames(t)).padStart(4, '0')}`, x0 + 14, y0 + 106, 16, 600, 1, 3);
    else {
      const hot = lit > 0 ? heat(t - (this.litSorted[lit - 1] ?? t)) : 0;
      c.font = font(F.mono(600), 16); c.letterSpacing = '3px'; c.fillStyle = C3(0, al * (1 - hot * 0.7), al * hot * 0.7);
      c.fillText(`LIT ${String(lit).padStart(4, '0')} / ${this.nLit}`, x0 + 14, y0 + 106); c.letterSpacing = '0px';

    }
    void night;
  }

  // ======================================================================= stamps (paper shader voids)
  setStamps(t: number, m: Xf, cam: Cam) {
    const st = this.paper.u.st!.value as THREE.Vector4[], sb = this.paper.u.sb!.value as THREE.Vector4[];
    this.stamps.forEach((s, i) => {
      if (t < s.t) { sb[i]!.set(0, 0, 0, 0); return; }
      const p = apply(m, s.at);
      const k = prog(t, s.t, s.t + 0.05, ease.outQuad);
      const sc = (cam.z / 58) * lerp(1.12, 1, k);
      st[i]!.set(p.x, p.y, 156 * sc, 56 * sc);
      sb[i]!.set(s.rot + cam.roll, 1 + 0.5 * (1 - k), s.seed, 1);
    });
  }

  // ======================================================================= the spark
  drawSpark(g: LineBatch, t: number) {
    const on = this.penOn(t);
    const headAt = (tt: number) => {
      const p = this.penW(tt);
      if (!p) return null;
      return apply(camXf(this.camAt(tt)), p);
    };
    const hp = headAt(t);
    if (!hp || on <= 0) return;
    // the white-hot wake: the last few hundredths of a second of the pen's path
    const N = 14;
    let prev = hp;
    for (let k = 1; k <= N; k++) {
      const q = headAt(t - k * 0.005);
      if (!q) break;
      const age = k * 0.005;
      const hh = Math.exp(-age / 0.03);
      g.seg2(prev.x, prev.y, q.x, q.y, 2.2 * (0.5 + hh), [LIN.ember[0] * 2.4 * hh * on, LIN.ember[1] * 2.4 * hh * on, LIN.ember[2] * 2.4 * hh * on], 1);
      prev = q;
    }
    const T = this.T;
    const busy = t < T.build ? 1 : t < T.click[0]! ? 1.4 : t < T.d1 ? 1.6 : 0.6;
    sparkParticles(g, t, (tt) => headAt(tt), { rate: 70 * busy, speed: 200, intensity: 0.9 * on, seed: 23, width: 1.5 });
    sparkHead(g, hp.x, hp.y, t, 1.05, 1.1 * on);
  }
}
