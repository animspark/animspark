// Plate `edit` — "Cut! Cut! On the beat!" ×2 (CUT.edit → CUT.hook2). FIG. 15, the edit. The DROP.
// An edit timeline, drawn in hairlines, with time running along x at a fixed rate (V px per song second):
//   ruler   frame ticks, 6-frame ticks, one TC label a second (the in-world counter frames(t) IS the timecode),
//           a beat-marker row (quarters and 8ths, bar.beat labels, bar numbers on the downbeats), event flags.
//   V2      the lyric: one vocal clip per line (VOX_L16 / VOX_L17) and the word clips cut out of it.
//   V1      the picture: the film recut to the beat, one clip per beat, each an earlier plate as a line icon.
//   A1      the song's own waveform (this.ctx.audio), heated by age where the playhead has just passed.
//   the playhead is the caret: a signal block on the ruler and a hairline through the tracks.
// H13     the first frame is the stadium's three touchlines: bone hairlines at y = 380 / 560 / 740 on ink. On the
//         drop they become the track dividers; the timeline builds out from the playhead as a hot front.
// Cut!    each CUT! is stamped into the vocal clip at the playhead on its sung start and the razor (a hot blade)
//         slices clip AND word there; the halves ripple apart by two frames (the left side slides back, ripple
//         arrows, "−2 fr"), the cut edges heat and the kerf chars the glyphs; two inverted punch frames.
//         A clip is only ever split into segments: no overlaps.
// On the beat!  each word is born at the playhead as its own clip and a magnet snaps it onto the next free
//         8th marker (spring, strobe echoes, a dashed snapping guide, the marker flashes). BEAT! is the big one:
//         a wide, solid signal-orange clip with ink type.
// pass 2  the camera snaps closer and rolls on the downbeat; the razor cuts all three tracks (four things), and
//         a time-remap stutter replays "Cut! Cut!" ×2 ×3 (the whole timeline is rendered at remapped time: the
//         playhead loops back to IN, ×1 ×2 ×3 badge, loop brackets), with deadpan EDL lines.
// H14     after the last "beat!" the camera pushes (log zoom) into the BEAT! clip: at CUT.hook2 the whole frame is
//         solid signal orange.
// Camera: beat-stepped page scroll (the page jumps one beat at every beat, with anticipation) following the
// playhead; per-word nod staircase (log zoom about the frame centre); a roll snap for pass 2; the exit push.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, makeRT } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, measure } from '../px/type';
import { clamp, ease, lerp, prog, pulse, springStep, smoothstep, hash, noise1, frameIdx } from '../px/util';
import { wStart, wEnd } from './lyric';
import { CUT, TRACKS_H13, frames } from './handoff';
import {
  type Cam, type Xf, camXf, apply, invXf, lerpCam, heatCss, hairCss, mixCss, tc, thousands, drawIcon, worldSparks, PLATES, NOTES,
} from './edit-kit';

type C2 = CanvasRenderingContext2D;
type Track = 'v2' | 'v1' | 'a1';

const V = 610; // world px per song second
const GX = 700; // world x of the playhead at CUT.edit (screen x on the hand-off frame)
const GAP = (2 / 24) * V; // a ripple opens two frames
const BUILD_V = 5200; // the build front (px/s) out of the playhead on the drop
const PADW = 26; // word-clip padding
const Y = { flag: 232, mark: 292, rulerTop: 300, v2: TRACKS_H13.ys[0], v1: TRACKS_H13.ys[1], a1: TRACKS_H13.ys[2], bot: 920 };
const IN = 6, HEAD = 18;
const TRK: Record<Track, [number, number]> = {
  v2: [Y.v2 + IN, Y.v1 - IN], v1: [Y.v1 + IN, Y.a1 - IN], a1: [Y.a1 + IN, Y.bot - IN],
};
const W_CUT = [82, 83, 87, 88], W_ON = [84, 89], W_THE = [85, 90], W_BEAT = [86, 91];
const Z_END = 10;
/** marker comments by bar number */
const MARKS: [number, string][] = [
  [30, 'M · LAST CROWD SHOT'], [31, 'M · THE DROP. DO NOT BE SUBTLE'], [32, 'M · LINE 16 · CUT ON THE WORD'],
  [33, 'M · BEAT! LANDS HERE (IT WILL NOT)'], [34, 'M · LINE 17 · SAME, LOUDER'], [35, 'M · HOOK 2 · EVERYTHING ORANGE'],
];

interface CutEv { i: number; t: number; x: number; pass: 1 | 2; tracks: Track[]; n: number }
interface Stamp { i: number; t: number; x: number; size: number; tw: number; base: number; rot: number }
interface WClip { i: number; text: string; fam: string; size: number; tw: number; w: number; tb: number; xb: number; xl: number; tl: number; mk: number; big: boolean; base: number; label: string; fr: number; n: number }
interface LClip { name: string; x0: number; x1: number; pass: 1 | 2 }
interface VClip { x0: number; x1: number; icon: number; name: string }
interface EdlLine { t: number; s: string; sum?: boolean }

export default class Plate extends Scene {
  L = new Layer2D();
  glow = new LineBatch(9000, { blend: 'add' });
  rt = makeRT();
  comp = new FSPass(/* glsl */ `
    uniform sampler2D tex; uniform vec3 bg;
    void main() { vec4 s = texture(tex, vUv); fragColor = vec4(mix(bg, s.rgb, s.a), 1.0); }`,
  { tex: { value: null }, bg: { value: new THREE.Vector3() } });
  // punch frames: the neutral picture swaps ink <-> bone (by luminance), orange stays orange
  // plus the force of a cut: the whole frame is sliced along the razor (the two halves jump apart
  // vertically and spring back), a white-hot seam, a roll kick and an RGB split across the seam
  fin = new FSPass(/* glsl */ `
    uniform sampler2D src; uniform float punch, uSx, uSlice, uSeam, uGap, uRoll, uSplit;
    vec3 tap(vec2 px) {
      float side = px.x < uSx ? 1.0 : -1.0;
      px.y += side * uSlice; px.x += side * uGap;
      vec2 uv = px / vec2(1920.0, 1080.0);
      return vec3(texture(src, uv + vec2(side * uSplit / 1920.0, 0.0)).r, texture(src, uv).g, texture(src, uv - vec2(side * uSplit / 1920.0, 0.0)).b);
    }
    void main() {
      vec2 px = vUv * vec2(1920.0, 1080.0);
      px = rot2(uRoll) * (px - vec2(960.0, 540.0)) + vec2(960.0, 540.0);
      vec3 c = tap(px);
      float ds = abs(px.x - uSx);
      c = mix(c, C_INK * 0.2, step(ds, uGap) * step(0.01, uGap));
      c += (C_EMBER * 3.0 + C_SIGNAL * 1.2) * exp(-max(0.0, ds - uGap) / 2.5) * uSeam;
      c += C_SIGNAL * 0.6 * exp(-max(0.0, ds - uGap) / 40.0) * uSeam;
      if (punch > 0.5) {
        float o = smoothstep(0.12, 0.38, c.r - c.g) * step(0.15, c.r);
        float l = sat(luma(c) / luma(C_BONE));
        vec3 base = mix(C_BONE, C_INK, l);
        c = mix(base, C_SIGNAL, o);
      }
      fragColor = vec4(c, 1.0);
    }`, { src: { value: null }, punch: { value: 0 }, uSx: { value: 960 }, uSlice: { value: 0 }, uSeam: { value: 0 }, uGap: { value: 0 }, uRoll: { value: 0 }, uSplit: { value: 0 } });

  T0 = 0; T1 = 0; SNAP = 0; S0 = 0; S1 = 0; LA = 0; LE = 0; EX0 = 0; PU0 = 0;
  cuts: CutEv[] = [];
  stamps: Stamp[] = [];
  wclips: WClip[] = [];
  lclips: LClip[] = [];
  vclips: VClip[] = [];
  a1: { x0: number; x1: number } = { x0: 0, x1: 0 };
  edl: EdlLine[] = [];
  punchT: number[] = [];
  cutReal: { t: number; c: CutEv }[] = [];
  P = { x: 0, y: 0 };
  E1: Cam = { x: 0, y: 0, z: 1, r: 0 };
  capCut = 100; capOn = 80; capBeat = 90;
  mono = F.mono(500); monoR = F.mono(400); monoB = F.mono(600);

  X(t: number) { return GX + (t - this.T0) * V; }
  tOfX(x: number) { return this.T0 + (x - GX) / V; }

  // ------------------------------------------------------------------ init
  override init() {
    const au = this.ctx.audio;
    this.T0 = CUT.edit; this.T1 = CUT.hook2;
    const b8 = (t: number) => au.timeOfBeat(Math.ceil(au.beatAt(t) * 2 - 1e-6) / 2); // next 8th marker ≥ t
    const b8f = (t: number) => au.timeOfBeat(Math.floor(au.beatAt(t) * 2 + 1e-6) / 2); // last 8th marker ≤ t
    this.SNAP = au.downbeats.find((d) => d > wEnd(86) + 0.3) ?? wEnd(86) + 0.6;
    this.S0 = wStart(87) - 0.1;
    this.LA = b8(wStart(88) + 0.28);
    this.S1 = this.LA;
    this.LE = b8f(wStart(89) - 0.01);
    this.EX0 = wStart(91) + 0.1;
    this.PU0 = wEnd(91);

    const mc = document.createElement('canvas').getContext('2d')!;
    const cap = (fam: string, size: number) => { mc.font = font(fam, size); return mc.measureText('CUTOHEB').actualBoundingBoxAscent; };
    const bodyMid = (TRK.v2[0] + HEAD + TRK.v2[1]) / 2;

    // cuts and their CUT! stamps
    const famCut = F.archivo(87.5, 900);
    const sp = this.X(wStart(83)) - this.X(wStart(82));
    const tw100 = measure('CUT!', famCut, 100);
    const sizeCut = Math.min(150, (0.92 * sp / tw100) * 100);
    this.capCut = cap(famCut, sizeCut);
    W_CUT.forEach((i, k) => {
      const t = wStart(i), pass = k < 2 ? 1 : 2;
      const c: CutEv = { i, t, x: this.X(t), pass, tracks: pass === 1 ? ['v2'] : ['v2', 'v1', 'a1'], n: [1, 2, 6, 7][k]! };
      this.cuts.push(c);
      const tw = measure('CUT!', famCut, sizeCut);
      this.stamps.push({ i, t, x: c.x, size: sizeCut, tw, base: bodyMid + this.capCut / 2, rot: [-0.035, 0.028, -0.03, 0.034][k]! });
    });

    // word clips: born at the playhead, snapped onto the next free 8th marker
    const famOn = F.archivo(100, 900), famBeat = F.archivo(112.5, 900);
    let sizeOn = 112, sizeBeat = 138;
    const clear = this.X(wStart(87)) - this.stamps[2]!.tw * 0.5 - 30; // pass 2's first CUT! needs its clip
    for (let it = 0; it < 12; it++) {
      let free = -1e9, end = 0;
      for (const [i, text, big] of [[84, 'ON', false], [85, 'THE', false], [86, 'BEAT!', true]] as const) {
        const w = measure(text, big ? famBeat : famOn, big ? sizeBeat : sizeOn) + 2 * PADW;
        const mk = b8(Math.max(wStart(i) + 0.001, free));
        free = mk + w / V + 0.012; end = this.X(mk) + w;
      }
      if (end < clear) break;
      sizeOn *= 0.96; sizeBeat *= 0.96;
    }
    this.capOn = cap(famOn, sizeOn); this.capBeat = cap(famBeat, sizeBeat);
    let n = 3;
    for (let p = 0; p < 2; p++) {
      let free = -1e9;
      for (const [i, text, big] of [[W_ON[p]!, 'ON', false], [W_THE[p]!, 'THE', false], [W_BEAT[p]!, 'BEAT!', true]] as const) {
        const fam = big ? famBeat : famOn, size = big ? sizeBeat : sizeOn;
        const tw = measure(text, fam, size);
        let w = tw + 2 * PADW;
        const tb = wStart(i);
        const mk = b8(Math.max(tb + 0.001, free));
        const xl = this.X(mk);
        if (big && p === 1) w = Math.max(w, this.X(this.T1 + 1.6) - xl); // the last clip runs on past the cut
        // landing: the first time the spring reaches the marker
        let d = 0; while (d < 0.6 && springStep(d, 3.6, 0.62) < 1) d += 0.002;
        const wc: WClip = {
          i, text, fam, size, tw, w, tb, xb: this.X(tb), xl, tl: tb + 0.07 + d, mk, big,
          base: bodyMid + (big ? this.capBeat : this.capOn) / 2, label: this.bb(mk), fr: Math.round((mk - tb) * 24), n: n++,
        };
        this.wclips.push(wc);
        free = mk + w / V + 0.012;
      }
      if (p === 0) n = 10; // 006, 007 are the pass-2 cuts; 008, 009 the repeats
    }
    const beat1 = this.wclips[2]!, beat2 = this.wclips[5]!;

    // vocal clips (one per line), ending where the word clips begin
    this.lclips.push({ name: 'VOX_L15', x0: this.X(this.T0 - 4), x1: this.X(this.T0 - 0.2), pass: 1 });
    this.lclips.push({ name: 'VOX_L16', x0: this.X(this.T0 + 0.11), x1: this.X(wStart(84)) - 4, pass: 1 });
    this.lclips.push({ name: 'VOX_L17', x0: Math.max(beat1.xl + beat1.w + 10, this.X(wStart(87) - 0.36)), x1: this.X(wStart(89)) - 4, pass: 2 });

    // V1: the previous shot, then the film recut to the beat (one plate per beat), then HOOK2
    const bi0 = Math.round(au.beatAt(this.T0));
    this.vclips.push({ x0: this.X(this.T0 - 4), x1: this.X(this.T0), icon: 13, name: '14_STADIUM.mov' });
    for (let k = 0; k < 16; k++) {
      const a = au.timeOfBeat(bi0 + k), b = k === 15 ? this.T1 + 3 : au.timeOfBeat(bi0 + k + 1);
      this.vclips.push({ x0: this.X(a), x1: this.X(b), icon: k, name: `${String(k + 1).padStart(2, '0')}_${PLATES[k]}.mov` });
    }
    this.a1 = { x0: this.X(this.T0 - 5), x1: this.X(this.T1 + 3) };

    // the exit: pushed into the orange of the last BEAT! clip, past its type
    this.P = { x: beat2.xl + PADW + beat2.tw + 300, y: (TRK.v2[0] + TRK.v2[1]) / 2 };
    this.E1 = { x: beat2.xl + PADW + beat2.tw * 0.62, y: (TRK.v2[0] + TRK.v2[1]) / 2 + 8, z: 1.5, r: -0.035 };

    // cuts in real time, including the stutter's replays
    const seg = (this.LE - this.LA) / 2;
    for (const c of this.cuts) {
      this.cutReal.push({ t: c.t, c });
      void seg; // (no replays: the second pass plays straight through)
    }
    this.punchT = this.cutReal.map((r) => r.t);

    // the EDL, typed as it happens
    const f = (t: number) => tc(frames(t));
    const E = this.edl;
    E.push({ t: this.T0 + 0.06, s: NOTES.title }, { t: this.T0 + 0.24, s: NOTES.fcm });
    for (const c of this.cuts) {
      const trk = c.pass === 1 ? 'V2      ' : 'V2 V1 A1';
      E.push({ t: c.t, s: `${String(c.n).padStart(3, '0')}  ${c.pass === 1 ? 'VOX_L16' : 'VOX_L17'}  ${trk}  C  ${f(c.t)}  RAZOR ×${c.tracks.length + 1}` });
    }
    for (const w of this.wclips) E.push({ t: w.tl, s: `${String(w.n).padStart(3, '0')}  ${w.text.padEnd(7)}  V2        SNAP → ${w.label.padEnd(5)} +${w.fr} fr${w.big ? '  (THE BIG ONE)' : ''}` });
    E.push({ t: au.timeOfBeat(Math.ceil(au.beatAt(wEnd(86) + 0.12))), s: 'EDL 001 · 2 CUTS · 0 REGRETS', sum: true });
    E.push({ t: wEnd(91) + 0.04, s: 'EDL 002 · 2 CUTS · 0 REGRETS', sum: true });
    E.push({ t: wEnd(91) + 0.3, s: `013  BEAT! → 16_HOOK2  CUT TO ORANGE  ${f(this.T1)}` });
    E.sort((a, b) => a.t - b.t);
  }

  /** bar.beat label of a marker (8ths get a "+") */
  bb(t: number) {
    const au = this.ctx.audio;
    const db = au.downbeats.filter((d) => d <= t + 0.03).pop() ?? au.downbeats[0]!;
    const bar = au.downbeats.indexOf(db) + 1;
    const q = Math.max(0, au.beatAt(t) - au.beatAt(db)) + 0.03;
    return `${bar}.${Math.floor(q) + 1}${q - Math.floor(q) > 0.3 ? '+' : ''}`;
  }

  // ------------------------------------------------------------------ time
  /** Timeline time: the stutter replays [S0, S1) twice (×2, ×3) inside [LA, LE). */
  remap(t: number) {
    return t; // the stutter read as flicker; the second pass now plays straight through
    if (t < this.LA || t >= this.LE) return t;
    const seg = (this.LE - this.LA) / 2;
    const k = Math.min(1, Math.floor((t - this.LA) / seg));
    const u = (t - this.LA - k * seg) / seg;
    return lerp(this.S0, this.S1, u);
  }
  loopN(t: number) { return 0; return t < wStart(87) ? 0 : t < this.LA ? 1 : t < this.LA + (this.LE - this.LA) / 2 ? 2 : t < this.LE ? 3 : 0; }
  rip(age: number) { return age <= 0 ? 0 : clamp(springStep(age, 3.0, 0.5), 0, 1.25); }
  /** ripple offset of a track's content at base x: everything left of a cut slides back two frames */
  off(k: Track, x: number, tt: number) {
    let o = 0;
    for (const c of this.cuts) if (tt >= c.t && c.x > x + 0.01 && c.tracks.includes(k)) o -= GAP * this.rip(tt - c.t);
    return o;
  }
  /** a clip [x0, x1] split by the cuts that have happened on track k */
  segs(k: Track, x0: number, x1: number, tt: number) {
    const cs = this.cuts.filter((c) => tt >= c.t && c.tracks.includes(k) && c.x > x0 && c.x < x1);
    const out: { a: number; b: number; o: number; cl: CutEv | null; cr: CutEv | null }[] = [];
    let a = x0, cl: CutEv | null = null;
    for (const c of cs) { out.push({ a, b: c.x, o: this.off(k, (a + c.x) / 2, tt), cl, cr: c }); a = c.x; cl = c; }
    out.push({ a, b: x1, o: this.off(k, (a + x1) / 2, tt), cl, cr: null });
    return out;
  }
  born(x: number, t: number) { return t - (this.T0 + 0.006 + Math.abs(x - GX) / BUILD_V); }
  wordX(w: WClip, tt: number) {
    const s = clamp(springStep(tt - w.tb - 0.07, 3.6, 0.62), 0, 1.3);
    return lerp(w.xb, w.xl, s) + (tt > w.tl ? this.off('v2', w.xl + 1, tt) : 0);
  }

  // ------------------------------------------------------------------ camera
  /** beat-stepped scroll: the page jumps one beat forward at every beat (anticipation, outExpo), held between */
  tq(tr: number) {
    const au = this.ctx.audio;
    // the jumps fall 0.35 beat after each beat: every sung word gets a still page first
    const b = au.beatAt(tr) - 0.35, k = Math.floor(b), f = b - k;
    const tk = au.timeOfBeat(k), tk1 = au.timeOfBeat(k - 1);
    let q = Math.max(this.T0, tk1 + (tk - tk1) * ease.outExpo(clamp(f * 5)));
    const A = 0.05;
    if (f > 0.82 && tk >= this.T0 - 1e-3) q -= A * ease.inQuad((f - 0.82) / 0.18);
    if (tk1 >= this.T0 - 1e-3) q -= A * (1 - ease.outExpo(clamp(f * 5)));
    return q;
  }
  logZ(tr: number) {
    let z = 0;
    for (const i of [82, 83, 84, 85, 86]) z += Math.log(1.03) * ease.outExpo(prog(tr, wStart(i), wStart(i) + 0.2));
    for (const i of [87, 88, 89, 90, 91]) z += Math.log(1.025) * ease.outExpo(prog(tr, wStart(i), wStart(i) + 0.2));
    const d = Math.log(1.36) - 5 * Math.log(1.03);
    const snap = ease.outExpo(prog(tr, this.SNAP, this.SNAP + 0.3));
    z += d * snap - Math.log(1.05) * ease.inQuad(prog(tr, this.SNAP - 0.14, this.SNAP)) * (1 - snap);
    return z;
  }
  camBase(tr: number): Cam {
    const k2 = ease.outExpo(prog(tr, this.SNAP, this.SNAP + 0.3));
    const z = Math.exp(this.logZ(tr));
    let r = -0.05 * ease.outBack(prog(tr, this.SNAP, this.SNAP + 0.38));
    const c2 = this.cuts[2]!.t, c3 = this.cuts[3]!.t;
    r += 0.024 * ease.outBack(prog(tr, c2, c2 + 0.3)) - 0.024 * ease.outBack(prog(tr, c3, c3 + 0.3));
    for (const c of this.cuts.slice(0, 2)) r += 0.014 * pulse(tr, c.t, 0.09) * (c.n % 2 ? 1 : -1);
    const offS = lerp(365, 583, k2);
    return { x: this.X(this.tq(tr)) + offS / z, y: lerp(540, 552, k2), z, r };
  }
  camAt(t: number): Cam {
    const tr = this.remap(t);
    let cam = this.camBase(tr);
    if (t > this.EX0) {
      const k1 = ease.outExpo(prog(t, this.EX0, Math.min(this.PU0, this.EX0 + 0.3)));
      cam = lerpCam(cam, this.E1, k1);
      if (t > this.PU0) {
        const k = ease.inCubic(prog(t, this.PU0, this.T1 - 0.035));
        let z = Math.exp(lerp(Math.log(this.E1.z), Math.log(Z_END), k));
        z *= 1 + 0.05 * this.exitKick(t); // the push nods on the kicks (settled before the cut)
        const s = (this.E1.z / z) * (1 - smoothstep(0.3, 1, k));
        cam = { x: this.P.x + (this.E1.x - this.P.x) * s, y: this.P.y + (this.E1.y - this.P.y) * s, z, r: lerp(this.E1.r, -0.02, k) };
      }
    }
    return cam;
  }

  /** kicks during the exit creep, faded out well before the cut */
  exitKick(t: number) {
    let v = 0;
    for (const [kt, s] of this.ctx.audio.events('kick', this.PU0, this.T1 - 0.3)) v = Math.max(v, s * pulse(t, kt, 0.07));
    return v * (1 - prog(t, this.T1 - 0.3, this.T1 - 0.12));
  }

  // ------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, tr = this.remap(t);
    const cam = this.camAt(t);
    const m = camXf(cam), im = invXf(m);
    const px = 1 / cam.z;
    // world bounds of the view
    const cs = [apply(im, 0, 0), apply(im, 1920, 0), apply(im, 0, 1080), apply(im, 1920, 1080)];
    const vx0 = Math.min(...cs.map((p) => p.x)) - 40, vx1 = Math.max(...cs.map((p) => p.x)) + 40;

    const L = this.L; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const built = t > this.T0 + 0.006;
    if (built) {
      this.drawGrid(c, t, tr, px, vx0, vx1);
      this.drawV1(c, t, tr, px, vx0, vx1);
      this.drawA1(c, t, tr, px, vx0, vx1);
      this.drawV2(c, t, tr, px, vx0, vx1);
      this.drawWords(c, t, tr, px);
      this.drawRuler(c, t, tr, px, vx0, vx1);
      this.drawRazor(c, t, tr, px);
      this.drawPlayhead(c, t, tr, px);
    }
    this.drawDividers(c, t, px, vx0, vx1);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (built) this.drawHUD(c, t, tr, cam);
    L.upload();

    (this.comp.u.bg!.value as THREE.Vector3).set(...LIN.ink);
    this.comp.u.tex!.value = L.texture;
    this.comp.render(renderer, this.rt);

    // ---- light: the caret, the razor, sparks
    const G = this.glow; G.clear();
    if (built) this.drawGlow(G, t, tr, m);
    if (G.count) G.render(renderer, this.rt);

    const fi = frameIdx(t);
    // two inverted frames: the first two output frames at or after each cut
    const punch = t < this.PU0 && this.punchT.some((p) => { const f0 = Math.ceil(p * 60 - 1e-6); return fi === f0 || fi === f0 + 1; });
    this.fin.u.src!.value = this.rt.texture;
    this.fin.u.punch!.value = punch ? 1 : 0;
    // the latest cut drives the slice
    let last: { t: number; c: CutEv } | undefined;
    for (const r of this.cutReal) if (t >= r.t && t < this.PU0 + 0.3) last = r;
    const fu = this.fin.u;
    if (last) {
      const a = t - last.t, k = last.c.pass === 1 ? 1 : 1.25, side = last.c.i % 2 ? -1 : 1;
      fu.uSx!.value = apply(m, last.c.x, 540).x;
      fu.uSlice!.value = 30 * k * Math.exp(-a / 0.11) * Math.cos(a * 34);
      fu.uGap!.value = 7 * k * Math.exp(-a / 0.06);
      fu.uSeam!.value = Math.exp(-a / 0.07) * 1.1;
      fu.uRoll!.value = side * 0.022 * k * Math.exp(-a / 0.1) * Math.cos(a * 26);
      fu.uSplit!.value = 9 * k * Math.exp(-a / 0.08);
    } else { fu.uSlice!.value = 0; fu.uGap!.value = 0; fu.uSeam!.value = 0; fu.uRoll!.value = 0; fu.uSplit!.value = 0; }
    this.fin.render(renderer, out);

    // ---- post: hits, and the hook2 look on the last frame
    let cutP = 0, cutL = 0; for (const r of this.cutReal) { cutP = Math.max(cutP, pulse(t, r.t, 0.07)); cutL = Math.max(cutL, pulse(t, r.t, 0.18)); }
    let wordP = 0; for (const w of this.wclips) wordP = Math.max(wordP, pulse(t, w.tb, 0.06), 0.7 * pulse(t, w.tl, 0.05));
    const drop = pulse(t, this.T0 + 0.01, 0.1), snapP = pulse(t, this.SNAP, 0.08);
    const settle = 1 - prog(t, this.PU0 + 0.2, this.T1 - 0.1);
    const sh = (22 * cutP + 14 * cutL + 7 * wordP + 12 * drop + 9 * snapP + 4 * f.a.kick + 2 * f.a.snare) * settle;
    const ex = prog(t, this.PU0, this.T1 - 0.05);
    return {
      bloom: lerp(0.6, 0.62, ex), bloomThreshold: lerp(0.9, 1.05, ex), bloomKnee: lerp(0.14, 0.15, ex), bloomRadius: 0.75,
      halation: lerp(0.26, 0.28, ex), vignette: lerp(0.4, 0.5, ex), grain: 0.055,
      ca: 1.0 + (3.5 * cutP + 0.8 * wordP + 1.5 * drop + 0.6 * f.a.kick) * settle,
      zoom: 1 + (0.06 * cutP + 0.02 * cutL + 0.014 * wordP + 0.03 * drop + 0.01 * f.a.kick) * settle,
      shake: [noise1(t * 45, 3) * sh, noise1(t * 45, 4) * sh * 0.8],
      flash: 0, fade: 0, invert: 0, exposure: 1,
    };
  }

  // ------------------------------------------------------------------ the hand-off hairlines / track dividers
  drawDividers(c: C2, t: number, px: number, vx0: number, vx1: number) {
    const k0 = this.born(GX, t);
    if (k0 <= 0) {
      c.fillStyle = rgba('bone', 0.85);
      for (const y of TRACKS_H13.ys) c.fillRect(vx0, y - 0.75 * px, vx1 - vx0, 1.5 * px);
      return;
    }
    // the hand-off lines become the dividers as the front passes (hot, then cooled to bone 0.55);
    // the ruler top and the A1 floor draw out of the playhead
    const CH = 48;
    for (let x = Math.floor(vx0 / CH) * CH; x < vx1; x += CH) {
      const age = this.born(x + CH / 2, t);
      const cool = age > 0 ? 1 - Math.exp(-age / 0.25) : 0;
      c.fillStyle = age > 0 ? hairCss(age, 'bone', lerp(0.85, 0.55, cool)) : rgba('bone', 0.85);
      for (const y of TRACKS_H13.ys) c.fillRect(x, y - 0.75 * px, CH + 0.5, 1.5 * px);
      if (age > 0) for (const [y, a] of [[Y.bot, 0.5], [Y.rulerTop, 0.45]] as const) { c.fillStyle = hairCss(age, 'bone', a); c.fillRect(x, y - 0.6 * px, CH + 0.5, 1.2 * px); }
    }
  }

  // ------------------------------------------------------------------ beat grid through the tracks
  drawGrid(c: C2, t: number, tr: number, px: number, vx0: number, vx1: number) {
    const au = this.ctx.audio;
    const j0 = Math.floor(au.beatAt(this.tOfX(vx0)) * 2), j1 = Math.ceil(au.beatAt(this.tOfX(vx1)) * 2);
    for (let j = j0; j <= j1; j++) {
      const tb = au.timeOfBeat(j / 2), x = this.X(tb);
      const age = this.born(x, t);
      if (age <= 0) continue;
      const down = j % 2 === 0 && au.downbeats.some((d) => Math.abs(d - tb) < 0.02);
      const a = (j % 2 ? 0.07 : down ? 0.3 : 0.16) * clamp(age / 0.05);
      const pa = tr - tb; // the playhead crossing heats the grid line
      c.fillStyle = pa >= 0 && pa < 0.5 ? hairCss(pa, 'graphite', a) : rgba('graphite', a);
      c.fillRect(x - 0.5 * px, Y.v2, 1 * px, Y.bot - Y.v2);
    }
  }

  // ------------------------------------------------------------------ V1: the picture
  drawV1(c: C2, t: number, tr: number, px: number, vx0: number, vx1: number) {
    const [y0, y1] = TRK.v1;
    const ph = this.X(tr);
    for (const v of this.vclips) {
      if (v.x1 < vx0 - 200 || v.x0 > vx1 + 200) continue;
      const age = this.born(Math.max(v.x0, Math.min(v.x1, GX)), t);
      if (age <= 0) continue;
      const A = clamp(age / 0.05);
      const hk = v.icon === 15;
      const vs = this.segs('v1', v.x0, v.x1, tr);
      vs.forEach((s, si) => {
        const a = s.a + s.o + (s.cl ? 0 : 1), b = s.b + s.o - (s.cr ? 0 : 1);
        if (b < vx0 || a > vx1) return;
        const played = ph > s.a;
        c.save();
        c.globalAlpha = A;
        c.beginPath(); c.rect(a, y0, b - a, y1 - y0); c.clip();
        c.fillStyle = hk ? rgba('blood', 0.35) : rgba('ink2', 1); c.fillRect(a, y0, b - a, y1 - y0);
        c.fillStyle = rgba('graphite', played ? 0.42 : 0.26); c.fillRect(a, y0, b - a, HEAD);
        // thumbnails (a filmstrip of the plate's icon)
        const ink = rgba('bone', played ? 0.78 : 0.5), dim = rgba('ash', 0.5), hot = rgba('signal', played ? 1 : 0.7);
        for (let x = v.x0 + 64; x < v.x1 - 20; x += 150) {
          if (x + s.o + 60 < a || x + s.o - 60 > b) continue;
          c.save(); c.translate(x + s.o, (y0 + HEAD + y1) / 2 + 2);
          drawIcon(c, v.icon, 1.4 * px, ink, hot, dim);
          c.restore();
          c.fillStyle = rgba('graphite', 0.35); c.fillRect(x + s.o + 70, y0 + HEAD + 6, 1 * px, y1 - y0 - HEAD - 12);
        }
        // opacity band with keyframes
        const by = y0 + HEAD + 12;
        c.fillStyle = rgba('ash', 0.35); c.fillRect(a + 4, by - 0.5 * px, b - a - 8, 1 * px);
        for (const kx of [v.x0 + 14, v.x1 - 14]) {
          const X = kx + s.o; if (X < a || X > b) continue;
          c.save(); c.translate(X, by); c.rotate(Math.PI / 4); c.fillStyle = rgba('ash', 0.7); c.fillRect(-3, -3, 6, 6); c.restore();
        }
        c.font = font(this.mono, 12); c.fillStyle = rgba('bone', played ? 0.85 : 0.55); c.textAlign = 'left';
        c.fillText(vs.length > 1 ? `${v.name.replace('.mov', '')}.${'ABC'[si]}` : v.name, Math.max(a, vx0 + 6) + 6, y0 + 13);
        c.fillStyle = rgba('ash', 0.6); c.textAlign = 'right';
        c.fillText(`${Math.round(((s.b - s.a) / V) * 24)} fr`, b - 6, y0 + 13);
        c.restore();
        // edges: hairline border, hot where the razor went through
        this.clipEdges(c, a, b, y0, y1, s.cl, s.cr, tr, px, played ? 'ash' : 'graphite', A);
      });
    }
  }

  /** border of a clip segment; edges made by the razor are hot and cool to base */
  clipEdges(c: C2, a: number, b: number, y0: number, y1: number, cl: CutEv | null, cr: CutEv | null, tr: number, px: number, base: 'ash' | 'graphite' | 'bone', A: number) {
    c.save(); c.globalAlpha = A;
    c.fillStyle = rgba(base, 0.55);
    c.fillRect(a, y0, b - a, 1 * px); c.fillRect(a, y1 - 1 * px, b - a, 1 * px);
    for (const [x, cut] of [[a, cl], [b, cr]] as const) {
      if (cut) {
        const age = tr - cut.t;
        c.fillStyle = hairCss(age, base, 0.7);
        const w = (1.2 + 3 * Math.exp(-age / 0.12)) * px;
        c.fillRect(x - w / 2, y0, w, y1 - y0);
      } else { c.fillStyle = rgba(base, 0.6); c.fillRect(x - 0.6 * px, y0, 1.2 * px, y1 - y0); }
    }
    c.restore();
  }

  // ------------------------------------------------------------------ A1: the song
  drawA1(c: C2, t: number, tr: number, px: number, vx0: number, vx1: number) {
    const au = this.ctx.audio;
    const [y0, y1] = TRK.a1;
    const mid = (y0 + HEAD + y1) / 2, amp = (y1 - y0 - HEAD) / 2 - 6;
    const ph = this.X(tr);
    const step = Math.max(2, 3 / Math.sqrt(1 / px));
    for (const s of this.segs('a1', this.a1.x0, this.a1.x1, tr)) {
      const a = s.a + s.o, b = s.b + s.o;
      if (b < vx0 || a > vx1) continue;
      c.save();
      c.beginPath(); c.rect(a, y0, b - a, y1 - y0); c.clip();
      c.fillStyle = rgba('ink2', 1); c.fillRect(Math.max(a, vx0), y0, Math.min(b, vx1) - Math.max(a, vx0), y1 - y0);
      c.fillStyle = rgba('graphite', 0.3); c.fillRect(Math.max(a, vx0), y0, Math.min(b, vx1) - Math.max(a, vx0), HEAD);
      // waveform: rms body, low-band core
      const xa = Math.max(s.a, vx0 - s.o), xb = Math.min(s.b, vx1 - s.o);
      for (let x = Math.floor(xa / step) * step; x < xb; x += step) {
        const age = this.born(x, t);
        if (age <= 0) continue;
        const tt = this.tOfX(x);
        const r = clamp((au.env('rms', tt) - 0.3) / 0.7), lo = clamp((au.env('low', tt) - 0.25) / 0.75), hi = au.env('high', tt);
        const h = amp * (0.12 + 0.88 * r ** 1.3), hl = amp * 0.9 * lo ** 1.8;
        const pa = tr - tt; // time since the playhead passed
        c.fillStyle = pa >= 0 ? hairCss(pa, 'ash', 0.62) : rgba('graphite', 0.75);
        if (age < 0.3) c.fillStyle = hairCss(age, pa >= 0 ? 'ash' : 'graphite', 0.6);
        c.fillRect(x + s.o, mid - h, step * 0.62, 2 * h);
        c.fillStyle = pa >= 0 ? (pa < 0.4 ? heatCss(pa, 0.9, 'bone') : rgba('bone', 0.72)) : rgba('ash', 0.5);
        c.fillRect(x + s.o, mid - hl, step * 0.62, 2 * hl);
        if (hi > 0.55) { c.fillStyle = rgba('bone', 0.35); c.fillRect(x + s.o, mid - h - 4, step * 0.62, 1.5 * px); }
      }
      // volume band, keyframes on the downbeats
      const vy = y0 + HEAD + 14;
      c.fillStyle = rgba('ash', 0.4); c.fillRect(Math.max(a, vx0), vy - 0.5 * px, Math.min(b, vx1) - Math.max(a, vx0), 1 * px);
      for (const d of au.downbeats) {
        const X = this.X(d) + s.o; if (X < a || X > b || X < vx0 || X > vx1) continue;
        c.save(); c.translate(X, vy); c.rotate(Math.PI / 4); c.fillStyle = rgba('ash', 0.8); c.fillRect(-3, -3, 6, 6); c.restore();
        c.font = font(this.monoR, 11); c.fillStyle = rgba('graphite', 1); c.textAlign = 'left'; c.fillText('0.0 dB', X + 8, vy + 4);
      }
      c.font = font(this.mono, 12); c.fillStyle = rgba('bone', 0.8); c.textAlign = 'left';
      const nm = s.cl ? 'ONE_PROMPT_MIX.wav (cont.)' : 'ONE_PROMPT_MIX.wav · 122 BPM · 48 kHz';
      c.fillText(nm, Math.max(a, vx0 + 40) + 6, y0 + 13);
      c.restore();
      this.clipEdges(c, a, b, y0, y1, s.cl, s.cr, tr, px, 'graphite', 1);
    }
    // deadpan: the audio slid too
    const c2 = this.cuts[2]!;
    const ag = tr - c2.t;
    if (ag > 0.15) {
      const x = c2.x - GAP - 8;
      c.font = font(this.monoR, 13); c.fillStyle = rgba('ash', clamp((ag - 0.15) / 0.1)); c.textAlign = 'right';
      c.fillText('A1 −2 fr · NOBODY WILL NOTICE', x, y1 + 22);
    }
  }

  // ------------------------------------------------------------------ V2: the vocal clips, stamped and cut
  drawV2(c: C2, t: number, tr: number, px: number, vx0: number, vx1: number) {
    const au = this.ctx.audio;
    const [y0, y1] = TRK.v2;
    const ph = this.X(tr);
    for (const lc of this.lclips) {
      if (lc.x1 < vx0 || lc.x0 > vx1) continue;
      const age = this.born(Math.max(lc.x0, Math.min(lc.x1, GX)), t);
      if (age <= 0) continue;
      const A = clamp(age / 0.05);
      const ss = this.segs('v2', lc.x0, lc.x1, tr);
      const stamps = this.stamps.filter((s) => s.x > lc.x0 && s.x < lc.x1 + 200 && tr >= s.t);
      ss.forEach((s, si) => {
        const a = s.a + s.o, b = s.b + s.o;
        const played = ph > s.a;
        c.save();
        c.globalAlpha = A;
        c.beginPath(); c.rect(a, y0, b - a, y1 - y0); c.clip();
        c.fillStyle = rgba('ink2', 1); c.fillRect(a, y0, b - a, y1 - y0);
        c.fillStyle = rgba('graphite', played ? 0.45 : 0.28); c.fillRect(a, y0, b - a, HEAD);
        // the vocal's own waveform, low in the clip
        const wy = y1 - 12;
        for (let x = Math.max(s.a, vx0 - s.o); x < Math.min(s.b, vx1 - s.o); x += 3) {
          const tt = this.tOfX(x), v = clamp((au.env('mid', tt) - 0.1) / 0.9);
          c.fillStyle = tr >= tt ? rgba('ash', 0.55) : rgba('graphite', 0.6);
          const h = 1 + 7 * v * v;
          c.fillRect(x + s.o, wy - h, 1.8, 2 * h);
        }
        c.font = font(this.mono, 12); c.fillStyle = rgba('bone', played ? 0.9 : 0.6); c.textAlign = 'left';
        const nm = ss.length > 1 ? `${lc.name}.${'ABC'[si]}` : lc.name === 'VOX_L15' ? 'VOX_L15.wav · "crowd" · reverb tail' : `${lc.name}.wav`;
        c.fillText(nm, Math.max(a, vx0) + 6, y0 + 13);
        c.fillStyle = rgba('ash', 0.7); c.textAlign = 'right';
        c.fillText(`${Math.round(((s.b - s.a) / V) * 24)} fr`, b - 6, y0 + 13);
        c.restore();
        // the CUT! stamps, each split by the segment it falls in
        c.save();
        c.beginPath(); c.rect(s.cl ? a : a - 400, y0 - 200, (s.cr ? b : b + 400) - (s.cl ? a : a - 400), y1 - y0 + 400); c.clip();
        for (const st of stamps) {
          if (st.x + st.tw * 0.7 < s.a || st.x - st.tw * 0.7 > s.b) continue;
          this.drawStamp(c, st, tr, s.o, px, s.cr && s.cr.i === st.i ? 'L' : s.cl && s.cl.i === st.i ? 'R' : '-');
        }
        c.restore();
        this.clipEdges(c, a, b, y0, y1, s.cl, s.cr, tr, px, played ? 'bone' : 'ash', A);
        // the ripple, said with arrows
        if (s.cr) {
          const ag = tr - s.cr.t;
          const g0 = b, g1 = s.b + this.off('v2', s.b + 1, tr);
          if (ag > 0.04 && ag < 1.4 && g1 - g0 > 8) {
            const al = clamp((ag - 0.04) / 0.06) * (1 - prog(ag, 0.9, 1.4));
            const my = y0 - 18;
            c.fillStyle = mixCss('signal', 'ash', prog(ag, 0.2, 0.7), al);
            c.beginPath(); c.moveTo(g0 - 2, my); c.lineTo(g0 + 9, my - 6); c.lineTo(g0 + 9, my + 6); c.closePath(); c.fill();
            c.fillRect(g0 + 8, my - 0.8 * px, Math.max(0, g1 - g0 - 8), 1.6 * px);
            c.font = font(this.monoB, 13); c.textAlign = 'center';
            c.fillText('RIPPLE −2 fr', (g0 + g1) / 2, my - 10);
          }
        }
      });
    }
  }

  /** a CUT! stamp; side: which half this segment holds ('L' left of its cut, 'R' right, '-' whole) */
  drawStamp(c: C2, st: Stamp, tr: number, o: number, px: number, side: 'L' | 'R' | '-') {
    const age = tr - st.t;
    const k = 1 + 0.32 * Math.pow(0.5, age / 0.035);
    c.save();
    c.translate(st.x + o, st.base - this.capCut / 2);
    c.rotate(st.rot * (1 - 0.4 * Math.exp(-age / 0.1)));
    c.scale(k, k);
    c.font = font(F.archivo(87.5, 900), st.size);
    c.textAlign = 'center';
    c.fillStyle = heatCss(age, 1, 'bone');
    c.fillText('CUT!', 0, this.capCut / 2);
    c.restore();
    // the kerf: the razor chars the glyphs along the cut (bites the clip colour, an ember rim cooling)
    if (side !== '-') {
      const xk = st.x + o;
      const grow = clamp(age / 0.08);
      c.save();
      c.fillStyle = rgba('ink2', 1);
      const sgn = side === 'L' ? -1 : 1;
      c.beginPath();
      for (let i = 0; i < 16; i++) {
        const yy = st.base - this.capCut * hash(st.i, i, 1);
        const r = (3 + 7 * hash(st.i, i, 2)) * grow;
        if (r < 0.4) continue;
        const cx = xk + sgn * r * 0.35;
        for (let q = 0; q < 6; q++) {
          const an = (q / 6) * Math.PI * 2, rr = r * (0.6 + 0.6 * hash(st.i, i, q, 3));
          if (q === 0) c.moveTo(cx + Math.cos(an) * rr, yy + Math.sin(an) * rr); else c.lineTo(cx + Math.cos(an) * rr, yy + Math.sin(an) * rr);
        }
        c.closePath();
      }
      c.fill();
      c.restore();
    }
  }

  // ------------------------------------------------------------------ the word clips: ON / THE / BEAT!
  drawWords(c: C2, t: number, tr: number, px: number) {
    const [y0, y1] = TRK.v2;
    const au = this.ctx.audio;
    for (const w of this.wclips) {
      const age = tr - w.tb;
      if (age < 0) continue;
      const x = this.wordX(w, tr);
      const hot = w.big ? 'signal' : 'ink2';
      // strobe echoes while the magnet pulls it
      const v = Math.abs(this.wordX(w, tr) - this.wordX(w, tr - 0.012)) / 0.012;
      if (v > 400) {
        for (let e = 1; e <= 4; e++) {
          const xe = this.wordX(w, tr - e * 0.022);
          c.strokeStyle = rgba(w.big ? 'signal' : 'bone', 0.45 * (1 - e / 5)); c.lineWidth = 1.5 * px;
          c.strokeRect(xe, y0, w.w, y1 - y0);
        }
      }
      // snapping guide and the magnet
      const ga = prog(tr, w.tl - 0.12, w.tl) * (1 - prog(tr, w.tl + 0.25, w.tl + 0.6));
      if (ga > 0) {
        c.strokeStyle = rgba('signal', 0.9 * ga); c.lineWidth = 1.3 * px; c.setLineDash([7 * px, 5 * px]);
        c.beginPath(); c.moveTo(w.xl + this.off('v2', w.xl + 1, tr), Y.flag + 34); c.lineTo(w.xl + this.off('v2', w.xl + 1, tr), y1 + 10); c.stroke(); c.setLineDash([]);
        const gx = w.xl + this.off('v2', w.xl + 1, tr), gy = Y.flag + 22;
        c.lineWidth = 4 * px; c.strokeStyle = rgba('signal', ga); c.lineCap = 'butt';
        c.beginPath(); c.arc(gx, gy, 9, Math.PI, 0, true); c.stroke();
        c.fillStyle = rgba('bone', ga); c.fillRect(gx - 11, gy - 1, 5, 5); c.fillRect(gx + 6, gy - 1, 5, 5);
        c.font = font(this.monoB, 14); c.fillStyle = rgba('signal', ga); c.textAlign = 'left';
        c.fillText(`SNAP ${w.label}  +${w.fr} fr`, gx + 18, gy + 4);
      }
      // the clip
      const bornK = Math.exp(-age / 0.06);
      c.save();
      c.beginPath(); c.rect(x, y0, w.w, y1 - y0); c.clip();
      if (w.big) {
        const kf = w === this.wclips[5] ? this.exitKick(t) : 0; // the last BEAT! flares on the exit's kicks
        c.fillStyle = kf > 0.02 ? mixCss('signal', 'ember', kf * 0.8) : heatCss(age, 1, 'signal'); c.fillRect(x, y0, w.w, y1 - y0);
        c.fillStyle = rgba('ink', 0.92); c.font = font(this.mono, 12); c.textAlign = 'left';
        c.fillText(`${w.text}.wav`, x + 6, y0 + 13);
        c.fillStyle = rgba('ink', 1);
      } else {
        c.fillStyle = rgba(hot, 1); c.fillRect(x, y0, w.w, y1 - y0);
        c.fillStyle = rgba('graphite', 0.4); c.fillRect(x, y0, w.w, HEAD);
        c.fillStyle = rgba('bone', 0.85); c.font = font(this.mono, 12); c.textAlign = 'left';
        c.fillText(`${w.text}.wav`, x + 6, y0 + 13);
        c.fillStyle = heatCss(age, 1, 'bone');
      }
      const k = 1 + 0.18 * Math.exp(-age / 0.05);
      c.save(); c.translate(x + PADW, w.base); c.scale(k, k);
      c.font = font(w.fam, w.size); c.textAlign = 'left';
      c.fillText(w.text, 0, 0);
      c.restore();
      c.restore();
      c.strokeStyle = w.big ? rgba('ember', 0.4 + 0.6 * bornK) : hairCss(age, 'bone', 0.6);
      c.lineWidth = (1.3 + 2 * bornK) * px; c.strokeRect(x, y0, w.w, y1 - y0);
    }
  }

  // ------------------------------------------------------------------ the ruler and the markers
  drawRuler(c: C2, t: number, tr: number, px: number, vx0: number, vx1: number) {
    const au = this.ctx.audio;
    const L0 = wStart(1);
    // frame ticks: the counter's own frames (frames(t) changes at L0 + n/24)
    const n0 = Math.floor((this.tOfX(vx0) - L0) * 24), n1 = Math.ceil((this.tOfX(vx1) - L0) * 24);
    c.textAlign = 'left';
    for (let n = n0; n <= n1; n++) {
      const tt = L0 + n / 24, x = this.X(tt);
      const age = this.born(x, t); if (age <= 0) continue;
      const fr = n + 1; // frames() at tt
      const sec = fr % 24 === 0, six = fr % 6 === 0;
      const h = sec ? 26 : six ? 12 : 5;
      const pa = tr - tt;
      c.fillStyle = age < 0.3 ? hairCss(age, 'ash', 0.7) : pa >= 0 && pa < 0.4 ? hairCss(pa, 'bone', 0.8) : rgba(pa >= 0 ? 'bone' : 'ash', sec ? 0.8 : 0.5);
      c.fillRect(x - 0.6 * px, Y.v2 - h, 1.2 * px, h);
      if (sec) {
        c.font = font(this.monoR, 14); c.fillStyle = rgba(pa >= 0 ? 'bone' : 'ash', 0.85 * clamp(age / 0.08));
        c.fillText(tc(fr), x + 5, Y.v2 - 14);
      }
    }
    // marker row: 8ths and quarters, bar numbers on the downbeats
    const j0 = Math.floor(au.beatAt(this.tOfX(vx0)) * 2), j1 = Math.ceil(au.beatAt(this.tOfX(vx1)) * 2);
    for (let j = j0; j <= j1; j++) {
      const tb = au.timeOfBeat(j / 2), x = this.X(tb);
      const age = this.born(x, t); if (age <= 0) continue;
      const A = clamp(age / 0.06);
      const down = j % 2 === 0 && au.downbeats.some((d) => Math.abs(d - tb) < 0.02);
      // a marker flashes when a word lands on it, and (a little) when the playhead crosses it
      let fl = 0;
      for (const w of this.wclips) if (Math.abs(w.mk - tb) < 0.01) fl = Math.max(fl, pulse(tr, w.tl, 0.1));
      const pc = tr >= tb ? pulse(tr, tb, 0.05) : 0;
      if (j % 2) {
        c.fillStyle = rgba('graphite', 0.9 * A); c.fillRect(x - 0.6 * px, Y.mark, 1.2 * px, 7);
        if (fl > 0.01) { c.fillStyle = rgba('signal', fl); c.fillRect(x - 4, Y.mark - 4, 8, 12); }
      } else {
        const s = 7 * (1 + 0.6 * fl);
        c.beginPath(); c.moveTo(x - s, Y.mark - s); c.lineTo(x + s, Y.mark - s); c.lineTo(x, Y.mark + 2); c.closePath();
        if (fl > 0.01) { c.fillStyle = mixCss('ash', 'signal', fl * 2, A); c.fill(); }
        c.strokeStyle = pc > 0.02 ? mixCss('ash', 'signal', pc, A) : rgba(down ? 'bone' : 'ash', 0.8 * A); c.lineWidth = 1.3 * px; c.stroke();
        c.font = font(this.monoR, 11); c.fillStyle = rgba('graphite', A); c.textAlign = 'left';
        c.fillText(this.bb(tb), x + 9, Y.mark - 1);
        if (down) {
          c.fillStyle = rgba('bone', 0.8 * A); c.fillRect(x - 0.7 * px, Y.mark - 34, 1.4 * px, 26);
          c.font = font(this.monoB, 16); c.fillStyle = rgba('bone', 0.9 * A);
          c.fillText(`BAR ${au.downbeats.findIndex((d) => Math.abs(d - tb) < 0.02) + 1}`, x + 7, Y.mark - 20);
        }
      }
    }
    // marker comments on the downbeats (the editor's notes, filed in advance)
    for (const [bar, note] of MARKS) {
      const d = au.downbeats[bar - 1]; if (d === undefined) continue;
      const x = this.X(d);
      if (x < vx0 - 400 || x > vx1) continue;
      const age = this.born(x, t); if (age <= 0) continue;
      // filed in advance; the closer pass-2 camera has no room for them
      const A = clamp(age / 0.08) * (1 - prog(tr, this.SNAP - 0.1, this.SNAP + 0.1));
      if (A <= 0.002) continue;
      c.fillStyle = hairCss(age, 'graphite', 0.9 * A); c.fillRect(x - 0.6 * px, Y.flag - 58, 1.2 * px, 30);
      c.beginPath(); c.moveTo(x, Y.flag - 58); c.lineTo(x + 10, Y.flag - 52); c.lineTo(x, Y.flag - 46); c.closePath(); c.fill();
      c.font = font(this.monoR, 13); c.fillStyle = rgba('ash', 0.85 * A); c.textAlign = 'left';
      c.fillText(note, x + 16, Y.flag - 47);
    }
    // cut flags (event markers)
    for (const cu of this.cuts) {
      const ag = tr - cu.t; if (ag < 0) continue;
      const x = cu.x + this.off('v2', cu.x + 1, tr);
      if (x < vx0 - 200 || x > vx1) continue;
      const k = (1 + 0.4 * Math.exp(-ag / 0.05)) * (cu.pass === 2 ? 0.85 : 1);
      const fy = cu.pass === 2 ? Y.flag + 22 : Y.flag; // the closer pass-2 camera: keep the flags under the HUD
      c.save(); c.translate(x, fy); c.scale(k, k);
      const txt = `CUT ${String(cu.n).padStart(3, '0')}${cu.pass === 2 ? ' ×4' : ' · V2'}`;
      c.font = font(this.monoB, 14);
      const tw = c.measureText(txt).width;
      c.fillStyle = heatCss(ag, 1, 'signal'); c.fillRect(0, -18, tw + 30, 24);
      c.fillStyle = rgba('ink', 1); c.textAlign = 'left'; c.fillText(txt, 24, -1);
      this.razorGlyph(c, 11, -6, 0.62, rgba('ink', 1));
      c.fillStyle = rgba('signal', 0.8); c.fillRect(-0.7, 6, 1.4, (Y.mark - fy - 12) / k);
      c.restore();
    }
    // the stutter: loop brackets on the ruler and the ×N badge
    const ln = this.loopN(t);
    const la = 0 * prog(t, this.LA - 0.12, this.LA); // no loop any more
    if (la > 0) {
      const xa = this.X(this.S0) + this.off('v2', this.X(this.S0) - 1, tr), xb = this.X(this.S1);
      c.fillStyle = rgba('signal', 0.22 * la); c.fillRect(xa, Y.rulerTop, xb - xa, Y.v2 - Y.rulerTop);
      c.fillStyle = rgba('signal', la);
      c.fillRect(xa, Y.rulerTop - 2, xb - xa, 3 * px);
      for (const [x, s] of [[xa, 1], [xb, -1]] as const) {
        c.fillRect(x - 1.5 * px, Y.rulerTop - 2, 3 * px, 30); c.fillRect(s > 0 ? x : x - 12, Y.rulerTop + 25, 12, 3 * px);
      }
      c.font = font(this.monoB, 18); c.textAlign = 'right';
      c.fillText(ln >= 2 ? `LOOP ×${ln}` : 'LOOP SET', xb - 16, Y.rulerTop + 24);
    }
  }

  razorGlyph(c: C2, x: number, y: number, s: number, col: string) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = col;
    c.beginPath(); c.moveTo(-8, -15); c.lineTo(8, -15); c.lineTo(8, -2); c.lineTo(2, 14); c.lineTo(-2, 14); c.lineTo(-8, -2); c.closePath(); c.fill();
    c.fillStyle = 'rgba(0,0,0,0)';
    c.restore();
  }

  // ------------------------------------------------------------------ the razor
  drawRazor(c: C2, t: number, tr: number, px: number) {
    for (const cu of this.cuts) {
      const ag = tr - cu.t;
      if (ag < -0.14 || ag > 0.45) continue;
      const yb = cu.pass === 1 ? Y.v1 : Y.bot;
      // arming: the razor comes down the ruler to the playhead
      if (ag < 0) {
        const k = ease.inQuad(prog(ag, -0.14, 0));
        this.razorGlyph(c, cu.x, lerp(Y.flag - 40, Y.rulerTop + 4, k), 1.3, mixCss('ash', 'signal', k, 0.4 + 0.6 * k));
        continue;
      }
      const drop = ease.outCubic(clamp(ag / 0.03));
      const y1 = lerp(Y.rulerTop, yb, drop);
      const xc = cu.x + this.off('v2', cu.x + 1, tr);
      c.fillStyle = hairCss(ag, 'signal', 1 - prog(ag, 0.12, 0.45));
      const w = (2 + 4 * Math.exp(-ag / 0.05)) * px;
      c.fillRect(xc - w / 2, Y.rulerTop, w, y1 - Y.rulerTop);
      this.razorGlyph(c, xc, Y.rulerTop + 4 - 12 * Math.exp(-ag / 0.04), 1.3, heatCss(ag, 1 - prog(ag, 0.2, 0.45), 'signal'));
      if (cu.pass === 2) {
        c.font = font(this.monoB, 15); c.fillStyle = rgba('signal', 1 - prog(ag, 0.25, 0.45)); c.textAlign = 'left';
        c.fillText('×4 · V2 CLIP · WORD · V1 · A1', xc + 12, Y.bot - 10);
      }
    }
  }

  // ------------------------------------------------------------------ the playhead: the caret
  drawPlayhead(c: C2, t: number, tr: number, px: number) {
    const x = this.X(tr);
    const on = prog(t, this.T0 + 0.006, this.T0 + 0.05);
    if (on <= 0) return;
    c.save(); c.globalAlpha = on;
    c.fillStyle = rgba('signal', 0.95);
    c.fillRect(x - 1 * px, Y.rulerTop, 2 * px, Y.bot - Y.rulerTop);
    c.fillRect(x - 7, Y.rulerTop, 14, 58);
    // TC flag
    const fr = frames(tr);
    const txt = tc(fr);
    c.font = font(this.mono, 13);
    const tw = c.measureText(txt).width;
    c.fillStyle = rgba('ink2', 0.95); c.fillRect(x + 9, Y.rulerTop, tw + 14, 20);
    c.fillStyle = rgba('bone', 0.95); c.textAlign = 'left'; c.fillText(txt, x + 16, Y.rulerTop + 15);
    // ×N badge on the second pass
    const ln = this.loopN(t);
    if (ln > 0 && t < this.LE + 0.4) {
      const s = 1 + 0.5 * Math.exp(-(t - [0, wStart(87), this.LA, this.LA + (this.LE - this.LA) / 2][ln]!) / 0.05);
      c.save(); c.translate(x + 9, Y.rulerTop + 24); c.scale(s, s);
      c.fillStyle = rgba('signal', 1); c.fillRect(0, 0, 58, 32);
      c.fillStyle = rgba('ink', 1); c.font = font(this.monoB, 24); c.fillText(`×${ln}`, 8, 25);
      c.restore();
    }
    c.restore();
  }

  // ------------------------------------------------------------------ light
  drawGlow(G: LineBatch, t: number, tr: number, m: Xf) {
    const on = prog(t, this.T0 + 0.006, this.T0 + 0.05) * (1 - prog(t, this.PU0 + 0.3, this.PU0 + 0.7));
    const x = this.X(tr);
    if (on > 0) {
      const a = apply(m, x, Y.rulerTop + 7), b = apply(m, x, Y.rulerTop + 51);
      const I = on * (0.8 + 0.5 * pulse(t, this.T0 + 0.01, 0.1) + 0.3 * this.ctx.audio.hit('kick', t, 0.1));
      G.seg2(a.x, a.y, b.x, b.y, 14 * (m.a ** 2 + m.b ** 2) ** 0.5, [LIN.signal[0] * 0.7 * I, LIN.signal[1] * 0.7 * I, LIN.signal[2] * 0.7 * I], 1);
    }
    // the razor blades: white-hot core, ember sheath
    for (const r of this.cutReal) {
      const ag = t - r.t;
      if (ag < 0 || ag > 0.4) continue;
      const cu = r.c, yb = cu.pass === 1 ? Y.v1 : Y.bot;
      const drop = ease.outCubic(clamp(ag / 0.03));
      const xc = cu.x + this.off('v2', cu.x + 1, tr);
      const a = apply(m, xc, Y.rulerTop), b = apply(m, xc, lerp(Y.rulerTop, yb, drop));
      const core = Math.exp(-ag / 0.05), sheath = Math.exp(-ag / 0.13);
      G.seg2(a.x, a.y, b.x, b.y, 12, [LIN.ember[0] * 1.6 * sheath, LIN.ember[1] * 1.6 * sheath, LIN.ember[2] * 1.6 * sheath], 0.8);
      G.seg2(a.x, a.y, b.x, b.y, 3, [5 * core, 4.2 * core, 3.2 * core], 1);
    }
    // sparks off the blade where it goes through each track (world space: they ride the page)
    for (const r of this.cutReal) {
      const ag = t - r.t;
      if (ag < 0 || ag > 0.7) continue;
      const ys: number[] = r.c.pass === 1 ? [(TRK.v2[0] + TRK.v2[1]) / 2] : [(TRK.v2[0] + TRK.v2[1]) / 2, (TRK.v1[0] + TRK.v1[1]) / 2, (TRK.a1[0] + TRK.a1[1]) / 2];
      const xc = r.c.x + this.off('v2', r.c.x + 1, tr);
      ys.forEach((yy, k) => {
        const headAt = (tb: number) => (tb < r.t || tb > r.t + 0.05 ? null : { x: xc, y: yy + (hash(Math.floor(tb * 400), k) - 0.5) * 130 });
        worldSparks(G, t, headAt, m, Math.hypot(m.a, m.b), { rate: 1500, life: 0.5, speed: 820, gravity: 1500, intensity: 1.1, seed: 31 + k + r.c.n * 7, width: 1.7, signal: LIN.signal });
      });
    }
  }

  // ------------------------------------------------------------------ the HUD: timecode (frames), tools, camera data, EDL
  drawHUD(c: C2, t: number, tr: number, cam: Cam) {
    const A = prog(t, this.T0 + 0.03, this.T0 + 0.22) * (1 - prog(t, this.PU0 + 0.1, this.PU0 + 0.55));
    if (A <= 0.002) return;
    const r = cam.r * 0.4, cs = Math.cos(r), sn = Math.sin(r);
    c.setTransform(cs, sn, -sn, cs, 960 - (cs * 960 - sn * 540), 540 - (sn * 960 + cs * 540));
    c.globalAlpha = A;
    const drift = 30 * (1 - ease.outExpo(prog(t, this.T0 + 0.03, this.T0 + 0.4)));
    // timecode block: the in-world counter as the timeline's timecode
    const fr = frames(tr);
    c.fillStyle = rgba('ink', 0.84); c.fillRect(30 - drift, 24, 430, 126);
    c.fillStyle = rgba('graphite', 0.8); c.fillRect(30 - drift, 24, 430, 1);
    c.textAlign = 'left';
    c.font = font(this.mono, 14); c.fillStyle = rgba('ash', 1);
    c.fillText('SEQ 15 · THE EDIT · 24 fps · 1920×1080', 46 - drift, 48);
    const T = tc(fr);
    c.font = font(this.monoB, 60); c.fillStyle = rgba('bone', 1);
    c.fillText(T.slice(0, 9), 42 - drift, 110);
    const w9 = c.measureText(T.slice(0, 9)).width;
    c.fillStyle = rgba('signal', 1); c.fillText(T.slice(9), 42 - drift + w9, 110);
    c.font = font(this.monoR, 15); c.fillStyle = rgba('ash', 1);
    c.fillText(`FRAME ${thousands(fr)}${this.loopN(t) >= 2 ? `  · LOOP ×${this.loopN(t)}` : '  · PLAYING'}`, 46 - drift, 137);
    // tools
    const ag = (tt: number) => this.cuts.some((q) => tt >= q.t - 0.14 && tt < q.t + 0.3);
    const rz = ag(tr), snap = this.wclips.some((w) => tr >= w.tb && tr < w.tl + 0.3), rip = this.cuts.some((q) => tr >= q.t && tr < q.t + 0.5);
    const tools: [string, string, boolean][] = [['V', 'SELECT', !rz && !snap], ['B', 'RIPPLE', rip], ['C', 'RAZOR', rz], ['Y', 'SLIP', false], ['S', 'SNAP', snap]];
    let x = 520;
    c.font = font(this.mono, 14);
    for (const [k, n, on] of tools) {
      const tw = c.measureText(`${k}  ${n}`).width + 20;
      c.fillStyle = on ? rgba('signal', 1) : rgba('ink', 0.84); c.fillRect(x, 30 + drift * 0.5, tw, 26);
      c.strokeStyle = rgba(on ? 'signal' : 'graphite', 1); c.lineWidth = 1; c.strokeRect(x + 0.5, 30.5 + drift * 0.5, tw - 1, 25);
      c.fillStyle = on ? rgba('ink', 1) : rgba('ash', 1); c.fillText(`${k}  ${n}`, x + 10, 48 + drift * 0.5);
      x += tw + 8;
    }
    c.fillStyle = rgba('graphite', 1 - prog(t, this.SNAP - 0.1, this.SNAP + 0.1)); c.font = font(this.monoR, 13);
    c.fillText('MAGNET: ON · MERCY: OFF · UNDO: DISABLED FOR THE DROP', 520, 78 + drift * 0.5);
    // camera data (deadpan)
    const cuts = this.cutReal.filter((q) => q.t <= t).length;
    c.textAlign = 'right'; c.font = font(this.mono, 14); c.fillStyle = rgba('ash', 1);
    c.fillText(`ZOOM ${Math.round(cam.z * 100)}%   ROLL ${(cam.r * 180 / Math.PI).toFixed(1)}°`, 1862 + drift, 48);
    c.fillText(`CUTS ${cuts} · REGRETS 0 · ${V} px/s`, 1862 + drift, 70);
    // EDL panel
    const shown = this.edl.filter((e) => e.t <= t).slice(-4);
    if (shown.length) {
      const px0 = 1150, py0 = 962;
      c.fillStyle = rgba('ink', 0.86); c.fillRect(px0 + drift, py0, 740, 106);
      c.fillStyle = rgba('graphite', 0.8); c.fillRect(px0 + drift, py0, 740, 1);
      c.textAlign = 'left'; c.font = font(this.mono, 12); c.fillStyle = rgba('graphite', 1);
      c.fillText('EDL · CMX 3600 · REEL 15', px0 + 14 + drift, py0 + 18);
      c.font = font(this.mono, 15);
      shown.forEach((e, k) => {
        const age = t - e.t;
        const nch = Math.min(e.s.length, Math.floor(age / 0.008) + 1);
        c.fillStyle = e.sum ? heatCss(age, 1, 'bone') : heatCss(age, 0.95, 'ash');
        c.fillText(e.s.slice(0, nch), px0 + 14 + drift, py0 + 40 + k * 20);
      });
    }
    c.globalAlpha = 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
}
