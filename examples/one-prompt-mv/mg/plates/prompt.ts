// Plate `prompt` — "Type a word and let it drop". CUT.prompt → CUT.ridge.
// It opens on the leader's last frame: black, the caret alone at CARET_H1. The caret draws out one thin
// prompt field in a vast dark field (a terminal's cell grid revealed from the caret, a context window of
// 8,192 slots with 7 used). The lyric is typed as TOKENS in 64 px IBM Plex Mono, each on its sung word:
// bracket, fake id, leading-space dot, an ember flash cooling to bone, attention arcs back to every
// earlier token, and a next-token distribution that flickers (per frame) and then samples the orange
// winner — film-making jokes. On "drop" ⏎ is pressed and the four letters of "drop" fall out of the
// field (handoff.dropLetter, screen space); the camera follows them down, the prompt rises out of frame,
// and the letters punch through the model's 24 layers (each plane heats where a letter crosses it), past
// a depth ruler and mono readouts of the fall, until the cut to `ridge`.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, measure } from '../px/type';
import { sparkHead, sparkParticles } from '../px/motifs';
import { clamp, ease, lerp, prog, pulse, noise1, hash, frameIdx, TAU } from '../px/util';
import { CUT, CARET_H1, DROP_X0, dropLetter, frames } from './handoff';
import { wStart, wEnd, wText, wProg } from './lyric';
import { TOKS, LAYERS, type Cand } from './prompt-data';
import {
  type P, type Stroke, type Cam, type CamKey, pt, K, camAt, w2s, camTransform, mkStroke, drawStroke, heat, hotType, mixCss,
  drawCaretH1, toEdge, EDGE_POST, scale3, tri,
} from './leader-kit';

// ------------------------------------------------------------------ layout (world px = screen px at rest)
const FS = 64, TX0 = 316, BASE = CARET_H1.y + 17; // the caret spans 511..569: cap top 512, baseline 557
const FX0 = 204, FX1 = 1716, FY0 = 476, FY1 = 604;
const KEY = { x: FX1 - 72, y: 540, s: 30 };
const W0 = 2, W1 = 8; // lyric word indices: "Type" … "drop"
const POP_PRE = 0.16;
const LY0 = 1020, LDY = 84; // the model's layer planes, below the prompt
const RULER_X = 1846;
const CTX_Y = 880;
const g = (x: number) => x.toFixed(4);

interface Tok { text: string; wi: number; ci: number; n: number; space: boolean; t0: number; id: number; dist: Cand[]; tPopEnd: number; level: number }
interface Cross { k: number; li: number; tau: number; x: number }

const BG_FRAG = /* glsl */ `
uniform vec4 uCam;
uniform float uReveal;  // cell-grid reveal radius from the caret (world px)
uniform vec2 uOrigin;
uniform float uScroll;  // the fall (world px)
uniform float uDeep;    // 0..1 the deep field
void main() {
  vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  vec2 d = sp - vec2(${W / 2}.0, ${H / 2}.0);
  float c = cos(-uCam.w), s = sin(-uCam.w);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y) / uCam.z;
  vec2 p = uCam.xy + d;
  float px = 1.0 / uCam.z;
  vec3 col = C_INK;
  float r = length(p - uOrigin);
  float rev = 1.0 - smoothstep(uReveal - 300.0, uReveal, r);
  // the terminal's cell grid: tiny crosses at every cell corner, fading into the vast dark
  vec2 cell = vec2(${g(38.4)}, 96.0);
  vec2 gq = (p - vec2(${TX0}.0, ${g(BASE - 96 * 1.0 + 0)})) / cell;
  vec2 f = (fract(gq + 0.5) - 0.5) * cell / px;
  float cr = max(pxLine(abs(f.x), 0.2, 0.9) * step(abs(f.y), 3.5), pxLine(abs(f.y), 0.2, 0.9) * step(abs(f.x), 3.5));
  vec2 fd = (p - vec2(960.0, 560.0)) / vec2(1900.0, 1100.0);
  float fade = exp(-dot(fd, fd) * 2.2);
  col += C_BONE * 0.055 * cr * fade * rev;
  // the reveal front
  col += C_SIGNAL * 0.016 * exp(-abs(r - uReveal) / 22.0) * step(1.0, uReveal) * (1.0 - smoothstep(1600.0, 2600.0, uReveal));
  // the deep field: two planes of motes at other depths (parallax against the fall)
  for (int l = 0; l < 2; l++) {
    float fl = l == 0 ? 0.35 : 0.62;
    float cs = l == 0 ? 74.0 : 48.0;
    vec2 q = sp + vec2(0.0, uScroll * fl);
    vec2 id = floor(q / cs), fq = fract(q / cs) - 0.5;
    vec2 h = hash22(id + float(l) * 17.0);
    float on = step(0.7, hash12(id * 1.3 + float(l) * 5.0));
    float dd = length((fq - (h - 0.5) * 0.7) * cs);
    col += C_BONE * (l == 0 ? 0.045 : 0.085) * on * (1.0 - smoothstep(0.4, 1.4, dd)) * uDeep;
  }
  col += C_BLOOD * 0.02 * uDeep * smoothstep(900.0, 3000.0, p.y);
  fragColor = vec4(col, 1.0);
}`;

export default class Prompt extends Scene {
  bg = new FSPass(BG_FRAG, {
    uCam: { value: new THREE.Vector4(960, 540, 1, 0) }, uReveal: { value: 0 }, uOrigin: { value: new THREE.Vector2(CARET_H1.x, CARET_H1.y) },
    uScroll: { value: 0 }, uDeep: { value: 0 },
  });
  lines = new LineBatch(60000, { blend: 'add' });
  fx = new LineBatch(8000, { blend: 'add' });
  text = new Layer2D();

  T0 = 7.48; T1 = 11.41;
  adv = 38.4;
  fam = F.mono(400);
  toks: Tok[] = [];
  typed = '';
  tEnter = 9.4; tS = 9.7;
  dropT0: number[] = [];
  strokes: Stroke[] = [];
  cross: Cross[] = [];
  keys: CamKey[] = [];

  override init() {
    const au = this.ctx.audio;
    this.T0 = CUT.prompt; this.T1 = CUT.ridge;
    this.adv = measure('0', this.fam, FS); // 38.4: Plex Mono's advance is 600/1000 em
    // tokens: one per sung word, a leading space on all but the first
    let ci = 0;
    const words: string[] = [];
    for (let wi = W0; wi <= W1; wi++) {
      const w = wText(wi).replace(/[^A-Za-z']/g, '');
      if (wi > W0) ci += 1;
      const spec = TOKS[w] ?? { id: 1000 + Math.floor(hash(wi, 7) * 9000), dist: [[w, 0.5], ['…', 0.1]] as Cand[] };
      this.toks.push({ text: w, wi, ci, n: w.length, space: wi > W0, t0: wStart(wi), id: spec.id, dist: spec.dist, tPopEnd: 0, level: (wi - W0) % 2 });
      words.push(w);
      ci += w.length;
    }
    this.typed = words.join(' ');
    this.toks.forEach((k, i) => {
      const next = this.toks[i + 1];
      k.tPopEnd = Math.max(k.t0 + 0.22, Math.min(k.t0 + 0.6, next ? next.t0 + 0.1 : k.t0 + 0.5));
    });
    // ⏎ on the snare that lands inside "drop" (fallback: just after its start)
    const sn = au.events('snare', wStart(W1) - 0.02, wStart(W1) + 0.12)[0];
    this.tEnter = sn ? sn[0] : wStart(W1) + 0.04;
    // when each letter leaves the field (probe the contract, don't copy it)
    for (let k = 0; k < 4; k++) {
      let lo = wStart(W1) - 0.2, hi = wStart(W1) + 1.5;
      for (let q = 0; q < 30; q++) { const m = (lo + hi) / 2; if (dropLetter(k, m).y > 540 + 1e-6) hi = m; else lo = m; }
      this.dropT0.push(hi);
    }
    this.tS = this.dropT0[3]! + 0.03;
    this.buildField();
    this.buildArcs();
    this.buildCamera();
    this.buildCrossings();
  }

  // ================================================================== geometry built once
  buildField() {
    const t0 = this.T0 + 0.03, cx = CARET_H1.x;
    const o = { a0: 0.42, width: 1.1, group: 'field', hot: 1 };
    const S = (pts: P[], a: number, b: number, ez = ease.outExpo) => this.strokes.push(mkStroke(pts, a, b, { ...o, ez }));
    // the caret stretches up and down to the field's edges, then the edges race out both ways
    this.strokes.push(mkStroke([pt(cx, CARET_H1.y - 29), pt(cx, FY0)], t0, t0 + 0.06, { ...o, ez: ease.outQuad, group: 'stretch' }));
    this.strokes.push(mkStroke([pt(cx, CARET_H1.y + 29), pt(cx, FY1)], t0, t0 + 0.06, { ...o, ez: ease.outQuad, group: 'stretch' }));
    for (const y of [FY0, FY1]) { S([pt(cx, y), pt(FX1, y)], t0 + 0.05, t0 + 0.4); S([pt(cx, y), pt(FX0, y)], t0 + 0.05, t0 + 0.3); }
    S([pt(FX0, FY0), pt(FX0, FY1)], t0 + 0.26, t0 + 0.32, ease.inOutQuad);
    S([pt(FX1, FY0), pt(FX1, FY1)], t0 + 0.36, t0 + 0.42, ease.inOutQuad);
    // corner registration ticks
    const tk = 16;
    [[FX0, FY0, -1, -1], [FX1, FY0, 1, -1], [FX0, FY1, -1, 1], [FX1, FY1, 1, 1]].forEach(([x, y, sx, sy], i) => {
      const a = t0 + 0.4 + 0.02 * i;
      this.strokes.push(mkStroke([pt(x! + sx! * 6, y!), pt(x! + sx! * (6 + tk), y!)], a, a + 0.05, { ...o, a0: 0.6 }));
      this.strokes.push(mkStroke([pt(x!, y! + sy! * 6), pt(x!, y! + sy! * (6 + tk))], a, a + 0.05, { ...o, a0: 0.6 }));
    });
    // the context window: a ruler with one slot per token, running off to the right (8,192 of them)
    const c0 = this.T0 + 0.5;
    this.strokes.push(mkStroke([pt(FX0, CTX_Y), pt(2500, CTX_Y)], c0, c0 + 0.9, { base: LIN.ash, a0: 0.4, width: 1.0, group: 'ctx', ez: ease.outCubic }));
  }

  /** Attention: every new token draws arcs back to each earlier one (three heads, hashed weights). */
  buildArcs() {
    const y0 = FY1 + 64;
    this.toks.forEach((tj, j) => {
      const xj = TX0 + (tj.ci + tj.n / 2) * this.adv;
      for (let i = 0; i < j; i++) {
        const ti = this.toks[i]!;
        const xi = TX0 + (ti.ci + ti.n / 2) * this.adv;
        for (let h = 0; h < 3; h++) {
          const w = 0.2 + 0.8 * Math.pow(hash(i, j, h, 3), 2) * (j - i === 1 ? 1.4 : 1);
          const depth = 16 + 0.23 * Math.abs(xj - xi) * (0.7 + 0.22 * h);
          const pts: P[] = [];
          for (let q = 0; q <= 36; q++) { const u = q / 36; pts.push(pt(lerp(xj, xi, u), y0 + depth * Math.sin(Math.PI * u))); }
          const a = tj.t0 + 0.02 + 0.035 * h + 0.012 * (j - i);
          this.strokes.push(mkStroke(pts, a, a + 0.12 + 0.00025 * Math.abs(xj - xi), { base: LIN.ash, a0: 0.12 + 0.45 * Math.min(1, w), width: 0.8 + 0.9 * Math.min(1, w), hot: 0.35 + 0.65 * Math.min(1, w), group: 'arcs', ez: ease.outCubic }));
        }
      }
    });
  }

  buildCamera() {
    const T = (i: number) => wStart(i);
    const tDrop = T(W1);
    this.keys = [
      K(this.T0, 960, 540, 1, 0),
      K(T(2) - 0.1, 880, 536, 1.12, 0, ease.linear), // creep toward the caret as the field draws out
      K(T(2) + 0.22, 610, 500, 1.8, -0.012, ease.outExpo), // snap in on "Type"
      K(T(4) - 0.02, 660, 500, 1.86, -0.012, ease.linear),
      K(T(4) + 0.2, 770, 505, 1.38, 0.006, ease.outExpo), // "word"
      K(T(5) - 0.02, 800, 505, 1.42, 0.006, ease.linear),
      K(T(5) + 0.28, 1010, 660, 0.6, 0, ease.outExpo), // "and": the vast field, the context window
      K(T(7) - 0.02, 1020, 650, 0.64, 0, ease.linear),
      K(T(7) + 0.14, 1060, 590, 0.8, -0.004, ease.outExpo), // "it"
      K(tDrop - 0.02, 1070, 585, 0.83, -0.004, ease.linear),
      K(tDrop + 0.08, 960, 540, 1, 0, ease.outExpo), // "drop": 1:1, the letters' own pixels
      K(this.T1, 960, 540, 1, 0),
    ];
  }

  /** The fall: world scroll (px) as the camera follows the letters down. */
  scroll(t: number) {
    const u = t - this.tS;
    if (u <= 0) return 0;
    const V = 1300, a = 3.2;
    return V * (u - (1 - Math.exp(-u * a)) / a);
  }
  /** A letter's centre in world coordinates. */
  letterWorld(k: number, t: number): P {
    const d = dropLetter(k, t);
    return pt(d.x + this.adv / 2, d.y + this.scroll(t));
  }
  /** When each letter crosses each layer plane (precomputed; the planes heat there). */
  buildCrossings() {
    for (let k = 0; k < 4; k++) {
      let prev = this.letterWorld(k, this.dropT0[k]!);
      for (let t = this.dropT0[k]! + 0.002; t <= this.T1; t += 0.002) {
        const p = this.letterWorld(k, t);
        for (let li = 0; li < LAYERS.length; li++) {
          const y = LY0 + li * LDY;
          if (prev.y < y && p.y >= y) this.cross.push({ k, li, tau: t - 0.002 * ((p.y - y) / Math.max(1e-6, p.y - prev.y)), x: lerp(prev.x, p.x, (y - prev.y) / Math.max(1e-6, p.y - prev.y)) });
        }
        prev = p;
      }
    }
  }

  // ================================================================== state
  camera(t: number): Cam {
    const c = camAt(this.keys, t);
    let nod = 0;
    for (const k of this.toks) if (k.wi < W1) nod += 0.045 * prog(t, k.t0, k.t0 + 0.2, ease.outExpo) * Math.exp(-Math.max(0, t - k.t0 - 0.2) / 0.3);
    nod *= 1 - prog(t, this.toks[this.toks.length - 1]!.t0 - 0.05, this.toks[this.toks.length - 1]!.t0 + 0.06);
    return { cx: c.cx, cy: c.cy + this.scroll(t), z: c.z * (1 + nod), roll: c.roll };
  }
  caretX(t: number) {
    let x = CARET_H1.x;
    for (const k of this.toks) {
      if (k.t0 > t) break;
      const target = TX0 + (k.ci + k.n) * this.adv + 9;
      x = lerp(x, target, ease.outExpo(clamp((t - k.t0) / 0.07)));
    }
    return x;
  }
  cellTime(col: number) {
    for (const k of this.toks) if (col < k.ci + k.n) return k.t0;
    return Infinity;
  }

  // ================================================================== render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    const cam = this.camera(t);
    const S = this.scroll(t);
    const tDrop = wStart(W1);
    const xf = (p: P): [number, number] => w2s(cam, p.x, p.y);

    // ---- the vast field
    const u = this.bg.u;
    (u.uCam!.value as THREE.Vector4).set(cam.cx, cam.cy, cam.z, cam.roll);
    u.uReveal!.value = 2600 * ease.outCubic(prog(t, this.T0 + 0.08, this.T0 + 1.3));
    u.uScroll!.value = S;
    u.uDeep!.value = prog(t, this.tEnter, this.tEnter + 0.5);
    this.bg.render(renderer, out);

    // ---- lines
    const L = this.lines; L.clear();
    const ga = (grp: string) => grp === 'field' ? 1 + 0.8 * pulse(t, this.tEnter, 0.1) : grp === 'stretch' ? 1 - prog(t, this.T0 + 0.3, this.T0 + 0.5) : 1;
    for (const s of this.strokes) drawStroke(L, s, t, xf, ga(s.group));
    this.drawRuler(t, cam, L);
    this.drawContextTicks(t, cam, L);
    this.drawLayers(t, cam, L);
    this.drawDepthRuler(t, cam, L, S);
    this.drawTrails(t, L);
    L.render(renderer, out);

    // ---- type
    const T = this.text; T.clear();
    const c = T.ctx;
    camTransform(c, cam);
    this.drawFieldType(t, c);
    this.drawTokens(t, c);
    this.drawPopups(t, c, cam.z);
    this.drawWorldLabels(t, c, S);
    // the caret: exactly CARET_H1 until the first keystroke, then it rides the text
    if (t < this.toks[0]!.t0) drawCaretH1(c, 1);
    else if (t < this.tEnter) {
      camTransform(c, cam);
      c.fillStyle = rgba('signal', 1);
      c.fillRect(this.caretX(t) - CARET_H1.w / 2, CARET_H1.y - CARET_H1.h / 2, CARET_H1.w, CARET_H1.h);
    } else if (t < this.tEnter + 0.1) {
      // ⏎: the caret flares and goes out (the terminal is busy)
      camTransform(c, cam);
      c.fillStyle = rgba('ember', 1 - (t - this.tEnter) / 0.1);
      c.fillRect(this.caretX(t) - CARET_H1.w / 2, CARET_H1.y - CARET_H1.h / 2, CARET_H1.w, CARET_H1.h);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawLetters(t, c);
    this.drawReadouts(t, c, S);
    comp.draw(renderer, T.upload(), out);

    // ---- sparks: the caret on each keystroke, ⏎, the letters leaving
    const X = this.fx; X.clear();
    for (const k of this.toks) {
      const a = t - k.t0;
      if (a < 0 || a > 0.3 || t >= this.tEnter) continue;
      const p = w2s(cam, this.caretX(t), CARET_H1.y - 22);
      sparkHead(X, p[0], p[1], t, 0.45 * Math.sqrt(cam.z), 0.5 * Math.pow(0.5, a / 0.07));
    }
    if (t >= this.tEnter && t < this.tEnter + 0.6) {
      const kp = w2s(cam, KEY.x, KEY.y);
      sparkParticles(X, t, (tb) => (tb >= this.tEnter && tb < this.tEnter + 0.08 ? { x: kp[0], y: kp[1] } : null), { rate: 700, life: 0.4, speed: 320, seed: 41, intensity: 0.8 });
    }
    for (let k = 0; k < 4; k++) {
      const t0 = this.dropT0[k]!;
      if (t < t0 || t > t0 + 0.6) continue;
      sparkParticles(X, t, (tb) => {
        if (tb < t0 || tb > t0 + 0.07) return null;
        const d = dropLetter(k, tb);
        return { x: d.x + this.adv / 2, y: d.y - 20 };
      }, { rate: 500, life: 0.35, speed: 240, seed: 60 + k, intensity: 0.7 });
    }
    X.render(renderer, out);

    // ---- post: nods live in the camera; punches on kicks and snares, ⏎; neutral at both cuts
    const live = prog(t, this.T0 + 0.05, this.T0 + 0.2) * (1 - prog(t, this.T1 - 0.35, this.T1 - 0.15));
    const tokHit = this.toks.reduce((m, k) => Math.max(m, pulse(t, k.t0, 0.06)), 0);
    const ent = pulse(t, this.tEnter, 0.09);
    const shakeA = (2.5 * tokHit + 12 * ent + 3 * f.a.snare + 2 * f.a.kick) * live;
    const o: PostOverrides = {
      ...EDGE_POST,
      bloom: 0.62 + 0.2 * ent,
      zoom: 1 + (0.01 * f.a.kick + 0.012 * tokHit + 0.015 * ent) * live,
      shake: [shakeA * noise1(t * 45, 7), shakeA * noise1(t * 51, 8)],
      ca: 1.2 + (0.6 * tokHit + 1.6 * ent) * live,
      vignette: 0.42,
    };
    const edge = Math.max(1 - prog(t, this.T0 + 0.02, this.T0 + 0.1), prog(t, this.T1 - 0.2, this.T1 - 0.1));
    void tDrop;
    return toEdge(o, edge);
  }

  // ---------------------------------------------------------------- lines
  /** Column ruler above the field: one tick per cell, heated as the caret passes. */
  drawRuler(t: number, cam: Cam, L: LineBatch) {
    const a = prog(t, this.T0 + 0.3, this.T0 + 0.5);
    if (a <= 0) return;
    for (let k = 0; k <= 36; k++) {
      const x = TX0 + k * this.adv;
      const tc = this.cellTime(k);
      const age = t - tc;
      const hh = k % 5 === 0 ? 9 : 4;
      const { col, h2 } = heat(LIN.ash, Math.max(0, age), age >= 0 ? 1 : 0);
      const p0 = w2s(cam, x, FY0 - 6), p1 = w2s(cam, x, FY0 - 6 - hh);
      L.seg2(p0[0], p0[1], p1[0], p1[1], 1, col, (k % 5 === 0 ? 0.55 : 0.32) * a + h2 * 0.5);
    }
  }
  /** Context window slots: lit as tokens arrive. */
  drawContextTicks(t: number, cam: Cam, L: LineBatch) {
    const t0 = this.T0 + 0.5;
    if (t < t0) return;
    const reach = FX0 + (2500 - FX0) * ease.outCubic(clamp((t - t0) / 0.9));
    for (let k = 0; k < 80; k++) {
      const x = TX0 + k * this.adv;
      if (x > reach) break;
      const tok = this.toks[k];
      const used = tok && t >= tok.t0;
      const age = used ? t - tok!.t0 : 0;
      const { col } = heat(used ? LIN.bone : LIN.graphite, age, used ? 1 : 0);
      const hh = k % 16 === 0 ? 12 : 6;
      const p0 = w2s(cam, x, CTX_Y), p1 = w2s(cam, x, CTX_Y - hh);
      L.seg2(p0[0], p0[1], p1[0], p1[1], used ? 2.2 : 1, col, used ? 0.9 : 0.45);
    }
  }
  /** The model's layer planes; each heats where a letter punches through it. */
  drawLayers(t: number, cam: Cam, L: LineBatch) {
    const vis = prog(t, this.tEnter - 0.1, this.tEnter + 0.4);
    if (vis <= 0 && cam.z > 0.7) return;
    const a0 = Math.max(vis, 0.5 * prog(cam.z, 0.9, 0.62));
    const yTop = cam.cy - (H / 2) / cam.z - 20, yBot = cam.cy + (H / 2) / cam.z + 20;
    for (let li = 0; li < LAYERS.length; li++) {
      const y = LY0 + li * LDY;
      if (y < yTop || y > yBot) continue;
      const p0 = w2s(cam, -400, y), p1 = w2s(cam, 2400, y);
      L.seg2(p0[0], p0[1], p1[0], p1[1], 1, scale3(LIN.graphite, 1), 0.55 * a0);
      // fine index ticks along the plane
      for (let x = 0; x <= 1920; x += 96) {
        const q0 = w2s(cam, x, y), q1 = w2s(cam, x, y + (x % 480 === 0 ? 7 : 3));
        L.seg2(q0[0], q0[1], q1[0], q1[1], 1, LIN.graphite, 0.5 * a0);
      }
    }
    for (const cr of this.cross) {
      if (t < cr.tau) continue;
      const y = LY0 + cr.li * LDY;
      if (y < yTop || y > yBot) continue;
      const age = t - cr.tau;
      const reach = Math.min(650, 1400 * age);
      const fadeA = Math.exp(-age / 0.45);
      const n = 14;
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          const d0 = (i / n) * reach, d1 = ((i + 1) / n) * reach;
          const segAge = age - (d1 / 1400);
          const { col, h2 } = heat(LIN.ash, Math.max(0, segAge), 1);
          if (h2 < 0.02) continue;
          const p0 = w2s(cam, cr.x + sgn * d0, y), p1 = w2s(cam, cr.x + sgn * d1, y);
          L.seg2(p0[0], p0[1], p1[0], p1[1], 1.3, scale3(col, 0.45 + 0.55 * fadeA), Math.min(1, h2 * 1.1) * (0.35 + 0.65 * fadeA));
        }
      }
      // the punch: a short vertical tick at the hole
      const { col, h2 } = heat(LIN.bone, age, 1);
      const q0 = w2s(cam, cr.x, y - 10), q1 = w2s(cam, cr.x, y + 10);
      L.seg2(q0[0], q0[1], q1[0], q1[1], 1.2, col, Math.min(1, 0.35 + h2));
    }
  }
  /** Depth ruler down the right edge (world), scrolling past as the camera falls. */
  drawDepthRuler(t: number, cam: Cam, L: LineBatch, S: number) {
    const a = prog(t, this.tEnter, this.tEnter + 0.3);
    if (a <= 0) return;
    const yTop = cam.cy - H / 2 - 20, yBot = cam.cy + H / 2 + 20;
    const p0 = w2s(cam, RULER_X, Math.max(640, yTop)), p1 = w2s(cam, RULER_X, yBot);
    L.seg2(p0[0], p0[1], p1[0], p1[1], 1, LIN.ash, 0.5 * a);
    for (let y = Math.ceil(Math.max(640, yTop) / 20) * 20; y <= yBot; y += 20) {
      const major = y % 100 === 0;
      const l = major ? 16 : y % 50 === 0 ? 10 : 5;
      const q0 = w2s(cam, RULER_X, y), q1 = w2s(cam, RULER_X - l, y);
      L.seg2(q0[0], q0[1], q1[0], q1[1], 1, LIN.ash, (major ? 0.7 : 0.4) * a);
    }
    void S;
  }
  /** Hot trails behind the falling letters (screen space). */
  drawTrails(t: number, L: LineBatch) {
    const fade = 1 - prog(t, this.T1 - 0.25, this.T1 - 0.05);
    if (fade <= 0) return;
    for (let k = 0; k < 4; k++) {
      const t0 = this.dropT0[k]!;
      if (t <= t0) continue;
      let prev: [number, number] | null = null;
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const tt = Math.max(t0, t - i * 0.012);
        const d = dropLetter(k, tt);
        // the trail is left behind in the world: it scrolls up with the field
        const cur: [number, number] = [d.x + this.adv / 2, d.y - 4 - (this.scroll(t) - this.scroll(tt))];
        if (prev) {
          const kk = 1 - i / n;
          L.seg2(prev[0], prev[1], cur[0], cur[1], 1.2 + 2.2 * kk, scale3(LIN.signal, 1.3 * kk * kk * fade), kk * fade);
        }
        prev = cur;
        if (tt <= t0) break;
      }
    }
  }

  // ---------------------------------------------------------------- type (world)
  drawFieldType(t: number, c: CanvasRenderingContext2D) {
    const a = prog(t, this.T0 + 0.28, this.T0 + 0.42);
    if (a <= 0) return;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    // prompt glyph and line number
    c.font = font(F.mono(400), 44);
    c.fillStyle = rgba('ash', 0.75 * a);
    c.fillText('›', 238, BASE - 4);
    c.font = font(F.mono(400), 18);
    c.fillStyle = rgba('graphite', 0.9 * a);
    c.textAlign = 'right';
    c.fillText('01', FX0 - 16, BASE - 6);
    c.textAlign = 'left';
    // column numbers over the ruler
    c.font = font(F.mono(400), 10);
    c.fillStyle = rgba('ash', 0.6 * a);
    for (let k = 0; k <= 35; k += 5) c.fillText(String(k), TX0 + k * this.adv + 2, FY0 - 18);
    // status line (the FRAMES counter lives here)
    const nTok = this.toks.filter((k) => k.t0 <= t).length;
    const sent = t >= this.tEnter;
    c.font = font(F.mono(500), 14);
    c.letterSpacing = '2px';
    c.fillStyle = rgba('bone', 0.62 * a);
    const pre = 'PROMPT ';
    c.fillText(pre, FX0, FY1 + 30);
    const x1 = FX0 + c.measureText(pre).width;
    c.fillStyle = rgba('signal', 0.95 * a);
    c.fillText('01', x1, FY1 + 30);
    const x2 = x1 + c.measureText('01').width;
    c.fillStyle = rgba('bone', 0.62 * a);
    const tail = ` · T 0.7 · seed 0x2A · TOKENS ${String(nTok).padStart(2, '0')} · FRAMES ${String(frames(t)).padStart(4, '0')}`;
    c.fillText(tail, x2, FY1 + 30);
    if (sent) {
      const x3 = x2 + c.measureText(tail).width;
      const msg = ' · SENT · 4 GLYPHS DETACHED';
      const n = Math.floor(msg.length * clamp((t - this.tEnter) / 0.25));
      c.fillStyle = rgba('signal', 0.95 * a);
      c.fillText(msg.slice(0, n), x3, FY1 + 30);
    }
    c.letterSpacing = '0px';
    c.font = font(F.mono(400), 13);
    c.fillStyle = rgba('ash', 0.75 * a);
    c.fillText('top-p 0.95 · ctx 8,192 · one line in, one film out', FX0, FY1 + 50);
    // ⏎ key and its legend
    const press = t >= this.tEnter ? Math.pow(0.5, (t - this.tEnter) / 0.12) : 0;
    const armed = t >= this.toks[this.toks.length - 2]!.t0 + 0.1;
    const ks = KEY.s * (1 - 0.12 * press);
    const lit = t >= this.tEnter ? 1 : 0;
    if (lit) { c.fillStyle = rgba('signal', 1); c.fillRect(KEY.x - ks, KEY.y - ks, ks * 2, ks * 2); }
    c.lineWidth = armed ? 1.6 : 1;
    c.strokeStyle = lit ? rgba('signal', 1) : rgba('bone', (0.35 + (armed ? 0.35 * (0.5 + 0.5 * Math.cos(t * TAU * 2)) : 0)) * a);
    c.strokeRect(KEY.x - ks, KEY.y - ks, ks * 2, ks * 2);
    c.strokeStyle = lit ? rgba('ink', 1) : rgba('bone', 0.8 * a);
    c.lineWidth = 2.2;
    c.lineCap = 'square'; c.lineJoin = 'miter';
    const ar = ks * 0.42;
    c.beginPath();
    c.moveTo(KEY.x + ar, KEY.y - ar); c.lineTo(KEY.x + ar, KEY.y + ar * 0.25); c.lineTo(KEY.x - ar, KEY.y + ar * 0.25);
    c.moveTo(KEY.x - ar + ar * 0.45, KEY.y + ar * 0.25 - ar * 0.45); c.lineTo(KEY.x - ar, KEY.y + ar * 0.25); c.lineTo(KEY.x - ar + ar * 0.45, KEY.y + ar * 0.25 + ar * 0.45);
    c.stroke();
    c.font = font(F.mono(400), 13);
    c.fillStyle = rgba('ash', 0.75 * a);
    c.textAlign = 'right';
    c.fillText('render · no undo', FX1, FY1 + 30);
    c.textAlign = 'left';
    // attention strip label
    c.fillStyle = rgba('ash', 0.6 * a);
    c.font = font(F.mono(400), 12);
    c.fillText('ATTN · L24 · HEADS 0–2', FX0, FY1 + 68);
  }

  drawTokens(t: number, c: CanvasRenderingContext2D) {
    const adv = this.adv;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    for (const k of this.toks) {
      if (t < k.t0) break;
      const age = t - k.t0;
      const x0 = TX0 + (k.ci - (k.space ? 1 : 0)) * adv, xv = TX0 + k.ci * adv, x1 = TX0 + (k.ci + k.n) * adv;
      const drop = (1 - ease.outExpo(clamp(age / 0.09))) * -8;
      // bracket (the leading space inside it), id, leading-space dot
      const by = BASE + 16;
      const bw = x1 - x0 - 6;
      const ba = 0.42 * (1 - 0.35 * prog(t, k.t0 + 0.8, k.t0 + 2));
      c.fillStyle = rgba('bone', ba);
      c.fillRect(x0 + 3, by, bw, 1);
      c.fillRect(x0 + 3, by - 5, 1, 5);
      c.fillRect(x0 + 3 + bw - 1, by - 5, 1, 5);
      c.font = font(F.mono(400), 11);
      c.fillStyle = age < 0.25 ? mixCss('signal', 'ash', age / 0.25, 0.8) : rgba('ash', 0.6);
      c.fillText(String(k.id), x0 + 5, by + 14);
      if (k.space) { c.fillStyle = rgba('graphite', 1); c.fillRect(x0 + adv * 0.5 - 2, BASE - 14, 4, 4); }
      // karaoke: sung progress along the bracket
      const p = wProg(k.wi, t);
      const done = prog(t, wEnd(k.wi), wEnd(k.wi) + 0.35);
      c.fillStyle = rgba('signal', 1 - 0.8 * done);
      c.fillRect(x0 + 3, by - 1, bw * p, 3);
      // glyphs (the letters of "drop" leave on their own once they fall)
      c.font = font(this.fam, FS);
      for (let i = 0; i < k.n; i++) {
        if (k.wi === W1 && t >= this.dropT0[i]!) continue;
        const gy = BASE + (k.wi === W1 && t >= k.t0 + 0.09 ? 0 : drop);
        c.fillStyle = hotType(age, 1, 0.32);
        c.fillText(k.text[i]!, xv + i * adv, gy);
      }
    }
  }

  drawPopups(t: number, c: CanvasRenderingContext2D, z: number) {
    for (const k of this.toks) {
      const a0 = k.t0 - POP_PRE, a1 = k.tPopEnd + 0.12;
      if (t < a0 || t > a1) continue;
      const built = clamp((t - a0) / POP_PRE);
      const picked = t >= k.t0;
      const collapse = ease.inCubic(prog(t, k.tPopEnd, k.tPopEnd + 0.12));
      const ax = TX0 + k.ci * this.adv;
      const ay = FY0 - 34 - k.level * 132;
      const rows = k.dist;
      const rh = 21, headH = 20, pw = 300;
      const hgt = headH + rows.length * rh + 6;
      const hair = 1 / z;
      c.save();
      c.translate(ax, ay);
      c.scale(1, 1 - collapse);
      c.globalAlpha = 1 - collapse * 0.6;
      // leader line down to the token
      c.fillStyle = rgba('bone', 0.5);
      c.fillRect(0, 0, hair, BASE - FS * 0.8 - ay);
      c.fillRect(-3, BASE - FS * 0.8 - ay, 7, hair);
      c.fillStyle = rgba('ink', 0.9);
      c.fillRect(0, -hgt, pw, hgt);
      c.fillStyle = rgba('bone', 0.35);
      c.fillRect(0, -hgt, pw, hair);
      c.fillRect(0, -hgt, hair, hgt);
      c.textBaseline = 'alphabetic';
      c.font = font(F.mono(400), 11);
      c.fillStyle = rgba('ash', 0.85);
      c.textAlign = 'left';
      c.fillText('p( next | context )', 10, -hgt + 14);
      c.textAlign = 'right';
      c.fillText(picked ? `sampled · id ${k.id}` : 'computing…', pw - 8, -hgt + 14);
      c.textAlign = 'left';
      const pmax = rows[0]![1];
      rows.forEach(([txt, p0], i) => {
        const y = -hgt + headH + (i + 1) * rh - 5;
        const on = picked && i === 0;
        const fl = hash(i, frameIdx(t), k.id) < 0.25 + 0.75 * built;
        if (!picked && !fl) return;
        const jit = picked ? 1 : 0.3 + 0.7 * built + (hash(i, frameIdx(t), 3) - 0.5) * 0.6 * (1 - built);
        const flashRow = on ? Math.pow(0.5, (t - k.t0) / 0.08) : 0;
        if (on) { c.fillStyle = rgba('signal', 0.14 + 0.5 * flashRow); c.fillRect(1, y - 15, pw - 1, rh - 1); }
        c.font = font(F.mono(on ? 500 : 400), 14);
        c.fillStyle = on ? rgba('signal', 1) : rgba(picked ? 'ash' : 'bone', picked ? 0.8 : 0.55);
        if (on) tri(c, 12, y - 4.4, 3.6);
        const cell = measure(' ', F.mono(400), 14);
        if (k.space) { c.fillRect(8 + cell * 1.5, y - 5, 2.5, 2.5); }
        c.fillText(txt, 8 + cell * 2, y);
        const bx = 168, bwm = 74;
        const bw = clamp((bwm * p0) / pmax * clamp(jit, 0, 1.2), 1.5, bwm);
        c.fillStyle = on ? rgba('signal', 1) : rgba('bone', picked ? 0.3 : 0.45);
        c.fillRect(bx, y - 9, bw, 7);
        c.font = font(F.mono(400), 12);
        c.fillStyle = on ? rgba('signal', 1) : rgba('ash', 0.8);
        c.textAlign = 'right';
        c.fillText(p0.toFixed(2).replace(/^0/, ''), pw - 8, y);
        c.textAlign = 'left';
      });
      c.restore();
    }
  }

  /** Context-window labels, layer names, depth numbers (world). */
  drawWorldLabels(t: number, c: CanvasRenderingContext2D, S: number) {
    c.textBaseline = 'alphabetic';
    const ca = prog(t, this.T0 + 0.6, this.T0 + 1.0);
    if (ca > 0) {
      c.font = font(F.mono(500), 13);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('bone', 0.6 * ca);
      c.textAlign = 'left';
      const n = this.toks.filter((k) => k.t0 <= t).length;
      c.fillText(`CONTEXT ${n} / 8,192`, FX0, CTX_Y + 30);
      c.letterSpacing = '0px';
      c.font = font(F.mono(400), 11);
      c.fillStyle = rgba('ash', 0.6 * ca);
      for (let k = 16; k < 80; k += 16) c.fillText(String(k), TX0 + k * this.adv - 6, CTX_Y + 18);
      c.fillText(`→ 8,192 slots · ${Math.round(8192 * this.adv).toLocaleString('en-US')} px to the right · ${(8192 - n).toLocaleString('en-US')} free`, 2512, CTX_Y + 4);
    }
    // layer names and indices
    const vis = Math.max(prog(t, this.tEnter - 0.1, this.tEnter + 0.4), 0.6 * prog(this.camera(t).z, 0.9, 0.62));
    if (vis > 0) {
      c.font = font(F.mono(500), 12);
      for (let li = 0; li < LAYERS.length; li++) {
        const y = LY0 + li * LDY;
        const hit = this.cross.filter((q) => q.li === li && t >= q.tau).length;
        const last = this.cross.filter((q) => q.li === li && t >= q.tau).reduce((m, q) => Math.max(m, q.tau), -9);
        const hk = hit ? Math.exp(-(t - last) / 0.25) : 0;
        c.textAlign = 'left';
        c.fillStyle = hk > 0.02 ? mixCss('signal', 'ash', 1 - hk, 0.85 * vis) : rgba('ash', 0.7 * vis);
        c.fillText(`L${String(li + 1).padStart(2, '0')}`, 96, y - 8);
        c.font = font(F.mono(400), 11);
        c.fillStyle = rgba('graphite', 1 * vis);
        c.fillText(LAYERS[li]!, 132, y - 8);
        c.textAlign = 'right';
        c.fillText(`${hit}/4 passed`, 1700, y - 8);
        c.font = font(F.mono(500), 12);
      }
    }
    // depth numbers on the ruler
    const ra = prog(t, this.tEnter, this.tEnter + 0.3);
    if (ra > 0) {
      const cy = this.camera(t).cy;
      c.font = font(F.mono(400), 11);
      c.textAlign = 'right';
      c.fillStyle = rgba('ash', 0.75 * ra);
      for (let y = Math.ceil(Math.max(700, cy - H / 2) / 100) * 100; y <= cy + H / 2 + 40; y += 100) c.fillText(`${(y - CARET_H1.y).toLocaleString('en-US')}`, RULER_X - 22, y + 4);
      c.textAlign = 'left';
    }
    void S;
  }

  // ---------------------------------------------------------------- type (screen)
  /** The four letters of "drop" once they leave the field: exactly handoff.dropLetter. */
  drawLetters(t: number, c: CanvasRenderingContext2D) {
    const word = this.toks[this.toks.length - 1]!;
    c.font = font(this.fam, FS);
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    for (let k = 0; k < 4; k++) {
      const t0 = this.dropT0[k]!;
      if (t < t0) continue;
      const d = dropLetter(k, t);
      // each plane it punches through re-heats it for a moment (never in the last 0.25 s: bone at the cut)
      let hk = 0;
      for (const q of this.cross) if (q.k === k && t >= q.tau && q.tau < this.T1 - 0.25) hk = Math.max(hk, Math.exp(-(t - q.tau) / 0.07));
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.translate(d.x + this.adv / 2, d.y);
      c.rotate(d.rot);
      const age = t - word.t0;
      c.fillStyle = hk > 0.03 ? mixCss('bone', 'ember', hk) : hotType(age, 1, 0.32);
      c.fillText(word.text[k]!, -this.adv / 2, BASE - CARET_H1.y);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Screen-pinned readouts: the terminal's corners, the letter tags, the fall. */
  drawReadouts(t: number, c: CanvasRenderingContext2D, S: number) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.textBaseline = 'alphabetic';
    const a = prog(t, this.T0 + 0.35, this.T0 + 0.6) * (1 - prog(t, this.T1 - 0.4, this.T1 - 0.2));
    if (a > 0) {
      c.font = font(F.mono(500), 12);
      c.letterSpacing = '2px';
      c.textAlign = 'left';
      c.fillStyle = rgba('bone', 0.55 * a);
      c.fillText('TTY /dev/prompt0 · SCRIPT DEPT.', 64, 64);
      c.textAlign = 'right';
      c.fillText('SCENE 02 · TAKE 1 · 122 BPM', W - 64, 64);
      c.letterSpacing = '0px';
      c.font = font(F.mono(400), 12);
      c.fillStyle = rgba('ash', 0.7 * a);
      c.textAlign = 'left';
      c.fillText(`PLEX MONO 64 PX · ADVANCE ${this.adv.toFixed(1)} PX · CELL 38.4 × 96`, 64, 84);
      c.textAlign = 'right';
      c.fillText('MODEL film-1 · 24 LAYERS · CTX 8,192', W - 64, 84);
      c.textAlign = 'left';
    }
    if (t < this.dropT0[0]!) return;
    // letter tags: callouts to a column on the right
    const fa = prog(t, this.dropT0[0]!, this.dropT0[0]! + 0.15) * (1 - prog(t, this.T1 - 0.3, this.T1 - 0.12));
    if (fa > 0) {
      const ys = [0, 1, 2, 3].map((k) => dropLetter(k, t).y);
      const my = ys.reduce((x, y) => x + y, 0) / 4;
      const L = this.lines; void L;
      c.font = font(F.mono(400), 13);
      c.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const t0 = this.dropT0[k]!;
        if (t < t0) continue;
        const d = dropLetter(k, t), dp = dropLetter(k, t - 1 / 60);
        const vy = (d.y - dp.y) * 60 + (this.scroll(t) - this.scroll(t - 1 / 60)) * 60;
        const w = (d.rot - dp.rot) * 60;
        const tx = 1400, ty = Math.min(H - 150, Math.max(150, my - 58 + k * 36));
        const lx = d.x + this.adv / 2 + 26;
        const ka = fa * prog(t, t0 + 0.22, t0 + 0.36);
        c.strokeStyle = rgba('ash', 0.5 * ka);
        c.beginPath(); c.moveTo(lx, d.y); c.lineTo(tx - 150, ty - 4); c.lineTo(tx - 8, ty - 4); c.stroke();
        c.fillStyle = rgba('bone', 0.9 * ka);
        c.fillText(`${'drop'[k]}`, tx, ty);
        c.fillStyle = rgba('ash', 0.85 * ka);
        c.fillText(`  t+${(t - t0).toFixed(2)} s · v ${Math.round(vy).toLocaleString('en-US').padStart(5, ' ')} px/s · ω ${w >= 0 ? '+' : '−'}${Math.abs(w).toFixed(2)} rad/s`, tx + 8, ty);
      }
    }
    // the fall, bottom left
    const ra = prog(t, this.tEnter, this.tEnter + 0.2) * (1 - prog(t, this.T1 - 0.3, this.T1 - 0.12));
    if (ra > 0) {
      const x = 64, y = H - 118;
      const tf = t - this.dropT0[0]!;
      const depth = Math.max(0, this.letterWorld(0, t).y - CARET_H1.y);
      const li = Math.min(LAYERS.length - 1, Math.max(0, Math.floor((this.letterWorld(0, t).y - LY0) / LDY)));
      const inStack = this.letterWorld(0, t).y >= LY0;
      c.textAlign = 'left';
      c.font = font(F.mono(500), 13);
      c.letterSpacing = '3px';
      c.fillStyle = rgba('bone', 0.7 * ra);
      c.fillText('DROP TEST · 4 GLYPHS · NO PARACHUTE', x, y);
      c.letterSpacing = '0px';
      c.font = font(F.mono(500), 30);
      c.fillStyle = rgba('bone', 0.92 * ra);
      c.fillText(`${Math.round(depth).toLocaleString('en-US').padStart(5, ' ')} px`, x - 2, y + 38);
      c.font = font(F.mono(400), 13);
      c.fillStyle = rgba('ash', 0.85 * ra);
      c.fillText(`t+${Math.max(0, tf).toFixed(2)} s · g 1,800 px/s² (house standard) · cam ${Math.round((this.scroll(t) - this.scroll(t - 1 / 60)) * 60).toLocaleString('en-US')} px/s`, x, y + 60);
      c.fillStyle = inStack ? rgba('signal', 0.95 * ra) : rgba('ash', 0.85 * ra);
      c.fillText(inStack ? `LAYER ${String(li + 1).padStart(2, '0')} / 24 · ${LAYERS[li]}` : 'LEAVING THE PROMPT', x, y + 80);
    }
    void S;
  }
}
