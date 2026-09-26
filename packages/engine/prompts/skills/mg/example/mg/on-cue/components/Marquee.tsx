import { ink } from '../theme';
import type { CSSProperties } from './types';

/**
 * Marquee letters: channel letters built from stroke paths, with bulbs set along the stroke.
 * The word is the recurring object of the film, so it is a real object: a metal channel with a
 * return, a bulb every unit of stroke, each bulb with its own glow. `--lit` on a letter group runs
 * 0 → 1 and GSAP tweens it; bulbs can also light one at a time through `.oc-mq-bulb`.
 */
type Pt = readonly [number, number];
const GLYPHS: Record<string, readonly (readonly Pt[])[]> = {
  S: [[[3.6, 0.5], [2.4, 0], [1.2, 0.1], [0.4, 1], [0.5, 2.2], [1.6, 2.9], [2.8, 3.3], [3.6, 4.2], [3.4, 5.4], [2.2, 6], [1, 5.9], [0.3, 5.3]]],
  T: [[[0, 0.2], [4, 0.2]], [[2, 0.2], [2, 6]]],
  A: [[[0, 6], [2, 0.1], [4, 6]], [[0.9, 3.9], [3.1, 3.9]]],
  G: [[[3.7, 1.2], [2.9, 0.3], [1.1, 0.3], [0.3, 1.4], [0.3, 4.6], [1.1, 5.7], [2.9, 5.7], [3.7, 4.7], [3.7, 3.3], [2.2, 3.3]]],
  E: [[[3.8, 0.2], [0.2, 0.2], [0.2, 5.8], [3.8, 5.8]], [[0.2, 3], [3, 3]]],
  C: [[[3.7, 1.3], [2.9, 0.3], [1.1, 0.3], [0.3, 1.4], [0.3, 4.6], [1.1, 5.7], [2.9, 5.7], [3.7, 4.7]]],
  N: [[[0.2, 6], [0.2, 0.1], [3.8, 6], [3.8, 0.1]]],
  U: [[[0.2, 0.1], [0.2, 4.6], [1.1, 5.8], [2.9, 5.8], [3.8, 4.6], [3.8, 0.1]]],
  R: [[[0.2, 6], [0.2, 0.2], [2.9, 0.2], [3.8, 1.1], [3.8, 2.5], [2.9, 3.4], [0.2, 3.4]], [[1.8, 3.4], [3.8, 6]]],
  K: [[[0.2, 0.1], [0.2, 6]], [[3.8, 0.1], [0.4, 3.5]], [[1.4, 2.6], [3.8, 6]]],
  O: [[[1.1, 0.3], [2.9, 0.3], [3.8, 1.4], [3.8, 4.6], [2.9, 5.7], [1.1, 5.7], [0.2, 4.6], [0.2, 1.4], [1.1, 0.3]]],
};

const GLYPH_W = 4, GLYPH_H = 6, GAP = 1.3;

function bulbsAlong(lines: readonly (readonly Pt[])[], spacing: number): Pt[] {
  const out: Pt[] = [];
  for (const line of lines) {
    let carry = 0;
    out.push(line[0]!);
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!;
      const len = Math.hypot(bx - ax, by - ay);
      let d = spacing - carry;
      while (d < len) {
        out.push([ax + (bx - ax) * (d / len), ay + (by - ay) * (d / len)]);
        d += spacing;
      }
      carry = len - (d - spacing);
    }
  }
  // Drop bulbs that landed on top of each other where strokes meet.
  return out.filter((p, i) => out.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < spacing * 0.55) === i);
}

export function marqueeWidth(word: string, unit: number): number {
  return (word.length * GLYPH_W + (word.length - 1) * GAP) * unit;
}

export function Marquee({ word, unit = 22, className = '', style, chain = 0, lit = 0 }: {
  word: string;
  /** Pixel size of one glyph unit; a glyph is 4 × 6 units. */
  unit?: number;
  className?: string;
  style?: CSSProperties;
  /** Length of the hanging chains above the rail, in px (0 = none). */
  chain?: number;
  /** Initial `--lit` of every letter, 0..1. */
  lit?: number;
}) {
  const w = marqueeWidth(word, unit), h = GLYPH_H * unit;
  const pad = unit * 1.2;
  const railY = -unit * 0.9;
  const id = `mq-${word.toLowerCase()}`;
  return (
    <svg className={`oc-abs oc-marquee-svg ${className}`} width={w + pad * 2} height={h + pad + chain + unit * 1.4}
      viewBox={`${-pad} ${-(chain + unit * 1.4)} ${w + pad * 2} ${h + pad + chain + unit * 1.4}`} style={{ overflow: 'visible', ...style }}>
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="#ffd9a0" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#ffb457" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ff9a2e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-chan`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ink.metalHi} />
          <stop offset="0.5" stopColor={ink.metal} />
          <stop offset="1" stopColor="#15161a" />
        </linearGradient>
      </defs>
      {chain > 0 && (
        <g stroke={ink.metalHi} strokeWidth={unit * 0.07} opacity="0.45">
          <line x1={unit * 0.6} y1={-(chain + unit * 1.2)} x2={unit * 0.6} y2={railY} strokeDasharray={`${unit * 0.22} ${unit * 0.12}`} />
          <line x1={w - unit * 0.6} y1={-(chain + unit * 1.2)} x2={w - unit * 0.6} y2={railY} strokeDasharray={`${unit * 0.22} ${unit * 0.12}`} />
        </g>
      )}
      {/* The rail the letters are bolted to. */}
      <rect x={-unit * 0.4} y={railY - unit * 0.2} width={w + unit * 0.8} height={unit * 0.4} rx={unit * 0.08} fill={`url(#${id}-chan)`} />
      <rect x={-unit * 0.4} y={railY - unit * 0.2} width={w + unit * 0.8} height={unit * 0.08} fill={ink.brassLo} opacity="0.8" />
      {word.split('').map((ch, i) => {
        const lines = GLYPHS[ch] ?? GLYPHS.O!;
        const ox = i * (GLYPH_W + GAP) * unit;
        const d = lines.map((line) => line.map(([x, y], k) => `${k ? 'L' : 'M'}${(ox + x * unit).toFixed(1)} ${(y * unit).toFixed(1)}`).join(' ')).join(' ');
        const bulbs = bulbsAlong(lines, 1.05);
        return (
          <g key={i} className={`oc-mq-letter oc-mq-letter-${i}`} style={{ ['--lit' as string]: lit }}>
            {/* Channel body, its return and the brass lip on top. */}
            <path d={d} fill="none" stroke="#0b0b0e" strokeWidth={unit * 1.55} strokeLinecap="round" strokeLinejoin="round" opacity="0.9" transform={`translate(${unit * 0.12} ${unit * 0.16})`} />
            <path d={d} fill="none" stroke={`url(#${id}-chan)`} strokeWidth={unit * 1.45} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke="#0e0f12" strokeWidth={unit * 1.02} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke={ink.brass} strokeWidth={unit * 1.45} strokeLinecap="round" strokeLinejoin="round" opacity="0.18" strokeDasharray={`${unit * 0.9} ${unit * 2.2}`} />
            {/* Bulbs: glow first, then glass. */}
            {bulbs.map(([x, y], k) => (
              <circle key={`g${k}`} className="oc-mq-glow" cx={ox + x * unit} cy={y * unit} r={unit * 0.62} fill={`url(#${id}-glow)`} style={{ opacity: 'calc(var(--lit) * 0.85)' }} />
            ))}
            {bulbs.map(([x, y], k) => (
              <circle key={`b${k}`} className="oc-mq-bulb" cx={ox + x * unit} cy={y * unit} r={unit * 0.27}
                style={{ fill: `color-mix(in srgb, #3a3320, #fff6dc calc(var(--lit) * 100%))`, stroke: '#14120e', strokeWidth: unit * 0.06 }} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
