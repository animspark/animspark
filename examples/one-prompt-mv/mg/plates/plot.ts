// Plate `plot` — "Lights, camera, action!" and the held breath (CUT.plot → CUT.hook).
// One continuous take through two departments, one engraved object and one slate:
//   pre-roll  the city's last lit window (H4) is the slot between the closed barn doors of a 2K Fresnel.
//   LIGHTS,   the lamp strikes: the lens blazes, the four doors swing open on their springs, a shockwave
//             draws the lighting plot around it (pipe, yoke, beam spread, focus, title block); the word is
//             the instrument schedule's label, lit inside the beam.
//   camera,   shape carry-over: the lamp's can rings out into a lens barrel (the same six coaxial rings),
//             the object turns to a three-quarter view, the iris opens, the focus ring pulls to ∞ and the
//             T-stop ring to T2; the word is engraved on the front ring; a camera sheet fills in.
//   action!   the slate slams in; the clapstick claps on the word (hinge spring, punch frames, shake,
//             shockwave, heat in the sticks); the caret is born from the clap and chalks ACTION!, then the
//             slate's header; the LED timecode runs the in-world FRAMES counter.
//   breath    room tone: a beam of dust across the slate, a slow push; on the sub drop the beam spots down
//             onto the caret, the world goes dark, and the caret becomes the prompt's cursor (H5), blinking.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, SS_TAP } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, measure, fitSize } from '../px/type';
import { strokeText } from '../px/stroke';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep, springStep, TAU, frameIdx, type V2 } from '../px/util';
import { sparkHead, sparkParticles } from '../px/motifs';
import { wStart, wEnd, charTimes } from './lyric';
import { CUT, WINDOW_H4, CARET_H5, frames } from './handoff';
import { MAIN_FRAG, SLATE_FRAG } from './plot-glsl';
import {
  type Cam, type Aff, type Item, type Chalk, type RGB, type Obj, zlerp, camAff, apply, mul, inv, trs, rotM, objToView, discAff, mat3,
  mkItem, drawItem, drawChalk, penAt, drawLED, makeSkin, focusAng, tAng, T_STOPS,
} from './plot-kit';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const V4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);

// ---- the six coaxial rings: R, Ri, z0, z1 (object px; the front at z = 0)
const LAMP_RINGS: number[][] = [[300, 0, -900, -760], [300, 0, -760, -620], [300, 0, -620, -480], [300, 0, -480, -300], [300, 0, -300, -40], [318, 214, -40, 0]];
const LENS_RINGS: number[][] = [[160, 0, -820, -700], [230, 0, -700, -590], [214, 0, -590, -520], [262, 0, -520, -330], [236, 0, -330, -150], [300, 182, -150, 0]];
const GLASS_LAMP = { R: 214, z: -24 }, GLASS_LENS = { R: 182, z: -70 }, IRIS_Z = -190;

// ---- barn doors: hinge centre, closed direction (in the lens plane), hinge half-length, tip half-width, length
// closed so the slot between the tips is exactly WINDOW_H4 (60 x 40) in the front view
const HALF_GAP = { x: WINDOW_H4.w / 2, y: WINDOW_H4.h / 2 };
const LEAVES = [
  { h: [0, 300, 6], d0: [0, -1, 0], hw0: 300, hw1: 300, L: 290 },
  { h: [0, -300, 6], d0: [0, 1, 0], hw0: 300, hw1: 300, L: 290 },
  { h: [-300, 0, 3], d0: [1, 0, 0], hw0: 262, hw1: 150, L: 280 },
  { h: [300, 0, 3], d0: [-1, 0, 0], hw0: 262, hw1: 150, L: 280 },
];
const theta0 = (i: number) => Math.acos((300 - (i < 2 ? HALF_GAP.y : HALF_GAP.x)) / LEAVES[i]!.L);
const THETA1 = 2.02; // open: 116° from closed

// ---- slate (local px, origin at the board's centre line; board y -300..400, sticks above)
const SL = { x: 40, y: 38, r: -0.028, s: 0.9 };
const TIP = { x: 560, y: -392 }; // where the sticks meet first

type Col3 = [number, number, number];
const E8: Col3 = [255, 154, 77], S8: Col3 = [255, 90, 31], B8: Col3 = [238, 233, 223];
const mix3 = (a: Col3, b: Col3, u: number): Col3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
/** Fresh type: ember → signal → bone over ~0.35 s. */
function hotCss(age: number, a = 1): string {
  if (age < 0) return rgba('bone', 0.3 * a);
  const c = age < 0.08 ? mix3(E8, S8, age / 0.08) : mix3(S8, B8, smoothstep(0.08, 0.36, age));
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
const setT = (c: CanvasRenderingContext2D, m: Aff) => c.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);

export default class Plot extends Scene {
  main = new FSPass(MAIN_FRAG, {
    uCam: { value: V4(0, 0, 1, 0) }, uObj: { value: V3(0, 0, 1) }, uM: { value: new THREE.Matrix3() },
    uRing: { value: [0, 1, 2, 3, 4, 5].map(() => V4()) }, uMorph: { value: 0 },
    uGlass: { value: V4() }, uGlass2: { value: V4() },
    uLH: { value: [0, 1, 2, 3].map(() => V3()) }, uLE1: { value: [0, 1, 2, 3].map(() => V3()) }, uLE2: { value: [0, 1, 2, 3].map(() => V3()) },
    uLD: { value: [0, 1, 2, 3].map(() => V4()) },
    uAmb: { value: 0 }, uKey: { value: V3(-0.5, 0.62, 0.6).normalize() }, uRim: { value: V3(0.8, 0.5, -0.3).normalize() }, uRimK: { value: 0 },
    uShock: { value: [V4(), V4()] }, uRot2: { value: new THREE.Vector2() }, uSkin: { value: null },
    uDim: { value: 1 }, uObjK: { value: 1 }, uT: { value: 0 }, uGhost: { value: 0 }, ssTap: SS_TAP,
  });
  slate = new FSPass(SLATE_FRAG, {
    uInv: { value: new THREE.Matrix3() }, uStick: { value: 0 }, uOn: { value: 0 }, uHeat: { value: 0 }, uImp: { value: new THREE.Vector2() },
    uShockS: { value: V4() }, uSlDim: { value: 1 }, uLocalPx: { value: 1 }, uBeam: { value: V4() }, uBeamK: { value: 0 }, uBeamEnd: { value: 0 }, uPool: { value: V4() }, uT: { value: 0 },
  }, { blending: THREE.CustomBlending, transparent: true });
  plotLB = new LineBatch(24000, { blend: 'normal' });
  chalkLB = new LineBatch(12000, { blend: 'normal' });
  glowLB = new LineBatch(12000);
  L1 = new Layer2D();
  L2 = new Layer2D();

  T0 = 0; T1 = 0; tL = 0; tC = 0; tA = 0; eA = 0; tSide = 0; tBoom = 0; tH0 = 0; tH1 = 0; tCar0 = 0; tCar1 = 0;
  wordT: number[] = [];
  K!: Record<string, Cam>;
  plotItems: Item[] = [];
  camItems: Item[] = [];
  chalkA!: Chalk;
  chalkH!: Chalk;
  labelSize = 200;
  axis1 = 0; // beam axis angle on the plot (K1 screen)
  axis2 = 0; // optical axis angle on the camera sheet (K2 screen)
  convItems: Item[] = [];
  motes: { x: number; y: number; ph: number; sp: number; sz: number; k: number }[] = [];

  override init() {
    const au = this.ctx.audio;
    this.T0 = CUT.plot; this.T1 = CUT.hook;
    this.tL = wStart(34); this.tC = wStart(35); this.tA = wStart(36); this.eA = wEnd(36);
    this.wordT = [this.tL, this.tC, this.tA];
    this.tSide = au.events('kick', this.tL + 0.06, this.tL + 0.35)[0]?.[0] ?? this.tL + 0.15;
    // the sub drop of the held breath: the strongest kick between "action!" and the cut
    const ks = au.events('kick', this.eA, this.T1 - 0.4);
    this.tBoom = ks.length ? ks.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : lerp(this.eA, this.T1, 0.5);
    this.main.u.uSkin!.value = makeSkin();
    const m = this.slate.mat;
    m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

    // ---- camera keys (view plane; the object sits at the origin)
    this.K = {
      k0: { x: 0, y: 0, z: 1, r: 0 },
      k0b: { x: 0, y: 0, z: 1.06, r: 0 },
      k1: { x: (960 - 1240) / 0.6, y: (540 - 560) / 0.6, z: 0.6, r: 0.012 },
      k1b: { x: (960 - 1250) / 0.625, y: (540 - 560) / 0.625, z: 0.625, r: 0.004 },
      k1c: { x: -300, y: -20, z: 0.7, r: -0.004 },
      k2: { x: (960 - 720) / 1.1, y: (540 - 610) / 1.1, z: 1.1, r: 0.012 },
      k2b: { x: (960 - 712) / 1.15, y: (540 - 612) / 1.15, z: 1.15, r: 0.016 },
      k3p: { x: 120, y: -30, z: 0.86, r: 0 },
      k3: { x: 0, y: 0, z: 1, r: 0 },
      k3b: { x: 0, y: 0, z: 1.075, r: 0.004 },
    };

    const M1 = rotM(-0.47, -0.25), M2 = rotM(-0.6, 0.34);
    this.axis1 = Math.atan2(-M1[5]!, M1[2]!);
    this.axis2 = Math.atan2(-M2[5]!, M2[2]!);
    this.labelSize = fitSize('LIGHTS,', F.archivo(112.5, 900), 850, 260);
    this.buildPlot();
    this.buildCamSheet();

    // ---- chalk: ACTION! written with the word, then the slate's header
    const cA = charTimes(36);
    const dA = Math.min(0.5, Math.max(0.12, this.eA - this.tA)) / cA.length;
    const stA0 = strokeText('ACTION!', 'sans', 100);
    const sizeA = Math.min(300, (1020 / stA0.width) * 100);
    const stA = strokeText('ACTION!', 'sans', sizeA);
    this.chalkA = { st: stA, ox: -stA.width / 2, oy: 45 + (0.662 * sizeA) / 2, ct: cA.map((s, i) => [s, (cA[i + 1] ?? s + dA)] as [number, number]), w: 10 };
    const hdr = 'ONE PROMPT · SC 1 · TAKE 1';
    const stH0 = strokeText(hdr, 'sans', 100);
    const sizeH = Math.min(70, (1040 / stH0.width) * 100);
    const stH = strokeText(hdr, 'sans', sizeH);
    this.tH0 = this.tA + 0.64; this.tH1 = Math.min(this.tBoom - 0.45, this.tH0 + 0.85);
    const n = hdr.length;
    const ctH: [number, number][] = [...hdr].map((_, i) => [lerp(this.tH0, this.tH1, i / n), lerp(this.tH0, this.tH1, (i + 1) / n)]);
    this.chalkH = { st: stH, ox: -548, oy: -206, ct: ctH, w: 5.5 };
    this.tCar0 = this.tH1 + 0.12; this.tCar1 = this.tBoom + 0.22;

    // ---- the focus lines that converge on the caret when the lights go down
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * TAU + 0.5 * hash(i, 41), r0 = 700 + 500 * hash(i, 42);
      const p0 = { x: CARET_H5.x + Math.cos(a) * r0, y: CARET_H5.y + Math.sin(a) * r0 };
      const p1 = { x: CARET_H5.x + Math.cos(a) * 46, y: CARET_H5.y + Math.sin(a) * 46 };
      this.convItems.push(mkItem([p0, p1], this.tBoom - 0.06 + 0.14 * hash(i, 43), i % 6 === 0 ? 1.3 : 1, i % 6 === 0 ? 0.42 : 0.2, i % 4 === 1 ? 10 : 0, 2600));
    }
    // ---- dust motes (screen space; they only show inside the beam)
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 420; i++) this.motes.push({ x: rnd() * 2100 - 90, y: rnd() * 1200 - 60, ph: rnd() * TAU, sp: 0.4 + rnd(), sz: 0.8 + rnd() * rnd() * 3.2, k: rnd() });
  }

  // ------------------------------------------------------------------ static drawings
  /** The lighting plot, laid out in LIGHTS's key-frame screen space (lamp at 1240, 560). Births: the shockwave. */
  buildPlot() {
    const L = { x: 1240, y: 560 }, tL = this.tL;
    const born = (x: number, y: number) => tL + Math.hypot(x - L.x, y - L.y) / 1500;
    const P = this.plotItems;
    const add = (pts: V2[], w = 1, a = 0.5, dash = 0, t0?: number) => P.push(mkItem(pts, t0 ?? born(pts[0]!.x, pts[0]!.y), w, a, dash));
    // dot grid (crosses), not over the lamp or its can
    for (let gx = -60; gx <= 1980; gx += 60) for (let gy = -60; gy <= 1140; gy += 60) {
      const dx = gx - L.x, dy = gy - L.y;
      if (Math.hypot(dx, dy) < 340 || (dx > 0 && dx < 520 && Math.abs(dy - dx * 0.45) < 300)) continue;
      const t0 = born(gx, gy);
      add([{ x: gx - 4, y: gy }, { x: gx + 4, y: gy }], 1, 0.16, 0, t0);
      add([{ x: gx, y: gy - 4 }, { x: gx, y: gy + 4 }], 1, 0.16, 0, t0);
    }
    // the pipe (1st electric), drawn outward from the clamp, with its scale
    for (const y of [150, 159]) { add([{ x: L.x, y }, { x: -40, y }], 1.3, 0.62); add([{ x: L.x, y }, { x: 1960, y }], 1.3, 0.62); }
    for (let x = 0; x <= 1920; x += 30) {
      const major = x % 150 === 0;
      add([{ x, y: 162 }, { x, y: major ? 176 : 168 }], 1, major ? 0.5 : 0.3);
    }
    for (const x of [240, 740, 1740]) add([{ x: x - 8, y: 140 }, { x, y: 130 }, { x: x + 8, y: 140 }], 1, 0.45);
    // beam spread (field ±19°, beam ±10.5° dashed), the arc with degree ticks, the focus point
    const ax = this.axis1;
    const ray = (a: number, r0: number, r1: number): V2[] => [{ x: L.x + Math.cos(a) * r0, y: L.y + Math.sin(a) * r0 }, { x: L.x + Math.cos(a) * r1, y: L.y + Math.sin(a) * r1 }];
    const fld = (19 * Math.PI) / 180, bm = (10.5 * Math.PI) / 180;
    add(ray(ax - fld, 240, 1500), 1.2, 0.55, 0, tL + 0.06);
    add(ray(ax + fld, 240, 1500), 1.2, 0.55, 0, tL + 0.06);
    add(ray(ax - bm, 240, 1300), 1, 0.4, 12, tL + 0.09);
    add(ray(ax + bm, 240, 1300), 1, 0.4, 12, tL + 0.09);
    add(ray(ax, 240, 1500), 1, 0.3, 22, tL + 0.04);
    const arc: V2[] = [];
    for (let k = 0; k <= 60; k++) { const a = ax - 0.37 + (0.74 * k) / 60; arc.push({ x: L.x + Math.cos(a) * 640, y: L.y + Math.sin(a) * 640 }); }
    add(arc, 1, 0.45, 0, tL + 0.2);
    for (let d = -21; d <= 21; d++) {
      const a = ax + (d * Math.PI) / 180, len = d % 5 === 0 ? 16 : 7;
      add(ray(a, 640, 640 + len), 1, 0.45, 0, tL + 0.22 + (d + 21) * 0.004);
    }
    const F = { x: L.x + Math.cos(ax) * 820, y: L.y + Math.sin(ax) * 820 };
    const circ: V2[] = [];
    for (let k = 0; k <= 28; k++) circ.push({ x: F.x + Math.cos((k / 28) * TAU) * 20, y: F.y + Math.sin((k / 28) * TAU) * 20 });
    add(circ, 1.2, 0.6);
    add([{ x: F.x - 14, y: F.y - 14 }, { x: F.x + 14, y: F.y + 14 }], 1.2, 0.6);
    add([{ x: F.x - 14, y: F.y + 14 }, { x: F.x + 14, y: F.y - 14 }], 1.2, 0.6);
    // lens dimension above the lamp
    add([{ x: L.x - 196, y: 232 }, { x: L.x + 196, y: 232 }], 1, 0.5, 0, tL + 0.16);
    for (const sx of [-1, 1]) {
      add([{ x: L.x + sx * 196, y: 220 }, { x: L.x + sx * 196, y: 262 }], 1, 0.5, 0, tL + 0.16);
      add([{ x: L.x + sx * 184, y: 226 }, { x: L.x + sx * 196, y: 232 }, { x: L.x + sx * 184, y: 238 }], 1, 0.5, 0, tL + 0.2);
    }
    // plot ring (rotation of the door frame) on the beam side
    for (let k = 0; k <= 72; k++) {
      const a = Math.PI / 2 + (k / 72) * Math.PI, len = k % 6 === 0 ? 16 : 7;
      add(ray(a, 346, 346 + len), 1, 0.42, 0, tL + 0.18 + k * 0.004);
    }
    // unit / channel tags and their leaders
    const tag = (x: number, y: number, r: number, sides: number, t0: number) => {
      const pts: V2[] = [];
      for (let k = 0; k <= sides; k++) { const a = (k / sides) * TAU + (sides === 6 ? Math.PI / 6 : 0); pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }); }
      add(pts, 1.2, 0.7, 0, t0);
    };
    tag(1492, 292, 21, 28, tL + 0.22);
    tag(1546, 292, 22, 6, tL + 0.25);
    add([{ x: 1476, y: 310 }, { x: 1440, y: 346 }, { x: 1410, y: 346 }], 1, 0.55, 0, tL + 0.25);
    // spot / flood bar
    add([{ x: 1090, y: 852 }, { x: 1390, y: 852 }], 1.2, 0.55, 0, tL + 0.2);
    for (let x = 1090; x <= 1390; x += 20) add([{ x, y: 852 }, { x, y: (x - 1090) % 100 === 0 ? 840 : 846 }], 1, 0.45, 0, tL + 0.2 + (x - 1090) / 3000);
    // title block
    const tb = { x0: 1350, x1: 1862, y0: 884, y1: 1032 };
    add([{ x: tb.x0, y: tb.y0 }, { x: tb.x1, y: tb.y0 }, { x: tb.x1, y: tb.y1 }, { x: tb.x0, y: tb.y1 }, { x: tb.x0, y: tb.y0 }], 1.2, 0.6);
    for (const y of [918, 952, 986]) add([{ x: tb.x0, y }, { x: tb.x1, y }], 1, 0.4);
    add([{ x: 1560, y: 918 }, { x: 1560, y: tb.y1 }], 1, 0.4);
    add([{ x: 1720, y: 952 }, { x: 1720, y: tb.y1 }], 1, 0.4);
    // the label's frame: corner ticks, underline
    const lf = { x0: 92, x1: 990, y0: 604, y1: 952 };
    for (const [cx, cy, sx, sy] of [[lf.x0, lf.y0, 1, 1], [lf.x1, lf.y0, -1, 1], [lf.x0, lf.y1, 1, -1], [lf.x1, lf.y1, -1, -1]] as const)
      add([{ x: cx + sx * 28, y: cy }, { x: cx, y: cy }, { x: cx, y: cy + sy * 28 }], 1.3, 0.7, 0, tL + 0.02);
    add([{ x: 112, y: 822 }, { x: 960, y: 822 }], 1, 0.3, 0, tL + 0.05);
  }

  /** The camera sheet, laid out in CAMERA's key-frame screen space (front of the lens at 720, 610). */
  buildCamSheet() {
    const Cn = { x: 720, y: 610 }, tC = this.tC;
    const P = this.camItems;
    const add = (pts: V2[], w = 1, a = 0.5, dash = 0, t0 = tC) => P.push(mkItem(pts, t0, w, a, dash));
    const ax = this.axis2;
    const ray = (a: number, r0: number, r1: number): V2[] => [{ x: Cn.x + Math.cos(a) * r0, y: Cn.y + Math.sin(a) * r0 }, { x: Cn.x + Math.cos(a) * r1, y: Cn.y + Math.sin(a) * r1 }];
    const hf = (18.9 * Math.PI) / 180;
    add(ray(ax, 330, 1100), 1, 0.45, 14, tC + 0.02);
    add(ray(ax + Math.PI, 700, 1500), 1, 0.35, 14, tC + 0.1);
    add(ray(ax - hf, 330, 1200), 1.2, 0.55, 0, tC + 0.04);
    add(ray(ax + hf, 330, 1200), 1.2, 0.55, 0, tC + 0.04);
    const arc: V2[] = [];
    for (let k = 0; k <= 50; k++) { const a = ax - 0.36 + (0.72 * k) / 50; arc.push({ x: Cn.x + Math.cos(a) * 470, y: Cn.y + Math.sin(a) * 470 }); }
    add(arc, 1, 0.45, 0, tC + 0.1);
    for (let d = -20; d <= 20; d++) add(ray(ax + (d * Math.PI) / 180, 470, 470 + (d % 5 === 0 ? 14 : 6)), 1, 0.45, 0, tC + 0.12 + (d + 20) * 0.003);
    for (const [r, len] of [[560, 14], [640, 14], [760, 22]] as const) {
      const p = { x: Cn.x + Math.cos(ax) * r, y: Cn.y + Math.sin(ax) * r }, nx = -Math.sin(ax), ny = Math.cos(ax);
      add([{ x: p.x - nx * len, y: p.y - ny * len }, { x: p.x + nx * len, y: p.y + ny * len }], 1.2, 0.55, 0, tC + 0.14);
    }
    // camera report table
    const tb = { x0: 1296, x1: 1862, y0: 660, y1: 1012 };
    add([{ x: tb.x0, y: tb.y0 }, { x: tb.x1, y: tb.y0 }, { x: tb.x1, y: tb.y1 }, { x: tb.x0, y: tb.y1 }, { x: tb.x0, y: tb.y0 }], 1.2, 0.6, 0, tC + 0.02);
    const cols = [1296, 1344, 1392, 1500, 1566, 1648, 1750];
    for (const x of cols.slice(1)) add([{ x, y: 704 }, { x, y: tb.y1 }], 1, 0.35, 0, tC + 0.05 + (x - 1296) / 5000);
    for (let y = 704; y < tb.y1; y += 44) add([{ x: tb.x0, y }, { x: tb.x1, y }], 1, y === 704 ? 0.55 : 0.3, 0, tC + 0.04 + (y - 704) / 3000);
  }

  // ------------------------------------------------------------------ timing
  camAt(t: number): Cam {
    const K = this.K, { T0, tL, tC, tA, T1 } = this;
    if (t < tL) return zlerp(K.k0!, K.k0b!, prog(t, T0, tL));
    if (t < tC - 0.12) return zlerp(K.k0b!, zlerp(K.k1!, K.k1b!, prog(t, tL, tC - 0.12)), ease.outExpo(prog(t, tL, tL + 0.36)));
    if (t < tC) return zlerp(K.k1b!, K.k1c!, ease.inQuad(prog(t, tC - 0.12, tC)));
    if (t < tA - 0.24) return zlerp(K.k1c!, zlerp(K.k2!, K.k2b!, prog(t, tC, tA - 0.24)), ease.outExpo(prog(t, tC, tC + 0.28)));
    if (t < tA) return zlerp(K.k2b!, K.k3p!, ease.inCubic(prog(t, tA - 0.24, tA)));
    const c = zlerp(K.k3p!, zlerp(K.k3!, K.k3b!, ease.inOutQuad(prog(t, tA, T1))), ease.outExpo(prog(t, tA, tA + 0.3)));
    // the world converges into the caret (screen centre) as the lights go down
    c.z *= lerp(1, 0.62, ease.inCubic(prog(t, this.tBoom - 0.05, this.tBoom + 0.65)));
    return c;
  }

  /** The object: orientation, placement, morph. */
  objAt(t: number): Obj & { yaw: number; pitch: number; m: number } {
    const { tL, tC, tA } = this;
    let yaw = 0, pitch = 0;
    if (t >= tL) {
      const u = ease.outExpo(prog(t, tL, tL + 0.5));
      yaw = lerp(0, -0.45, u) - 0.05 * prog(t, tL, tC);
      pitch = lerp(0, -0.25, u);
    }
    const u2 = ease.inOutCubic(prog(t, tC - 0.12, tC + 0.3));
    yaw = lerp(yaw, -0.58 - 0.05 * prog(t, tC, tA), u2);
    pitch = lerp(pitch, 0.34, u2);
    const m = t < tC ? 0.15 * ease.inQuad(prog(t, tC - 0.12, tC)) : lerp(0.15, 1, ease.outExpo(prog(t, tC, tC + 0.3)));
    // behind the slate: recede to the lower left
    const r = ease.inOutCubic(prog(t, tA - 0.2, tA + 0.35));
    yaw = lerp(yaw, -0.95, r); pitch = lerp(pitch, 0.5, r);
    return { M: rotM(yaw, pitch), ox: lerp(0, -700, r), oy: lerp(0, 390, r), s: lerp(1, 0.5, r), yaw, pitch, m };
  }

  /** Slate local → view plane. */
  slateAt(t: number) {
    const { tA } = this;
    const u = ease.inCubic(prog(t, tA - 0.26, tA));
    let x = lerp(520, SL.x, u), y = lerp(1250, SL.y, u), r = lerp(0.3, SL.r, u), s = lerp(1.15, SL.s, u);
    if (t > tA) {
      const e = t - tA;
      y += -16 * Math.exp(-e / 0.09) * Math.sin(e * 42);
      r += 0.012 * Math.exp(-e / 0.1) * Math.sin(e * 36);
      s *= 1 + 0.025 * pulse(t, tA, 0.08);
    }
    // the stick: open while it flies in, shuts on the word, bounces on its hinge spring
    let a = 0.52 - 0.06 * prog(t, tA - 0.26, tA - 0.1);
    a *= 1 - ease.inQuad(prog(t, tA - 0.085, tA));
    if (t > tA) a = 0.05 * Math.abs(Math.sin((t - tA) * 30)) * Math.exp(-(t - tA) / 0.06);
    return { x, y, r, s, a, on: t >= tA - 0.26 };
  }

  /** World (everything but the caret) brightness in the breath. */
  dim(t: number) { return 1 - ease.inOutQuad(prog(t, this.tBoom - 0.05, this.tBoom + 0.6)); }

  /** The caret: pen head (screen), size and whether the cursor block shows. */
  caretAt(t: number, slate: Aff): { x: number; y: number; head: number; block: number } | null {
    const { tA, tH0, tH1, tCar0, tCar1, T1 } = this;
    if (t < tA) return null;
    const writing = (ch: Chalk) => {
      let len = 0;
      const cr = ch.st.charRange;
      for (let i = 0; i < cr.length; i++) { const [a, b] = cr[i]!, [t0, t1] = ch.ct[i]!; if (t >= t1) len = b; else if (t > t0) { len = a + (b - a) * ((t - t0) / (t1 - t0)); break; } else break; }
      return apply(slate, penAt(ch, len).x, penAt(ch, len).y);
    };
    const endA = this.chalkA.ct[this.chalkA.ct.length - 1]![1];
    let p: V2;
    if (t < endA) p = writing(this.chalkA);
    else if (t < tH0) {
      // lift and fly to the header
      const a = apply(slate, penAt(this.chalkA, this.chalkA.st.total).x, penAt(this.chalkA, this.chalkA.st.total).y);
      const b = apply(slate, penAt(this.chalkH, 0).x, penAt(this.chalkH, 0).y);
      const u = ease.inOutCubic(prog(t, endA + 0.04, tH0));
      p = { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - 90 * Math.sin(u * Math.PI) };
    } else if (t < tCar0) p = writing(this.chalkH);
    else {
      const a = apply(slate, penAt(this.chalkH, this.chalkH.st.total).x, penAt(this.chalkH, this.chalkH.st.total).y);
      const u = ease.inOutCubic(prog(t, tCar0, tCar1));
      p = { x: lerp(a.x, CARET_H5.x, u), y: lerp(a.y, CARET_H5.y, u) + 120 * Math.sin(u * Math.PI) };
    }
    const block = ease.outExpo(prog(t, tCar1 - 0.02, tCar1 + 0.1));
    const head = t < tCar1 ? 1 : 1 - prog(t, tCar1, tCar1 + 0.14);
    void T1;
    return { x: p.x, y: p.y, head, block };
  }

  // ------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const { T0, T1, tL, tC, tA, tBoom } = this;
    const cam = this.camAt(t);
    // per-word roll kicks
    cam.r += 0.014 * pulse(t, tL, 0.1) - 0.01 * pulse(t, tC, 0.1) + 0.012 * pulse(t, tA, 0.08);
    const CA = camAff(cam);
    const ob = this.objAt(t);
    const D = this.dim(t);
    const pre = t < tL;
    const lampOn = t < tL ? 0 : (t < tL + 0.06 ? 0.75 + 0.25 * hash(frameIdx(t), 5) : 1);

    // ---- main pass uniforms
    const u = this.main.u;
    (u.uCam!.value as THREE.Vector4).set(cam.x, cam.y, cam.z, cam.r);
    (u.uObj!.value as THREE.Vector3).set(ob.ox, ob.oy, ob.s);
    (u.uM!.value as THREE.Matrix3).copy(mat3(ob.M));
    u.uMorph!.value = ob.m;
    const rings = u.uRing!.value as THREE.Vector4[];
    for (let k = 0; k < 6; k++) {
      const mk = clamp(ob.m * 1.3 - (5 - k) * 0.06); // the rings ripple out from the front
      const a = LAMP_RINGS[k]!, b = LENS_RINGS[k]!;
      rings[k]!.set(lerp(a[0]!, b[0]!, mk), lerp(a[1]!, b[1]!, mk), lerp(a[2]!, b[2]!, mk), lerp(a[3]!, b[3]!, mk));
    }
    const iris = 0.1 + 0.68 * springStep(t - tC - 0.02, 2.3, 0.5);
    (u.uGlass!.value as THREE.Vector4).set(lerp(GLASS_LAMP.R, GLASS_LENS.R, ob.m), lerp(GLASS_LAMP.z, GLASS_LENS.z, ob.m), IRIS_Z, iris);
    const flick = pre ? 1 + (0.05 * noise1(t * 23, 3) + 0.06 * f.a.hat) * smoothstep(T0, T0 + 0.08, t) : 1;
    (u.uGlass2!.value as THREE.Vector4).set(0.9 * iris, flick, lampOn, smoothstep(T0 + 0.02, T0 + 0.3, t));
    // barn doors
    const LH = u.uLH!.value as THREE.Vector3[], LE1 = u.uLE1!.value as THREE.Vector3[], LE2 = u.uLE2!.value as THREE.Vector3[], LD = u.uLD!.value as THREE.Vector4[];
    for (let i = 0; i < 4; i++) {
      const lf = LEAVES[i]!;
      const t0 = i < 2 ? tL + i * 0.025 : this.tSide + (i - 2) * 0.02;
      const th = theta0(i) + (THETA1 - theta0(i)) * springStep(t - t0, 2.3, 0.42);
      const d0 = V3(lf.d0[0], lf.d0[1], lf.d0[2]);
      const e1 = d0.clone().multiplyScalar(Math.cos(th)).add(V3(0, 0, Math.sin(th)));
      const n = d0.clone().multiplyScalar(-Math.sin(th)).add(V3(0, 0, Math.cos(th)));
      LH[i]!.set(lf.h[0]!, lf.h[1]!, lf.h[2]!);
      LE1[i]!.copy(e1);
      LE2[i]!.copy(n.clone().cross(e1));
      const fold = 1 - smoothstep(0, 0.6, ob.m);
      LD[i]!.set(lf.L * fold, lf.hw0, lf.hw1, 1 - smoothstep(0.3, 0.7, ob.m));
    }
    const amb = pre ? 0.2 * smoothstep(T0 + 0.04, tL, t) : lerp(0.88, 1, prog(t, tC - 0.1, tC + 0.2));
    u.uAmb!.value = amb * (1 + 0.15 * pulse(t, tL, 0.1));
    u.uRimK!.value = smoothstep(tC - 0.1, tC + 0.3, t) * 0.9;
    const sh = u.uShock!.value as THREE.Vector4[];
    if (t >= tL && t < tC + 0.2) sh[0]!.set(0, 0, 214 + (t - tL) * 2500, Math.exp(-(t - tL) / 0.3));
    else if (t >= tA) {
      const sa = this.slateAt(tA), impW = apply(trs(sa.x, sa.y, sa.r, sa.s), TIP.x, TIP.y);
      sh[0]!.set(impW.x, impW.y, (t - tA) * 2600, 0.8 * Math.exp(-(t - tA) / 0.15));
    } else sh[0]!.set(0, 0, 0, 0);
    if (t >= this.tSide && t < tC) sh[1]!.set(0, 0, 214 + (t - this.tSide) * 2100, 0.45 * Math.exp(-(t - this.tSide) / 0.22));
    else sh[1]!.set(0, 0, 0, 0);
    const fr = springStep(t - tC - 0.05, 1.6, 0.62), tr = springStep(t - tC - 0.02, 1.9, 0.55);
    (u.uRot2!.value as THREE.Vector2).set(lerp(focusAng(1.2), 0, fr), lerp(tAng(6), 0, tr));
    u.uDim!.value = D;
    u.uObjK!.value = lerp(1, 0.38, ease.inOutCubic(prog(t, tA - 0.15, tA + 0.35)));
    u.uT!.value = t;
    u.uGhost!.value = smoothstep(tC, tC + 0.25, t);
    this.main.render(renderer, out);

    // ---- the plot and the camera sheet (hairlines, heat by age)
    const lb = this.plotLB; lb.clear();
    const mK1 = mul(CA, inv(camAff(this.K.k1!))), mK2 = mul(CA, inv(camAff(this.K.k2!)));
    const plotA = (1 - smoothstep(tC - 0.06, tC + 0.1, t)) * D;
    const sheetA = smoothstep(tC - 0.02, tC + 0.04, t) * (1 - smoothstep(tA - 0.14, tA + 0.02, t)) * D;
    if (plotA > 0.003) for (const it of this.plotItems) drawItem(lb, it, t, mK1, plotA);
    if (sheetA > 0.003) for (const it of this.camItems) drawItem(lb, it, t, mK2, sheetA);
    const OW = mul(CA, [1, 0, 0, 1, 0, 0]);
    if (plotA > 0.003 && t >= tL) this.drawYoke(lb, t, ob, OW, plotA);
    if (sheetA > 0.003) this.drawCallouts(lb, t, ob, OW, mK2, sheetA);
    lb.render(renderer, out);

    // ---- world type
    const L1 = this.L1; L1.clear();
    const c1 = L1.ctx;
    if (plotA > 0.003 && t >= tL) this.typePlot(c1, t, mK1, plotA);
    if (sheetA > 0.003 || (t >= tC && t < tA + 0.1)) this.typeCamera(c1, t, ob, CA, mK2, sheetA, D);
    comp.draw(renderer, L1.upload(), out);

    // ---- the slate and the beam
    const sl = this.slateAt(t);
    const SA = mul(CA, trs(sl.x, sl.y, sl.r, sl.s));
    const su = this.slate.u;
    (su.uInv!.value as THREE.Matrix3).copy(affMat3(inv(SA)));
    su.uStick!.value = sl.a;
    su.uOn!.value = sl.on ? 1 : 0;
    su.uHeat!.value = t >= tA ? Math.exp(-(t - tA) / 0.16) : 0;
    (su.uImp!.value as THREE.Vector2).set(TIP.x, TIP.y);
    (su.uShockS!.value as THREE.Vector4).set(TIP.x, TIP.y, Math.max(0, t - tA) * 2600, t >= tA ? Math.exp(-(t - tA) / 0.15) : 0);
    su.uSlDim!.value = D;
    su.uLocalPx!.value = 1 / (sl.s * cam.z);
    const beam = this.beamAt(t);
    (su.uBeam!.value as THREE.Vector4).set(beam.sx, beam.sy, beam.ang, beam.half);
    su.uBeamK!.value = beam.k;
    su.uBeamEnd!.value = beam.cv;
    (su.uPool!.value as THREE.Vector4).set(CARET_H5.x, CARET_H5.y, beam.poolR, beam.pool);
    su.uT!.value = t;
    this.slate.render(renderer, out);

    // ---- slate print, screen annotations, the cursor
    const L2 = this.L2; L2.clear();
    const c2 = L2.ctx;
    if (sl.on) this.typeSlate(c2, t, SA, D);
    this.typeScreen(c2, t, D);
    const car = this.caretAt(t, SA);
    const tq = frameIdx(t) / 60;
    if (car && car.block > 0) {
      const on = tq < this.tCar1 + 0.3 || ((((T1 - tq) / (60 / 122)) % 1) + 1) % 1 < 0.5;
      if (on) {
        c2.setTransform(1, 0, 0, 1, 0, 0);
        c2.fillStyle = rgba('signal', 1);
        const hgt = CARET_H5.h * car.block, w = CARET_H5.w;
        const cx = lerp(car.x, CARET_H5.x, car.block), cy = lerp(car.y, CARET_H5.y, car.block);
        c2.fillRect(cx - w / 2, cy - hgt / 2, w, hgt);
      }
    }
    comp.draw(renderer, L2.upload(), out);

    // ---- chalk
    const ch = this.chalkLB; ch.clear();
    if (sl.on && t >= tA) {
      drawChalk(ch, this.chalkA, t, SA, sl.s * cam.z, D, 1);
      drawChalk(ch, this.chalkH, t, SA, sl.s * cam.z, D, 2);
    }
    const cvA = smoothstep(tBoom - 0.1, tBoom + 0.05, t) * (1 - smoothstep(tBoom + 0.3, tBoom + 0.62, t));
    if (cvA > 0.003) for (const it of this.convItems) drawItem(ch, it, t, [1, 0, 0, 1, 0, 0], cvA);
    ch.render(renderer, out);

    // ---- glow: LED timecode, the lamp's level meter, sparks, dust
    const g = this.glowLB; g.clear();
    if (sl.on) this.drawTimecode(g, t, SA, D);
    this.drawMotes(g, t, beam);
    if (car && car.head > 0.01) {
      sparkHead(g, car.x, car.y, t, 0.75 * car.head, 1.1 * car.head);
      const endA = this.chalkA.ct[this.chalkA.ct.length - 1]![1];
      sparkParticles(g, t, (tb) => { const c = this.caretAt(tb, mul(camAff(this.camAt(tb)), (() => { const s = this.slateAt(tb); return trs(s.x, s.y, s.r, s.s); })())); return c; }, {
        rate: (tb) => (tb >= tA && tb < endA ? 140 : tb >= this.tH0 && tb < this.tH1 ? 70 : tb < this.tCar1 ? 18 : 0), rateMax: 140, life: 0.4, speed: 230, gravity: 700, intensity: 0.9,
      });
    }
    // the clap: sparks off the tip of the sticks
    if (t >= tA && t < tA + 0.6) {
      const tip = apply(SA, TIP.x, TIP.y);
      for (let i = 0; i < 46; i++) {
        const a = -Math.PI * (0.05 + 0.9 * hash(i, 71)), sp = 500 + 1400 * hash(i, 72) ** 2, age = t - tA;
        const lf = 0.18 + 0.35 * hash(i, 73);
        if (age > lf) continue;
        const x = tip.x + Math.cos(a) * sp * age, y = tip.y + Math.sin(a) * sp * age + 900 * age * age;
        const x0 = tip.x + Math.cos(a) * sp * Math.max(0, age - 0.02), y0 = tip.y + Math.sin(a) * sp * Math.max(0, age - 0.02) + 900 * Math.max(0, age - 0.02) ** 2;
        const k = 1 - age / lf;
        g.seg2(x0, y0, x, y, 1.6 * (0.5 + k), [LIN.ember[0] * 2.4 * k + 0.4, LIN.ember[1] * 2.4 * k + 0.1, LIN.ember[2] * 2.4 * k], k);
      }
    }
    g.render(renderer, out);

    // ---- post: hits, nods, pulses (all settle before each hand-off frame)
    const gate = smoothstep(T0, T0 + 0.1, t) * (1 - smoothstep(tBoom + 0.3, tBoom + 0.6, t));
    let shake = 14 * pulse(t, tL, 0.07) + 6 * pulse(t, this.tSide, 0.05) + 9 * pulse(t, tC, 0.06) + 30 * pulse(t, tA, 0.07);
    shake += (3 * f.a.kick + 2 * f.a.snare) * gate + 5 * pulse(t, tBoom, 0.12);
    shake *= gate;
    const fi = frameIdx(t);
    const zoom = 1 + gate * (0.05 * pulse(t, tL, 0.09) + 0.035 * pulse(t, tC, 0.09) + 0.06 * pulse(t, tA, 0.08) + 0.012 * f.a.kick + 0.008 * f.a.snare + 0.015 * pulse(t, tBoom, 0.2));
    const punch = fi === frameIdx(tA) || fi === frameIdx(tA) + 1;
    void au;
    return {
      bloom: 0.62, bloomThreshold: 0.9, bloomKnee: 0.15, halation: 0.28, vignette: 0.42, grain: 0.055,
      ca: 1.0 + 2.5 * pulse(t, tL, 0.1) + 5 * pulse(t, tA, 0.1),
      flash: 0.12 * pulse(t, tL, 0.05) + 0.08 * pulse(t, tA, 0.04),
      shake: [noise1(t * 45, 1) * shake, noise1(t * 45, 2) * shake],
      zoom, invert: punch ? 1 : 0,
    };
  }

  // ------------------------------------------------------------------ the beam (breath)
  beamAt(t: number) {
    const { tA, tBoom } = this;
    const src = { x: -260, y: -420 };
    const tgt0 = { x: 1060, y: 560 }, C = { x: CARET_H5.x, y: CARET_H5.y };
    const cv = ease.inOutCubic(prog(t, tBoom, tBoom + 0.55));
    const tx = lerp(tgt0.x, C.x, cv), ty = lerp(tgt0.y, C.y, cv);
    const k = smoothstep(tA + 0.3, tA + 1.1, t) * (1 - smoothstep(tBoom + 0.35, tBoom + 0.72, t));
    const half = lerp(0.2, 0.028, cv);
    const pool = smoothstep(tBoom - 0.05, tBoom + 0.3, t) * (1 - smoothstep(tBoom + 0.4, tBoom + 0.75, t)) * 0.9;
    return { sx: src.x, sy: src.y, ang: Math.atan2(ty - src.y, tx - src.x), half, k, pool, poolR: lerp(420, 70, cv), cv };
  }

  // ------------------------------------------------------------------ plot drawings (dynamic)
  /** The lamp's yoke and clamp up to the pipe (projected from the object each frame). */
  drawYoke(lb: LineBatch, t: number, ob: Obj, OW: Aff, a: number) {
    const mK1inv = inv(camAff(this.K.k1!)); // K1 screen → world
    const pipe = apply(mK1inv, 1240, 159);
    const pv = (x: number, y: number, z: number) => objToView(ob, x, y, z);
    const top = pv(0, 300, -720), top2 = pv(0, 300, -560);
    drawItem(lb, mkItem([{ x: top.x, y: pipe.y }, top], this.tL + 0.1, 1.6, 0.7, 0, 3000), t, OW, a);
    drawItem(lb, mkItem([{ x: top.x - 8, y: pipe.y }, { x: top.x - 8, y: top.y }], this.tL + 0.1, 1, 0.4, 0, 3000), t, OW, a);
    drawItem(lb, mkItem([top, top2], this.tL + 0.16, 1.6, 0.7, 0, 3000), t, OW, a);
    const pts: V2[] = []; for (let k = 0; k <= 6; k++) pts.push({ x: top.x + Math.cos((k / 6) * TAU) * 14, y: top.y - 30 + Math.sin((k / 6) * TAU) * 14 });
    drawItem(lb, mkItem(pts, this.tL + 0.14, 1.2, 0.7), t, OW, a);
    // C-clamp
    const q = { x: top.x, y: pipe.y };
    drawItem(lb, mkItem([{ x: q.x - 22, y: q.y + 26 }, { x: q.x - 22, y: q.y - 22 }, { x: q.x + 22, y: q.y - 22 }, { x: q.x + 22, y: q.y + 6 }], this.tL + 0.14, 1.4, 0.7), t, OW, a);
  }

  /** Leaders from parts of the lens (projected) to their labels on the sheet. */
  drawCallouts(lb: LineBatch, t: number, ob: Obj, OW: Aff, mK2: Aff, a: number) {
    const m2inv = inv(mul(camAff(this.K.k2!), [1, 0, 0, 1, 0, 0]));
    for (const [i, c] of CALLOUTS.entries()) {
      const p = objToView(ob, c.p[0]!, c.p[1]!, c.p[2]!);
      const lab = apply(m2inv, c.x - 12, c.y - 6); // label anchor in world
      const elbow = { x: lab.x - 40, y: lab.y };
      const t0 = this.tC + 0.08 + i * 0.05;
      drawItem(lb, mkItem([p, elbow, lab], t0, 1.1, 0.6, 0, 4000), t, OW, a);
      const dot: V2[] = []; for (let k = 0; k <= 10; k++) dot.push({ x: p.x + Math.cos((k / 10) * TAU) * 5, y: p.y + Math.sin((k / 10) * TAU) * 5 });
      drawItem(lb, mkItem(dot, t0, 2, 0.8), t, OW, a);
    }
    void mK2;
    // ticks around the front ring (projected), swept on from the witness mark
    for (let k = 0; k < 120; k++) {
      const ang = Math.PI / 2 - (k / 120) * TAU, R = 300, len = k % 10 === 0 ? 16 : 7;
      const p = objToView(ob, Math.cos(ang) * R, Math.sin(ang) * R, 0), q = objToView(ob, Math.cos(ang) * (R + len), Math.sin(ang) * (R + len), 0);
      drawItem(lb, mkItem([p, q], this.tC + 0.05 + k * 0.0025, 1, 0.5), t, OW, a);
    }
  }

  // ------------------------------------------------------------------ type
  typePlot(c: CanvasRenderingContext2D, t: number, m: Aff, a: number) {
    const { tL } = this;
    const age = t - tL;
    c.save();
    setT(c, m);
    c.textBaseline = 'alphabetic';
    // LIGHTS, — the instrument schedule's label, lit inside the beam; slams on the word
    const fam = F.archivo(112.5, 900);
    const size = this.labelSize;
    const w = measure('LIGHTS,', fam, size);
    const s = 1 + 0.16 * (1 - ease.outExpo(clamp(age / 0.18)));
    c.save();
    c.translate(112 + w / 2, 800 - size * 0.35); c.scale(s, s); c.translate(-(112 + w / 2), -(800 - size * 0.35));
    c.font = font(fam, size);
    c.fillStyle = hotCss(age, a);
    c.fillText('LIGHTS,', 112, 800);
    c.restore();
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('bone', 0.6 * a);
    c.fillText('INSTRUMENT SCHEDULE · UNIT 1 · POS 3', 114, 640);
    c.letterSpacing = '0px';
    // the data line; FULL arrives hot
    c.font = font(F.mono(500), 27);
    const d0 = '2K FRESNEL · 3200 K · CH 01 @ ';
    c.fillStyle = rgba('bone', 0.92 * a);
    c.fillText(d0, 114, 870);
    c.fillStyle = hotCss(age - 0.05, a);
    c.fillText('FULL', 114 + measure(d0, F.mono(500), 27), 870);
    // level meter (fills on the strike)
    for (let i = 0; i < 24; i++) {
      const lit = clamp((age - 0.02) / 0.16 * 24 - i);
      c.fillStyle = lit > 0 ? hotCss(age - 0.02 - (i / 24) * 0.16, a * (0.3 + 0.7 * lit)) : rgba('bone', 0.12 * a);
      c.fillRect(114 + i * 19, 888, 14, 10);
    }
    c.font = font(F.mono(400), 14);
    c.fillStyle = rgba('bone', 0.45 * a);
    c.fillText('FOCUS DSC · GEL N/C · FROST none · SAFETY on', 114, 926);
    c.fillText('* struck on the word', 114, 944);
    // pipe
    c.font = font(F.mono(500), 14); c.fillStyle = rgba('bone', 0.6 * a);
    c.fillText('1ST ELECTRIC · +6.40 m · SCH 40', 1560, 138);
    c.font = font(F.mono(400), 11); c.fillStyle = rgba('bone', 0.4 * a);
    for (let x = 0; x <= 1920; x += 150) c.fillText(((x - 1240) / 250).toFixed(1), x + 3, 190);
    c.fillText('POS 1', 222, 124); c.fillText('POS 2', 722, 124); c.fillText('POS 4', 1722, 124);
    // dimension, tags, spot/flood, beam, focus
    c.font = font(F.mono(500), 13); c.fillStyle = rgba('bone', 0.62 * a);
    c.textAlign = 'center';
    c.fillText('Ø 200 mm · 8 in', 1240, 214);
    c.fillText('SPOT', 1090, 876); c.fillText('FLOOD', 1390, 876);
    c.font = font(F.mono(600), 16);
    c.fillText('1', 1492, 298); c.fillText('01', 1546, 298);
    c.textAlign = 'left';
    const ax = this.axis1, L = { x: 1240, y: 560 };
    const at = (r: number, da: number) => ({ x: L.x + Math.cos(ax + da) * r, y: L.y + Math.sin(ax + da) * r });
    c.font = font(F.mono(500), 13); c.fillStyle = rgba('bone', 0.6 * a);
    let p = at(690, 0.36); c.fillText('FIELD 38° · BEAM 21°', p.x + 14, p.y - 4);
    p = at(820, 0); c.fillText('FOCUS · DSC · 6.40 m', p.x - 70, p.y + 44);
    // knob of the spot/flood bar (slides to flood on the strike)
    const kx = lerp(1100, 1380, springStep(t - tL - 0.03, 2.2, 0.5));
    c.fillStyle = hotCss(age - 0.03, a); c.fillRect(kx - 6, 842, 12, 20);
    // title block
    c.font = font(F.mono(600), 15); c.fillStyle = rgba('bone', 0.85 * a);
    c.fillText('PLOT 01 — LIGHTS', 1362, 908);
    c.font = font(F.mono(400), 12); c.fillStyle = rgba('bone', 0.55 * a);
    c.fillText('ONE PROMPT · STAGE A', 1362, 940); c.fillText('SHEET 1 / 1', 1572, 940);
    c.fillText('SCALE 1:25', 1362, 974); c.fillText('DRAWN · THE CARET', 1572, 974); c.fillText('REV 0', 1732, 974);
    c.fillText('LAMPS 1 · CIRCUITS 1', 1362, 1008); c.fillText('CHK · —', 1572, 1008); c.fillText(`${tL.toFixed(2)} s`, 1732, 1008);
    c.restore();
  }

  typeCamera(c: CanvasRenderingContext2D, t: number, ob: Obj & { m: number }, CA: Aff, mK2: Aff, a: number, D: number) {
    const { tC, tA } = this;
    const age = t - tC;
    // ---- CAMERA, engraved on the front ring (the disc at z = 0), top arc; the lens name on the bottom arc
    const ringA = smoothstep(tC - 0.03, tC + 0.02, t) * D * lerp(1, 0.4, ease.inOutCubic(prog(t, tA - 0.15, tA + 0.35)));
    if (ringA > 0.003 && ob.m > 0.3) {
      c.save();
      setT(c, mul(CA, discAff(ob, 0)));
      const fam = F.archivo(100, 900), size = 74, R = 204;
      arcText(c, 'CAMERA,', R, true, fam, size, 0.07, hotCss(age, ringA));
      arcText(c, 'ONE PROMPT OPTICS · CINE PRIME 35 mm 1:2.0 · Ø 114 · No. 000001', 204, false, F.mono(500), 15, 0.1, rgba('bone', 0.6 * ringA));
      arcText(c, '∞ · FOCUS ←', 270, false, F.mono(500), 12, 0.2, rgba('bone', 0.35 * ringA), 1.2);
      c.restore();
    }
    if (a <= 0.003) return;
    c.save();
    setT(c, mK2);
    c.textBaseline = 'alphabetic';
    // the lens data (live: the rings' positions)
    const u = this.main.u.uRot2!.value as THREE.Vector2;
    const ti = clamp(Math.round(u.y / 0.23), 0, T_STOPS.length - 1);
    const dist = u.x < 0.012 ? '∞' : `${Math.max(0.8, 3.2 / u.x - 0.6).toFixed(1)} m`;
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('bone', 0.6 * a);
    c.fillText('CAMERA SHEET · CAM A · 24 fps', 112, 96);
    c.letterSpacing = '0px';
    c.font = font(F.mono(500), 34);
    const parts = ['35 mm', ` · T${T_STOPS[ti]}`, ` · ${dist}`, ' · 172.8°'];
    let x = 112;
    parts.forEach((s, i) => {
      c.fillStyle = hotCss(age - i * 0.06, a * 0.95);
      c.fillText(s, x, 146); x += measure(s, F.mono(500), 34);
    });
    c.font = font(F.mono(400), 14); c.fillStyle = rgba('bone', 0.45 * a);
    c.fillText('S35 · 24.9 × 18.7 mm · ISO 800 · ND 0.0 · shutter 172.8° (HMI safe at 24)', 112, 176);
    // axis / AOV / focus labels
    const ax = this.axis2, Cn = { x: 720, y: 610 };
    const at = (r: number, da: number) => ({ x: Cn.x + Math.cos(ax + da) * r, y: Cn.y + Math.sin(ax + da) * r });
    c.font = font(F.mono(500), 13); c.fillStyle = rgba('bone', 0.6 * a);
    let p = at(500, -0.4); c.fillText('AOV 37.8° H', p.x - 90, p.y);
    p = at(1020, 0.02); c.fillText('OPTICAL AXIS', p.x + 10, p.y);
    for (const [r, s] of [[560, '1 m'], [640, '2 m'], [760, '∞']] as const) { p = at(r, 0); c.fillText(s, p.x + 18, p.y + 22); }
    // callout labels
    c.font = font(F.mono(500), 14);
    CALLOUTS.forEach((co, i) => { c.fillStyle = hotCss(age - 0.1 - i * 0.05, 0.75 * a); c.fillText(co.label, co.x, co.y); });
    // camera report: header row, the take's row filling in on the word
    const cols = [1296, 1344, 1392, 1500, 1566, 1648, 1750];
    c.font = font(F.mono(600), 12); c.fillStyle = rgba('bone', 0.55 * a);
    c.fillText('CAMERA REPORT · ROLL A001 · MAG 1', 1308, 690);
    ['SC', 'TK', 'LENS', 'T', 'FOCUS', 'SHUT', 'NOTE'].forEach((s, i) => c.fillText(s, cols[i]! + 8, 730));
    c.font = font(F.mono(500), 14);
    const row = ['1', '1', '35 mm', 'T2', '∞', '172.8', 'on cue'];
    row.forEach((s, i) => { const ag = age - 0.06 - i * 0.04; if (ag > 0) { c.fillStyle = hotCss(ag, 0.95 * a); c.fillText(s, cols[i]! + 8, 776); } });
    c.fillStyle = rgba('bone', 0.25 * a);
    for (const y of [820, 864, 908, 952, 996]) ['—', '—', '', '', '', '', ''].forEach((s, i) => s && c.fillText(s, cols[i]! + 8, y));
    c.restore();
  }

  typeSlate(c: CanvasRenderingContext2D, t: number, SA: Aff, D: number) {
    c.save();
    setT(c, SA);
    c.textBaseline = 'alphabetic';
    const a = D;
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('bone', 0.5 * a);
    c.fillText('PRODUCTION', -548, -272);
    c.fillText('CALL', -548, -120);
    c.fillText('ROLL', -548, 266); c.fillText('DATE', -168, 266); c.fillText('TIMECODE', 212, 266);
    c.letterSpacing = '0px';
    c.font = font(F.mono(500), 30); c.fillStyle = rgba('bone', 0.82 * a);
    c.fillText('A001 · CAM A', -548, 334);
    c.fillText('27 · 09 · 26', -168, 334);
    const fr = frames(t);
    c.font = font(F.mono(500), 15); c.fillStyle = rgba('bone', 0.6 * a);
    c.fillText(`FRAMES ${String(fr).padStart(6, '0')}`, 212, 372);
    c.fillText('24 fps · NDF', 420, 372);
    c.font = font(F.mono(400), 12); c.fillStyle = rgba('bone', 0.35 * a);
    c.fillText('ONE PROMPT CAMERA DEPT. · SLATE No. 1 · WIPE WITH A DRY CLOTH ONLY', -548, 372);
    c.restore();
  }

  typeScreen(c: CanvasRenderingContext2D, t: number, D: number) {
    const { T0, tA, tBoom } = this;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    const a = smoothstep(T0 + 0.12, T0 + 0.3, t) * (1 - smoothstep(tBoom - 0.1, tBoom + 0.3, t));
    c.font = font(F.mono(500), 13); c.letterSpacing = '3px';
    const labels = ['01 LIGHTS', '02 CAMERA', '03 ACTION!'];
    let x = 96, wi = -1;
    this.wordT.forEach((w, i) => { if (t >= w) wi = i; });
    if (a > 0.003) {
      labels.forEach((l, i) => {
        c.fillStyle = i === wi ? rgba('signal', a) : rgba('bone', 0.4 * a);
        c.fillText(l, x, 1030); x += measure(l, F.mono(500), 13, 3) + 36;
      });
    }
    // deadpan notes after the clap and in the breath
    const n1 = smoothstep(tA + 0.25, tA + 0.4, t) * D;
    if (n1 > 0.003) {
      c.font = font(F.mono(500), 13); c.fillStyle = rgba('bone', 0.5 * n1);
      c.textAlign = 'right';
      c.fillText(`MARK IT · CLAP ${tA.toFixed(2)} s · SYNC ±0 fr`, 1824, 60);
      const n2 = smoothstep(this.tH1 - 0.2, this.tH1, t);
      c.fillStyle = rgba('bone', 0.5 * n1 * n2);
      c.fillText('ROOM TONE · EVERYONE HOLD', 1824, 82);
      c.textAlign = 'left';
    }
    c.letterSpacing = '0px';
    c.restore();
  }

  drawTimecode(g: LineBatch, t: number, SA: Aff, D: number) {
    const fr = frames(t);
    const s = Math.floor(fr / 24), ff = fr % 24;
    const txt = `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
    const on: RGB = [LIN.signal[0] * 1.05 * D, LIN.signal[1] * 1.05 * D, LIN.signal[2] * 1.05 * D];
    const off: RGB = [LIN.blood[0] * 0.05 * D, LIN.blood[1] * 0.05 * D, LIN.blood[2] * 0.05 * D];
    drawLED(g, txt, 214, 284, 24, 44, SA, on, off, 1, 3.4 * Math.hypot(SA[0], SA[1]));
  }

  drawMotes(g: LineBatch, t: number, beam: ReturnType<Plot['beamAt']>) {
    if (beam.k < 0.003) return;
    const ax = Math.cos(beam.ang), ay = Math.sin(beam.ang);
    for (const m of this.motes) {
      const x = m.x + 14 * Math.sin(t * 0.35 * m.sp + m.ph) + (t - this.tA) * 9 * m.sp;
      const y = m.y + 10 * Math.sin(t * 0.27 * m.sp + m.ph * 1.7) - (t - this.tA) * 5 * (m.k - 0.3);
      const dx = x - beam.sx, dy = y - beam.sy;
      const al = dx * ax + dy * ay;
      const ang = Math.abs(Math.atan2(ax * dy - ay * dx, al));
      const inB = (1 - smoothstep(beam.half * 0.7, beam.half, ang)) * smoothstep(0, 300, al);
      if (inB < 0.02) continue;
      const tw = 0.55 + 0.45 * Math.sin(t * (1.3 + m.sp) + m.ph * 3);
      const I = inB * tw * beam.k;
      const hot = m.k > 0.9 ? 2.2 : 0.55;
      g.seg2(x, y, x + 0.4, y + 0.3, m.sz, [LIN.ember[0] * hot * I + LIN.bone[0] * 0.25 * I, LIN.ember[1] * hot * I + LIN.bone[1] * 0.25 * I, LIN.ember[2] * hot * I + LIN.bone[2] * 0.25 * I], Math.min(1, I * 1.2));
    }
  }
}

/** Labels around the lens (CAMERA key-frame screen) and the object points they point at. */
const CALLOUTS = [
  { p: [0, 160, -800], x: 1430, y: 110, label: 'PL MOUNT · 52 mm FLANGE' },
  { p: [0, 230, -650], x: 1430, y: 200, label: 'T-STOP RING · T2 → T22' },
  { p: [0, 262, -430], x: 1430, y: 290, label: 'FOCUS RING · 0.8 m → ∞' },
  { p: [0, 236, -240], x: 1430, y: 380, label: 'WITNESS MARK' },
  { p: [300, -40, 0], x: 1430, y: 480, label: 'FRONT Ø 114 · 9-BLADE IRIS' },
];

/** Text around an arc of radius R (disc coords, y down), upright; top = reads clockwise over the top. */
function arcText(c: CanvasRenderingContext2D, text: string, R: number, top: boolean, fam: string, size: number, track: number, fill: string, centre = 0) {
  c.save();
  c.font = font(fam, size);
  c.textAlign = 'center';
  c.textBaseline = top ? 'alphabetic' : 'top';
  const chars = [...text];
  const ws = chars.map((ch) => measure(ch, fam, size) + size * track);
  const tot = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  c.fillStyle = fill;
  for (let i = 0; i < chars.length; i++) {
    const s = (acc + ws[i]! / 2) / R - tot / R / 2;
    acc += ws[i]!;
    const a = top ? -Math.PI / 2 + s + centre : Math.PI / 2 - s + centre;
    c.save();
    c.translate(Math.cos(a) * R, Math.sin(a) * R);
    c.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
    c.fillText(chars[i]!, 0, 0);
    c.restore();
  }
  c.restore();
}

function affMat3(m: Aff) { return new THREE.Matrix3().set(m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1); }
