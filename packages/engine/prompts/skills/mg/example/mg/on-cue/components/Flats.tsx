import { ink, type } from '../theme';
import type { CSSProperties, Children, Key } from './types';

/**
 * Painted flats: the set pieces the crew builds once. Each is a wooden stretcher with a canvas face,
 * hung from a batten by two lines. The three that fly in during 03 carry the film's own theme:
 * its palette, its typefaces and its surfaces, so the set that is "built once" is literally this one.
 */
export function Flat({ width = 300, height = 380, children, className = '', style, label }: { width?: number; height?: number; children?: Children; className?: string; style?: CSSProperties; label?: string; key?: Key }) {
  return (
    <div className={`oc-abs oc-flat ${className}`} style={{ width, height, ...style }}>
      {/* lines to the batten */}
      <div className="oc-abs" style={{ left: 22, top: -2000, width: 2, height: 2000, background: 'linear-gradient(180deg, rgba(160,150,130,0), rgba(160,150,130,.55) 40%)' }} />
      <div className="oc-abs" style={{ left: width - 24, top: -2000, width: 2, height: 2000, background: 'linear-gradient(180deg, rgba(160,150,130,0), rgba(160,150,130,.55) 40%)' }} />
      {/* stretcher */}
      <div className="oc-abs" style={{ left: -10, top: -10, width: width + 20, height: height + 20, background: `linear-gradient(90deg, ${ink.oakLo}, ${ink.oak} 12%, ${ink.oakLo} 100%)`, boxShadow: '0 18px 40px rgba(0,0,0,.55)' }} />
      <div className="oc-abs" style={{ left: -10, top: -10, width: width + 20, height: 10, background: `linear-gradient(180deg, ${ink.oakHi}, ${ink.oak})` }} />
      {/* canvas */}
      <div className="oc-abs" style={{ left: 0, top: 0, width, height, background: '#e8dcc3', backgroundImage: 'repeating-linear-gradient(90deg, rgba(90,70,40,.06) 0 1px, transparent 1px 4px), repeating-linear-gradient(0deg, rgba(90,70,40,.05) 0 1px, transparent 1px 3px)', overflow: 'hidden' }}>
        {children}
      </div>
      {label && <Tag style={{ left: width / 2 - 62, top: height + 16 }}>{label}</Tag>}
    </div>
  );
}

/** A brass tag with engraved lettering. 124 × 26. */
export function Tag({ children, className = '', style }: { children: Children; className?: string; style?: CSSProperties }) {
  return (
    <div className={`oc-abs oc-tag oc-label ${className}`} style={{ width: 124, height: 26, borderRadius: 3, background: `linear-gradient(180deg, ${ink.brassHi}, ${ink.brass} 40%, ${ink.brassLo})`, color: '#2a1e08', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 0 rgba(255,255,255,.4) inset, 0 2px 4px rgba(0,0,0,.6)', letterSpacing: 2, ...style }}>
      <span style={{ position: 'absolute', left: 6, top: 10, width: 5, height: 5, borderRadius: 3, background: '#4a3510' }} />
      <span style={{ position: 'absolute', right: 6, top: 10, width: 5, height: 5, borderRadius: 3, background: '#4a3510' }} />
      {children}
    </div>
  );
}

const SWATCHES = [
  ['house', ink.house], ['velvet', ink.velvet], ['oak', ink.oak], ['brass', ink.brass],
  ['chalk', ink.chalk], ['amber', '#ffaa52'], ['steel', '#6896ec'],
] as const;

/** The palette flat: paint chips fanned on a nail, each labelled. */
export function PaletteArt() {
  return (
    <div className="oc-abs" style={{ inset: 0 }}>
      <div className="oc-label" style={{ position: 'absolute', left: 20, top: 18, fontSize: 14, color: ink.graphite, opacity: 0.75 }}>PALETTE</div>
      <div className="oc-hand" style={{ position: 'absolute', left: 20, top: 40, fontSize: 18, color: ink.pencil }}>seven colours, each with a job</div>
      {SWATCHES.map(([name, colour], i) => (
        <div key={name} className={`oc-chip oc-chip-${i}`} style={{ position: 'absolute', left: 34, top: 110, width: 62, height: 200, transformOrigin: '31px 12px', transform: `rotate(${-42 + i * 14}deg)`, background: colour, borderRadius: 4, boxShadow: '0 3px 8px rgba(0,0,0,.35)', border: '1px solid rgba(0,0,0,.25)' }}>
          <span className="oc-label" style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 10, color: i >= 4 ? ink.graphite : ink.chalk, letterSpacing: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{name}</span>
        </div>
      ))}
      <div style={{ position: 'absolute', left: 60, top: 118, width: 10, height: 10, borderRadius: 5, background: '#2b2d33', boxShadow: '0 1px 2px rgba(0,0,0,.6)' }} />
      <div className="oc-type" style={{ position: 'absolute', left: 20, bottom: 18, fontSize: 11, color: ink.graphite, opacity: 0.7 }}>theme.ts → ink</div>
    </div>
  );
}

const FACES = [
  ['Bungee', type.marquee, 'MARQUEE', 400],
  ['Playfair Display', type.display, 'Titles', 700],
  ['Barlow Condensed', type.label, 'LABELS', 600],
  ['Special Elite', type.typewriter, 'prompt book', 400],
  ['Kalam', type.hand, 'pencil notes', 400],
] as const;

/** The typeface flat: a specimen sheet of the five faces the film uses. */
export function TypeArt() {
  return (
    <div className="oc-abs" style={{ inset: 0 }}>
      <div className="oc-label" style={{ position: 'absolute', left: 20, top: 18, fontSize: 14, color: ink.graphite, opacity: 0.75 }}>TYPEFACE</div>
      <div className="oc-hand" style={{ position: 'absolute', left: 20, top: 40, fontSize: 18, color: ink.pencil }}>five voices, one cast</div>
      <div className="oc-face oc-face-big" style={{ position: 'absolute', left: 18, top: 62, fontFamily: type.marquee, fontSize: 118, lineHeight: 1, color: ink.graphite }}>Aa</div>
      <div className="oc-face oc-face-big" style={{ position: 'absolute', left: 178, top: 74, fontFamily: type.display, fontWeight: 700, fontSize: 104, lineHeight: 1, color: ink.velvet }}>Aa</div>
      {FACES.map(([name, family, sample, weight], i) => (
        <div key={name} className={`oc-face oc-face-${i}`} style={{ position: 'absolute', left: 20, top: 198 + i * 34, width: 260, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid rgba(42,40,48,.2)', paddingBottom: 3 }}>
          <span style={{ fontFamily: family, fontWeight: weight, fontSize: i === 0 ? 17 : 20, color: ink.graphite }}>{sample}</span>
          <span className="oc-label" style={{ fontSize: 10, color: ink.graphite, opacity: 0.6 }}>{name}</span>
        </div>
      ))}
    </div>
  );
}

/** The surface flat: velvet, oak and brass as real gradients, with a light sweep (`--sweep` 0 → 1). */
export function SurfaceArt() {
  return (
    <div className="oc-abs" style={{ inset: 0, ['--sweep' as string]: 0 }}>
      <div className="oc-label" style={{ position: 'absolute', left: 20, top: 18, fontSize: 14, color: ink.graphite, opacity: 0.75 }}>SURFACE</div>
      <div className="oc-hand" style={{ position: 'absolute', left: 20, top: 40, fontSize: 18, color: ink.pencil }}>what the light does to it</div>
      {[
        ['velvet', `repeating-linear-gradient(90deg, ${ink.velvetLo} 0 6px, ${ink.velvet} 6px 22px, ${ink.velvetHi} 22px 30px, ${ink.velvet} 30px 44px)`, 'soaks light; folds hold it'],
        ['oak', `repeating-linear-gradient(0deg, ${ink.oakLo} 0 2px, ${ink.oak} 2px 26px, ${ink.oakHi} 26px 29px, ${ink.oak} 29px 52px)`, 'grain, warm, matte'],
        ['brass', `linear-gradient(100deg, ${ink.brassLo} 0%, ${ink.brass} 30%, ${ink.brassHi} 48%, ${ink.brass} 60%, ${ink.brassLo} 100%)`, 'one hard highlight'],
      ].map(([name, bg, note], i) => (
        <div key={name} className={`oc-surface oc-surface-${i}`} style={{ position: 'absolute', left: 20, top: 74 + i * 96, width: 260, height: 84 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: 150, height: 84, background: bg, borderRadius: 3, boxShadow: '0 2px 6px rgba(0,0,0,.4) inset', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -20, left: 'calc(var(--sweep) * 190px - 40px)', width: 40, height: 130, background: i === 2 ? 'rgba(255,245,220,.75)' : 'rgba(255,240,210,.22)', filter: 'blur(4px)', transform: 'rotate(12deg)' }} />
          </div>
          <div className="oc-label" style={{ position: 'absolute', left: 162, top: 6, fontSize: 13, color: ink.graphite }}>{name}</div>
          <div className="oc-hand" style={{ position: 'absolute', left: 162, top: 26, width: 100, fontSize: 14, lineHeight: 1.15, color: ink.pencil }}>{note}</div>
        </div>
      ))}
    </div>
  );
}

/** A small proscenium card that shows real components at small scale: a scene in miniature. 320 × 190. */
export function Diorama({ children, label, className = '', style, gelColour = '#ffaa52' }: { children?: Children; label: string; className?: string; style?: CSSProperties; gelColour?: string; key?: Key }) {
  return (
    <div className={`oc-abs oc-diorama ${className}`} style={{ width: 320, height: 190, ...style }}>
      <div className="oc-abs" style={{ left: -8, top: -8, width: 336, height: 206, background: `linear-gradient(180deg, ${ink.velvetHi}, ${ink.velvet} 30%, ${ink.velvetLo})`, borderRadius: 4, boxShadow: '0 12px 30px rgba(0,0,0,.6)' }} />
      <div className="oc-abs" style={{ left: -4, top: -4, width: 328, height: 198, border: `2px solid ${ink.brass}`, borderRadius: 3, opacity: 0.8 }} />
      <div className="oc-abs" style={{ left: 0, top: 0, width: 320, height: 190, overflow: 'hidden', background: `linear-gradient(180deg, #14101a 0%, ${gelColour}33 55%, ${ink.oakLo} 56%, ${ink.oak} 100%)` }}>
        <div className="oc-abs" style={{ left: 0, top: 105, width: 320, height: 85, background: `repeating-linear-gradient(90deg, ${ink.oakLo} 0 1px, transparent 1px 22px)`, opacity: 0.6 }} />
        {children}
      </div>
      <Tag style={{ left: 98, top: 200 }}>{label}</Tag>
    </div>
  );
}
