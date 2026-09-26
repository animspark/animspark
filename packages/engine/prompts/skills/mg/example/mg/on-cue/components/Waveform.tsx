import { bars, type VoiceId } from '../data/envelopes';
import { ink, type } from '../theme';
import type { CSSProperties } from './types';

/**
 * The narration as the stage manager hears it: a measured envelope drawn as bars on a paper strip,
 * with a playhead (`--play`, 0..1 across the strip) and the spoken words placed at their real seconds.
 * Words come from `assets/index.jsonl` through `cue()`; this component only draws what it is given.
 */
export interface Chip { word: string; at: number; end: number; hot?: boolean }

export function Waveform({ id, seconds, width, height, chips = [], className = '', style, colour = ink.pencil, hot = ink.red, paper = true, from = 0 }: {
  id: VoiceId; seconds: number; width: number; height: number; chips?: Chip[]; className?: string; style?: CSSProperties; colour?: string; hot?: string; paper?: boolean;
  /** Source second drawn at the strip's left edge. */
  from?: number;
}) {
  const count = Math.max(40, Math.round(width / 4));
  const values = bars(id, Math.round(count * (seconds + from) / seconds)).slice(Math.round(count * from / seconds));
  const w = width / values.length;
  const x = (t: number) => ((t - from) / seconds) * width;
  // Chip words take the first row they fit in, so close words step down instead of printing over
  // each other; as many rows as the line needs (the caller leaves room under the strip for them).
  const chipW = (word: string) => word.length * 8 + 16;
  const rowEnd: number[] = [];
  const rowOf = chips.map((c) => {
    const x0 = x(c.at) - chipW(c.word) / 2;
    let r = 0;
    while (r < rowEnd.length && rowEnd[r]! > x0) r++;
    rowEnd[r] = x0 + chipW(c.word);
    return r;
  });
  return (
    <div className={`oc-abs oc-wave ${className}`} style={{ width, height, ['--play' as string]: 0, ...style }}>
      {paper && <div className="oc-abs" style={{ inset: 0, background: ink.paper, boxShadow: '0 8px 24px rgba(0,0,0,.45)', backgroundImage: `repeating-linear-gradient(90deg, rgba(60,50,30,.08) 0 1px, transparent 1px ${width / seconds}px)` }} />}
      <svg className="oc-abs" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ left: 0, top: 0, overflow: 'visible' }}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={colour} strokeWidth={1} opacity={0.35} />
        {values.map((v, i) => {
          const h = Math.max(1.5, v * height * 0.82);
          return <rect key={i} x={i * w + w * 0.18} y={height / 2 - h / 2} width={Math.max(1, w * 0.64)} height={h} rx={1} fill={colour} opacity={0.35 + v * 0.65} />;
        })}
        {chips.map((c, i) => (
          <g key={i} className={`oc-chip-mark oc-chip-mark-${i}`}>
            <line x1={x(c.at)} y1={0} x2={x(c.at)} y2={height} stroke={c.hot ? hot : colour} strokeWidth={c.hot ? 3 : 1} opacity={c.hot ? 0.95 : 0.45} />
          </g>
        ))}
        {/* playhead */}
        <g style={{ transform: `translateX(calc(var(--play) * ${width}px))` }}>
          <line x1={0} y1={-6} x2={0} y2={height + 6} stroke={hot} strokeWidth={2} />
          <polygon points={`-6,-8 6,-8 0,0`} fill={hot} />
        </g>
      </svg>
      {chips.map((c, i) => (
        <div key={i} className={`oc-chipword oc-chipword-${i} oc-type`} style={{
          position: 'absolute', left: x(c.at), top: height + 8 + rowOf[i]! * 24, transform: 'translateX(-50%)', padding: '2px 6px', fontSize: 13, lineHeight: 1.1,
          background: c.hot ? hot : ink.cream, color: c.hot ? '#fff' : ink.graphite, border: `1px solid ${c.hot ? hot : 'rgba(42,40,48,.35)'}`, borderRadius: 3, whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,.35)',
        }}>{c.word}</div>
      ))}
      <div className="oc-label" style={{ position: 'absolute', left: 8, top: -20, fontSize: 11, color: colour, opacity: 0.8, fontFamily: type.label }}>VOICE · measured</div>
    </div>
  );
}
