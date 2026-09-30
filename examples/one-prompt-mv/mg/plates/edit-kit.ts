// Helpers for plate `edit`: palette mixing and heat, camera maths, timecode, and the V1 thumbnails
// (the film's own earlier plates as line icons).
import { HEX } from '../px/palette';
import { F, font } from '../px/type';
import { clamp, lerp, smoothstep, TAU } from '../px/util';

export type Col = keyof typeof HEX;
export type RGB = [number, number, number];
type C2 = CanvasRenderingContext2D;

export function hexRGB(k: Col | string): RGB {
  const hex = (HEX as Record<string, string>)[k] ?? k;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp(a)})`;
export const mix3 = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
export const mixCss = (a: Col, b: Col, k: number, alpha = 1) => css(mix3(hexRGB(a), hexRGB(b), clamp(k)), alpha);
const WHITE_HOT: RGB = [255, 240, 222];

/** Fresh type on ink: white-hot core → ember → signal, cooled to `base` (bone) in ~0.3 s. */
export function heatCss(age: number, a = 1, base: Col = 'bone'): string {
  if (age < 0) return css(hexRGB(base), a);
  const s = 1 - smoothstep(0.06, 0.34, age);
  const e = Math.exp(-age / 0.045);
  let c = mix3(hexRGB(base), hexRGB('signal'), s);
  c = mix3(c, hexRGB('ember'), e * 0.75);
  c = mix3(c, WHITE_HOT, e * e * 0.7);
  return css(c, a);
}
/** Hairlines by age: tip exp(-age/0.05) white-hot, wake exp(-age/0.32) signal, cooling to base at alpha a. */
export function hairCss(age: number, base: Col, a: number): string {
  if (age < 0) return css(hexRGB(base), 0);
  const tip = Math.exp(-age / 0.05), wake = Math.exp(-age / 0.32);
  let c = mix3(hexRGB(base), hexRGB('signal'), wake);
  c = mix3(c, WHITE_HOT, tip * 0.8);
  return css(c, Math.min(1, a + 0.7 * wake));
}

// ------------------------------------------------------------------ camera
export interface Cam { x: number; y: number; z: number; r: number }
export type Xf = { a: number; b: number; c: number; d: number; e: number; f: number };
/** world → screen affine for a camera (centre x,y in world; zoom z; roll r). */
export function camXf(cam: Cam): Xf {
  const cs = Math.cos(cam.r) * cam.z, sn = Math.sin(cam.r) * cam.z;
  return { a: cs, b: sn, c: -sn, d: cs, e: 960 - (cs * cam.x - sn * cam.y), f: 540 - (sn * cam.x + cs * cam.y) };
}
export const apply = (m: Xf, x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
export function invXf(m: Xf): Xf {
  const det = m.a * m.d - m.b * m.c;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, e: -(ia * m.e + ic * m.f), f: -(ib * m.e + id * m.f) };
}
export const lerpCam = (p: Cam, q: Cam, k: number): Cam => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), z: Math.exp(lerp(Math.log(p.z), Math.log(q.z), k)), r: lerp(p.r, q.r, k) });
/** Zoom by n about the screen point (sx, sy): the world point under it stays put (log-zoom about a fixed point). */
export function zoomAbout(cam: Cam, sx: number, sy: number, n: number): Cam {
  const dx = sx - 960, dy = sy - 540, c = Math.cos(-cam.r), s = Math.sin(-cam.r);
  const wx = (c * dx - s * dy), wy = (s * dx + c * dy);
  const z2 = cam.z * n;
  return { x: cam.x + wx / cam.z - wx / z2, y: cam.y + wy / cam.z - wy / z2, z: z2, r: cam.r };
}

// ------------------------------------------------------------------ timecode (the in-world counter)
const p2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
/** frames (24 fps) → HH:MM:SS:FF */
export function tc(fr: number) {
  const f = Math.max(0, fr);
  return `${p2(f / 86400)}:${p2((f / 1440) % 60)}:${p2((f / 24) % 60)}:${p2(f % 24)}`;
}
export const thousands = (n: number) => Math.floor(n).toLocaleString('en-US');

// ------------------------------------------------------------------ V1: the film's own plates as line icons
export const PLATES = [
  'LEADER', 'PROMPT', 'RIDGE', 'BLUEPRINT', 'NIGHTCITY', 'PLOT', 'HOOK', 'ZOETROPE',
  'BEAM', 'MARQUEE', 'MATTE', 'MURMUR', 'MIX', 'STADIUM', 'EDIT', 'HOOK2',
] as const;

/**
 * Draw icon i centred at (0,0) in a ~112 x 78 box. `lw` = a hairline in current units, `ink` the line colour,
 * `hot` the signal accent colour (the caret of each plate).
 */
export function drawIcon(c: C2, i: number, lw: number, ink: string, hot: string, dim: string) {
  c.save();
  c.lineWidth = lw; c.strokeStyle = ink; c.fillStyle = ink; c.lineCap = 'round'; c.lineJoin = 'round';
  const ln = (pts: number[]) => { c.beginPath(); c.moveTo(pts[0]!, pts[1]!); for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k]!, pts[k + 1]!); c.stroke(); };
  switch (i) {
    case 0: { // leader: countdown ring, crosshair, the 8
      c.beginPath(); c.arc(0, 0, 32, 0, TAU); c.stroke();
      c.beginPath(); c.arc(0, 0, 25, 0, TAU); c.stroke();
      ln([-52, 0, 52, 0]); ln([0, -38, 0, 38]);
      c.strokeStyle = hot; c.lineWidth = lw * 2.2;
      c.beginPath(); c.arc(0, 0, 32, -Math.PI / 2, -Math.PI / 2 + TAU * 0.62); c.stroke();
      c.fillStyle = ink; c.font = font(F.mono(600), 26); c.textAlign = 'center'; c.fillText('8', 0, 9);
      break;
    }
    case 1: { // prompt: the field, the chevron, the caret
      c.strokeRect(-52, -14, 104, 28);
      ln([-44, -6, -38, 0, -44, 6]);
      c.fillStyle = dim; for (let k = 0; k < 6; k++) c.fillRect(-30 + k * 9, -2, 6, 4);
      c.fillStyle = hot; c.fillRect(26, -9, 5, 18);
      break;
    }
    case 2: { // ridge: a ridgeline plot of the song
      for (let r = 0; r < 6; r++) {
        const y0 = -26 + r * 11;
        c.beginPath();
        for (let x = -50; x <= 50; x += 4) {
          const bump = Math.exp(-(((x - 10 + r * 3) / 14) ** 2)) * (10 + 4 * Math.sin(r * 2.1)) + 2 * Math.sin(x * 0.7 + r);
          if (x === -50) c.moveTo(x, y0 - bump); else c.lineTo(x, y0 - bump);
        }
        c.strokeStyle = r === 5 ? hot : ink; c.stroke();
      }
      break;
    }
    case 3: { // blueprint: axonometric blocks
      const box = (x: number, y: number, w: number, h: number) => {
        const d = 10;
        ln([x, y, x + w, y, x + w, y - h, x, y - h, x, y]);
        ln([x, y - h, x + d, y - h - d * 0.6, x + w + d, y - h - d * 0.6, x + w, y - h]);
        ln([x + w + d, y - h - d * 0.6, x + w + d, y - d * 0.6, x + w, y]);
      };
      box(-46, 30, 26, 34); box(-14, 30, 22, 52); box(14, 30, 30, 24);
      ln([-54, 30, 54, 30]);
      break;
    }
    case 4: { // night city: lit windows
      const b = [[-50, 24, 22], [-24, 20, 44], [0, 18, 30], [22, 26, 52], [-50 + 104, 0, 0]] as const;
      for (const [x, w, h] of b) if (w) c.strokeRect(x, 32 - h, w - 3, h);
      for (let k = 0; k < 26; k++) {
        const bi = k % 4, bx = b[bi]![0], bw = b[bi]![1], bh = b[bi]![2];
        const col = ((k * 7) % 5), row = Math.floor(k / 4);
        const x = bx + 3 + (col % 3) * ((bw - 9) / 3), y = 32 - bh + 5 + row * 7;
        if (y > 28) continue;
        c.fillStyle = (k * 13) % 7 === 0 ? hot : dim; c.fillRect(x, y, 3, 3);
      }
      ln([-54, 32, 54, 32]);
      break;
    }
    case 5: { // lighting plot: a Fresnel and its cone
      c.strokeRect(-44, -30, 22, 16); ln([-22, -26, -16, -26]);
      c.beginPath(); c.arc(-14, -22, 6, 0, TAU); c.stroke();
      c.strokeStyle = hot; ln([-10, -24, 46, 26]); ln([-12, -18, 12, 30]);
      c.strokeStyle = dim; c.setLineDash([3, 3]); c.beginPath(); c.ellipse(29, 29, 22, 6, 0, 0, TAU); c.stroke(); c.setLineDash([]);
      break;
    }
    case 6: { // hook: the FRAMES odometer rolling to 24
      c.strokeRect(-50, -30, 100, 60);
      for (let k = 0; k < 2; k++) { c.strokeRect(-40 + k * 42, -22, 36, 44); ln([-40 + k * 42, -8, -4 + k * 42, -8]); }
      c.fillStyle = ink; c.font = font(F.mono(600), 34); c.textAlign = 'center';
      c.fillText('2', -22, 12); c.fillStyle = hot; c.fillText('4', 20, 12);
      c.fillStyle = dim; c.font = font(F.mono(400), 9); c.fillText('FRAMES', 0, 40);
      break;
    }
    case 7: { // zoetrope: a drum with slits
      c.beginPath(); c.ellipse(0, -18, 44, 11, 0, 0, TAU); c.stroke();
      c.beginPath(); c.ellipse(0, 22, 44, 11, 0, 0, Math.PI); c.stroke();
      ln([-44, -18, -44, 22]); ln([44, -18, 44, 22]);
      for (let k = 0; k < 9; k++) { const a = Math.PI * (k + 0.5) / 9, x = -Math.cos(a) * 44, y = Math.sin(a) * 11; ln([x, -12 + y, x, 12 + y]); }
      c.strokeStyle = hot; c.beginPath(); c.ellipse(0, -18, 44, 11, 0, 0, TAU); c.stroke();
      break;
    }
    case 8: { // beam: projector → cone → screen
      c.strokeRect(-52, -8, 16, 16); c.beginPath(); c.arc(-44, -14, 6, 0, TAU); c.stroke();
      c.strokeStyle = hot; ln([-36, -3, 40, -28]); ln([-36, 3, 40, 28]);
      c.strokeStyle = ink; c.strokeRect(40, -30, 12, 60);
      c.fillStyle = dim; for (let k = 0; k < 8; k++) c.fillRect(-20 + k * 7, -2 + ((k * 5) % 7) - 3, 2, 2);
      break;
    }
    case 9: { // marquee: bulbs round a board
      c.strokeRect(-50, -26, 100, 44);
      for (let k = 0; k < 22; k++) {
        const u = k / 22, per = 2 * (100 + 44), s = u * per;
        let x: number, y: number;
        if (s < 100) { x = -50 + s; y = -26; } else if (s < 144) { x = 50; y = -26 + s - 100; } else if (s < 244) { x = 50 - (s - 144); y = 18; } else { x = -50; y = 18 - (s - 244); }
        c.fillStyle = k % 3 === 0 ? hot : ink; c.beginPath(); c.arc(x, y, 2.4, 0, TAU); c.fill();
      }
      c.fillStyle = ink; c.font = font(F.archivo(75, 900), 22); c.textAlign = 'center'; c.fillText('TONIGHT', 0, 3);
      break;
    }
    case 10: { // matte: brushed sky over a roofline
      for (let k = 0; k < 5; k++) {
        c.beginPath();
        c.moveTo(-50, -28 + k * 9); c.bezierCurveTo(-20, -40 + k * 9, 10, -18 + k * 9, 50, -30 + k * 9);
        c.lineWidth = lw * (1.5 + k * 0.5); c.strokeStyle = k === 2 ? hot : ink; c.stroke();
      }
      c.lineWidth = lw; c.strokeStyle = ink; ln([-54, 26, -30, 26, -30, 16, -10, 16, -10, 26, 54, 26]);
      break;
    }
    case 11: { // murmuration: letters as birds
      for (let k = 0; k < 60; k++) {
        const a = k * 2.399, r = 6 + 28 * Math.sqrt(k / 60);
        const x = Math.cos(a) * r * 1.5, y = Math.sin(a) * r * 0.7 + Math.sin(x * 0.08) * 6;
        c.fillStyle = k === 7 ? hot : k % 3 ? ink : dim; c.fillRect(x, y, 2.2, 2.2);
      }
      break;
    }
    case 12: { // mix: faders
      for (let k = 0; k < 6; k++) {
        const x = -45 + k * 18, y = -18 + ((k * 37) % 30);
        ln([x, -32, x, 32]);
        c.fillStyle = k === 4 ? hot : ink; c.fillRect(x - 6, y - 3, 12, 6);
      }
      c.fillStyle = hot; c.fillRect(38, -36, 12, 4);
      break;
    }
    case 13: { // stadium: the bowl from above
      c.beginPath(); c.ellipse(0, 0, 52, 32, 0, 0, TAU); c.stroke();
      c.beginPath(); c.ellipse(0, 0, 42, 24, 0, 0, TAU); c.stroke();
      c.strokeRect(-26, -13, 52, 26); ln([0, -13, 0, 13]);
      c.fillStyle = hot; for (let k = 0; k < 7; k++) c.fillRect(-18 + k * 6, -30 - ((k * 3) % 5), 2, 5);
      break;
    }
    case 14: { // edit: this very timeline (the icon is recursive)
      for (let k = 0; k < 3; k++) ln([-52, -18 + k * 18, 52, -18 + k * 18]);
      c.strokeRect(-46, -15, 30, 12); c.strokeRect(-12, -15, 20, 12); c.strokeRect(12, 3, 36, 12);
      c.fillStyle = hot; c.fillRect(-4, -32, 3, 64);
      break;
    }
    default: { // hook2: solid orange, ink type
      c.fillStyle = hot; c.fillRect(-52, -32, 104, 64);
      c.fillStyle = 'rgba(10,10,11,1)'; c.font = font(F.mono(600), 26); c.textAlign = 'center'; c.fillText('2,160', 0, 9);
    }
  }
  c.restore();
}

/** Deadpan EDL notes, one per event kind. */
export const NOTES = {
  title: 'TITLE: ONE PROMPT · REEL 15 · THE EDIT',
  fcm: 'FCM: NON-DROP FRAME · SNAP ON · MERCY OFF',
};

/**
 * The shared spark particles (px/motifs sparkParticles), born and moving in WORLD space and drawn through the
 * current camera `xf`, so a page jump carries them with the timeline. Deterministic: indexed by birth time.
 */
export function worldSparks(
  lb: { seg2: (ax: number, ay: number, bx: number, by: number, w: number, rgb: [number, number, number], a?: number) => void },
  t: number, headAt: (tb: number) => { x: number; y: number } | null, xf: Xf, zoom: number,
  o: { rate: number; life: number; speed: number; gravity: number; intensity: number; seed: number; width: number; signal: RGB },
) {
  const n0 = Math.floor((t - o.life) * o.rate), n1 = Math.floor(t * o.rate);
  for (let n = n0; n <= n1; n++) {
    const tb = n / o.rate;
    if (tb > t) continue;
    const h = headAt(tb);
    if (!h) continue;
    const age = t - tb;
    const hs = (k: number) => { let x = Math.sin(n * 12.9898 + (o.seed + k) * 78.233) * 43758.5453; return x - Math.floor(x); };
    const lf = o.life * (0.35 + 0.65 * hs(2));
    if (age > lf) continue;
    const a = hs(0) * TAU, sp = o.speed * (0.25 + hs(1) ** 2 * 1.2);
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp - o.speed * 0.3;
    const at = (d: number) => apply(xf, h.x + vx * d, h.y + vy * d + 0.5 * o.gravity * d * d);
    const p = at(age), q = at(Math.max(0, age - 0.018));
    const k = 1 - age / lf, heat = k * k, I = o.intensity, S = o.signal;
    lb.seg2(q.x, q.y, p.x, p.y, o.width * (0.5 + k * 0.7) * Math.sqrt(zoom), [
      (S[0] + (1 - S[0]) * heat) * 2.2 * I, (S[1] + (0.8 - S[1]) * heat) * 2.2 * I, (S[2] + (0.5 - S[2]) * heat) * 2.2 * I,
    ], Math.min(1, k * 1.4));
  }
}
