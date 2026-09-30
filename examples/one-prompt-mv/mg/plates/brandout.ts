// Plate `brandout` (BRAND_T → FILM_END): the outro has drawn its one line back into the caret at the mark's centre (MARK_C). The caret wakes and stands up to the mark's height;
// then, as a clock hand through the mark's centre, it sweeps half a turn and leaves the AnimSpark mark
// (four quarter discs) behind it, filling with the brand gradient engraved along each blade's arc, a gust
// turning the blades once. The wordmark is set beside it, and the caret types the address under it.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../px/scene';
import { FSPass, Layer2D, clearRT } from '../px/gl';
import { LineBatch } from '../px/lines';
import { sparkHead } from '../px/motifs';
import { F, font } from '../px/type';
import { LIN, rgba } from '../px/palette';
import { clamp, ease, lerp } from '../px/util';
import { CARET_H1, MARK_C } from './handoff';
import { hotType, EDGE_POST } from './leader-kit';
import { GLSL_LOGO, LR } from './brand';

const seg = (t: number, a: number, b: number) => clamp((t - a) / Math.max(1e-6, b - a));
const MX = MARK_C.x, MY = MARK_C.y, MS = 1.45; // the mark: centre (px) and scale (px per logo unit)
const RPX = LR * MS * Math.SQRT2; // the hand's half length: reaches the blades' far corners
const WORD = 'AnimSpark', URL = 'animspark.com';
const WX = 668, WB = 598, WS = 150; // wordmark x, baseline, size
const UX = 676, UB = 668, US = 36, UADV = US * 0.6;

const FRAG = /* glsl */ `
${GLSL_LOGO}
uniform float uT, uFill, uSpin, uFade, uSweep, uHand; uniform vec2 uC; uniform float uS;
float eline(float u, float w) { float d = abs(u - floor(u + 0.5)); float aa = max(fwidth(u), 1e-4) * 0.75; return sat((w * 0.5 - d) / aa + 0.5); }
void main() {
  vec2 fp = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  vec2 q = logoRot((fp - uC) / uS + vec2(68.5, 67.5), uSpin);
  float d = sdLogo(q);
  vec3 col = C_INK * 0.0;
  // the sweep: only what the hand has passed is there (both ends of the hand paint, half a turn fills it)
  vec2 r = fp - uC;
  float a = mod(atan(r.x, -r.y) - uHand + 6.2831853, 3.14159265);   // angle behind the hand, 0..pi
  float swept = uSweep >= 3.14159 ? 1.0 : step(3.14159265 - uSweep, a);
  float fresh = exp(-(3.14159265 - a) / 0.35) * step(uSweep, 3.1415) ; // just painted
  if (d > 0.0) {
    float line = eline(d / 10.0 - uT * 0.9, 0.14);
    col += mix(brandGrad(q), C_BONE, sat(d / 70.0)) * line * 0.12 * exp(-d / 110.0) * uFill;
  }
  float aa = fwidth(d) * 0.9 + 1e-4;
  float cov = sat(0.5 - d / aa) * swept;
  float lit = 0.55 + 0.45 * sat(1.0 - dot(q, vec2(0.6, 0.8)) / 180.0);
  vec3 eng = brandGrad(q) * (0.3 + 0.95 * eline(logoArc(q) / 3.4, 0.35 + 0.55 * lit));
  vec3 solid = brandGrad(q) * (0.85 + 0.15 * lit);
  vec3 m = mix(eng, solid, uFill);
  float rim = sat(1.0 - abs(d) / (aa * 2.5));
  m += (C_SIGNAL * 1.5 + C_EMBER) * (rim * exp(-max(0.0, uT) * 3.0) + fresh * 1.2);
  col = mix(col, m, cov);
  fragColor = vec4(col * (1.0 - uFade), 1.0);
}`;

export default class BrandOut extends Scene {
  bg = new FSPass(FRAG, { uT: { value: 0 }, uFill: { value: 0 }, uSpin: { value: 0 }, uFade: { value: 0 }, uSweep: { value: 0 }, uHand: { value: 0 }, uC: { value: new THREE.Vector2(MX, MY) }, uS: { value: MS } });
  lb = new LineBatch(4000, { screen2D: true, blend: 'add' });
  text = new Layer2D();

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, start: S0, end: S1 } = this.ctx;
    const t = f.t;
    const tWake = S0 + 0.04, tGlide = tWake + 0.06, tSweep = tGlide + 0.55, tFill = tSweep + 0.1, tWord = tFill + 0.1, tUrl = tWord + 0.38;
    const fade = seg(t, S1 - 0.45, S1 - 0.03);
    // the caret: wake, glide to the mark's centre, stand up to the hand's length
    const wake = ease.outCubic(seg(t, S0, tWake));
    const g = ease.inOutCubic(seg(t, tWake, tGlide));
    const up = ease.outExpo(seg(t, tGlide - 0.08, tGlide + 0.1));
    const sw = ease.inOutCubic(seg(t, tGlide + 0.1, tSweep));
    const cx = MX, cy = MY; void g;
    const half = lerp(CARET_H1.h / 2, RPX, up);
    const handA = sw * Math.PI; // clockwise from 12 o'clock
    // the mark: a gust turns it a quarter once it is full, with a spring settle
    let spin = 0;
    if (t > tFill) spin = (Math.PI / 2) * (1 - Math.exp(-(t - tFill) * 6) * Math.cos((t - tFill) * 14));
    const u = this.bg.u;
    u.uT!.value = t - tFill; u.uFill!.value = ease.outCubic(seg(t, tFill, tFill + 0.35)); u.uSpin!.value = spin; u.uFade!.value = fade;
    u.uSweep!.value = t < tGlide + 0.1 ? 0 : sw >= 1 ? Math.PI + 0.01 : sw * Math.PI; u.uHand!.value = handA;
    clearRT(renderer, out, [0, 0, 0]);
    this.bg.render(renderer, out);
    const lb = this.lb; lb.clear();
    const handOn = 1 - seg(t, tSweep - 0.02, tSweep + 0.14);
    if (handOn > 0 && t >= S0) {
      const dx = Math.sin(handA) * half, dy = -Math.cos(handA) * half;
      const w = lerp(CARET_H1.w, 5, up);
      const col: [number, number, number] = [LIN.signal[0] * (1 + 1.5 * up), LIN.signal[1] * (1 + 1.5 * up), LIN.signal[2] * (1 + 1.5 * up)];
      lb.seg2(cx - dx, cy - dy, cx + dx, cy + dy, w, col, (0.85 + 0.15 * wake) * handOn);
      if (up > 0.5) { sparkHead(lb, cx + dx, cy + dy, t, 0.7, handOn); sparkHead(lb, cx - dx, cy - dy, t, 0.7, handOn); }
    }
    lb.render(renderer, out);
    // the wordmark and the address
    const L = this.text; L.clear();
    const c = L.ctx; c.textBaseline = 'alphabetic';
    const o = 1 - fade;
    if (t >= tWord) {
      const fam = F.archivo(lerp(70, 100, ease.outExpo(seg(t, tWord, tWord + 0.35))), 800);
      c.font = font(fam, WS);
      const n = Math.min(WORD.length, Math.floor((t - tWord) / 0.035) + 1);
      let x = WX;
      for (let k = 0; k < n; k++) {
        const ch = WORD[k]!;
        c.fillStyle = hotType(t - (tWord + k * 0.035), o, 0.3);
        c.fillText(ch, x, WB);
        x += c.measureText(ch).width;
      }
    }
    if (t >= tUrl) {
      c.font = font(F.mono(500), US);
      const n = Math.min(URL.length, Math.floor((t - tUrl) / 0.05) + 1);
      for (let k = 0; k < n; k++) { c.fillStyle = k >= 4 && k <= 8 ? rgba('signal', o) : hotType(t - (tUrl + k * 0.05), o * 0.9, 0.3); c.fillText(URL[k]!, UX + k * UADV, UB); }
      const done = t > tUrl + URL.length * 0.05;
      const blink = !done || Math.floor((t - tUrl - URL.length * 0.05) * 2.2) % 2 === 0;
      c.fillStyle = rgba('signal', (blink ? 1 : 0.12) * o);
      c.fillRect(UX + n * UADV + 6, UB - US * 0.78, 5, US * 0.95);
    }
    comp.draw(renderer, L.upload(), out);
    const flash = t > tSweep ? 0.03 * Math.exp(-(t - tSweep) * 30) : 0;
    return { ...EDGE_POST, bloom: 0.62, halation: 0.26, flash };
  }
}
