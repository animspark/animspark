// Helpers for plate `stadium` ("Rain it down on every crowd"): the stadium's plan geometry (world units are
// metres, origin at the centre spot, x east, y south = screen-down), colour heat, the 2D camera, the seat
// count, the section list, and the lettering mask the shader samples (pitch paint, card stunt, rain imprints).
import * as THREE from 'three';
import { HEX } from '../px/palette';
import { F, font, layout } from '../px/type';
import { clamp, lerp, smoothstep } from '../px/util';

/** the plan. Rails = the stands' front rails (LED boards) = RAILS_H12 at the first frame. */
export const G = {
  PL: 52.5, PW: 34, // pitch half-length / half-width (105 × 68)
  AX: 62.5, AY: 44, RC: 6, // front rail: rounded rectangle half-extents and corner radius
  CCX: 56.5, CCY: 38, // corner centres (AX − RC, AY − RC)
  D0: 1.6, ROWH: 0.8, NLOW: 28, DX0: 24, DX1: 27, NUP: 38, DBACK: 57.4, DOUT: 59.2, // rows (d = distance behind the rail)
  SEC: 13.2, AISLE: 1.2, SEAT: 0.6, // section pitch along a straight, aisle width, seat pitch
  VOM0: 10, VOM1: 20, // vomitory rows in the lower tier (even sections on the straights)
  TOWER_R: 73, // floodlight towers: radius from the corner centre, on the diagonal
};
export const TOWERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [
  sx! * (G.CCX + G.TOWER_R * Math.SQRT1_2), sy! * (G.CCY + G.TOWER_R * Math.SQRT1_2),
]);

/** world → mask texture: 8 texels per metre over x ∈ [−128, 128], y ∈ [−105, 105] */
export const MASK = { x0: -128, y0: -105, w: 256, h: 210, S: 8 };

// ------------------------------------------------------------------ colour
export type RGB = [number, number, number];
export function hexRGB(k: string): RGB {
  const hex = (HEX as Record<string, string>)[k] ?? k;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a)})`;
const mix3 = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const WHITE_HOT: RGB = [255, 242, 226];
/** fresh type on ink: white-hot tip → ember → signal wake → `base` in ~0.3 s */
export function heatCss(age: number, a = 1, base = 'bone'): string {
  if (age < 0) return css(hexRGB(base), a);
  const s = 1 - smoothstep(0.05, 0.32, age);
  const e = Math.exp(-age / 0.045);
  let c = mix3(hexRGB(base), hexRGB('signal'), s);
  c = mix3(c, hexRGB('ember'), e * 0.7);
  c = mix3(c, WHITE_HOT, e * e * 0.6);
  return css(c, a);
}
/** linear heat for the additive glow batch: 1 → white-hot, then signal, then nothing */
export function heatLin(age: number, k = 1): RGB {
  if (age < 0) return [0, 0, 0];
  const tip = Math.exp(-age / 0.05), wake = Math.exp(-age / 0.32);
  return [(1.6 * wake + 1.6 * tip) * k, (0.16 * wake + 1.2 * tip) * k, (0.02 * wake + 0.8 * tip) * k];
}

// ------------------------------------------------------------------ camera
export interface Cam { x: number; y: number; r: number; z: number }
export const logLerp = (a: number, b: number, k: number) => Math.exp(lerp(Math.log(a), Math.log(b), k));
export const lerpCam = (p: Cam, q: Cam, k: number): Cam => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), r: lerp(p.r, q.r, k), z: logLerp(p.z, q.z, k) });
/** world (m) → screen (logical px) for camera `c`: s = centre + z·R(r)·(p − c) */
export function camXf(c: Cam, W = 1920, H = 1080) {
  const cs = Math.cos(c.r) * c.z, sn = Math.sin(c.r) * c.z;
  return { a: cs, b: sn, c: -sn, d: cs, e: W / 2 - (cs * c.x - sn * c.y), f: H / 2 - (sn * c.x + cs * c.y) };
}
export type Xf = ReturnType<typeof camXf>;
export const ap = (m: Xf, x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });

// ------------------------------------------------------------------ the stands
/** distance behind the front rail of row centre r (0 = front row of the lower tier) */
export const rowD = (r: number) => (r < G.NLOW ? G.D0 + (r + 0.5) * G.ROWH : G.DX1 + (r - G.NLOW + 0.5) * G.ROWH);
const NROWS = G.NLOW + G.NUP;

/** seats the shader draws (mirrors its rules exactly) */
export function seatCount() {
  let n = 0;
  for (let r = 0; r < NROWS; r++) {
    const dc = rowD(r);
    for (const L of [G.CCX, G.CCY]) {
      for (let k = -6; k <= 6; k++) for (let s = 0; s < 20; s++) {
        const ac = (k - 0.5) * G.SEC + G.AISLE + (s + 0.5) * G.SEAT;
        if (Math.abs(ac) >= L - 0.3) continue;
        const loc = G.AISLE + (s + 0.5) * G.SEAT;
        if (r >= G.VOM0 && r < G.VOM1 && k % 2 === 0 && loc >= 5.4 && loc <= 8.4) continue;
        n += 2;
      }
    }
    const R = G.RC + dc;
    n += 12 * Math.max(0, Math.floor(((Math.PI / 6) * R - G.AISLE) / G.SEAT));
  }
  return n;
}

export interface Section { n: number; x: number; y: number; ang: number; tier: 0 | 1; d: number }
/** section numbers, clockwise from the north-west: lower tier 101…, upper tier 201… */
export function sections(): Section[] {
  const out: Section[] = [];
  for (const tier of [0, 1] as const) {
    const d = tier === 0 ? 12.8 : 43;
    let n = tier === 0 ? 101 : 201;
    const straight = (L: number) => {
      const r: number[] = [];
      for (let k = -6; k <= 6; k++) {
        const a0 = Math.max(-L, (k - 0.5) * G.SEC + G.AISLE), a1 = Math.min(L, (k + 0.5) * G.SEC);
        if (a1 - a0 > 3) r.push((a0 + a1) / 2);
      }
      return r;
    };
    const corner = (sx: number, sy: number, order: number[]) => {
      for (const k of order) {
        const th = (k + 0.5) * (Math.PI / 6), R = G.RC + d;
        out.push({ n: n++, x: sx * (G.CCX + R * Math.cos(th)), y: sy * (G.CCY + R * Math.sin(th)), ang: 0, tier, d });
      }
    };
    for (const a of straight(G.CCX)) out.push({ n: n++, x: a, y: -(G.AY + d), ang: 0, tier, d }); // north, west → east
    corner(1, -1, [2, 1, 0]);
    for (const a of straight(G.CCY)) out.push({ n: n++, x: G.AX + d, y: a, ang: 0, tier, d }); // east, north → south
    corner(1, 1, [0, 1, 2]);
    for (const a of straight(G.CCX).reverse()) out.push({ n: n++, x: a, y: G.AY + d, ang: 0, tier, d }); // south, east → west
    corner(-1, 1, [2, 1, 0]);
    for (const a of straight(G.CCY).reverse()) out.push({ n: n++, x: -(G.AX + d), y: a, ang: 0, tier, d }); // west, south → north
    corner(-1, -1, [0, 1, 2]);
  }
  return out;
}

// ------------------------------------------------------------------ lettering
export interface WordBox { text: string; x0: number; w: number; base: number; size: number; top: number; bot: number }
/**
 * Lettering in world metres. Returns the boxes and the mask texture:
 *   R = pitch paint (ON above `split`, EVERY below), G = the card stunt (CROWD), B = rain imprints.
 * Rows run top-down (world y down), sampled with v = (y − y0) / h, no flip.
 */
export function buildLettering(rain: { line: string; words: string[] }) {
  const S = MASK.S, NW = MASK.w * S, NH = MASK.h * S;
  const data = new Uint8Array(NW * NH * 4);
  const cv = document.createElement('canvas');
  cv.width = NW; cv.height = NH;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const toTex = () => c.setTransform(S, 0, 0, S, -MASK.x0 * S, -MASK.y0 * S);
  const box = (text: string, fam: string, size: number, x0: number, base: number): WordBox => {
    c.font = font(fam, size);
    const m = c.measureText(text);
    return { text, x0, w: m.width, base, size, top: base - m.actualBoundingBoxAscent, bot: base + m.actualBoundingBoxDescent };
  };
  const stamp = (ch: 0 | 1 | 2, draw: () => void) => {
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, NW, NH);
    toTex(); c.fillStyle = '#fff'; c.textBaseline = 'alphabetic'; draw();
    const im = c.getImageData(0, 0, NW, NH).data;
    for (let i = 0; i < NW * NH; i++) { const a = im[i * 4 + 3]!; if (a) data[i * 4 + ch] = Math.max(data[i * 4 + ch]!, a); }
  };

  // pitch paint: ON / EVERY stacked either side of the centre spot, upright to the camera
  const famP = F.archivo(100, 900);
  c.font = font(famP, 100);
  const capP = c.measureText('E').actualBoundingBoxAscent / 100;
  const evSize = 25.5, onSize = 19;
  const ev = box('EVERY', famP, evSize, 0, 6.2 + capP * evSize);
  ev.x0 = -ev.w / 2;
  const on = box('ON', famP, onSize, 0, -6.2);
  on.x0 = -on.w / 2;
  stamp(0, () => { c.font = font(famP, evSize); c.fillText('EVERY', ev.x0, ev.base); c.font = font(famP, onSize); c.fillText('ON', on.x0, on.base); });

  // the card stunt on the south stand
  const famC = F.archivo(100, 900);
  const crTop = G.AY + 3.2, crBot = G.AY + G.DBACK - 1.4;
  c.font = font(famC, 100);
  const mC = c.measureText('CROWD');
  const capC = mC.actualBoundingBoxAscent / 100;
  let crSize = (crBot - crTop) / capC;
  crSize = Math.min(crSize, 224 / (mC.width / 100));
  const cr = box('CROWD', famC, crSize, 0, (crTop + crBot) / 2 + (capC * crSize) / 2);
  cr.x0 = -cr.w / 2;
  stamp(1, () => { c.font = font(famC, crSize); c.fillText('CROWD', cr.x0, cr.base); });

  // "Rain it down" on the north stand, one kerned line
  const famR = F.archivo(87.5, 900);
  const rSize = 31;
  const lay = layout(rain.line, famR, rSize);
  c.font = font(famR, 100);
  const capR = c.measureText('R').actualBoundingBoxAscent / 100;
  const rBase = -(G.AY + 29.5) + (capR * rSize) / 2;
  const lx0 = -lay.width / 2;
  const rw: WordBox[] = [];
  let ci = 0;
  for (const w of rain.words) {
    const i0 = rain.line.indexOf(w, ci); ci = i0 + w.length;
    const x0 = lx0 + lay.glyphs[i0]!.x;
    rw.push(box(w, famR, rSize, x0, rBase));
  }
  stamp(2, () => { c.font = font(famR, rSize); c.fillText(rain.line, lx0, rBase); });

  for (let i = 0; i < NW * NH; i++) data[i * 4 + 3] = 255;
  const tex = new THREE.DataTexture(data, NW, NH, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
  return { tex, on, ev, cr, rain: rw, famR, famP, famC, split: 0 };
}

export const grp = (n: number) => Math.round(n).toLocaleString('en-US');
