// A glyph's outline as polylines, from the font as the browser renders it (the engine's fonts are
// variable instances registered as FontFaces, so there is no outline table to read): the glyph is drawn
// big into a canvas, traced with marching squares at half coverage, chained into closed loops and
// simplified. Units: em, origin at the glyph's origin on the baseline, y UP (the construction sheet's).
import { font } from '../px/type';

export type P = { x: number; y: number };

const SIZE = 480, PAD = 80;

function simplify(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a]!, B = pts[b]!;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i]!.x - A.x) * dy - (pts[i]!.y - A.y) * dx) / L; if (d > bd) { bd = d; best = i; } }
    if (bd > eps && best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** closed contours of one glyph (outer and counters), each starting at its lowest-left point */
export function glyphContours(ch: string, family: string): P[][] {
  const w = Math.ceil(SIZE * 1.4 + PAD * 2), h = Math.ceil(SIZE * 1.5 + PAD);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const base = SIZE * 1.15;
  c.font = font(family, SIZE); c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
  c.fillText(ch, PAD, base);
  const img = c.getImageData(0, 0, w, h).data;
  const v = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[(y * w + x) * 4 + 3]! / 255);
  // marching squares: edge crossings keyed by position, linked into loops
  const segs: [string, string][] = [];
  const pos = new Map<string, P>();
  const key = (p: P) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const lerpE = (x0: number, y0: number, x1: number, y1: number): P => {
    const a = v(x0, y0), b = v(x1, y1), k = Math.abs(b - a) < 1e-6 ? 0.5 : (0.5 - a) / (b - a);
    return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k };
  };
  const add = (a: P, b: P) => { const ka = key(a), kb = key(b); segs.push([ka, kb]); pos.set(ka, a); pos.set(kb, b); };
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const tl = v(x, y) >= 0.5 ? 1 : 0, tr = v(x + 1, y) >= 0.5 ? 1 : 0, br = v(x + 1, y + 1) >= 0.5 ? 1 : 0, bl = v(x, y + 1) >= 0.5 ? 1 : 0;
    const idx = tl * 8 + tr * 4 + br * 2 + bl;
    if (idx === 0 || idx === 15) continue;
    const T = () => lerpE(x, y, x + 1, y), R = () => lerpE(x + 1, y, x + 1, y + 1), Bo = () => lerpE(x, y + 1, x + 1, y + 1), L = () => lerpE(x, y, x, y + 1);
    // oriented so the inside is on the left (a consistent winding)
    switch (idx) {
      case 1: add(L(), Bo()); break; case 2: add(Bo(), R()); break; case 3: add(L(), R()); break;
      case 4: add(R(), T()); break; case 5: add(L(), T()); add(R(), Bo()); break; case 6: add(Bo(), T()); break;
      case 7: add(L(), T()); break; case 8: add(T(), L()); break; case 9: add(T(), Bo()); break;
      case 10: add(T(), R()); add(Bo(), L()); break; case 11: add(T(), R()); break; case 12: add(R(), L()); break;
      case 13: add(R(), Bo()); break; case 14: add(Bo(), L()); break;
    }
  }
  // chain the segments without trusting their direction: every crossing point has two neighbours
  const nb = new Map<string, string[]>();
  const link = (a: string, b: string) => { (nb.get(a) ?? nb.set(a, []).get(a)!).push(b); };
  for (const [ka, kb] of segs) { link(ka, kb); link(kb, ka); }
  const loops: P[][] = [];
  const seen = new Set<string>();
  for (const k0 of nb.keys()) {
    if (seen.has(k0)) continue;
    const loop: P[] = [];
    let prev = '', k = k0;
    for (let guard = 0; guard < 200000; guard++) {
      seen.add(k); loop.push(pos.get(k)!);
      const n = (nb.get(k) ?? []).filter((q) => q !== prev);
      const next = n.find((q) => !seen.has(q)) ?? (n.includes(k0) ? k0 : undefined);
      if (!next || next === k0) break;
      prev = k; k = next;
    }
    if (loop.length > 8) loops.push(loop);
  }
  const em = (p: P): P => ({ x: (p.x - PAD) / SIZE, y: (base - p.y) / SIZE });
  return loops.map((l) => {
    // a closed loop: split it at the point farthest from its start, simplify both halves
    let far = 0, fd = -1;
    l.forEach((p, i) => { const d = (p.x - l[0]!.x) ** 2 + (p.y - l[0]!.y) ** 2; if (d > fd) { fd = d; far = i; } });
    const h1 = simplify(l.slice(0, far + 1), 0.35), h2 = simplify([...l.slice(far), l[0]!], 0.35);
    let s = [...h1, ...h2.slice(1)].map(em);
    // start at the lowest-left point, so the pen begins each contour where a letterer would
    let bi = 0; s.forEach((p, i) => { if (p.y - p.x * 0.3 < s[bi]!.y - s[bi]!.x * 0.3) bi = i; });
    s = [...s.slice(bi, -1), ...s.slice(0, bi), s[bi]!];
    return s;
  }).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
}
function area(p: P[]) { let a = 0; for (let i = 1; i < p.length; i++) a += p[i - 1]!.x * p[i]!.y - p[i]!.x * p[i - 1]!.y; return a / 2; }
