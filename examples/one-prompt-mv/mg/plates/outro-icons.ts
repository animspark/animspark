// Outro plate: one hairline icon per plate of the film, in unit coordinates (about ±1, y down), for
// the rewind montage that collapses them, in reverse order, into the caret.
import { TAU } from '../px/util';
import type { P2 } from './premiere-kit';

type Poly = P2[];
const circ = (cx: number, cy: number, rx: number, ry = rx, n = 48, a0 = 0, a1 = TAU): Poly =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }; });
const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
const seg = (x0: number, y0: number, x1: number, y1: number): Poly => [{ x: x0, y: y0 }, { x: x1, y: y1 }];
const dots = (pts: P2[], d = 0.012): Poly[] => pts.map((p) => seg(p.x - d, p.y, p.x + d, p.y));

export interface Icon { id: string; no: number; polys: Poly[] }

/** The plates in film order (01 leader … 16 premiere). */
export function buildIcons(): Icon[] {
  const I: Icon[] = [];
  const add = (id: string, polys: Poly[]) => I.push({ id, no: I.length + 1, polys });
  // 01 leader: the countdown's rings, crosshair and ticks
  {
    const p: Poly[] = [circ(0, 0, 0.92), circ(0, 0, 0.76), circ(0, 0, 0.72), seg(-1.05, 0, 1.05, 0), seg(0, -1.05, 0, 1.05)];
    for (let i = 0; i < 60; i++) { const a = (i / 60) * TAU, r0 = i % 5 ? 0.86 : 0.8; p.push(seg(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * 0.92, Math.sin(a) * 0.92)); }
    add('LEADER', p);
  }
  // 02 prompt: a terminal line, the chevron and the caret
  add('PROMPT', [rect(-1, -0.28, 1, 0.28), [{ x: -0.86, y: -0.1 }, { x: -0.74, y: 0 }, { x: -0.86, y: 0.1 }], rect(-0.66, -0.14, -0.6, 0.14), seg(-1, -0.4, -0.4, -0.4)]);
  // 03 ridge: stacked ridgelines
  {
    const p: Poly[] = [];
    for (let r = 0; r < 7; r++) {
      const y0 = -0.6 + r * 0.2;
      p.push(Array.from({ length: 41 }, (_, i) => { const x = -1 + i / 20; return { x, y: y0 - 0.22 * Math.exp(-((x - 0.2 * Math.sin(r)) ** 2) * 6) * Math.abs(Math.sin(i * 0.9 + r)) }; }));
    }
    add('RIDGE', p);
  }
  // 04 city: three isometric blocks
  {
    const p: Poly[] = [];
    const box = (x: number, y: number, w: number, h: number) => {
      const k = 0.5;
      p.push([{ x, y }, { x: x + w, y: y - w * k }, { x: x + w, y: y - w * k - h }, { x, y: y - h }, { x, y }]);
      p.push([{ x, y }, { x: x - w, y: y - w * k }, { x: x - w, y: y - w * k - h }, { x, y: y - h }]);
      p.push([{ x, y: y - h }, { x: x + w, y: y - w * k - h }, { x, y: y - 2 * w * k - h }, { x: x - w, y: y - w * k - h }, { x, y: y - h }]);
    };
    box(-0.45, 0.55, 0.3, 0.7); box(0.15, 0.4, 0.28, 1.1); box(0.6, 0.65, 0.25, 0.45);
    add('CITY', p);
  }
  // 05 plot: a Fresnel and its cone
  add('LIGHTING PLOT', [rect(-0.25, -0.9, 0.25, -0.55), seg(-0.2, -0.55, -0.75, 0.8), seg(0.2, -0.55, 0.75, 0.8), circ(0, 0.8, 0.75, 0.12)]);
  // 06 hook 1: a ring with a one in it
  add('HOOK', [circ(0, 0, 0.9), [{ x: -0.15, y: -0.35 }, { x: 0.05, y: -0.5 }, { x: 0.05, y: 0.5 }], seg(-0.15, 0.5, 0.25, 0.5)]);
  // 07 zoetrope: the drum and its slits
  {
    const p: Poly[] = [circ(0, -0.55, 0.85, 0.22), circ(0, 0.55, 0.85, 0.22, 48, 0, Math.PI)];
    p.push(seg(-0.85, -0.55, -0.85, 0.55), seg(0.85, -0.55, 0.85, 0.55));
    for (let i = 1; i < 12; i++) { const x = -0.85 + (1.7 * i) / 12; p.push(seg(x, -0.5, x, -0.2)); }
    add('ZOETROPE', p);
  }
  // 08 beam: the projector, its beam and the screen
  add('PROJECTION', [rect(-1, -0.15, -0.72, 0.15), seg(-0.72, -0.05, 0.75, -0.6), seg(-0.72, 0.05, 0.75, 0.6), rect(0.75, -0.62, 0.8, 0.62)]);
  // 09 marquee: the board and its bulbs
  {
    const p: Poly[] = [rect(-1, -0.5, 1, 0.5), rect(-0.85, -0.3, 0.85, 0.3)];
    const b: P2[] = [];
    for (let i = 0; i <= 20; i++) { const x = -0.95 + (1.9 * i) / 20; b.push({ x, y: -0.42 }, { x, y: 0.42 }); }
    p.push(...dots(b, 0.02));
    add('MARQUEE', p);
  }
  // 10 sky: brushstrokes across a horizon
  add('MATTE', [seg(-1, 0.6, 1, 0.6), ...[0, 1, 2, 3].map((k) => Array.from({ length: 21 }, (_, i) => ({ x: -0.9 + i * 0.09, y: -0.5 + k * 0.25 + 0.06 * Math.sin(i * 0.7 + k) })))]);
  // 11 murmuration: a swirl of dots
  {
    const b: P2[] = [];
    for (let i = 0; i < 90; i++) { const a = i * 0.37, r = 0.15 + 0.8 * (i / 90); b.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 }); }
    add('MURMURATION', dots(b, 0.018));
  }
  // 12 mix: faders
  {
    const p: Poly[] = [];
    for (let i = 0; i < 7; i++) { const x = -0.84 + i * 0.28, y = -0.5 + 0.9 * Math.abs(Math.sin(i * 1.7)); p.push(seg(x, -0.8, x, 0.8), rect(x - 0.08, y - 0.05, x + 0.08, y + 0.05)); }
    add('MIX', p);
  }
  // 13 stadium: the bowl and the pitch
  add('STADIUM', [circ(0, 0, 1, 0.62), circ(0, 0, 0.8, 0.48), rect(-0.45, -0.25, 0.45, 0.25), seg(0, -0.25, 0, 0.25), circ(0, 0, 0.1)]);
  // 14 edit: three tracks, clips and the razor
  {
    const p: Poly[] = [];
    [-0.45, 0, 0.45].forEach((y, r) => { p.push(seg(-1, y, 1, y)); for (let k = 0; k < 3; k++) { const x0 = -0.95 + k * 0.66 + r * 0.1; p.push(rect(x0, y - 0.14, x0 + 0.5, y + 0.14)); } });
    p.push(seg(0.1, -0.8, 0.1, 0.8));
    add('EDIT', p);
  }
  // 15 nightside: the globe
  {
    const p: Poly[] = [circ(0, 0, 0.92)];
    for (const k of [0.35, 0.7]) p.push(circ(0, 0, 0.92 * k, 0.92, 48));
    for (const y of [-0.5, 0, 0.5]) { const r = Math.sqrt(0.92 ** 2 - y * y); p.push(seg(-r, y, r, y)); }
    add('NIGHTSIDE', p);
  }
  // 16 premiere: a burst over a skyline
  {
    const p: Poly[] = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; p.push(seg(Math.cos(a) * 0.15, -0.3 + Math.sin(a) * 0.15, Math.cos(a) * 0.6, -0.3 + Math.sin(a) * 0.6)); }
    p.push([{ x: -1, y: 0.8 }, { x: -0.7, y: 0.8 }, { x: -0.7, y: 0.45 }, { x: -0.45, y: 0.45 }, { x: -0.45, y: 0.6 }, { x: -0.1, y: 0.6 }, { x: -0.1, y: 0.3 }, { x: 0.1, y: 0.3 }, { x: 0.1, y: 0.55 }, { x: 0.5, y: 0.55 }, { x: 0.5, y: 0.4 }, { x: 0.75, y: 0.4 }, { x: 0.75, y: 0.8 }, { x: 1, y: 0.8 }]);
    add('PREMIERE', p);
  }
  return I;
}
