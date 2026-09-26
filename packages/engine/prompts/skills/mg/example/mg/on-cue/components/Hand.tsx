import type { CSSProperties } from './types';

/**
 * A stagehand in blacks: a flat silhouette with a few joints, the way a real crew disappears against
 * a dark set. GSAP poses the groups (`.oc-hand-torso`, `.oc-hand-arm-f`, `.oc-hand-arm-b`,
 * `.oc-hand-leg-f`, `.oc-hand-leg-b`) with `svgOrigin` at the joints written below.
 * 160 × 380; the feet stand on the bottom edge; faces stage left (viewer's right) by default.
 */
export function Hand({ className = '', style, rim = 'rgba(255,220,170,.35)' }: { className?: string; style?: CSSProperties; rim?: string }) {
  const black = '#0d0c11';
  return (
    <svg className={`oc-abs oc-hand ${className}`} width={160} height={380} viewBox="0 0 160 380" style={{ overflow: 'visible', ...style }}>
      <ellipse cx="80" cy="374" rx="52" ry="7" fill="#000" opacity="0.5" />
      {/* back leg: hip at (74, 240) */}
      <g className="oc-hand-leg-b">
        <path d="M66 236 L60 300 L54 370 L74 372 L80 302 L88 240 Z" fill={black} />
        <path d="M50 366 L78 366 L86 376 L48 376 Z" fill={black} />
      </g>
      {/* front leg: hip at (88, 240) */}
      <g className="oc-hand-leg-f">
        <path d="M80 236 L86 300 L94 370 L114 370 L104 300 L104 240 Z" fill={black} />
        <path d="M92 364 L122 364 L130 374 L90 374 Z" fill={black} />
        <path d="M104 244 L104 300" stroke={rim} strokeWidth="1.2" />
      </g>
      {/* torso: shoulder pivot at (84, 130), hip at (84, 240) */}
      <g className="oc-hand-torso">
        <path d="M60 130 C 56 170, 60 210, 66 244 L 106 244 C 112 210, 116 170, 110 130 Z" fill={black} />
        <path d="M108 132 C 114 170, 112 210, 106 242" stroke={rim} strokeWidth="1.6" fill="none" />
        {/* headset */}
        <circle cx="86" cy="98" r="26" fill={black} />
        <path d="M62 98 C 62 74, 110 74, 110 98" stroke="#2b2d33" strokeWidth="4" fill="none" />
        <rect x="104" y="92" width="10" height="16" rx="3" fill="#2b2d33" />
        <path d="M106 108 L 100 122 L 92 124" stroke="#2b2d33" strokeWidth="3" fill="none" />
        <path d="M100 78 C 108 84, 112 96, 110 108" stroke={rim} strokeWidth="1.4" fill="none" />
        {/* back arm: shoulder at (66, 138) */}
        <g className="oc-hand-arm-b">
          <path d="M58 136 L52 200 L46 250 L62 254 L70 202 L76 140 Z" fill={black} />
          <circle cx="54" cy="254" r="9" fill={black} />
        </g>
        {/* front arm: shoulder at (104, 138) */}
        <g className="oc-hand-arm-f">
          <path d="M96 136 L104 200 L114 250 L130 246 L120 198 L114 140 Z" fill={black} />
          <circle cx="124" cy="250" r="9" fill={black} />
          <path d="M114 142 L 122 198" stroke={rim} strokeWidth="1.2" />
        </g>
      </g>
    </svg>
  );
}

/** Joint positions in the Hand's own coordinates, for `svgOrigin`. */
export const HAND_JOINTS = {
  torso: '84 240',
  armF: '104 138',
  armB: '66 138',
  legF: '92 240',
  legB: '74 240',
} as const;
