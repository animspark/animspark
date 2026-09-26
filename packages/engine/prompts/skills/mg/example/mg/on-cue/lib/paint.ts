import { clamp01, hash, lerp, noise1, noise2 } from './noise';

export type RGB = readonly [number, number, number];

export const rgb = (c: RGB, a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
export const hexToRgb = (hex: string): RGB => {
  const v = hex.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

export function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, font: string, fill: string, align: CanvasTextAlign = 'left', weight = 400): void {
  c.fillStyle = fill;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.font = `${weight} ${size}px ${font}`;
  c.fillText(s, x, y);
}

/**
 * A stage beam: the fixture at (x, y) throws a cone onto the floor pool at (tx, ty) of half-width `radius`.
 * Layered translucent cones read as haze; the outer layers are wider and fainter, so the edge is soft
 * without a canvas filter. `t` drifts a little turbulence through the haze.
 */
export function beam(c: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, radius: number, colour: RGB, alpha: number, t: number, seed = 0): void {
  if (alpha <= 0.002) return;
  const dx = tx - x, dy = ty - y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len; // across the beam
  const layers = 6;
  for (let i = 0; i < layers; i++) {
    const k = i / (layers - 1);
    const w0 = 14 + k * 22; // at the fixture
    const w1 = radius * (0.55 + k * 0.75); // at the floor
    const flicker = 0.85 + 0.3 * noise1(t * 0.9 + i * 3.1, seed);
    const a = alpha * (0.11 - k * 0.075) * flicker;
    const g = c.createLinearGradient(x, y, tx, ty);
    g.addColorStop(0, rgb(colour, a * 1.35));
    g.addColorStop(0.35, rgb(colour, a));
    g.addColorStop(1, rgb(colour, a * 0.25));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x + nx * w0, y + ny * w0);
    c.lineTo(tx + nx * w1, ty + ny * w1);
    c.lineTo(tx - nx * w1, ty - ny * w1);
    c.lineTo(x - nx * w0, y - ny * w0);
    c.closePath();
    c.fill();
  }
}

/** The pool a lamp leaves on the floor: an ellipse squashed by perspective, hot in the middle. */
export function pool(c: CanvasRenderingContext2D, tx: number, ty: number, radius: number, squash: number, colour: RGB, alpha: number): void {
  if (alpha <= 0.002) return;
  c.save();
  c.translate(tx, ty);
  c.scale(1, squash);
  const g = c.createRadialGradient(0, 0, radius * 0.05, 0, 0, radius);
  g.addColorStop(0, rgb(colour, alpha));
  g.addColorStop(0.55, rgb(colour, alpha * 0.55));
  g.addColorStop(1, rgb(colour, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, radius, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Dust drifting inside a cone. Positions are a pure function of time and seed: any seek repaints the same motes. */
export function dust(c: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, radius: number, colour: RGB, alpha: number, t: number, seed: number, count = 46): void {
  if (alpha <= 0.01) return;
  const dx = tx - x, dy = ty - y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  for (let i = 0; i < count; i++) {
    const h = hash(i * 7.13 + seed * 101.7);
    const speed = 0.012 + hash(i + seed) * 0.02;
    const u = (h + t * speed) % 1; // along the beam, 0 at the fixture
    const wobble = (noise1(t * 0.25 + i * 1.7, seed) - 0.5) * 2;
    const spread = lerp(10, radius * 0.75, u) * ((hash(i * 3.3 + seed) - 0.5) * 2 + wobble * 0.25);
    const px = x + dx * u + nx * spread, py = y + dy * u + ny * spread;
    const twinkle = 0.4 + 0.6 * noise1(t * 1.6 + i * 4.3, seed + 5);
    const size = 0.8 + hash(i * 1.9 + seed) * 1.6;
    c.fillStyle = rgb(colour, alpha * twinkle * (0.35 + u * 0.65));
    c.beginPath();
    c.arc(px, py, size, 0, Math.PI * 2);
    c.fill();
  }
}

/** Soft glow around a point (bulb, filament, lens). */
export function glow(c: CanvasRenderingContext2D, x: number, y: number, radius: number, colour: RGB, alpha: number): void {
  if (alpha <= 0.002) return;
  const g = c.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgb(colour, alpha));
  g.addColorStop(0.3, rgb(colour, alpha * 0.45));
  g.addColorStop(1, rgb(colour, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, radius, 0, Math.PI * 2);
  c.fill();
}

/** Film grain / paper fibre: a cached noise tile stamped with low alpha. */
let grainTile: HTMLCanvasElement | undefined;
export function grain(c: CanvasRenderingContext2D, alpha: number, w = 1920, h = 1080): void {
  if (!grainTile) {
    grainTile = document.createElement('canvas');
    grainTile.width = grainTile.height = 256;
    const g = grainTile.getContext('2d')!;
    const img = g.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const n = hash(i * 0.731);
      const v = n > 0.5 ? 255 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = n > 0.93 ? 110 : n < 0.08 ? 70 : 0;
    }
    g.putImageData(img, 0, 0);
  }
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = c.createPattern(grainTile, 'repeat')!;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/** Value-noise texture in a rectangle: wood, plaster, fabric — tinted between two colours. */
export function mottle(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell: number, a: RGB, b: RGB, alpha: number, seed: number, sx = 1, sy = 1): void {
  c.save();
  c.globalAlpha = alpha;
  for (let py = 0; py < h; py += cell) {
    for (let px = 0; px < w; px += cell) {
      const n = noise2((x + px) / (cell * 4) * sx, (y + py) / (cell * 4) * sy, seed);
      c.fillStyle = rgb(mixRgb(a, b, clamp01(n)));
      c.fillRect(x + px, y + py, cell + 0.5, cell + 0.5);
    }
  }
  c.restore();
}
