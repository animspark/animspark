// Plate `earth`: geometry kit. Vectors, the camera model shared with the globe shader, the land field
// (JS + GLSL twins, so cities sit on land and contours match), the cities and the release network.
import { mulberry32, clamp } from '../px/util';

export type V3 = [number, number, number];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mix3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** spherical interpolation of unit vectors */
export function slerp(a: V3, b: V3, k: number): V3 {
  const c = clamp(dot(a, b), -1, 1), om = Math.acos(c);
  if (om < 1e-5) return a;
  const s = Math.sin(om);
  return add(mul(a, Math.sin((1 - k) * om) / s), mul(b, Math.sin(k * om) / s));
}
export const angle = (a: V3, b: V3) => Math.acos(clamp(dot(a, b), -1, 1));

/** 3x3 matrices, row-major: world = M · earth */
export type M3 = number[];
export const rotX = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
export function mm(A: M3, B: M3): M3 {
  const o: M3 = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3]! * B[j]! + A[i * 3 + 1]! * B[3 + j]! + A[i * 3 + 2]! * B[6 + j]!);
  return o;
}
export const mv = (M: M3, v: V3): V3 => [M[0]! * v[0] + M[1]! * v[1] + M[2]! * v[2], M[3]! * v[0] + M[4]! * v[1] + M[5]! * v[2], M[6]! * v[0] + M[7]! * v[1] + M[8]! * v[2]];
/** transpose · v (world → earth) */
export const mtv = (M: M3, v: V3): V3 => [M[0]! * v[0] + M[3]! * v[1] + M[6]! * v[2], M[1]! * v[0] + M[4]! * v[1] + M[7]! * v[2], M[2]! * v[0] + M[5]! * v[1] + M[8]! * v[2]];

export const ll2v = (lat: number, lon: number): V3 => [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
export const v2lat = (q: V3) => Math.asin(clamp(q[1], -1, 1));
export const v2lon = (q: V3) => Math.atan2(q[2], q[0]);
/** east / north unit vectors at q (earth frame) */
export function enu(q: V3): { e: V3; n: V3 } {
  let e: V3 = [-q[2], 0, q[0]];
  if (len(e) < 1e-6) e = [0, 0, 1];
  e = norm(e);
  return { e, n: cross(e, q) };
}

// ------------------------------------------------------------------ camera (shared with the shader)
export const W = 1920, H = 1080;
export interface Cam { pos: V3; F: V3; R: V3; U: V3; f: number }
/** a camera at pos looking at tgt; up hint; roll (rad, clockwise on screen); focal f (px) */
export function lookCam(pos: V3, tgt: V3, up: V3, f: number, roll = 0): Cam {
  const F = norm(sub(tgt, pos));
  let R = cross(F, up);
  if (len(R) < 1e-6) R = cross(F, [0, 0, 1]);
  R = norm(R);
  let U = cross(R, F);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const R2 = add(mul(R, c), mul(U, -s)), U2 = add(mul(R, s), mul(U, c));
    R = R2; U = U2;
  }
  return { pos, F, R, U, f };
}
export interface Proj { x: number; y: number; s: number; z: number }
/** world → screen px (y down); s = px per world unit at that depth */
export function project(c: Cam, p: V3): Proj | null {
  const d = sub(p, c.pos);
  const z = dot(d, c.F);
  if (z < 1e-3) return null;
  const k = c.f / z;
  return { x: W / 2 + dot(d, c.R) * k, y: H / 2 - dot(d, c.U) * k, s: k, z };
}
/** is world point p (|p| >= 1 - eps) hidden behind the unit sphere from the camera? */
export function occluded(c: Cam, p: V3, eps = 2e-3): boolean {
  const d = sub(p, c.pos), L = len(d);
  const r = mul(d, 1 / L);
  const b = dot(c.pos, r), cc = dot(c.pos, c.pos) - 1;
  const disc = b * b - cc;
  if (disc <= 0) return false;
  const t1 = -b - Math.sqrt(disc);
  return t1 > 0 && t1 < L - eps;
}
/** the sphere's silhouette as a screen polygon (the tangency circle, projected) */
export function silhouette(c: Cam, n = 96): { x: number; y: number }[] | null {
  const D = len(c.pos);
  if (D <= 1.0005) return null;
  const a = mul(c.pos, 1 / D);
  const ctr = mul(a, 1 / D), r = Math.sqrt(1 - 1 / (D * D));
  let e1 = cross(a, [0, 1, 0]);
  if (len(e1) < 1e-4) e1 = cross(a, [1, 0, 0]);
  e1 = norm(e1);
  const e2 = cross(a, e1);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const p = add(ctr, add(mul(e1, r * Math.cos(th)), mul(e2, r * Math.sin(th))));
    const q = project(c, p);
    if (!q) return null;
    out.push({ x: q.x, y: q.y });
  }
  return out;
}

// ------------------------------------------------------------------ the land field
/** Continents: 8 soft blobs (centre, spread) + a warped detail field. Blob 0 is placed by the plate
 *  (the continent the lyric is lit on); the rest are fixed. Height > 0 is land. */
export interface Blob { c: V3; s: number; w: number }
export const BLOBS: Blob[] = [
  { c: ll2v(0.5, 0.0), s: 0.16, w: 0.92 }, // placed at init (the night continent)
  { c: ll2v(0.78, -1.9), s: 0.1, w: 0.78 },
  { c: ll2v(-0.3, -1.05), s: 0.075, w: 0.74 },
  { c: ll2v(0.12, 0.42), s: 0.09, w: 0.7 },
  { c: ll2v(-0.52, 2.35), s: 0.05, w: 0.66 },
  { c: ll2v(0.98, 1.2), s: 0.12, w: 0.62 },
  { c: ll2v(-1.25, 0.6), s: 0.1, w: 0.58 },
  { c: ll2v(0.35, 2.9), s: 0.04, w: 0.62 },
];
const DET: { d: V3; f: number; a: number; p: number }[] = [];
{
  const rnd = mulberry32(1606);
  const fs = [4.3, 6.1, 7.7, 9.4, 11.8, 14.6, 18.2, 22.9, 29.5, 37.0];
  for (const f of fs) {
    const z = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    DET.push({ d: [r * Math.cos(th), z, r * Math.sin(th)], f, a: 0.11 * Math.pow(4.3 / f, 0.72), p: rnd() * Math.PI * 2 });
  }
}
const H_BIAS = 0.42;
function warp(q: V3): V3 {
  const w: V3 = [
    Math.sin(2.1 * q[1] + 0.7 + 1.3 * Math.sin(3.3 * q[2])),
    Math.sin(2.6 * q[2] + 1.9 + 1.1 * Math.sin(2.9 * q[0])),
    Math.sin(2.3 * q[0] + 4.1 + 1.2 * Math.sin(3.7 * q[1])),
  ];
  return norm(add(q, mul(w, 0.2)));
}
export function landH(q: V3): number {
  const qw = warp(q);
  let h = -H_BIAS;
  for (const b of BLOBS) h += b.w * Math.exp((dot(qw, b.c) - 1) / b.s);
  let d = 0;
  for (const k of DET) d += k.a * Math.sin(dot(qw, k.d) * k.f + k.p);
  return h + d;
}
const f5 = (x: number) => x.toFixed(5);
export const LAND_GLSL = /* glsl */ `
uniform vec4 uBlob[8]; // xyz centre, w spread
uniform float uBlobW[8];
vec3 warpQ(vec3 q) {
  vec3 w = vec3(sin(2.1 * q.y + 0.7 + 1.3 * sin(3.3 * q.z)), sin(2.6 * q.z + 1.9 + 1.1 * sin(2.9 * q.x)), sin(2.3 * q.x + 4.1 + 1.2 * sin(3.7 * q.y)));
  return normalize(q + w * 0.2);
}
float landH(vec3 q) {
  vec3 qw = warpQ(q);
  float h = -${f5(H_BIAS)};
  for (int i = 0; i < 8; i++) h += uBlobW[i] * exp((dot(qw, uBlob[i].xyz) - 1.0) / uBlob[i].w);
  float d = 0.0;
${DET.map((k) => `  d += ${f5(k.a)} * sin(dot(qw, vec3(${f5(k.d[0])}, ${f5(k.d[1])}, ${f5(k.d[2])})) * ${f5(k.f)} + ${f5(k.p)});`).join('\n')}
  return h + d;
}`;

// ------------------------------------------------------------------ cities
export interface City { q: V3; lat: number; lon: number; h: number; name: string }
/** cinema names for the labelled cities (every city in this world is a picture house) */
export const NAMES = ['RIALTO', 'ODEON', 'ROXY', 'PALACE', 'REGAL', 'LUX', 'MAJESTIC', 'EMPIRE', 'PLAZA', 'ORPHEUM', 'BIJOU', 'ALHAMBRA', 'CAPITOL', 'TIVOLI', 'GRAND', 'RITZ', 'COLISEUM', 'PARAMOUNT', 'STRAND', 'ASTORIA', 'GAUMONT', 'LYRIC', 'CAMEO', 'VOGUE'];
export function makeCities(n = 420, seed = 77): City[] {
  const rnd = mulberry32(seed);
  const cand: City[] = [];
  const N = 24000, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = ga * i;
    const q: V3 = [r * Math.cos(th), y, r * Math.sin(th)];
    if (Math.abs(y) > 0.93) continue;
    const h = landH(q);
    if (h < 0.015) continue;
    cand.push({ q, lat: v2lat(q), lon: v2lon(q), h, name: '' });
  }
  // shuffle, favour coasts (low land), keep a minimum separation
  const out: City[] = [];
  const order = cand.map((c) => ({ c, k: rnd() * (0.4 + Math.min(1, c.h / 0.25)) }));
  order.sort((a, b) => a.k - b.k);
  const minSep = 0.05;
  for (const { c } of order) {
    if (out.length >= n) break;
    if (out.some((o) => dot(o.q, c.q) > Math.cos(minSep))) continue;
    out.push(c);
  }
  return out;
}

export const fmtLat = (lat: number) => `${String(Math.round(Math.abs(lat) * 180 / Math.PI)).padStart(2, '0')}°${lat >= 0 ? 'N' : 'S'}`;
export const fmtLon = (lon: number) => `${String(Math.round(Math.abs(lon) * 180 / Math.PI)).padStart(3, '0')}°${lon >= 0 ? 'E' : 'W'}`;
