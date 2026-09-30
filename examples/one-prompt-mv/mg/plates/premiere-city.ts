// Premiere plate: the model city at night, rebuilt from the city plate's world (city-geo's exported
// buildWorld: the same lots, towers, slab and river), with a picture palace in the plaza.
// Rendered straight into the plate's HDR target: an ink depth prepass of the buildings (faces lit by
// the fireworks, engraved hatching on the shadow sides), window light (a wave outward from the
// theatre, twinkling on the beats), then depth-tested bone hairlines.
import * as THREE from 'three';
import { LineBatch } from '../px/lines';
import { LIN } from '../px/palette';
import { GLSL_COMMON } from '../px/glsl/common';
import { hash } from '../px/util';
import { buildWorld, type World, type V3 } from './city-geo';
import { setThreeCam, type Xf } from './city-cam';
import { sc, type RGB } from './premiere-kit';

const VH = 'precision highp float;\nprecision highp int;\n';
const FH = `precision highp float;\nprecision highp int;\nout vec4 fragColor;\n${GLSL_COMMON}\n`;

/** The picture palace in the plaza (world units; the plaza is clear to about ±4.6). */
export const THEATRE = {
  body: [-3.4, 3.4, -1.6, 3.4, 0, 3.6] as const,
  fly: [-2.4, 2.4, 0.9, 3.4, 0, 6.0] as const,
  canopy: [-2.7, 2.7, -2.7, -1.6, 1.55, 0.28] as const,
  blade: [-0.2, 0.2, -2.35, -1.6, 2.1, 4.3] as const,
  /** the beacon on top of the blade sign: the one point of light we descend onto */
  beacon: [0, -1.98, 6.62] as V3,
  /** the letter board over the canopy, on the façade (y = -1.6): x0, x1, z0, z1 */
  board: [-2.5, 2.5, 2.0, 3.25] as const,
  /** searchlights on the roof */
  lights: [[-3.0, -1.2, 3.6], [-1.0, -1.3, 3.6], [1.0, -1.3, 3.6], [3.0, -1.2, 3.6]] as V3[],
};

export interface CityState {
  t: number;
  /** hairline, face and window opacity (0..1) */
  lineA: number; faceA: number; winA: number;
  /** window wave: lights reach radius r at t = w0 + (w1 - w0) * (r / 62)^1.4 */
  w0: number; w1: number;
  /** firework light on the façades (0..~2) and its colour temperature */
  flash: number;
  zoom: number;
  beat: number;
  /** marquee bulb chase (eighth notes) */
  chase: number;
  /** beacon intensity */
  beacon: number;
}

export class NightCity {
  world: World = buildWorld();
  boxScene = new THREE.Scene();
  winScene = new THREE.Scene();
  boxCam = new THREE.OrthographicCamera();
  lineCam = new THREE.OrthographicCamera();
  lines = new LineBatch(40000, { screen2D: false, blend: 'add', depthTest: true });
  boxes!: THREE.InstancedMesh;
  boxMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VH + /* glsl */ `
      in vec3 position; in vec3 normal; in mat4 instanceMatrix;
      uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
      out vec3 vW; out vec3 vN;
      void main() {
        vec4 w = instanceMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normal;
        gl_Position = projectionMatrix * modelViewMatrix * w;
      }`,
    fragmentShader: FH + /* glsl */ `
      in vec3 vW; in vec3 vN;
      uniform float zoom, flash, faceA;
      float oct(float u, float d) {
        float L = log2(6.0 / max(zoom, 1e-3)), k = floor(L), f = L - k;
        return mix(hatch(u / exp2(k), d), hatch(u / exp2(k + 1.0), d), f);
      }
      void main() {
        vec3 c = C_INK;
        float fl = flash * (0.6 + 0.4 * smoothstep(0.0, 12.0, vW.z));
        if (vN.z > 0.5) c = C_INK2 * 0.42 + C_SIGNAL * 0.012 * fl;
        else if (vN.y < -0.5) c = C_INK2 * 0.62 + (C_SIGNAL * 0.022 + C_EMBER * 0.006) * fl;
        else if (vN.x < -0.5) c = C_INK * 0.8 + C_GRAPHITE * 0.05 * oct(vW.y + vW.z, 0.3) + C_SIGNAL * 0.018 * fl;
        fragColor = vec4(mix(C_INK, c, faceA), 1.0);
      }`,
    uniforms: { zoom: { value: 10 }, flash: { value: 0 }, faceA: { value: 1 } },
    depthTest: true, depthWrite: true,
  });
  winMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VH + /* glsl */ `
      in vec3 position; in vec3 iC; in vec3 iU; in vec3 iV; in vec4 iH;
      uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
      uniform float t, w0, w1, zoom, winA, beat, flash;
      out vec3 vCol;
      float h1(float x) { return fract(sin(x * 127.1 + 311.7) * 43758.5453); }
      void main() {
        float s = max(1.0, 1.1 / max(1e-3, zoom * length(iU) * 2.0));
        vec3 p = iC + position.x * iU * s + position.y * iV * s;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        float tl = w0 + (w1 - w0) * pow(clamp(iH.y / 62.0, 0.0, 1.0), 1.4) + 0.06 * iH.x;
        float on = step(tl, t) * step(0.3, fract(iH.x * 7.31));
        // premiere night: a few windows change on every beat
        float tw = step(0.94, h1(iH.x * 911.0 + beat * 13.7));
        on *= 1.0 - 0.85 * tw;
        float age = max(0.0, t - tl);
        float I = (0.1 + 0.22 * fract(iH.x * 13.7)) * (1.0 + 5.0 * exp(-age / 0.07)) * (1.0 + 0.35 * flash);
        float warm = fract(iH.x * 3.71);
        vec3 c = warm > 0.86 ? vec3(1.0, 0.36, 0.08) * 0.9 : warm > 0.55 ? vec3(1.0, 0.62, 0.3) * 0.7 : vec3(0.86, 0.8, 0.7) * 0.62;
        vCol = c * I * on * winA / (s * s) + vec3(0.02, 0.019, 0.018) * (1.0 - on) * winA / (s * s);
      }`,
    fragmentShader: FH + /* glsl */ `
      in vec3 vCol;
      void main() { fragColor = vec4(vCol, 1.0); }`,
    uniforms: {
      t: { value: 0 }, w0: { value: 0 }, w1: { value: 1 }, zoom: { value: 10 }, winA: { value: 1 }, beat: { value: 0 }, flash: { value: 0 },
    },
    depthTest: true, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  });
  /** building boxes: x0,x1,y0,y1,z0,h and a class (0 city, 1 theatre) */
  boxList: { b: [number, number, number, number, number, number]; cls: number; r: number }[] = [];

  constructor() {
    const w = this.world;
    for (const b of w.bl) this.boxList.push({ b: [b.x0, b.x1, b.y0, b.y1, 0, b.h], cls: 0, r: b.r });
    const T = THEATRE;
    const add = (q: readonly number[]) => this.boxList.push({ b: [q[0]!, q[1]!, q[2]!, q[3]!, q[4]!, q[5]!], cls: 1, r: 0 });
    add(T.body); add(T.fly); add(T.canopy); add(T.blade);

    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);
    this.boxes = new THREE.InstancedMesh(geo, this.boxMat, this.boxList.length);
    this.boxes.frustumCulled = false;
    const m = new THREE.Matrix4();
    this.boxList.forEach((bx, i) => {
      const [x0, x1, y0, y1, z0, h] = bx.b;
      m.set(x1 - x0, 0, 0, (x0 + x1) / 2, 0, y1 - y0, 0, (y0 + y1) / 2, 0, 0, Math.max(h, 1e-4), z0, 0, 0, 0, 1);
      this.boxes.setMatrixAt(i, m);
    });
    this.boxes.instanceMatrix.needsUpdate = true;
    this.boxScene.add(this.boxes);

    // windows (the city's, plus the theatre's lobby glass)
    const wins = w.wins;
    const n = wins.length;
    const iC = new Float32Array(n * 3), iU = new Float32Array(n * 3), iV = new Float32Array(n * 3), iH = new Float32Array(n * 4);
    wins.forEach((wi, i) => {
      iC.set(wi.c, i * 3); iU.set(wi.u, i * 3); iV.set(wi.v, i * 3);
      iH.set([hash(i, 7), Math.hypot(wi.c[0], wi.c[1]), 0, 0], i * 4);
    });
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(2, 2);
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 3));
    g.setAttribute('iU', new THREE.InstancedBufferAttribute(iU, 3));
    g.setAttribute('iV', new THREE.InstancedBufferAttribute(iV, 3));
    g.setAttribute('iH', new THREE.InstancedBufferAttribute(iH, 4));
    g.instanceCount = n;
    const wm = new THREE.Mesh(g, this.winMat);
    wm.frustumCulled = false;
    this.winScene.add(wm);
    for (const c of [this.boxCam, this.lineCam]) { c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false; }
  }

  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, m: Xf, s: CityState) {
    setThreeCam(this.boxCam, m, 0);
    setThreeCam(this.lineCam, m, 0.05);
    const bu = this.boxMat.uniforms;
    bu.zoom!.value = s.zoom; bu.flash!.value = s.flash; bu.faceA!.value = s.faceA;
    renderer.setRenderTarget(out);
    if (s.faceA > 0.001) renderer.render(this.boxScene, this.boxCam);
    const wu = this.winMat.uniforms;
    wu.t!.value = s.t; wu.w0!.value = s.w0; wu.w1!.value = s.w1; wu.zoom!.value = s.zoom; wu.winA!.value = s.winA; wu.beat!.value = s.beat; wu.flash!.value = s.flash;
    if (s.winA > 0.001) renderer.render(this.winScene, this.lineCam);
    const lb = this.lines; lb.clear();
    if (s.lineA > 0.001) this.drawLines(lb, s);
    lb.render(renderer, out, this.lineCam);
  }

  private drawLines(lb: LineBatch, s: CityState) {
    const A = s.lineA;
    const seg = (a: V3, b: V3, w: number, c: RGB, al: number) => lb.seg(a[0], a[1], a[2], b[0], b[1], b[2], w, c[0], c[1], c[2], al);
    const cityC = sc(LIN.bone, 0.3), thC = sc(LIN.bone, 0.62);
    // hairlines thin with distance from the theatre (the far city is finer)
    for (const bx of this.boxList) {
      const [x0, x1, y0, y1, z0, h] = bx.b;
      const z1 = z0 + h;
      const c = bx.cls ? thC : cityC;
      const al = A * (bx.cls ? 1 : 0.55 + 0.45 * Math.exp(-bx.r / 40)) * (0.25 + 0.75 * Math.min(1, s.zoom / 6));
      const w = bx.cls ? 1.2 : 1.0;
      const S = (a: V3, b: V3) => seg(a, b, w, c, al);
      S([x0, y0, z1], [x1, y0, z1]); S([x1, y0, z1], [x1, y1, z1]); S([x1, y1, z1], [x0, y1, z1]); S([x0, y1, z1], [x0, y0, z1]);
      S([x0, y0, z0], [x0, y0, z1]); S([x1, y0, z0], [x1, y0, z1]); S([x0, y1, z0], [x0, y1, z1]);
      S([x0, y0, z0], [x1, y0, z0]); S([x0, y0, z0], [x0, y1, z0]);
    }
    const gC = [sc(LIN.bone, 0.17), sc(LIN.bone, 0.1), sc(LIN.bone, 0.24), sc(LIN.bone, 0.09), sc(LIN.ash, 0.2)];
    for (const g of this.world.ground) seg(g.a, g.b, 1, gC[g.cls]!, A * (0.5 + 0.5 * Math.exp(-g.r / 45)) * (0.25 + 0.75 * Math.min(1, s.zoom / 6)));
    // the theatre: the marquee's bulbs (chasing on the eighths), the letter board, the stage door steps
    const T = THEATRE;
    const [cx0, cx1, cy0, , cz0, ch] = T.canopy;
    const bulbs: V3[] = [];
    const nF = 22;
    for (let k = 0; k <= nF; k++) { const x = cx0 + ((cx1 - cx0) * k) / nF; bulbs.push([x, cy0 - 0.01, cz0 + ch * 0.5]); }
    const [bx0, bx1, bz0, bz1] = T.board;
    const nB = 18, nV = 5;
    for (let k = 0; k <= nB; k++) { const x = bx0 + ((bx1 - bx0) * k) / nB; bulbs.push([x, -1.62, bz1]); bulbs.push([x, -1.62, bz0]); }
    for (let k = 1; k < nV; k++) { const z = bz0 + ((bz1 - bz0) * k) / nV; bulbs.push([bx0, -1.62, z]); bulbs.push([bx1, -1.62, z]); }
    bulbs.forEach((p, i) => {
      const on = (i + Math.floor(s.chase)) % 3 === 0 ? 1 : 0.28;
      const I = (0.7 + 1.6 * on) * A;
      seg(p, [p[0] + 0.01, p[1], p[2]], 2.6, sc(LIN.ember, I), 1);
    });
    // board frame and a rule under the board
    const fy = -1.615;
    seg([bx0, fy, bz0], [bx1, fy, bz0], 1, thC, A); seg([bx0, fy, bz1], [bx1, fy, bz1], 1, thC, A);
    seg([bx0, fy, bz0], [bx0, fy, bz1], 1, thC, A); seg([bx1, fy, bz0], [bx1, fy, bz1], 1, thC, A);
    // lobby doors: glass lit from inside
    for (let k = 0; k < 6; k++) {
      const x = -1.8 + k * 0.72;
      seg([x, -1.61, 0.05], [x, -1.61, 1.3], 1, sc(LIN.ember, 0.55 * A), 1);
      seg([x + 0.5, -1.61, 0.05], [x + 0.5, -1.61, 1.3], 1, sc(LIN.ember, 0.55 * A), 1);
      seg([x, -1.61, 1.3], [x + 0.5, -1.61, 1.3], 1, sc(LIN.ember, 0.55 * A), 1);
    }
    // the carpet and its ropes, out to the street
    for (const sx of [-1.1, 1.1]) {
      seg([sx, -2.7, 0.01], [sx, -5.2, 0.01], 1, sc(LIN.signal, 0.5 * A), 1);
      for (let k = 0; k < 5; k++) { const y = -2.8 - k * 0.55; seg([sx * 1.25, y, 0], [sx * 1.25, y, 0.45], 1, thC, A); }
    }
    // the beacon on top of the blade
    const bI = s.beacon * A;
    if (bI > 0.01) seg(T.beacon, [T.beacon[0] + 0.01, T.beacon[1], T.beacon[2]], 3, sc(LIN.ember, 1.6 * bI), 1);
  }
}
