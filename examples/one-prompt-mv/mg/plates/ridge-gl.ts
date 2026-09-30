// GL helpers for the `ridge` plate: the hidden-line fill strips (depth-writing ink under each ridge)
// and a depth-tested composite for text layers that sit at one depth in the ridge field.
import * as THREE from 'three';
import { W, H } from '../px/gl';
import { GLSL_COMMON } from '../px/glsl/common';

/**
 * One triangle strip per ridge, from the ridge line down past the frame bottom, written at the ridge's
 * NDC depth. Nearer strips hide farther lines (LineBatch with depthTest), which is the hidden-line look.
 * The face under each crest carries a faint engraved hachure that fades with the distance below the line.
 */
export class FillStrips {
  geo = new THREE.BufferGeometry();
  mat: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  pos: Float32Array; down: Float32Array; kk: Float32Array;
  private aPos: THREE.BufferAttribute; private aDown: THREE.BufferAttribute; private aK: THREE.BufferAttribute;
  count = 0;
  constructor(public maxRidges: number, public M: number) {
    const nv = maxRidges * M * 2;
    this.pos = new Float32Array(nv * 3);
    this.down = new Float32Array(nv);
    this.kk = new Float32Array(nv);
    const idx = new Uint32Array(maxRidges * (M - 1) * 6);
    let o = 0;
    for (let r = 0; r < maxRidges; r++) {
      const b = r * M * 2;
      for (let j = 0; j < M - 1; j++) {
        const t0 = b + j * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
        idx[o++] = t0; idx[o++] = b0; idx[o++] = t1;
        idx[o++] = b0; idx[o++] = b1; idx[o++] = t1;
      }
    }
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aDown = new THREE.BufferAttribute(this.down, 1).setUsage(THREE.DynamicDrawUsage);
    this.aK = new THREE.BufferAttribute(this.kk, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('aDown', this.aDown);
    this.geo.setAttribute('aK', this.aK);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: /* glsl */ `
        precision highp float;
        in vec3 position; in float aDown; in float aK;
        out float vDown; out float vK;
        void main() {
          vDown = aDown; vK = aK;
          gl_Position = vec4(position.x / ${W.toFixed(1)} * 2.0 - 1.0, 1.0 - position.y / ${H.toFixed(1)} * 2.0, position.z, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        precision highp int;
        in float vDown; in float vK;
        out vec4 fragColor;
        ${GLSL_COMMON}
        uniform float uHatch;
        void main() {
          vec3 col = C_INK;
          // engraved hachure: two or three fine lines under the crest, fading down the face
          float d = max(vDown - 2.2, 0.0);
          float hk = exp(-d / 9.0) * uHatch * vK;
          col += C_ASH * hatch(d / 3.4 + 0.5, 0.28) * hk * 0.16;
          fragColor = vec4(col, 1.0);
        }`,
      uniforms: { uHatch: { value: 1 } },
      depthTest: true, depthWrite: true, blending: THREE.NoBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  /** Write ridge r: top points (xs, ys), NDC depth, face intensity. */
  setRidge(r: number, xs: Float32Array, ys: Float32Array, depth: number, k: number) {
    const M = this.M, b = r * M * 2;
    const yb = H + 60;
    for (let j = 0; j < M; j++) {
      const v = b + j * 2;
      this.pos[v * 3] = xs[j]!; this.pos[v * 3 + 1] = ys[j]!; this.pos[v * 3 + 2] = depth;
      this.pos[v * 3 + 3] = xs[j]!; this.pos[v * 3 + 4] = yb; this.pos[v * 3 + 5] = depth;
      this.down[v] = 0; this.down[v + 1] = yb - ys[j]!;
      this.kk[v] = k; this.kk[v + 1] = k;
    }
  }
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, n: number) {
    this.count = n;
    const nv = n * this.M * 2;
    this.aPos.needsUpdate = true; this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, nv * 3);
    this.aDown.needsUpdate = true; this.aDown.clearUpdateRanges(); this.aDown.addUpdateRange(0, nv);
    this.aK.needsUpdate = true; this.aK.clearUpdateRanges(); this.aK.addUpdateRange(0, nv);
    this.geo.setDrawRange(0, n * (this.M - 1) * 6);
    renderer.setRenderTarget(out);
    renderer.render(this.scene, this.cam);
  }
}

/** Alpha-over of a Canvas2D layer at one NDC depth, depth-tested against the ridge fills. */
export class DepthComp {
  mat: THREE.RawShaderMaterial;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: /* glsl */ `
        precision highp float;
        in vec3 position; uniform float uDepth; out vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, uDepth, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv; uniform sampler2D tex; uniform float opacity; out vec4 fragColor;
        void main() { vec4 c = texture(tex, vUv); if (c.a < 0.002) discard; fragColor = vec4(c.rgb * c.a, c.a) * opacity; }`,
      uniforms: { tex: { value: null }, uDepth: { value: 0 }, opacity: { value: 1 } },
      depthTest: true, depthWrite: false, transparent: true, blending: THREE.CustomBlending,
    });
    const m = this.mat;
    m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  draw(renderer: THREE.WebGLRenderer, tex: THREE.Texture, out: THREE.WebGLRenderTarget, depth: number, opacity = 1) {
    this.mat.uniforms.tex!.value = tex;
    this.mat.uniforms.uDepth!.value = depth;
    this.mat.uniforms.opacity!.value = opacity;
    renderer.setRenderTarget(out);
    renderer.render(this.scene, this.cam);
  }
}
