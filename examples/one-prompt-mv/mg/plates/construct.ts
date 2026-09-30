// Plate `construct` (the intro's hit 2 → CUT.prompt): the title, as a construction drawing. After the
// rewind has run forward out of the caret, the spark is a plotter pen on a luminous construction sheet
// (the grammar of pdoom-video's `open`, MIT): on the hit it strikes and shoots out the axes (the title's
// baseline and origin), ticks and numbers cascading as the heads pass; the compass sweeps the O on the
// next beat; then the pen draws the title's letters, one per beat (ONE), then one per eighth (PROMPT),
// every contour hot where the pen has just been and cooling to bone, with the type's construction laid
// down as the pen goes: baseline, cap height and overshoot across the whole title, em boxes, advance
// dimensions, kerning, code points, and a deadpan listing typed alongside. The pen underlines the whole
// title with one line. On the drop (6.0) the letters fill: ONE PROMPT, solid, the sheet punching. On the
// last downbeat the sheet cools to black and the pen slides to the caret's pixel and becomes the caret (H1).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H } from '../px/gl';
import { LineBatch } from '../px/lines';
import { sparkHead, sparkParticles } from '../px/motifs';
import { LIN, rgba } from '../px/palette';
import { F, font, layout } from '../px/type';
import { clamp, ease, lerp, prog, pulse, noise1, TAU } from '../px/util';
import { CUT, CARET_H1 } from './handoff';
import { drawCaretH1, EDGE_POST, toEdge, mixCss } from './leader-kit';
import { glyphContours, type P } from './glyph-contours';

type RGB = [number, number, number];
type Kind = 'axis' | 'cons' | 'prim' | 'dim' | 'line' | 'ring' | 'ghost';
type Ease = (x: number) => number;
const pt = (x: number, y: number): P => ({ x, y });
interface Stroke { pts: P[]; L: Float32Array; tot: number; t0: number; t1: number; kind: Kind; pen: boolean; ez: Ease; alpha: number; width: number; dash: number; group: string; tD: Float32Array }
interface Note { text: string; x: number; y: number; em: number; t0: number; dur: number; col: string; a: number; align: CanvasTextAlign; group: string; weight: number; maxPx: number; hot: number }
interface Cam { cx: number; cy: number; z: number; roll: number }
interface CamKey extends Cam { t: number; ez?: Ease }

const B = 60 / 122;
const TITLE = 'ONE PROMPT';
const FAM = F.archivo(100, 900);

function lengths(ps: P[]) { const L = new Float32Array(ps.length); for (let i = 1; i < ps.length; i++) L[i] = L[i - 1]! + Math.hypot(ps[i]!.x - ps[i - 1]!.x, ps[i]!.y - ps[i - 1]!.y); return L; }
function at(ps: P[], L: Float32Array, s: number): P {
  if (s <= 0) return ps[0]!;
  for (let i = 1; i < ps.length; i++) if (L[i]! >= s) { const k = (s - L[i - 1]!) / Math.max(1e-9, L[i]! - L[i - 1]!); return pt(lerp(ps[i - 1]!.x, ps[i]!.x, k), lerp(ps[i - 1]!.y, ps[i]!.y, k)); }
  return ps[ps.length - 1]!;
}
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 48): P[] => Array.from({ length: n + 1 }, (_, i) => pt(cx + r * Math.cos(lerp(a0, a1, i / n)), cy + r * Math.sin(lerp(a0, a1, i / n))));
const poly = (...ps: P[]) => [...ps, ps[0]!];

const BG_FRAG = /* glsl */ `
uniform vec4 uCam; uniform vec2 uRes; uniform float uReveal; uniform vec3 uPen; uniform float uFade; uniform vec2 uO;
void main() {
  vec2 sp = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 d = sp - 0.5 * uRes;
  float c = cos(-uCam.w), s = sin(-uCam.w);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / uCam.z;
  vec2 p = uCam.xy + vec2(d.x, -d.y);
  vec3 col = C_INK;
  vec2 g1 = abs(fract(p / 0.1 + 0.5) - 0.5) * 0.1 * uCam.z;
  vec2 g4 = abs(fract(p / 0.5 + 0.5) - 0.5) * 0.5 * uCam.z;
  float minor = max(1.0 - smoothstep(0.0, 1.0, g1.x), 1.0 - smoothstep(0.0, 1.0, g1.y));
  float major = max(1.0 - smoothstep(0.25, 1.25, g4.x), 1.0 - smoothstep(0.25, 1.25, g4.y));
  float dens = smoothstep(6.0, 18.0, 0.1 * uCam.z);
  float rr = length(p - uO);
  float rev = smoothstep(uReveal, uReveal - 1.5, rr);
  float front = exp(-abs(rr - uReveal) * 3.2) * step(0.01, uReveal) * (1.0 - smoothstep(8.0, 12.0, uReveal));
  col += C_BONE * (minor * 0.011 * dens + major * 0.03) * rev;
  col += C_SIGNAL * (minor * dens * 0.5 + major) * front * 0.09;
  float pd = length(sp - uPen.xy);
  col += C_SIGNAL * 0.018 * uPen.z * exp(-pd * pd / (2.0 * 140.0 * 140.0));
  col *= 1.0 - uFade;
  fragColor = vec4(col, 1.0);
}`;

export default class Construct extends Scene {
  lines = new LineBatch(120000, { blend: 'add' });
  fx = new LineBatch(16000, { blend: 'add' });
  text = new Layer2D();
  bg = new FSPass(BG_FRAG, { uCam: { value: new THREE.Vector4() }, uRes: { value: new THREE.Vector2(W, H) }, uReveal: { value: 0 }, uPen: { value: new THREE.Vector3() }, uFade: { value: 0 }, uO: { value: new THREE.Vector2() } });
  strokes: Stroke[] = [];
  pens: Stroke[] = [];
  notes: Note[] = [];
  cams: CamKey[] = [];
  T0 = 0; T1 = 0; tFill = 0; tExit = 0;
  Bk = (k: number) => this.T0 + k * B;
  glyphs: { ch: string; x: number; w: number; t0: number; box: { x0: number; x1: number; y0: number; y1: number } }[] = [];
  width = 0; cap = 0.72;

  override init() {
    this.T0 = this.ctx.start; this.T1 = this.ctx.end;
    this.tFill = this.Bk(8); // the drop, 6.0
    this.tExit = this.Bk(10) - 0.02; // the last downbeat, 6.99
    const lay = layout(TITLE, FAM, 100);
    this.width = lay.width / 100;
    const times = [this.Bk(2), this.Bk(3), this.Bk(3.5), 0, this.Bk(4), this.Bk(4.5), this.Bk(5), this.Bk(5.5), this.Bk(6), this.Bk(6.5)];
    lay.glyphs.forEach((g, i) => {
      if (g.ch === ' ') return;
      const cs = glyphContours(g.ch, FAM);
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const c of cs) for (const p of c) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      this.glyphs.push({ ch: g.ch, x: g.x / 100, w: g.w / 100, t0: times[i]!, box: { x0: g.x / 100 + x0, x1: g.x / 100 + x1, y0, y1 } });
      (this.glyphs[this.glyphs.length - 1] as unknown as { cs: P[][] }).cs = cs.map((c) => c.map((p) => pt(p.x + g.x / 100, p.y)));
    });
    this.cap = this.glyphs.find((g) => g.ch === 'N')!.box.y1;
    this.buildPlot();
    this.buildCamera();
  }

  // ================================================================== the plot program
  addStroke(pts: P[], t0: number, t1: number, kind: Kind, o: Partial<Pick<Stroke, 'pen' | 'ez' | 'alpha' | 'width' | 'dash' | 'group'>> = {}) {
    const L = lengths(pts), tot = L[L.length - 1]!, ez = o.ez ?? ease.linear;
    const tD = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const target = tot > 0 ? L[i]! / tot : 1;
      let lo = 0, hi = 1;
      for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (ez(m) < target) lo = m; else hi = m; }
      tD[i] = t0 + (t1 - t0) * hi;
    }
    const s: Stroke = { pts, L, tot, t0, t1, kind, pen: o.pen ?? false, ez, alpha: o.alpha ?? 1, width: o.width ?? 1.2, dash: o.dash ?? 0, group: o.group ?? 'main', tD };
    this.strokes.push(s);
    if (s.pen) this.pens.push(s);
    return s;
  }
  note(text: string, x: number, y: number, t0: number, o: Partial<Omit<Note, 'text' | 'x' | 'y' | 't0'>> = {}) {
    this.notes.push({ text, x, y, t0, em: o.em ?? 0.05, dur: o.dur ?? Math.min(0.35, 0.01 * text.length + 0.04), col: o.col ?? 'ash', a: o.a ?? 0.9, align: o.align ?? 'left', group: o.group ?? 'main', weight: o.weight ?? 400, maxPx: o.maxPx ?? 26, hot: o.hot ?? 0 });
  }
  dimension(a: P, b: P, label: string, t0: number, group: string, em = 0.035) {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    const S = (pts: P[], ta: number, tb: number) => this.addStroke(pts, ta, tb, 'dim', { alpha: 0.75, width: 1.0, group });
    S([a, b], t0, t0 + 0.1);
    const ar = 0.03;
    for (const [p, s] of [[a, 1], [b, -1]] as const) {
      S([pt(p.x + s * ux * ar + nx * ar * 0.33, p.y + s * uy * ar + ny * ar * 0.33), p, pt(p.x + s * ux * ar - nx * ar * 0.33, p.y + s * uy * ar - ny * ar * 0.33)], t0 + 0.06, t0 + 0.1);
      S([pt(p.x - nx * 0.03, p.y - ny * 0.03), pt(p.x + nx * 0.03, p.y + ny * 0.03)], t0, t0 + 0.04);
    }
    const vert = Math.abs(dy) > Math.abs(dx);
    this.note(label, (a.x + b.x) / 2 + (vert ? -0.02 : 0), (a.y + b.y) / 2 + (vert ? -em * 0.32 : 0.015), t0 + 0.08, { em, align: vert ? 'right' : 'center', group, dur: 0.06 });
  }

  buildPlot() {
    const S = (pts: P[], t0: number, t1: number, kind: Kind, o: Parameters<Construct['addStroke']>[4] = {}) => this.addStroke(pts, t0, t1, kind, o);
    const t0 = this.T0, Wt = this.width, cap = this.cap;
    const oG = this.glyphs[0]!;
    const oc = pt((oG.box.x0 + oG.box.x1) / 2, (oG.box.y0 + oG.box.y1) / 2);
    const oR = (oG.box.y1 - oG.box.y0) / 2;
    // ---- ignition: the axes (the baseline and the origin) shoot out of the spark; ticks cascade
    this.addStroke([pt(0, 0), pt(1e-4, 0)], t0 - 0.002, t0 + 0.25, 'ghost', { pen: true, alpha: 0 });
    for (const [dx, dy, len, d] of [[1, 0, Wt + 1.2, 0], [-1, 0, 1.4, 0.01], [0, 1, 1.25, 0.03], [0, -1, 0.7, 0.04]] as const)
      S([pt(0, 0), pt(dx * len, dy * len)], t0 + d, t0 + d + 0.5, 'axis', { ez: ease.outExpo, width: 1.1, group: 'axes' });
    for (let dgr = 30; dgr < 360; dgr += 30) {
      if (dgr % 90 === 0) continue;
      const a = (dgr * Math.PI) / 180;
      S([pt(0.06 * Math.cos(a), 0.06 * Math.sin(a)), pt(3.4 * Math.cos(a), 3.4 * Math.sin(a))], t0 + 0.02, t0 + 0.6, 'cons', { ez: ease.outExpo, alpha: 0.45, dash: 10, width: 1.0, group: 'rays' });
    }
    const reach = (d: number, len: number) => { let lo = 0, hi = 1; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (ease.outExpo(m) * len < d) lo = m; else hi = m; } return t0 + 0.5 * hi; };
    for (let i = 1; i <= Math.floor((Wt + 1.1) * 10); i++) {
      const x = i / 10, ti = reach(x, Wt + 1.2), big = i % 5 === 0;
      S([pt(x, big ? 0.03 : 0.014), pt(x, big ? -0.03 : -0.014)], ti, ti + 0.03, 'axis', { width: 1.0, alpha: big ? 1 : 0.6, group: 'axes' });
      if (big) this.note((x).toFixed(1), x, -0.075, ti + 0.02, { em: 0.028, align: 'center', a: 0.75, group: 'axes', dur: 0.03 });
    }
    for (let i = 1; i <= 12; i++) {
      const y = i / 10, ti = reach(y, 1.25), big = i % 5 === 0;
      S([pt(-0.02, y), pt(0.02, y)], ti, ti + 0.03, 'axis', { width: 1.0, alpha: big ? 1 : 0.6, group: 'axes' });
      if (big) this.note(y.toFixed(1), -0.04, y - 0.01, ti + 0.02, { em: 0.028, align: 'right', a: 0.75, group: 'axes', dur: 0.03 });
    }
    this.note('(0,0)', 0.02, -0.07, t0 + 0.1, { em: 0.028, group: 'axes', dur: 0.05 });
    this.note('em', Wt + 1.25, 0.02, t0 + 0.4, { em: 0.04, group: 'axes' });
    // the listing, deadpan, typed while we pull back
    const lx = -1.3, ly = 1.05;
    this.note('% prompt: "One line."', lx, ly, t0 + 0.1, { em: 0.034, col: 'bone', a: 0.85, dur: 0.36, group: 'listing', maxPx: 60 });
    this.note('\\begin{film}[bpm=122, fps=24]', lx, ly - 0.05, t0 + 0.46, { em: 0.028, dur: 0.12, group: 'listing', maxPx: 60 });
    S(arc(0, 0, 0.1, 0, TAU, 96), t0, t0 + 0.02, 'ring', { group: 'ring' });

    // ---- the compass: the O's circle, with the dial laid down as the pen passes
    const tc = this.Bk(1);
    const circ = S(arc(oc.x, oc.y, oR, 0, TAU, 128), tc, tc + 0.36, 'cons', { pen: true, ez: ease.inOutCubic, alpha: 0.8, width: 1.1, group: 'cons' });
    S(arc(oc.x, oc.y, oR * 0.5, Math.PI, Math.PI + TAU, 96), tc + 0.08, tc + 0.4, 'cons', { ez: ease.inOutCubic, alpha: 0.45, dash: 7, width: 1.0, group: 'cons' });
    for (let d = 0; d < 360; d += 5) {
      const a = (d * Math.PI) / 180, tt = circ.tD[Math.round((d / 360) * 128)]!;
      const l = d % 30 === 0 ? 0.05 : d % 10 === 0 ? 0.028 : 0.014;
      S([pt(oc.x + oR * Math.cos(a), oc.y + oR * Math.sin(a)), pt(oc.x + (oR + l) * Math.cos(a), oc.y + (oR + l) * Math.sin(a))], tt, tt + 0.03, 'cons', { alpha: d % 30 === 0 ? 0.9 : 0.6, width: 1.0, group: 'dial' });
      if (d % 30 === 0) this.note(`${d}°`, oc.x + (oR + 0.1) * Math.cos(a), oc.y + (oR + 0.1) * Math.sin(a) - 0.01, tt + 0.02, { em: 0.024, align: 'center', a: 0.8, group: 'dial', dur: 0.03 });
    }
    this.note(`r = ${oR.toFixed(3)}`, oc.x + oR * 0.72, oc.y - oR * 0.9, tc + 0.3, { em: 0.03, group: 'cons' });
    S([oc, pt(oc.x + oR, oc.y)], tc, tc + 0.02, 'cons', { alpha: 0.6, width: 1.0, group: 'cons' });
    // the type's construction: baseline, cap height, overshoot and descender, across the whole title
    const tb = this.Bk(1.5);
    const gx0 = -0.3, gx1 = Wt + 0.3;
    S([pt(gx0, cap), pt(gx1, cap)], tb, tb + 0.34, 'cons', { ez: ease.outCubic, alpha: 0.6, group: 'type' });
    S([pt(gx0, oG.box.y1), pt(gx1, oG.box.y1)], tb + 0.03, tb + 0.37, 'cons', { ez: ease.outCubic, alpha: 0.35, dash: 5, group: 'type' });
    S([pt(gx0, oG.box.y0), pt(gx1, oG.box.y0)], tb + 0.05, tb + 0.39, 'cons', { ez: ease.outCubic, alpha: 0.35, dash: 5, group: 'type' });
    S([pt(gx0, -0.21), pt(gx1, -0.21)], tb + 0.08, tb + 0.42, 'cons', { ez: ease.outCubic, alpha: 0.3, dash: 4, group: 'type' });
    this.note('baseline', gx1 + 0.03, -0.01, tb + 0.3, { em: 0.026, group: 'typel' });
    this.note(`cap height ${cap.toFixed(3)}`, gx1 + 0.03, cap - 0.01, tb + 0.33, { em: 0.026, group: 'typel' });
    this.note('overshoot', gx1 + 0.03, oG.box.y1 + 0.005, tb + 0.36, { em: 0.022, group: 'typel' });
    this.note('descender', gx1 + 0.03, -0.22, tb + 0.4, { em: 0.022, group: 'typel' });

    // ---- the letters: every contour drawn by the pen; em box, advance, code point, kerning as it goes
    this.glyphs.forEach((g, gi) => {
      const cs = (g as unknown as { cs: P[][] }).cs;
      const dur = gi < 3 ? 0.34 : 0.2;
      let acc = 0; const tot = cs.reduce((a, c) => a + lengths(c)[c.length - 1]!, 0);
      for (const c of cs) {
        const len = lengths(c)[c.length - 1]!;
        const a0 = g.t0 + dur * (acc / tot), a1 = g.t0 + dur * ((acc + len) / tot);
        acc += len;
        S(c, a0, a1, 'prim', { pen: true, ez: ease.inOutQuad, width: 1.6, group: 'glyph' });
      }
      const ey0 = -0.21, ey1 = 0.79;
      S(poly(pt(g.x, ey1), pt(g.x + g.w, ey1), pt(g.x + g.w, ey0), pt(g.x, ey0)), g.t0 + 0.02, g.t0 + 0.02 + dur * 0.8, 'cons', { alpha: 0.45, dash: 5, group: 'ems' });
      this.dimension(pt(g.x, ey0 - 0.05), pt(g.x + g.w, ey0 - 0.05), (g.w * 1000).toFixed(0), g.t0 + dur * 0.6, 'dims', 0.026);
      const code = g.ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      this.note(`U+${code}`, g.x + 0.01, ey1 + 0.025, g.t0 + 0.05, { em: 0.024, col: 'bone', a: 0.7, group: 'codes', dur: 0.05 });
      if (gi > 0 && this.glyphs[gi - 1]) {
        const p = this.glyphs[gi - 1]!;
        const gap = g.box.x0 - p.box.x1;
        if (gap < 0.5) this.note(`kern ${(gap * 1000).toFixed(0)}`, (p.box.x1 + g.box.x0) / 2, cap * 0.5, g.t0 + 0.02, { em: 0.02, align: 'center', col: 'signal', a: 0.9, group: 'codes', dur: 0.04 });
      }
    });
    this.note('Archivo 900 · wdth 100 · 10 glyphs', 0, 1.02, this.Bk(4) + 0.1, { em: 0.03, col: 'bone', a: 0.75, group: 'typel', dur: 0.22 });
    this.note('\\draw[pen] (0,0) -- ++(prompt) ;  % one line', lx, ly - 0.1, this.Bk(4.5), { em: 0.028, group: 'listing', dur: 0.25, maxPx: 60 });

    // ---- one line: the pen underlines the whole title, hot
    const tl = this.Bk(7);
    S([pt(-0.05, -0.1), pt(Wt + 0.05, -0.1)], tl, tl + 0.3, 'line', { pen: true, ez: ease.inOutCubic, width: 2.4, group: 'line' });
    this.note('1 LINE', Wt + 0.08, -0.115, tl + 0.3, { em: 0.034, col: 'signal', a: 1, group: 'line', dur: 0.06 });
    this.note('\\end{film}', lx, ly - 0.15, tl + 0.2, { em: 0.028, group: 'listing', dur: 0.1, maxPx: 60 });
    // the drop: a second ring from the title's centre
    S(arc(Wt / 2, cap / 2, 0.1, 0, TAU, 96), this.tFill, this.tFill + 0.02, 'ring', { group: 'ring2' });
  }

  buildCamera() {
    const K = (t: number, cx: number, cy: number, z: number, roll: number, ez?: Ease): CamKey => ({ t, cx, cy, z, roll, ez });
    const Wt = this.width, oG = this.glyphs[0]!;
    const ocx = (oG.box.x0 + oG.box.x1) / 2, ocy = this.cap / 2;
    const k = (i: number) => this.Bk(i);
    const zF = 1560 / Wt; // px per em at which the title spans 1560 px
    this.cams = [
      K(this.T0, 0, 0, 2400, 0.3),
      K(k(0) + 0.45, 0.25, 0.3, 900, 0.06, ease.outExpo), // pull back as the axes shoot out
      K(k(1) - 0.02, ocx - 0.05, ocy, 1000, 0.02, ease.linear),
      K(k(1) + 0.4, ocx, ocy, 1250, 0.0, ease.inOutCubic), // the compass
      K(k(2) - 0.02, ocx + 0.05, ocy, 1300, -0.01, ease.linear),
      K(k(2) + 0.3, ocx + 0.35, ocy + 0.05, 980, -0.025, ease.outExpo), // the O, drawn
      K(k(4) - 0.03, 1.0, ocy + 0.05, 900, -0.035, ease.linear), // creep along O N E
      K(k(4) + 0.32, Wt * 0.5 + 0.1, 0.45, zF * 0.86, 0.02, ease.outExpo), // snap out on the hit: the whole sheet
      K(k(7) - 0.02, Wt * 0.5 + 0.05, 0.42, zF * 0.93, 0.015, ease.linear),
      K(k(8) - 0.01, Wt * 0.5, 0.36, zF * 0.97, 0.0, ease.inOutQuad), // onto the line, into the drop
      K(k(8) + 0.12, Wt * 0.5, 0.36, zF * 1.05, 0.0, ease.outExpo), // the drop's punch
      K(this.tExit, Wt * 0.5, 0.36, zF * 1.09, 0.0, ease.linear),
      K(this.T1, Wt * 0.5, 0.36, zF * 1.12, 0.0, ease.inQuad),
    ];
  }
  cam(t: number): Cam {
    const ks = this.cams;
    if (t <= ks[0]!.t) return ks[0]!;
    for (let i = 1; i < ks.length; i++) {
      const b = ks[i]!;
      if (t > b.t) continue;
      const a = ks[i - 1]!;
      const k = (b.ez ?? ease.inOutCubic)(clamp((t - a.t) / Math.max(1e-4, b.t - a.t)));
      const z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), k));
      const roll = lerp(a.roll, b.roll, k);
      if (Math.abs(b.z - a.z) > a.z * 0.04) {
        const fx = (b.z * b.cx - a.z * a.cx) / (b.z - a.z), fy = (b.z * b.cy - a.z * a.cy) / (b.z - a.z);
        return { cx: fx - (a.z / z) * (fx - a.cx), cy: fy - (a.z / z) * (fy - a.cy), z, roll };
      }
      return { cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), z, roll };
    }
    return ks[ks.length - 1]!;
  }
  w2s(c: Cam, x: number, y: number): [number, number] {
    const dx = (x - c.cx) * c.z, dy = -(y - c.cy) * c.z, co = Math.cos(c.roll), si = Math.sin(c.roll);
    return [W / 2 + co * dx - si * dy, H / 2 + si * dx + co * dy];
  }
  s2w(c: Cam, sx: number, sy: number): P {
    const dx = sx - W / 2, dy = sy - H / 2, co = Math.cos(-c.roll), si = Math.sin(-c.roll);
    return pt(c.cx + (co * dx - si * dy) / c.z, c.cy - (si * dx + co * dy) / c.z);
  }
  penAt(t: number): P {
    let prev: Stroke | null = null;
    for (const s of this.pens) {
      if (t < s.t0) {
        const from = prev ? prev.pts[prev.pts.length - 1]! : s.pts[0]!, to = s.pts[0]!;
        const tPrev = prev ? prev.t1 : s.t0 - 1;
        const d = Math.hypot(to.x - from.x, to.y - from.y);
        const dur = Math.min(s.t0 - tPrev, clamp(0.06 + d * 0.08, 0.06, 0.2));
        const k = ease.inOutCubic(clamp((t - (s.t0 - dur)) / Math.max(1e-4, dur)));
        return pt(lerp(from.x, to.x, k), lerp(from.y, to.y, k));
      }
      if (t <= s.t1) return at(s.pts, s.L, s.ez(clamp((t - s.t0) / Math.max(1e-4, s.t1 - s.t0))) * s.tot);
      prev = s;
    }
    // exit: a rapid pen-up move to the caret's pixel
    const from = prev ? prev.pts[prev.pts.length - 1]! : pt(0, 0);
    const c = this.cam(this.T1);
    const to = this.s2w(c, CARET_H1.x, CARET_H1.y);
    const k = ease.inOutCubic(prog(t, this.tExit + 0.02, this.T1 - 0.1));
    return pt(lerp(from.x, to.x, k), lerp(from.y, to.y, k));
  }
  exitK(t: number) { return prog(t, this.tExit, this.T1 - 0.1, ease.inQuad); }
  groupAlpha(g: string, t: number): number {
    const exit = 1 - this.exitK(t);
    const fill = prog(t, this.tFill, this.tFill + 0.25);
    switch (g) {
      case 'rays': return exit * (1 - prog(t, this.Bk(2), this.Bk(4)));
      case 'dial': return exit * (1 - 0.8 * prog(t, this.Bk(3), this.Bk(5)));
      case 'cons': return exit * (1 - 0.6 * prog(t, this.Bk(4), this.Bk(6))) * (1 - 0.7 * fill);
      case 'axes': return exit * (1 - 0.4 * fill);
      case 'type': return exit * (1 - 0.5 * fill);
      case 'typel': return exit * (1 - 0.6 * fill);
      case 'ems': return exit * (1 - 0.5 * prog(t, this.Bk(6), this.Bk(8))) * (1 - fill);
      case 'dims': return exit * (1 - 0.4 * prog(t, this.Bk(6), this.Bk(8))) * (1 - 0.8 * fill);
      case 'codes': return exit * (1 - 0.7 * fill);
      case 'glyph': return exit * (1 - 0.6 * fill);
      case 'listing': return exit;
      case 'ring': case 'ring2': return 1;
      default: return exit;
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const c = this.cam(t);
    const pw = this.penAt(t);
    const ps = this.w2s(c, pw.x, pw.y);
    const ignite = prog(t, this.T0 - 0.012, this.T0 + 0.01);
    const u = this.bg.u;
    (u.uCam!.value as THREE.Vector4).set(c.cx, c.cy, c.z, c.roll);
    u.uReveal!.value = 10 * ease.outCubic(prog(t, this.T0 + 0.1, this.Bk(2) + 0.4));
    (u.uPen!.value as THREE.Vector3).set(ps[0], ps[1], ignite);
    u.uFade!.value = this.exitK(t);
    this.bg.render(renderer, out);

    const L = this.lines; L.clear();
    this.drawStrokes(t, c, L);
    L.render(renderer, out);
    const T = this.text; T.clear();
    const ctx = T.ctx;
    this.drawFill(t, c, ctx);
    this.drawNotes(t, c, ctx);
    // the caret: the pen becomes it at the end
    const ce = prog(t, this.T1 - 0.1, this.T1 - 0.03);
    if (ce > 0) { drawCaretH1(ctx, ce, ease.outExpo(ce)); ctx.setTransform(1, 0, 0, 1, 0, 0); }
    comp.draw(renderer, T.upload(), out);

    // the pen: spark head, hot trail, sputter
    const X = this.fx; X.clear();
    const pen = ignite * (1 - prog(t, this.T1 - 0.1, this.T1 - 0.03));
    if (pen > 0) {
      const burst = pulse(t, this.T0, 0.16);
      let prev = ps, trail = 0;
      for (let i = 1; i <= 12; i++) {
        const tt = t - i * 0.007;
        if (tt < this.T0) break;
        const q = this.penAt(tt), s = this.w2s(c, q.x, q.y);
        const k = 1 - i / 13;
        trail += Math.hypot(s[0] - prev[0], s[1] - prev[1]);
        const fade = 1 - clamp((trail - 90) / 60);
        if (fade <= 0) break;
        X.seg2(prev[0], prev[1], s[0], s[1], 2.0 * k + 0.6, [LIN.ember[0] * 3 * k * fade, LIN.ember[1] * 3 * k * fade, LIN.ember[2] * 3 * k * fade], k * fade * pen);
        prev = s;
      }
      sparkParticles(X, t, (tb) => { if (tb < this.T0 || tb > this.T1 - 0.1) return null; const q = this.penAt(tb); const s = this.w2s(c, q.x, q.y); return { x: s[0], y: s[1] }; },
        { rate: (tb) => 60 + 700 * pulse(tb, this.T0, 0.06) + 500 * pulse(tb, this.tFill, 0.06), rateMax: 940, intensity: 0.9, speed: 220 + 420 * burst, seed: 17, life: 0.42 });
      sparkHead(X, ps[0], ps[1], t, 1.05 + 1.5 * burst + 1.2 * pulse(t, this.tFill, 0.12), pen);
    }
    X.render(renderer, out);

    let punch = 0;
    for (const d of [this.Bk(4), this.Bk(8)]) punch += 0.02 * pulse(t, d, 0.09);
    for (const d of [this.Bk(1), this.Bk(2), this.Bk(3), this.Bk(5), this.Bk(6), this.Bk(7)]) punch += 0.007 * pulse(t, d, 0.07);
    for (const g of this.glyphs) punch += 0.004 * pulse(t, g.t0, 0.06);
    const shakeA = 9 * pulse(t, this.T0, 0.07) + 10 * pulse(t, this.tFill, 0.08) + 3 * pulse(t, this.Bk(4), 0.06);
    const post: PostOverrides = {
      ...EDGE_POST,
      bloom: 0.72 - 0.3 * pulse(t, this.T0, 0.25), bloomThreshold: 0.82,
      flash: 0.012 * pulse(t, this.T0, 0.03) + 0.02 * pulse(t, this.tFill, 0.04),
      shake: [shakeA * noise1(t * 45, 3), shakeA * noise1(t * 51, 4)],
      zoom: 1 + punch, vignette: 0.42, grain: 0.05,
    };
    return toEdge(post, prog(t, this.T1 - 0.2, this.T1 - 0.02));
  }

  drawStrokes(t: number, c: Cam, L: LineBatch) {
    const bone = LIN.bone, ash = LIN.ash, sig = LIN.signal, emb = LIN.ember;
    for (const s of this.strokes) {
      if (t < s.t0 || s.alpha <= 0) continue;
      const ga = this.groupAlpha(s.group, t);
      if (ga <= 0.002) continue;
      const k = s.ez(clamp((t - s.t0) / Math.max(1e-4, s.t1 - s.t0)));
      const head = k * s.tot;
      let base: RGB, a0: number, hot: number;
      switch (s.kind) {
        case 'axis': base = ash; a0 = 0.55; hot = 0.8; break;
        case 'cons': base = ash; a0 = 0.5; hot = 0.6; break;
        case 'dim': base = ash; a0 = 0.8; hot = 0.5; break;
        case 'line': base = sig; a0 = 0.9; hot = 1.2; break;
        default: base = bone; a0 = 0.85; hot = 1;
      }
      const A = a0 * s.alpha * ga;
      if (s.kind === 'ring') {
        const age = t - s.t0;
        if (age > 0.7) continue;
        const R = 0.08 + 2.4 * ease.outCubic(age / 0.7), I = Math.pow(1 - age / 0.7, 1.5);
        const cx = s.pts[0]!.x - 0.1, cy = s.pts[0]!.y; // (the arc started at +r on x)
        let prev: [number, number] | null = null;
        for (let i = 0; i <= 96; i++) {
          const an = (i / 96) * TAU, cur = this.w2s(c, cx + R * Math.cos(an), cy + R * Math.sin(an));
          if (prev) L.seg2(prev[0], prev[1], cur[0], cur[1], 1.2, [sig[0] * 0.9 * I + bone[0] * 0.35 * I, sig[1] * 0.9 * I + bone[1] * 0.35 * I, sig[2] * 0.9 * I + bone[2] * 0.35 * I], I);
          prev = cur;
        }
        continue;
      }
      let prev: [number, number] | null = null, acc = 0;
      for (let i = 0; i < s.pts.length; i++) {
        let p = s.pts[i]!, stop = false;
        if (s.L[i]! > head) { if (i === 0) break; p = at(s.pts, s.L, head); stop = true; }
        const cur = this.w2s(c, p.x, p.y);
        if (prev) {
          const segLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
          const age = t - Math.min(s.tD[i]!, t);
          const h1 = hot * Math.exp(-age / 0.05), h2 = hot * Math.exp(-age / 0.32);
          const col: RGB = [base[0] * (1 - h2) + sig[0] * 1.5 * h2 + emb[0] * 2.6 * h1, base[1] * (1 - h2) + sig[1] * 1.5 * h2 + emb[1] * 2.6 * h1, base[2] * (1 - h2) + sig[2] * 1.5 * h2 + emb[2] * 2.6 * h1];
          const al = Math.min(1, A + h2 * 0.8 * ga), wd = s.width * (1 + 0.6 * h1);
          if (s.dash > 0) {
            let u0 = 0;
            while (u0 < segLen) {
              const ph = (acc + u0) % s.dash, on = ph < s.dash * 0.55;
              const run = Math.min(segLen - u0, on ? s.dash * 0.55 - ph : s.dash - ph);
              if (on && run > 0.05) { const a1 = u0 / segLen, b1 = (u0 + run) / segLen; L.seg2(lerp(prev[0], cur[0], a1), lerp(prev[1], cur[1], a1), lerp(prev[0], cur[0], b1), lerp(prev[1], cur[1], b1), wd, col, al); }
              u0 += Math.max(run, 0.05);
            }
          } else L.seg2(prev[0], prev[1], cur[0], cur[1], wd, col, al);
          acc += segLen;
        }
        prev = cur;
        if (stop) break;
      }
    }
  }
  tx(ctx: CanvasRenderingContext2D, c: Cam, x: number, y: number, em: number) {
    const [sx, sy] = this.w2s(c, x, y);
    const k = (c.z * em) / 100;
    ctx.setTransform(k * Math.cos(c.roll), k * Math.sin(c.roll), -k * Math.sin(c.roll), k * Math.cos(c.roll), sx, sy);
  }
  /** the drop: the letters fill, hot, cooling to bone */
  drawFill(t: number, c: Cam, ctx: CanvasRenderingContext2D) {
    if (t < this.tFill) return;
    const a = t - this.tFill;
    const k = ease.outExpo(clamp(a / 0.08)) * (1 - this.exitK(t));
    if (k <= 0) return;
    ctx.textBaseline = 'alphabetic';
    this.tx(ctx, c, 0, 0, 1);
    ctx.font = font(FAM, 100);
    ctx.fillStyle = a < 0.05 ? mixCss('ember', 'signal', a / 0.05, k) : mixCss('signal', 'bone', clamp((a - 0.05) / 0.3), k);
    ctx.fillText(TITLE, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  drawNotes(t: number, c: Cam, ctx: CanvasRenderingContext2D) {
    ctx.textBaseline = 'alphabetic';
    for (const n of this.notes) {
      if (t < n.t0) continue;
      const px = c.z * n.em;
      const sizeA = clamp(px / 8 - 0.4) * (1 - clamp((px - n.maxPx) / (n.maxPx * 0.6)));
      const ga = this.groupAlpha(n.group, t) * sizeA;
      if (ga <= 0.003) continue;
      const shown = Math.floor(n.text.length * clamp((t - n.t0) / Math.max(0.01, n.dur)) + 1e-3);
      if (shown <= 0) continue;
      this.tx(ctx, c, n.x, n.y, n.em);
      ctx.font = font(F.mono(n.weight), 100);
      ctx.textAlign = n.align;
      ctx.fillStyle = rgba(n.col, n.a * ga);
      const s = n.align === 'left' ? n.text.slice(0, shown) : n.text;
      ctx.fillText(s, 0, 0);
      ctx.textAlign = 'left';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
