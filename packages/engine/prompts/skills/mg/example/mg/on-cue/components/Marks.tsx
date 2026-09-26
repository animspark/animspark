import { ink, type } from '../theme';
import { floor, type FloorPoint } from '../lib/stage';
import type { CSSProperties, Children, Key } from './types';

/**
 * Working marks: chalk strokes, spike tape, pencil. They are how the crew writes on the stage, so the
 * film's annotations use them too: a chalk frame is a real mark on a real floor, not a UI overlay.
 */

/** Shared chalk filter; mount once per scene (inside any svg) and refer to it as url(#oc-chalk). */
export function ChalkDefs() {
  return (
    <svg className="oc-abs" width={1} height={1} style={{ overflow: 'visible' }}>
      <defs>
        <filter id="oc-chalk" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9 0.6" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="1" seed="3" result="m" />
          <feComponentTransfer in="m" result="mask"><feFuncA type="linear" slope="1.6" intercept="0.05" /></feComponentTransfer>
          <feComposite in="d" in2="mask" operator="in" />
        </filter>
        <filter id="oc-chalk-soft" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * A chalk stroke along an SVG path in world px. `pathLength="1"` normalises the dash, so GSAP draws it
 * with `strokeDashoffset: 1 → 0` regardless of the path's real length.
 */
export function Chalk({ d, width = 4, className = '', colour = ink.chalk, opacity = 0.9, drawn = 0 }: {
  d: string; width?: number; className?: string; colour?: string; opacity?: number; drawn?: number;
}) {
  return (
    <svg className={`oc-abs ${className}`} width={1920} height={1080} viewBox="0 0 1920 1080" style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <g filter="url(#oc-chalk)">
        <path className="oc-chalk-line" d={d} fill="none" stroke={colour} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity}
          pathLength={1} strokeDasharray="1" strokeDashoffset={1 - drawn} />
        <path className="oc-chalk-line" d={d} fill="none" stroke={colour} strokeWidth={width * 0.45} strokeLinecap="round" strokeLinejoin="round" opacity={opacity * 0.6}
          pathLength={1} strokeDasharray="1" strokeDashoffset={1 - drawn} transform="translate(1.5 -1)" />
      </g>
    </svg>
  );
}

/** Chalk handwriting on the cyc or the floor. */
export function ChalkText({ x, y, size = 40, children, className = '', align = 'start', rotate = 0, colour = ink.chalk, font = type.hand, weight = 400, opacity = 0.92 }: {
  x: number; y: number; size?: number; children: Children; className?: string; align?: 'start' | 'middle' | 'end'; rotate?: number; colour?: string; font?: string; weight?: number; opacity?: number;
}) {
  return (
    <svg className={`oc-abs ${className}`} width={1920} height={1080} viewBox="0 0 1920 1080" style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <text x={x} y={y} fontFamily={font} fontWeight={weight} fontSize={size} fill={colour} textAnchor={align} opacity={opacity}
        filter="url(#oc-chalk-soft)" transform={`rotate(${rotate} ${x} ${y})`}>{children}</text>
    </svg>
  );
}

/** Path helper: a polygon on the floor from stage coordinates. */
export function floorPath(points: readonly (readonly [number, number])[], close = true): string {
  const d = points.map(([sx, sz], i) => { const p = floor(sx, sz); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join(' ');
  return close ? `${d} Z` : d;
}

/**
 * A pencil, its tip exactly at the wrapper's origin, its body leaving at `angle` degrees (0 = right,
 * positive = down). `length` in px; GSAP moves the wrapper, so wherever the wrapper is placed, that is
 * where the tip writes. The viewBox starts at 0 0 for that reason; the body overflows and is visible.
 */
export function PencilProp({ className = '', colour = ink.pencil, length = 200, angle = -38, style }: { className?: string; colour?: string; length?: number; angle?: number; style?: CSSProperties }) {
  const w = length * 0.11;
  return (
    <svg className={`oc-abs ${className}`} width={length + 20} height={w * 3} viewBox={`0 0 ${length + 20} ${w * 3}`} style={{ overflow: 'visible', transformOrigin: '0 0', ...style }}>
      <g transform={`rotate(${angle})`}>
        <polygon points={`0,0 ${w * 1.6},${-w / 2} ${w * 1.6},${w / 2}`} fill="#2a2830" />
        <polygon points={`${w * 1.6},${-w / 2} ${w * 3.4},${-w / 2} ${w * 3.4},${w / 2} ${w * 1.6},${w / 2}`} fill="#e7d3ad" />
        <rect className="oc-pen-body" x={w * 3.4} y={-w / 2} width={length - w * 3.4} height={w} fill={colour} />
        <rect x={w * 3.4} y={-w / 2} width={length - w * 3.4} height={w * 0.28} fill="#fff" opacity="0.25" />
        <rect x={w * 3.4} y={w * 0.22} width={length - w * 3.4} height={w * 0.28} fill="#000" opacity="0.28" />
        <rect x={length - w * 1.6} y={-w / 2} width={w * 0.9} height={w} fill="#c9a052" />
        <rect x={length - w * 0.7} y={-w / 2} width={w * 0.7} height={w} rx={w * 0.2} fill="#e88a8a" />
      </g>
    </svg>
  );
}

/** A spike mark: two strips of tape in a T, with a letter written on in marker. */
export function Spike({ at, label, className = '', colour = ink.tape, angle = 0 }: { at: FloorPoint; label?: string; className?: string; colour?: string; angle?: number; key?: Key }) {
  const s = at.scale;
  return (
    <div className={`oc-abs ${className}`} style={{ left: at.x, top: at.y, width: 0, height: 0 }}>
      <svg width={160} height={90} viewBox="-80 -60 160 90" style={{ position: 'absolute', left: -80, top: -60, overflow: 'visible', transform: `scale(${s}) rotate(${angle}deg)`, transformOrigin: '80px 60px' }}>
        <g transform="scale(1 0.45)">
          <rect x="-46" y="-12" width="92" height="22" rx="1" fill={colour} transform="rotate(-3)" opacity="0.95" />
          <rect x="-11" y="-6" width="22" height="70" rx="1" fill={colour} transform="rotate(2)" opacity="0.95" />
          <rect x="-46" y="-12" width="92" height="5" fill="#fff" opacity="0.18" transform="rotate(-3)" />
          {label && <text x="0" y="4" textAnchor="middle" fontFamily={type.label} fontWeight="600" fontSize="22" fill={ink.graphite} transform="rotate(-3)">{label}</text>}
        </g>
      </svg>
    </div>
  );
}
