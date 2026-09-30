// Plate `unfold` (0 → CUT.prompt): the film's end, run backwards, then the title as a run of posters.
//   0.10  "One line"   the caret fires a spark along one bone hairline; ONE LINE rises out of the line word by
//                      word (the outro's type and motion). On the downbeat the words sink and the line
//                      retracts into the caret (the outro's retract).
//   1.12 → 2.07        the outro's rewind, exactly reversed (same slots, same easing, same speed): 01 LEADER
//                      → 16 PREMIERE, each icon out of the caret to full size; PREMIERE lands on the hit.
//   2.07 → 6.5         the title as kinetic posters, one per beat, hard cuts: ink / bone / signal fields,
//                      the type as big as the frame, slammed, slid, stacked, outlined, scrolled.
//   6.00               the poster: ONE PROMPT over a misregistered orange print, the credits set Swiss.
//   6.5 → 7.48         the poster is squashed into one hairline; on the downbeat the hairline retracts into
//                      the caret (the outro's retract again): H1, the caret steady at CARET_H1.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { Layer2D, W, H, clearRT } from '../px/gl';
import { LineBatch } from '../px/lines';
import { sparkHead, sparkParticles } from '../px/motifs';
import { LIN, rgba } from '../px/palette';
import { F, font, layout } from '../px/type';
import { clamp, ease, lerp, pulse, hash, frameIdx } from '../px/util';
import { wStart } from './lyric';
import { CUT, CARET_H1 } from './handoff';
import { drawCaretH1, hotType, EDGE_POST, toEdge } from './leader-kit';
import { buildIcons, type Icon } from './outro-icons';
import { heatCol, sc, grp, LINE_Y, LINE_W, LINE_C } from './premiere-kit';

type C2 = CanvasRenderingContext2D;
const seg = (t: number, a: number, b: number) => clamp((t - a) / Math.max(1e-6, b - a));
const T1 = wStart(0), T_LINE = wStart(1);
const B = 60 / 122, FB = 0.102;
const beat = (k: number) => FB + k * B;
const DOWN = beat(2); // 1.086
const H2 = beat(4), H4 = beat(12), COLL = beat(14); // 2.07, 6.0, 6.99
const SQUASH = beat(13); // 6.5
const T_END = CUT.prompt;
const TX0 = 316;
/** the outro's rewind slots (16 PREMIERE → 01 LEADER); reversed here */
const SLOTS = [0.075, 0.06, 0.05, 0.042, 0.036, 0.032, 0.03, 0.028, 0.028, 0.03, 0.033, 0.038, 0.045, 0.055, 0.07, 0.16];
const REV = [...SLOTS].reverse(); // slot j shows icon j (01 … 16)
const M1 = H2 - 0.02; // the reversed rewind ends (PREMIERE full) just before the hit
const M0 = M1 - REV.reduce((a, b) => a + b, 0);

const INK = (a = 1) => rgba('ink', a), BONE = (a = 1) => rgba('bone', a), SIG = (a = 1) => rgba('signal', a);

export default class Unfold extends Scene {
  lb = new LineBatch(20000, { screen2D: true, blend: 'add' });
  txt = new Layer2D();
  icons: Icon[] = [];
  fam = F.archivo(87.5, 900);
  slot0: number[] = [];

  override init() {
    this.icons = buildIcons();
    let acc = M0;
    for (const d of REV) { this.slot0.push(acc); acc += d; }
    this.slot0.push(acc);
  }
  headX(t: number) { return lerp(CARET_H1.x, 1500, ease.outExpo(seg(t, T1, T1 + 0.32))); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.txt; L.clear();
    const c = L.ctx; c.textBaseline = 'alphabetic';
    const lb = this.lb; lb.clear();
    const posterT = t >= H2 && t < COLL + 0.3;
    if (posterT) this.posters(c, t);
    else {
      this.lineAndWords(lb, c, t);
      this.montage(lb, c, t);
    }
    // the last line: the squashed poster, retracting into the caret on the downbeat (the outro's retract)
    if (t >= SQUASH + 0.2) {
      const retract = ease.outExpo(seg(t, COLL, COLL + 0.28));
      const x0 = lerp(-24, CARET_H1.x, retract), x1 = lerp(W + 24, CARET_H1.x, retract);
      if (retract < 1) lb.seg2(x0, LINE_Y, x1, LINE_Y, LINE_W * (1 + 0.6 * (1 - retract)), heatCol(t - COLL, LINE_C, 0.9), 1);
    }
    lb.render(renderer, out);
    // the caret
    if (!posterT || t >= COLL) {
      let a = 0, hk = 1;
      if (t < T1 + 0.05) a = 1;
      else if (t >= DOWN - 0.04 && t < H2) a = 0.75 + 0.25 * (this.slotU(t) > 0.8 ? 1 : 0.4);
      else if (t >= COLL + 0.06) { a = 1; hk = ease.outExpo(seg(t, COLL + 0.06, COLL + 0.15)); }
      if (a > 0) drawCaretH1(c, a, hk);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    comp.draw(renderer, L.upload(), out);
    return this.post(t);
  }

  // ------------------------------------------------------------------ 0 → 1.1: one line
  lineAndWords(lb: LineBatch, c: C2, t: number) {
    if (t < T1) return;
    const retract = ease.outExpo(seg(t, DOWN, DOWN + 0.28));
    if (retract < 1) {
      const hx = this.headX(t);
      const x1 = lerp(t > T1 + 0.32 ? W + 24 : hx, CARET_H1.x, retract), x0 = CARET_H1.x;
      lb.seg2(x0, LINE_Y, x1, LINE_Y, LINE_W * (1 + 0.6 * (1 - retract) * seg(t, DOWN, DOWN + 0.01)), heatCol(t - T1, LINE_C, 0.9), 1);
      const sI = 1 - seg(t, DOWN + 0.08, DOWN + 0.26);
      sparkHead(lb, lerp(hx, CARET_H1.x, retract), LINE_Y, t, 1 + 0.5 * pulse(t, T_LINE, 0.08) + 0.5 * pulse(t, T1, 0.08), sI);
      sparkParticles(lb, t, (tb) => (tb > T1 && tb < DOWN + 0.2 ? { x: lerp(this.headX(tb), CARET_H1.x, ease.outExpo(seg(tb, DOWN, DOWN + 0.28))), y: LINE_Y } : null), { rate: 80 });
    }
    // ONE LINE rising out of the line; sinking into it just before the downbeat
    c.save(); c.beginPath(); c.rect(0, 0, W, LINE_Y - 1); c.clip();
    const S = 150;
    c.font = font(this.fam, S);
    const cap = S * 0.72, drop = cap + 30, base = LINE_Y - 20;
    const lay = layout('One line', this.fam, S);
    let wi = 0, j = 0;
    for (const g of lay.glyphs) {
      if (g.ch === ' ') { wi++; j = 0; continue; }
      const ws = wi === 0 ? T1 : T_LINE, t0 = ws + j++ * 0.014;
      if (t < t0) continue;
      const x = TX0 + g.x;
      const tDel = DOWN - 0.22 + ((x - TX0) / 700) * 0.14; // the retract passes it, right to left… left
      const rise = ease.outExpo(seg(t, t0, t0 + 0.13));
      const sink = ease.inCubic(seg(t, tDel, tDel + 0.1));
      if (sink >= 1) continue;
      c.fillStyle = t >= tDel ? SIG() : hotType(t - ws);
      c.fillText(g.ch, x, base + (1 - rise) * drop + sink * drop);
    }
    c.restore();
  }

  // ------------------------------------------------------------------ 1.1 → 2.07: the rewind, reversed
  slotAt(t: number) {
    let i = 0;
    while (i + 1 < REV.length && this.slot0[i + 1]! <= t) i++;
    return { i, u: clamp((t - this.slot0[i]!) / REV[i]!) };
  }
  slotU(t: number) { return t < M0 ? 0 : this.slotAt(t).u; }
  montage(lb: LineBatch, c: C2, t: number) {
    if (t < M0 || t >= M1 + 0.02) return;
    const { i, u } = this.slotAt(t);
    const ic = this.icons[i]!;
    // the outro's slot, time-reversed: its u runs 1 → 0
    const first = i === 0; // the outro's braking leader slot
    const ur = 1 - u;
    const e = first ? ease.inOutCubic(ur) : ease.inQuad(ur);
    const R = 330 * (1 - e) + 2;
    const cx = lerp(960, CARET_H1.x, e), cy = LINE_Y;
    const age = REV[i]! * ur; // (the outro's age since the icon appeared at the centre)
    const col = heatCol(age, sc(LIN.bone, 0.8), 0.9);
    const jit = first ? 0 : (hash(frameIdx(t), 7) - 0.5) * 6;
    for (const p of ic.polys) for (let k = 1; k < p.length; k++) {
      const a = p[k - 1]!, b = p[k]!;
      lb.seg2(cx + a.x * R + jit, cy + a.y * R, cx + b.x * R + jit, cy + b.y * R, 1.3, col, 1);
    }
    lb.seg2(cx, cy, CARET_H1.x, cy, 1, sc(LIN.signal, 0.6 * e), 0.6);
    // the notes: plate numbers counting up, TOKENS 0 counting up into FRAMES
    const mono = (s: string, x: number, y: number, px: number, col2: string) => { c.font = font(F.mono(500), px); c.letterSpacing = '3px'; c.fillStyle = col2; c.fillText(s, x, y); c.letterSpacing = '0px'; };
    mono(`${String(ic.no).padStart(2, '0')}  ${ic.id}`, CARET_H1.x - 7, LINE_Y + 64, 14, BONE(0.85));
    const U = (i + u) / REV.length;
    const n = Math.round(2137 * Math.pow(U, 1.5));
    mono(n > 0 ? `FRAMES ${grp(n)}` : 'TOKENS 0', CARET_H1.x - 7, LINE_Y + 88, 14, SIG(0.95));
    c.font = font(F.mono(500), 13); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.7);
    c.fillText('REEL 1 · UNWINDING · 1 PROMPT · 16 PLATES', 96, 1012); c.letterSpacing = '0px';
  }

  // ------------------------------------------------------------------ 2.07 → 6.99: the posters
  posters(c: C2, t: number) {
    const k = Math.floor((t - H2) / B + 1e-6); // which beat
    const a = t - (H2 + k * B); // age in it
    const slam = (s = 0.14, d = 0.11) => 1 + s * (1 - ease.outExpo(clamp(a / d)));
    const field = (col: string) => { c.fillStyle = col; c.fillRect(0, 0, W, H); };
    const txt = (s: string, fam: string, size: number, x: number, y: number, col: string, align: CanvasTextAlign = 'left') => {
      c.font = font(fam, size); c.textAlign = align; c.fillStyle = col; c.fillText(s, x, y); c.textAlign = 'left';
    };
    const mono = (s: string, x: number, y: number, px: number, col: string, align: CanvasTextAlign = 'left') => {
      c.font = font(F.mono(500), px); c.letterSpacing = '3px'; c.textAlign = align; c.fillStyle = col; c.fillText(s, x, y); c.letterSpacing = '0px'; c.textAlign = 'left';
    };
    const zoomAt = (x: number, y: number, s: number, fn: () => void) => { c.save(); c.translate(x, y); c.scale(s, s); c.translate(-x, -y); fn(); c.restore(); };
    const blink = Math.floor(a / (B / 2)) % 2 === 0;
    const BLACK = F.archivo(125, 900), WIDE = F.archivo(125, 800), NARROW = F.archivo(62, 900);
    if (t >= SQUASH) {
      // the poster, squashed into one line (then the line retracts: drawn with the line batch)
      const sq = ease.inCubic(seg(t, SQUASH, SQUASH + 0.18));
      if (sq < 1) { c.save(); c.translate(0, LINE_Y); c.scale(1, 1 - sq); c.translate(0, -LINE_Y); this.poster(c, t, H4, 1); c.restore(); }
      if (sq > 0.6) { c.fillStyle = rgba('bone', 0.9 * (1 - seg(t, SQUASH + 0.2, SQUASH + 0.3))); c.fillRect(0, LINE_Y - 1.5 * (1 - sq) * 40, W, 3); }
      return;
    }
    switch (k) {
      case 0: { // 2.07: signal field, ONE as big as the frame, a black caret
        field(SIG());
        zoomAt(960, 540, slam(0.18), () => {
          txt('ONE', BLACK, 1060, -30, 930, INK());
          if (blink) { c.fillStyle = INK(); c.fillRect(1700, 170, 96, 760); }
        });
        mono('ONE PROMPT — A FILM IN ONE LINE', 60, 64, 16, INK(0.8));
        break;
      }
      case 1: { // 2.56: ink, PROMPT slides in across the whole width
        field(INK());
        const dx = 520 * (1 - ease.outExpo(clamp(a / 0.16)));
        txt('PROMPT', WIDE, 400, 960 + dx, 690, BONE(), 'center');
        c.fillStyle = SIG(); c.fillRect(60 + dx * 0.4, 760, 1800 * ease.outExpo(clamp(a / 0.2)), 6);
        mono('prompt  n. — one line of text', 60, 820, 22, BONE(0.8));
        break;
      }
      case 2: { // 3.05: bone, the stack, a signal numeral
        field(BONE());
        zoomAt(960, 540, slam(0.1), () => {
          txt('1', BLACK, 1400, 1880, 1090, SIG(), 'right');
          txt('ONE', BLACK, 360, 70, 470, INK());
          txt('PROMPT,', BLACK, 360, 70, 790, INK());
        });
        mono('FIG. 01', 70, 90, 16, INK(0.7)); mono('122 BPM', 1850, 1030, 16, INK(0.7), 'right');
        break;
      }
      case 3: { // 3.54: ink, ONE FILM in outline, filling on the half beat
        field(INK());
        const fill = a > B / 2;
        zoomAt(960, 540, slam(0.08), () => {
          c.font = font(BLACK, 420); c.textAlign = 'center';
          c.lineWidth = 3; c.strokeStyle = BONE();
          c.strokeText('ONE', 960, 480); c.strokeText('FILM', 960, 900);
          if (fill) { c.fillStyle = SIG(); c.fillText('FILM', 960, 900); }
          c.textAlign = 'left';
        });
        break;
      }
      case 4: { // 4.04: signal field, FILM stood on end, credits
        field(SIG());
        zoomAt(960, 540, slam(0.16), () => {
          c.save(); c.translate(760, 1080); c.rotate(-Math.PI / 2);
          txt('FILM', BLACK, 760, 0, 0, INK());
          c.restore();
        });
        const lines = ['A FILM', 'MADE FROM', 'ONE LINE', 'OF TEXT.'];
        lines.forEach((s, i) => { if (a > 0.05 + i * 0.06) txt(s, NARROW, 120, 900, 300 + i * 150, INK()); });
        break;
      }
      case 5: { // 4.53: the split: ink | bone
        const sx = lerp(W, 960, ease.outExpo(clamp(a / 0.14)));
        field(INK());
        c.fillStyle = BONE(); c.fillRect(sx, 0, W - sx, H);
        c.save(); c.beginPath(); c.rect(0, 0, sx, H); c.clip(); txt('ONE', BLACK, 420, 930, 700, SIG(), 'right'); c.restore();
        c.save(); c.beginPath(); c.rect(sx, 0, W - sx, H); c.clip(); txt('LINE', BLACK, 420, sx + 30, 700, INK()); c.restore();
        break;
      }
      case 6: { // 5.02: marquee rows, alternating directions
        field(INK());
        const rows = 7, rh = H / rows;
        for (let r = 0; r < rows; r++) {
          const dir = r % 2 ? 1 : -1, v = 1400 + 300 * (r % 3);
          const s = 'ONE PROMPT · ONE FILM · ';
          c.font = font(BLACK, rh * 1.05);
          const w = c.measureText(s).width;
          const x0 = ((dir * a * v) % w + w) % w - w;
          const col = r === 3 ? SIG() : r % 2 ? BONE(0.18) : BONE();
          c.fillStyle = col;
          for (let x = x0; x < W + w; x += w) c.fillText(s, x, (r + 1) * rh - rh * 0.12);
        }
        break;
      }
      case 7: { // 5.51: bone, the caret as tall as the frame, typing "one line" fast
        field(BONE());
        c.fillStyle = SIG(); c.fillRect(150, 120, 120, 840);
        const sN = 'one line';
        const n = Math.min(sN.length, Math.floor(a / 0.05) + 1);
        c.font = font(F.mono(600), 250);
        c.fillStyle = INK(); c.fillText(sN.slice(0, n), 330, 660);
        break;
      }
      default: this.poster(c, t, H4, slam(0.3, 0.14));
    }
  }
  /** 6.00: the poster. Paper, ONE PROMPT in ink over a misregistered signal print, the credits set Swiss. */
  poster(c: C2, t: number, t0: number, k: number) {
    const a = t - t0;
    c.fillStyle = BONE(); c.fillRect(0, 0, W, H);
    const fam = F.archivo(118, 900);
    c.save(); c.translate(960, 560); c.scale(k, k); c.translate(-960, -560);
    const mis = 18 * (0.4 + 0.6 * Math.exp(-a * 8));
    c.font = font(fam, 330); c.textAlign = 'center';
    c.fillStyle = SIG(); c.fillText('ONE', 960 + mis, 520 + mis * 0.6); c.fillText('PROMPT', 960 + mis, 820 + mis * 0.6);
    c.fillStyle = INK(); c.fillText('ONE', 960, 520); c.fillText('PROMPT', 960, 820);
    c.textAlign = 'left';
    c.restore();
    c.fillStyle = INK(); c.fillRect(80, 118, W - 160, 3); c.fillRect(80, 930, W - 160, 3);
    c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = INK(0.85);
    c.fillText('A LYRIC FILM', 80, 100);
    c.textAlign = 'right'; c.fillText('122 BPM · 89 SEC · 16 PLATES', W - 80, 100); c.textAlign = 'left';
    c.fillText('ONE LINE OF TEXT.', 80, 970);
    c.textAlign = 'right'; c.fillStyle = SIG(); c.fillText('ONE FILM.', W - 80, 970); c.textAlign = 'left';
    c.letterSpacing = '0px';
  }

  post(t: number): PostOverrides {
    const cuts = [T1, T_LINE, DOWN, H2, ...Array.from({ length: 9 }, (_, i) => H2 + (i + 1) * B), COLL];
    let hit = 0; for (const x of cuts) hit = Math.max(hit, pulse(t, x, 0.06));
    hit = Math.max(hit, 1.4 * pulse(t, H4, 0.1));
    const mont = t >= M0 && t < M1 ? 1 : 0;
    const o: PostOverrides = {
      ...EDGE_POST,
      bloom: 0.62, halation: 0.24,
      ca: 1.2 + 3.5 * mont + 2.5 * hit, grain: 0.055 + 0.03 * mont,
      zoom: 1 + 0.025 * hit,
      shake: [Math.sin(t * 97) * 9 * hit, Math.cos(t * 83) * 7 * hit],
      vignette: t >= H2 && t < SQUASH ? 0.22 : 0.38,
    };
    return toEdge(o, Math.max(t < T1 ? 1 : 0, seg(t, T_END - 0.2, T_END - 0.02)));
  }
}
