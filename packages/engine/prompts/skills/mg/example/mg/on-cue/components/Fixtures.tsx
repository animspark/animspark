import { ink } from '../theme';
import type { CSSProperties, Key } from './types';

/**
 * Lighting fixtures the audience can see. The light itself is painted by the rig; these are the
 * objects that throw it, so a beam always starts at a thing.
 */

/** A caged work bulb on a pole with a wheeled base: the ghost light left on in an empty theatre. */
export function Ghostlight({ className = '', style, lit = 0 }: { className?: string; style?: CSSProperties; lit?: number }) {
  // 120 × 420 box; the bulb centre is at (60, 46).
  return (
    <svg className={`oc-abs ${className}`} width={120} height={420} viewBox="0 0 120 420" style={{ overflow: 'visible', ...style }}>
      <defs>
        <linearGradient id="gl-pole" x1="0" x2="1">
          <stop offset="0" stopColor="#3a3d45" /><stop offset="0.45" stopColor="#8a8f9a" /><stop offset="1" stopColor="#23252b" />
        </linearGradient>
        <radialGradient id="gl-bulb" cx="0.4" cy="0.35">
          <stop offset="0" stopColor="#fff6dc" /><stop offset="0.6" stopColor="#ffcf7a" /><stop offset="1" stopColor="#c98a2c" />
        </radialGradient>
      </defs>
      {/* base: a plate on three castors */}
      <ellipse cx="60" cy="404" rx="52" ry="11" fill="#151619" />
      <ellipse cx="60" cy="398" rx="50" ry="10" fill="url(#gl-pole)" />
      <circle cx="22" cy="406" r="7" fill="#1c1d21" /><circle cx="98" cy="406" r="7" fill="#1c1d21" /><circle cx="60" cy="412" r="7" fill="#1c1d21" />
      {/* pole */}
      <rect x="54" y="80" width="12" height="320" fill="url(#gl-pole)" />
      <rect x="50" y="240" width="20" height="14" rx="2" fill="#2b2d33" />
      {/* socket and cage */}
      <rect x="48" y="66" width="24" height="22" rx="3" fill="#2a2c32" />
      <path d="M60 10 C 30 10, 22 40, 22 66 L 98 66 C 98 40, 90 10, 60 10 Z" fill="none" stroke="#6b6f78" strokeWidth="2.2" />
      {[34, 46, 60, 74, 86].map((x) => <path key={x} d={`M${x} ${x === 60 ? 10 : 16} L ${x} 66`} stroke="#6b6f78" strokeWidth="1.8" fill="none" />)}
      <path d="M26 44 Q 60 32 94 44" stroke="#6b6f78" strokeWidth="1.6" fill="none" />
      {/* the bulb */}
      <ellipse cx="60" cy="46" rx="15" ry="19" fill="url(#gl-bulb)" className="oc-gl-bulb" style={{ opacity: 0.35 + lit * 0.65 }} />
      <path d="M52 52 Q 60 36 68 52" stroke="#fff3cf" strokeWidth="1.2" fill="none" opacity={0.5 + lit * 0.5} />
    </svg>
  );
}

/**
 * A stage lantern hung from a batten: clamp, yoke, can, lens with a gel frame and barn doors.
 * `--lit` runs the lens. The rig draws the beam from the lens point (bottom centre of the can).
 */
export function Lantern({ className = '', style, gel = ink.brass, tilt = 0 }: { className?: string; style?: CSSProperties; gel?: string; tilt?: number; key?: Key }) {
  // 96 × 120 box, hangs from (48, 0); lens at roughly (48, 108).
  return (
    <svg className={`oc-abs ${className}`} width={96} height={124} viewBox="0 0 96 124" style={{ overflow: 'visible', ['--lit' as string]: 0, ...style }}>
      <defs>
        <linearGradient id="lt-can" x1="0" x2="1">
          <stop offset="0" stopColor="#1a1b1f" /><stop offset="0.35" stopColor="#4a4e58" /><stop offset="0.6" stopColor="#2a2c32" /><stop offset="1" stopColor="#111216" />
        </linearGradient>
      </defs>
      {/* clamp and yoke */}
      <rect x="40" y="0" width="16" height="10" rx="2" fill="#3b3e46" />
      <rect x="44" y="8" width="8" height="10" fill="#2a2c32" />
      <path d="M14 18 L14 60 M82 18 L82 60 M14 18 L82 18" stroke="#3f434c" strokeWidth="5" fill="none" strokeLinecap="round" />
      <g transform={`rotate(${tilt} 48 60)`}>
        {/* can */}
        <rect x="22" y="30" width="52" height="66" rx="8" fill="url(#lt-can)" />
        <rect x="22" y="30" width="52" height="8" rx="3" fill="#5a5e68" opacity="0.8" />
        <circle cx="48" cy="60" r="5" fill="#111" stroke="#666b76" strokeWidth="2" />
        {/* gel frame and lens */}
        <rect x="16" y="92" width="64" height="12" rx="2" fill="#26282e" />
        <rect x="20" y="95" width="56" height="6" fill={gel} opacity="0.55" />
        <ellipse cx="48" cy="104" rx="26" ry="7" style={{ fill: `color-mix(in srgb, #2b2a24, #fff3d0 calc(var(--lit) * 100%))` }} />
        {/* barn doors */}
        <path d="M18 100 L6 118 L20 118 Z" fill="#1c1d21" />
        <path d="M78 100 L90 118 L76 118 Z" fill="#1c1d21" />
        <path d="M22 104 L74 104 L70 112 L26 112 Z" fill="#202126" opacity="0.9" />
      </g>
    </svg>
  );
}

/** A small cue light on the stage manager's desk: standby red, go green. */
export function CueLight({ className = '', style }: { className?: string; style?: CSSProperties }) {
  // 150 × 90; two lamps, `--red` and `--green` run 0 → 1
  return (
    <svg className={`oc-abs ${className}`} width={150} height={90} viewBox="0 0 150 90" style={{ overflow: 'visible', ['--red' as string]: 0, ['--green' as string]: 0, ...style }}>
      <defs>
        <radialGradient id="cl-red"><stop offset="0" stopColor="#ff7b6f" /><stop offset="0.5" stopColor="#ff4136" stopOpacity="0.5" /><stop offset="1" stopColor="#ff4136" stopOpacity="0" /></radialGradient>
        <radialGradient id="cl-green"><stop offset="0" stopColor="#b7ffd0" /><stop offset="0.5" stopColor="#38e07f" stopOpacity="0.5" /><stop offset="1" stopColor="#38e07f" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="4" y="24" width="142" height="60" rx="6" fill="#24262c" />
      <rect x="4" y="24" width="142" height="6" rx="3" fill="#565a64" opacity="0.7" />
      <rect x="10" y="70" width="130" height="8" fill="#15161a" />
      <text x="75" y="80" textAnchor="middle" fontFamily='"Barlow Condensed", sans-serif' fontWeight="600" fontSize="7" fill="#9aa0ac" letterSpacing="1.4">STANDBY · GO</text>
      <circle cx="45" cy="50" r="34" fill="url(#cl-red)" style={{ opacity: 'var(--red)' }} />
      <circle cx="105" cy="50" r="34" fill="url(#cl-green)" style={{ opacity: 'var(--green)' }} />
      <circle cx="45" cy="50" r="15" style={{ fill: `color-mix(in srgb, #3a1512, #ff5a4e calc(var(--red) * 100%))`, stroke: '#0f0f12', strokeWidth: 3 }} />
      <circle cx="105" cy="50" r="15" style={{ fill: `color-mix(in srgb, #12301c, #4cf08f calc(var(--green) * 100%))`, stroke: '#0f0f12', strokeWidth: 3 }} />
      <path d="M36 42 Q45 36 54 42" stroke="#fff" strokeWidth="1.5" fill="none" style={{ opacity: 'calc(0.15 + var(--red) * 0.5)' }} />
      <path d="M96 42 Q105 36 114 42" stroke="#fff" strokeWidth="1.5" fill="none" style={{ opacity: 'calc(0.15 + var(--green) * 0.5)' }} />
    </svg>
  );
}
