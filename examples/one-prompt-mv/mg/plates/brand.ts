// The AnimSpark mark: four quarter discs turning like a windmill (apps/web BrandLogo, one SVG path).
// Here as exact geometry: a GLSL signed distance field (2D, and extruded in 3D), the one continuous
// outline the pen draws, points inside it for particles, and the brand gradient.
import { hexToLinear, mulberry32 } from '../px/util';

/** logo units: the SVG's 137 × 135 box, y down; the centre of the pinwheel */
export const LW = 137, LH = 135, LC = { x: 68.5, y: 67.5 }, LR = 68.5;
/** each blade: its cell box (x0,y0,x1,y1) and the corner its quarter disc is centred on */
export const BLADES = [
  { cell: [0, 0, 68.5, 67.5], c: [0, 67.5] }, // top left: disc on its bottom-left corner
  { cell: [68.5, 0, 137, 67.5], c: [68.5, 0] }, // top right: disc on its top-left corner
  { cell: [68.5, 67.5, 137, 135], c: [137, 67.5] }, // bottom right: disc on its top-right corner
  { cell: [0, 67.5, 68.5, 135], c: [68.5, 135] }, // bottom left: disc on its bottom-right corner
] as const;

/** brand gradient (top-left → bottom-right), as in the product logo */
export const BRAND_HEX = ['#2F9B5F', '#3DBB90', '#55BFD3'] as const;
export const BRAND_LIN = BRAND_HEX.map(hexToLinear) as [number, number, number][];
const v3 = (c: [number, number, number]) => `vec3(${c.map((x) => x.toFixed(4)).join(',')})`;

/** GLSL: sdLogo(p) in logo units (y down, origin top-left); logoArc(p) = distance to the nearest blade's disc centre (for arc hatching); brandGrad(p) */
export const GLSL_LOGO = /* glsl */ `
const vec3 C_BR0 = ${v3(BRAND_LIN[0]!)};
const vec3 C_BR1 = ${v3(BRAND_LIN[1]!)};
const vec3 C_BR2 = ${v3(BRAND_LIN[2]!)};
float sdBlade(vec2 p, vec4 cell, vec2 c) {
  vec2 bc = 0.5 * (cell.xy + cell.zw), bh = 0.5 * (cell.zw - cell.xy);
  return max(sdBox(p - bc, bh), length(p - c) - ${LR.toFixed(1)});
}
float sdLogo(vec2 p) {
  float d = sdBlade(p, vec4(0.0, 0.0, 68.5, 67.5), vec2(0.0, 67.5));
  d = min(d, sdBlade(p, vec4(68.5, 0.0, 137.0, 67.5), vec2(68.5, 0.0)));
  d = min(d, sdBlade(p, vec4(68.5, 67.5, 137.0, 135.0), vec2(137.0, 67.5)));
  d = min(d, sdBlade(p, vec4(0.0, 67.5, 68.5, 135.0), vec2(68.5, 135.0)));
  return d;
}
/** the radius about the blade's own disc centre: engraving arcs follow each blade's curvature */
float logoArc(vec2 p) {
  vec2 c = p.x < 68.5 ? (p.y < 67.5 ? vec2(0.0, 67.5) : vec2(68.5, 135.0)) : (p.y < 67.5 ? vec2(68.5, 0.0) : vec2(137.0, 67.5));
  return length(p - c);
}
vec3 brandGrad(vec2 p) {
  float k = clamp(dot(p, vec2(0.7071)) / (0.7071 * 272.0), 0.0, 1.0);
  return k < 0.5 ? mix(C_BR0, C_BR1, k * 2.0) : mix(C_BR1, C_BR2, k * 2.0 - 2.0 * 0.5);
}
/** rotate logo coordinates about the pinwheel centre */
vec2 logoRot(vec2 p, float a) { vec2 q = p - vec2(${LC.x}, ${LC.y}); float c = cos(a), s = sin(a); return vec2(c * q.x + s * q.y, -s * q.x + c * q.y) + vec2(${LC.x}, ${LC.y}); }
`;

type P = { x: number; y: number };
const rot = (p: P, a: number): P => { const dx = p.x - LC.x, dy = p.y - LC.y, c = Math.cos(a), s = Math.sin(a); return { x: LC.x + c * dx - s * dy, y: LC.y + s * dx + c * dy }; };

/**
 * The mark as ONE continuous line (logo units): out of the centre along each blade's straight edges,
 * round its arc, back to the centre, blade after blade — the way the SVG is one path.
 */
export function logoOutline(): P[] {
  const out: P[] = [];
  const cut = Math.sqrt(LR * LR - 67.5 * 67.5); // where the top-left arc leaves the cell's top edge
  const tl: P[] = [{ x: 68.5, y: 67.5 }, { x: 0, y: 67.5 }, { x: 0, y: 0 }, { x: cut, y: 0 }];
  // arc about (0, 67.5) from (cut, 0) round to (68.5, 67.5)
  const a0 = Math.atan2(0 - 67.5, cut - 0), a1 = 0;
  for (let k = 1; k <= 40; k++) { const a = a0 + (a1 - a0) * (k / 40); tl.push({ x: LR * Math.cos(a), y: 67.5 + LR * Math.sin(a) }); }
  for (let b = 0; b < 4; b++) for (const p of tl) out.push(rot(p, (b * Math.PI) / 2));
  return out;
}

/** points inside the mark (logo units), for particles */
export function logoPoints(n: number, seed = 7): P[] {
  const r = mulberry32(seed), out: P[] = [];
  while (out.length < n) {
    const p = { x: r() * LW, y: r() * LH };
    const inside = BLADES.some((b) => p.x >= b.cell[0] && p.x <= b.cell[2] && p.y >= b.cell[1] && p.y <= b.cell[3] && Math.hypot(p.x - b.c[0], p.y - b.c[1]) <= LR);
    if (inside) out.push(p);
  }
  return out;
}

/** brand colour (linear) at a point of the mark, as the gradient runs */
export function brandAt(p: P): [number, number, number] {
  const k = Math.min(1, Math.max(0, (p.x + p.y) / 272));
  const [a, b] = k < 0.5 ? [BRAND_LIN[0]!, BRAND_LIN[1]!] : [BRAND_LIN[1]!, BRAND_LIN[2]!];
  const u = k < 0.5 ? k * 2 : k * 2 - 1;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
