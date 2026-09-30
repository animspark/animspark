// Helpers for plate `mix` ("Make it bigger, make it loud"): world layout of the desk, colours and heat,
// the song's levels (VU ballistics, peak meters), meter scales, timecode, and the composite shader.
import type { AudioData } from '../px/audio';
import { HEX } from '../px/palette';
import { clamp, lerp, smoothstep, frameIdx } from '../px/util';
import { RAILS_H12 } from './handoff';

export type Col = keyof typeof HEX;
export type RGB = [number, number, number];

// ------------------------------------------------------------------ world layout (desk px, y down)
/** A: the meter bridge. The big VU's needle pivot is the world origin (DOT_H11 at the first frame). */
export const VU_A = { x: 0, y: 0, R: 420, s: 1 };
/** B: channel 07's strip (the fader and its signal window), below the bridge. */
export const B = { cx: 0, cy: 1000, box: { x0: -790, y0: 610, x1: 790, y1: 1400 }, winL: -600, winR: 730, winB: 1160, faderX: -700, faderY0: 850, faderY1: 1350 };
/** C: the master section: the 2-bus scope whose 0 dBFS lines are the rails (RAILS_H12 at the cut). */
export const C = { cx: 2600, cy: 1000, railH: (RAILS_H12.y2 - RAILS_H12.y1) / 2, x0: 1800, x1: 3400,
  /** the camera's y at the cut (z = 1): puts the rails exactly on RAILS_H12 */
  camY: 1000 + 540 - (RAILS_H12.y1 + RAILS_H12.y2) / 2 };

// ------------------------------------------------------------------ colour
export function hexRGB(k: Col | string): RGB {
  const hex = (HEX as Record<string, string>)[k] ?? k;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a)})`;
export const mix3 = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
export const mixCss = (a: Col, b: Col, k: number, alpha = 1) => css(mix3(hexRGB(a), hexRGB(b), clamp(k)), alpha);
const WHITE_HOT: RGB = [255, 240, 220];

/** Fresh type / marks on ink: white-hot tip → ember → signal wake → `base` in ~0.3 s. */
export function heatCss(age: number, a = 1, base: Col = 'bone'): string {
  if (age < 0) return css(hexRGB(base), a);
  const s = 1 - smoothstep(0.05, 0.32, age);
  const e = Math.exp(-age / 0.045);
  let c = mix3(hexRGB(base), hexRGB('signal'), s);
  c = mix3(c, hexRGB('ember'), e * 0.7);
  c = mix3(c, WHITE_HOT, e * e * 0.6);
  return css(c, a);
}
/** A re-strike on type that is already sung: a short partial flash toward signal, back to bone. */
export function flashCss(age: number, amp: number, a = 1): string {
  const k = age < 0 ? 0 : amp * (1 - smoothstep(0.02, 0.2, age));
  return css(mix3(hexRGB('bone'), mix3(hexRGB('signal'), hexRGB('ember'), Math.exp(-age / 0.04)), k), a);
}
/** Fresh type on the lit (bone) meter face: a signal strike that cools to ink. */
export function heatFaceCss(age: number, a = 1): string {
  if (age < 0) return css(hexRGB('ink'), a);
  const s = 1 - smoothstep(0.06, 0.34, age);
  return css(mix3(hexRGB('ink'), hexRGB('signal'), s), a);
}
/** Linear-RGB heat for the additive glow batch: 1 = white-hot, ~0.5 signal, 0 = nothing. */
export function heatLin(age: number, k = 1): RGB {
  if (age < 0) return [0, 0, 0];
  const tip = Math.exp(-age / 0.05), wake = Math.exp(-age / 0.32);
  return [(1.0 * wake * 1.6 + 1.6 * tip) * k, (0.1 * wake * 1.6 + 1.2 * tip) * k, (0.01 * wake * 1.6 + 0.8 * tip) * k];
}

// ------------------------------------------------------------------ levels (pure functions of t)
export const db = (x: number) => 20 * Math.log10(Math.max(1e-5, x));
/** VU ballistics: the rms envelope integrated over the last 0.3 s (fast enough to dance). */
export function vuLevel(au: AudioData, t: number, band = 'rms') {
  let s = 0, w = 0;
  for (let k = 0; k < 24; k++) { const q = Math.exp(-k * 0.0125 / 0.075); s += au.env(band, t - k * 0.0125) * q; w += q; }
  return s / w;
}
/** Peak meter: instant attack, exponential release. */
export function peakLevel(au: AudioData, t: number, band = 'rms', rel = 0.13) {
  let m = 0;
  for (let k = 0; k < 22; k++) m = Math.max(m, au.env(band, t - k * 0.01) * Math.exp(-(k * 0.01) / rel));
  return m;
}
/** VU scale position (0 at −20 VU, 1 at +3 VU; linear in voltage like the real movement). */
export const vuPos = (dB: number) => (Math.pow(10, dB / 20) - 0.1) / (Math.pow(10, 3 / 20) - 0.1);
/** Peak-meter (dBFS) → ladder fraction 0..1. */
const LAD: [number, number][] = [[-60, 0], [-40, 0.18], [-30, 0.3], [-20, 0.46], [-12, 0.62], [-6, 0.78], [-3, 0.88], [0, 1]];
export function ladderFrac(dB: number) {
  if (dB <= LAD[0]![0]) return 0;
  for (let i = 1; i < LAD.length; i++) if (dB <= LAD[i]![0]) { const [a, fa] = LAD[i - 1]!, [b, fb] = LAD[i]!; return lerp(fa, fb, (dB - a) / (b - a)); }
  return 1 + (dB / 30);
}
export const LADDER_MARKS = [0, -3, -6, -12, -20, -30, -40, -60];
/** Fader scale: dB → fraction of travel from the top. */
const FAD: [number, number][] = [[10, 0], [5, 0.1], [0, 0.22], [-5, 0.34], [-10, 0.46], [-20, 0.62], [-30, 0.74], [-40, 0.84], [-60, 0.94], [-90, 1]];
export function faderFrac(dB: number) {
  if (dB >= 10) return 0;
  for (let i = 1; i < FAD.length; i++) if (dB >= FAD[i]![0]) { const [a, fa] = FAD[i - 1]!, [b, fb] = FAD[i]!; return lerp(fa, fb, (dB - a) / (b - a)); }
  return 1;
}
export const FADER_MARKS: [number, string][] = [[10, '+10'], [5, '+5'], [0, 'U'], [-5, '5'], [-10, '10'], [-20, '20'], [-30, '30'], [-40, '40'], [-60, '60'], [-90, '∞']];

// ------------------------------------------------------------------ text
/** SMPTE timecode of song time at 24 fps (the film's own rate). */
export function tc24(t: number) {
  const f = Math.floor(frameIdx(t) / 2.5); // 60 fps output frames → 24 fps film frames
  const s = Math.floor(f / 24), fr = f % 24;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(fr)}`;
}
export const grp = (n: number) => n.toLocaleString('en-US');
export const sgn = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(d)}`;

// ------------------------------------------------------------------ composite
/**
 * The desk: brushed ink metal in world space (lit by `lamp`) under the Canvas2D layer.
 * Signal-coloured pixels of the layer run hot (the only glow).
 */
export const COMP = /* glsl */ `
uniform sampler2D tex; uniform vec2 cam; uniform float zoom, lamp, hot;
void main() {
  vec2 sp = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  vec2 w = cam + (sp - vec2(960.0, 540.0)) / zoom;
  // brushed metal: fine horizontal grain, a few seams of heavier brushing
  float n = snoise(vec2(w.x * 0.0016, w.y * 0.06));
  float g = hatch(w.y / 2.6 + 0.9 * n, 0.16 + 0.1 * snoise(vec2(w.x * 0.004, w.y * 0.01)));
  vec3 bg = C_INK + (C_INK2 - C_INK) * (0.55 + 0.45 * n) * lamp + C_GRAPHITE * 0.035 * g * lamp;
  vec4 s = texture(tex, vUv);
  float h = smoothstep(0.25, 0.7, s.r - s.g * 1.3);
  vec3 col = mix(bg, s.rgb * (1.0 + hot * h), s.a);
  fragColor = vec4(col, 1.0);
}`;
