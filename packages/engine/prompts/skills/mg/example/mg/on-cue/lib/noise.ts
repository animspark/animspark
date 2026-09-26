/** Deterministic randomness: the same seed paints the same dust on every seek and in every export. */
export const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export const hash2 = (x: number, y: number): number => hash(x * 157.31 + y * 0.6180339 + 71.3);

/** Smooth 1-D value noise in 0..1. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i + seed * 91.7) * (1 - u) + hash(i + 1 + seed * 91.7) * u;
}

/** Smooth 2-D value noise in 0..1. */
export function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix + seed, iy), b = hash2(ix + 1 + seed, iy), c = hash2(ix + seed, iy + 1), d = hash2(ix + 1 + seed, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (u: number): number => { const v = clamp01(u); return v * v * (3 - 2 * v); };
/** 0 before `a`, 1 after `b`, smooth between. */
export const ramp = (t: number, a: number, b: number): number => smooth((t - a) / (b - a));
