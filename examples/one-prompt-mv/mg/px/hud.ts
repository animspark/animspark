// Ported from mexicat/pdoom-video (MIT, see LICENSE-pdoom-video.txt) and adapted for One Prompt.
// Global overlay: the crop-mark frame and the (normally hidden) corner P(doom) readout, plus the
// legacy plate captions. The frame only appears at the bookends: the opening's sheet (the prompt's
// canvas) and the outro's regenerate/loop — the rest of the video runs full-bleed.
import { Layer2D, W, H } from './gl';
import { rgba } from './palette';
import { F, font } from './type';
import type { Lyrics } from './lyrics';
import { clamp, ease, hash, lerp, noise1, prog, smoothstep } from './util';

export interface Caption { start: number; end: number; fig: string; text: string }

/** P(doom) steps: each sung "P(doom)" raises the estimate. */
/** One Prompt has no P(doom): the readout is off. (Kept as a stub so the HUD's shape stays the same.) */
export class PDoom {
  constructor(_ly?: Lyrics) {}
  value(_t: number) { return 0; }
  flash(_t: number) { return 0; }
}
export interface HudState {
  /** Overrides from the active scene (via post.hud etc.). */
  opacity: number;
  /** 0..1 the crop-mark frame: 1 in place, 0 flown out past the edges (see PostParams.frame). */
  frame: number;
  /** Opacity of the corner P(doom) readout (off by default: P(doom) lives inside the plates). */
  readout: number;
  /** 0..1: the plate is light (bone paper) — draw captions/crop marks in ink. */
  paper: number;
  pdoomOverride?: string; // e.g. 'NaN'
  corruption?: number; // 0..1 glitch the readout
}

export class Hud {
  layer = new Layer2D();
  private ink = false;
  constructor(public pdoom: PDoom, public captions: Caption[]) {}

  draw(t: number, st: HudState) {
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    if (st.opacity <= 0.001) return L.upload();
    c.globalAlpha = st.opacity;
    this.ink = st.paper > 0.5;
    if (st.frame > 0.001) this.cropMarks(c, st.frame);
    if (st.readout > 0.001) { c.save(); c.globalAlpha *= st.readout; this.readout(c, t, st); c.restore(); }
    this.caption(c, t);
    return L.upload();
  }

  /** Corner marks; as `k` drops they fly out along the diagonals and past the edges. */
  private cropMarks(c: CanvasRenderingContext2D, k: number) {
    const e = ease.inOutCubic(clamp(k));
    c.save();
    c.globalAlpha *= clamp(k * 3);
    c.strokeStyle = this.ink ? rgba('ink', 0.45) : rgba('bone', 0.34);
    c.lineWidth = 1.25;
    const m = lerp(-40, 36, e), l = 22;
    c.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      c.moveTo(x + sx * l, y + 0.5 * sy); c.lineTo(x, y + 0.5 * sy); c.lineTo(x, y + sy * l);
    }
    c.stroke();
    c.restore();
  }

  private readout(c: CanvasRenderingContext2D, t: number, st: HudState) {
    const v = this.pdoom.value(t);
    const fl = this.pdoom.flash(t);
    const x = 64, y = H - 66;
    c.save();
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 13);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('bone', 0.6);
    c.fillText('P(DOOM)', x, y - 44);
    c.letterSpacing = '0px';
    let s = st.pdoomOverride ?? v.toFixed(v >= 0.99 ? 3 : 2);
    if (st.corruption && st.corruption > 0) {
      const glyphs = '01#%?!Ø∞';
      s = Array.from(s).map((ch, i) => (hash(i, Math.floor(t * 20)) < st.corruption! * 0.7 ? glyphs[Math.floor(hash(i, t) * glyphs.length)] : ch)).join('');
    }
    c.font = font(F.mono(400), 40);
    c.fillStyle = fl > 0.02 ? mix('bone', 'signal', Math.min(1, fl * 1.5)) : rgba('bone', 0.92);
    c.fillText(s, x - 2, y);
    // bar with ticks
    const bw = 220, by = y + 16;
    c.fillStyle = rgba('bone', 0.18);
    c.fillRect(x, by, bw, 1);
    for (let i = 0; i <= 10; i++) c.fillRect(x + (bw * i) / 10, by - (i % 5 === 0 ? 5 : 3), 1, i % 5 === 0 ? 5 : 3);
    c.fillStyle = rgba('signal', 1);
    c.fillRect(x, by - 1, bw * clamp(v), 3);
    c.restore();
  }

  private caption(c: CanvasRenderingContext2D, t: number) {
    const cap = this.captions.find((k) => t >= k.start && t < k.end);
    if (!cap) return;
    const a = Math.min(smoothstep(cap.start, cap.start + 0.5, t), 1 - smoothstep(cap.end - 0.6, cap.end, t));
    if (a <= 0) return;
    c.save();
    c.globalAlpha *= a;
    const x = W - 64, y = H - 66;
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    c.font = font(F.serif(400, true), 26);
    c.fillStyle = this.ink ? rgba('ink', 0.9) : rgba('bone', 0.85);
    // a soft halo keeps the caption legible over busy plates
    c.shadowColor = rgba('ink', 0.85);
    c.shadowBlur = this.ink ? 0 : 10; // no halo on paper: it reads as a pale patch
    // reveal letters left-to-right quickly
    const n = Math.floor(cap.text.length * prog(t, cap.start, cap.start + 0.8));
    const shown = cap.text.slice(0, n);
    const full = c.measureText(cap.text).width;
    c.textAlign = 'left';
    c.fillText(shown, x - full, y);
    c.font = font(F.mono(500), 13);
    c.letterSpacing = '3px';
    c.fillStyle = this.ink ? rgba('blood', 1) : rgba('signal', 1);
    c.fillText(cap.fig, x - full, y - 34);
    c.restore();
  }
}

function mix(a: string, b: string, k: number) {
  const pa = rgba(a).match(/\d+/g)!.map(Number), pb = rgba(b).match(/\d+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},1)`;
}
