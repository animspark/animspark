// Plate `mix` — "Make it bigger, make it loud" (the sound mix). A short, loud plate: every frame a hit.
//   H11 in: dark, one hot dot at frame centre = the jewel pivot of the lead-vocal VU needle. The meter lamp
//        strikes on the downbeat and the camera log-zooms back off the pivot: an engraved meter bridge lights
//        up outward from it (VU movement with a real 300 ms-ish ballistic on the song's rms, L/R LED ladders,
//        a 48-band RTA from the mel spectrogram, bus meters, phase, loudness, the transport with FRAMES, a
//        patchbay). MAKE and IT are printed on the meter face (a signal strike that cools to ink); nods.
//   "bigger,": the camera tilts down to channel 07 (LEAD VOX · ONE PROMPT). BIGGER is the channel's
//        signal, set in its signal window and read against the window's dB scale; the fader slams up on
//        the word and the 16ths after it, and each slam steps Archivo's width (62 → 87.5 → 112.5 → 125) and
//        weight (300 → 900), a spring hiding the steps. On the third it fills the window flush (the walls
//        bow), on the fourth it breaks out through the window and the strip's own wall into channel 08
//        (QC: HEADROOM 0.0 dB).
//   "make it loud": whip to the master section. The 2-bus scope scrolls the real envelope between its
//        0 dBFS lines (the rails); MAKE IT rides it; on LOUD the master gain jumps, the waveform squares off,
//        LOUD slams in taller than the rails and is hard-clipped: its tops and bottoms are sheared off and fly,
//        the rails run hot and shoot out across the frame, CLIP LEDs latch, the needles pin and rattle.
//   H12 out: on the next kick the desk's lamps die, LOUD is squeezed flat into the rails; the last frame is
//        dark with the two signal rails across the full frame at RAILS_H12 (y 300 / 780).
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, layout, glyphX, type TextLayout } from '../px/type';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep, springStep, frameIdx } from '../px/util';
import { wStart, wEnd, wText } from './lyric';
import { DOT_H11, frames } from './handoff';
import { B, C, COMP, type RGB, css, db, faderFrac, FADER_MARKS, grp, heatCss, flashCss, heatFaceCss, heatLin, hexRGB, mix3, peakLevel, sgn, tc24, vuLevel, vuPos } from './mix-kit';
import { type D2, type Box, MONO, MONO_R, button, drawLadder, drawRTA, drawVU, fragment, knob, label, ledBar, plate, recoil, screw, trip, vis } from './mix-desk';

type Cam = { x: number; y: number; z: number };
const lerpCam = (p: Cam, q: Cam, k: number): Cam => ({ x: lerp(p.x, q.x, k), y: lerp(p.y, q.y, k), z: Math.exp(lerp(Math.log(p.z), Math.log(q.z), k)) });
const oe = (t: number, t0: number, d = 0.18) => ease.outExpo(prog(t, t0, t0 + d));

const BW = [62, 87.5, 112.5, 125], BWT = [300, 500, 700, 900], BSC = [1, 1.06, 1.12, 1.2];
const FADER_DB = [-30, -10, -4, 1, 10]; // before the word, then at each slam
const Z0 = 3; // first-frame zoom on the pivot: the jewel (r 2 world px) is DOT_H11's r 6

export default class Plate extends Scene {
  L = new Layer2D();
  G = new LineBatch(24000, { blend: 'add' });
  comp!: FSPass;
  T0 = 0; T1 = 0;
  tMake = 0; tIt = 0; tBig = 0; st: number[] = []; tMake2 = 0; tIt2 = 0; tLoud = 0; tOut = 0; tCol0 = 0; tCol1 = 0;
  CAP = 0.686;
  // lyric type
  faceFam = F.archivo(100, 900); faceSize = 124; faceText = ''; faceX0 = 0; faceItX = 0;
  bigText = ''; bigFams: string[] = []; bigLays: TextLayout[] = []; S0 = 200; winT = 850; padX = 28; base = 1120;
  cText = ''; cFam = F.archivo(100, 900); cSize = 240; cItX = 0;
  loudText = ''; loudFam = F.archivo(62, 900); loudSize = 870; loudLay!: TextLayout;

  override init() {
    const { start, end, audio: au } = this.ctx;
    this.T0 = start; this.T1 = end;
    const mc = document.createElement('canvas').getContext('2d')!;
    mc.font = font(F.archivo(100, 900), 1000);
    this.CAP = mc.measureText('H').actualBoundingBoxAscent / 1000;
    this.tMake = wStart(70); this.tIt = wStart(71); this.tBig = wStart(72);
    this.tMake2 = wStart(73); this.tIt2 = wStart(74); this.tLoud = wStart(75);
    // BIGGER's slams: the word, then the next three 16ths
    let q = Math.ceil(au.beatAt(this.tBig + 0.1) * 4 - 1e-3) / 4;
    this.st = [this.tBig];
    while (this.st.length < 4) { this.st.push(au.timeOfBeat(q)); q += 0.25; }
    // the exit: the first kick a quarter-second into LOUD kills the lamps; LOUD collapses into the rails
    const k = au.events('kick', this.tLoud + 0.25, end - 0.12)[0];
    this.tOut = k ? k[0] : this.tLoud + 0.34;
    this.tCol0 = this.tOut + 0.06; this.tCol1 = end - 0.03;

    // the face legend: MAKE IT
    this.faceText = `${wText(70)} ${wText(71)}`.toUpperCase();
    const fl = layout(this.faceText, this.faceFam, this.faceSize);
    this.faceX0 = -fl.width / 2; this.faceItX = glyphX(this.faceText, wText(70).length + 1, this.faceFam, this.faceSize);
    // BIGGER, stages: the third fills the window flush, the fourth breaks out
    this.bigText = wText(72).toUpperCase();
    this.bigFams = BW.map((w, i) => F.archivo(w, BWT[i]!));
    const l100 = this.bigFams.map((f) => layout(this.bigText, f, 100));
    this.S0 = (B.winR - B.winL - 2 * this.padX) / ((l100[2]!.width / 100) * BSC[2]!);
    this.bigLays = this.bigFams.map((f) => layout(this.bigText, f, this.S0));
    this.base = B.winB - 44;
    this.winT = this.base - this.CAP * this.S0 * BSC[2]! - 22;
    // master: MAKE IT between the rails, LOUD taller than them
    this.cText = `${wText(73)} ${wText(74)}`.toUpperCase();
    this.cSize = 190 / this.CAP;
    this.cItX = glyphX(this.cText, wText(73).length + 1, this.cFam, this.cSize);
    this.loudText = wText(75).toUpperCase();
    const capL = 610;
    this.loudSize = capL / this.CAP;
    for (const w of [125, 112.5, 100, 87.5, 75, 62]) {
      const f = F.archivo(w, 900);
      if (layout(this.loudText, f, this.loudSize).width <= W - 90 || w === 62) { this.loudFam = f; break; }
    }
    this.loudLay = layout(this.loudText, this.loudFam, this.loudSize);
    this.comp = new FSPass(COMP, { tex: { value: this.L.texture }, cam: { value: new THREE.Vector2() }, zoom: { value: 1 }, lamp: { value: 0 }, hot: { value: 0.9 } });
  }

  // ------------------------------------------------------------------ time
  /** channel 07's fader (dB): slams on each BIGGER step, springs overshoot */
  fader(t: number) {
    let v = FADER_DB[0]!;
    for (let i = 0; i < 4; i++) v += (FADER_DB[i + 1]! - FADER_DB[i]!) * springStep(t - this.st[i]!, 6.5, 0.42);
    return v;
  }
  /** gain on the level meters (dB over nominal) */
  gain(t: number) { return Math.max(0, this.fader(t) + 10) * 0.8; }
  /** master gain on the 2-bus (dB): the scope, master meters */
  gainM(t: number) { return 3 * oe(t, this.tMake2, 0.05) + 3 * oe(t, this.tIt2, 0.05) + 16 * oe(t, this.tLoud, 0.03); }
  /** the lamps: strike just after the first frame (incandescent warm-up with a flicker), die on tOut */
  lamp(t: number) {
    const fi = frameIdx(t);
    let on = prog(t, this.T0 + 0.012, this.T0 + 0.2) ** 0.6;
    if (t < this.T0 + 0.1) on *= 0.45 + 0.55 * hash(fi, 71);
    let off = 1;
    if (t >= this.tOut) off = (1 - prog(t, this.tOut, this.tOut + 0.08)) * (hash(fi, 72) > 0.45 ? 1 : 0.25);
    return on * off;
  }
  /** the needle of the lead-vocal VU (A) */
  vuA(t: number) { return clamp(vuPos(db(vuLevel(this.ctx.audio, t)) + 0.5 * this.gain(t) - 1.5), -0.045, 1.075); }
  /** master VU needles: pinned after LOUD, rattling against the stop */
  vuM(t: number, ch: number) {
    const lv = vuLevel(this.ctx.audio, t, ch ? 'mid' : 'low') * 0.5 + vuLevel(this.ctx.audio, t) * 0.5;
    const raw = vuPos(db(lv) + this.gainM(t) - 3.5 + ch * 0.6);
    if (raw < 1.075) return clamp(raw, -0.045, 1.075);
    const rat = Math.abs(noise1(t * 38, 5 + ch)) * 0.035 * (0.4 + this.ctx.audio.hit('kick', t, 0.08));
    return 1.075 - rat;
  }

  camAt(t: number): Cam {
    t = Math.max(t, this.T0);
    const T0 = this.T0, [s0, s1, s2, s3] = this.st as [number, number, number, number];
    // A: log-zoom back off the pivot; nods on MAKE and IT; a creep toward B before the tilt
    const pull = ease.outExpo(prog(t, T0 + 0.008, T0 + 0.56)); // held for the hand-off frame, then snaps
    // first frame: the pivot (world origin) sits on DOT_H11
    const z0 = Z0 * (DOT_H11.r / 6), ox = (W / 2 - DOT_H11.x) / z0, oy = (H / 2 - DOT_H11.y) / z0;
    let cam: Cam = { x: lerp(ox, 0, pull), y: lerp(oy, -250, pull), z: Math.exp(lerp(Math.log(z0), Math.log(0.88), pull)) };
    cam.z *= (1 + 0.06 * oe(t, this.tMake)) * (1 + 0.05 * oe(t, this.tIt));
    cam.z *= 1 + 0.035 * prog(t, T0 + 0.4, s0);
    cam.x += 36 * prog(t, T0 + 0.3, s0);
    cam.y += 30 * oe(t, this.tMake) + 50 * prog(t, s0 - 0.3, s0);
    // B: channel 07; nods on the slams, then a step back as BIGGER breaks out
    const kB = ease.outExpo(prog(t, s0 - 0.03, s0 + 0.2));
    if (kB > 0) {
      const b: Cam = { x: -20 + 250 * oe(t, s3, 0.2), y: B.cy + 20 + 40 * oe(t, s3, 0.2), z: 1.15 * (1 + 0.03 * oe(t, s1, 0.12)) * (1 + 0.03 * oe(t, s2, 0.12)) * (1 - 0.17 * oe(t, s3, 0.2)) };
      b.x += 25 * prog(t, s3 + 0.05, this.tMake2);
      cam = lerpCam(cam, b, kB);
    }
    // C: the master section; a nod on IT, then LOUD snaps it to 1:1 (the rails' hand-off framing)
    const kC = ease.outExpo(prog(t, this.tMake2 - 0.025, this.tMake2 + 0.17));
    if (kC > 0) cam = lerpCam(cam, { x: C.cx - 30 + 30 * prog(t, this.tMake2, this.tLoud), y: C.cy, z: 0.9 * (1 + 0.035 * oe(t, this.tIt2, 0.15)) }, kC);
    const kL = ease.outExpo(prog(t, this.tLoud - 0.01, this.tLoud + 0.12));
    if (kL > 0) cam = lerpCam(cam, { x: C.cx, y: C.camY, z: 1 }, kL);
    return cam;
  }

  // ------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, { renderer, audio: au } = this.ctx;
    const cam = this.camAt(t);
    const lamp = this.lamp(t);
    const G = this.G; G.clear();
    const X = (x: number) => (x - cam.x) * cam.z + W / 2, Y = (y: number) => (y - cam.y) * cam.z + H / 2;
    const Rr = 3600 * ease.outCubic(prog(t, this.T0 + 0.02, this.T0 + 0.7));
    const m = 80 / cam.z;
    const d: D2 = {
      c: this.L.ctx, t, z: cam.z, lamp,
      rev: (x, y) => clamp((Rr - Math.hypot(x, y * 1.2)) / 320) * lamp,
      glow: (ax, ay, bx, by, wPx, rgb, a = 1) => G.seg2(X(ax), Y(ay), X(bx), Y(by), wPx, rgb, a),
      view: { x0: cam.x - W / 2 / cam.z - m, x1: cam.x + W / 2 / cam.z + m, y0: cam.y - H / 2 / cam.z - m, y1: cam.y + H / 2 / cam.z + m },
    };
    const L = this.L; L.clear();
    const c = L.ctx;
    c.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.z * cam.x, H / 2 - cam.z * cam.y);
    c.textBaseline = 'alphabetic';
    c.lineJoin = 'round';

    if (vis(d, -1600, -760, 1600, 400)) this.drawBridge(d);
    if (vis(d, -1600, 520, 1600, 1500)) this.drawChannel(d);
    if (vis(d, 1600, 380, 3600, 1620)) this.drawMaster(d);

    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawQC(c, t);
    L.upload();

    const u = this.comp.u;
    (u.cam!.value as THREE.Vector2).set(cam.x, cam.y);
    u.zoom!.value = cam.z;
    u.lamp!.value = lamp;
    u.hot!.value = -0.12; // fresh type is hot in colour, not in light: glow comes from the light batch only
    this.comp.render(renderer, out);

    // the jewel pivot: DOT_H11 at the first frame, the VU's hot bearing afterwards
    if (vis(d, -30, -30, 30, 30)) {
      const r = Math.max(2 * cam.z, 2.4 * (DOT_H11.r / 6)), I = (1 + 0.35 * f.a.kick * smoothstep(this.T0 + 0.05, this.T0 + 0.2, t)) * (t < this.tOut ? 1 : lamp);
      const px = X(0), py = Y(0);
      G.seg2(px, py, px + 0.01, py, r * 5, [LIN.signal[0] * 0.3 * I, LIN.signal[1] * 0.3 * I, LIN.signal[2] * 0.3 * I], 0.4);
      G.seg2(px, py, px + 0.01, py, r * 2, [LIN.ember[0] * 2.6 * I, LIN.ember[1] * 2.6 * I, LIN.ember[2] * 2.6 * I], 1);
      G.seg2(px, py, px + 0.01, py, r * 1.1, [5 * I, 4.4 * I, 3.6 * I], 1);
    }
    this.drawRails(G, t, cam, X, Y);
    if (G.count) G.render(renderer, out);

    // ---- camera-ish post: hits, slams, LOUD; the first and last frames are still
    const live = smoothstep(this.T0 + 0.01, this.T0 + 0.06, t);
    const settle = 1 - prog(t, this.tOut + 0.02, this.T1 - 0.06);
    let slam = 0;
    this.st.forEach((s, i) => { slam = Math.max(slam, pulse(t, s, 0.05) * (i === 3 ? 1.7 : 0.8)); });
    const loud = pulse(t, this.tLoud, 0.07);
    const pinned = t >= this.tLoud && t < this.tOut ? 1 : 0;
    const sh = (2.5 * f.a.kick + 1.6 * f.a.snare + 8 * slam + 26 * loud + 4 * pinned * (0.5 + f.a.kick)) * live * settle;
    const o: PostOverrides = {
      bloom: 0.62, bloomThreshold: 0.95, bloomKnee: 0.15, bloomRadius: 0.7, halation: 0.22, vignette: 0.42, grain: 0.055,
      ca: 1 + (2.2 * slam + 3 * loud + 0.8 * pinned) * live * settle,
      zoom: 1 + (0.01 * f.a.kick + 0.025 * slam + 0.055 * loud) * live * settle,
      shake: [noise1(t * 45, 1) * sh, noise1(t * 45, 2) * sh],
      flash: 0.1 * pulse(t, this.tLoud, 0.025),
    };
    if (t >= this.T1 - 0.06 || t < this.T0 + 0.01) { o.shake = [0, 0]; o.zoom = 1; o.ca = 1; o.flash = 0; }
    return o;
  }

  // ------------------------------------------------------------------ A: the meter bridge
  private drawBridge(d: D2) {
    const { c, t } = d, au = this.ctx.audio;
    const a0 = d.rev(0, 0);
    // bridge plate, header strip, patchbay
    plate(d, { x0: -1560, y0: -720, x1: 1560, y1: 150 }, d.rev(0, -300) * 0.9, 14);
    const ah = d.rev(0, -680);
    label(d, 'DEPT. 09 — SOUND MIX · STAGE 13', -950, -656, 15, 0.75 * ah);
    label(d, 'ONE PROMPT · MIX 04 · REEL 1 · LEAD VOX', -330, -656, 15, 0.55 * ah);
    label(d, 'METER BRIDGE MB-2 · SERIAL 0001', 950, -656, 15, 0.55 * ah, { align: 'right' });
    for (let i = 0; i < 9; i++) screw(d, -1530 + i * 382.5, -694, 7, d.rev(-1530 + i * 382.5, -694), i + 20);
    c.lineWidth = 1 / d.z; c.strokeStyle = rgba('graphite', 0.6 * ah);
    c.beginPath(); c.moveTo(-1540, -628); c.lineTo(1540, -628); c.stroke();
    // the lead-vocal VU (A)
    const hist: number[] = [];
    for (let k = 0; k < 16; k++) hist.push(this.vuA(t - k * 0.02));
    const face = this.lamp(t);
    const ages = [t - this.tMake, t - this.tIt];
    drawVU(d, {
      x: 0, y: 0, s: 1, pos: hist[0]!, hist, face, title: '07 · LEAD VOX · ONE PROMPT', foot: '0 VU = +4 dBu · 300 ms',
      words: (cc) => {
        cc.font = font(this.faceFam, this.faceSize);
        const x0 = this.faceX0, y = -92;
        const pieces: [string, number, number, number][] = [[wText(70).toUpperCase(), x0, this.tMake, ages[0]!], [wText(71).toUpperCase(), x0 + this.faceItX, this.tIt, ages[1]!]];
        for (const [s, x, ws, age] of pieces) {
          const ghost = smoothstep(ws - 0.4, ws - 0.25, t);
          cc.fillStyle = age >= 0 ? heatFaceCss(age, face) : rgba('ink', 0.13 * ghost * face);
          cc.fillText(s, x, y);
        }
        // the underline hairline the words are set on, with the caret-ish sung mark
        cc.fillStyle = rgba('ink', 0.5 * face);
        cc.fillRect(x0 - 10, y + 14, -2 * x0 + 20, 1.4);
      },
    }, a0);
    // stereo ladders L/R beside the meter
    const lvL = db(peakLevel(au, t, 'low')) + this.gain(t) - 7 + 2.5 * au.hit('kick', t, 0.08), lvR = db(peakLevel(au, t, 'rms')) + this.gain(t) - 6 + 2.5 * au.hit('snare', t, 0.08);
    const phL = db(peakLevel(au, t, 'low', 0.6)) + this.gain(t) - 7, phR = db(peakLevel(au, t, 'rms', 0.6)) + this.gain(t) - 6;
    const al = d.rev(-530, -200);
    drawLadder(d, { x: -575, yb: 40, yt: -470, n: 34, w: 38, dB: lvL, peakdB: phL, clip: 0, name: 'L', marks: true, marksLeft: true }, al);
    drawLadder(d, { x: -525, yb: 40, yt: -470, n: 34, w: 38, dB: lvR, peakdB: phR, clip: 0, name: 'R' }, al);
    label(d, 'PEAK dBFS', -550, 96, 11, 0.5 * al, { align: 'center' });
    // left block: transport (FRAMES), phase, loudness, buses
    const ab = d.rev(-900, -300);
    if (ab > 0.004 && vis(d, -990, -600, -640, 60)) {
      plate(d, { x0: -980, y0: -590, x1: -648, y1: -420 }, ab, 8);
      label(d, 'TRANSPORT', -956, -560, 12, 0.6 * ab);
      label(d, '● REC', -668, -560, 12, ab, { align: 'right', col: 'signal' });
      label(d, `TC ${tc24(t)}`, -956, -512, 30, 0.9 * ab, { w: F.mono(600), track: 1 });
      label(d, `FRAME ${grp(frames(t))}`, -956, -458, 30, 0.9 * ab, { w: F.mono(600), track: 1 });
      // phase correlation
      const corr = clamp(0.5 + 0.8 * (au.env('low', t) - au.env('high', t)), -1, 1);
      const px0 = -950, px1 = -668, py = -350;
      c.lineWidth = 1 / d.z; c.strokeStyle = rgba('ash', 0.5 * ab);
      c.beginPath(); c.moveTo(px0, py); c.lineTo(px1, py);
      for (let i = 0; i <= 20; i++) { const x = lerp(px0, px1, i / 20); c.moveTo(x, py - (i % 5 ? 5 : 11)); c.lineTo(x, py); }
      c.stroke();
      label(d, 'PHASE', px0, py - 26, 12, 0.6 * ab);
      label(d, '−1', px0, py + 22, 11, 0.5 * ab, { align: 'center' }); label(d, '0', (px0 + px1) / 2, py + 22, 11, 0.5 * ab, { align: 'center' }); label(d, '+1', px1, py + 22, 11, 0.5 * ab, { align: 'center' });
      const cx = lerp(px0, px1, (corr + 1) / 2);
      c.fillStyle = rgba('bone', 0.9 * ab); c.fillRect(cx - 2, py - 14, 4, 14);
      // loudness (deadpan)
      const mom = db(vuLevel(au, t)) + 0.5 * this.gain(t) - 8.5;
      const rows: [string, string][] = [
        ['MOMENTARY', `${sgn(mom)} LUFS`], ['SHORT-TERM', `${sgn(mom - 0.8 + 0.3 * noise1(t * 2, 9))} LUFS`],
        ['INTEGRATED', '−10.2 LUFS'], ['TARGET', '−14.0 LUFS (NOTED)'], ['TRUE PEAK', `${sgn(Math.max(lvL, lvR) + 0.4)} dBTP`],
      ];
      label(d, 'LOUDNESS · EBU R128', -956, -272, 12, 0.6 * ab);
      rows.forEach(([k, v], i) => { label(d, k, -956, -236 + i * 30, 13, 0.5 * ab); label(d, v, -668, -236 + i * 30, 15, 0.85 * ab, { align: 'right', w: F.mono(600) }); });
      // bus meters
      const buses: [string, string][] = [['BUS 1 DIALOGUE', 'rms'], ['BUS 2 MUSIC', 'low'], ['BUS 3 FX', 'high'], ['BUS 4 CROWD', 'mid']];
      buses.forEach(([k, band], i) => {
        const y = -60 + i * 30;
        label(d, k, -956, y + 11, 11, 0.55 * ab);
        const lv = db(peakLevel(au, t, band)) + this.gain(t) - 8;
        ledBar(d, -820, -668, y, 12, 30, clamp((lv + 40) / 40), ab);
      });
    }
    // right block: RTA and gain reduction
    const ar = d.rev(750, -300);
    if (ar > 0.004 && vis(d, 460, -560, 1060, 80)) {
      const bands = au.melAt(t), peaks = bands.slice();
      for (let k = 1; k <= 5; k++) { const b2 = au.melAt(t - k * 0.05); for (let i = 0; i < peaks.length; i++) peaks[i] = Math.max(peaks[i]!, b2[i]! * (1 - k * 0.06)); }
      const g = Math.pow(10, this.gain(t) / 40) * 0.95;
      drawRTA(d, { x0: 500, y0: -500, x1: 950, y1: -150 }, bands, peaks, g, ar);
      const gr = clamp((db(peakLevel(au, t)) + this.gain(t) + 8) * 0.9, 0, 20);
      label(d, 'GR · 2-BUS COMP · 4:1 · ATK 10 ms · REL AUTO', 490, -68, 12, 0.6 * ar);
      // gain reduction lights from the right
      const n = 24, x0 = 500, x1 = 950, pitch = (x1 - x0) / n;
      for (let i = 0; i < n; i++) {
        const on = (n - i - 0.5) / n < gr / 20;
        c.fillStyle = on ? rgba(i < 6 ? 'signal' : 'ember', ar) : rgba('graphite', 0.22 * ar);
        c.fillRect(x0 + i * pitch, -48, pitch * 0.66, 14);
      }
      ['−20', '−10', '−6', '−3', '0'].forEach((s, i) => label(d, s, lerp(x0, x1, [0, 0.5, 0.7, 0.85, 1][i]!), -10, 11, 0.5 * ar, { align: 'center' }));
    }
    // patchbay (two rows of jacks)
    const ap = d.rev(0, 250);
    if (ap > 0.004 && vis(d, -1560, 170, 1560, 340)) {
      plate(d, { x0: -1560, y0: 172, x1: 1560, y1: 340 }, ap, 10);
      c.lineWidth = 1 / d.z;
      c.strokeStyle = rgba('ash', 0.5 * ap);
      c.beginPath();
      for (let r = 0; r < 2; r++) for (let i = 0; i < 60; i++) { const x = -1470 + i * 50, y = 222 + r * 70; c.moveTo(x + 10, y); c.arc(x, y, 10, 0, Math.PI * 2); }
      c.stroke();
      c.fillStyle = rgba('ink', 0.9 * ap);
      c.beginPath();
      for (let r = 0; r < 2; r++) for (let i = 0; i < 60; i++) { const x = -1470 + i * 50, y = 222 + r * 70; c.moveTo(x + 4.5, y); c.arc(x, y, 4.5, 0, Math.PI * 2); }
      c.fill();
      for (let i = 0; i < 60; i += 2) label(d, `${i + 1}`, -1470 + i * 50, 256, 9, 0.45 * ap, { align: 'center', track: 0 });
      label(d, 'PATCH · CH INSERT SEND', -1540, 198, 10, 0.5 * ap);
      label(d, 'PATCH · CH INSERT RETURN', -1540, 332, 10, 0.5 * ap);
      // one patched cable: ch 07 → the 2-bus comp
      const x7 = -1470 + 6 * 50;
      c.strokeStyle = rgba('bone', 0.7 * ap); c.lineWidth = Math.max(1 / d.z, 3);
      c.beginPath(); c.moveTo(x7, 222); c.bezierCurveTo(x7 + 40, 400, x7 + 300, 400, x7 + 350, 292); c.stroke();
    }
  }

  // ------------------------------------------------------------------ B: channel 07 and its signal window
  private drawChannel(d: D2) {
    const { c, t } = d, au = this.ctx.audio;
    const [s0, s1, s2, s3] = this.st as [number, number, number, number];
    const a = d.lamp;
    if (a <= 0.004) return;
    const bx = B.box;
    c.lineWidth = 1 / d.z;
    label(d, 'CHANNEL SECTION · 01–24 · INPUT MODULES', -1540, 580, 13, 0.55 * a);
    // neighbours: 06 (left) and 08 (right, shoved by the breakout)
    const shove = t < s3 ? 0 : 90 * springStep(t - s3 - 0.02, 4, 0.4);
    this.neighbour(d, -1560, -810, '06', 'PAD · STRINGS', 0, a * 0.8, 0.2);
    this.neighbour(d, 810 + shove, 1560 + shove, '08', 'BVOX · CROWD', t - s3, a * 0.8, 0.6);
    // the module
    plate(d, bx, a, 12);
    const outerHit = t >= s3;
    // scribble strip
    c.fillStyle = rgba('ink', a); c.fillRect(-760, 636, 340, 134);
    c.strokeStyle = rgba('ash', 0.5 * a); c.strokeRect(-760, 636, 340, 134);
    c.font = font(F.archivo(100, 900), 70); c.fillStyle = rgba('bone', a); c.fillText('07', -742, 716);
    label(d, 'LEAD VOX', -620, 676, 22, 0.95 * a, { w: F.mono(600), track: 1 });
    label(d, 'ONE PROMPT', -620, 706, 17, 0.7 * a, { track: 1 });
    label(d, 'MIC 1 · U47 · +48V', -742, 752, 11, 0.5 * a);
    label(d, 'GRP 1 · VCA 2', -440, 752, 11, 0.5 * a, { align: 'right' });
    // knobs row (the gain knob turns with the fader)
    const fd = this.fader(t);
    const names = ['GAIN', 'HPF', 'HF', 'HMF', 'LMF', 'LF', 'COMP', 'PAN'];
    const lastSlam = this.st.filter((s) => t >= s).pop();
    names.forEach((n, i) => {
      const val = i === 0 ? 0.3 + 0.06 * (fd + 30) / 4 : i === 6 ? 0.3 + 0.02 * Math.max(0, fd + 10) : i === 7 ? 0.5 : 0.25 + 0.5 * hash(i, 7);
      knob(d, -320 + i * 148, 700, 32, val, n, a, (i === 0 || i === 6) && lastSlam !== undefined ? Math.exp(-(t - lastSlam) / 0.2) : 0);
    });
    label(d, 'EQ IN · HPF 80 Hz · COMP 4:1 −18 dB · AUX 1 PRE', 790 - 30, 640, 11, 0.45 * a, { align: 'right' });
    this.drawDyn(d, a, fd, lastSlam);
    // the fader
    const fx = B.faderX, fy0 = B.faderY0, fy1 = B.faderY1;
    c.fillStyle = rgba('ink', a); c.fillRect(fx - 5, fy0, 10, fy1 - fy0);
    c.strokeStyle = rgba('ash', 0.5 * a); c.strokeRect(fx - 5, fy0, 10, fy1 - fy0);
    c.beginPath();
    for (const [v] of FADER_MARKS) { const y = lerp(fy0, fy1, faderFrac(v)); c.moveTo(fx - 36, y); c.lineTo(fx - 12, y); c.moveTo(fx + 12, y); c.lineTo(fx + 36, y); }
    for (let i = 0; i <= 50; i++) { const y = lerp(fy0, fy1, i / 50); c.moveTo(fx + 12, y); c.lineTo(fx + 20, y); }
    c.strokeStyle = rgba('ash', 0.6 * a); c.stroke();
    for (const [v, s] of FADER_MARKS) label(d, s, fx - 44, lerp(fy0, fy1, faderFrac(v)) + 4, 12, (v === 0 ? 0.95 : 0.6) * a, { align: 'right', track: 0.5, col: v === 0 ? 'bone' : 'ash' });
    const fyAt = (tt: number) => lerp(fy0, fy1, faderFrac(this.fader(tt)));
    const cy = fyAt(t), vy = (fyAt(t) - fyAt(t - 1 / 240)) * 240;
    // analytic streak: the cap's travel over the shutter, as fading copies
    const streak = Math.min(1, Math.abs(vy) / 3000);
    for (let k = 3; k >= 1 && streak > 0.05; k--) {
      const yy = cy - vy * (k / 3) * (1 / 60) * 0.5;
      c.fillStyle = rgba('bone', 0.12 * streak * a); c.fillRect(fx - 48, yy - 22, 96, 44);
    }
    c.fillStyle = rgba('ink2', a); c.fillRect(fx - 48, cy - 22, 96, 44);
    c.strokeStyle = rgba('bone', 0.8 * a); c.strokeRect(fx - 48, cy - 22, 96, 44);
    c.beginPath();
    for (let i = -3; i <= 3; i++) if (i) { c.moveTo(fx - 40, cy + i * 5.5); c.lineTo(fx + 40, cy + i * 5.5); }
    c.strokeStyle = rgba('graphite', 0.9 * a); c.stroke();
    const slamAge = lastSlam !== undefined ? t - lastSlam : 9;
    c.fillStyle = heatCss(slamAge, a); c.fillRect(fx - 46, cy - 1.2, 92, 2.4);
    if (slamAge < 0.3) d.glow(fx - 44, cy, fx + 44, cy, 2.2, heatLin(slamAge, 1.2), 1);
    label(d, `${sgn(fd)} dB`, fx, fy1 + 34, 14, 0.85 * a, { align: 'center', w: F.mono(600), track: 0.5 });
    // the signal window
    const wl = B.winL, wr = B.winR, wt = this.winT, wb = B.winB;
    const w = this.bigState(t);
    const load = t < s2 ? 0 : t < s3 ? 1 : 0;
    const bowR = load ? 10 * pulse(t, s2, 0.07) + 6 * Math.max(0, w.over) + 3 : 0;
    const bowT = load ? 7 * pulse(t, s2, 0.07) + 2 : 0;
    // the over zone beyond the right wall: engraved diagonal hatch
    c.save();
    c.beginPath(); c.rect(wr + 6, wt, 150, wb - wt); c.clip();
    c.beginPath();
    for (let x = wr - (wb - wt); x < wr + 160; x += 9) { c.moveTo(x, wb); c.lineTo(x + (wb - wt), wt); }
    c.strokeStyle = rgba('graphite', 0.45 * a); c.stroke();
    c.restore();
    label(d, 'OVER', wr + 81, wt + 26, 12, 0.7 * a, { align: 'center', col: 'signal' });
    label(d, '+ dBFS', wr + 81, wb - 14, 11, 0.5 * a, { align: 'center' });
    // the scale under the window: −40 … 0 dBFS across its width; ticks light as BIGGER's edge passes them
    const sx = (dbv: number) => lerp(wl + this.padX, wr, (dbv + 40) / 40);
    const edgeX = (tt: number) => this.bigState(tt).x1;
    const ex = w.x1;
    const hist: number[] = [];
    for (let k = 0; k < 20; k++) hist.push(t - k * 0.02 >= s0 ? edgeX(t - k * 0.02) : -1e9);
    c.beginPath();
    for (let v = -40; v <= 0; v++) { const x = sx(v); c.moveTo(x, wb + 6); c.lineTo(x, wb + (v % 5 ? 14 : 24)); }
    for (let v = 1; v <= 6; v++) { const x = wr + v * 25; c.moveTo(x, wb + 6); c.lineTo(x, wb + (v % 3 ? 14 : 24)); }
    c.strokeStyle = rgba('ash', 0.6 * a); c.stroke();
    for (const v of [-40, -30, -20, -12, -6, -3, 0]) {
      const x = sx(v);
      let age = 9;
      for (let k = 0; k < hist.length; k++) if (hist[k]! >= x) { age = k * 0.02; if (k === hist.length - 1) age = 9; } else break;
      const passed = ex >= x;
      label(d, v === 0 ? '0' : `${v}`.replace('-', '−'), x, wb + 44, 14, (passed ? 0.95 : 0.5) * a, { align: 'center', col: passed ? heatCss(age < 9 ? age : 1, a) : 'ash', track: 0.5 });
    }
    label(d, '+3', wr + 75, wb + 44, 12, 0.7 * a, { align: 'center', col: 'signal' });
    label(d, '+6', wr + 150, wb + 44, 12, 0.7 * a, { align: 'center', col: 'signal' });
    label(d, 'dBFS', wl - 12, wb + 44, 12, 0.5 * a, { align: 'right' });
    // the level marker rides BIGGER's right edge
    if (t >= s0) {
      const mx = Math.min(ex, wr + 160);
      c.fillStyle = heatCss(slamAge, a);
      c.beginPath(); c.moveTo(mx, wb + 4); c.lineTo(mx - 7, wb - 8); c.lineTo(mx + 7, wb - 8); c.closePath(); c.fill();
      const lvdb = ex >= wr ? 0 : lerp(-40, 0, (ex - wl - this.padX) / (wr - wl - this.padX));
      const kk = w.k;
      label(d, `LEVEL ${lvdb >= 0 ? '0.0' : sgn(lvdb)} dBFS · WDTH ${BW[kk]} · WGHT ${BWT[kk]}`, wl, wt - 14, 13, 0.8 * a, { w: F.mono(600), track: 0.5 });
      label(d, `HEADROOM ${Math.max(0, -lvdb).toFixed(1)} dB`, wr, wt - 14, 13, (ex >= wr ? 1 : 0.7) * a, { align: 'right', w: F.mono(600), track: 0.5, col: ex >= wr ? 'signal' : 'bone' });
    } else {
      label(d, 'SIGNAL · CH 07 POST-FADER', wl, wt - 14, 13, 0.6 * a);
    }
    // channel LED bar and buttons
    const pk = db(peakLevel(au, t)) + this.gain(t) - 14;
    ledBar(d, wl, wr, wb + 64, 14, 56, t < s0 ? clamp((pk + 40) / 40) * 0.5 : clamp((pk + 40) / 40), a);
    const btn: [string, 'signal' | 'ember' | null][] = [['MUTE', null], ['SOLO', null], ['PFL', null], ['REC', 'signal'], ['Ø', null], ['INS', 'ember'], ['AUX 1', null], ['AUX 2', null]];
    btn.forEach(([n, lit], i) => button(d, wl + i * 112, 1316, 96, 40, n, a, lit));
    label(d, 'PHANTOM +48V ● · DIRECT OUT · MIX 04', wr, 1344, 11, 0.45 * a, { align: 'right' });
    screw(d, bx.x0 + 20, bx.y0 + 20, 7, a, 51); screw(d, bx.x1 - 20, bx.y0 + 20, 7, a, 52);
    screw(d, bx.x0 + 20, bx.y1 - 20, 7, a, 53); screw(d, bx.x1 - 20, bx.y1 - 20, 7, a, 54);

    // BIGGER, (the signal) — under the walls
    if (t >= s0) {
      c.save();
      c.font = font(this.bigFams[w.k]!, this.S0);
      c.translate(wl + this.padX, this.base); c.scale(w.sx * w.sc, w.sc);
      c.fillStyle = w.k === 0 ? heatCss(t - s0, a) : flashCss(slamAge, w.k === 3 ? 0.8 : 0.45, a);
      c.fillText(this.bigText, 0, 0);
      c.restore();
    }
    // the window walls: left/bottom always; top/right bow under load, then break on the fourth slam
    c.lineWidth = 1.3 / d.z;
    c.strokeStyle = rgba('bone', 0.75 * a);
    c.beginPath(); c.moveTo(wr, wb); c.lineTo(wl, wb); c.lineTo(wl, wt); c.stroke();
    if (t < s3) {
      c.strokeStyle = load ? rgba('bone', 0.95 * a) : rgba('bone', 0.75 * a);
      c.lineWidth = (load ? 1.8 : 1.3) / d.z;
      c.beginPath(); c.moveTo(wl, wt); c.quadraticCurveTo((wl + wr) / 2, wt - bowT, wr, wt); c.quadraticCurveTo(wr + bowR, (wt + wb) / 2, wr, wb); c.stroke();
      if (load) label(d, `WALL LOAD ${Math.min(99, Math.round(94 + 5 * w.over))}%`, wr - 10, wt + 24, 12, 0.85 * a, { align: 'right', col: 'ember' });
    } else {
      const dt = t - s3;
      trip(d, wl, wt, wr, wt, dt); trip(d, wr, wt, wr, wb, dt);
      const life = 1 - prog(dt, 0.35, 0.8);
      // the right wall shatters where the word goes through; the top edge recoils into its corners
      for (let j = 0; j < 6; j++) {
        const ya = lerp(wt, wb, j / 6), yb2 = lerp(wt, wb, (j + 1) / 6);
        fragment(d, wr, ya + 2, wr, yb2 - 2, 700 + 900 * hash(j, 41), (hash(j, 42) - 0.5) * 500, (hash(j, 43) - 0.5) * 16, dt, 0.85 * life * a);
      }
      const px = lerp(wl, wr, 0.6);
      recoil(d, wl, wt, px, wt, 0, -1, dt, 0.85 * life * a, 61);
      recoil(d, wr, wt, px, wt, 0, -1, dt, 0.85 * life * a, 62);
      recoil(d, wr, wb, wr, lerp(wt, wb, 0.5), 1, 0, dt, 0.85 * life * a, 63);
    }
    // the module's own right wall: breaks too (the word goes into channel 08)
    if (!outerHit) {
      c.strokeStyle = rgba('ash', 0.32 * a); c.lineWidth = 1 / d.z;
      c.beginPath(); c.moveTo(bx.x1, bx.y0 + 12); c.lineTo(bx.x1, bx.y1 - 12); c.stroke();
    } else {
      const dt = t - s3 - 0.03;
      trip(d, bx.x1, wt - 30, bx.x1, wb + 30, dt, 0.8);
      const life = 1 - prog(dt, 0.3, 0.7);
      for (let j = 0; j < 4; j++) {
        const ya = lerp(wt - 30, wb + 30, j / 4), yb2 = lerp(wt - 30, wb + 30, (j + 1) / 4);
        fragment(d, bx.x1, ya + 3, bx.x1, yb2 - 3, 900 + 800 * hash(j, 44), (hash(j, 45) - 0.5) * 600, (hash(j, 46) - 0.5) * 20, Math.max(0, dt), 0.8 * life * a);
      }
      c.strokeStyle = rgba('ash', 0.32 * a); c.lineWidth = 1 / d.z;
      c.beginPath(); c.moveTo(bx.x1, bx.y0 + 12); c.lineTo(bx.x1, wt - 30); c.moveTo(bx.x1, wb + 30); c.lineTo(bx.x1, bx.y1 - 12); c.stroke();
    }
    void s1;
  }

  /** Channel 07's processing strip: the EQ curve over the live spectrum, the compressor's transfer curve, GR. */
  private drawDyn(d: D2, a: number, fd: number, lastSlam: number | undefined) {
    const { c, t } = d, au = this.ctx.audio;
    const y0 = 790, y1 = 858, ym = (y0 + y1) / 2;
    if (!vis(d, -600, y0 - 20, 760, y1 + 20)) return;
    const hotAge = lastSlam !== undefined ? t - lastSlam : 9;
    c.lineWidth = 1 / d.z;
    // EQ: log frequency 20 Hz – 20 kHz, ±12 dB
    const ex0 = -600, ex1 = 160;
    const fx = (hz: number) => lerp(ex0, ex1, Math.log10(hz / 20) / 3);
    c.strokeStyle = rgba('ash', 0.4 * a); c.strokeRect(ex0, y0, ex1 - ex0, y1 - y0);
    c.beginPath();
    for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = fx(hz); c.moveTo(x, y0); c.lineTo(x, y1); }
    c.moveTo(ex0, ym); c.lineTo(ex1, ym);
    c.strokeStyle = rgba('graphite', 0.55 * a); c.stroke();
    const mel = au.melAt(t);
    c.fillStyle = rgba('graphite', 0.5 * a);
    for (let k = 0; k < mel.length; k++) { const x = lerp(ex0 + 2, ex1 - 2, k / mel.length), h = mel[k]! * (y1 - y0) * 0.9; c.fillRect(x, y1 - h, (ex1 - ex0) / mel.length * 0.6, h); }
    // presence rises with the fader ("make it bigger")
    const pres = 2 + 0.3 * Math.max(0, fd + 10);
    const bands: [number, number, number][] = [[3000, pres, 0.9], [300, -2, 1.2], [9000, 3, 0.8], [90, 1.5, 1]];
    const gainAt = (hz: number) => {
      let g = -18 * Math.max(0, Math.log2(80 / hz)) ;
      for (const [f0, gg, q] of bands) g += gg * Math.exp(-((Math.log2(hz / f0) / q) ** 2));
      return clamp(g, -12, 12);
    };
    c.beginPath();
    for (let i = 0; i <= 90; i++) { const hz = 20 * Math.pow(1000, i / 90), y = ym - gainAt(hz) / 12 * (y1 - y0) / 2; i ? c.lineTo(fx(hz), y) : c.moveTo(fx(hz), y); }
    c.strokeStyle = rgba('bone', 0.9 * a); c.lineWidth = 1.4 / d.z; c.stroke();
    bands.forEach(([f0], i) => {
      const x = fx(f0), y = ym - gainAt(f0) / 12 * (y1 - y0) / 2;
      c.fillStyle = i === 0 ? heatCss(hotAge, a) : rgba('bone', a);
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
    });
    label(d, `EQ · PRESENCE ${sgn(pres)} dB @ 3 kHz`, ex0, y0 - 8, 10, 0.55 * a);
    ['50', '100', '200', '500', '1k', '2k', '5k', '10k'].forEach((sx, i) => label(d, sx, fx([50, 100, 200, 500, 1000, 2000, 5000, 10000][i]!) + 3, y1 - 4, 8, 0.4 * a, { track: 0 }));
    // compressor transfer curve (in → out, dBFS), the live input riding it
    const cx0 = 200, cx1 = 268, cyb = y1, cyt = y0;
    const thr = -18, ratio = 4;
    const tx = (dbv: number) => lerp(cx0, cx1, (dbv + 48) / 48), ty = (dbv: number) => lerp(cyb, cyt, (dbv + 48) / 48);
    const outOf = (i: number) => (i < thr ? i : thr + (i - thr) / ratio);
    c.strokeStyle = rgba('ash', 0.4 * a); c.lineWidth = 1 / d.z; c.strokeRect(cx0, cyt, cx1 - cx0, cyb - cyt);
    c.beginPath(); c.moveTo(tx(-48), ty(-48)); c.lineTo(tx(0), ty(0)); c.strokeStyle = rgba('graphite', 0.7 * a); c.stroke();
    c.beginPath(); for (let i = 0; i <= 24; i++) { const v = -48 + i * 2; i ? c.lineTo(tx(v), ty(outOf(v))) : c.moveTo(tx(v), ty(outOf(v))); }
    c.strokeStyle = rgba('bone', 0.9 * a); c.lineWidth = 1.4 / d.z; c.stroke();
    const inDb = clamp(db(peakLevel(au, t)) + this.gain(t) - 14, -48, 0);
    c.fillStyle = heatCss(hotAge, a); c.beginPath(); c.arc(tx(inDb), ty(outOf(inDb)), 3.5, 0, Math.PI * 2); c.fill();
    label(d, 'COMP 4:1', cx0, cyt - 8, 10, 0.55 * a);
    // gain reduction
    const grDb = Math.max(0, inDb - thr) * (1 - 1 / ratio);
    label(d, `GR ${grDb.toFixed(1)} dB`, 300, cyt - 8, 10, 0.55 * a);
    ledBar(d, 300, 560, ym - 6, 12, 26, clamp(grDb / 14), a);
    label(d, 'ATK 3 ms · REL 80 ms · KNEE 2 dB', 300, y1 + 2, 9, 0.4 * a, { track: 0.5 });
    label(d, 'INSERT · DE-ESS 6.2 kHz', 730, ym + 4, 10, 0.45 * a, { align: 'right' });
  }

  /** BIGGER's state at t: width stage, the spring that hides the step, scale, right edge (world x) */
  bigState(t: number) {
    let k = 0;
    for (let i = 1; i < 4; i++) if (t >= this.st[i]!) k = i;
    const lay = this.bigLays[k]!;
    let sx = 1, sc = BSC[k]!;
    if (k > 0) {
      const sp = springStep(t - this.st[k]!, 5.5, 0.4);
      const ratio = (this.bigLays[k - 1]!.width) / lay.width;
      sx = lerp(ratio, 1, sp);
      sc = lerp(BSC[k - 1]!, BSC[k]!, sp);
    } else {
      sc *= 1 + 0.08 * (1 - ease.outExpo(prog(t, this.st[0]!, this.st[0]! + 0.14)));
    }
    const x1 = B.winL + this.padX + lay.width * sx * sc;
    const over = (x1 - B.winR) / 60;
    return { k, sx, sc, x1, over };
  }

  private neighbour(d: D2, x0: number, x1: number, n: string, name: string, age: number, a: number, seed: number) {
    if (a <= 0.004 || !vis(d, x0, 600, x1, 1410)) return;
    const c = d.c;
    plate(d, { x0, y0: 610, x1, y1: 1400 }, a, 12);
    c.fillStyle = rgba('ink', a); c.fillRect(x0 + 30, 636, 300, 134);
    c.strokeStyle = rgba('ash', 0.45 * a); c.lineWidth = 1 / d.z; c.strokeRect(x0 + 30, 636, 300, 134);
    c.font = font(F.archivo(100, 900), 70); c.fillStyle = rgba('bone', 0.7 * a); c.fillText(n, x0 + 48, 716);
    label(d, name, x0 + 160, 686, 16, 0.7 * a, { w: F.mono(600) });
    for (let i = 0; i < 4; i++) knob(d, x0 + 420 + i * 100, 700, 26, 0.2 + 0.6 * hash(i, seed), ['GAIN', 'HF', 'LF', 'PAN'][i]!, a);
    // its own small signal window with a dim trace
    const wx0 = x0 + 150, wx1 = x1 - 40, wy0 = 880, wy1 = 1150;
    c.strokeStyle = rgba('ash', 0.5 * a); c.strokeRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    const au = this.ctx.audio;
    c.beginPath();
    for (let i = 0; i <= 120; i++) {
      const x = lerp(wx0 + 10, wx1 - 10, i / 120), tt = d.t - (1 - i / 120) * 0.8;
      const v = au.env(seed > 0.5 ? 'mid' : 'low', tt) * (0.6 + 0.4 * hash(Math.floor(tt * 80), seed * 10));
      c.moveTo(x, (wy0 + wy1) / 2 - v * 100); c.lineTo(x, (wy0 + wy1) / 2 + v * 100);
    }
    c.strokeStyle = rgba('bone', 0.35 * a); c.stroke();
    if (age >= 0 && age < 0.4) label(d, 'CH 08 · SIGNAL FROM CH 07 (UNINVITED)', wx0 + 10, wy0 - 12, 11, a * (1 - age / 0.4) + 0.4 * a, { col: 'ember' });
    // its fader
    const fx = x0 + 70;
    c.fillStyle = rgba('ink', a); c.fillRect(fx - 4, 850, 8, 500);
    c.fillStyle = rgba('ink2', a); c.fillRect(fx - 36, 1040 - 18, 72, 36);
    c.strokeStyle = rgba('bone', 0.55 * a); c.strokeRect(fx - 36, 1040 - 18, 72, 36);
    ledBar(d, wx0, wx1, 1200, 12, 40, clamp(au.env('rms', d.t) * 0.7), a);
  }

  // ------------------------------------------------------------------ C: the master section
  private drawMaster(d: D2) {
    const { c, t } = d, au = this.ctx.audio;
    const a = d.lamp;
    const r1 = C.cy - C.railH, r2 = C.cy + C.railH;
    if (a > 0.004) {
      plate(d, { x0: 1690, y0: 440, x1: 3510, y1: 1560 }, a, 14);
      label(d, 'MASTER · 2-BUS · MIX 04', 1720, 470, 13, 0.7 * a);
      label(d, 'LIMITER — BYPASSED (DIRECTOR’S REQUEST)', 3480, 470, 13, 0.7 * a, { align: 'right', col: 'ember' });
      // master meters: MIX L, MIX R, and the bus compressor's GR (reversed)
      const pinned = t >= this.tLoud;
      const mk = (ch: number) => { const h: number[] = []; for (let k = 0; k < 12; k++) h.push(this.vuM(t - k * 0.02, ch)); return h; };
      const hl = mk(0), hr = mk(1);
      const pinK = pinned ? clamp(1 - (t - this.tLoud) / 0.6) * 0.6 + 0.4 : 0;
      drawVU(d, { x: 2020, y: 712, s: 0.4, pos: hl[0]!, hist: hl, face: this.lamp(t), title: 'MIX L', foot: '2-BUS', pin: pinned ? pinK : 0 }, a);
      drawVU(d, { x: 2400, y: 712, s: 0.4, pos: hr[0]!, hist: hr, face: this.lamp(t), title: 'MIX R', foot: '2-BUS', pin: pinned ? pinK : 0 }, a);
      const gr = pinned ? 1.07 - Math.abs(noise1(t * 30, 3)) * 0.03 : clamp(0.15 + 0.5 * au.hit('kick', t, 0.1) + 0.2 * this.gainM(t) / 6);
      drawVU(d, { x: 2780, y: 712, s: 0.4, pos: gr, hist: [gr], face: this.lamp(t), legend: 'GR', title: 'COMP 4:1', foot: 'dB', reversed: true }, a);
      // PEAK lamps on the meter housings: latch on LOUD
      for (const mx of [2020, 2400, 2780]) {
        const lx = mx + 150, ly = 500, on = pinned;
        c.fillStyle = on ? rgba('signal', a) : rgba('graphite', 0.5 * a);
        c.beginPath(); c.arc(lx, ly, 7, 0, Math.PI * 2); c.fill();
        c.strokeStyle = rgba('ash', 0.5 * a); c.lineWidth = 1 / d.z; c.stroke();
        label(d, on ? 'PEAK · HELD' : 'PEAK', lx - 14, ly + 4, 10, (on ? 1 : 0.5) * a, { align: 'right', col: on ? 'signal' : 'ash' });
        if (on) d.glow(lx, ly, lx + 0.01, ly, 16, [2.4, 0.24, 0.03], a);
      }
      // readouts
      const ov = pinned ? Math.floor((t - this.tLoud) * 480) + 1 : 0;
      const rowsR: [string, string, boolean][] = [
        ['TRUE PEAK', pinned ? '+11.9 dBTP' : `${sgn(db(peakLevel(au, t)) + this.gainM(t) - 4.5)} dBTP`, pinned],
        ['OVERS', String(ov).padStart(4, '0'), pinned],
        ['LOUDNESS', pinned ? '−3.1 LUFS' : `${sgn(db(vuLevel(au, t)) + this.gainM(t) - 9)} LUFS`, pinned],
        ['HEADROOM', pinned ? '0.0 dB' : `${Math.max(0, 4.5 - db(peakLevel(au, t)) - this.gainM(t)).toFixed(1)} dB`, pinned],
      ];
      rowsR.forEach(([k, v, hot], i) => {
        label(d, k, 3020, 560 + i * 44, 13, 0.55 * a);
        label(d, v, 3480, 560 + i * 44, 22, a, { align: 'right', w: F.mono(600), track: 0.5, col: hot ? 'signal' : 'bone' });
      });
      // ladders either side of the scope, with latching CLIP LEDs
      const pk = (band: string) => db(peakLevel(au, t, band)) + this.gainM(t) - 5;
      const latch = pinned ? 1 : 0;
      drawLadder(d, { x: 1734, yb: r2, yt: r1 + 60, n: 28, w: 34, dB: pk('low'), peakdB: db(peakLevel(au, t, 'low', 0.6)) + this.gainM(t) - 5, clip: latch, name: 'L', marks: true }, a);
      drawLadder(d, { x: 3432, yb: r2, yt: r1 + 60, n: 28, w: 34, dB: pk('rms'), peakdB: db(peakLevel(au, t, 'rms', 0.6)) + this.gainM(t) - 5, clip: latch, name: 'R', marks: true, marksLeft: true }, a);
      if (pinned) {
        label(d, 'LATCHED', 1751, r1 + 6, 10, a, { align: 'center', col: 'signal' });
        label(d, 'LATCHED', 3449, r1 + 6, 10, a, { align: 'center', col: 'signal' });
      }
      this.drawScope(d, r1, r2);
      // the transport (FRAMES)
      plate(d, { x0: 1800, y0: 1270, x1: 2560, y1: 1520 }, a, 10);
      label(d, 'TRANSPORT · PLAYHEAD', 1826, 1302, 12, 0.6 * a);
      label(d, '● REC', 2534, 1302, 13, a, { align: 'right', col: 'signal' });
      label(d, `TC ${tc24(t)}`, 1826, 1366, 44, 0.95 * a, { w: F.mono(600), track: 1 });
      label(d, `FRAME ${grp(frames(t))}`, 1826, 1428, 44, 0.95 * a, { w: F.mono(600), track: 1 });
      label(d, '24 FPS · 48 kHz · 24 BIT · BAR ' + (Math.floor(au.barAt(t)) + 1) + '.' + (Math.floor(((au.beatAt(t) % 4) + 4) % 4) + 1), 1826, 1490, 12, 0.5 * a);
      ['◀◀', '■', '▶', '●'].forEach((s, i) => button(d, 2600 + i * 86, 1300, 70, 44, s, a, s === '●' ? 'signal' : s === '▶' ? 'ember' : null));
      label(d, 'OSC 1 kHz · TALKBACK · DIM −20', 2600, 1380, 11, 0.45 * a);
      for (let i = 0; i < 6; i++) screw(d, 1720 + i * 355, 1536, 7, a, 80 + i);
    }
    this.drawMasterWords(d, r1, r2);
  }

  /** The 2-bus scope: the song's envelope scrolling between its 0 dBFS lines (the rails). */
  private drawScope(d: D2, r1: number, r2: number) {
    const { c, t } = d, au = this.ctx.audio, a = d.lamp;
    const x0 = C.x0, x1 = C.x1, cy = C.cy, hh = C.railH;
    const speed = 1450; // px / s
    c.lineWidth = 1 / d.z;
    // dB grid
    c.strokeStyle = rgba('graphite', 0.6 * a);
    c.setLineDash([6 / d.z, 6 / d.z]);
    c.beginPath();
    for (const lin of [0.5, 0.25, 0.1]) for (const s of [-1, 1]) { c.moveTo(x0, cy + s * hh * lin); c.lineTo(x1, cy + s * hh * lin); }
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = rgba('ash', 0.35 * a);
    c.beginPath(); c.moveTo(x0, cy); c.lineTo(x1, cy); c.moveTo(x0, r1 - 30); c.lineTo(x0, r2 + 30); c.moveTo(x1, r1 - 30); c.lineTo(x1, r2 + 30); c.stroke();
    for (const [lin, s] of [[1, '0'], [0.5, '−6'], [0.25, '−12'], [0.1, '−20']] as [number, string][]) {
      if (lin < 1) { label(d, s, x0 + 8, cy - hh * lin - 5, 10, 0.5 * a, { track: 0.5, col: 'ash' }); label(d, s, x0 + 8, cy + hh * lin - 5, 10, 0.5 * a, { track: 0.5, col: 'ash' }); }
    }
    label(d, '−∞', x0 + 8, cy - 5, 10, 0.5 * a, { col: 'ash' });
    // beats scrolling with the trace
    const b0 = Math.ceil(au.beatAt(t - (x1 - x0) / speed)), b1 = Math.floor(au.beatAt(t));
    c.strokeStyle = rgba('graphite', 0.7 * a);
    c.beginPath();
    for (let b = b0; b <= b1; b++) { const x = x1 - (t - au.timeOfBeat(b)) * speed; c.moveTo(x, r1 + 4); c.lineTo(x, r2 - 4); }
    c.stroke();
    for (let b = b0; b <= b1; b++) {
      const tb = au.timeOfBeat(b), x = x1 - (t - tb) * speed;
      const bar = Math.floor(au.barAt(tb + 0.01)) + 1, bt = (((b % 4) + 4) % 4) + 1;
      label(d, `${bar}.${bt}`, x + 5, r1 + 20, 11, 0.5 * a, { track: 0.5 });
    }
    // the trace: one hairline per 3 px column, anchored to song time (no shimmer as it scrolls)
    const dtc = 3 / speed;
    const iEnd = Math.floor(t / dtc), iStart = Math.ceil((t - (x1 - x0) / speed) / dtc);
    const cold: number[] = [], body: number[] = [], clipped: number[] = [];
    for (let i = iStart; i <= iEnd; i++) {
      const tau = i * dtc, x = x1 - (t - tau) * speed;
      const g = Math.pow(10, this.gainM(tau) / 20);
      const e = au.env('rms', tau), lo = au.env('low', tau);
      const amp = Math.pow(e, 1.35) * 0.66 * g * (0.62 + 0.38 * hash(i, 13)) + 0.12 * au.hit('kick', tau, 0.03) * g;
      const A = Math.min(1, amp), inner = Math.min(1, Math.pow(lo, 1.5) * 0.45 * g);
      const age = t - tau;
      if (age < 0.3) {
        c.strokeStyle = amp >= 1 ? rgba('signal', a) : heatCss(age, 0.85 * a);
        c.beginPath(); c.moveTo(x, cy - A * hh); c.lineTo(x, cy + A * hh); c.stroke();
        if (age < 0.08) d.glow(x, cy - A * hh, x, cy + A * hh, 1.2, heatLin(age, 0.5), 1);
      } else (amp >= 1 ? clipped : cold).push(x, A);
      body.push(x, inner);
    }
    const col = (arr: number[], style: string, k = 1) => {
      if (!arr.length) return;
      c.strokeStyle = style; c.beginPath();
      for (let i = 0; i < arr.length; i += 2) { c.moveTo(arr[i]!, cy - arr[i + 1]! * hh * k); c.lineTo(arr[i]!, cy + arr[i + 1]! * hh * k); }
      c.stroke();
    };
    col(cold, rgba('bone', 0.5 * a));
    col(clipped, rgba('signal', 0.85 * a));
    col(body, rgba('bone', 0.35 * a));
    // the write head
    c.strokeStyle = rgba('signal', a); c.lineWidth = 2 / d.z;
    c.beginPath(); c.moveTo(x1, r1 - 24); c.lineTo(x1, r2 + 24); c.stroke();
    label(d, 'NOW', x1 + 6, r1 - 30, 10, 0.8 * a, { col: 'signal' });
    // the rails as drawn by the scope (the glow batch takes them over on LOUD)
    const hot = t >= this.tLoud;
    c.strokeStyle = hot ? rgba('signal', a) : rgba('bone', 0.8 * a);
    c.lineWidth = 1.4 / d.z;
    c.beginPath(); c.moveTo(x0, r1); c.lineTo(x1, r1); c.moveTo(x0, r2); c.lineTo(x1, r2); c.stroke();
    label(d, hot ? '0 dBFS · HARD CLIP' : '0 dBFS', x0 + 8, r1 - 10, 12, 0.85 * a, { col: hot ? 'signal' : 'bone' });
    label(d, hot ? '0 dBFS · HARD CLIP' : '0 dBFS', x0 + 8, r2 + 22, 12, 0.85 * a, { col: hot ? 'signal' : 'bone' });
    label(d, 'SCOPE · 2-BUS · 1.1 s', x1 - 8, r2 + 22, 11, 0.55 * a, { align: 'right' });
  }

  /** MAKE IT riding the trace, then LOUD: slammed taller than the rails and hard-clipped. */
  private drawMasterWords(d: D2, r1: number, r2: number) {
    const { c, t } = d;
    // MAKE IT
    if (t >= this.tMake2 && t < this.tLoud + 0.06) {
      const k = 1 - prog(t, this.tLoud, this.tLoud + 0.06);
      c.font = font(this.cFam, this.cSize);
      const x = C.x0 + 36, y = C.cy + (190 / 2);
      const s = 1 + 0.06 * (1 - ease.outExpo(prog(t, this.tMake2, this.tMake2 + 0.12)));
      c.save(); c.translate(x, y); c.scale(s, s * (1 - 0.3 * (1 - k)));
      c.fillStyle = heatCss(t - this.tMake2, k);
      c.fillText(wText(73).toUpperCase(), 0, 0);
      c.fillStyle = t >= this.tIt2 ? heatCss(t - this.tIt2, k) : rgba('bone', 0.3 * k);
      c.fillText(wText(74).toUpperCase(), this.cItX, 0);
      c.restore();
    }
    if (t < this.tLoud) return;
    const age = t - this.tLoud;
    const lay = this.loudLay;
    const s = (1 + 0.12 * (1 - ease.outExpo(clamp(age / 0.14)))) * (1 + 0.02 * age);
    const capH = this.loudSize * this.CAP;
    const x0 = C.cx - lay.width / 2, base = C.cy + capH / 2;
    const drawLoud = (col: string) => {
      c.save();
      c.translate(C.cx, C.cy); c.scale(s, s); c.translate(-C.cx, -C.cy);
      c.font = font(this.loudFam, this.loudSize);
      c.fillStyle = col;
      c.fillText(this.loudText, x0, base);
      c.restore();
    };
    const punch = age < 2 / 60;
    if (punch) { drawLoud(heatCss(age)); return; } // two frames whole, before the ceilings bite
    const col = heatCss(age * 1.5);
    // the squeeze into the rails
    const sq = ease.inOutCubic(prog(t, this.tCol0, this.tCol1));
    const bw = W * 2;
    // the body between the rails: each half is squashed into its rail
    for (const [ra, rb, anchor] of [[r1, C.cy, r1], [C.cy, r2, r2]] as const) {
      c.save();
      c.beginPath(); c.rect(C.cx - bw, ra, bw * 2, rb - ra); c.clip();
      c.translate(0, anchor); c.scale(1, 1 - sq); c.translate(0, -anchor);
      drawLoud(col);
      c.restore();
    }
    // the sheared-off tops and bottoms: one sliver per glyph, flung off and cooling
    const fa = 1 - prog(age, 0.06, 0.3);
    if (fa > 0.01) {
      lay.glyphs.forEach((g, i) => {
        // glyph span in world x (under the slam scale about the centre)
        const gx0 = C.cx + (x0 + g.x - C.cx) * s, gx1 = C.cx + (x0 + g.x + g.w - C.cx) * s;
        for (const [ra, rb, dir] of [[r1 - 700, r1, -1], [r2, r2 + 700, 1]] as const) {
          const v = 700 + 900 * hash(i, dir, 3), vx = (hash(i, dir, 4) - 0.5) * 900;
          const rot = (hash(i, dir, 5) - 0.5) * 3.2 * age;
          const piv = dir < 0 ? r1 : r2, pcx = (gx0 + gx1) / 2;
          c.save();
          c.translate(pcx + vx * age, piv + dir * (18 + v * age + 900 * age * age));
          c.rotate(rot);
          c.translate(-pcx, -piv);
          c.beginPath(); c.rect(gx0 - 4, ra, gx1 - gx0 + 8, rb - ra); c.clip();
          c.globalAlpha = fa * 0.85;
          drawLoud(heatCss(age * 5, 1, 'graphite'));
          c.restore();
        }
      });
    }
  }

  /** The rails as light: hot on LOUD, shooting out across the frame; the only thing left at the cut. */
  private drawRails(G: LineBatch, t: number, cam: Cam, X: (x: number) => number, Y: (y: number) => number) {
    if (t < this.tLoud) return;
    const age = t - this.tLoud;
    const ext = ease.outExpo(clamp(age / 0.12));
    const xl = lerp(X(C.x0), -20, ext), xr = lerp(X(C.x1), W + 20, ext);
    const sq = ease.inOutCubic(prog(t, this.tCol0, this.tCol1));
    const absorb = Math.sin(Math.PI * sq) * 0.9;
    const k = 1.55 * (1 + 2.2 * Math.exp(-age / 0.06) + absorb);
    const tip = Math.exp(-age / 0.05);
    const rgb: RGB = [LIN.signal[0] * k + tip * 2, LIN.signal[1] * k + tip * 1.5, LIN.signal[2] * k + tip * 1.1];
    const w = 3 + 2 * tip + 1.2 * absorb;
    const y1 = Y(C.cy - C.railH), y2 = Y(C.cy + C.railH);
    G.seg2(xl, y1, xr, y1, w, rgb, 1);
    G.seg2(xl, y2, xr, y2, w, rgb, 1);
    // the cut edges: where LOUD's glyphs were sliced flat, the rails run white-hot, then cool
    if (age > 1 / 30 && age < 0.45) {
      const s = (1 + 0.12 * (1 - ease.outExpo(clamp(age / 0.14)))) * (1 + 0.02 * age);
      const x0 = C.cx - this.loudLay.width / 2;
      const h = heatLin(age - 1 / 30, 1.3);
      for (const g of this.loudLay.glyphs) {
        const ga = X(C.cx + (x0 + g.x + g.w * 0.04 - C.cx) * s), gb = X(C.cx + (x0 + g.x + g.w * 0.96 - C.cx) * s);
        G.seg2(ga, y1, gb, y1, 4, h, 1); G.seg2(ga, y2, gb, y2, 4, h, 1);
      }
    }
    void cam;
  }

  // ------------------------------------------------------------------ QC log (the desk's monitor, screen space)
  private drawQC(c: CanvasRenderingContext2D, t: number) {
    const [, , s2, s3] = this.st as [number, number, number, number];
    const ev: [number, string, string][] = [
      [s2, 'WARN', 'signal pressing channel wall'],
      [s3, 'WARN', 'HEADROOM 0.0 dB'],
      [s3 + 0.06, 'FAIL', 'signal outside channel strip'],
      [this.tLoud, 'FAIL', 'CLIP · 0 dBFS · latched'],
      [this.tLoud + 0.14, 'NOTE', 'loud, as requested'],
    ];
    const shown = ev.filter((e) => t >= e[0]);
    if (!shown.length) return;
    const a = this.lamp(t);
    if (a <= 0.004) return;
    const x = 1150, lh = 22, n = shown.length;
    const last = shown[n - 1]![0];
    const y0 = 1042 - (n - 1) * lh + lh * (1 - ease.outCubic(prog(t, last, last + 0.1)));
    c.font = font(MONO, 14); c.letterSpacing = '1px';
    shown.forEach(([te, lv, msg], i) => {
      const k = prog(t, te, te + 0.04) * a;
      const y = y0 + i * lh;
      c.fillStyle = rgba('ink', 0.9 * k); c.fillRect(x - 10, y - 16, 730, lh);
      c.fillStyle = rgba('bone', 0.55 * k); c.fillText(`QC  ${tc24(te)}`, x, y);
      c.fillStyle = lv === 'FAIL' ? rgba('signal', k) : lv === 'WARN' ? rgba('ember', k) : rgba('ash', k);
      c.fillText(lv, x + 196, y);
      c.fillStyle = heatCss(t - te, k); c.fillText(msg, x + 256, y);
    });
    c.letterSpacing = '0px';
    void MONO_R; void css; void hexRGB; void mix3; void wEnd;
  }
}
export type { Box };
