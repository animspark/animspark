// Plate `earth` — FIG. 16, the release: "Say it once and watch it spin / Every word becomes a light"
// (CUT.earth → CUT.premiere). The final chorus: the film goes out to the world. One continuous camera.
//   H15     the hook's bone circle is the limb of an engraved globe (3 px, r 380, frame centre): the camera
//           starts dead on, at the distance where the sphere's silhouette is exactly that circle.
//   fill    the graticule is drawn in (meridians north → south, parallels west → east, hot heads), then the
//           engraving comes up from the sub-camera point with a hot front: parallels lifted by the relief
//           (width = light), waterlines hugging the coasts, elevation contours in Tanaka light, the
//           terminator in diagonal crosshatch; a banknote rosette rings the limb.
//   M1      the caret is a satellite (SAT-1) in a 23° orbit. It lays the orbit down as an engraved ribbon and
//           writes the lyric on it (text on a projected 3D circle: advance = projected chord, height = the
//           orbit normal's projection); the ribbon turns so the sung word reads at the front. On every word it
//           drops a print to the city under it; from each city lit, distribution arcs leap to the nearest
//           cities (hot heads, heat-by-age wakes). "spin": SPIN widens 87.5 → 125, the globe whips a full
//           turn on a spring, the graticule streaks, and every lit city fans out three arcs at once.
//   swing   hold, then snap on the downbeat: the camera swings round to the night side (the terminator
//           sweeps the disc, the lights come on) while the spark de-orbits into a dark continent.
//   M2      "Every word becomes a light": each word is written in city lights across the continent (thousands
//           of lights in the globe's own projection, lit as the spark passes, hot → sodium; "light" stays
//           the brightest); each word sends an ignition wave over the night side until it is one field.
//   H17     the spark dots the i of "light" on the beat, and that tittle is the city: the camera dives
//           (log zoom, oblique → plumb) until the frame is dark with one hot point at frame centre.
// Caused detail: graticule labels on the lines, cinema-city labels as they light, the orbit ticks and the
// predicted track, sub-satellite ground track, SAT-1 telemetry, the legend, SCREENINGS and FRAMES.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, SS_TAP } from '../px/gl';
import { LineBatch } from '../px/lines';
import { LIN, rgba } from '../px/palette';
import { F, font, layout, measure, textPoints } from '../px/type';
import { clamp, ease, lerp, prog, pulse, noise1, smoothstep, springStep, hash, TAU, frameIdx } from '../px/util';
import { sparkHead, sparkParticles } from '../px/motifs';
import { wStart, wEnd, charTimes } from './lyric';
import { CUT, GLOBE_H15, POINT_H17, frames } from './handoff';
import { FRAG_EARTH } from './earth-glsl';
import * as G from './earth-geo';
import type { V3, Cam } from './earth-geo';

const { W, H } = G;
const T0 = CUT.earth, T1 = CUT.premiere;
const F0 = 1400;
/** at the cut the camera sits where the unit sphere's silhouette is GLOBE_H15.r px */
const D0 = Math.sqrt(1 + (F0 / GLOBE_H15.r) ** 2);
const SUN: V3 = G.norm([-0.9, 0.32, 0.3]);
const TILT = G.mm(G.rotZ(0.41), G.rotX(0.12));
const PHI0 = 0.35;
// the orbit: a great circle of radius RO, inclined 23° toward the camera, rolled 10°
const RO = 1.36, SZ = 0.2; // ribbon lettering: 100 px of font = SZ world units
const ORB = G.mm(G.rotZ(0.18), G.rotX(0.4));
const OA = G.mv(ORB, [-1, 0, 0]), OB = G.mv(ORB, [0, 0, 1]), ON = G.mv(ORB, [0, 1, 0]);
const orbitP = (th: number, r = RO): V3 => G.add(G.mul(OA, r * Math.cos(th)), G.mul(OB, r * Math.sin(th)));
const TH_A = Math.PI / 2 - 0.42; // where the head starts writing (front-left)
const W1 = 96, W2 = 103; // first word of each movement
const LINE1 = 'SAY IT ONCE AND WATCH IT SPIN';
const FAM1 = F.archivo(112.5, 700);
const TRACK1 = 7; // px at 100
const ARCHW = [62, 75, 87.5, 100, 112.5, 125];
const nearestW = (w: number) => ARCHW.reduce((b, x) => (Math.abs(x - w) < Math.abs(b - w) ? x : b), ARCHW[0]!);

type RGB = [number, number, number];
const sc3 = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mixc = (a: RGB, b: RGB, u: number): RGB => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const grp = (n: number, w = 4) => String(Math.max(0, Math.floor(n))).padStart(w, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
/** fresh type: ember → signal → bone over ~0.35 s (CSS) */
function hotCss(age: number, a = 1): string {
  const E: RGB = [255, 154, 77], S: RGB = [255, 90, 31], B: RGB = [238, 233, 223];
  const c = age < 0.07 ? mixc(E, S, age / 0.07) : mixc(S, B, smoothstep(0.07, 0.36, age));
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
/** heat-by-age for drawn lines (linear HDR): white-hot tip, signal wake, then `base` */
function heatLin(age: number, base: RGB): RGB {
  if (age < 0) return [0, 0, 0];
  const tip = Math.exp(-age / 0.05), wake = Math.exp(-age / 0.32);
  const c = mixc(base, sc3(LIN.signal, 1.15), wake);
  return mixc(c, [5, 3.6, 2.4], tip);
}

interface RGlyph { ch: string; word: number; tg: number; spin: boolean }
interface Arc { a: number; b: number; t0: number; dur: number; h: number } // a = -1: the satellite's drop
interface Dot { q: V3; t0: number; word: number; big: number }
interface WordL { k: number; txt: string; u0: number; u1: number; vMid: number; vBase: number; em: number; ws: number; we: number; ctr: V3; dotT: number[] }

export default class Earth extends Scene {
  pass = new FSPass(FRAG_EARTH, {
    res: { value: new THREE.Vector2(W, H) }, ssTap: SS_TAP,
    camPos: { value: new THREE.Vector3() }, camR: { value: new THREE.Vector3() }, camU: { value: new THREE.Vector3() }, camF: { value: new THREE.Vector3() },
    focal: { value: F0 }, uM: { value: new THREE.Matrix3() }, uSun: { value: new THREE.Vector3(...SUN) }, uTime: { value: 0 },
    uGratA: { value: 0 }, uGratHead: { value: 0 }, uRev: { value: 0 }, uSurf: { value: 1 }, uStars: { value: 0 },
    uLimbA: { value: 1 }, uLimbW: { value: 3 }, uRos: { value: 0 }, uRosPh: { value: 0 }, uDawn: { value: 0 },
    uLights: { value: 0 }, uLitBase: { value: 0 },
    uWave: { value: Array.from({ length: 5 }, () => new THREE.Vector4(0, 1, 0, 99)) }, uWaveSp: { value: 0.9 },
    uHole: { value: new THREE.Vector4(0, 1, 0, 0) },
    uBlob: { value: G.BLOBS.map((b) => new THREE.Vector4(b.c[0], b.c[1], b.c[2], b.s)) }, uBlobW: { value: G.BLOBS.map((b) => b.w) },
  });
  glow = new LineBatch(40000);
  top = new LineBatch(6000);
  L = new Layer2D();

  // timing
  tSay = 0; tSpin = 0; tEnd1 = 0; tSwing = 0; tEvery = 0; tLight = 0; tLightEnd = 0; tDot = 0; tLand = 0;
  // M1
  rg: RGlyph[] = [];
  cities: G.City[] = [];
  litAt: number[] = [];
  arcs: Arc[] = [];
  drops: { t: number; city: number }[] = [];
  labelled: number[] = [];
  litSorted: number[] = [];
  litOrder: { tl: number; i: number }[] = [];
  // M2
  C: V3 = [1, 0, 0]; uE: V3 = [0, 0, 1]; vE: V3 = [0, 1, 0];
  dots: Dot[] = [];
  words: WordL[] = [];
  tittle: V3 = [1, 0, 0];
  satE: V3 = [1, 0, 0];
  advCache = new Map<string, number>();

  // ---------------------------------------------------------------- init
  override init() {
    const au = this.ctx.audio;
    this.tSay = wStart(W1); this.tSpin = wStart(102); this.tEnd1 = wEnd(102);
    this.tSwing = au.downbeats.find((d) => d > this.tEnd1 + 0.3) ?? this.tEnd1 + 0.8;
    this.tEvery = wStart(W2); this.tLight = wStart(107); this.tLightEnd = wEnd(107);
    this.tDot = au.beats.find((b) => b > this.tLightEnd + 0.05) ?? this.tLightEnd + 0.12;
    this.tLand = T1 - 0.08;

    // ---- the ribbon lettering (glyph times from the per-character split of each word)
    const words1 = LINE1.split(' ');
    words1.forEach((w, i) => {
      const ct = charTimes(W1 + i);
      [...w].forEach((ch, j) => this.rg.push({ ch, word: W1 + i, tg: ct[j]!, spin: i === words1.length - 1 }));
      if (i < words1.length - 1) this.rg.push({ ch: ' ', word: W1 + i, tg: wEnd(W1 + i), spin: false });
    });

    // ---- the night continent: blob 0 sits where the camera will look at "Every"
    const tRef = this.tEvery;
    const Mr = this.M(tRef);
    const up: V3 = [0, 1, 0];
    const Pw = G.norm(G.sub(up, G.mul(SUN, G.dot(up, SUN))));
    const beta = 0.74;
    const Cw = G.norm(G.add(G.mul(SUN, -Math.cos(beta)), G.mul(Pw, Math.sin(beta))));
    this.C = G.mtv(Mr, Cw);
    const Pt = G.norm(G.sub(Pw, G.mul(Cw, G.dot(Pw, Cw))));
    this.vE = G.mtv(Mr, Pt);
    this.uE = G.cross(this.vE, this.C);
    G.BLOBS[0]!.c = G.norm(G.add(this.C, G.mul(this.vE, -0.07)));
    G.BLOBS[0]!.s = 0.22;
    const ub = this.pass.u.uBlob!.value as THREE.Vector4[];
    ub[0]!.set(G.BLOBS[0]!.c[0], G.BLOBS[0]!.c[1], G.BLOBS[0]!.c[2], G.BLOBS[0]!.s);

    // ---- the other continents, placed as seen in movement 1 (world directions at tM1)
    const tM1 = this.tSay + 0.9, M1 = this.M(tM1);
    const design: [V3, number, number][] = [
      [[-0.5, 0.42, 0.76], 0.085, 0.78], [[0.36, 0.56, 0.74], 0.05, 0.7], [[0.64, -0.12, 0.76], 0.06, 0.72],
      [[-0.18, -0.56, 0.8], 0.045, 0.66], [[-0.85, -0.2, -0.45], 0.09, 0.7], [[0.1, 0.3, -0.95], 0.06, 0.68], [[0.0, -0.97, 0.2], 0.05, 0.6],
    ];
    design.forEach(([d, s, w], i) => {
      const b = G.BLOBS[i + 1]!;
      b.c = G.mtv(M1, G.norm(d)); b.s = s; b.w = w;
      ub[i + 1]!.set(b.c[0], b.c[1], b.c[2], s);
      (this.pass.u.uBlobW!.value as number[])[i + 1] = w;
    });
    // ---- the lyric in lights, then the cities and the release network
    this.buildLights();
    this.cities = G.makeCities(420, 77);
    this.buildNetwork();
  }

  /** globe orientation: earth → world */
  phi(t: number) {
    let p = PHI0 + 0.16 * (Math.min(t, this.tSwing) - T0) + 0.035 * Math.max(0, t - this.tSwing);
    if (t > this.tSpin) p += TAU * springStep(t - this.tSpin, 1.15, 0.42);
    return p;
  }
  M(t: number) { return G.mm(TILT, G.rotY(this.phi(t))); }
  E2W(t: number, q: V3) { return G.mv(this.M(t), q); }

  // ---------------------------------------------------------------- M1: satellite & ribbon
  adv(ch: string, fam: string) {
    const k = fam + '|' + ch;
    let v = this.advCache.get(k);
    if (v === undefined) { v = measure(ch, fam, 100); this.advCache.set(k, v); }
    return v;
  }
  kern(a: string, b: string, fam: string) {
    const k = fam + '|' + a + b;
    let v = this.advCache.get(k);
    if (v === undefined) { v = measure(a + b, fam, 100) - measure(a, fam, 100) - measure(b, fam, 100); this.advCache.set(k, v); }
    return v;
  }
  /** per-glyph layout of the ribbon line at t (SPIN widens as sung): arc-length start, advance, family, x-scale */
  ribbonLayout(t: number) {
    const out: { s: number; w: number; fam: string; sf: number }[] = [];
    let s = 0;
    this.rg.forEach((g, i) => {
      let fam = FAM1, sf = 1, track = TRACK1;
      if (g.spin) {
        const k = prog(t, g.tg, g.tg + 0.34, ease.outCubic);
        const wd = lerp(87.5, 125, k);
        const nw = nearestW(wd);
        fam = F.archivo(nw, 800); sf = wd / nw; track = lerp(TRACK1, 16, k);
      }
      const a = (g.ch === ' ' ? 34 : this.adv(g.ch, fam) * sf + track) * (SZ / 100);
      out.push({ s, w: a, fam, sf });
      s += a;
      const n = this.rg[i + 1];
      if (n && g.ch !== ' ' && n.ch !== ' ' && !g.spin) s += this.kern(g.ch, n.ch, fam) * (SZ / 100);
    });
    return { g: out, total: s };
  }
  /** arc length written at t */
  headS(t: number, lay = this.ribbonLayout(t)) {
    let h = 0;
    this.rg.forEach((g, i) => {
      if (t >= g.tg) {
        const nx = this.rg[i + 1];
        const dur = Math.max(0.05, Math.min(0.16, (nx ? nx.tg : g.tg + 0.2) - g.tg));
        h = lay.g[i]!.s + lay.g[i]!.w * clamp((t - g.tg) / dur);
      }
    });
    return h;
  }
  /** orbit angle of the head (the satellite): rises from behind the left limb, then turns with the writing */
  headTh(t: number, sH = this.headS(t)) {
    const pre = TH_A - 2.25 * (1 - ease.outCubic(prog(t, T0, this.tSay - 0.02)));
    return pre + 0.2 * sH / RO + 0.3 * Math.max(0, t - this.tEnd1);
  }
  satW(t: number): V3 {
    const th = this.headTh(t);
    return G.add(orbitP(th), G.mul(ON, SZ * 0.36));
  }

  // ---------------------------------------------------------------- the network (precomputed)
  camAt(t: number): Cam {
    return this.camera(t);
  }
  buildNetwork() {
    const N = this.cities.length;
    this.litAt = new Array(N).fill(Infinity);
    const taken = new Array(N).fill(false);
    // the drops: one print per sung word to the city under the satellite (visible from the camera then)
    const queue: { c: number; t: number }[] = [];
    for (let k = W1; k <= 102; k++) {
      const tw = wStart(k);
      const cam = this.camAt(tw);
      const M = this.M(tw);
      const sub = G.mtv(M, G.norm(this.satW(tw)));
      let best = -1, bd = -2;
      for (let i = 0; i < N; i++) {
        if (taken[i]) continue;
        const pw = G.mv(M, this.cities[i]!.q);
        const facing = G.dot(pw, G.norm(G.sub(cam.pos, pw)));
        if (facing < 0.35) continue;
        const d = G.dot(sub, this.cities[i]!.q) + 0.25 * facing;
        if (d > bd) { bd = d; best = i; }
      }
      if (best < 0) continue;
      taken[best] = true;
      const tl = tw + 0.1;
      this.drops.push({ t: tw, city: best });
      this.arcs.push({ a: -1, b: best, t0: tw, dur: 0.1, h: 0 });
      this.litAt[best] = tl;
      queue.push({ c: best, t: tl });
    }
    // the cascade: each lit city sends prints to its nearest unlit neighbours; after "spin", three at once
    const tStop = this.tSwing + 0.3;
    let guard = 0;
    while (queue.length && guard++ < 5000) {
      queue.sort((a, b) => a.t - b.t);
      const { c, t } = queue.shift()!;
      if (t > tStop) continue;
      const spun = t > this.tSpin - 0.05;
      const nKids = spun ? 3 : hash(c, 3) < 0.55 ? 2 : 1;
      const q = this.cities[c]!.q;
      const cand: { i: number; d: number }[] = [];
      for (let i = 0; i < N; i++) if (!taken[i]) cand.push({ i, d: G.angle(q, this.cities[i]!.q) });
      cand.sort((a, b) => a.d - b.d);
      for (let j = 0; j < nKids && j < cand.length; j++) {
        const pick = cand[Math.min(cand.length - 1, j + (hash(c, j, 9) < 0.3 ? 2 : 0))]!;
        if (pick.d > 1.1) break;
        taken[pick.i] = true;
        let t0 = t + 0.05 + 0.09 * j + 0.06 * hash(c, j);
        if (spun && t < this.tSpin + 0.1) t0 = Math.max(t0, this.tSpin + 0.02 + 0.03 * j);
        const dur = 0.16 + 0.42 * pick.d;
        this.arcs.push({ a: c, b: pick.i, t0, dur, h: 0.02 + 0.11 * pick.d });
        this.litAt[pick.i] = t0 + dur;
        queue.push({ c: pick.i, t: t0 + dur });
      }
    }
    this.litSorted = this.litAt.filter((x) => isFinite(x)).sort((a, b) => a - b);
    this.litOrder = this.litAt.map((tl, i) => ({ tl, i })).filter((o) => isFinite(o.tl)).sort((a, b) => a.tl - b.tl);
    // the labelled cities: the first lit that face the camera when they light
    const order = this.litAt.map((tl, i) => ({ tl, i })).filter((o) => isFinite(o.tl) && o.tl < this.tSwing).sort((a, b) => a.tl - b.tl);
    for (const o of order) {
      if (this.labelled.length >= 9) break;
      const cam = this.camAt(o.tl + 0.3);
      const pw = G.mv(this.M(o.tl + 0.3), this.cities[o.i]!.q);
      if (G.dot(pw, G.norm(G.sub(cam.pos, pw))) < 0.45) continue;
      const pp = G.project(cam, pw);
      if (!pp || pp.x < 160 || pp.x > W - 360 || pp.y < 180 || pp.y > H - 200) continue;
      if (pp.y > 640) continue; // under the ribbon
      if (this.labelled.some((j) => G.angle(this.cities[j]!.q, this.cities[o.i]!.q) < 0.42)) continue;
      this.labelled.push(o.i);
    }
    this.labelled.forEach((i, n) => (this.cities[i]!.name = G.NAMES[n % G.NAMES.length]!));
  }

  // ---------------------------------------------------------------- M2: the lyric in lights
  tp(u: number, v: number): V3 { return G.norm(G.add(this.C, G.add(G.mul(this.uE, u), G.mul(this.vE, v)))); }
  buildLights() {
    const lines: { words: number[]; v: number; em: number }[] = [
      { words: [103, 104], v: 0.165, em: 0.13 },
      { words: [105], v: -0.02, em: 0.16 },
      { words: [106, 107], v: -0.245, em: 0.2 },
    ];
    const fam = F.archivo(112.5, 900);
    const txt = (k: number) => (k === 103 ? 'Every' : k === 104 ? 'word' : k === 105 ? 'becomes' : k === 106 ? 'a' : 'light');
    lines.forEach((ln, li) => {
      const s = ln.words.map(txt).join(' ');
      const lay = layout(s, fam, 100);
      const sc = ln.em / 100;
      let ci = 0;
      ln.words.forEach((k) => {
        const w = txt(k);
        const x0 = lay.glyphs[ci]!.x;
        const pts = textPoints(w, fam, 100, 2.7, 11 + k);
        const ww = measure(w, fam, 100);
        const u0 = (x0 - lay.width / 2) * sc, u1 = (x0 + ww - lay.width / 2) * sc;
        const ws = wStart(k), we = wEnd(k);
        const vMid = ln.v + 0.27 * ln.em;
        this.words.push({ k, txt: w, u0, u1, vMid, vBase: ln.v, em: ln.em, ws, we, ctr: this.tp((u0 + u1) / 2, vMid), dotT: [] });
        // the tittle of the i in "light" becomes the city we descend into
        let keep = pts;
        if (k === 107) {
          const ix0 = measure('l', fam, 100), ix1 = measure('li', fam, 100);
          const ip = pts.filter((p) => p.x >= ix0 - 1 && p.x <= ix1 + 1).sort((a, b) => a.y - b.y);
          let gi = 0, gap = 0;
          for (let j = 1; j < ip.length; j++) if (ip[j]!.y - ip[j - 1]!.y > gap) { gap = ip[j]!.y - ip[j - 1]!.y; gi = j; }
          const tit = ip.slice(0, gi);
          const cx = tit.reduce((a, p) => a + p.x, 0) / Math.max(1, tit.length), cy = tit.reduce((a, p) => a + p.y, 0) / Math.max(1, tit.length);
          keep = pts.filter((p) => !tit.includes(p));
          this.tittle = this.tp((x0 + cx - lay.width / 2) * sc, ln.v - cy * sc);
        }
        for (const p of keep) {
          const u = (x0 + p.x - lay.width / 2) * sc, v = ln.v - p.y * sc;
          const f = clamp((p.x) / ww);
          const t0 = ws + f * (we - ws) * 0.94;
          this.dots.push({ q: this.tp(u, v), t0, word: k, big: li });
          this.words[this.words.length - 1]!.dotT.push(t0);
        }
        this.words[this.words.length - 1]!.dotT.sort((a, b) => a - b);
        ci += w.length + 1;
      });
    });
    // the satellite's position in the earth frame at the swing (where the de-orbit starts)
    this.satE = G.mtv(this.M(this.tSwing), this.satW(this.tSwing));
  }
  /** the pen in M2 (earth frame): de-orbit, the words, the hops, the tittle */
  penE(t: number): V3 {
    const ws = this.words;
    const surf = (w: WordL, u: number) => this.tp(u, w.vMid);
    if (t < this.tEvery) {
      const e = ease.inQuad(prog(t, this.tSwing, this.tEvery));
      const a = G.norm(this.satE), b = surf(ws[0]!, ws[0]!.u0);
      const r = lerp(G.len(this.satE), 1.0, e) + 0.12 * Math.sin(Math.PI * e);
      return G.mul(G.slerp(a, b, ease.inOutQuad(e)), r);
    }
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]!;
      if (t < w.ws) { // hop from the previous word
        const p = ws[i - 1]!;
        const e = prog(t, p.we, w.ws, ease.inOutQuad);
        const a = surf(p, p.u1), b = surf(w, w.u0);
        return G.mul(G.slerp(a, b, e), 1 + (0.02 + 0.08 * G.angle(a, b)) * Math.sin(Math.PI * e));
      }
      if (t <= w.we) return surf(w, lerp(w.u0, w.u1, prog(t, w.ws, w.ws + (w.we - w.ws) * 0.94)));
    }
    const last = ws[ws.length - 1]!;
    const a = surf(last, last.u1);
    const e = prog(t, last.we, this.tDot, ease.inOutCubic);
    return G.mul(G.slerp(a, this.tittle, e), 1 + 0.07 * Math.sin(Math.PI * e));
  }

  // ---------------------------------------------------------------- camera
  cam1(t: number) {
    // nods: a 3.5% zoom step on every sung word (outExpo, 0.2 s); a slow crane and pull-back creep
    let f = F0;
    for (let k = W1; k <= 102; k++) f *= Math.pow(1.03, ease.outExpo(clamp((t - wStart(k)) / 0.2)));
    f *= 1 + 0.06 * pulse(t, this.tSpin, 0.12) * (t > this.tSpin ? 1 : 0);
    const yaw = 0.12 * prog(t, T0, this.tSwing, ease.inOutQuad);
    const pitch = 0.14 * prog(t, T0 + 0.25, this.tSpin, ease.inOutCubic);
    const D = D0 * (1 + 0.24 * prog(t, T0 + 0.1, this.tSwing, ease.inOutQuad));
    const tgt: V3 = [0.02 * prog(t, this.tSay, this.tSwing), -0.13 * prog(t, T0 + 0.15, this.tSay + 0.6, ease.inOutCubic), 0];
    const pos = G.add(tgt, G.mul([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)], D));
    const roll = t > this.tSpin ? 0.05 * Math.sin((t - this.tSpin) * 9) * Math.exp(-(t - this.tSpin) * 3.5) : 0;
    return { pos, tgt, up: [0, 1, 0] as V3, f, roll };
  }
  /** M2 pose in the earth frame (before the dive): framed on the whole block, tilting to the line being sung */
  cam2E(t: number) {
    let f = 1100;
    const ws = this.words;
    const lineOf = [0, 0, 1, 2, 2];
    let v = ws[0]!.vMid, u = 0.5 * (ws[0]!.u0 + ws[1]!.u1) / 2;
    ws.forEach((w, i) => {
      const k = ease.outExpo(clamp((t - w.ws + 0.04) / 0.3));
      f *= Math.pow(1.022, ease.outExpo(clamp((t - w.ws) / 0.22)));
      if (i > 0 && lineOf[i] !== lineOf[i - 1]) v = lerp(v, w.vMid, k);
      u = lerp(u, 0.5 * (w.u0 + w.u1) / 2, 0.6 * k);
    });
    // the block's centre, leaning 30% toward the line being sung
    const vc = -0.03, uc = 0.04;
    let look = this.tp(lerp(uc, u, 0.3), lerp(vc, v, 0.3));
    // the camera leans onto "light", then onto its tittle
    look = G.norm(G.mix3(look, this.tittle, ease.inOutCubic(prog(t, this.tLight - 0.1, this.tDot))));
    const creep = prog(t, this.tEvery, this.tDot);
    const base = this.tp(0.02, -0.17 + 0.03 * creep);
    const pos = G.mul(base, 1.76 - 0.05 * creep);
    return { pos, look, f };
  }
  camera(t: number): Cam {
    const c1 = this.cam1(Math.min(t, this.tSwing + 0.8));
    if (t < this.tSwing - 0.9) return G.lookCam(c1.pos, c1.tgt, c1.up, c1.f, c1.roll);
    const M = this.M(t);
    let e2 = this.cam2E(t);
    let up2 = this.vE;
    if (t > this.tDot) {
      const d0 = this.cam2E(this.tDot);
      const h0 = G.len(d0.pos) - 1, h1 = 0.004;
      const T = this.tittle;
      const off0 = G.sub(d0.pos, G.mul(T, 1 + h0));
      const u = prog(t, this.tDot, this.tLand);
      const h = h0 * Math.pow(h1 / h0, ease.inOutCubic(u));
      const r = h / h0;
      e2 = { pos: G.add(G.mul(T, 1 + h), G.mul(off0, r * r)), look: T, f: d0.f };
      up2 = this.vE;
    }
    const pos2 = G.mv(M, e2.pos), look2 = G.mv(M, e2.look), upW2 = G.mv(M, up2);
    // hold, then snap on the downbeat: a linear creep, then outExpo round to the night side
    const k = 0.03 * prog(t, this.tSwing - 0.9, this.tSwing) + 0.97 * ease.outExpo(prog(t, this.tSwing, this.tSwing + 0.62));
    if (k <= 0) return G.lookCam(c1.pos, c1.tgt, c1.up, c1.f, c1.roll);
    const d1 = G.len(c1.pos), d2 = G.len(pos2);
    const dir = G.slerp(G.norm(c1.pos), G.norm(pos2), k);
    const pos = G.mul(dir, Math.exp(lerp(Math.log(d1), Math.log(d2), k)));
    const look = G.mix3(c1.tgt, look2, ease.inOutCubic(k));
    const up = G.norm(G.mix3(c1.up, upW2, k));
    const f = Math.exp(lerp(Math.log(c1.f), Math.log(e2.f), k));
    return G.lookCam(pos, look, up, f, c1.roll * (1 - k));
  }

  // ---------------------------------------------------------------- render
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t;
    const cam = this.camera(t);
    const M = this.M(t);
    const u = this.pass.u;
    (u.camPos!.value as THREE.Vector3).set(...cam.pos);
    (u.camR!.value as THREE.Vector3).set(...cam.R);
    (u.camU!.value as THREE.Vector3).set(...cam.U);
    (u.camF!.value as THREE.Vector3).set(...cam.F);
    u.focal!.value = cam.f;
    // three.js Matrix3.set takes row-major
    (u.uM!.value as THREE.Matrix3).set(M[0]!, M[1]!, M[2]!, M[3]!, M[4]!, M[5]!, M[6]!, M[7]!, M[8]!);
    u.uTime!.value = t;
    u.uGratHead!.value = prog(t, T0 + 0.02, T0 + 0.34, ease.inOutQuad);
    u.uGratA!.value = prog(t, T0 + 0.01, T0 + 0.05) * (1 - 0.55 * prog(t, this.tSwing, this.tEvery));
    u.uRev!.value = t <= T0 + 0.06 ? -0.1 : 1.75 * ease.outCubic(prog(t, T0 + 0.06, T0 + 0.5));
    const dive = prog(t, this.tDot, this.tLand);
    u.uSurf!.value = 1 - smoothstep(0.05, 0.45, dive);
    u.uStars!.value = prog(t, T0 + 0.1, T0 + 0.5) * (1 - smoothstep(0.1, 0.5, dive));
    u.uLimbA!.value = 1 - smoothstep(0.1, 0.5, dive);
    u.uLimbW!.value = lerp(2.8, 1.6, prog(t, T0 + 0.3, this.tSay + 0.6));
    u.uRos!.value = 0.9 * prog(t, this.tSay - 0.05, this.tSay + 0.5) * (1 - prog(t, this.tSwing, this.tSwing + 0.3));
    u.uRosPh!.value = 0.35 * (t - T0) + 0.6 * pulse(t, this.tSpin, 0.2);
    u.uDawn!.value = prog(t, this.tSwing + 0.1, this.tEvery) * (1 - smoothstep(0.1, 0.4, dive));
    u.uLights!.value = prog(t, T0 + 0.3, this.tSay + 0.4) * (1 - smoothstep(0.7, 0.97, dive));
    u.uLitBase!.value = lerp(0.22, 0.4, prog(t, this.tSwing, this.tEvery));
    const wv = u.uWave!.value as THREE.Vector4[];
    this.words.forEach((w, i) => wv[i]!.set(w.ctr[0], w.ctr[1], w.ctr[2], w.ws + 0.12));
    (u.uHole!.value as THREE.Vector4).set(this.tittle[0], this.tittle[1], this.tittle[2], t > this.tEvery ? 0.006 : 0);
    this.pass.render(renderer, out);

    const lb = this.glow; lb.clear();
    const tp = this.top; tp.clear();
    const Lc = this.L; Lc.clear(); const c = Lc.ctx;
    const m1 = t < this.tSwing + 0.5;
    const m2 = t > this.tSwing;
    this.drawNetwork(t, cam, M, lb, dive);
    if (m2) this.drawLights(t, cam, M, lb, dive);
    lb.render(renderer, out);
    if (m1) this.drawRibbon(t, cam, c);
    this.drawLabels(t, cam, M, c, dive);
    this.drawHud(t, c, dive);
    comp.draw(renderer, Lc.upload(), out);
    this.drawSpark(t, cam, M, tp, f);
    tp.render(renderer, out);

    const sp = t > this.tSpin ? pulse(t, this.tSpin, 0.1) : 0;
    const sw = t > this.tSwing ? pulse(t, this.tSwing, 0.12) : 0;
    const shA = (9 * sp + 6 * sw + (t > T0 + 0.05 ? 1.5 * audio.hit('snare', t, 0.08) : 0)) * (1 - dive);
    return {
      bloom: m2 ? 0.8 : 0.65, halation: m2 ? 0.3 : 0.22, vignette: 0.42,
      ca: 1.2 + 2.5 * sp + 2 * sw,
      shake: [shA * noise1(t * 43, 1), shA * noise1(t * 47, 2)],
      zoom: 1 + 0.012 * (t > T0 + 0.05 ? f.a.kick : 0) * (1 - dive),
    };
  }

  // ---------------------------------------------------------------- drawing: the release network (M1)
  drawNetwork(t: number, cam: Cam, M: G.M3, lb: LineBatch, dive: number) {
    if (t < this.tSay - 0.05) return;
    const fadeAll = (1 - smoothstep(0.1, 0.6, dive)) * (1 - 0.85 * prog(t, this.tEvery, this.tEvery + 0.6));
    if (fadeAll <= 0) return;
    const toW = (q: V3) => G.mv(M, q);
    const vis = (p: V3) => G.dot(p, G.sub(cam.pos, p)) > 0;
    const base: RGB = sc3(LIN.ash, 0.24 * (1 - prog(t, this.tSwing, this.tEvery + 0.3)));
    // arcs
    for (const a of this.arcs) {
      if (t < a.t0) continue;
      if (a.a < 0) {
        // the satellite's drop: a beam from SAT-1 to the city, hot for a moment
        const age = t - a.t0;
        if (age > 0.5) continue;
        const s = this.satW(t), e = toW(this.cities[a.b]!.q);
        if (!vis(e)) continue;
        const ps = G.project(cam, s), pe = G.project(cam, e);
        if (!ps || !pe || G.occluded(cam, s)) continue;
        const I = Math.exp(-age / 0.12);
        const k = clamp(age / 0.1);
        lb.seg2(ps.x, ps.y, lerp(ps.x, pe.x, k), lerp(ps.y, pe.y, k), 1.4 + 2 * I, sc3(heatLin(age * 0.5, base), I * fadeAll), 1);
        continue;
      }
      const qa = this.cities[a.a]!.q, qb = this.cities[a.b]!.q;
      const n = 26;
      const sHead = clamp((t - a.t0) / a.dur);
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i <= n; i++) {
        const s = (i / n) * sHead;
        const pq = G.mul(G.slerp(qa, qb, s), 1 + a.h * Math.sin(Math.PI * s));
        const pw = toW(pq);
        const pp = G.project(cam, pw);
        if (!pp || G.occluded(cam, pw)) { prev = null; continue; }
        if (prev) {
          const age = t - (a.t0 + s * a.dur);
          const col = heatLin(age, base);
          const wd = 1.0 + 1.6 * Math.exp(-age / 0.1);
          lb.seg2(prev.x, prev.y, pp.x, pp.y, wd, sc3(col, fadeAll), 1);
        }
        prev = pp;
      }
    }
    // cities: pending (dim bone ring), lit (a signal dot and a ping)
    const hatP = this.ctx.audio.hit('hat', t, 0.07);
    for (let i = 0; i < this.cities.length; i++) {
      const pw = toW(this.cities[i]!.q);
      const toC = G.norm(G.sub(cam.pos, pw));
      const fc = G.dot(pw, toC);
      if (fc < 0.05) continue;
      const pp = G.project(cam, pw);
      if (!pp || pp.x < -20 || pp.x > W + 20 || pp.y < -20 || pp.y > H + 20) continue;
      const tl = this.litAt[i]!;
      const edge = smoothstep(0.05, 0.3, fc);
      const pend = prog(t, this.tSay, this.tSay + 0.6) * (t > this.tSwing ? 0.5 : 1);
      if (t < tl) {
        if (pend > 0) lb.seg2(pp.x, pp.y, pp.x + 0.01, pp.y, 2.2, sc3(LIN.bone, 0.3 * pend * edge * fadeAll), 1);
        continue;
      }
      const age = t - tl;
      const hot = Math.exp(-age / 0.15);
      const col = mixc(sc3(LIN.signal, 1.25), [5, 3.5, 2.2], hot);
      lb.seg2(pp.x, pp.y, pp.x + 0.01, pp.y, 3.2 + 2.5 * hot + 0.6 * hatP, sc3(col, edge * fadeAll), 1);
      if (age < 0.6) {
        // ping: a ring opening round the city (a screening started)
        const R = 4 + 26 * ease.outCubic(age / 0.6), A = (1 - age / 0.6) * 0.9;
        const nn = 18;
        for (let j = 0; j < nn; j++) {
          const a0 = (j / nn) * TAU, a1 = ((j + 0.6) / nn) * TAU;
          lb.seg2(pp.x + Math.cos(a0) * R, pp.y + Math.sin(a0) * R * edge, pp.x + Math.cos(a1) * R, pp.y + Math.sin(a1) * R * edge, 1.1, sc3(LIN.signal, 1.2 * A * fadeAll), 1);
        }
      }
    }
  }

  // ---------------------------------------------------------------- drawing: the ribbon (M1)
  drawRibbon(t: number, cam: Cam, c: CanvasRenderingContext2D) {
    const out = 1 - prog(t, this.tSwing - 0.05, this.tSwing + 0.35, ease.inQuad);
    if (out <= 0) return;
    const lay = this.ribbonLayout(t);
    const sH = this.headS(t, lay);
    const thH = this.headTh(t, sH);
    const th0 = (s: number) => thH - (sH - s) / RO;
    const sil = G.silhouette(cam);
    const clipOutside = () => {
      if (!sil) return;
      c.beginPath();
      c.rect(-10, -10, W + 20, H + 20);
      c.moveTo(sil[0]!.x, sil[0]!.y);
      for (const p of sil) c.lineTo(p.x, p.y);
      c.closePath();
      c.clip('evenodd');
    };
    const Y0 = -0.05, Y1 = SZ * 0.86;
    const P = (th: number, y: number) => G.add(orbitP(th), G.mul(ON, y));
    const facing = (th: number) => { const p = orbitP(th); return G.dot(G.norm(p), G.sub(cam.pos, p)); };
    c.save();
    c.globalAlpha = out;
    // the predicted track ahead of the satellite (dashed) and the orbit ticks
    {
      const n = 60;
      c.setLineDash([3, 6]);
      c.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const a0 = thH + 0.04 + (i / n) * 1.6, a1 = a0 + 1.6 / n;
        const p0 = P(a0, SZ * 0.36), p1 = P(a1, SZ * 0.36);
        const behind = G.occluded(cam, p0) || facing(a0) < 0;
        const q0 = G.project(cam, p0), q1 = G.project(cam, p1);
        if (!q0 || !q1) continue;
        c.save();
        if (behind) clipOutside();
        c.strokeStyle = rgba('ash', (behind ? 0.22 : 0.5) * (1 - i / n) * prog(t, T0 + 0.05, T0 + 0.3));
        c.beginPath(); c.moveTo(q0.x, q0.y); c.lineTo(q1.x, q1.y); c.stroke();
        c.restore();
      }
      c.setLineDash([]);
    }
    if (t < this.tSay - 0.02) { c.restore(); return; }
    // the ribbon: an engraved band laid behind the satellite
    const thT = th0(0) - 0.05, thE = thH + 0.03;
    const steps = Math.max(2, Math.ceil((thE - thT) / 0.025));
    for (let i = 0; i < steps; i++) {
      const a0 = thT + ((thE - thT) * i) / steps, a1 = thT + ((thE - thT) * (i + 1)) / steps;
      const am = (a0 + a1) / 2;
      const fc = facing(am);
      const beh = G.occluded(cam, P(am, SZ * 0.4));
      const q = [P(a0, Y0), P(a1, Y0), P(a1, Y1), P(a0, Y1)].map((p) => G.project(cam, p));
      if (q.some((x) => !x)) continue;
      const [q0, q1, q2, q3] = q as G.Proj[];
      c.save();
      if (beh || fc < 0) clipOutside();
      const tail = 1;
      if (fc > 0) {
        c.fillStyle = rgba('ink', 0.84 * tail);
        c.beginPath(); c.moveTo(q0!.x, q0!.y); c.lineTo(q1!.x, q1!.y); c.lineTo(q2!.x, q2!.y); c.lineTo(q3!.x, q3!.y); c.closePath(); c.fill();
      }
      const ra = (fc > 0 ? 0.6 : 0.2) * tail;
      c.strokeStyle = rgba('bone', ra); c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(q0!.x, q0!.y); c.lineTo(q1!.x, q1!.y); c.moveTo(q3!.x, q3!.y); c.lineTo(q2!.x, q2!.y); c.stroke();
      // inner rules (banknote double rule)
      const r0 = G.project(cam, P(a0, Y0 + 0.018)), r1 = G.project(cam, P(a1, Y0 + 0.018));
      const s0 = G.project(cam, P(a0, Y1 - 0.018)), s1 = G.project(cam, P(a1, Y1 - 0.018));
      if (r0 && r1 && s0 && s1) {
        c.strokeStyle = rgba('ash', 0.45 * ra); c.lineWidth = 0.7;
        c.beginPath(); c.moveTo(r0.x, r0.y); c.lineTo(r1.x, r1.y); c.moveTo(s0.x, s0.y); c.lineTo(s1.x, s1.y); c.stroke();
      }
      c.restore();
    }
    // orbit ticks: fixed in the orbit (5°), under the moving ribbon, degree labels every 30°
    {
      const a0 = Math.ceil(thT / (Math.PI / 36)), a1 = Math.floor(thE / (Math.PI / 36));
      for (let k = a0; k <= a1; k++) {
        const th = (k * Math.PI) / 36;
        if (facing(th) < 0.05) continue;
        const big = k % 6 === 0;
        const pa = G.project(cam, P(th, Y0)), pb = G.project(cam, P(th, Y0 - (big ? 0.05 : 0.025)));
        if (!pa || !pb || G.occluded(cam, P(th, Y0))) continue;
        c.strokeStyle = rgba('ash', big ? 0.75 : 0.45); c.lineWidth = big ? 1.1 : 0.8;
        c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
        if (big) {
          c.font = font(F.mono(500), 11); c.fillStyle = rgba('ash', 0.75); c.textAlign = 'center'; c.textBaseline = 'top';
          const deg = ((((k * 5) % 360) + 360) % 360);
          c.fillText(`${String(deg).padStart(3, '0')}°`, pb.x, pb.y + 3);
        }
      }
    }
    // the lettering: each glyph an affine patch of the ribbon (advance = projected chord)
    c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    this.rg.forEach((g, i) => {
      if (g.ch === ' ') return;
      const L = lay.g[i]!;
      if (t < g.tg - 0.38) return;
      const ta = th0(L.s), tb = ta + L.w / RO;
      const fc = facing((ta + tb) / 2);
      if (fc < 0.02) return;
      const A = P(ta, 0), B = P(tb, 0), Tp = G.sub(A, G.mul(ON, -SZ));
      const qa = G.project(cam, A), qb = G.project(cam, B), qt = G.project(cam, Tp);
      if (!qa || !qb || !qt || qb.x <= qa.x) return;
      const gw = g.ch === ' ' ? 30 : this.adv(g.ch, L.fam) * L.sf;
      const ex = [(qb.x - qa.x) / gw, (qb.y - qa.y) / gw];
      const ey = [(qa.x - qt.x) / 100, (qa.y - qt.y) / 100];
      const beh = G.occluded(cam, P((ta + tb) / 2, SZ * 0.35));
      c.save();
      if (beh) clipOutside();
      c.setTransform(ex[0]!, ex[1]!, ey[0]!, ey[1]!, qa.x, qa.y);
      if (L.sf !== 1) c.transform(L.sf, 0, 0, 1, 0, 0);
      c.font = font(L.fam, 100);
      const fa = smoothstep(0.02, 0.2, fc);
      c.fillStyle = t < g.tg ? rgba('bone', 0.26 * prog(t, g.tg - 0.38, g.tg - 0.1) * fa) : hotCss(t - g.tg, fa);
      c.fillText(g.ch, 0, 0);
      c.restore();
    });
    c.restore();
  }

  // ---------------------------------------------------------------- drawing: the lyric in lights (M2)
  drawLights(t: number, cam: Cam, M: G.M3, lb: LineBatch, dive: number) {
    const fade = 1 - smoothstep(0.6, 0.95, dive);
    for (const d of this.dots) {
      if (t < d.t0 - 0.4) continue;
      const pw = G.mv(M, d.q);
      if (G.dot(pw, G.sub(cam.pos, pw)) <= 0) continue;
      const pp = G.project(cam, pw);
      if (!pp || pp.x < -10 || pp.x > W + 10 || pp.y < -10 || pp.y > H + 10) continue;
      const sz = clamp(pp.s * 0.0031, 1.1, 3.6);
      if (t < d.t0) {
        // unlit sockets: faint pin-pricks, just before the word
        const a = 0.3 * prog(t, d.t0 - 0.4, d.t0 - 0.05);
        lb.seg2(pp.x, pp.y, pp.x + 0.01, pp.y, sz * 0.8, sc3(LIN.graphite, a * fade), 1);
        continue;
      }
      const age = t - d.t0;
      const hot = Math.exp(-age / 0.06), warm = Math.exp(-age / 0.3);
      const bright = d.word === 107;
      // cools to a sodium bone below the bloom knee; "light" holds hot ember
      const cool: RGB = bright ? mixc(sc3(LIN.ember, 1.7), [2.2, 1.7, 1.2], 0.25 + 0.2 * this.ctx.audio.hit('kick', t, 0.1)) : mixc(sc3(LIN.bone, 0.62), sc3(LIN.ember, 0.62), 0.35);
      let col = mixc(cool, sc3(LIN.signal, 1.8), warm);
      col = mixc(col, [3.2, 2.4, 1.6], hot);
      lb.seg2(pp.x, pp.y, pp.x + 0.01, pp.y, sz * (1 + 0.45 * hot) * (bright ? 1.15 : 1), sc3(col, fade), 1);
    }
  }

  // ---------------------------------------------------------------- drawing: the spark / the city
  drawSpark(t: number, cam: Cam, M: G.M3, tp: LineBatch, f: Frame) {
    const kick = f.a.kick;
    if (t < this.tSwing) {
      const s = this.satW(t);
      const p = G.project(cam, s);
      const hidden = G.occluded(cam, s);
      const rise = prog(t, T0 + 0.02, T0 + 0.2);
      if (p && !hidden && rise > 0) {
        sparkParticles(tp, t, (tb) => {
          if (tb < T0 + 0.05) return null;
          const q = this.satW(tb);
          if (G.occluded(cam, q)) return null;
          const pp = G.project(cam, q);
          return pp ? { x: pp.x, y: pp.y } : null;
        }, { rate: 90, speed: 180, life: 0.35, intensity: 0.8, seed: 16 });
        sparkHead(tp, p.x, p.y, t, 0.9 + 0.35 * kick + 0.5 * (t > this.tSay ? pulse(t, this.tSpin, 0.15) : 0), rise);
      }
      return;
    }
    // M2: the pen and its trail (heat by age)
    const land = t >= this.tDot;
    const n = 70;
    let prev: G.Proj | null = null;
    for (let i = n; i >= 0; i--) {
      const age = (i / n) * 0.5;
      const tb = t - age;
      if (tb < this.tSwing) { prev = null; continue; }
      const q = this.penE(Math.min(tb, this.tDot));
      const pw = G.mv(M, q);
      if (G.occluded(cam, pw, 5e-3)) { prev = null; continue; }
      const pp = G.project(cam, pw);
      if (!pp) { prev = null; continue; }
      if (prev) {
        const col = heatLin(age, [0, 0, 0]);
        tp.seg2(prev.x, prev.y, pp.x, pp.y, 1.2 + 2.2 * Math.exp(-age / 0.08), sc3(col, 1 - prog(t, this.tDot, this.tDot + 0.16)), 1);
      }
      prev = pp;
    }
    const hq = this.penE(Math.min(t, this.tDot));
    const hw = G.mv(M, hq);
    const hp = G.project(cam, hw);
    if (!hp || G.occluded(cam, hw, 5e-3)) return;
    if (!land) {
      sparkParticles(tp, t, (tb) => {
        if (tb < this.tSwing) return null;
        const w = G.mv(M, this.penE(tb));
        if (G.occluded(cam, w, 5e-3)) return null;
        const pp = G.project(cam, w);
        return pp ? { x: pp.x, y: pp.y } : null;
      }, { rate: 140, speed: 200, life: 0.3, intensity: 0.9, seed: 21 });
      sparkHead(tp, hp.x, hp.y, t, 1.0 + 0.4 * kick, 1.2);
    } else {
      // the tittle: one hot point of city light (H17 — it sits at frame centre when the dive lands)
      const e = t - this.tDot;
      // (the camera looks at the tittle, so this is already POINT_H17; pinned exactly as the dive lands)
      const pin = prog(t, this.tLand - 0.05, this.tLand);
      const x = lerp(hp.x, POINT_H17.x, pin), y = lerp(hp.y, POINT_H17.y, pin);
      // the descent converges: engraved rays drawn in from the frame edge, a ring riding them in on the
      // beat, landing on the city on the cut; all of it gone before the last frame
      const au = this.ctx.audio;
      const tNext = au.timeOfBeat(Math.floor(au.beatAt(this.tDot + 0.02)) + 1);
      const drawR = ease.outCubic(prog(t, this.tDot, this.tDot + 0.2));
      const rayA = drawR * (1 - prog(t, tNext - 0.2, tNext - 0.07));
      if (rayA > 0) {
        const NR = 144, Rmax = 1150;
        const wph = ease.inQuad(prog(t, this.tDot, tNext - 0.06));
        const wr = Rmax * (1 - wph);
        for (let i = 0; i < NR; i++) {
          const long = i % 2 === 0;
          const a = (i / NR) * TAU + 0.35 * e + (hash(i, 3) - 0.5) * 0.01;
          const rOut = long ? Rmax : Rmax * (0.5 + 0.3 * hash(i, 7));
          const rIn = (i % 6 === 0 ? 28 : long ? 80 + 60 * hash(i, 9) : 60 + 110 * hash(i, 5));
          const rEnd = lerp(rOut, rIn, clamp(drawR * 1.25 - hash(i, 7) * 0.25));
          const I = (long ? 0.34 : 0.22) * rayA;
          const ca = Math.cos(a), sa = Math.sin(a);
          tp.seg2(x + ca * rOut, y + sa * rOut, x + ca * rEnd, y + sa * rEnd, long ? 1.0 : 0.7, sc3(LIN.bone, I), 1);
          if (wr > rEnd && wr < rOut) {
            const near = 1 - wr / Rmax;
            const hi = Math.min(rOut, wr + 16 + 60 * (1 - near));
            const I2 = (long ? 1.1 : 0.7) * rayA * (0.4 + 0.9 * near);
            tp.seg2(x + ca * hi, y + sa * hi, x + ca * wr, y + sa * wr, long ? 1.6 : 1.1, sc3(mixc(LIN.bone, sc3(LIN.ember, 1.6), near), I2), 1);
          }
        }
      }
      const I = 1 + 1.4 * pulse(t, this.tDot, 0.08) + 0.15 * Math.sin(e * 11);
      tp.seg2(x, y, x + 0.01, y, 30, sc3(LIN.signal, 0.45 * I), 0.35);
      tp.seg2(x, y, x + 0.01, y, 13, sc3(LIN.ember, 2.2 * I), 0.8);
      tp.seg2(x, y, x + 0.01, y, 5.5, [6 * I, 5 * I, 4 * I], 1);
    }
  }

  // ---------------------------------------------------------------- drawing: labels on the world
  drawLabels(t: number, cam: Cam, M: G.M3, c: CanvasRenderingContext2D, dive: number) {
    const A = prog(t, T0 + 0.25, T0 + 0.6) * (1 - smoothstep(0.05, 0.3, dive));
    if (A <= 0) return;
    const toW = (q: V3) => G.mv(M, q);
    const facingK = (pw: V3) => G.dot(pw, G.norm(G.sub(cam.pos, pw)));
    c.save();
    c.textBaseline = 'middle';
    // graticule labels, set along their lines
    const sub = G.mtv(M, G.norm(cam.pos));
    const lonC = G.v2lon(sub);
    const along = (q: V3, dirE: V3, txt: string, size: number, col: string) => {
      const pw = toW(q), fk = facingK(pw);
      if (fk < 0.3) return;
      const p = G.project(cam, pw), p2 = G.project(cam, toW(G.norm(G.add(q, G.mul(dirE, 0.02)))));
      if (!p || !p2 || p.x < 40 || p.x > W - 40 || p.y < 40 || p.y > H - 40) return;
      let ang = Math.atan2(p2.y - p.y, p2.x - p.x);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      c.save();
      c.translate(p.x, p.y); c.rotate(ang);
      c.font = font(F.mono(500), size);
      c.fillStyle = col.replace('A)', `${A * smoothstep(0.3, 0.55, fk)})`);
      c.textAlign = 'left';
      c.fillText(txt, 4, -7);
      c.restore();
    };
    const d15 = Math.PI / 12;
    const lonL = Math.round((lonC - 0.55) / d15) * d15 + d15 / 2;
    for (let k = -4; k <= 4; k++) {
      if (k === 0 || Math.abs(k) % 2) continue;
      const lat = k * d15;
      const q = G.ll2v(lat, lonL);
      along(q, G.enu(q).e, G.fmtLat(lat), 11, 'rgba(156,151,143,A)');
    }
    for (let k = -12; k < 12; k += 2) {
      const lon = k * d15;
      const q = G.ll2v(0.012, lon);
      along(q, G.enu(q).e, G.fmtLon(lon), 11, 'rgba(156,151,143,A)');
    }
    along(G.ll2v(0.012, lonL + d15), G.enu(G.ll2v(0, lonL)).e, 'EQUATOR', 10, 'rgba(94,91,87,A)');
    // cinema cities: named when they light (a leader, a name, coordinates)
    if (t < this.tSwing + 0.3) {
      const la = 1 - prog(t, this.tSwing - 0.1, this.tSwing + 0.25);
      for (const i of this.labelled) {
        const ci = this.cities[i]!;
        const tl = this.litAt[i]!;
        if (t < tl + 0.05) continue;
        const pw = toW(ci.q), fk = facingK(pw);
        if (fk < 0.2) continue;
        const p = G.project(cam, pw);
        if (!p) continue;
        const a = A * la * prog(t, tl + 0.05, tl + 0.2) * smoothstep(0.2, 0.45, fk);
        const e = ease.outCubic(prog(t, tl + 0.05, tl + 0.25));
        const lx = p.x + 30 * e, ly = p.y - 30 * e;
        c.strokeStyle = rgba('bone', 0.7 * a); c.lineWidth = 1;
        c.beginPath(); c.moveTo(p.x + 4, p.y - 4); c.lineTo(lx, ly); c.lineTo(lx + 10, ly); c.stroke();
        c.textAlign = 'left';
        const nm = ci.name, n = Math.ceil(nm.length * prog(t, tl + 0.08, tl + 0.35));
        c.font = font(F.mono(600), 13); c.fillStyle = hotCss(t - tl - 0.08, 0.95 * a);
        c.fillText(nm.slice(0, n), lx + 14, ly - 1);
        c.font = font(F.mono(400), 10); c.fillStyle = rgba('ash', 0.85 * a);
        c.fillText(`${G.fmtLat(ci.lat)} ${G.fmtLon(ci.lon)} · 1 SCREEN`, lx + 14, ly + 13);
      }
    }
    // M2: each word's survey caption, laid on the ground under it; the tittle is named before the dive
    if (t > this.tEvery - 0.05) {
      const fm = 1 - smoothstep(0.0, 0.25, dive);
      for (const w of this.words) {
        if (t < w.ws + 0.04) continue;
        let n = 0;
        while (n < w.dotT.length && w.dotT[n]! <= t) n++;
        const vb = w.vBase - w.em * 0.3;
        const pa = toW(this.tp(w.u0, vb)), pb = toW(this.tp(w.u1, vb));
        if (facingK(pa) < 0.05) continue;
        const qa = G.project(cam, pa), qb = G.project(cam, pb);
        if (!qa || !qb) continue;
        const a = fm * prog(t, w.ws + 0.04, w.ws + 0.2);
        const ang = Math.atan2(qb.y - qa.y, qb.x - qa.x);
        const fs = clamp(qa.s * 0.021, 8, 15);
        const cap = `${w.txt.toUpperCase()} · ${grp(n, 1)} LIGHTS${w.k === 107 ? ' · THE BRIGHT ONE' : ''}`;
        c.save();
        c.translate(qa.x, qa.y); c.rotate(ang);
        c.font = font(F.mono(500), fs); c.textAlign = 'left';
        c.fillStyle = rgba('ash', 0.85 * a);
        c.fillText(cap, 0, 0);
        c.strokeStyle = rgba('ash', 0.5 * a); c.lineWidth = 1;
        c.beginPath(); c.moveTo(0, -fs * 0.9); c.lineTo(Math.hypot(qb.x - qa.x, qb.y - qa.y), -fs * 0.9); c.stroke();
        c.restore();
      }
      // the tittle: the city we descend into
      const ta = prog(t, this.tLightEnd - 0.05, this.tLightEnd + 0.12) * (1 - prog(t, this.tDot + 0.05, this.tDot + 0.18));
      if (ta > 0) {
        const pw = toW(this.tittle), p = G.project(cam, pw);
        if (p && facingK(pw) > 0.1) {
          const lx = p.x + 60, ly = p.y - 70;
          c.strokeStyle = rgba('bone', 0.75 * ta); c.lineWidth = 1;
          c.beginPath(); c.moveTo(p.x + 8, p.y - 9); c.lineTo(lx, ly); c.lineTo(lx + 190, ly); c.stroke();
          c.textAlign = 'left';
          c.fillStyle = rgba('ink', 0.88 * ta);
          c.fillRect(lx, ly - 25, 196, 22); c.fillRect(lx, ly + 3, 236, 17);
          c.font = font(F.mono(600), 13); c.fillStyle = hotCss(t - this.tLightEnd, 0.95 * ta);
          c.fillText('PREMIERE · TONIGHT', lx + 4, ly - 9);
          c.font = font(F.mono(400), 10); c.fillStyle = rgba('ash', 0.85 * ta);
          const la = G.v2lat(this.tittle), lo = G.v2lon(this.tittle);
          c.fillText(`${G.fmtLat(la)} ${G.fmtLon(lo)} · THE DOT ON THE i`, lx + 4, ly + 14);
        }
      }
    }
    // SAT-1 tag riding the satellite
    if (t < this.tSwing + 0.2 && t > T0 + 0.15) {
      const s = this.satW(t);
      const p = G.project(cam, s);
      if (p && !G.occluded(cam, s)) {
        const a = A * (1 - prog(t, this.tSwing - 0.1, this.tSwing + 0.2));
        c.strokeStyle = rgba('ash', 0.7 * a); c.lineWidth = 1;
        const top = G.project(cam, G.add(s, G.mul(ON, SZ * 0.9)));
        const lx = top ? top.x + 14 : p.x + 14, ly = top ? top.y - 30 : p.y - 90;
        c.beginPath(); c.moveTo(p.x + 3, p.y - 10); c.lineTo(lx, ly); c.lineTo(lx + 150, ly); c.stroke();
        c.textAlign = 'left';
        c.font = font(F.mono(600), 12); c.fillStyle = rgba('bone', 0.9 * a);
        c.fillText('SAT-1 · THE CARET', lx + 4, ly - 10);
        c.font = font(F.mono(400), 10); c.fillStyle = rgba('ash', 0.85 * a);
        const th = ((this.headTh(t) * 180) / Math.PI) % 360;
        c.fillText(`ARG ${th.toFixed(1).padStart(5, '0')}° · 7.67 km/s`, lx + 4, ly + 13);
      }
    }
    c.restore();
  }

  // ---------------------------------------------------------------- drawing: the plate's furniture
  drawHud(t: number, c: CanvasRenderingContext2D, dive: number) {
    const A = 1 - smoothstep(0.0, 0.3, dive);
    if (A <= 0) return;
    const typed = (s: string, x: number, y: number, t0: number, size: number, w: number, col: string, align: CanvasTextAlign = 'left', cps = 70) => {
      const n = Math.floor(s.length * clamp((t - t0) * cps / s.length));
      if (n <= 0) return;
      c.font = font(F.mono(w), size); c.textAlign = align; c.fillStyle = col;
      c.fillText(align === 'right' ? s.slice(s.length - n) : s.slice(0, n), x, y);
    };
    c.save();
    c.textBaseline = 'alphabetic';
    const x0 = 96, y0 = 92;
    const s0 = T0 + 0.12;
    typed('FIG. 16 — WORLDWIDE RELEASE', x0, y0, s0, 16, 600, rgba('bone', 0.95 * A));
    typed('ENGRAVED GLOBE · GRATICULE 15° · SCALE 1 : 42 000 000', x0, y0 + 24, s0 + 0.15, 12, 400, rgba('ash', 0.9 * A));
    typed('ONE PRINT PER WORD · DROPPED FROM LOW ORBIT BY THE CARET', x0, y0 + 44, s0 + 0.35, 11, 400, rgba('ash', 0.55 * A));
    // orbit data, top right
    const xr = W - 96;
    typed('SAT-1 · ALT 400 km · 92 min', xr, y0, s0 + 0.2, 13, 500, rgba('bone', 0.85 * A), 'right');
    typed('INC 23° · ORBIT NOT TO SCALE', xr, y0 + 22, s0 + 0.4, 11, 400, rgba('ash', 0.8 * A), 'right');
    if (t > this.tSwing) typed('LOCAL TIME · TONIGHT (ALL ZONES)', xr, y0 + 42, this.tSwing + 0.2, 11, 500, rgba('signal', 0.9 * A), 'right');
    // legend, bottom left
    const ly = H - 150;
    const la = prog(t, this.tSay - 0.2, this.tSay + 0.1) * A;
    if (la > 0) {
      c.font = font(F.mono(500), 11);
      c.textAlign = 'left';
      const row = (i: number, sym: (x: number, y: number) => void, s: string, t0: number) => {
        const a = la * prog(t, t0, t0 + 0.15);
        if (a <= 0) return;
        c.globalAlpha = a;
        sym(x0 + 6, ly + i * 20 - 4);
        c.fillStyle = rgba('bone', 0.85);
        c.fillText(s, x0 + 26, ly + i * 20);
        c.globalAlpha = 1;
      };
      row(0, (x, y) => { c.fillStyle = rgba('signal', 1); c.beginPath(); c.arc(x, y, 4, 0, TAU); c.fill(); }, 'SCREENINGS', this.tSay);
      row(1, (x, y) => { c.strokeStyle = rgba('signal', 1); c.lineWidth = 1.5; c.beginPath(); c.arc(x, y + 6, 8, -2.6, -0.5); c.stroke(); }, 'DISTRIBUTION (PRINTS IN TRANSIT)', this.tSay + 0.1);
      row(2, (x, y) => { c.strokeStyle = rgba('bone', 0.7); c.lineWidth = 1; c.beginPath(); c.arc(x, y, 3.5, 0, TAU); c.stroke(); }, 'PENDING · AWAITING PRINT', this.tSay + 0.2);
      row(3, (x, y) => { c.strokeStyle = rgba('ash', 0.8); c.lineWidth = 1; c.beginPath(); c.moveTo(x - 7, y); c.lineTo(x + 7, y); c.moveTo(x, y - 7); c.lineTo(x, y + 7); c.stroke(); }, 'GRATICULE 15°', this.tSay + 0.3);
    }
    // the distribution log, left: every print delivered, newest first (hot), scrolling as the cascade runs
    const logA = A * prog(t, this.tSay + 0.05, this.tSay + 0.3) * (1 - prog(t, this.tSwing - 0.1, this.tSwing + 0.2));
    if (logA > 0) {
      const n = this.countLit(t);
      c.textAlign = 'left';
      c.font = font(F.mono(600), 11); c.fillStyle = rgba('bone', 0.85 * logA);
      c.fillText('DISTRIBUTION LOG · PRINTS DELIVERED', x0, 250);
      c.fillStyle = rgba('graphite', 0.9 * logA); c.fillRect(x0, 258, 330, 1);
      c.font = font(F.mono(400), 11);
      for (let j = 0; j < 16; j++) {
        const o = this.litOrder[n - 1 - j];
        if (!o) break;
        const ci = this.cities[o.i]!;
        const nm = (ci.name || `SCREEN ${String(o.i).padStart(3, '0')}`).padEnd(10, ' ');
        const row = `${String(n - j).padStart(4, '0')}  ${nm} ${G.fmtLat(ci.lat)} ${G.fmtLon(ci.lon)}  T+${(o.tl - this.tSay).toFixed(2)}`;
        const fadeRow = 1 - j / 16;
        c.fillStyle = j === 0 ? hotCss(t - o.tl, logA) : rgba(ci.name ? 'bone' : 'ash', 0.8 * logA * fadeRow);
        c.fillText(row, x0, 280 + j * 17);
      }
    }
    // the counters, bottom right
    const nCity = this.countLit(t);
    let nNight = 0;
    if (t > this.tSwing) {
      let dl = 0;
      for (const d of this.dots) if (t >= d.t0) dl++;
      let cover = 0;
      for (const w of this.words) { const r = Math.max(0, (t - w.ws - 0.12) * 0.9); cover = Math.max(cover, (1 - Math.cos(Math.min(Math.PI, r))) / 2); }
      nNight = dl + 4200 * (lerp(0.22, 0.4, prog(t, this.tSwing, this.tEvery)) * prog(t, this.tSwing, this.tSwing + 0.5) + 0.6 * cover);
    }
    const ca = prog(t, this.tSay - 0.1, this.tSay + 0.2) * A;
    if (ca > 0) {
      c.textAlign = 'right';
      c.font = font(F.mono(500), 11); c.fillStyle = rgba('ash', 0.9 * ca);
      c.fillText('SCREENINGS · CITIES LIT', xr, H - 176);
      c.font = font(F.mono(600), 38); c.fillStyle = rgba('bone', 0.96 * ca);
      c.fillText(grp(nCity + nNight, 5), xr, H - 132);
      const fr = frames(frameIdx(t) / 60);
      c.font = font(F.mono(500), 13); c.fillStyle = rgba('bone', 0.8 * ca);
      c.fillText(`FRAMES ${grp(fr, 6)}`, xr, H - 104);
      c.font = font(F.mono(400), 10); c.fillStyle = rgba('ash', 0.6 * ca);
      c.fillText('ONE PROMPT · ONE FILM · EVERY SCREEN', xr, H - 86);
    }
    c.restore();
  }
  countLit(t: number) {
    const a = this.litSorted;
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m]! <= t) lo = m + 1; else hi = m; }
    return lo;
  }
}
