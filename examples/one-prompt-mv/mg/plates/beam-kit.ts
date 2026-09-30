// Plate `beam`: the hall's world constants, the camera maths and the projector's frustum.
// World units are metres, y up. The screen is the plane z = 0 (facing +z, the house); the booth is at the
// back (z ≈ 28.3). Screen-space px are logical 1920×1080, y down.
import { W, H } from '../px/gl';

export type V3 = [number, number, number];
export interface Cam { pos: V3; R: V3; U: V3; F: V3; focal: number }

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => mul(a, 1 / len(a));
export const mix3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Camera looking from pos at target; focal in logical px (half-height / tan(half-fov)). */
export function lookAt(pos: V3, target: V3, focal: number, roll = 0): Cam {
  const Fw = norm(sub(target, pos));
  let R = norm(cross(Fw, [0, 1, 0]));
  let U = cross(R, Fw);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    [R, U] = [add(mul(R, c), mul(U, s)), add(mul(U, c), mul(R, -s))];
  }
  return { pos, R, U, F: Fw, focal };
}
/** World point → screen px (y down); z = depth along the view axis. */
export function project(c: Cam, p: V3) {
  const q = sub(p, c.pos);
  const z = dot(q, c.F);
  return { x: W / 2 + (dot(q, c.R) / z) * c.focal, y: H / 2 - (dot(q, c.U) / z) * c.focal, z };
}

// ------------------------------------------------------------------ the hall
export const HALL = {
  /** screen centre and half-size (2.38:1, scope): lit, it is SCREEN_H8 at the plate's end */
  SC: [0, 4.2, 0] as V3, SHW: 6, SHH: 2.52,
  /** the gate (the douser opening in the booth port), centre */
  G: [0, 7.6, 28.35] as V3,
  /** back wall face */
  backZ: 28.2,
  /** rake: floor height at z */
  rake0: 3.4, rakeK: 0.18,
  /** seat rows: row k centre at z0 + k * pitch, k = 0..NROW-1 (row A is nearest the screen) */
  row0: 4.4, rowP: 0.95, NROW: 25,
  seatP: 0.56, seatX0: 0.9, seatX1: 7.6,
  wallX: 9, ceilY: 10.5,
};
/** the gate's cross-section as a fraction of the screen's: the frustum is similar, apex A behind the gate */
export const SG = 1 / 21;
const GZ = HALL.G[2];
/** apex (the lamp's focal point): G + (G − SC) · SG / (1 − SG) */
export const APEX: V3 = add(HALL.G, mul(sub(HALL.G, HALL.SC), SG / (1 - SG)));
/** gate half-height (m) */
export const GATE_HH = HALL.SHH * SG;
/** full-open gate half-width (m) */
export const GATE_HW = HALL.SHW * SG;
export const floorY = (z: number) => HALL.rakeK * Math.max(z - HALL.rake0, 0);
export const rowZ = (k: number) => HALL.row0 + k * HALL.rowP;
export const ROWS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'; // (no I: cinemas skip it)

/**
 * A point of the beam in frustum coordinates: u, v in −1..1 across the lit screen rectangle (u scaled by
 * the douser opening `open`), λ from the apex (0) to the screen (1). The gate is at λ = SG.
 */
export function beamPt(u: number, v: number, lam: number, open = 1): V3 {
  const sx = HALL.SC[0] + u * HALL.SHW * open, sy = HALL.SC[1] + v * HALL.SHH;
  return [APEX[0] + lam * (sx - APEX[0]), APEX[1] + lam * (sy - APEX[1]), APEX[2] + lam * (HALL.SC[2] - APEX[2])];
}
/** λ of the plane z */
export const lamOfZ = (z: number) => 1 - z / APEX[2];
/** throw (lens to screen, along the axis), m */
export const THROW = len(sub(HALL.G, HALL.SC));
/** axis length apex → screen centre */
export const AXIS_L = len(sub(HALL.SC, APEX));

/**
 * The four side planes of the (open) frustum, as (n, d) with inside ⇔ dot(n, p) + d ≤ 0, plus the gate
 * plane and the screen plane.
 */
export function frustumPlanes(open: number): [number, number, number, number][] {
  const c = (u: number, v: number) => beamPt(u, v, 1, open);
  const pl = (a: V3, b: V3, inside: V3): [number, number, number, number] => {
    let n = norm(cross(sub(a, APEX), sub(b, APEX)));
    if (dot(n, sub(inside, APEX)) > 0) n = mul(n, -1);
    return [n[0], n[1], n[2], -dot(n, APEX)];
  };
  const ins = HALL.SC;
  return [
    pl(c(1, -1), c(1, 1), ins), pl(c(-1, -1), c(-1, 1), ins),
    pl(c(-1, 1), c(1, 1), ins), pl(c(-1, -1), c(1, -1), ins),
    [0, 0, 1, -GZ], // z ≤ gate
    [0, 0, -1, 0], // z ≥ 0
  ];
}

/** Clip a 3D segment to the camera's near plane and project it; null if it is entirely behind. */
export function projSeg(c: Cam, a: V3, b: V3, near = 0.05) {
  const za = dot(sub(a, c.pos), c.F), zb = dot(sub(b, c.pos), c.F);
  if (za < near && zb < near) return null;
  let A = a, B = b;
  if (za < near) A = mix3(a, b, (near - za) / (zb - za));
  else if (zb < near) B = mix3(b, a, (near - zb) / (za - zb));
  const p = project(c, A), q = project(c, B);
  return { x0: p.x, y0: p.y, z0: p.z, x1: q.x, y1: q.y, z1: q.z };
}
