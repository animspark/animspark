// City plate: GPU passes. The drawing is rendered as channel-coded ink into one HDR target
// (hidden-line through a depth prepass of the buildings), then composited onto bone paper or the
// ink night by one fullscreen pass (the reference's bureau idiom, with a night side).
//   inkRT.r  hairlines (ink on paper, dim bone at night)
//   inkRT.g  window light (emissive, HDR)
//   inkRT.b  orange: the live thing (orange ink on paper, glowing signal at night)
//   inkRT.a  tone: shadow-side hatching (paper only)
// The Canvas2D type layer adds r = hairlines, g = type (full bone at night), b = orange.
import * as THREE from 'three';
import { GLSL_COMMON } from '../px/glsl/common';

const VERT_HEAD = 'precision highp float;\nprecision highp int;\n';
const FRAG_HEAD = `precision highp float;\nprecision highp int;\nout vec4 fragColor;\n${GLSL_COMMON}\n`;

/** Buildings and bricks: writes depth, and hatching on the shadow (-X) faces into alpha. */
export function makeBoxMaterial() {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT_HEAD + /* glsl */ `
      in vec3 position; in vec3 normal; in mat4 instanceMatrix;
      uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
      out vec3 vW; out vec3 vN;
      void main() {
        vec4 w = instanceMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normal;
        gl_Position = projectionMatrix * modelViewMatrix * w;
      }`,
    fragmentShader: FRAG_HEAD + /* glsl */ `
      in vec3 vW; in vec3 vN;
      uniform float zoom; uniform float tone;
      // hatch spacing about 6 px on screen at any zoom: two octaves in world units, crossfaded
      float oct(float u) {
        float L = log2(6.5 / zoom), k = floor(L), f = L - k;
        return mix(hatch(u / exp2(k), 0.34), hatch(u / exp2(k + 1.0), 0.34), f);
      }
      void main() {
        float A = 0.0;
        if (vN.x < -0.5) A = oct(vW.y + vW.z) * tone;           // the shadow side
        else if (vN.y < -0.5) A = oct(vW.x * 0.35 - vW.z) * tone * 0.22; // the lit front: a whisper of tone
        fragColor = vec4(0.0, 0.0, 0.0, A);
      }`,
    uniforms: { zoom: { value: 60 }, tone: { value: 1 } },
    depthTest: true, depthWrite: true,
  });
}

/** Windows: instanced quads on the faces. Unlit marks (paper) into r, light into g (signal-warm ones into b). */
export function makeWindowMaterial() {
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT_HEAD + /* glsl */ `
      in vec3 position; in vec3 iC; in vec3 iU; in vec3 iV; in vec4 iT;
      uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
      uniform float t; uniform vec3 dA; uniform float dW, dAll; uniform float others, hero, unlitK, zoom;
      out vec3 vCol;
      void main() {
        // tiny windows are drawn at least ~1.2 px so the far city keeps its texture
        float s = max(1.0, 1.2 / max(1e-3, zoom * length(iU) * 2.0));
        vec3 p = iC + position.x * iU * s + position.y * iV * s;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        float appear = step(iT.x, t);
        float dn = dot(iC.xy, dA.xy);
        float dk = max(smoothstep(dA.z - dW, dA.z + dW, dn), dAll);
        float unlit = appear * (1.0 - dk) * unlitK / (s * s);
        float lit = 0.0;
        if (iT.w > 0.5) lit = hero;
        else if (t >= iT.y) {
          float e = t - iT.y;
          lit = (0.5 + 0.5 * fract(iT.z * 7.13)) * (1.0 + 2.4 * exp(-e / 0.08)) * others / (s * s);
        }
        float warm = step(0.78, fract(iT.z * 3.71)) * (iT.w > 0.5 ? 0.0 : 1.0);
        vCol = vec3(unlit, lit * (1.0 - warm), lit * warm * 0.7);
      }`,
    fragmentShader: FRAG_HEAD + /* glsl */ `
      in vec3 vCol;
      void main() { fragColor = vec4(vCol, 0.0); }`,
    uniforms: {
      t: { value: 0 }, dA: { value: new THREE.Vector3(0, 1, 1e4) }, dW: { value: 10 }, dAll: { value: 0 },
      others: { value: 1 }, hero: { value: 0 }, unlitK: { value: 0.5 }, zoom: { value: 60 },
    },
    depthTest: true, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending,
  });
  additivePreserveAlpha(m);
  return m;
}

/** add rgb, keep the destination's alpha (the tone channel) */
export function additivePreserveAlpha(m: THREE.Material) {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
  m.blendEquationAlpha = THREE.AddEquation; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
}

export const PAPER_FRAG = /* glsl */ `
uniform sampler2D inkTex; uniform sampler2D txtTex;
uniform float floodY, floodR;
uniform vec3 gA; uniform vec3 gB;     // screen px -> ground (X, Y)
uniform vec3 dA; uniform float dW, dAll;
uniform float lineNight, lineFade, typeFade, hotGain, lightGain;
uniform vec3 pA; uniform vec3 pB;     // screen px -> paper coordinates (fibres)
uniform float pz;
uniform vec4 st[3]; uniform vec4 sb[3]; // stamps: centre px, half px | angle, strength, seed, on

float fibres(vec2 p, float cs) {
  float acc = 0.0;
  vec2 cell = floor(p / cs);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 h = hash22(c);
    vec2 o = (c + h) * cs;
    float a = hash12(c + 7.1) * TAU;
    float L = cs * (0.3 + 1.1 * hash12(c + 3.3));
    vec2 d = vec2(cos(a), sin(a));
    float dist = sdSegment(p, o - d * L * 0.5, o + d * L * 0.5);
    float s = hash12(c + 9.9) - 0.5;
    acc += s * (1.0 - smoothstep(0.25, 0.9 + 0.4 / pz, dist));
  }
  return acc;
}
// rubber-stamp ink: voids, mottling, heavier near the edges of the letters (q in stamp units)
float stampInk(vec2 q, float cov, float edge, float seed, float strength) {
  float n = snoise(q * 0.07 + seed) * 0.45 + snoise(q * 0.23 + seed * 2.0) * 0.35 + snoise(q * 0.9 - seed) * 0.2;
  float press = smoothstep(-0.9, 0.3, snoise(q * 0.0045 + seed * 3.0));
  float voids = smoothstep(-0.58, -0.36, n + (strength - 1.0) * 0.8 + 0.25 * press);
  float mott = 0.72 + 0.28 * press;
  return sat(cov * voids * mott * 1.25 + edge * 0.5);
}

void main() {
  vec2 sp = vec2(vUv.x * 1920.0, (1.0 - vUv.y) * 1080.0);
  vec4 ink = texture(inkTex, vUv);
  vec3 tx = texture(txtTex, vUv).rgb;
  float Bt = tx.b, Braw = tx.b;
  // stamps (orange type layer only)
  for (int i = 0; i < 3; i++) {
    if (sb[i].w <= 0.0) continue;
    vec2 q = rot2(-sb[i].x) * (sp - st[i].xy);
    vec2 d = abs(q) - st[i].zw;
    if (d.x < 0.0 && d.y < 0.0) {
      vec2 px = vec2(2.5) / vec2(1920.0, 1080.0);
      float bl = (texture(txtTex, vUv + vec2(px.x, 0.0)).b + texture(txtTex, vUv - vec2(px.x, 0.0)).b
        + texture(txtTex, vUv + vec2(0.0, px.y)).b + texture(txtTex, vUv - vec2(0.0, px.y)).b) * 0.25;
      float edge = sat((Bt - bl) * 2.0);
      vec2 qs = q * (300.0 / max(st[i].z, 1.0));
      Bt = stampInk(qs, Bt, edge, sb[i].z, sb[i].y);
    }
  }
  float R = sat(ink.r + tx.r);
  float T = sat(tx.g);
  // orange drawn at <= 0.78 is plain ink (stamps, the cursor); above that it is hot and glows
  float Bh = max(ink.b, Braw);
  float B = sat((ink.b + Bt) / 0.78);
  float A = sat(ink.a);
  float L = max(ink.g, 0.0);

  // ---- where is the paper? the flood out of the ground line, then the night coming over the city
  float side = sp.y < floodY ? 1.0 : -1.0;
  float na = sat(floodR / 80.0);
  float fe = floodR + na * (30.0 * snoise(vec2(sp.x * 0.0038, side * 3.0)) + 9.0 * snoise(vec2(sp.x * 0.027, side * 7.0)) + 2.5 * snoise(vec2(sp.x * 0.19, side)));
  float fl = smoothstep(-1.2, 1.2, fe - abs(sp.y - floodY));
  vec2 g = vec2(dot(gA, vec3(sp, 1.0)), dot(gB, vec3(sp, 1.0)));
  float dn = dot(g, dA.xy) + 3.0 * snoise(g * 0.045) + 1.2 * snoise(g * 0.21);
  float dk = max(smoothstep(dA.z - dW, dA.z + dW, dn), dAll);
  float P = fl * (1.0 - dk);

  // ---- grounds
  vec2 pp = vec2(dot(pA, vec3(sp, 1.0)), dot(pB, vec3(sp, 1.0)));
  float cloud = fbm(pp * 0.0021, 4);
  float fib = fibres(pp, 22.0) + 0.6 * fibres(pp * 1.7 + 31.0, 22.0);
  float speck = step(0.99965, hash12(floor(pp * 0.5)));
  vec3 paper = C_BONE * (0.975 + 0.028 * cloud + 0.05 * fib);
  paper *= 1.0 - speck * 0.35;
  paper *= 0.97 + 0.03 * (1.0 - vUv.y * 0.6 - vUv.x * 0.4);
  vec3 night = C_INK * (0.9 + 0.14 * cloud + 0.1 * fib);
  vec3 ground = mix(night, paper, P);
  ground *= 1.0 - A * 0.8 * P;

  // ---- inks. Lines take the colour opposite their ground, so the night front inverts them.
  float inv = smoothstep(0.34, 0.5, P);
  vec3 lineC = mix(C_BONE * lineNight, C_INK * 1.1, inv);
  vec3 typeC = mix(C_BONE * 0.93, vec3(0.03, 0.028, 0.03), inv);
  vec3 col = ground;
  float dR = R * lineFade * (0.88 + 0.12 * smoothstep(-0.5, 0.6, snoise(pp * 0.35)));
  col = mix(col, lineC, dR);
  col = mix(col, typeC, T * typeFade);
  vec3 orP = ground * clamp(C_SIGNAL / C_BONE, 0.004, 1.0);
  vec3 orN = C_SIGNAL * 1.35;
  col = mix(col, mix(orN, orP, inv), B * typeFade);
  col += C_EMBER * 1.9 * smoothstep(0.8, 1.0, Bh) * hotGain * typeFade;
  col += C_EMBER * L * lightGain;
  fragColor = vec4(col, 1.0);
}`;
