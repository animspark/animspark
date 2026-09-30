// City plate: the world. Units: 1 = one letter-brick. Z up, the viewer stands at -X,-Y.
// Everything here is built once (seeded) in init; the plate animates it by time.
import { mulberry32, clamp } from '../px/util';

export type V3 = [number, number, number];

/** lot pitch (a lot is 3.2 bricks square); every 4th row / column is a street */
export const PL = 3.2;
/** the letter-brick */
export const BRICK = { L: 1, D: 0.62, H: 0.78, gap: 0.05 };
/** city limit (radius, world units) */
export const RCITY = 60;
/** storey height and the window (3:2, the H4 window is one of these) */
export const FLOOR = 0.9;
export const WIN = { w: 0.36, h: 0.24 };

export const isStreet = (k: number) => ((k % 4) + 4) % 4 === 2;

/** the river: centreline y(x) and half-width */
export const riverY = (x: number) => -20.5 + 5.5 * Math.sin(0.055 * x + 0.6) + 2.2 * Math.sin(0.13 * x + 2.1);
export const riverW = (x: number) => 3.1 + 0.6 * Math.sin(0.09 * x + 1.0);

export type Kind = 0 | 1 | 2; // 0 building, 1 clicked tower, 2 the slab
export interface Bldg {
  x0: number; x1: number; y0: number; y1: number; h: number;
  cx: number; cy: number; r: number; ang: number;
  kind: Kind; seed: number;
  /** plan footprint appears / the pen extrudes it (set by the plate) */
  tPlan: number; tDraw: number;
  /** tower index for kind 1 */
  tower: number;
}

/** clicked lots (lot indices) and tower heights */
export const TOWERS = [
  { i: -1, j: 3, h: 11 },
  { i: 1, j: 3, h: 16.5 },
  { i: 3, j: 1, h: 21 },
] as const;

/** the slab (lots 7..9, row -3): a wide wall facing the river, the ghost signs and the H4 window on it */
export const SLAB = { x0: 7 * PL - 1.32, x1: 9 * PL + 1.32, y0: -3 * PL - 1.2, y1: -3 * PL + 1.25, h: 20.2 };
/** slab windows: 11 bays, the hero is bay 5 of storey 6 */
export const SLAB_BAYS = 11;
export const HERO = { bay: 5, floor: 6 };
export const winZ = (f: number) => 0.6 + f * FLOOR + 0.12;
export const HERO_C: V3 = [(SLAB.x0 + SLAB.x1) / 2, SLAB.y0, winZ(HERO.floor)];

export interface Win {
  c: V3; u: V3; v: V3; // centre, half-width and half-height vectors (on the face)
  b: number; // building index
  hero: boolean;
  lit: boolean;
  tLit: number;
}

export interface Line3 { a: V3; b: V3; r: number; cls: number }

export interface World {
  bl: Bldg[];
  wins: Win[];
  /** street curbs, centre dashes, river banks and water lines, city limit: static ground linework */
  ground: Line3[];
  heroWin: number;
  slab: number;
  towers: number[];
}

export function buildWorld(): World {
  const rnd = mulberry32(4031);
  const bl: Bldg[] = [];
  const N = 20;
  const R = RCITY;
  const inRiver = (x: number, y: number, pad: number) => Math.abs(y - riverY(x)) < riverW(x) + pad;
  const towerAt = (i: number, j: number) => TOWERS.findIndex((t) => t.i === i && t.j === j);
  const slabLot = (i: number, j: number) => j === -3 && i >= 7 && i <= 9;
  const towers: number[] = [];
  for (let j = -N; j <= N; j++) {
    for (let i = -N; i <= N; i++) {
      const cx = i * PL, cy = j * PL;
      const r = Math.hypot(cx, cy);
      if (isStreet(i) || isStreet(j)) continue;
      if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue; // the plaza
      if (r > R - 1.5) continue;
      if (slabLot(i, j)) continue;
      if (inRiver(cx, cy, 1.9)) continue;
      const ti = towerAt(i, j);
      const seed = rnd();
      if (ti >= 0) {
        const hw = 1.2;
        towers.push(bl.length);
        bl.push({ x0: cx - hw, x1: cx + hw, y0: cy - hw, y1: cy + hw, h: TOWERS[ti]!.h, cx, cy, r, ang: Math.atan2(cy, cx), kind: 1, seed, tPlan: 0, tDraw: 0, tower: ti });
        continue;
      }
      const w = PL * (0.5 + 0.3 * rnd()), d = PL * (0.5 + 0.3 * rnd());
      const jx = (PL - 0.5 - w) * (rnd() - 0.5), jy = (PL - 0.5 - d) * (rnd() - 0.5);
      // downtown is taller; the edge of town is low, with the odd tall block
      const hMax = 2.4 + 6.4 * Math.exp(-((r / 24) ** 2)) + 2.2 * Math.exp(-(((r - 34) / 10) ** 2));
      let h = 1.1 + (hMax - 1.1) * Math.pow(rnd(), 1.5);
      if (rnd() < 0.03) h *= 1.55;
      // keep the clicked towers' faces and rooftop signs clear: lower blocks in front of them
      for (const tw of TOWERS) {
        const tx = tw.i * PL, ty = tw.j * PL;
        if (Math.hypot(cx - tx, cy - ty) < 10 && cx + cy < tx + ty) h = Math.min(h, tw.h * 0.5);
      }
      // nothing tall south of the slab, across the river: the last shot looks straight at it
      if (cy < SLAB.y0 && cx > SLAB.x0 - 4 && cx < SLAB.x1 + 4) h = Math.min(h, 3.2);
      // storeys: heights snap to whole floors plus a parapet
      h = Math.max(1, Math.round(h / FLOOR)) * FLOOR + 0.25;
      const x = cx + jx, y = cy + jy;
      bl.push({ x0: x - w / 2, x1: x + w / 2, y0: y - d / 2, y1: y + d / 2, h, cx: x, cy: y, r: Math.hypot(x, y), ang: Math.atan2(y, x), kind: 0, seed, tPlan: 0, tDraw: 0, tower: -1 });
    }
  }
  const slab = bl.length;
  {
    const cx = (SLAB.x0 + SLAB.x1) / 2, cy = (SLAB.y0 + SLAB.y1) / 2;
    bl.push({ ...SLAB, cx, cy, r: Math.hypot(cx, cy), ang: Math.atan2(cy, cx), kind: 2, seed: 0.5, tPlan: 0, tDraw: 0, tower: -1 });
  }
  // sort towers into click order
  towers.sort((a, b) => bl[a]!.tower - bl[b]!.tower);

  // ---- windows: on the two faces the viewer sees (-Y front, -X side)
  const wins: Win[] = [];
  let heroWin = -1;
  const hw = WIN.w / 2, hh = WIN.h / 2;
  bl.forEach((b, bi) => {
    const floors = Math.floor((b.h - 0.55) / FLOOR);
    const face = (len: number, bays: number, at: (s: number) => [number, number], side: 'y' | 'x') => {
      for (let f = 0; f < floors; f++) {
        for (let k = 0; k < bays; k++) {
          const s = (k + 0.5) / bays;
          const [x, y] = at(s);
          const c: V3 = [x, y, winZ(f)];
          const hero = b.kind === 2 && side === 'y' && k === HERO.bay && f === HERO.floor;
          if (hero) heroWin = wins.length;
          wins.push({ c, u: side === 'y' ? [hw, 0, 0] : [0, hw, 0], v: [0, 0, hh], b: bi, hero, lit: false, tLit: 1e9 });
        }
      }
      void len;
    };
    const wx = b.x1 - b.x0, wy = b.y1 - b.y0;
    const baysX = b.kind === 2 ? SLAB_BAYS : Math.max(1, Math.floor((wx - 0.25) / 0.66));
    const baysY = Math.max(1, Math.floor((wy - 0.25) / 0.66));
    face(wx, baysX, (s) => [b.x0 + s * wx, b.y0 - 0.002], 'y');
    face(wy, baysY, (s) => [b.x0 - 0.002, b.y0 + s * wy], 'x');
  });

  // ---- ground linework
  const ground: Line3[] = [];
  const add = (a: V3, b: V3, cls: number) => ground.push({ a, b, r: Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), cls });
  // streets: curbs, split into lot-length pieces (revealed piece by piece); dashed centre lines
  const CURB = 1.05;
  for (let s = -N; s <= N; s++) {
    if (!isStreet(s)) continue;
    const c = s * PL;
    const lim = Math.sqrt(Math.max(0, R * R - c * c));
    // one piece per lot along the street; curbs stop at the cross streets' curbs
    for (let k = -N - 1; k <= N + 1; k++) {
      if (isStreet(k)) continue;
      let v0 = k * PL - PL / 2, v1 = k * PL + PL / 2;
      if (isStreet(k - 1)) v0 = (k - 1) * PL + CURB;
      if (isStreet(k + 1)) v1 = (k + 1) * PL - CURB;
      v0 = Math.max(v0, -lim); v1 = Math.min(v1, lim);
      if (v1 <= v0) continue;
      for (const o of [-CURB, CURB]) {
        // across the river the street is a bridge: keep the curbs (the deck)
        add([c + o, v0, 0], [c + o, v1, 0], 0);
        add([v0, c + o, 0], [v1, c + o, 0], 0);
      }
      for (const m of [k * PL - 1.1, k * PL + 0.5]) {
        if (m < v0 || m + 0.6 > v1) continue;
        add([c, m, 0], [c, m + 0.6, 0], 1);
        add([m, c, 0], [m + 0.6, c, 0], 1);
      }
    }
  }
  // river banks, water lines
  const rx0 = -R, rx1 = R, step = 0.8;
  for (let x = rx0; x < rx1; x += step) {
    const xa = x, xb = x + step;
    for (const side of [-1, 1]) {
      const ya = riverY(xa) + side * riverW(xa), yb = riverY(xb) + side * riverW(xb);
      if (Math.hypot(xa, ya) > R || Math.hypot(xb, yb) > R) continue;
      add([xa, ya, 0], [xb, yb, 0], 2);
    }
    // water: short engraved dashes between the banks, staggered
    for (let k = -2; k <= 2; k++) {
      if ((Math.floor(x / step) + k) % 2 !== 0) continue;
      const f = k / 2.6;
      const ya = riverY(xa) + f * riverW(xa), yb = riverY(xa + step * 0.55) + f * riverW(xa + step * 0.55);
      if (Math.hypot(xa, ya) > R - 1) continue;
      add([xa, ya, 0], [xa + step * 0.55, yb, 0], 3);
    }
  }
  // the city limit: a dash-dot circle
  for (let k = 0; k < 360; k++) {
    const a0 = (k / 360) * Math.PI * 2, a1 = ((k + 0.62) / 360) * Math.PI * 2;
    if (k % 3 === 2) continue;
    add([Math.cos(a0) * R, Math.sin(a0) * R, 0], [Math.cos(a1) * R, Math.sin(a1) * R, 0], 4);
  }
  void clamp;
  return { bl, wins, ground, heroWin, slab, towers };
}

/** the stack of letter-bricks: one course per sung word, bottom to top */
export interface BrickDef { ch: string; course: number; k: number; x0: number; z0: number; t: number; word: number }
export function layoutStack(words: string[], wordIdx: number[], times: number[][]): BrickDef[] {
  const out: BrickDef[] = [];
  words.forEach((w, c) => {
    const n = w.length;
    for (let k = 0; k < n; k++) {
      out.push({ ch: w[k]!, course: c, k, x0: (k - n / 2) * BRICK.L, z0: c * BRICK.H, t: times[c]![k]!, word: wordIdx[c]! });
    }
  });
  return out;
}
