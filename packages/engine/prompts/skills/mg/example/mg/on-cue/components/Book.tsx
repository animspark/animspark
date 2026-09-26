import { ink, type } from '../theme';
import type { CSSProperties, Children, Key } from './types';

/**
 * Paper the stage manager works from. The prompt book is a ring binder on a slanted stand; the
 * cue sheet is a typed table. Both are HTML so the film's own words can be set in real type and
 * every row can be lit, circled or ticked by GSAP.
 */

export function Paper({ width, height, children, className = '', style, shade = 0.06 }: { width: number; height: number; children?: Children; className?: string; style?: CSSProperties; shade?: number }) {
  return (
    <div className={`oc-abs oc-paper ${className}`} style={{
      width, height, background: ink.paper,
      backgroundImage: `radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.35), transparent 60%), repeating-linear-gradient(0deg, rgba(120,100,60,${shade}) 0 1px, transparent 1px 3px)`,
      boxShadow: '0 2px 0 rgba(255,255,255,.35) inset, 0 12px 30px rgba(0,0,0,.45), 0 1px 2px rgba(0,0,0,.6)',
      ...style,
    }}>{children}</div>
  );
}

/** An open ring binder on the prompt desk, propped toward the audience. 560 × 380. */
export function PromptBook({ className = '', style, left, right }: { className?: string; style?: CSSProperties; left?: Children; right?: Children }) {
  return (
    <div className={`oc-abs oc-book ${className}`} style={{ width: 560, height: 380, ...style }}>
      {/* cover */}
      <div className="oc-abs" style={{ left: -14, top: -12, width: 588, height: 404, background: 'linear-gradient(180deg,#1c1a1f,#0f0e12)', borderRadius: 6, boxShadow: '0 18px 40px rgba(0,0,0,.6)' }} />
      <div className="oc-abs" style={{ left: -14, top: -12, width: 588, height: 3, background: 'rgba(255,255,255,.12)', borderRadius: 3 }} />
      {/* pages */}
      <Paper width={268} height={380} style={{ left: 0, top: 0 }} className="oc-book-left">{left}</Paper>
      <Paper width={268} height={380} style={{ left: 292, top: 0 }} className="oc-book-right">{right}</Paper>
      {/* rings */}
      {[70, 190, 310].map((y) => (
        <div key={y} className="oc-abs" style={{ left: 262, top: y - 12, width: 36, height: 24, borderRadius: 12, border: '5px solid #8a8f9a', borderColor: '#9aa0ac #4a4e58 #4a4e58 #9aa0ac', boxShadow: '0 2px 3px rgba(0,0,0,.6)' }} />
      ))}
      {/* tabs */}
      {['ACT I', 'LX', 'SQ'].map((t, i) => (
        <div key={t} className="oc-label" style={{ position: 'absolute', left: 562, top: 40 + i * 62, width: 30, height: 48, background: [ink.tape, ink.pencil, ink.red][i], color: i ? '#fff' : ink.graphite, fontSize: 11, writingMode: 'vertical-rl', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 4px 4px 0', boxShadow: '2px 2px 4px rgba(0,0,0,.5)' }}>{t}</div>
      ))}
    </div>
  );
}

/** Typed text, as a typewriter would set it. */
export function Typed({ children, size = 15, style, className = '' }: { children: Children; size?: number; style?: CSSProperties; className?: string }) {
  return <div className={`oc-type ${className}`} style={{ fontSize: size, lineHeight: 1.45, color: ink.graphite, letterSpacing: 0.2, ...style }}>{children}</div>;
}

/** Pencil handwriting in the margin. */
export function Pencil({ children, size = 18, colour = ink.pencil, style, className = '' }: { children: Children; size?: number; colour?: string; style?: CSSProperties; className?: string; key?: Key }) {
  return <div className={`oc-hand ${className}`} style={{ fontSize: size, lineHeight: 1.2, color: colour, ...style }}>{children}</div>;
}

export interface CueRow { q: string; page: string; line: string; action: string; }

/**
 * The typed cue sheet: what is called, on which word. 520 wide; height follows the rows, plus a `footer`
 * strip if the scene pins one on. Rows are 38 tall and the ACTION column gets the width it needs, so a
 * two-line action stays inside its own row instead of printing over the next.
 */
export const CUE_SHEET_W = 520;
const ROW_H = 38, ROW_TOP = 68, COLS = '58px 44px 164px 1fr';
export function cueSheetHeight(rows: number, footer = 0): number { return 92 + rows * ROW_H + footer; }
export function CueSheet({ rows, className = '', style, title = 'CUE SHEET · ON CUE · ACT I', flag = 'STANDBY · GO', footer, footerHeight = 0 }: { rows: CueRow[]; className?: string; style?: CSSProperties; title?: string; flag?: string; footer?: Children; footerHeight?: number }) {
  return (
    <Paper width={CUE_SHEET_W} height={cueSheetHeight(rows.length, footerHeight)} className={`oc-cuesheet ${className}`} style={style}>
      <div className="oc-label" style={{ position: 'absolute', left: 22, top: 16, fontSize: 12, color: ink.graphite, opacity: 0.8 }}>{title}</div>
      <div className="oc-label" style={{ position: 'absolute', right: 22, top: 16, fontSize: 12, color: ink.red, opacity: 0.9 }}>{flag}</div>
      <div style={{ position: 'absolute', left: 22, right: 22, top: 40, borderTop: `1.5px solid ${ink.graphite}`, opacity: 0.7 }} />
      <div className="oc-type" style={{ position: 'absolute', left: 22, top: 46, fontSize: 11, color: ink.graphite, opacity: 0.7, display: 'grid', gridTemplateColumns: COLS, width: 476 }}>
        <span>Q</span><span>PAGE</span><span>LINE</span><span>ACTION</span>
      </div>
      {rows.map((r, i) => (
        <div key={i} className={`oc-type oc-cue-row oc-cue-row-${i}`} style={{ position: 'absolute', left: 14, top: ROW_TOP + i * ROW_H, width: 492, height: ROW_H - 4, padding: '0 8px', fontSize: 13, color: ink.graphite, display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', borderRadius: 3 }}>
          <span style={{ fontWeight: 700 }}>{r.q}</span><span>{r.page}</span><span style={{ fontStyle: 'italic', whiteSpace: 'nowrap' }}>“{r.line}”</span><span style={{ fontSize: 12, lineHeight: 1.15 }}>{r.action}</span>
        </div>
      ))}
      {footer && <div className="oc-abs" style={{ left: 22, top: 76 + rows.length * ROW_H, width: CUE_SHEET_W - 44, height: footerHeight }}>{footer}</div>}
    </Paper>
  );
}
