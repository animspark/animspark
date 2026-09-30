// Plate `mix`: engraved desk instruments drawn with Canvas2D in world (desk) px: the VU movement,
// LED ladders, the RTA, knobs, buttons, screws, labels, and the breaking hairlines of a wall.
import { rgba } from '../px/palette';
import { F, font } from '../px/type';
import { clamp, ease, hash, lerp, prog, TAU } from '../px/util';
import { type Col, type RGB, css, hexRGB, mix3, vuPos, ladderFrac, LADDER_MARKS } from './mix-kit';

export interface Box { x0: number; y0: number; x1: number; y1: number }
/** Per-frame drawing context: the camera zoom (for hairlines), light, reveal, glow sink, view rect. */
export interface D2 {
  c: CanvasRenderingContext2D;
  t: number;
  z: number;
  /** desk light 0..1 (the engraving, labels, LEDs) */
  lamp: number;
  /** 0..1 reveal of the desk at a world point (the light spreading out from the meter) */
  rev: (x: number, y: number) => number;
  /** additive glow segment in world coords (width in screen px, colour linear) */
  glow: (ax: number, ay: number, bx: number, by: number, wPx: number, rgb: RGB, a?: number) => void;
  view: Box;
}

export const vis = (d: D2, x0: number, y0: number, x1: number, y1: number) => x1 >= d.view.x0 && x0 <= d.view.x1 && y1 >= d.view.y0 && y0 <= d.view.y1;
export const MONO = F.mono(500), MONO_R = F.mono(400);

/** Small mono label (the machine voice). */
export function label(d: D2, text: string, x: number, y: number, size: number, a: number, o: { align?: CanvasTextAlign; col?: Col | string; w?: string; track?: number } = {}) {
  if (a <= 0.004) return;
  const c = d.c;
  c.font = font(o.w ?? MONO, size);
  c.letterSpacing = `${o.track ?? size * 0.12}px`;
  c.textAlign = o.align ?? 'left';
  c.fillStyle = typeof o.col === 'string' && o.col.startsWith('rgb') ? o.col : rgba((o.col as Col) ?? 'bone', a);
  c.fillText(text, x, y);
  c.textAlign = 'left';
  c.letterSpacing = '0px';
}

export function screw(d: D2, x: number, y: number, r: number, a: number, seed: number) {
  if (a <= 0.004) return;
  const c = d.c, hw = 1 / d.z;
  c.lineWidth = hw;
  c.strokeStyle = rgba('ash', 0.45 * a);
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  c.strokeStyle = rgba('graphite', 0.6 * a);
  c.beginPath(); c.arc(x, y, r * 0.72, 0, TAU); c.stroke();
  const ang = hash(seed, 3) * Math.PI;
  c.strokeStyle = rgba('ash', 0.6 * a);
  c.lineWidth = Math.max(hw, r * 0.16);
  c.beginPath(); c.moveTo(x - Math.cos(ang) * r * 0.7, y - Math.sin(ang) * r * 0.7); c.lineTo(x + Math.cos(ang) * r * 0.7, y + Math.sin(ang) * r * 0.7); c.stroke();
}

/** Engraved plate: ink2 fill, a hairline border and an inner bevel hairline. */
export function plate(d: D2, b: Box, a: number, r = 10) {
  if (a <= 0.004) return;
  const c = d.c, hw = 1 / d.z;
  c.fillStyle = rgba('ink2', 0.92 * a);
  c.beginPath(); c.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, r); c.fill();
  c.lineWidth = hw;
  c.strokeStyle = rgba('ash', 0.32 * a);
  c.stroke();
  c.strokeStyle = rgba('graphite', 0.4 * a);
  c.beginPath(); c.roundRect(b.x0 + 6, b.y0 + 6, b.x1 - b.x0 - 12, b.y1 - b.y0 - 12, Math.max(1, r - 4)); c.stroke();
}

// ------------------------------------------------------------------ the VU movement
export interface VUSpec {
  x: number; y: number; s: number;
  /** needle position (0 = −20 VU, 1 = +3 VU; stops at −0.04 and 1.07) */
  pos: number;
  /** needle position history (k = 0 now, then every 20 ms back) for the tick heat */
  hist: number[];
  /** lamp behind the face 0..1 */
  face: number;
  legend?: string; title?: string; foot?: string;
  /** extra drawing on the face, under the needle (local coords, pivot origin) */
  words?: (c: CanvasRenderingContext2D) => void;
  /** 0..1: the needle pinned against the stop (heats the tip) */
  pin?: number;
  reversed?: boolean;
}
const VA = 0.82; // half sweep (rad)
export const vuAngle = (p: number) => lerp(-VA, VA, p);
const VU_MAJOR = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const VU_MINOR = [-15, -9, -8, -6, -4, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5];

export function faceRGB(k: number): RGB {
  const warm: RGB = [150, 62, 20];
  return mix3(hexRGB('ink'), mix3(warm, hexRGB('bone'), clamp((k - 0.15) / 0.85) ** 0.7), Math.min(1, k * 1.25));
}

export function drawVU(d: D2, v: VUSpec, a: number) {
  const c = d.c, s = v.s, R = 420;
  const sw = v.x - 440 * s, se = v.x + 440 * s;
  if (!vis(d, sw, v.y - 580 * s, se, v.y + 95 * s)) return;
  const hw = 1 / (d.z * s);
  c.save();
  c.translate(v.x, v.y); c.scale(s, s);
  // housing
  if (a > 0.004) {
    c.fillStyle = rgba('ink2', a);
    c.beginPath(); c.roundRect(-440, -580, 880, 672, 22); c.fill();
    c.lineWidth = hw; c.strokeStyle = rgba('ash', 0.4 * a); c.stroke();
    c.strokeStyle = rgba('graphite', 0.5 * a);
    c.beginPath(); c.roundRect(-428, -568, 856, 648, 16); c.stroke();
    for (const [sx, sy, k] of [[-414, -554, 1], [414, -554, 2], [-414, 66, 3], [414, 66, 4]] as const) screw(d, sx, sy, 9, a, k + v.x);
  }
  // the face
  const fk = v.face;
  const fr = faceRGB(fk);
  if (fk > 0.002) {
  const grd = c.createRadialGradient(0, -220, 40, 0, -220, 640);
  grd.addColorStop(0, css(fr)); grd.addColorStop(1, css(fr.map((x) => x * 0.72) as RGB));
  c.fillStyle = grd;
  c.beginPath(); c.roundRect(-400, -540, 800, 590, 12); c.fill();
  }
  c.save();
  c.beginPath(); c.roundRect(-400, -540, 800, 590, 12); c.clip();
  const ink = (al: number) => rgba('ink', al * clamp(fk * 1.4));
  const P = (r: number, p: number) => { const th = vuAngle(v.reversed ? 1 - p : p); return [Math.sin(th) * r, -Math.cos(th) * r] as const; };
  if (fk > 0.01) {
    // main arc to 0 VU (ink), the red zone to +3 (signal band)
    const p0 = vuPos(0);
    c.lineWidth = 2.2 * hw * s;
    c.strokeStyle = ink(0.9);
    c.beginPath();
    for (let i = 0; i <= 60; i++) { const [x, y] = P(R, (i / 60) * p0); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    c.lineWidth = 14;
    c.strokeStyle = rgba('signal', clamp(fk * 1.3));
    c.beginPath();
    for (let i = 0; i <= 24; i++) { const [x, y] = P(R + 8, p0 + (i / 24) * (1 - p0)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    // thin companion arcs (engraving)
    c.lineWidth = hw;
    c.strokeStyle = ink(0.45);
    for (const rr of [R + 18, R - 26]) {
      c.beginPath();
      for (let i = 0; i <= 60; i++) { const [x, y] = P(rr, i / 60); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    // ticks: majors, minors, a fine 0.1-position ruler
    c.beginPath();
    for (const m of VU_MINOR) { const p = vuPos(m); const [x0, y0] = P(R, p), [x1, y1] = P(R + 12, p); c.moveTo(x0, y0); c.lineTo(x1, y1); }
    for (let i = 0; i <= 50; i++) { const [x0, y0] = P(R - 26, i / 50), [x1, y1] = P(R - 26 - (i % 5 ? 6 : 12), i / 50); c.moveTo(x0, y0); c.lineTo(x1, y1); }
    c.lineWidth = 1.2 * hw; c.strokeStyle = ink(0.75); c.stroke();
    c.beginPath();
    for (const m of VU_MAJOR) { const p = vuPos(m); const [x0, y0] = P(R - 2, p), [x1, y1] = P(R + 24, p); c.moveTo(x0, y0); c.lineTo(x1, y1); }
    c.lineWidth = 2.4 * hw; c.strokeStyle = ink(0.95); c.stroke();
    // numerals
    c.textAlign = 'center';
    c.font = font(F.archivo(87.5, 700), 30);
    for (const m of VU_MAJOR) {
      const p = vuPos(m); const [x, y] = P(R + 50, p);
      // ticks the needle just passed run hot (heat by age from the needle's history)
      // age since the needle last crossed this tick
      let age = 9;
      for (let k = 0; k + 1 < v.hist.length; k++) if ((v.hist[k]! - p) * (v.hist[k + 1]! - p) <= 0) { age = k * 0.02; break; }
      const hot = m >= 0 ? 1 : Math.exp(-age / 0.2);
      c.fillStyle = m >= 0 ? rgba('signal', clamp(fk * 1.3)) : css(mix3(hexRGB('ink'), hexRGB('signal'), hot * 0.85), clamp(fk * 1.4));
      c.fillText(String(Math.abs(m)), x, y + 10);
    }
    c.font = font(F.archivo(100, 500), 34);
    c.fillStyle = ink(0.9);
    { const [x, y] = P(R + 52, -0.07); c.fillText('−', x, y + 10); }
    { const [x, y] = P(R + 52, 1.07); c.fillStyle = rgba('signal', clamp(fk * 1.3)); c.fillText('+', x, y + 10); }
    // % modulation scale (inside)
    c.font = font(MONO, 13);
    c.fillStyle = ink(0.6);
    for (const pc of [20, 40, 60, 80, 100]) { const p = (pc / 100 - 0.1) / (Math.pow(10, 3 / 20) - 0.1); const [x, y] = P(R - 58, p); c.fillText(String(pc), x, y + 5); }
    { const [x, y] = P(R - 58, 0.02); c.fillText('%', x, y + 5); }
    // legend and small print
    c.font = font(F.archivo(100, 500), 62);
    c.fillStyle = ink(0.88);
    c.fillText(v.legend ?? 'VU', 0, -232);
    c.font = font(MONO, 12);
    c.letterSpacing = '2px';
    c.fillStyle = ink(0.6);
    if (v.title) { c.textAlign = 'left'; c.fillText(v.title, -380, 32); }
    if (v.foot) { c.textAlign = 'right'; c.fillText(v.foot, 380, 32); }
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    // the lyric words printed on the face
    v.words?.(c);
    // needle shadow + needle
    const p = v.pos;
    const th = vuAngle(v.reversed ? 1 - p : p);
    const needle = (ox: number, oy: number, col: string) => {
      const L = 462, sn = Math.sin(th), cs = Math.cos(th);
      const nx = cs, ny = sn; // normal
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(ox + nx * 3.2, oy + ny * 3.2); c.lineTo(ox + sn * L + nx * 0.7, oy - cs * L + ny * 0.7);
      c.lineTo(ox + sn * L - nx * 0.7, oy - cs * L - ny * 0.7); c.lineTo(ox - nx * 3.2, oy - ny * 3.2);
      c.closePath(); c.fill();
    };
    needle(9, 6, ink(0.16));
    needle(0, 0, ink(1));
    if ((v.pin ?? 0) > 0.01) {
      // the pinned needle's tip heats against the stop
      const sn = Math.sin(th), cs = Math.cos(th);
      c.strokeStyle = rgba('signal', clamp(v.pin! * fk * 1.5)); c.lineWidth = 3;
      c.beginPath(); c.moveTo(sn * 360, -cs * 360); c.lineTo(sn * 462, -cs * 462); c.stroke();
      d.glow(v.x + sn * 380 * s, v.y - cs * 380 * s, v.x + sn * 462 * s, v.y - cs * 462 * s, 2.2, [1.6 * v.pin!, 0.2 * v.pin!, 0.03 * v.pin!], 1);
    }
    // the stop pins
    c.fillStyle = ink(0.85);
    for (const pp of [-0.045, 1.075]) { const [x, y] = P(R - 70, pp); c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill(); }
  }
  c.restore(); // face clip
  // pivot cover
  c.fillStyle = rgba('ink2', clamp(Math.max(a, fk * 1.5)));
  c.beginPath(); c.arc(0, 0, 60, Math.PI, TAU); c.lineTo(60, 50); c.lineTo(-60, 50); c.closePath(); c.fill();
  if (a > 0.004) {
    c.lineWidth = hw; c.strokeStyle = rgba('ash', 0.35 * a);
    c.beginPath(); c.arc(0, 0, 60, Math.PI, TAU); c.stroke();
    c.strokeStyle = rgba('graphite', 0.5 * a);
    c.beginPath(); c.arc(0, 0, 48, Math.PI, TAU); c.stroke();
  }
  c.restore();
}

// ------------------------------------------------------------------ LED ladders
type RectList = number[];
function fillRects(c: CanvasRenderingContext2D, r: RectList, style: string) {
  if (!r.length) return;
  c.fillStyle = style;
  c.beginPath();
  for (let i = 0; i < r.length; i += 4) c.rect(r[i]!, r[i + 1]!, r[i + 2]!, r[i + 3]!);
  c.fill();
}
export interface LadderSpec { x: number; yb: number; yt: number; n: number; w: number; dB: number; peakdB: number; clip: number; name?: string; marks?: boolean; marksLeft?: boolean }
/** A vertical LED ladder; `clip` = CLIP LED on (latched) 0..1. Lit ember/signal segments glow. */
export function drawLadder(d: D2, L: LadderSpec, a: number) {
  if (a <= 0.004 || !vis(d, L.x - 80, L.yt - 60, L.x + L.w + 80, L.yb + 30)) return;
  const c = d.c, n = L.n, pitch = (L.yb - L.yt) / n, h = pitch * 0.64;
  const f = ladderFrac(L.dB), pf = ladderFrac(L.peakdB);
  const off: RectList = [], bone: RectList = [], emb: RectList = [], sig: RectList = [];
  for (let i = 0; i < n; i++) {
    const fi = (i + 0.5) / n;
    const y = L.yb - (i + 1) * pitch + (pitch - h) / 2;
    const lit = fi < f || Math.abs(fi - Math.min(pf, 1 - 0.5 / n)) < 0.5 / n;
    const zone = fi > 0.88 ? 2 : fi > 0.72 ? 1 : 0;
    if (!lit) off.push(L.x, y, L.w, h);
    else if (zone === 0) bone.push(L.x, y, L.w, h);
    else {
      (zone === 1 ? emb : sig).push(L.x, y, L.w, h);
      const k = zone === 1 ? 0.9 : 1.4;
      d.glow(L.x + 2, y + h / 2, L.x + L.w - 2, y + h / 2, h * d.z * 0.8, zone === 1 ? [1.0 * k, 0.33 * k, 0.07 * k] : [1.0 * k, 0.1 * k, 0.01 * k], 0.5 * a);
    }
  }
  fillRects(c, off, rgba('graphite', 0.2 * a));
  fillRects(c, bone, rgba('bone', 0.82 * a));
  fillRects(c, emb, rgba('ember', a));
  fillRects(c, sig, rgba('signal', a));
  // clip LED
  const cy = L.yt - pitch * 1.9;
  fillRects(c, [L.x, cy, L.w, h * 1.3], L.clip > 0.5 ? rgba('signal', a) : rgba('graphite', 0.3 * a));
  if (L.clip > 0.5) d.glow(L.x + 2, cy + h * 0.65, L.x + L.w - 2, cy + h * 0.65, h * 1.3 * d.z, [2.2, 0.22, 0.03], a);
  label(d, 'CLIP', L.x + L.w / 2, cy - 8, 10, (L.clip > 0.5 ? 0.95 : 0.45) * a, { align: 'center', col: L.clip > 0.5 ? 'signal' : 'ash' });
  if (L.name) label(d, L.name, L.x + L.w / 2, L.yb + 22, 12, 0.7 * a, { align: 'center' });
  if (L.marks) {
    c.lineWidth = 1 / d.z;
    c.strokeStyle = rgba('ash', 0.5 * a);
    c.beginPath();
    for (const m of LADDER_MARKS) {
      const y = L.yb - ladderFrac(m) * (L.yb - L.yt);
      const x = L.marksLeft ? L.x - 6 : L.x + L.w + 6;
      c.moveTo(x, y); c.lineTo(x + (L.marksLeft ? -8 : 8), y);
    }
    c.stroke();
    for (const m of LADDER_MARKS) {
      const y = L.yb - ladderFrac(m) * (L.yb - L.yt);
      label(d, m === 0 ? '0' : `${m}`.replace('-', '−'), L.marksLeft ? L.x - 18 : L.x + L.w + 18, y + 4, 11, 0.6 * a, { align: L.marksLeft ? 'right' : 'left', track: 0.5 });
    }
  }
}

/** A horizontal LED bar (the channel's own meter): `f` 0..1 lit from the left. */
export function ledBar(d: D2, x0: number, x1: number, y: number, h: number, n: number, f: number, a: number) {
  if (a <= 0.004 || !vis(d, x0, y - h, x1, y + h)) return;
  const pitch = (x1 - x0) / n, w = pitch * 0.66;
  const off: RectList = [], bone: RectList = [], emb: RectList = [], sig: RectList = [];
  for (let i = 0; i < n; i++) {
    const fi = (i + 0.5) / n, x = x0 + i * pitch;
    const zone = fi > 0.9 ? 2 : fi > 0.75 ? 1 : 0;
    if (fi >= f) off.push(x, y, w, h);
    else (zone === 0 ? bone : zone === 1 ? emb : sig).push(x, y, w, h);
    if (fi < f && zone > 0) d.glow(x + w / 2, y + 1, x + w / 2, y + h - 1, w * d.z * 0.8, zone === 1 ? [0.9, 0.3, 0.06] : [1.4, 0.14, 0.02], 0.5 * a);
  }
  const c = d.c;
  fillRects(c, off, rgba('graphite', 0.22 * a));
  fillRects(c, bone, rgba('bone', 0.8 * a));
  fillRects(c, emb, rgba('ember', a));
  fillRects(c, sig, rgba('signal', a));
}

/** Real-time analyser: 48 mel bands as segment columns, with peak dots. */
export function drawRTA(d: D2, b: Box, bands: number[], peaks: number[], gain: number, a: number) {
  if (a <= 0.004 || !vis(d, b.x0 - 40, b.y0 - 40, b.x1 + 40, b.y1 + 40)) return;
  const c = d.c, n = bands.length, pitch = (b.x1 - b.x0) / n, cw = pitch * 0.7;
  const segs = 36, sp = (b.y1 - b.y0) / segs, sh = sp * 0.55;
  const off: RectList = [], lit: RectList = [], hot: RectList = [];
  for (let k = 0; k < n; k++) {
    const v = clamp(bands[k]! * gain), m = Math.floor(v * segs);
    const pk = Math.min(segs - 1, Math.floor(clamp(peaks[k]! * gain) * segs));
    const x = b.x0 + k * pitch;
    for (let j = 0; j < segs; j++) {
      const y = b.y1 - (j + 1) * sp;
      if (j < m) (j > segs * 0.86 ? hot : lit).push(x, y, cw, sh);
      else if (j === pk) hot.push(x, y, cw, sh);
      else if (j % 2 === 0) off.push(x, y, cw, sh);
    }
  }
  fillRects(c, off, rgba('graphite', 0.14 * a));
  fillRects(c, lit, rgba('bone', 0.7 * a));
  fillRects(c, hot, rgba('ember', a));
  // frame + frequency axis
  c.lineWidth = 1 / d.z; c.strokeStyle = rgba('ash', 0.35 * a);
  c.strokeRect(b.x0 - 10, b.y0 - 10, b.x1 - b.x0 + 20, b.y1 - b.y0 + 20);
  const fq = ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  fq.forEach((s, i) => label(d, s, lerp(b.x0, b.x1, (i + 0.5) / fq.length), b.y1 + 28, 11, 0.55 * a, { align: 'center', track: 0.5 }));
  label(d, 'RTA · 48 MEL BANDS · LEAD VOX', b.x0 - 10, b.y0 - 24, 12, 0.7 * a);
}

/** A knob: knurled rim, 270° scale, pointer, label. */
export function knob(d: D2, x: number, y: number, r: number, val: number, name: string, a: number, hot = 0) {
  if (a <= 0.004 || !vis(d, x - r - 20, y - r - 20, x + r + 20, y + r + 40)) return;
  const c = d.c, hw = 1 / d.z;
  c.fillStyle = rgba('ink', 0.9 * a);
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.lineWidth = hw; c.strokeStyle = rgba('ash', 0.55 * a); c.stroke();
  c.beginPath();
  for (let i = 0; i < 28; i++) { const q = (i / 28) * TAU; c.moveTo(x + Math.cos(q) * r * 0.8, y + Math.sin(q) * r * 0.8); c.lineTo(x + Math.cos(q) * r * 0.96, y + Math.sin(q) * r * 0.96); }
  for (let i = 0; i <= 10; i++) { const q = -Math.PI / 2 + lerp(-2.36, 2.36, i / 10); const l = i % 5 ? 6 : 11; c.moveTo(x + Math.cos(q) * (r + 5), y + Math.sin(q) * (r + 5)); c.lineTo(x + Math.cos(q) * (r + 5 + l), y + Math.sin(q) * (r + 5 + l)); }
  c.strokeStyle = rgba('graphite', 0.8 * a); c.stroke();
  const q = -Math.PI / 2 + lerp(-2.36, 2.36, clamp(val));
  c.strokeStyle = hot > 0.02 ? css(mix3(hexRGB('bone'), hexRGB('signal'), clamp(hot)), a) : rgba('bone', 0.9 * a);
  c.lineWidth = Math.max(hw, 2.4);
  c.beginPath(); c.moveTo(x + Math.cos(q) * r * 0.18, y + Math.sin(q) * r * 0.18); c.lineTo(x + Math.cos(q) * r * 0.86, y + Math.sin(q) * r * 0.86); c.stroke();
  label(d, name, x, y + r + 30, 11, 0.6 * a, { align: 'center' });
}

export function button(d: D2, x: number, y: number, w: number, h: number, name: string, a: number, lit: Col | null = null) {
  if (a <= 0.004 || !vis(d, x, y, x + w, y + h)) return;
  const c = d.c;
  c.fillStyle = lit ? rgba(lit, a) : rgba('ink', 0.8 * a);
  c.beginPath(); c.roundRect(x, y, w, h, 5); c.fill();
  c.lineWidth = 1 / d.z; c.strokeStyle = rgba('ash', 0.45 * a); c.stroke();
  label(d, name, x + w / 2, y + h / 2 + 4, 11, (lit ? 1 : 0.6) * a, { align: 'center', col: lit ? 'ink' : 'bone' });
  if (lit === 'signal') d.glow(x + 4, y + h / 2, x + w - 4, y + h / 2, h * d.z * 0.7, [0.9, 0.09, 0.01], 0.6 * a);
}

// ------------------------------------------------------------------ a wall giving way (after dense-press)
/** A loose hairline fragment flung outward (hot, then cooling). */
export function fragment(d: D2, ax: number, ay: number, bx: number, by: number, vx: number, vy: number, spin: number, dt: number, a: number) {
  if (a <= 0.004) return;
  const c = d.c;
  const mx = (ax + bx) / 2 + vx * dt, my = (ay + by) / 2 + vy * dt + 400 * dt * dt;
  const hx = (bx - ax) / 2, hy = (by - ay) / 2;
  const r = spin * dt, cs = Math.cos(r), sn = Math.sin(r);
  const qx = hx * cs - hy * sn, qy = hx * sn + hy * cs;
  c.strokeStyle = rgba('bone', a); c.lineWidth = 1.3 / d.z;
  c.beginPath(); c.moveTo(mx - qx, my - qy); c.lineTo(mx + qx, my + qy); c.stroke();
  const hot = Math.exp(-dt * 7);
  if (hot > 0.03) d.glow(mx - qx, my - qy, mx + qx, my + qy, 1.8, [1.0 * 2.2 * hot, 0.33 * 2.2 * hot, 0.07 * 2.2 * hot], 1);
}
/** A hairline edge recoiling into its corner after it snapped: the free end whips outward. */
export function recoil(d: D2, cx: number, cy: number, px: number, py: number, nx: number, ny: number, dt: number, a: number, seed: number) {
  if (a <= 0.004 || dt < 0) return;
  const c = d.c;
  const rec = ease.outCubic(prog(dt, 0, 0.26 + 0.08 * hash(seed, 1)));
  const L = 1 - rec;
  if (L <= 0.003) return;
  const ex = lerp(cx, px, L), ey = lerp(cy, py, L);
  const fl = (40 + 40 * hash(seed, 2)) * Math.sin(Math.PI * Math.min(1, dt / 0.3)) * L;
  c.strokeStyle = rgba('bone', a); c.lineWidth = 1.3 / d.z;
  c.beginPath(); c.moveTo(cx, cy); c.quadraticCurveTo((cx + ex) / 2 + nx * fl * 0.6, (cy + ey) / 2 + ny * fl * 0.6, ex + nx * fl, ey + ny * fl); c.stroke();
  const hot = Math.exp(-dt * 8);
  if (hot > 0.03) {
    const fx = ex + nx * fl, fy = ey + ny * fl;
    const dx = cx - fx, dy = cy - fy, dl = Math.hypot(dx, dy) || 1;
    d.glow(fx, fy, fx + (dx / dl) * 24, fy + (dy / dl) * 24, 2.4, [4 * hot, 1.3 * hot, 0.28 * hot], 1);
  }
}
/** The tripwire flash: a wall runs hot for an instant as it gives way. */
export function trip(d: D2, ax: number, ay: number, bx: number, by: number, dt: number, k = 1) {
  if (dt < 0 || dt > 0.25) return;
  const hot = 4 * k * Math.exp(-dt * 16);
  d.glow(ax, ay, bx, by, 2, [1.0 * hot, 0.33 * hot, 0.07 * hot], 1);
}
