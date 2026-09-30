// City plate: the camera. An orthographic axonometric: yaw psi about Z, pitch phi (0 = elevation,
// 35.26° with psi 45° = true isometric), then a 2D camera on the drawing (roll, zoom, the target
// point P placed at screen point S). Pure 2D projection: world -> screen px is affine.
import * as THREE from 'three';
import { W, H } from '../px/gl';
import { lerp } from '../px/util';
import type { V3 } from './city-geo';

export interface Cam { P: V3; sx: number; sy: number; z: number; psi: number; phi: number; roll: number }

export const mixCam = (a: Cam, b: Cam, k: number): Cam => ({
  P: [lerp(a.P[0], b.P[0], k), lerp(a.P[1], b.P[1], k), lerp(a.P[2], b.P[2], k)],
  sx: lerp(a.sx, b.sx, k), sy: lerp(a.sy, b.sy, k),
  z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)),
  psi: lerp(a.psi, b.psi, k), phi: lerp(a.phi, b.phi, k), roll: lerp(a.roll, b.roll, k),
});

/**
 * Log-zoom about a fixed point: blend a -> b so that world point F stays where it is on screen in both
 * (the reference's move grammar: the point the move is "about" does not swim).
 */
export function zoomAbout(a: Cam, b: Cam, k: number, F: V3): Cam {
  const c = mixCam(a, b, k);
  const pa = project(a, F), pb = project(b, F);
  const tx = lerp(pa.x, pb.x, k), ty = lerp(pa.y, pb.y, k);
  const pc = project(c, F);
  c.sx += tx - pc.x; c.sy += ty - pc.y;
  return c;
}

/** Affine world -> screen (px, y down) and depth (world units, larger = farther). */
export interface Xf { ax: V3; ay: V3; ad: V3; bx: number; by: number; bd: number }

export function camXf(c: Cam): Xf {
  const cp = Math.cos(c.psi), sp = Math.sin(c.psi), cf = Math.cos(c.phi), sf = Math.sin(c.phi);
  const cr = Math.cos(c.roll), sr = Math.sin(c.roll);
  // dx (screen right), oy (screen down) before roll/zoom
  const dx: V3 = [cp, -sp, 0];
  const oy: V3 = [-sp * sf, -cp * sf, -cf];
  const dd: V3 = [sp * cf, cp * cf, -sf];
  const ax: V3 = [c.z * (cr * dx[0] - sr * oy[0]), c.z * (cr * dx[1] - sr * oy[1]), c.z * (cr * dx[2] - sr * oy[2])];
  const ay: V3 = [c.z * (sr * dx[0] + cr * oy[0]), c.z * (sr * dx[1] + cr * oy[1]), c.z * (sr * dx[2] + cr * oy[2])];
  const P = c.P;
  const bx = c.sx - (ax[0] * P[0] + ax[1] * P[1] + ax[2] * P[2]);
  const by = c.sy - (ay[0] * P[0] + ay[1] * P[1] + ay[2] * P[2]);
  const bd = -(dd[0] * P[0] + dd[1] * P[1] + dd[2] * P[2]);
  return { ax, ay, ad: dd, bx, by, bd };
}

export const apply = (m: Xf, p: V3) => ({
  x: m.ax[0] * p[0] + m.ax[1] * p[1] + m.ax[2] * p[2] + m.bx,
  y: m.ay[0] * p[0] + m.ay[1] * p[1] + m.ay[2] * p[2] + m.by,
});
export const project = (c: Cam, p: V3) => apply(camXf(c), p);
/** screen delta of a world vector (no translation) */
export const applyV = (m: Xf, v: V3) => ({ x: m.ax[0] * v[0] + m.ax[1] * v[1] + m.ax[2] * v[2], y: m.ay[0] * v[0] + m.ay[1] * v[1] + m.ay[2] * v[2] });

/** depth range covered by the NDC z (world units about the target) */
const DR = 260;

/**
 * Point a three.js camera at this projection: projectionMatrix maps world straight to NDC (the
 * view matrix is identity). `bias` pulls everything toward the viewer (world units), for lines drawn
 * on the faces they belong to.
 */
export function setThreeCam(cam: THREE.Camera, m: Xf, bias = 0) {
  // ndc.x = sx / W * 2 - 1, ndc.y = 1 - sy / H * 2, ndc.z = (depth - bias) / DR
  const kx = 2 / W, ky = -2 / H, kz = 1 / DR;
  const e = cam.projectionMatrix.elements;
  // column-major
  e[0] = m.ax[0] * kx; e[4] = m.ax[1] * kx; e[8] = m.ax[2] * kx; e[12] = m.bx * kx - 1;
  e[1] = m.ay[0] * ky; e[5] = m.ay[1] * ky; e[9] = m.ay[2] * ky; e[13] = m.by * ky + 1;
  e[2] = m.ad[0] * kz; e[6] = m.ad[1] * kz; e[10] = m.ad[2] * kz; e[14] = (m.bd - bias) * kz;
  e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  cam.matrixWorld.identity();
  cam.matrixWorldInverse.identity();
}

/** Inverse of the ground plane (Z = 0) mapping: screen px -> world (X, Y). Rows: X = gA·(sx,sy,1), Y = gB·(sx,sy,1). */
export function groundInverse(m: Xf): { gA: V3; gB: V3 } {
  const a = m.ax[0], b = m.ax[1], c = m.ay[0], d = m.ay[1];
  let det = a * d - b * c;
  if (Math.abs(det) < 1e-6) det = det < 0 ? -1e-6 : 1e-6;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  // X = ia*(sx - bx) + ib*(sy - by); Y = ic*(sx - bx) + id*(sy - by)
  return { gA: [ia, ib, -(ia * m.bx + ib * m.by)], gB: [ic, id, -(ic * m.bx + id * m.by)] };
}
