// Helpers for the `zoetrope` plate: the camera (orbit / crane about the drum's axis), projection that
// matches the shader, the drum's rotation tables, and the two printed textures (the strip of 16 frames,
// and the lyric band that is redrawn every frame as the words are sung).
import * as THREE from 'three';
import { W, H } from '../px/gl';
import { F, font, layout, measure } from '../px/type';
import { clamp, lerp, TAU } from '../px/util';
import { Z } from './zoetrope-glsl';

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const nrm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const FOV = 32;
export const FOCAL0 = H / 2 / Math.tan((FOV * Math.PI) / 360);

export interface Cam { pos: V3; R: V3; U: V3; F: V3; focal: number; yaw: number }
/**
 * Orbit camera: target T, yaw psi (world angle of the camera round the axis: position x = sin, z = cos),
 * elevation el (rad), distance, roll. Right = (cos psi, 0, -sin psi) at every elevation (no gimbal at
 * the top-down start: screen-up is then the far side of the drum).
 */
export function orbitCam(T: V3, psi: number, el: number, dist: number, roll: number, focal: number): Cam {
  const d: V3 = [Math.cos(el) * Math.sin(psi), Math.sin(el), Math.cos(el) * Math.cos(psi)];
  const pos: V3 = [T[0] + d[0] * dist, T[1] + d[1] * dist, T[2] + d[2] * dist];
  const Fw: V3 = [-d[0], -d[1], -d[2]];
  const R0: V3 = [Math.cos(psi), 0, -Math.sin(psi)];
  const U0 = cross(R0, Fw);
  const c = Math.cos(roll), s = Math.sin(roll);
  const R: V3 = [R0[0] * c + U0[0] * s, R0[1] * c + U0[1] * s, R0[2] * c + U0[2] * s];
  const U: V3 = [U0[0] * c - R0[0] * s, U0[1] * c - R0[1] * s, U0[2] * c - R0[2] * s];
  return { pos, R, U, F: Fw, focal, yaw: psi };
}
/** world → canvas px (y down), z = depth along the view axis */
export function project(c: Cam, p: V3): { x: number; y: number; z: number } {
  const d = sub(p, c.pos);
  const z = dot(d, c.F);
  return { x: W / 2 + (c.focal * dot(d, c.R)) / z, y: H / 2 - (c.focal * dot(d, c.U)) / z, z };
}
/** point on the drum's outer wall at world angle psi, height y (radius r) */
export const onDrum = (psi: number, y: number, r = Z.R_OUT): V3 => [r * Math.sin(psi), y, r * Math.cos(psi)];

/** A function of time sampled on a fine grid (built once in init; everything stays a pure function of t). */
export class Table {
  constructor(public t0: number, public dt: number, public v: Float64Array) {}
  at(t: number) {
    const x = (t - this.t0) / this.dt;
    const i = clamp(Math.floor(x), 0, this.v.length - 2);
    return lerp(this.v[i]!, this.v[i + 1]!, clamp(x - i, 0, 1));
  }
  /** derivative */
  d(t: number) { return (this.at(t + this.dt) - this.at(t - this.dt)) / (2 * this.dt); }
}

// ------------------------------------------------------------------ the strip (16 frames, static)
export const STRIP_W = 4096, STRIP_H = 170;
/** The caret bouncing: height 0..1, squash sx, sy for frame j of 16 (contact at 0, apex at 8). */
export function bounce(j: number) {
  const u = (j % 16) / 16;
  const h = 1 - Math.pow(2 * u - 1, 2);
  const v = Math.abs(2 * u - 1); // speed ~ distance from apex
  let sx = 1 + 0.18 * Math.pow(v, 3), sy = 1 / sx;
  if (j % 16 === 0) { sx = 1.5; sy = 0.58; }
  else { sy = 1 + 0.32 * Math.pow(v, 4); sx = 1 / Math.sqrt(sy); }
  return { h, sx, sy };
}
export function makeStripTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = STRIP_W; cv.height = STRIP_H;
  const c = cv.getContext('2d')!;
  const fw = STRIP_W / 16;
  c.fillStyle = '#E4DCCB';
  c.fillRect(0, 0, STRIP_W, STRIP_H);
  // paper tooth
  for (let i = 0; i < 9000; i++) {
    const x = ((i * 7919) % STRIP_W) + ((i * 13) % 7) * 0.3, y = (i * 104729) % STRIP_H;
    c.fillStyle = `rgba(90,80,60,${0.03 + ((i * 31) % 10) / 400})`;
    c.fillRect(x, y, 1.2, 1.2);
  }
  const ink = '#1A1816', sig = '#FF5A1F';
  const base = STRIP_H * 0.8;
  for (let j = 0; j < 16; j++) {
    const x0 = j * fw;
    // frame rules
    c.fillStyle = ink;
    c.fillRect(x0, 0, 2, STRIP_H);
    c.fillRect(x0, 8, fw, 1.5); c.fillRect(x0, STRIP_H - 10, fw, 1.5);
    c.font = font(F.mono(500), 13);
    c.textBaseline = 'alphabetic';
    c.fillText(String(j + 1).padStart(2, '0'), x0 + 10, 26);
    c.font = font(F.mono(400), 10);
    c.fillStyle = 'rgba(26,24,22,0.75)';
    c.fillText(`t=${(j / 24).toFixed(3)}s`, x0 + fw - 76, 26);
    // the prompt line the caret bounces on
    c.fillStyle = ink;
    c.fillRect(x0 + 18, base, fw - 36, 2);
    c.font = font(F.mono(600), 20);
    c.fillText('>', x0 + 20, base - 6);
    // ghosts of the bounce (the arc it flies)
    for (let g = 1; g <= 3; g++) {
      const b = bounce(j - g * 2 + 16);
      c.fillStyle = `rgba(26,24,22,${0.16 - g * 0.04})`;
      const cx = x0 + fw * 0.56 - g * 2 * 5.5, hh = 50;
      c.fillRect(cx - 7 * b.sx, base - 2 - b.h * 88 - hh * b.sy, 14 * b.sx, hh * b.sy);
    }
    const b = bounce(j);
    const cx = x0 + fw * 0.56, w = 14 * b.sx, hh = 50 * b.sy;
    const y1 = base - 2 - b.h * 88;
    // shadow on the line, smaller the higher it flies
    c.fillStyle = 'rgba(26,24,22,0.55)';
    c.beginPath(); c.ellipse(cx, base + 5, 16 * (1 - 0.55 * b.h) + 3, 2.6, 0, 0, TAU); c.fill();
    c.fillStyle = sig;
    c.fillRect(cx - w / 2, y1 - hh, w, hh);
    // registration tick under each frame's centre (it sits under a slit on the far side)
    c.fillStyle = ink;
    c.fillRect(x0 + fw / 2 - 0.75, STRIP_H - 18, 1.5, 8);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16;
  return tex;
}

// ------------------------------------------------------------------ the lyric band (redrawn per frame)
export const LYR_W = 4096, LYR_H = 208;
export const LYR_PX_PER_RAD = LYR_W / TAU;
/** canvas y (px, down) of world height y on the band */
export const lyrY = (y: number) => (Z.TEX_Y1 - y) * LYR_PX_PER_RAD;

export interface GlyphDef { ch: string; word: number; tg: number; ws: number; wEnd: number; stretch: boolean; space: boolean }

export class LyricBand {
  canvas: HTMLCanvasElement;
  c: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  size = 0;
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = LYR_W; this.canvas.height = LYR_H;
    this.c = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.wrapS = THREE.RepeatWrapping;
    this.tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = true;
    this.tex.anisotropy = 16;
  }
}

const WIDTHS = [62, 75, 87.5, 100, 112.5, 125];
export function nearestW(w: number) {
  let b = WIDTHS[0]!;
  for (const x of WIDTHS) if (Math.abs(x - w) < Math.abs(b - w)) b = x;
  return b;
}
const kernCache = new Map<string, number>();
/** the font's kerning (px at 100 px) between glyphs a and b */
export function kern100(a: string, b: string, fam: string) {
  const key = `${fam}|${a}${b}`;
  let v = kernCache.get(key);
  if (v === undefined) {
    v = measure(a + b, fam, 100) - measure(a, fam, 100) - measure(b, fam, 100);
    kernCache.set(key, v);
  }
  return v;
}
const advCache = new Map<string, number>();
export function adv100(ch: string, fam: string) {
  const key = `${fam}|${ch}`;
  let v = advCache.get(key);
  if (v === undefined) { v = layout(ch, fam, 100).width; advCache.set(key, v); }
  return v;
}
