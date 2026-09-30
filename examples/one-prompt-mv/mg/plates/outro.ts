// Plate `outro` — "All it took was one line". CUT.outro → the end of the song, looping into frame 0.
// From H18 (one bone hairline at y 540, the spark resting at x 1500) the spark is a caret at the end of
// a line of text: "All it took was one line" rises out of the line word by word as it is sung (kerned,
// hot → bone), starting where the prompt once typed (x 316). When "line" is done the spark runs back
// along the line like a backspace: each glyph it passes is swallowed by the line with a flash, the line
// glows in its wake, and the line is all that's left. On the downbeat the spark parks where the mark
// will stand (MARK_C), the line retracts into it and the spark cools into the caret block. Then the rewind: every
// plate of the film flashes past as a hairline icon, from 16 PREMIERE back to 01 LEADER, faster and
// faster, each collapsing into the caret, while FRAMES counts down to 0 and a new prompt is typed and
// deleted; the last (the leader's countdown ring) brakes, and the caret dims to exactly the film's first
// frame (the leader at t = 0: black, the caret at CARET_H1, 32 %, EDGE_POST): the end loops into the start.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { Layer2D, W, clearRT } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, layout, measure } from '../px/type';
import { clamp, ease, lerp, prog, pulse, hash, frameIdx } from '../px/util';
import { wStart, wEnd } from './lyric';
import { CUT, CARET_H1, MARK_C, frames } from './handoff';
import { drawCaretH1, EDGE_POST } from './leader-kit';
import { buildIcons, type Icon } from './outro-icons';
import {
  sc, hotType, heatCol, grp, drawLine, drawSpark, sparkPlan, backX, POST_H18, toPost, LINE_Y, LINE_W, LINE_C, WHITE, mixCss, type SparkPlan,
} from './premiere-kit';

const W0 = 113; // "All"
const TEXT = 'All it took was one line';
const TX0 = 316; // where the prompt typed (leader/prompt), right of the caret
/** rewind slots (s), from 16 PREMIERE back to 01 LEADER: accelerating, then braking on the leader */
const SLOTS = [0.075, 0.06, 0.05, 0.042, 0.036, 0.032, 0.03, 0.028, 0.028, 0.03, 0.033, 0.038, 0.045, 0.055, 0.07, 0.16];

interface G { ch: string; x: number; w: number; word: number; j: number; tDel: number }

export default class Outro extends Scene {
  lines = new LineBatch(20000, { blend: 'add' });
  hot = new LineBatch(4000, { blend: 'max' });
  txt = new Layer2D();
  sp!: SparkPlan;
  T0 = 0; END = 0;
  fam = F.archivo(87.5, 900);
  S = 120; cap = 86; base = LINE_Y - 20;
  glyphs: G[] = [];
  icons: Icon[] = [];
  M0 = 0; slot0: number[] = [];
  R0 = 0; DIM0 = 0; DIM1 = 0;
  kicks: [number, number][] = [];

  override async init() {
    this.T0 = CUT.outro; this.END = this.ctx.end;
    this.sp = sparkPlan();
    this.kicks = this.ctx.audio.events('kick', this.T0, this.END);
    // the line of text, fitted between the prompt's x and the resting spark
    this.S = Math.min(150, (150 * (1456 - TX0)) / measure(TEXT, this.fam, 150));
    const mc = document.createElement('canvas').getContext('2d')!;
    mc.font = font(this.fam, this.S);
    this.cap = mc.measureText('H').actualBoundingBoxAscent || this.S * 0.72;
    const lay = layout(TEXT, this.fam, this.S);
    let word = 0, j = 0;
    for (const g of lay.glyphs) {
      if (g.ch === ' ') { word++; j = 0; continue; }
      this.glyphs.push({ ch: g.ch, x: TX0 + g.x, w: g.w, word: W0 + word, j: j++, tDel: 1e9 });
    }
    // when the backspacing spark reaches each glyph's right edge
    const sp = this.sp;
    for (const g of this.glyphs) {
      for (let k = 0; k <= 600; k++) {
        const tt = lerp(sp.back0, sp.parkT, k / 600);
        if (backX(sp, tt) <= g.x + g.w * 0.85) { g.tDel = tt; break; }
      }
    }
    this.R0 = sp.parkT;
    for (const g of this.glyphs) {
      if (g.tDel < 1e9) continue;
      for (let k = 0; k <= 300; k++) {
        const tt = this.R0 + (0.28 * k) / 300;
        if (lerp(-24, MARK_C.x, ease.outExpo(prog(tt, this.R0, this.R0 + 0.28))) >= g.x + g.w * 0.15) { g.tDel = tt; break; }
      }
    }
    this.icons = buildIcons();
    // the rewind starts once the caret has formed
    this.M0 = this.R0 + 0.27;
    let acc = this.M0;
    for (const d of SLOTS) { this.slot0.push(acc); acc += d; }
    this.slot0.push(acc);
    this.DIM0 = acc; this.DIM1 = Math.min(this.END - 0.15, acc + 0.14);
  }

  /** x of the spark (or null before it runs back): the time it passed x */
  passTime(x: number) {
    const sp = this.sp;
    if (x > backX(sp, sp.back0)) return -1;
    let lo = sp.back0, hi = sp.parkT;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (backX(sp, m) > x) lo = m; else hi = m; }
    return hi;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, sp = this.sp;
    clearRT(renderer, out, LIN.ink);

    // ---- the line
    const lb = this.lines; lb.clear();
    const hb = this.hot; hb.clear();
    const retract = ease.outExpo(prog(t, this.R0, this.R0 + 0.28));
    if (t < sp.back0) drawLine(lb);
    else if (t < this.R0) {
      // the wake: heat by age where the spark has passed, drawn as pieces (max blend: no bright joints)
      const n = 96;
      for (let i = 0; i < n; i++) {
        const x0 = -24 + ((W + 48) * i) / n, x1 = -24 + ((W + 48) * (i + 1)) / n;
        const tp = this.passTime((x0 + x1) / 2);
        const c = tp < 0 || tp > t ? LINE_C : heatCol(t - tp, LINE_C, 0.8);
        hb.seg2(x0, LINE_Y, x1, LINE_Y, LINE_W * (tp > 0 && tp <= t ? 1 + 0.8 * Math.exp(-(t - tp) / 0.06) : 1), c, 1);
      }
    } else if (retract < 1) {
      const x0 = lerp(-24, MARK_C.x, retract), x1 = lerp(W + 24, MARK_C.x, retract);
      hb.seg2(x0, LINE_Y, x1, LINE_Y, LINE_W * (1 + 0.6 * (1 - retract)), heatCol(t - this.R0, LINE_C, 0.9), 1);
    }
    // the glyphs' last flash as the line swallows them
    for (const g of this.glyphs) {
      const a = t - g.tDel;
      if (a < 0 || a > 0.18) continue;
      const k = 1 - a / 0.18;
      hb.seg2(g.x, LINE_Y, g.x + g.w, LINE_Y, 3 * k + LINE_W, sc(LIN.ember, 2.4 * k), 1);
    }
    // the spark: bigger on the sung words and the kicks; out once it is the caret
    const wp = [0, 1, 2, 3, 4, 5].reduce((s, i) => s + pulse(t, wStart(W0 + i), 0.08), 0);
    const kp = this.kicks.reduce((s, [tk, st]) => s + st * pulse(t, tk, 0.06), 0);
    const sI = 1 - prog(t, this.R0 + 0.08, this.R0 + 0.26);
    drawSpark(lb, sp, t, sI, this.R0 + 0.22, 1 + 0.5 * Math.min(1.2, wp) + 0.25 * Math.min(1, kp));
    // the rewind montage
    this.drawMontage(lb, t);
    lb.render(renderer, out);
    hb.render(renderer, out);

    // ---- type
    const L = this.txt; L.clear();
    const c = L.ctx;
    this.drawWords(c, t);
    this.drawNotes(c, t);
    this.drawCaret(c, t);
    comp.draw(renderer, L.upload(), out);

    return this.post(t, wp);
  }

  drawWords(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.beginPath(); c.rect(0, 0, W, LINE_Y - 1); c.clip();
    c.font = font(this.fam, this.S);
    c.textBaseline = 'alphabetic';
    const drop = this.cap + 30;
    for (const g of this.glyphs) {
      const ws = wStart(g.word);
      const t0 = ws + g.j * 0.014;
      if (t < t0) continue;
      const rise = ease.outExpo(prog(t, t0, t0 + 0.13));
      const sink = ease.inCubic(prog(t, g.tDel, g.tDel + 0.1));
      if (sink >= 1) continue;
      const y = this.base + (1 - rise) * drop + sink * drop;
      c.fillStyle = t >= g.tDel ? mixCss('ember', 'signal', prog(t, g.tDel, g.tDel + 0.08)) : hotType(t - ws);
      c.fillText(g.ch, g.x, y);
    }
    c.restore();
  }

  drawNotes(c: CanvasRenderingContext2D, t: number) {
    const sp = this.sp;
    const mono = (s: string, x: number, y: number, px: number, col: string, ls = 2, w = 500) => {
      c.font = font(F.mono(w), px); c.letterSpacing = `${ls}px`; c.fillStyle = col; c.fillText(s, x, y); c.letterSpacing = '0px';
    };
    // typed, then backspaced by the spark (or at a given time)
    const typed = (s: string, t0: number, del: number, cps = 70, dps = 120) => {
      const n = Math.floor(clamp((t - t0) * cps, 0, s.length));
      const d = Math.floor(clamp((t - del) * dps, 0, s.length));
      return s.slice(0, Math.max(0, n - d));
    };
    // under the line: the counter's final value, deadpan
    {
      const s = `1 LINE · 1,920 PX · FRAMES ∞`;
      const x = TX0, y = LINE_Y + 40;
      const del = this.passTime(x + 420);
      mono(typed(s, wStart(W0) + 0.1, del > 0 ? del : 1e9), x, y, 15, rgba('ash', 0.9));
      const s2 = '¹ see frame 0';
      mono(typed(s2, wStart(W0 + 4), this.passTime(TX0 + 830) > 0 ? this.passTime(TX0 + 830) : 1e9), TX0 + 700, y, 15, rgba('signal', 0.9));
    }
    // a new prompt, typed at the caret and deleted before the loop
    {
      const s = 'PROMPT 02 · ›';
      mono(typed(s, this.R0 + 0.12, this.DIM0 - 0.2, 60, 110), MARK_C.x - 7, LINE_Y - 58, 15, rgba('ash', 0.9));
    }
    // the rewind: plate numbers counting down and FRAMES spinning back to zero
    if (t >= this.M0 && t < this.DIM0 + 0.02) {
      const k = this.slotAt(t);
      const ic = this.icons[this.icons.length - 1 - k.i]!;
      mono(`${String(ic.no).padStart(2, '0')}  ${ic.id}`, CARET_H1.x - 7, LINE_Y + 64, 14, rgba('bone', 0.85), 3);
      const U = (k.i + k.u) / SLOTS.length;
      const n = Math.round(frames(this.END) * Math.pow(1 - U, 1.5));
      mono(n > 0 ? `FRAMES ${grp(n)}` : 'TOKENS 0', CARET_H1.x - 7, LINE_Y + 88, 14, rgba('signal', 0.95), 3);
      mono('END OF REEL · REWINDING · 1 PROMPT · 16 PLATES', 96, 1012, 13, rgba('ash', 0.7), 2);
    }
  }

  slotAt(t: number) {
    let i = 0;
    while (i + 1 < SLOTS.length && this.slot0[i + 1]! <= t) i++;
    const u = clamp((t - this.slot0[i]!) / SLOTS[i]!);
    return { i, u };
  }

  /** Each plate's icon appears hot at the centre and collapses into the caret within its slot. */
  drawMontage(lb: LineBatch, t: number) {
    if (t < this.M0 || t >= this.DIM0) return;
    const { i, u } = this.slotAt(t);
    const ic = this.icons[this.icons.length - 1 - i]!;
    const last = i === SLOTS.length - 1;
    const e = last ? ease.inOutCubic(u) : ease.inQuad(u);
    const R = 330 * (1 - e) + 2;
    const cx = lerp(960, CARET_H1.x, e), cy = LINE_Y;
    const age = t - this.slot0[i]!;
    const col = heatCol(age, sc(LIN.bone, 0.8), 0.9);
    const jit = last ? 0 : (hash(frameIdx(t), 7) - 0.5) * 6;
    for (const p of ic.polys) {
      for (let k = 1; k < p.length; k++) {
        const a = p[k - 1]!, b = p[k]!;
        lb.seg2(cx + a.x * R + jit, cy + a.y * R, cx + b.x * R + jit, cy + b.y * R, 1.3, col, 1);
      }
    }
    // a streak toward the caret, and a pulse in it as the icon lands
    lb.seg2(cx, cy, CARET_H1.x, cy, 1, sc(LIN.signal, 0.6 * e), 0.6);
  }

  drawCaret(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.R0 + 0.06;
    if (t < t0) return;
    const grow = ease.outExpo(prog(t, t0, t0 + 0.09));
    let a = 1;
    if (t >= this.M0 && t < this.DIM0) {
      const { u } = this.slotAt(t);
      a = 0.75 + 0.25 * (u > 0.8 ? 1 : 0.4);
    }
    a = lerp(a, 0.32, prog(t, this.DIM0, this.DIM1, ease.inOutCubic));
    // the caret forms where the mark will stand (H19), not at the leader's caret
    const { w, h } = CARET_H1;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = rgba('signal', a);
    c.fillRect(MARK_C.x - w / 2, MARK_C.y - (h / 2) * grow, w, h * grow);
    void drawCaretH1;
  }

  post(t: number, wp: number): PostOverrides {
    const mont = t >= this.M0 && t < this.DIM0 ? 1 : 0;
    const o: PostOverrides = {
      ...POST_H18,
      zoom: 1 + 0.012 * Math.min(1.2, wp) * (t < this.sp.back0 ? 1 : 0),
      ca: 1.2 + 3.5 * mont + 2 * pulse(t, this.R0, 0.1),
      grain: 0.055 + 0.03 * mont,
      bloom: 0.62 + 0.15 * pulse(t, this.R0, 0.12),
      flash: 0.004 * pulse(t, this.R0, 0.03),
    };
    // at the loop point: exactly the leader's first frame
    const k = prog(t, this.DIM0, this.DIM1 - 0.02);
    const r = toPost(o, EDGE_POST as unknown as Record<string, number>, k);
    return k >= 1 ? { ...EDGE_POST, shake: [0, 0] } : r;
  }
}

void WHITE; void wEnd;
