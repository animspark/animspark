// Plate `stadium` — "Rain it down on every crowd" (CUT.stadium → CUT.edit). Distribution: the crowd.
// An engineer's seating plan of a 60,000-seat bowl, seen from straight above; every seat is a dot and every dot
// is a person (a crowd of full stops). One continuous take through a 2D camera (log-zoom, roll, nods):
//   hand-off  (H12) the mix's two clipped rails at y = 300 / 780 are the long front rails of the stands (their
//             LED boards), running on across the sheet. The plan resolves around them: the rails turn the
//             corners, the rows fill outward (a hot front), seats appear as rings and fill with people; the rails
//             beyond the bowl cool into extension lines; the markings are drawn out from the centre spot on the
//             kick, the sheet, towers and annotation come up. The camera holds, then snaps out on the kick.
//   Rain it   each word falls from above the frame as one unit (a stroboscopic streak), lands on the north stand
//   down      at its onset: white-hot, cooling to bone; the crowd jumps in a ring from the impact, hot near it;
//             "Rain" and "down" start stadium waves round the bowl; each word then soaks into the crowd (the dots
//             under it flip to bone cards: the rain's imprint).
//   on every  painted on the grass in the plan's own projection, stacked either side of the centre spot, swept
//             in as sung (hot paint cooling to bone; a dim chalk guide just before). Camera nods per word.
//   crowd     a card stunt on the south stand: every holder flips a card, letters bone, the rest ink, the flips
//             racing west → east with the syllables (the camera snaps down onto the stand, then creeps).
//   build     on the snare after the held note the camera snaps out to the whole sheet (the stadium reads as the
//             lyric, top to bottom), then cranes straight down onto the pitch in steps on the kicks, the roll
//             settling to zero; the crowd pulses with the kicks, beat rings run through the rows, card-flip races
//             lap the bowl faster and faster, the floodlights strobe tower by tower.
//   hand-off  (H13) lights out on the last kick: only the touchlines and the long axis stay, and run out across the
//             sheet: three bone hairlines at y = 380 / 560 / 740 (TRACKS_H13), the edit timeline's tracks.
// Staged counter: FRAMES on the stadium's video board (left margin), in the plan's own annotation.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, W, H, SS_TAP } from '../px/gl';
import { LineBatch } from '../px/lines';
import { rgba } from '../px/palette';
import { F, font } from '../px/type';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep, TAU } from '../px/util';
import { wStart, wEnd, wText } from './lyric';
import { CUT, RAILS_H12, TRACKS_H13, frames } from './handoff';
import { PLAN_FRAG } from './stadium-glsl';
import {
  G, TOWERS, type Cam, type Xf, type WordBox, type Section,
  camXf, ap, lerpCam, heatCss, heatLin, seatCount, sections, buildLettering, grp,
} from './stadium-kit';

type Seg = { t0: number; dur: number; to: (f: Cam) => Cam; e: (x: number) => number; from?: Cam; target?: Cam };
const V4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);

/** hand-off poses. P0: the rails at RAILS_H12. P6: touchlines and axis at TRACKS_H13. */
const Z0 = (RAILS_H12.y2 - RAILS_H12.y1) / (2 * G.AY);
const Y0 = -((RAILS_H12.y1 + RAILS_H12.y2) / 2 - H / 2) / Z0;
const ZE = (TRACKS_H13.ys[2] - TRACKS_H13.ys[0]) / (2 * G.PW);
const YE = -(TRACKS_H13.ys[1] - H / 2) / ZE;
const P0: Cam = { x: 0, y: Y0, r: 0, z: Z0 };
const P6: Cam = { x: 0, y: YE, r: 0, z: ZE };

export default class Stadium extends Scene {
  plan = new FSPass(PLAN_FRAG, {
    ssTap: SS_TAP,
    uCam: { value: V4(0, 0, 0, Z0) }, uT: { value: 0 }, uMask: { value: null },
    uRev0: { value: V4() }, uRev1: { value: V4() },
    uOnX: { value: V4() }, uEvX: { value: V4() }, uCrX: { value: V4() },
    uPaintSplit: { value: 0 }, uRainSplit: { value: new THREE.Vector2() }, uRainT: { value: new THREE.Vector3(99, 99, 99) },
    uRainK: { value: 0 }, uCardK: { value: 0 },
    uRip: { value: Array.from({ length: 8 }, () => V4(0, 0, -99, 0)) },
    uWave: { value: Array.from({ length: 8 }, () => V4(0, -99, 0, 0)) },
    uPulse: { value: 0 }, uFlood: { value: V4() }, uLamp: { value: 0 }, uBoard: { value: 1 }, uBlack: { value: 0 }, uLineExt: { value: 0 },
  });
  L = new Layer2D();
  glow = new LineBatch(6000, { blend: 'add' });

  T = { t0: 0, t1: 0, k1: 0, rain: [0, 0, 0], on: 0, every: 0, crowd: 0, eCrowd: 0, out: 0, black: 0, crane: [] as number[] };
  segs: Seg[] = [];
  let_!: ReturnType<typeof buildLettering>;
  secs: Section[] = [];
  secT: number[] = [];
  seats = 0;
  racesT: number[] = [];
  strobeT: [number, number][] = [];
  buildHits: number[] = [];

  override init() {
    const T = this.T, au = this.ctx.audio;
    T.t0 = CUT.stadium; T.t1 = CUT.edit;
    T.rain = [wStart(76), wStart(77), wStart(78)];
    T.on = wStart(79); T.every = wStart(80); T.crowd = wStart(81); T.eCrowd = wEnd(81);
    const kicks = au.events('kick', T.t0 - 0.5, T.t1 + 0.5).map(([t]) => t);
    const snares = au.events('snare', T.t0 - 0.5, T.t1 + 0.5).map(([t]) => t);
    const hats = au.events('hat', T.t0 - 0.5, T.t1 + 0.5).map(([t]) => t);
    T.k1 = kicks.find((k) => k > T.t0 + 0.15 && k < T.rain[0]! - 0.12) ?? T.t0 + 0.25;
    const hits = [...kicks, ...snares].sort((a, b) => a - b);
    T.out = hits.find((h) => h > T.eCrowd + 0.1 && h < T.t1 - 0.9) ?? T.eCrowd + 0.18;
    T.crane = kicks.filter((k) => k > T.out + 0.15 && k < T.t1 - 0.12);
    if (T.crane.length < 2) T.crane = [lerp(T.out, T.t1, 0.35), lerp(T.out, T.t1, 0.6), lerp(T.out, T.t1, 0.8)];
    T.black = T.crane[T.crane.length - 1]!;
    // the build: races on the snares, strobes on every onset, beat rings on the kicks
    this.racesT = snares.filter((s) => s > T.out - 0.05 && s < T.black + 0.01);
    const all = [...kicks.map((t) => [t, 1] as [number, number]), ...snares.map((t) => [t, 2] as [number, number]), ...hats.map((t) => [t, 0] as [number, number])]
      .filter(([t]) => t > T.eCrowd - 0.02 && t < T.black - 0.005).sort((a, b) => a[0] - b[0]);
    this.strobeT = all;
    this.buildHits = kicks.filter((k) => k > T.eCrowd - 0.05 && k < T.black + 0.01);

    // lettering
    const line = `${wText(76)} ${wText(77)} ${wText(78)}`;
    this.let_ = buildLettering({ line, words: [wText(76), wText(77), wText(78)] });
    this.plan.u.uMask!.value = this.let_.tex;
    this.seats = seatCount();
    this.secs = sections();
    // a section label comes up when the resolve front passes it
    this.secT = this.secs.map((s) => this.timeOfFront(s.d));
    this.buildCamera();
  }

  // ------------------------------------------------------------------ resolve schedule
  front(t: number) { return 64 * ease.outQuad(prog(t, this.T.t0 + 0.03, this.T.t0 + 0.3)) - 0.5; }
  timeOfFront(d: number) { let a = this.T.t0, b = this.T.t0 + 0.5; for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (this.front(m) < d) a = m; else b = m; } return b; }
  arrT0() { return this.T.t0 + 0.06; }
  static ARR = 0.004;

  // ------------------------------------------------------------------ the camera
  buildCamera() {
    const T = this.T;
    const P1: Cam = { x: 0, y: -10, r: 0, z: 4.3 };
    const P2: Cam = { x: 0, y: 0.5, r: 0, z: 6.0 };
    const P4: Cam = { x: 0, y: G.AY + 29, r: 0.012, z: 5.7 };
    const P5: Cam = { x: 0, y: 4, r: -0.045, z: 2.75 };
    const nod = (k: number, dy = 0) => (f: Cam) => ({ ...f, z: f.z * k, y: f.y + dy });
    const S: Seg[] = [
      { t0: T.t0, dur: T.k1 - T.t0, to: nod(0.985), e: ease.linear },
      { t0: T.k1, dur: 0.42, to: () => P1, e: ease.outExpo },
      { t0: T.rain[0]!, dur: 0.2, to: nod(1.04), e: ease.outExpo },
      { t0: T.rain[1]!, dur: 0.2, to: nod(1.035), e: ease.outExpo },
      { t0: T.rain[2]!, dur: 0.22, to: nod(1.05, -1), e: ease.outExpo },
      { t0: T.on - 0.03, dur: 0.3, to: () => P2, e: ease.outExpo },
      { t0: T.every, dur: 0.22, to: nod(1.06, 1.5), e: ease.outExpo },
      { t0: T.crowd - 0.05, dur: 0.32, to: () => P4, e: ease.outExpo },
      { t0: T.eCrowd, dur: Math.max(0.05, T.out - T.eCrowd), to: nod(1.035), e: ease.linear },
      { t0: T.out, dur: 0.26, to: () => P5, e: ease.outExpo },
    ];
    const n = T.crane.length;
    T.crane.forEach((k, i) => {
      const dur = lerp(0.22, 0.12, i / Math.max(1, n - 1));
      S.push({ t0: k, dur, to: i === n - 1 ? () => P6 : () => lerpCam(P5, P6, ease.inQuad((i + 1) / n) * 0.35 + ((i + 1) / n) * 0.65), e: ease.outExpo });
    });
    S.sort((a, b) => a.t0 - b.t0);
    let cur: Cam = P0;
    for (let i = 0; i < S.length; i++) {
      const s = S[i]!;
      const prev = S[i - 1];
      if (prev) cur = lerpCam(prev.from!, prev.target!, prev.e(clamp((s.t0 - prev.t0) / prev.dur)));
      s.from = cur; s.target = s.to(cur);
    }
    this.segs = S;
  }

  cam(t: number): Cam {
    const S = this.segs;
    let s: Seg | undefined;
    for (const x of S) if (x.t0 <= t) s = x;
    const base = s ? lerpCam(s.from!, s.target!, s.e(clamp((t - s.t0) / s.dur))) : P0;
    // anticipation before each crane step, roll kicks on the build's snares (both zero at the cut)
    const T = this.T;
    let z = base.z, r = base.r;
    for (const k of T.crane) z *= 1 - 0.018 * Math.sin(Math.PI * prog(t, k - 0.08, k)) ** 2;
    const gate = 1 - smoothstep(T.t1 - 0.25, T.t1 - 0.08, t);
    this.racesT.forEach((rt, i) => { r += (i % 2 ? 1 : -1) * 0.007 * pulse(t, rt, 0.06) * gate; });
    return { x: base.x, y: base.y, r, z };
  }

  // ------------------------------------------------------------------ render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const T = this.T, t = f.t;
    const cam = this.cam(t);
    const m = camXf(cam);
    const u = this.plan.u;
    const build = prog(t, T.eCrowd, T.black);
    const black = smoothstep(T.black - 0.005, T.black + 0.05, t);
    (u.uCam!.value as THREE.Vector4).set(cam.x, cam.y, cam.r, cam.z);
    u.uT!.value = t;
    const sheet = prog(t, T.t0 + 0.12, T.t0 + 0.42, ease.outQuad);
    (u.uRev0!.value as THREE.Vector4).set(
      -0.5 + 48.5 * ease.outCubic(prog(t, T.t0 + 0.02, T.t0 + 0.24)),
      this.front(t),
      76 * ease.outCubic(prog(t, T.k1, T.k1 + 0.26)),
      sheet,
    );
    (u.uRev1!.value as THREE.Vector4).set(1 - prog(t, T.t0 + 0.06, T.t0 + 0.34, ease.inOutQuad), prog(t, T.t0 + 0.24, T.t0 + 0.44), this.arrT0(), Stadium.ARR);
    const L = this.let_;
    const dOn = Math.max(0.12, wEnd(79) - T.on), dEv = Math.max(0.12, wEnd(80) - T.every);
    (u.uOnX!.value as THREE.Vector4).set(L.on.x0, L.on.w, T.on, dOn);
    (u.uEvX!.value as THREE.Vector4).set(L.ev.x0, L.ev.w, T.every, dEv);
    (u.uCrX!.value as THREE.Vector4).set(L.cr.x0, L.cr.w, T.crowd, Math.min(0.5, T.eCrowd - T.crowd));
    u.uPaintSplit!.value = (L.on.base + L.ev.top) / 2;
    const rw = L.rain;
    (u.uRainSplit!.value as THREE.Vector2).set((rw[0]!.x0 + rw[0]!.w + rw[1]!.x0) / 2, (rw[1]!.x0 + rw[1]!.w + rw[2]!.x0) / 2);
    (u.uRainT!.value as THREE.Vector3).set(T.rain[0]! + 0.42, T.rain[1]! + 0.42, T.rain[2]! + 0.42);
    u.uRainK!.value = 1 - 0.35 * build;
    u.uCardK!.value = 1;
    // impacts: the rain words, then beat rings through the rows on the build's kicks (timed to reach the rail on the kick)
    const rip = u.uRip!.value as THREE.Vector4[];
    rw.forEach((w, i) => rip[i]!.set(w.x0 + w.w / 2, (w.top + w.bot) / 2, T.rain[i]!, [0.9, 0.7, 1.3][i]!));
    const bh = this.buildHits.filter((k) => k <= t + 0.7).slice(-5);
    for (let i = 0; i < 5; i++) {
      const k = bh[i];
      if (k === undefined) rip[3 + i]!.set(0, 0, -99, 0);
      else rip[3 + i]!.set(0, 0, k - G.AY / 72, 0.55 + 0.5 * prog(k, T.eCrowd, T.black));
    }
    // waves: stadium waves from "Rain" and "down", then card-flip races on the build's snares
    const wv = u.uWave!.value as THREE.Vector4[];
    const angOf = (w: WordBox) => Math.atan2(((w.top + w.bot) / 2) * 1.2, w.x0 + w.w / 2);
    wv[0]!.set(angOf(rw[0]!), T.rain[0]! + 0.12, 3.4, 0.7);
    wv[1]!.set(angOf(rw[2]!), T.rain[2]! + 0.1, 4.6, 1.0);
    wv[2]!.set(angOf(rw[2]!), T.rain[2]! + 0.1, -4.6, 1.0);
    for (let i = 0; i < 5; i++) {
      const rt = this.racesT[i];
      if (rt === undefined) wv[3 + i]!.set(0, -99, 0, 0);
      else wv[3 + i]!.set(hash(i, 17) * TAU, rt, (i % 2 ? -1 : 1) * (4.2 + 1.6 * i), -1);
    }
    const kickP = audio.hit('kick', t, 0.07), snP = audio.hit('snare', t, 0.08);
    u.uPulse!.value = (t < T.eCrowd ? 0.22 * kickP : (kickP + 0.7 * snP) * (0.35 + 1.1 * build)) * (1 - black);
    // floodlights: steady once up, strobing tower by tower in the build
    const fl = u.uFlood!.value as THREE.Vector4;
    const fa = [0, 0, 0, 0];
    this.strobeT.forEach(([st, kind], i) => {
      if (st > t) return;
      const p = pulse(t, st, kind === 1 ? 0.06 : 0.04) * (0.5 + 0.7 * prog(st, T.eCrowd, T.black));
      if (kind === 1) for (let k = 0; k < 4; k++) fa[k] = Math.max(fa[k]!, p * 0.8);
      else fa[i % 4] = Math.max(fa[i % 4]!, p);
    });
    fl.set(fa[0]! * (1 - black), fa[1]! * (1 - black), fa[2]! * (1 - black), fa[3]! * (1 - black));
    u.uLamp!.value = 0.35 * prog(t, T.t0 + 0.3, T.t0 + 0.5) * (1 - black);
    u.uBoard!.value = lerp(1.55, 0.62, prog(t, T.t0 + 0.08, T.t0 + 0.45)) + (t > T.eCrowd ? 0.8 * kickP * build : 0);
    u.uBlack!.value = black;
    u.uLineExt!.value = G.PL + Math.max(0, t - T.black) * 1100;
    this.plan.render(renderer, out);

    // ---- annotation, the falling words, sparks
    const Lc = this.L; Lc.clear(); const c = Lc.ctx;
    this.glow.clear();
    const aOv = 1 - black;
    if (aOv > 0.001) {
      this.drawSheet(c, m, cam, t, sheet * aOv);
      this.drawRain(c, m, cam, t, aOv);
    }
    this.ctx.comp.draw(renderer, Lc.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);

    // ---- post: shake and punch on the hits, zero at both hand-offs
    const gate = smoothstep(T.t0 + 0.02, T.t0 + 0.14, t) * (1 - smoothstep(T.t1 - 0.2, T.t1 - 0.05, t));
    const rainHit = T.rain.reduce((s, r, i) => s + pulse(t, r, 0.06) * [5, 3.5, 8][i]!, 0);
    const amp = (rainHit + (2 + 7 * build) * kickP + 3 * build * snP) * gate * (1 - black);
    const flash = Math.max(...fa) * 0.012 * gate;
    return {
      bloom: 0.62, vignette: 0.42, ca: 1.2 + 0.8 * build * kickP, halation: 0.28,
      shake: [amp * noise1(t * 45, 3), amp * noise1(t * 45, 9)],
      zoom: 1 + (0.012 * pulse(t, T.rain[2]!, 0.08) + 0.014 * build * kickP) * gate,
      flash,
    };
  }

  // ------------------------------------------------------------------ the sheet's annotation (world-anchored)
  text(c: CanvasRenderingContext2D, m: Xf, cam: Cam, x: number, y: number, s: string, sizeM: number, fam: string, fill: string, align: CanvasTextAlign = 'left', rot = 0, spacing = 0) {
    const px = sizeM * cam.z;
    if (px < 5.5) return;
    const p = ap(m, x, y);
    if (p.x < -600 || p.x > W + 600 || p.y < -200 || p.y > H + 200) return;
    c.save();
    c.translate(p.x, p.y); c.rotate(cam.r + rot);
    c.font = font(fam, px); c.textAlign = align; c.fillStyle = fill;
    c.letterSpacing = spacing ? `${spacing * px}px` : '0px';
    c.fillText(s, 0, 0);
    c.restore();
  }

  drawSheet(c: CanvasRenderingContext2D, m: Xf, cam: Cam, t: number, a: number) {
    const T = this.T;
    const mono = F.mono(500), mono4 = F.mono(400), mono6 = F.mono(600);
    const age0 = t - (T.t0 + 0.14);
    const hair = 1 / cam.z;
    const world = () => c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const scr = () => c.setTransform(1, 0, 0, 1, 0, 0);

    // section numbers: boxed, over the seating, hot as the front passes
    for (let i = 0; i < this.secs.length; i++) {
      const s = this.secs[i]!;
      const ta = this.secT[i]!;
      if (t < ta || cam.z * 2.2 < 7) continue;
      const p = ap(m, s.x, s.y);
      if (p.x < -40 || p.x > W + 40 || p.y < -30 || p.y > H + 30) continue;
      const px = 2.2 * cam.z, age = t - ta;
      c.save(); c.translate(p.x, p.y); c.rotate(cam.r);
      c.font = font(mono, px); c.textAlign = 'center'; c.textBaseline = 'middle';
      const w = px * 2.1, h = px * 1.25;
      c.fillStyle = rgba('ink', 0.88 * a); c.fillRect(-w / 2, -h / 2, w, h);
      c.strokeStyle = rgba('ash', 0.45 * a); c.lineWidth = 1; c.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      c.fillStyle = heatCss(age, 0.8 * a, 'ash');
      c.fillText(String(s.n), 0, px * 0.05);
      c.restore();
    }
    if (a < 0.01) return;
    const ash = rgba('ash', 0.75 * a), bone = rgba('bone', 0.88 * a), graph = rgba('graphite', 0.9 * a);

    // dimensions (engineer's style: extension lines, slash ticks, dimension in mm)
    world(); c.lineWidth = hair; c.strokeStyle = ash;
    const tick = (x: number, y: number) => { c.beginPath(); c.moveTo(x - 1.4, y + 1.4); c.lineTo(x + 1.4, y - 1.4); c.stroke(); };
    const dimV = (x: number, y0: number, y1: number, label: string) => {
      c.beginPath(); c.moveTo(x, y0 - 3); c.lineTo(x, y1 + 3); c.stroke(); tick(x, y0); tick(x, y1);
      scr(); this.text(c, m, cam, x - 2.2, (y0 + y1) / 2, label, 2.6, mono, heatCss(age0, 0.8 * a, 'ash'), 'center', -Math.PI / 2); world(); c.lineWidth = hair; c.strokeStyle = ash;
    };
    const dimH = (y: number, x0: number, x1: number, label: string) => {
      c.beginPath(); c.moveTo(x0 - 3, y); c.lineTo(x1 + 3, y); c.stroke(); tick(x0, y); tick(x1, y);
      scr(); this.text(c, m, cam, (x0 + x1) / 2, y - 1.6, label, 2.6, mono, heatCss(age0, 0.8 * a, 'ash'), 'center'); world(); c.lineWidth = hair; c.strokeStyle = ash;
    };
    const OX = G.AX + G.DOUT, OY = G.AY + G.DOUT;
    c.beginPath();
    for (const s of [-1, 1]) { c.moveTo(-OX - 3, s * OY); c.lineTo(-142, s * OY); c.moveTo(s * G.PL, -OY - 3); c.lineTo(s * G.PL, -128); c.moveTo(s * OX, -OY - 3); c.lineTo(s * OX, -137); }
    c.stroke();
    dimV(-131, -G.AY, G.AY, '88 000');
    dimV(-139, -OY, OY, grp(2 * OY * 1000).replace(',', ' '));
    dimH(-125, -G.PL, G.PL, '105 000');
    dimH(-134, -OX, OX, grp(2 * OX * 1000).replace(',', ' '));
    // section boundary leader to the pitch: "PITCH 105 × 68" callout
    scr();
    this.text(c, m, cam, -G.PL + 1.5, -G.PW - 1.6, 'FIELD OF PLAY 105 × 68 · NATURAL GRASS · MOWN 5.25', 1.9, mono4, rgba('ash', 0.7 * a));
    this.text(c, m, cam, -G.AX + 8, -G.AY + 4.4, 'LED BOARD (FRONT RAIL) · 0 dBFS', 1.9, mono4, rgba('signal', 0.8 * a));
    this.text(c, m, cam, G.AX + 1.5, G.AY + 15.2, 'ROOF EDGE ABOVE', 1.7, mono4, rgba('ash', 0.55 * a));
    this.text(c, m, cam, -238, -1.4, 'C/L', 2.4, mono, ash);
    this.text(c, m, cam, 232, -1.4, 'C/L', 2.4, mono, ash);

    // floodlight towers
    TOWERS.forEach(([x, y], i) => {
      const sx = Math.sign(x), sy = Math.sign(y);
      const ta = age0 - 0.12;
      this.text(c, m, cam, x + sx * 9, y + sy * 7, `FL-${i + 1}`, 3.4, mono6, heatCss(ta, 0.9 * a, 'bone'), sx > 0 ? 'left' : 'right');
      this.text(c, m, cam, x + sx * 9, y + sy * 7 + 3.4, '48 × 2 kW · AIM 12°', 1.9, mono4, ash, sx > 0 ? 'left' : 'right');
    });
    // gates round the esplanade
    const gates: [number, number, string][] = [[-60, -1, 'A'], [0, -1, 'B'], [60, -1, 'C'], [1, 0, 'D'], [60, 1, 'E'], [0, 1, 'F'], [-60, 1, 'G'], [-1, 0, 'H']];
    for (const [gx, gs, n] of gates) {
      const x = Math.abs(gx) === 1 ? gx * (OX + 7) : gx, y = Math.abs(gx) === 1 ? 62 : gs * (OY + 14);
      this.text(c, m, cam, x, y + 1.2, `GATE ${n}`, 2.3, mono, ash, 'center');
    }

    // title block with the capacity readout (east margin)
    const bx = 146, by = -54, bw = 74, bh = 98;
    world(); c.fillStyle = rgba('ink', 0.94 * a); c.fillRect(bx, by, bw, bh); c.fillRect(bx, 52, bw, 50);
    c.lineWidth = hair * 1.5; c.strokeStyle = rgba('bone', 0.6 * a);
    c.strokeRect(bx, by, bw, bh);
    c.lineWidth = hair;
    for (const yy of [by + 16, by + 42, by + 58, by + 74]) { c.beginPath(); c.moveTo(bx, yy); c.lineTo(bx + bw, yy); c.stroke(); }
    scr();
    this.text(c, m, cam, bx + 3, by + 7, 'ONE PROMPT ARENA', 4.4, mono6, bone, 'left', 0, 0.04);
    this.text(c, m, cam, bx + 3, by + 12.5, 'S-01 · SEATING PLAN · 1:500 · REV A', 2.2, mono4, ash);
    const arrived = clamp((t - this.arrT0()) / (Stadium.ARR * 58));
    const full = t >= T.rain[0]!;
    this.text(c, m, cam, bx + 3, by + 21, 'CAPACITY', 2.2, mono, ash, 'left', 0, 0.12);
    this.text(c, m, cam, bx + 3, by + 29, '60,000', 7.2, mono6, bone);
    this.text(c, m, cam, bx + 40, by + 21, 'ATTENDANCE', 2.2, mono, ash, 'left', 0, 0.12);
    this.text(c, m, cam, bx + 40, by + 29, full ? 'EVERYONE' : grp(60000 * ease.inOutQuad(arrived)), full ? 5.4 : 7.2, mono6, full ? heatCss(t - T.rain[0]!, a) : bone);
    this.text(c, m, cam, bx + 3, by + 37.5, `CAPACITY 60,000 · ATTENDANCE: ${full ? 'EVERYONE' : grp(60000 * ease.inOutQuad(arrived))}`, 2.35, mono, full ? heatCss(t - T.rain[0]!, 0.95 * a) : bone);
    this.text(c, m, cam, bx + 3, by + 49, `SEATS DRAWN ${grp(this.seats)} · ${grp(60000 - this.seats)} TBC`, 2.2, mono4, ash);
    this.text(c, m, cam, bx + 3, by + 53.5, 'EVERY DOT IS ONE PERSON. EVERY PERSON IS ONE DOT.', 1.9, mono4, graph);
    this.text(c, m, cam, bx + 3, by + 65, 'DRAWN  THE PROMPT        CHECKED  —', 2.2, mono4, ash);
    this.text(c, m, cam, bx + 3, by + 70, 'WEATHER  RAIN, BY DESIGN', 2.2, mono4, ash);
    this.text(c, m, cam, bx + 3, by + 81, 'SHEET 1 OF 1', 2.2, mono4, ash);
    this.text(c, m, cam, bx + 3, by + 86, 'FOR DISTRIBUTION: EVERYWHERE', 2.2, mono4, ash);

    // seat map legend (east margin, below the title block)
    const lx = 146, ly = 52;
    world(); c.lineWidth = hair; c.strokeStyle = rgba('bone', 0.45 * a); c.strokeRect(lx, ly, bw, 50);
    scr();
    this.text(c, m, cam, lx + 3, ly + 5.5, 'SEAT MAP LEGEND', 2.4, mono6, bone, 'left', 0, 0.1);
    const rows: [string, string][] = [
      ['dot', 'SEAT, OCCUPIED (ONE PERSON)'], ['ring', 'SEAT, VACANT (NONE TONIGHT)'], ['card', 'CARD, BONE SIDE — LETTER'],
      ['hot', 'CARD, SIGNAL SIDE — ON CUE'], ['vom', 'VOMITORY (TUNNEL MOUTH)'], ['lamp', 'FLOODLIGHT, 48 × 2 kW'], ['dash', 'ROOF EDGE ABOVE'],
    ];
    rows.forEach(([k, s], i) => {
      const yy = ly + 11 + i * 5.6, sx = lx + 5;
      const p = ap(m, sx, yy - 0.8), r = 0.9 * cam.z;
      c.save(); c.translate(p.x, p.y); c.rotate(cam.r);
      c.strokeStyle = rgba('ash', 0.8 * a); c.lineWidth = 1;
      if (k === 'dot') { c.fillStyle = rgba('ash', 0.9 * a); c.beginPath(); c.arc(0, 0, r * 0.5, 0, TAU); c.fill(); }
      if (k === 'ring') { c.strokeStyle = rgba('graphite', a); c.beginPath(); c.arc(0, 0, r * 0.55, 0, TAU); c.stroke(); }
      if (k === 'card') { c.fillStyle = rgba('bone', 0.85 * a); c.fillRect(-r * 0.55, -r * 0.7, r * 1.1, r * 1.4); }
      if (k === 'hot') { c.fillStyle = rgba('signal', a); c.fillRect(-r * 0.55, -r * 0.7, r * 1.1, r * 1.4); }
      if (k === 'vom') { c.strokeRect(-r, -r * 0.7, r * 2, r * 1.4); c.beginPath(); c.moveTo(-r, r * 0.7); c.lineTo(r, -r * 0.7); c.stroke(); }
      if (k === 'lamp') { c.fillStyle = rgba('ember', a); c.beginPath(); c.arc(0, 0, r * 0.5, 0, TAU); c.fill(); }
      if (k === 'dash') { c.setLineDash([r * 0.8, r * 0.5]); c.beginPath(); c.moveTo(-r * 1.3, 0); c.lineTo(r * 1.3, 0); c.stroke(); c.setLineDash([]); }
      c.restore();
      this.text(c, m, cam, lx + 9.5, yy, s, 2.1, mono4, ash);
    });

    // the video board (west margin): the in-world counter
    const vx = -220, vy = -40, vw = 74, vh = 40;
    world(); c.fillStyle = rgba('ink', 0.94 * a); c.fillRect(vx, vy, vw, vh); c.lineWidth = hair * 1.5; c.strokeStyle = rgba('bone', 0.6 * a); c.strokeRect(vx, vy, vw, vh);
    c.lineWidth = hair; c.strokeRect(vx + 2, vy + 2, vw - 4, vh - 4);
    scr();
    this.text(c, m, cam, vx, vy - 2.5, 'VIDEO BOARD 01 · 32 × 18 m · NOW SHOWING', 2.2, mono, ash);
    this.text(c, m, cam, vx + 6, vy + 13, 'FRAMES', 3.2, mono, rgba('ash', 0.9 * a), 'left', 0, 0.2);
    const fr = frames(t);
    this.text(c, m, cam, vx + 6, vy + 29, grp(fr), 13, mono6, bone);
    this.text(c, m, cam, vx + 6, vy + 35, '24 PER SECOND · ALL OF THEM OURS', 2.1, mono4, ash);
    // notes
    const notes = ['NOTES', '1. ONE DOT = ONE PERSON = ONE FULL STOP.', '2. ALL SEATS FACE THE PROMPT.', '3. RAIN IS PART OF THE DESIGN.', '4. CARD STUNT: HOLD UP ON THE WORD.', '5. DO NOT SCALE. IT SCALES.'];
    notes.forEach((s, i) => this.text(c, m, cam, vx, 10 + i * 4.6, s, i ? 2.1 : 2.5, i ? mono4 : mono6, i ? ash : bone, 'left', 0, i ? 0 : 0.1));
    // north arrow and scale bar
    const nx = -200, ny = 72;
    world(); c.lineWidth = hair * 1.2; c.strokeStyle = rgba('bone', 0.7 * a);
    c.beginPath(); c.arc(nx, ny, 7, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(nx, ny - 10); c.lineTo(nx + 2.2, ny); c.lineTo(nx, ny + 10); c.lineTo(nx - 2.2, ny); c.closePath(); c.stroke();
    c.fillStyle = rgba('bone', 0.8 * a); c.beginPath(); c.moveTo(nx, ny - 10); c.lineTo(nx + 2.2, ny); c.lineTo(nx - 2.2, ny); c.closePath(); c.fill();
    const sbx = -220, sby = 94;
    for (let i = 0; i < 5; i++) { c.fillStyle = rgba(i % 2 ? 'ink' : 'bone', 0.7 * a); c.fillRect(sbx + i * 10, sby, 10, 1.6); }
    c.strokeRect(sbx, sby, 50, 1.6);
    scr();
    this.text(c, m, cam, nx, ny - 12, 'N', 3.4, F.serif(600), bone, 'center');
    [0, 10, 20, 50].forEach((v) => this.text(c, m, cam, sbx + v, sby + 5, String(v), 1.9, mono4, ash, 'center'));
    this.text(c, m, cam, sbx + 54, sby + 1.8, 'm', 1.9, mono4, ash);
  }

  // ------------------------------------------------------------------ "Rain it down": falling, landing, soaking in
  drawRain(c: CanvasRenderingContext2D, m: Xf, cam: Cam, t: number, a: number) {
    const T = this.T, L = this.let_;
    const TF = 0.27, FALL = 640;
    const off = (tt: number, ts: number) => { const u = clamp((tt - (ts - TF)) / TF); return -FALL * (1 - u) * (1 - 0.25 * u); };
    c.setTransform(1, 0, 0, 1, 0, 0);
    L.rain.forEach((w, i) => {
      const ts = T.rain[i]!;
      if (t < ts - TF) return;
      const soak = prog(t, ts + 0.45, ts + 0.75, ease.inQuad);
      if (soak >= 1) return;
      const px = w.size * cam.z;
      const p = ap(m, w.x0, w.base);
      const fam = L.famR;
      const falling = t < ts;
      const sy = falling ? 1.08 : 1 - 0.16 * pulse(t, ts, 0.05);
      const draw = (dy: number, fill: string) => {
        c.save(); c.translate(p.x, p.y + dy); c.rotate(cam.r); c.scale(1, sy);
        c.font = font(fam, px); c.fillStyle = fill; c.fillText(w.text, 0, 0); c.restore();
      };
      if (falling) {
        // the word falls as one unit, a stroboscopic streak behind it
        for (let k = 6; k >= 1; k--) draw(off(t - k * 0.011, ts), rgba('bone', 0.07 * (1 - k / 7) * a));
        const dy = off(t, ts), v = FALL / TF;
        draw(dy, rgba('bone', 0.34 * a));
        // speed lines above the letters
        const n = w.text.length * 3;
        for (let k = 0; k < n; k++) {
          const x = p.x + (k + 0.5) / n * w.w * cam.z, top = p.y + dy - (w.base - w.top) * cam.z;
          const len = v * (0.03 + 0.05 * hash(k, i, 3));
          this.glow.seg2(x, top - 4, x, top - 4 - len, 1, [0.22, 0.21, 0.19], 0.5 * a);
        }
      } else {
        draw(0, heatCss(t - ts, (1 - soak) * a));
      }
      // the splash: drops thrown out along the ground from the impact, hot, streaked
      if (!falling && t < ts + 0.6) {
        const N = 46;
        for (let k = 0; k < N; k++) {
          const u0 = hash(k, i, 1), ang = hash(k, i, 2) * TAU, sp = (160 + 520 * hash(k, i, 3) ** 2) * (cam.z / 4.3);
          const life = 0.22 + 0.3 * hash(k, i, 4), age = t - ts;
          if (age > life) continue;
          const o = ap(m, w.x0 + u0 * w.w, lerp(w.top, w.bot, 0.3 + 0.7 * hash(k, i, 5)));
          const dist = (tt: number) => sp * (1 - Math.exp(-tt * 7)) / 7;
          const r1 = dist(age), r0 = dist(Math.max(0, age - 0.025));
          const kk = 1 - age / life;
          const col = heatLin(age * 0.8, 1.2 * kk);
          this.glow.seg2(o.x + Math.cos(ang) * r0, o.y + Math.sin(ang) * r0 * 0.9, o.x + Math.cos(ang) * r1, o.y + Math.sin(ang) * r1 * 0.9, 1.6 * (0.5 + kk), col, Math.min(1, kk * 1.6));
        }
      }
    });
  }
}

