// Helpers for plate `hook` (hook1 / hook2): colours, heat, the odometer drum, the composite shader.
import { HEX } from '../px/palette';
import { clamp, lerp, smoothstep } from '../px/util';

export type Col = keyof typeof HEX;
export type RGB = [number, number, number];

export function hexRGB(k: Col | string): RGB {
  const hex = (HEX as Record<string, string>)[k] ?? k;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lin(k: Col): RGB {
  return hexRGB(k).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }) as RGB;
}
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const mix3 = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
export function mixCss(a: Col, b: Col, k: number, alpha = 1) { return css(mix3(hexRGB(a), hexRGB(b), clamp(k)), alpha); }

const WHITE_HOT: RGB = [255, 238, 214];
/**
 * Fresh type on ink: white-hot core → ember → signal, cooled to bone in ~0.3 s.
 * On the signal field (hook 2) the same strike is a bone flash that cools to ink (soot on the orange).
 */
export function heatCss(age: number, field: 'ink' | 'signal', a = 1): string {
  if (age < 0) return css(hexRGB(field === 'ink' ? 'bone' : 'ink'), a);
  if (field === 'ink') {
    const s = 1 - smoothstep(0.05, 0.32, age); // signal wake
    const e = Math.exp(-age / 0.045); // white-hot tip
    let c = mix3(hexRGB('bone'), hexRGB('signal'), s);
    c = mix3(c, hexRGB('ember'), e * 0.7);
    c = mix3(c, WHITE_HOT, e * e * 0.6);
    return css(c, a);
  }
  const k = 1 - smoothstep(0.02, 0.22, age);
  return css(mix3(hexRGB('ink'), mix3(hexRGB('bone'), WHITE_HOT, 0.4), k * 0.92), a);
}
/** Hairlines and marks by age: born signal, cooling to `base` at alpha `a`. */
export function hairCss(age: number, base: Col, a: number, field: 'ink' | 'signal') {
  if (field === 'signal') return css(hexRGB(base), a);
  const k = age < 0 ? 0 : Math.exp(-age / 0.22);
  return css(mix3(hexRGB(base), hexRGB('signal'), k), Math.min(1, a + 0.6 * k));
}

/**
 * Odometer drum position (0..10) for the digit 10^k of a continuous count N, with true carry:
 * a drum only turns while every lower drum is rolling from 9 to 0.
 * The units drum has a detent: it rests on round(N) and rolls through the last 12 % either side.
 */
export function drum(N: number, k: number) {
  const p = Math.pow(10, k);
  if (k === 0) {
    const r = Math.round(N), f = N - r;
    return (((r + Math.sign(f) * 0.5 * smoothstep(0.38, 0.5, Math.abs(f))) % 10) + 10) % 10;
  }
  const q = Math.floor(N / p);
  const rem = N - q * p;
  const carry = clamp(rem - (p - 0.5), 0, 1);
  return ((q % 10) + carry + 10) % 10;
}

/** Composite of the type layer over the field: signal-coloured pixels run hot (the only glow). */
export const COMP = /* glsl */ `
uniform sampler2D tex; uniform vec3 bgCol; uniform float hot, gain;
void main() {
  vec4 s = texture(tex, vUv);
  float h = smoothstep(0.25, 0.7, s.r - s.g * 1.3);
  vec3 col = mix(bgCol, s.rgb * (1.0 + hot * h) * mix(1.0, gain, h), s.a);
  fragColor = vec4(col, 1.0);
}`;

/** Deadpan dictionary entries, typed under each slam (mono voice: typewriter quotes). */
export const DEFS: Record<number, string[]> = {
  1: [
    'ONE  adj. — a single, whole, undivided (1)',
    'PROMPT  n. — one line of text',
    'ONE  adj. — the same one as before',
    'FILM  n. — 24 frames a second, forever',
  ],
  2: [
    'ONE  adj. — take 2 · louder',
    'PROMPT  n. — one line of text, shouted',
    'ONE  adj. — still just the one',
    'FILM  n. — 2,160 frames. all of them',
  ],
};
