// Plate `marquee` — "One prompt, one film tonight!" (CUT.marquee → CUT.sky). FIG. 9, the release.
// A picture palace at night, engraved like a banknote: the canopy face is the note (frame rules, loop
// chains, a lathe-work tint, medallions, corner denominations "1 PROMPT", serials, microtext repeating the
// lyric), the TONIGHT! sign above it, the facade (THE CARET in hatched banknote letters between two big
// rosettes, pilasters, ashlar, the cornice and roofline), the street below in hairlines.
//   H8     the first frame is the beam's lit screen: a bone rectangle exactly SCREEN_H8, all else dark.
//          It is the marquee's letter board. The lights come on (the engraving is revealed outward from the
//          board by a hot front) while the camera pulls back on log-zoom keys; two sparks run round the
//          canopy laying the chase lamps (which then run in 1/8 notes).
//   lyric  ONE PROMPT, / ONE FILM: kerned Archivo changeable letters dropped into the board's tracks on
//          their character times, ember-hot on landing (sparks off the rail), cooling to ink in ~0.3 s.
//          TONIGHT!: ~600 lamps on the Archivo Black outlines; the sign is wired by a pen 0.4 s early (dim
//          sockets and painted faces appear left to right), then the lamps strike left → right across the
//          sung word, the "!" on the kick at its end (detonation streaks, a shock ring). The lamps are the
//          only light: they warm the facade as they come on.
//   beats  shock rings from the board (then the sign) heat the engraving as they pass; the rosettes turn
//          beat-stepped; kicks pulse the lamps, and from "one" on the unseen crowd's flashbulbs pop at the
//          frame's edges (lighting the engraving near them).
//   H9     after the "!" the camera tilts up off the marquee (outExpo whip): at CUT.sky the roofline
//          hairline sits at y = ROOF_H9.y across the frame with open night sky above.
// Caused detail: rails drawn in by a pen, slot numbers, the board's letter counter, serial numbers that
// are FRAMES (the in-world counter, ticking at 24 fps), a lamp counter, a flash counter, leaders and
// deadpan notes that arrive when their object does something.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, layout, fitSize } from '../px/type';
import { clamp, ease, hash, keys, lerp, mulberry32, noise1, prog, pulse, smoothstep, TAU, frameIdx, type Key } from '../px/util';
import { sparkHead, sparkParticles } from '../px/motifs';
import { wStart, wEnd, wText, charTimes } from './lyric';
import { CUT, SCREEN_H8, ROOF_H9, frames } from './handoff';
import { FRAG_MQ } from './marquee-glsl';
import {
  G, type Cam, type RGB, type Lamp, type Bulb, type TonightGeo, w2s, s2w, camTransform, sdBox, rectLamps, rectAt,
  tonightGeo, buildAtlas, hotInk, hotCss, sc, mixc,
} from './marquee-kit';

const W0 = 53; // "One"
const NW = 5;
const Z_END = 0.62;
const CY_END = G.ROOF - (ROOF_H9.y - 540) / Z_END; // the roofline lands on y = 900
const CY0 = 540 - SCREEN_H8.y; // board centre (0,0) on screen (960, 500) at zoom 1
const DROP = 90; // letters fall this far into their track
const HALF_P = 2 * (G.STRIP.hw + G.STRIP.hh); // half the canopy's lamp perimeter

interface BGlyph { ch: string; row: number; x: number; w: number; tg: number; word: number; rot0: number }
interface TBulb extends Bulb { tl: number; k: number }
interface Flash { t: number; sx: number; sy: number; I: number }
interface Ring { t: number; x: number; y: number; a: number }
interface Streak { a: number; sp: number; r0: number; len: number; hot: boolean }

const pad6 = (n: number) => String(n).padStart(6, '0');

export default class Marquee extends Scene {
  pass = new FSPass(FRAG_MQ, {
    uCam: { value: new THREE.Vector4(0, CY0, 1, 0) }, uT: { value: 0 }, uGo: { value: 0 },
    uBoard: { value: 0.9 }, uBoardK: { value: 0 }, uAtlas: { value: null },
    uRing: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uFlash: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uLitX: { value: -1e5 }, uSockX: { value: -1e5 }, uSignK: { value: 0 }, uSignPulse: { value: 0 }, uChase: { value: 0 },
    uTw: { value: 0 }, uRoseX: { value: G.ROSE.x }, uNameHW: { value: 500 },
  });
  lines = new LineBatch(20000, { blend: 'normal' });
  glow = new LineBatch(16000);
  L = new Layer2D();

  T0 = 0; T1 = 0; GO = 0; tTilt = 0; tBang = 0; tS0 = 0; tS1 = 0; tC0 = 0; tC1 = 0;
  ws: number[] = []; we: number[] = [];
  beats: number[] = [];
  glyphs: BGlyph[] = [];
  fam = ''; size = 100; cap = 70;
  rows: { base: number; top: number; x0: number }[] = [];
  tg!: TonightGeo;
  bulbs: TBulb[] = [];
  chase: (Lamp & { tl: number })[] = [];
  signLamps: (Lamp & { tl: number })[] = [];
  soffit: { x: number; tl: number }[] = [];
  flashes: Flash[] = [];
  rings: Ring[] = [];
  streaks: Streak[] = [];
  camK!: { z: Key[]; y: Key[]; x: Key[]; r: Key[] };

  override init() {
    const au = this.ctx.audio;
    this.T0 = CUT.marquee; this.T1 = CUT.sky;
    this.GO = this.T0 + 0.02; // one frame after the hand-off frame
    for (let i = 0; i < NW; i++) { this.ws.push(Math.max(wStart(W0 + i), this.GO)); this.we.push(wEnd(W0 + i)); }
    this.beats = au.beats.filter((b) => b > this.T0 - 0.01 && b < this.T1 + 0.01);
    const kicks = au.events('kick', this.T0, this.T1);
    // the "!" strikes on the kick at the end of "tonight!"; the camera tilts on the beat after it
    const we4 = this.we[4]!;
    this.tBang = kicks.map((k) => k[0]).filter((k) => k > we4 - 0.25 && k < we4 + 0.12).pop() ?? we4;
    this.tTilt = this.beats.find((b) => b > this.tBang + 0.05) ?? this.T1 - 0.5;
    this.tS0 = this.ws[4]! - 0.4; this.tS1 = this.ws[4]! - 0.03; // the sign is wired 0.4 s early
    this.tC0 = this.GO + 0.03; this.tC1 = this.GO + 0.55; // the canopy lamps are laid

    // ---- the board: two rows of kerned changeable letters
    this.fam = F.archivo(87.5, 900);
    const r1 = 'ONE PROMPT,', r2 = 'ONE FILM';
    this.size = Math.min(fitSize(r1, this.fam, 900, 400, 2), 170);
    const mc = document.createElement('canvas').getContext('2d')!;
    mc.font = font(this.fam, this.size);
    this.cap = mc.measureText('H').actualBoundingBoxAscent;
    const words = [[53, 54], [55, 56]];
    [r1, r2].forEach((row, ri) => {
      const lay = layout(row, this.fam, this.size, 2);
      const cy = ri === 0 ? -98 : 98;
      const base = cy + this.cap / 2, x0 = -lay.width / 2;
      this.rows.push({ base, top: cy - this.cap / 2, x0 });
      let wi = 0, k = 0;
      const ct = words[ri]!.map((w) => charTimes(w));
      for (const g of lay.glyphs) {
        if (g.ch === ' ') { wi++; k = 0; continue; }
        const word = words[ri]![wi]!;
        const tg = Math.max(ct[wi]![k] ?? wStart(word), this.GO + 0.012);
        this.glyphs.push({ ch: g.ch, row: ri, x: x0 + g.x, w: g.w, tg, word, rot0: (hash(ri, g.i, 5) - 0.5) * 0.16 });
        k++;
      }
    });

    // ---- TONIGHT! in lamps, lit left → right across the sung word, the "!" on the kick
    this.tg = tonightGeo(1300, G.SIGN.cy, 15);
    const { x0, x1 } = this.tg;
    const ws4 = this.ws[4]!;
    this.bulbs = this.tg.bulbs.map((b, k) => ({ ...b, k, tl: ws4 + clamp((b.x - x0) / (x1 - x0)) * (this.tBang - ws4) }));
    // the "!"'s lamps all strike together, on the kick
    for (const b of this.bulbs) if (b.li === 7) b.tl = this.tBang;
    // ---- the chase lamps: laid by two sparks round the canopy; round the sign by the wiring pen
    this.chase = rectLamps(0, 0, G.STRIP.hw, G.STRIP.hh, 31).map((l) => ({ ...l, tl: this.tC0 + (l.d / HALF_P) * (this.tC1 - this.tC0) }));
    const SL = G.SIGN_LAMPS;
    this.signLamps = rectLamps(0, G.SIGN.cy, SL.hw, SL.hh, 31).map((l) => ({ ...l, tl: lerp(this.tS0, this.tS1, clamp((l.x + SL.hw) / (2 * SL.hw))) }));
    for (let x = -740; x <= 740.1; x += 74) this.soffit.push({ x, tl: this.GO + 0.3 + Math.abs(x) / 2400 });

    // ---- the atlas
    const at = buildAtlas(this.tg, this.bulbs.length);
    this.pass.u.uAtlas!.value = at.tex;
    this.pass.u.uRoseX!.value = at.roseX;
    this.pass.u.uNameHW!.value = 0.5 * layout('THE CARET', F.archivo(112.5, 900), G.NAME.cap / 0.72, 14).width;

    // ---- beats: shock rings (from the board, then from the sign), the "!"'s ring
    for (const b of this.beats) {
      if (b < this.GO + 0.3 || b > this.tBang - 0.05) continue;
      const onSign = b > ws4 - 0.05;
      const down = au.downbeats.some((d) => Math.abs(d - b) < 0.03);
      this.rings.push({ t: b, x: 0, y: onSign ? G.SIGN.cy : 0, a: down ? 1 : 0.6 });
    }
    this.rings.push({ t: this.tBang, x: this.tg.bang.x, y: this.tg.bang.y, a: 1.3 });
    // ---- the unseen crowd's flashbulbs, on kicks from "one" until the tilt
    let n = 0;
    for (const [kt, ks] of kicks) {
      if (kt < this.ws[2]! - 0.05 || kt > this.tTilt - 0.02) continue;
      const m = kt > ws4 - 0.05 ? 2 : 1;
      for (let j = 0; j < m; j++, n++) {
        const h1 = hash(n, 71), h2 = hash(n, 72), h3 = hash(n, 73);
        const bottom = h1 < 0.62;
        const sx = bottom ? 90 + h2 * 1740 : h2 < 0.5 ? 26 + h3 * 70 : W - 26 - h3 * 70;
        const sy = bottom ? H - 18 - h3 * 70 : 560 + h3 * 440;
        this.flashes.push({ t: kt + j * 0.035, sx, sy, I: ks * (0.8 + 0.4 * hash(n, 74)) });
      }
    }
    const rnd = mulberry32(909);
    for (let i = 0; i < 260; i++) this.streaks.push({ a: rnd() * TAU, sp: 0.25 + rnd() ** 2 * 1.3, r0: rnd() * 30, len: 50 + rnd() * 300, hot: rnd() < 0.3 });

    // ---- camera keys (log zoom): pull back from the board, nod per word, crane to the sign, tilt to the roof
    const [s0, s1, s2, s3, s4] = this.ws as [number, number, number, number, number];
    const lin = ease.linear, ox = ease.outExpo, T0 = this.T0, GO = this.GO, tT = this.tTilt;
    const bDown = this.beats.find((b) => b > s3 - 0.02) ?? s3 + 0.06;
    this.camK = {
      z: ([
        [T0, 1], [GO, 1, lin], [GO + 0.5, 0.76, ox], [s1, 0.745, lin], [s1 + 0.35, 0.685, ox], [s2, 0.675, lin], [s2 + 0.35, 0.64, ox],
        [s3, 0.635, lin], [s3 + 0.3, 0.615, ox], [s4 - 0.03, 0.61, lin], [s4 + 0.4, 0.645, ox], [tT, 0.665, lin], [tT + 0.42, Z_END, ox],
      ] as Key[]).map(([a, b, c]) => [a, Math.log(b), c] as Key),
      y: [
        [T0, CY0], [GO, CY0, lin], [GO + 0.5, 12, ox], [s1 + 0.35, 30, ox], [s2 + 0.35, 58, ox], [bDown, 72, lin],
        [s4 - 0.02, -170, ease.inOutQuad], [s4 + 0.4, -385, ox], [tT, -405, lin], [tT + 0.42, CY_END, ox],
      ],
      x: [[T0, 0], [GO, 0, lin], [GO + 0.5, -10, ox], [s2 + 0.35, 12, ox], [s4 + 0.4, -4, ox], [tT, 0, lin], [tT + 0.42, 0, ox]],
      r: [[T0, 0], [GO, 0, lin], [GO + 0.5, -0.012, ox], [s2 + 0.35, 0.009, ox], [s4 + 0.4, -0.007, ox], [tT, -0.005, lin], [tT + 0.42, 0, ox]],
    };
  }

  camAt(t: number): Cam {
    const K = this.camK;
    const lz = keys(t, K.z);
    let z = Math.exp(lz);
    // per-word nods
    this.ws.forEach((w, i) => { z *= 1 + (i === 4 ? 0.055 : 0.035) * ease.outExpo(prog(t, w, w + 0.2)) * (1 - prog(t, w + 0.22, w + 0.9, ease.inOutQuad)); });
    let r = keys(t, K.r);
    r += 0.022 * Math.exp(-Math.max(0, t - this.tBang) / 0.12) * Math.sin(Math.max(0, t - this.tBang) * 26) * (t > this.tBang ? 1 : 0) * (1 - prog(t, this.tTilt + 0.1, this.tTilt + 0.3));
    return { x: keys(t, K.x), y: keys(t, K.y), z, r };
  }

  /** lines are revealed by the lights: a front leaving the board at 2400 px/s */
  revealAge(t: number, x: number, y: number) { return t - (this.GO + Math.max(0, sdBox(x, y, G.BOARD.hw, G.BOARD.hh)) / 2400); }

  lightCPU(t: number, x: number, y: number, fl: { x: number; y: number; I: number }[]) {
    const rv = smoothstep(0, 0.05, this.revealAge(t, x, y));
    if (rv <= 0) return 0;
    let I = 0.09 + 0.5 * Math.exp(-Math.max(0, sdBox(x, y, G.BOARD.hw, G.BOARD.hh)) / 230);
    const chase = prog(t, this.GO + 0.05, this.GO + 0.5);
    if (y > G.SOFFIT.y0) I += chase * 0.4 * Math.exp(-(y - G.SOFFIT.y0) / 260);
    for (const f of fl) I += f.I * Math.exp(-Math.hypot(x - f.x, y - f.y) / 380);
    return Math.min(0.9, I) * rv;
  }

  // ---------------------------------------------------------------- render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t;
    const cam = this.camAt(t);
    const endK = 1 - prog(t, this.T1 - 0.22, this.T1 - 0.12); // everything transient is gone for the hand-off
    const u = this.pass.u;
    (u.uCam!.value as THREE.Vector4).set(cam.x, cam.y, cam.z, cam.r);
    u.uT!.value = t; u.uGo!.value = this.GO;
    u.uBoardK!.value = prog(t, this.GO, this.GO + 0.3);
    const ws4 = this.ws[4]!;
    const nLit = this.bulbs.reduce((a, b) => a + (t >= b.tl ? 1 : 0), 0);
    const bang = pulse(t, this.tBang, 0.1);
    u.uSignK!.value = nLit / this.bulbs.length;
    u.uSignPulse!.value = (0.6 * f.a.kick + 1.4 * bang) * (nLit > 0 ? 1 : 0);
    u.uLitX!.value = t < ws4 ? -1e5 : lerp(this.tg.x0, this.tg.x1, clamp((t - ws4) / (this.tBang - ws4))) + (t >= this.tBang ? 1e5 : 0);
    u.uSockX!.value = t < this.tS0 ? -1e5 : t >= this.tS1 ? 1e5 : lerp(-G.SIGN_LAMPS.hw, G.SIGN_LAMPS.hw, prog(t, this.tS0, this.tS1));
    u.uChase!.value = prog(t, this.GO + 0.05, this.GO + 0.5);
    const b = audio.beatAt(t);
    u.uTw!.value = 0.06 * (Math.floor(b) + ease.outExpo(clamp((b - Math.floor(b)) * 4)));
    // rings
    const rv = u.uRing!.value as THREE.Vector4[];
    const live = this.rings.filter((r) => t >= r.t && t - r.t < 0.9).slice(-3);
    for (let i = 0; i < 3; i++) {
      const r = live[i];
      if (!r) { rv[i]!.set(0, 0, 0, 0); continue; }
      const a = t - r.t;
      rv[i]!.set(r.x, r.y, 1900 * Math.pow(a, 0.85), r.a * Math.exp(-a / 0.22) * endK);
    }
    // flashes
    const fv = u.uFlash!.value as THREE.Vector4[];
    const fl = this.flashes.filter((q) => t >= q.t && t - q.t < 0.3).slice(-4);
    const flW: { x: number; y: number; I: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const q = fl[i];
      if (!q) { fv[i]!.set(0, 0, 0, 0); continue; }
      const p = s2w(cam, q.sx, q.sy);
      const I = 0.85 * q.I * Math.exp(-(t - q.t) / 0.07) * endK;
      fv[i]!.set(p.x, p.y, I, 380);
      flW.push({ x: p.x, y: p.y, I });
    }
    this.pass.render(renderer, out);

    this.lines.clear(); this.glow.clear();
    const L = this.L; L.clear();
    const c = L.ctx;
    this.drawStreet(t, cam, flW);
    this.drawBoard(c, t, cam);
    this.drawLamps(t, cam, nLit, bang, f.a.kick, endK);
    this.drawTraces(t, cam);
    this.drawBang(t, cam, endK);
    this.drawFlashes(t, endK);
    this.drawNotes(c, t, cam, nLit);
    this.lines.render(renderer, out);
    comp.draw(renderer, L.upload(), out);
    this.glow.render(renderer, out);

    // ---- post: still at both hand-offs; kicks shake a little, letters jolt, the "!" and the tilt kick
    const calm = prog(t, this.GO + 0.1, this.GO + 0.3) * (1 - prog(t, this.tTilt + 0.15, this.tTilt + 0.3));
    let jolt = 0;
    for (const g of this.glyphs) jolt = Math.max(jolt, pulse(t, g.tg, 0.045));
    const sa = (1.4 * f.a.kick + 2.2 * jolt + 8 * bang) * calm;
    let fsum = 0;
    for (const q of fl) fsum += q.I * Math.exp(-(t - q.t) / 0.03);
    return {
      bloom: 0.62, halation: 0.26, vignette: 0.38, grain: 0.055,
      ca: 1.1 + 2.5 * bang * calm,
      flash: 0.018 * fsum * endK,
      zoom: 1 + 0.018 * bang * calm,
      shake: [sa * noise1(t * 45, 1), sa * noise1(t * 43, 2)],
    };
  }

  // ---------------------------------------------------------------- the board and its letters
  drawBoard(c: CanvasRenderingContext2D, t: number, cam: Cam) {
    const INK = LIN.ink;
    const P = (x: number, y: number) => w2s(cam, x, y);
    // rails: drawn in by a pen, left to right, hot at the head, cooling to ink
    this.rows.forEach((row, ri) => {
      const t0 = this.GO + 0.02 + ri * 0.07, dur = 0.2;
      const k = prog(t, t0, t0 + dur, ease.outCubic);
      if (k <= 0) return;
      for (const [y, wd] of [[row.top - 14, 3.2], [row.base + 14, 3.2]] as const) {
        const xa = -482, xb = lerp(-482, 482, k);
        const n = 24;
        for (let i = 0; i < n; i++) {
          const x0 = lerp(xa, 482, i / n), x1 = Math.min(lerp(xa, 482, (i + 1) / n), xb);
          if (x1 <= x0) break;
          const age = t - (t0 + dur * ((x0 + 482) / 964));
          const col = age < 0.05 ? sc(LIN.signal, 1.1) : mixc(sc(LIN.signal, 1.0), INK, smoothstep(0.05, 0.35, age));
          const a = P(x0, y), bq = P(x1, y);
          this.lines.seg2(a.x, a.y, bq.x, bq.y, wd * cam.z, col, 0.92);
          const a2 = P(x0, y + 3.6), b2 = P(x1, y + 3.6);
          this.lines.seg2(a2.x, a2.y, b2.x, b2.y, 0.9 * cam.z, sc(LIN.graphite, 0.7), 0.7);
        }
        if (k < 1) { const h = P(xb, y); this.glow.seg2(h.x, h.y, h.x + 0.01, h.y, 5 * cam.z, sc(LIN.ember, 2.4), 1); }
      }
    });
    // letters and their clips
    camTransform(c, cam);
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.font = font(this.fam, this.size);
    let set = 0;
    for (const g of this.glyphs) {
      const ts = g.tg - 0.065;
      if (t < Math.max(ts, this.GO)) continue;
      const row = this.rows[g.row]!;
      const a = t - g.tg;
      let yo = 0, rot = g.rot0, al = 1;
      if (a < 0) { const q = clamp((t - ts) / 0.065); yo = -DROP * (1 - q) * (1 - q); al = prog(q, 0, 0.35); }
      else { yo = -7 * Math.exp(-a / 0.045) * Math.abs(Math.sin(a * 48)); rot = g.rot0 * Math.exp(-a / 0.1) * Math.cos(a * 38); set++; }
      const col = hotInk(Math.max(0, a), al);
      c.save();
      c.translate(g.x + g.w / 2, row.top - 14 + yo);
      c.rotate(rot);
      c.fillStyle = col;
      c.fillText(g.ch, -g.w / 2, 14 + this.cap);
      // the clips that hold the letter in its tracks
      c.fillRect(-6, -4, 12, 7);
      c.fillRect(-6, 28 + this.cap - 4, 12, 7);
      c.restore();
    }
    // slot numbers under each bottom rail, the board's plate (it counts the letters)
    const plateA = prog(t, this.GO + 0.15, this.GO + 0.3);
    if (plateA > 0) {
      c.font = font(F.mono(500), 8);
      c.textAlign = 'center';
      this.rows.forEach((row, ri) => {
        const t0 = this.GO + 0.02 + ri * 0.07;
        for (let k = 0; k < 24; k++) {
          const x = -480 + (k + 0.5) * 40;
          const tk = t0 + 0.2 * ((x + 482) / 964);
          if (t < tk) continue;
          c.fillStyle = rgba('graphite', 0.8 * plateA);
          c.fillText(String(k + 1).padStart(2, '0'), x, row.base + 30);
        }
      });
      c.textAlign = 'right';
      c.font = font(F.mono(600), 10);
      c.fillStyle = rgba('graphite', 0.9 * plateA);
      c.letterSpacing = '2px';
      c.fillText(`BOARD A · 2 × 24 SLOTS · LETTERS ${String(set).padStart(2, '0')}/${this.glyphs.length}`, 484, G.BOARD.hh - 10);
      c.textAlign = 'left';
      c.fillText('TRACK 1', -484, this.rows[0]!.top - 24);
      c.fillText('TRACK 2', -484, this.rows[1]!.top - 24);
      c.letterSpacing = '0px';
    }
    // the serial numbers: FRAMES, ticking (banknote red)
    const sA = smoothstep(0, 0.05, this.revealAge(t, -530, -296));
    if (sA > 0) {
      const n = frames(t);
      c.font = font(F.mono(600), 15);
      c.letterSpacing = '1.5px';
      c.fillStyle = rgba('signal', 0.92 * sA);
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.fillText(`SERIES 2026 · No. ${pad6(n)}`, -530, -296);
      c.textAlign = 'right';
      c.fillText(`No. ${pad6(n)} · SERIES 2026`, 530, 300);
      c.letterSpacing = '0px';
      c.textBaseline = 'alphabetic';
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    // sparks where each letter lands on its rail
    for (let i = 0; i < this.glyphs.length; i++) {
      const g = this.glyphs[i]!;
      const a = t - g.tg;
      if (a < 0 || a > 0.4) continue;
      const row = this.rows[g.row]!;
      const hx = g.x + g.w / 2, hy = row.base + 12;
      sparkParticles(this.glow, t, (tb) => (tb >= g.tg && tb < g.tg + 0.03 ? w2s(this.camAt(tb), hx, hy) : null), { rate: 700, speed: 170, life: 0.3, gravity: 800, intensity: 0.75, seed: 11 + i, width: 1.1 });
    }
  }

  // ---------------------------------------------------------------- lamps
  lamp(x: number, y: number, cam: Cam, I: number, strike: number, size = 1) {
    const p = w2s(cam, x, y);
    if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) return;
    const z = cam.z * size;
    this.glow.seg2(p.x, p.y, p.x + 0.01, p.y, 24 * z, sc(LIN.signal, 0.28 * I), 0.55);
    this.glow.seg2(p.x, p.y, p.x + 0.01, p.y, 8 * z, sc(LIN.ember, 1.9 * I), 1);
    if (strike > 0.02) this.glow.seg2(p.x, p.y, p.x + 0.01, p.y, 4.5 * z, [6 * strike, 5 * strike, 4 * strike], 1);
  }
  socket(x: number, y: number, cam: Cam, a: number, size = 1) {
    if (a <= 0) return;
    const p = w2s(cam, x, y);
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) return;
    this.lines.seg2(p.x, p.y, p.x + 0.01, p.y, 6 * cam.z * size, sc(LIN.graphite, 0.55), 0.8 * a);
    this.lines.seg2(p.x, p.y, p.x + 0.01, p.y, 2.4 * cam.z * size, sc(LIN.ink, 1), 0.9 * a);
  }

  drawLamps(t: number, cam: Cam, nLit: number, bang: number, kick: number, endK: number) {
    const au = this.ctx.audio;
    const phase = Math.floor(au.beatAt(t) * 2); // the chase advances in 1/8 notes
    const fid = frameIdx(t);
    const chaseLamp = (l: Lamp & { tl: number }, size: number, seed: number) => {
      const rv = smoothstep(0, 0.05, this.revealAge(t, l.x, l.y));
      if (t < l.tl) { this.socket(l.x, l.y, cam, rv, size); return; }
      const a = t - l.tl;
      const on = ((l.k + phase) % 3 + 3) % 3 === 0;
      const base = a < 0.14 ? 1.3 : on ? 1 : 0.22;
      const I = base * (1 + 0.45 * kick + 0.8 * bang) * (0.94 + 0.06 * hash(l.k, fid, seed));
      this.lamp(l.x, l.y, cam, I, Math.exp(-a / 0.05), size);
    };
    for (const l of this.chase) chaseLamp(l, 1, 3);
    for (const l of this.signLamps) {
      if (t < this.tS0 - 0.4) { this.socket(l.x, l.y, cam, smoothstep(0, 0.05, this.revealAge(t, l.x, l.y)), 1); continue; }
      chaseLamp(l, 1, 4);
    }
    // soffit downlights (steady)
    for (const s of this.soffit) {
      if (t < s.tl) { this.socket(s.x, 428, cam, smoothstep(0, 0.05, this.revealAge(t, s.x, 428)), 1.2); continue; }
      this.lamp(s.x, 428, cam, 0.8 * (1 + 0.2 * kick), Math.exp(-(t - s.tl) / 0.05), 1.2);
    }
    // TONIGHT!: sockets wired by the pen, lamps struck as sung
    const wired = (x: number) => t >= this.tS1 || (t >= this.tS0 && x <= lerp(-G.SIGN_LAMPS.hw, G.SIGN_LAMPS.hw, prog(t, this.tS0, this.tS1)));
    for (const bl of this.bulbs) {
      if (t < bl.tl) { if (wired(bl.x)) this.socket(bl.x, bl.y, cam, 1, 0.85); continue; }
      const a = t - bl.tl;
      const fl = 0.93 + 0.07 * hash(bl.k, fid, 9);
      const I = 1.25 * (1 + 0.35 * kick + 1.3 * bang) * fl;
      this.lamp(bl.x, bl.y, cam, I, Math.exp(-a / 0.06), 0.85);
    }
    void nLit; void endK;
  }

  // ---------------------------------------------------------------- traces: sparks laying the lamps
  drawTraces(t: number, cam: Cam) {
    const HOT: RGB = [5.5, 4.6, 3.6];
    const wake = (age: number): RGB | null => {
      if (age < 0 || age > 0.9) return null;
      const tip = Math.exp(-age / 0.05), wk = Math.exp(-age / 0.32);
      return [HOT[0] * tip + LIN.signal[0] * 1.6 * wk, HOT[1] * tip + LIN.signal[1] * 1.6 * wk, HOT[2] * tip + LIN.signal[2] * 1.6 * wk];
    };
    // the canopy: two sparks from the top centre, one each way, to the bottom centre
    if (t > this.tC0 && t < this.tC1 + 1.0) {
      const k = prog(t, this.tC0, this.tC1);
      const sNow = k * HALF_P;
      for (const dir of [1, -1]) {
        const step = 14;
        for (let s = 0; s < sNow; s += step) {
          const s1 = Math.min(s + step, sNow);
          const age = t - (this.tC0 + ((s + s1) / 2 / HALF_P) * (this.tC1 - this.tC0));
          const col = wake(age);
          if (!col) continue;
          const a = rectAt(0, 0, G.STRIP.hw, G.STRIP.hh, dir * s), bq = rectAt(0, 0, G.STRIP.hw, G.STRIP.hh, dir * s1);
          const pa = w2s(cam, a.x, a.y), pb = w2s(cam, bq.x, bq.y);
          this.glow.seg2(pa.x, pa.y, pb.x, pb.y, 2.2 * cam.z + 0.6, col, 1);
        }
        const headAt = (tb: number) => {
          if (tb < this.tC0 || tb > this.tC1) return null;
          const q = rectAt(0, 0, G.STRIP.hw, G.STRIP.hh, dir * prog(tb, this.tC0, this.tC1) * HALF_P);
          return w2s(this.camAt(tb), q.x, q.y);
        };
        sparkParticles(this.glow, t, headAt, { rate: 160, speed: 260, intensity: 1.1, seed: dir > 0 ? 21 : 22, width: 1.6 });
        if (k < 1) { const h = rectAt(0, 0, G.STRIP.hw, G.STRIP.hh, dir * sNow); const p = w2s(cam, h.x, h.y); sparkHead(this.glow, p.x, p.y, t, 0.9, 1.2); }
      }
    }
    // the sign: the wiring pen runs its top and bottom edges left to right, 0.4 s before "tonight!"
    if (t > this.tS0 && t < this.tS1 + 1.0) {
      const SL = G.SIGN_LAMPS;
      const k = prog(t, this.tS0, this.tS1);
      for (const y of [G.SIGN.cy - SL.hh, G.SIGN.cy + SL.hh]) {
        const n = 60;
        for (let i = 0; i < n; i++) {
          const x0 = lerp(-SL.hw, SL.hw, i / n), x1 = lerp(-SL.hw, SL.hw, (i + 1) / n);
          if (x0 > lerp(-SL.hw, SL.hw, k)) break;
          const age = t - lerp(this.tS0, this.tS1, (i + 0.5) / n);
          const col = wake(age);
          if (!col) continue;
          const pa = w2s(cam, x0, y), pb = w2s(cam, Math.min(x1, lerp(-SL.hw, SL.hw, k)), y);
          this.glow.seg2(pa.x, pa.y, pb.x, pb.y, 2.2 * cam.z + 0.6, col, 1);
        }
        const headAt = (tb: number) => (tb < this.tS0 || tb > this.tS1 ? null : w2s(this.camAt(tb), lerp(-SL.hw, SL.hw, prog(tb, this.tS0, this.tS1)), y));
        sparkParticles(this.glow, t, headAt, { rate: 150, speed: 240, intensity: 1.0, seed: y < G.SIGN.cy ? 31 : 32, width: 1.5 });
        if (k < 1) { const p = w2s(cam, lerp(-SL.hw, SL.hw, k), y); sparkHead(this.glow, p.x, p.y, t, 0.8, 1.1); }
      }
    }
  }

  // ---------------------------------------------------------------- the "!": detonation streaks
  drawBang(t: number, cam: Cam, endK: number) {
    const age = t - this.tBang;
    if (age < 0 || age > 0.5) return;
    const B = this.tg.bang;
    const grow = ease.outExpo(clamp(age / 0.9));
    const fade = (1 - prog(age, 0.1, 0.36)) * endK;
    for (const s of this.streaks) {
      const r1 = s.r0 + grow * s.sp * 1150;
      const tail = Math.max(s.r0, r1 - s.len * (0.3 + grow));
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const p = w2s(cam, B.x + ca * tail, B.y + sa * tail), q = w2s(cam, B.x + ca * r1, B.y + sa * r1);
      const col: RGB = s.hot ? sc(LIN.ember, 2.6) : sc(LIN.bone, 0.55);
      this.glow.seg2(p.x, p.y, q.x, q.y, s.hot ? 1.7 : 1, col, fade * (1 - grow * 0.4));
    }
    const hb = w2s(cam, B.x, B.y);
    sparkParticles(this.glow, t, (tb) => (tb >= this.tBang && tb < this.tBang + 0.05 ? w2s(this.camAt(tb), B.x, B.y) : null), { rate: 1400, speed: 520, life: 0.5, intensity: 1.2, seed: 41, width: 1.8 });
    const h = Math.pow(0.5, age / 0.08);
    if (h > 0.02) sparkHead(this.glow, hb.x, hb.y, t, 0.8 + 0.7 * h, h * 1.2);
  }

  // ---------------------------------------------------------------- the crowd's flashbulbs (screen space)
  drawFlashes(t: number, endK: number) {
    for (const q of this.flashes) {
      const a = t - q.t;
      if (a < 0 || a > 0.3) continue;
      const e1 = Math.exp(-a / 0.028), e2 = Math.exp(-a / 0.075);
      const I = q.I * endK;
      this.glow.seg2(q.sx, q.sy, q.sx + 0.01, q.sy, 90, sc(LIN.ember, 0.22 * e2 * I), 0.5);
      this.glow.seg2(q.sx, q.sy, q.sx + 0.01, q.sy, 26, sc(LIN.ember, 1.6 * e2 * I), 0.8);
      this.glow.seg2(q.sx, q.sy, q.sx + 0.01, q.sy, 9, [7 * e1 * I, 6.4 * e1 * I, 5.6 * e1 * I], 1);
    }
  }

  // ---------------------------------------------------------------- street level: doors, box office, posters, ropes
  drawStreet(t: number, cam: Cam, fl: { x: number; y: number; I: number }[]) {
    const P = (x: number, y: number) => w2s(cam, x, y);
    const seg = (ax: number, ay: number, bx: number, by: number, wd: number, k = 1) => {
      const I = this.lightCPU(t, (ax + bx) / 2, (ay + by) / 2, fl) * k;
      if (I <= 0.003) return;
      const a = P(ax, ay), bq = P(bx, by);
      if (Math.max(a.y, bq.y) < -10 || Math.min(a.y, bq.y) > H + 10) return;
      this.lines.seg2(a.x, a.y, bq.x, bq.y, Math.max(0.8, wd * cam.z), sc(LIN.bone, I), Math.min(1, (wd * cam.z) / 0.8));
    };
    const rect = (x0: number, y0: number, x1: number, y1: number, wd: number, k = 1) => {
      seg(x0, y0, x1, y0, wd, k); seg(x1, y0, x1, y1, wd, k); seg(x1, y1, x0, y1, wd, k); seg(x0, y1, x0, y0, wd, k);
    };
    const top = G.DOORS.y0 + 12, bot = G.DOORS.y1;
    // doors: frames, glass, push bars, a reflection
    for (const [x0, x1] of [[-560, -400], [-380, -220], [220, 380], [400, 560]] as const) {
      rect(x0, top, x1, bot, 1.6);
      rect(x0 + 12, top + 12, x1 - 12, bot - 40, 0.9, 0.8);
      seg(x0 + 22, bot - 88, x1 - 22, bot - 88, 2.4, 0.9);
      for (let j = 0; j < 3; j++) seg(x0 + 20 + j * 14, top + 90 + j * 10, x0 + 60 + j * 14, top + 30 + j * 10, 0.7, 0.5);
      for (let y = bot - 36; y < bot; y += 6) seg(x0 + 4, y, x1 - 4, y, 0.6, 0.35);
    }
    // the box office: a booth with an arched window and a ticket slot
    rect(-150, top + 58, 150, bot, 1.6);
    const arc = (cx: number, cy: number, r: number, a0: number, a1: number, wd: number, k = 1) => {
      const n = 28;
      for (let i = 0; i < n; i++) {
        const u0 = lerp(a0, a1, i / n), u1 = lerp(a0, a1, (i + 1) / n);
        seg(cx + Math.cos(u0) * r, cy + Math.sin(u0) * r, cx + Math.cos(u1) * r, cy + Math.sin(u1) * r, wd, k);
      }
    };
    arc(0, top + 130, 90, Math.PI, TAU, 1.2);
    seg(-90, top + 130, -90, top + 200, 1.2); seg(90, top + 130, 90, top + 200, 1.2); seg(-110, top + 200, 110, top + 200, 1.6);
    seg(-40, top + 196, 40, top + 196, 3, 0.8);
    for (let y = top + 212; y < bot - 6; y += 7) seg(-146, y, 146, y, 0.6, 0.35);
    // poster cases
    for (const sx of [-1, 1]) {
      rect(sx * 570, top + 6, sx * 730, bot - 10, 1.8);
      rect(sx * 580, top + 16, sx * 720, bot - 20, 0.8, 0.7);
    }
    // the velvet ropes along the carpet: posts at ground depths, ropes sagging between them
    const post = (yg: number, side: number) => {
      const yy = yg - G.VPY, s = yy / 420;
      const x = side * (0.42 * yy + 26 * s);
      return { x, y: yg, h: 78 * s, s };
    };
    for (const side of [-1, 1]) {
      const ps = [690, 745, 805].map((yg) => post(yg, side));
      for (const p of ps) {
        seg(p.x, p.y, p.x, p.y - p.h, 2.2 * p.s, 0.9);
        seg(p.x - 9 * p.s, p.y, p.x + 9 * p.s, p.y, 2 * p.s, 0.8);
        seg(p.x - 3 * p.s, p.y - p.h - 4 * p.s, p.x + 3 * p.s, p.y - p.h - 4 * p.s, 5 * p.s, 0.9);
      }
      for (let i = 1; i < ps.length; i++) {
        const a = ps[i - 1]!, q = ps[i]!;
        const n = 10;
        for (let j = 0; j < n; j++) {
          const u0 = j / n, u1 = (j + 1) / n;
          const y0 = lerp(a.y - a.h, q.y - q.h, u0) + 22 * a.s * 4 * u0 * (1 - u0), y1 = lerp(a.y - a.h, q.y - q.h, u1) + 22 * a.s * 4 * u1 * (1 - u1);
          seg(lerp(a.x, q.x, u0), y0, lerp(a.x, q.x, u1), y1, 2.6 * a.s, 0.75);
        }
      }
    }
  }

  // ---------------------------------------------------------------- leaders, deadpan notes, the HUD
  pen(a: { x: number; y: number }, b: { x: number; y: number }, t: number, t0: number, dur: number, alpha: number, w = 1) {
    const k = prog(t, t0, t0 + dur, ease.outCubic);
    if (k <= 0 || alpha <= 0) return 0;
    const hx = lerp(a.x, b.x, k), hy = lerp(a.y, b.y, k);
    const age = t - (t0 + dur * 0.5);
    const col: RGB = age < 0.08 ? mixc(sc(LIN.ember, 2.2), sc(LIN.signal, 1.5), clamp(age / 0.08)) : mixc(sc(LIN.signal, 1.5), sc(LIN.bone, 0.5), smoothstep(0.08, 0.4, age));
    this.lines.seg2(a.x, a.y, hx, hy, w, col, alpha);
    if (k < 1) this.glow.seg2(hx, hy, hx + 0.01, hy, 5, sc(LIN.ember, 2.2 * alpha), 0.9);
    return k;
  }
  label(c: CanvasRenderingContext2D, s: string, x: number, y: number, t: number, t0: number, alpha: number, o: { size?: number; align?: CanvasTextAlign; cool?: string; w?: number } = {}) {
    if (alpha <= 0 || t < t0) return;
    const n = Math.min(s.length, Math.floor((t - t0) * 70));
    if (n <= 0) return;
    c.font = font(F.mono(o.w ?? 500), o.size ?? 13);
    c.textAlign = o.align ?? 'left';
    c.letterSpacing = '1.5px';
    c.fillStyle = hotCss(t - t0 - n / 70, alpha, o.cool ?? 'bone');
    c.fillText(s.slice(0, n), x, y);
    c.letterSpacing = '0px';
  }
  note(c: CanvasRenderingContext2D, t: number, cam: Cam, anchor: [number, number], elbow: [number, number], l1: string, l2: string, t0: number, alpha: number) {
    if (t < t0 || alpha <= 0) return;
    const q = w2s(cam, anchor[0], anchor[1]), e = w2s(cam, elbow[0], elbow[1]);
    const right = e.x > q.x;
    const end = { x: e.x + (right ? 200 : -200), y: e.y };
    this.glow.seg2(q.x, q.y, q.x + 0.01, q.y, 5, sc(LIN.ember, 1.6 * alpha * prog(t, t0, t0 + 0.1)), 1);
    this.pen(q, e, t, t0, 0.16, 0.75 * alpha);
    this.pen(e, end, t, t0 + 0.14, 0.16, 0.75 * alpha);
    const lx = right ? e.x + 4 : e.x - 4;
    this.label(c, l1, lx, e.y - 8, t, t0 + 0.16, 0.9 * alpha, { size: 13, align: right ? 'left' : 'right', w: 600 });
    this.label(c, l2, lx, e.y + 18, t, t0 + 0.28, 0.6 * alpha, { size: 11, align: right ? 'left' : 'right', cool: 'ash' });
  }

  drawNotes(c: CanvasRenderingContext2D, t: number, cam: Cam, nLit: number) {
    const [, s1, s2, , s4] = this.ws as [number, number, number, number, number];
    const hudA = prog(t, this.GO + 0.15, this.GO + 0.35) * (1 - prog(t, this.tTilt + 0.02, this.tTilt + 0.2));
    if (hudA <= 0) return;
    c.save();
    c.textBaseline = 'alphabetic';
    this.note(c, t, cam, [-G.BOARD.hw, -G.BOARD.hh], [-960, -330], 'BOARD A · CHANGEABLE LETTERS', 'SET BY SONG, NOT BY LADDER', s1 + 0.2, hudA);
    this.note(c, t, cam, [G.CANOPY.hw, -120], [960, -200], 'CHASE · 1/8 NOTE · 122 BPM', 'ADVANCES ON THE HAT. NOBODY ASKED.', this.tC1 + 0.05, hudA);
    this.note(c, t, cam, [G.CANOPY.hw - 60, G.SOFFIT.y1], [960, 520], 'BOX OFFICE · ADMIT ONE (1) PROMPT', 'NO REFUNDS ONCE RENDERED', s2 + 0.3, hudA);
    this.note(c, t, cam, [G.SIGN.hw, G.SIGN.cy - 60], [940, G.SIGN.cy - 140], `LAMPS LIT ${String(nLit).padStart(3, '0')} / ${this.bulbs.length}`, '40 W EACH · ALL ON CUE', s4 + 0.12, hudA);
    // the spec sheet (top left) and the press count (bottom left), screen fixed
    const x0 = 96, y0 = 92;
    this.label(c, 'FIG. 9 — MARQUEE', x0, y0, t, this.GO + 0.18, 0.95 * hudA, { size: 16, w: 600 });
    this.label(c, 'RELEASE DEPT. · ONE NIGHT ONLY', x0, y0 + 26, t, this.GO + 0.3, 0.8 * hudA, { size: 13 });
    this.label(c, 'THE CARET · 1,000 SEATS · 1 SCREEN · 0 EMPTY', x0, y0 + 48, t, s1, 0.5 * hudA, { size: 11, cool: 'ash' });
    const nf = this.flashes.filter((q) => q.t <= t).length;
    if (nf > 0) this.label(c, `PRESS FLASHES ${String(nf).padStart(2, '0')} · CROWD: UNSEEN, LOUD`, x0, H - 96, t, this.flashes[0]!.t, 0.6 * hudA, { size: 11, cool: 'ash' });
    c.restore();
  }
}
