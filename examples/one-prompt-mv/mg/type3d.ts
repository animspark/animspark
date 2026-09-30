import * as THREE from 'three';
import { FontLoader, type Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import unbounded from './font-unbounded-900';
import archivo from './font-archivo-black';
import serif from './font-instrument-italic';
import anton from './font-anton';
import monoton from './font-monoton';
import plexmono from './font-plexmono-600';

/*
 * Type as matter. Real glyph outlines (converted from the fonts with fontTools) become solid,
 * bevelled, lit objects; neon tubes that trace the outlines; point clouds sampled from the
 * glyphs; letters as separate bodies; words bent around cylinders. Every lyric can be a thing in
 * the room.
 */
export type FontName = 'display' | 'block' | 'serif' | 'condensed' | 'neon' | 'mono';
const RAW: Record<FontName, unknown> = { display: unbounded, block: archivo, serif, condensed: anton, neon: monoton, mono: plexmono };
const FONTS = new Map<FontName, Font>();
export function font(name: FontName): Font {
  let f = FONTS.get(name);
  if (!f) { f = new FontLoader().parse(RAW[name] as never); FONTS.set(name, f); }
  return f;
}

export interface TextOpts { font?: FontName; size?: number; depth?: number; bevel?: number; curve?: number; align?: 'center' | 'left' }
const cache = new Map<string, THREE.BufferGeometry>();

/** a solid, bevelled word, centred on its bounding box (or left-aligned at x = 0) */
export function text3d(str: string, o: TextOpts = {}): THREE.BufferGeometry {
  const key = `t|${str}|${JSON.stringify(o)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = o.size ?? 1, bevel = o.bevel ?? size * 0.03;
  const geo = new TextGeometry(str, {
    font: font(o.font ?? 'display'), size, depth: o.depth ?? size * 0.3, curveSegments: o.curve ?? 8,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3,
  });
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  if ((o.align ?? 'center') === 'center') geo.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
  else geo.translate(0, 0, -(b.max.z + b.min.z) / 2);
  geo.computeVertexNormals();
  cache.set(key, geo);
  return geo;
}

/** a word as separate letters: each has its geometry (centred on itself) and its place in the word */
export interface Letter { ch: string; geo: THREE.BufferGeometry; x: number; w: number }
export function letters3d(str: string, o: TextOpts = {}): { letters: Letter[]; width: number } {
  const f = font(o.font ?? 'display');
  const size = o.size ?? 1;
  const data = (f as unknown as { data: { glyphs: Record<string, { ha: number }>; resolution: number } }).data;
  const scale = size / data.resolution;
  let x = 0;
  const out: Letter[] = [];
  for (const ch of str) {
    const adv = (data.glyphs[ch]?.ha ?? data.resolution * 0.3) * scale;
    if (ch !== ' ') {
      const geo = text3d(ch, { ...o, align: 'center' });
      geo.computeBoundingBox();
      const w = geo.boundingBox!.max.x - geo.boundingBox!.min.x;
      out.push({ ch, geo, x: x + adv / 2, w });
    }
    x += adv;
  }
  out.forEach((l) => { l.x -= x / 2; });
  return { letters: out, width: x };
}

/** neon: tubes that trace every contour of the glyphs; returns one merged geometry + total length for draw-on */
export function neon3d(str: string, o: { font?: FontName; size?: number; radius?: number; align?: 'center' | 'left' } = {}): THREE.BufferGeometry {
  const key = `n|${str}|${JSON.stringify(o)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = o.size ?? 1, r = o.radius ?? size * 0.018;
  const shapes = font(o.font ?? 'display').generateShapes(str, size);
  const tubes: THREE.BufferGeometry[] = [];
  const contour = (pts: THREE.Vector2[]) => {
    if (pts.length < 3) return;
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, p.y, 0)), true, 'centripetal');
    tubes.push(new THREE.TubeGeometry(curve, Math.max(24, pts.length * 2), r, 8, true));
  };
  for (const s of shapes) {
    contour(s.getPoints(10));
    for (const h of s.holes) contour(h.getPoints(10));
  }
  const geo = mergeGeos(tubes);
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  if ((o.align ?? 'center') === 'center') geo.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, 0);
  cache.set(key, geo);
  return geo;
}

/** points sampled inside the glyphs (area-weighted), in the word's plane, centred */
export function glyphPoints(str: string, n: number, o: { font?: FontName; size?: number; seed?: number } = {}): Float32Array {
  const size = o.size ?? 1;
  const shapes = font(o.font ?? 'display').generateShapes(str, size);
  const geo = new THREE.ShapeGeometry(shapes, 6);
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const cx = (b.max.x + b.min.x) / 2, cy = (b.max.y + b.min.y) / 2;
  const pos = geo.attributes.position.array as Float32Array;
  const idx = geo.index ? (geo.index.array as ArrayLike<number>) : Array.from({ length: pos.length / 3 }, (_, i) => i);
  const tris: number[] = [], area: number[] = [];
  let total = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3, c = idx[i + 1]! * 3, d = idx[i + 2]! * 3;
    const ar = Math.abs((pos[c]! - pos[a]!) * (pos[d + 1]! - pos[a + 1]!) - (pos[d]! - pos[a]!) * (pos[c + 1]! - pos[a + 1]!)) / 2;
    total += ar; tris.push(a, c, d); area.push(total);
  }
  let seed = o.seed ?? 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const rr = rnd() * total;
    let lo = 0, hi = area.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (area[mid]! < rr) lo = mid + 1; else hi = mid; }
    const a = tris[lo * 3]!, c = tris[lo * 3 + 1]!, d = tris[lo * 3 + 2]!;
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    out[k * 3] = pos[a]! + (pos[c]! - pos[a]!) * u + (pos[d]! - pos[a]!) * v - cx;
    out[k * 3 + 1] = pos[a + 1]! + (pos[c + 1]! - pos[a + 1]!) * u + (pos[d + 1]! - pos[a + 1]!) * v - cy;
    out[k * 3 + 2] = 0;
  }
  geo.dispose();
  return out;
}

/** bend a geometry around the Y axis: x becomes arc length on a cylinder of radius R */
export function bend(geo: THREE.BufferGeometry, R: number): THREE.BufferGeometry {
  const g = geo.clone();
  const p = g.attributes.position.array as Float32Array;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!, z = p[i + 2]!;
    const a = x / R, rr = R - z;
    p[i] = Math.sin(a) * rr;
    p[i + 2] = R - Math.cos(a) * rr;
  }
  g.computeVertexNormals();
  return g;
}

export function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of nonIndexed) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/* ── materials ────────────────────────────────────────── */
export const MAT = {
  ink: () => new THREE.MeshPhysicalMaterial({ color: '#1a1a1c', roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }),
  bone: () => new THREE.MeshPhysicalMaterial({ color: '#D8D2C7', roughness: 0.45, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3 }),
  orange: () => new THREE.MeshPhysicalMaterial({ color: '#FF5A1F', roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06, emissive: '#FF3A00', emissiveIntensity: 0.12 }),
  chrome: () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.08, metalness: 1 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.6, ior: 1.45, clearcoat: 1 }),
  neon: (c: THREE.ColorRepresentation = '#FF5A1F', k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false }),
};

/** a studio environment for reflections (built once per renderer) */
const ENVS = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();
export function studioEnv(r: THREE.WebGLRenderer): THREE.Texture {
  let e = ENVS.get(r);
  if (!e) {
    const pm = new THREE.PMREMGenerator(r);
    e = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    pm.dispose();
    ENVS.set(r, e);
  }
  return e;
}

/** evenly spaced points along every contour of the glyphs (for bulbs, sparks, dotted outlines), centred */
export function outlinePoints(str: string, spacing: number, o: { font?: FontName; size?: number } = {}): THREE.Vector2[] {
  const size = o.size ?? 1;
  const shapes = font(o.font ?? 'display').generateShapes(str, size);
  const out: THREE.Vector2[] = [];
  const take = (path: THREE.Path) => {
    const len = path.getLength();
    const n = Math.max(3, Math.round(len / spacing));
    for (let k = 0; k < n; k++) out.push(path.getPointAt(k / n));
  };
  for (const s of shapes) { take(s); s.holes.forEach(take); }
  const b = new THREE.Box2().setFromPoints(out);
  const c = b.getCenter(new THREE.Vector2());
  return out.map((p) => p.sub(c));
}

/** lay a word's letters along a circle (in the XZ plane, lying flat, reading clockwise from `start`) */
export function ringLetters(str: string, o: TextOpts = {}): { letters: Letter[]; width: number } {
  return letters3d(str, o);
}
export function placeOnRing(meshes: THREE.Object3D[], letters: Letter[], width: number, R: number, start: number, y = 0.02) {
  letters.forEach((l, k) => {
    const s = l.x + width / 2; // arc length from the word's start
    const a = start - s / R;
    const m = meshes[k]!;
    m.position.set(Math.cos(a) * R, y, Math.sin(a) * R);
    m.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - a);
  });
}
