import { ink, type } from '../theme';
import type { CSSProperties } from './types';

/**
 * Set dressing that recurs: the props crate, the prompt-corner desk. Built once, posed everywhere.
 * Each is drawn at one size in world px; the floor's depth scale and the lens make it larger or smaller.
 */

/** A wooden props crate in three-quarter view. 240 wide, 200 tall; stands on its bottom edge. */
export function Crate({ className = '', style, stencil = 'PROPS' }: { className?: string; style?: CSSProperties; stencil?: string }) {
  return (
    <svg className={`oc-abs ${className}`} width={240} height={200} viewBox="0 0 240 200" style={{ overflow: 'visible', ...style }}>
      <defs>
        <linearGradient id="cr-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a8783f" /><stop offset="1" stopColor="#7a5124" /></linearGradient>
        <linearGradient id="cr-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5c3b18" /><stop offset="1" stopColor="#3f2810" /></linearGradient>
        <linearGradient id="cr-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c99a5c" /><stop offset="1" stopColor="#a67a3f" /></linearGradient>
      </defs>
      {/* contact shadow */}
      <ellipse cx="120" cy="196" rx="120" ry="9" fill="#000" opacity="0.45" />
      {/* side */}
      <path d="M186 42 L226 22 L226 168 L186 194 Z" fill="url(#cr-side)" />
      {[0, 1, 2, 3].map((i) => <path key={i} d={`M186 ${58 + i * 34} L226 ${38 + i * 34}`} stroke="#2e1c0a" strokeWidth="2" opacity="0.7" />)}
      {/* top */}
      <path d="M14 42 L54 22 L226 22 L186 42 Z" fill="url(#cr-top)" />
      <path d="M30 40 L66 24 M86 40 L122 24 M142 40 L178 24" stroke="#7a5124" strokeWidth="1.5" opacity="0.8" />
      {/* front planks */}
      <rect x="14" y="42" width="172" height="152" fill="url(#cr-front)" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x="14" y={42 + i * 38} width="172" height="3" fill="#4a2f12" opacity="0.8" />)}
      {[0, 1, 2, 3].map((i) => <rect key={`h${i}`} x="14" y={45 + i * 38} width="172" height="1.5" fill="#d9ab6c" opacity="0.35" />)}
      {/* wood grain */}
      {[0, 1, 2, 3].map((i) => (
        <path key={`g${i}`} d={`M20 ${60 + i * 38} q 40 -6 80 0 t 80 2`} stroke="#5c3b18" strokeWidth="1" fill="none" opacity="0.45" />
      ))}
      {/* corner braces */}
      {[[14, 42], [166, 42], [14, 174], [166, 174]].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="20" height="20" fill="#2b2d33" />
          <rect x={x + 2} y={y + 2} width="16" height="16" fill="none" stroke="#6a6e78" strokeWidth="1" />
          <circle cx={x + 10} cy={y + 10} r="2.5" fill="#8a8f9a" />
        </g>
      ))}
      <rect x="14" y="42" width="172" height="152" fill="none" stroke="#2b1a08" strokeWidth="2" />
      {/* rope handle */}
      <path d="M60 78 Q 100 110 140 78" stroke="#c6b28a" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M60 78 Q 100 110 140 78" stroke="#8b7a55" strokeWidth="2" fill="none" strokeDasharray="4 4" />
      <circle cx="60" cy="78" r="5" fill="#2b2d33" /><circle cx="140" cy="78" r="5" fill="#2b2d33" />
      {/* stencil */}
      <text x="100" y="152" textAnchor="middle" fontFamily={type.label} fontWeight="600" fontSize="34" fill="#2a2830" opacity="0.85" letterSpacing="3">{stencil}</text>
      <text x="100" y="176" textAnchor="middle" fontFamily={type.label} fontWeight="600" fontSize="12" fill="#2a2830" opacity="0.7" letterSpacing="2">ON CUE · No. 04</text>
      <path d="M40 126 L160 126" stroke="#2a2830" strokeWidth="1.2" opacity="0.5" />
    </svg>
  );
}

/**
 * The prompt corner: the stage manager's desk with a clip lamp, headset and the prompt book.
 * 520 wide, 300 tall; stands on its legs. The book and the cue light are separate components
 * laid on the desk top by the scene, so they can be posed and read closely.
 */
export function Desk({ className = '', style, lamp = 0 }: { className?: string; style?: CSSProperties; lamp?: number }) {
  return (
    <svg className={`oc-abs ${className}`} width={520} height={300} viewBox="0 0 520 300" style={{ overflow: 'visible', ['--lamp' as string]: lamp, ...style }}>
      <defs>
        <linearGradient id="dk-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a3226" /><stop offset="1" stopColor="#2a241b" /></linearGradient>
        <linearGradient id="dk-edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5a4a35" /><stop offset="1" stopColor="#2a2119" /></linearGradient>
        <radialGradient id="dk-lampglow"><stop offset="0" stopColor="#ffe6b0" stopOpacity="0.95" /><stop offset="0.4" stopColor="#ffcf7a" stopOpacity="0.35" /><stop offset="1" stopColor="#ffb457" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="260" cy="294" rx="250" ry="10" fill="#000" opacity="0.45" />
      {/* legs */}
      <rect x="40" y="150" width="14" height="140" fill="#1e1a14" /><rect x="466" y="150" width="14" height="140" fill="#1e1a14" />
      <rect x="40" y="230" width="440" height="8" fill="#1e1a14" />
      {/* top: a padded black desk with a felt inlay */}
      <path d="M0 140 L520 140 L500 160 L20 160 Z" fill="url(#dk-edge)" />
      <rect x="20" y="118" width="480" height="30" rx="3" fill="url(#dk-top)" />
      <rect x="34" y="122" width="452" height="22" rx="2" fill="#1f2a1e" opacity="0.9" />
      {/* clip lamp on a gooseneck, aimed at the book */}
      <path d="M470 120 C 470 60, 430 40, 360 46" stroke="#3b3e46" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M470 120 C 470 60, 430 40, 360 46" stroke="#7b808c" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M362 30 L330 62 L372 78 L396 44 Z" fill="#26282e" />
      <path d="M330 62 L372 78 L360 84 L322 68 Z" fill="#111216" />
      <ellipse cx="346" cy="73" rx="26" ry="8" transform="rotate(20 346 73)" style={{ fill: `color-mix(in srgb, #3a3320, #fff0c8 calc(var(--lamp) * 100%))` }} />
      <circle cx="330" cy="90" r="120" fill="url(#dk-lampglow)" style={{ opacity: 'var(--lamp)', mixBlendMode: 'screen' }} />
      {/* headset hanging on a hook */}
      <path d="M62 60 C 40 80, 40 110, 62 118 M62 60 C 84 80, 84 110, 62 118" stroke="#1a1b1f" strokeWidth="7" fill="none" strokeLinecap="round" />
      <rect x="50" y="98" width="24" height="22" rx="6" fill="#2b2d33" /><rect x="52" y="60" width="20" height="18" rx="6" fill="#2b2d33" />
      <path d="M50 118 L44 130 L30 132" stroke="#2b2d33" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="56" y="48" width="12" height="8" fill="#5a5e68" />
      {/* a pencil pot at the far end */}
      <rect x="496" y="92" width="22" height="34" rx="3" fill="#2b2d33" />
      <path d="M500 92 L498 68 M506 92 L508 64 M513 92 L516 70" stroke={ink.pencil} strokeWidth="3" strokeLinecap="round" />
      <path d="M506 92 L508 64" stroke={ink.red} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
