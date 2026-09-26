/**
 * A kinetic title card: the headline arrives letter by letter behind a sliding mask,
 * a colour band wipes through, the line settles, then the whole card exits on a band.
 * Every value is a function of the film clock — scrub, look and render all agree.
 */
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { useStage } from '@animspark/runtime';

gsap.registerPlugin(useGSAP);
export const durationSec = 6;

const INK = '#16161d';
const PAPER = '#f3efe6';
const ACCENT = '#ff5a36';
const TEAL = '#1f6f78';

const LINES = ['Motion,', 'made in code.'];

function Letters({ text, line }: { text: string; line: number }) {
  return (
    <span className="tc-line" style={{ display: 'block', overflow: 'hidden', paddingBottom: '0.06em' }}>
      {[...text].map((ch, i) => (
        <span key={i} className={`tc-ch tc-l${line}`} style={{ display: 'inline-block', whiteSpace: 'pre' }}>{ch}</span>
      ))}
    </span>
  );
}

export default function TitleCard() {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useStage();
  const u = h / 1080;

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    // 0.0 — the bands sweep in and leave the paper behind
    /* Frame 0 is already a complete picture: the colour bands fill it, then wipe away. */
    tl.fromTo('.tc-band', { xPercent: 0 }, { xPercent: 101, duration: 0.55, ease: 'power3.inOut', stagger: 0.08 }, 0.25);
    // 0.7 — letters rise out of their line masks
    tl.from('.tc-l0', { yPercent: 110, rotate: 8, duration: 0.7, stagger: 0.035 }, 0.45)
      .from('.tc-l1', { yPercent: 110, rotate: 8, duration: 0.7, stagger: 0.028 }, 0.65);
    // 1.6 — accent: the comma pops, the rule draws, the kicker types on
    tl.fromTo('.tc-rule', { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'expo.out' }, 1.3)
      .from('.tc-kicker span', { opacity: 0, y: 12 * u, duration: 0.3, stagger: 0.02 }, 1.5)
      .fromTo('.tc-dot', { scale: 0 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' }, 1.9)
      .from('.tc-meta', { opacity: 0, x: 24 * u, duration: 0.5, stagger: 0.1 }, 1.6);
    // 2.4 → 4.6 — a slow push so the held frame still breathes
    tl.fromTo('.tc-stack', { scale: 1 }, { scale: 1.035, duration: 2.6, ease: 'sine.inOut' }, 2.2)
      .to('.tc-dot', { x: 420 * u, rotate: 360, duration: 1.4, ease: 'power2.inOut' }, 2.8)
      .to('.tc-rule', { scaleX: 1.43, duration: 1.4, ease: 'power2.inOut' }, 2.8)
      .to('.tc-dot', { backgroundColor: TEAL, duration: 0.4 }, 3.6);
    // 4.9 — exit: letters drop back, one band closes the card
    tl.to('.tc-ch', { yPercent: -110, duration: 0.45, ease: 'power3.in', stagger: 0.012 }, 4.9)
      .to('.tc-kicker, .tc-rule, .tc-dot, .tc-meta', { opacity: 0, duration: 0.3 }, 4.95)
      .set('.tc-close', { xPercent: -101 }, 0)
      .fromTo('.tc-close', { xPercent: -101 }, { xPercent: 0, duration: 0.5, ease: 'power3.inOut' }, 5.2)
      .from('.tc-mark', { opacity: 0, y: 20 * u, duration: 0.4 }, 5.55);
  }, { scope: ref });

  const kicker = 'anim · an open-source film engine';
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, background: PAPER, color: INK, overflow: 'hidden' }}>
      {/* faint grid, drawn once */}
      <svg width={w} height={h} style={{ position: 'absolute', inset: 0, opacity: 0.07 }}>
        {Array.from({ length: 13 }, (_, i) => <line key={`v${i}`} x1={(i * w) / 12} y1={0} x2={(i * w) / 12} y2={h} stroke={INK} strokeWidth={1} />)}
        {Array.from({ length: 7 }, (_, i) => <line key={`h${i}`} x1={0} y1={(i * h) / 6} x2={w} y2={(i * h) / 6} stroke={INK} strokeWidth={1} />)}
      </svg>

      <div className="tc-stack" style={{ position: 'absolute', left: 190 * u, top: 250 * u, transformOrigin: '0% 50%' }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 190 * u, lineHeight: 0.98, letterSpacing: '-0.035em' }}>
          <Letters text={LINES[0]!} line={0} />
          <Letters text={LINES[1]!} line={1} />
        </div>
        <div className="tc-rule" style={{ marginTop: 44 * u, width: 980 * u, height: 10 * u, background: ACCENT, transformOrigin: '0% 50%' }} />
        <div className="tc-kicker" style={{ marginTop: 34 * u, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, fontSize: 34 * u, letterSpacing: '0.02em', color: '#4a4a55' }}>
          {[...kicker].map((ch, i) => <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre' }}>{ch}</span>)}
        </div>
      </div>
      <div style={{ position: 'absolute', right: 120 * u, top: 110 * u, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, fontSize: 26 * u, lineHeight: 1.6, color: '#6b6b76' }}>
        <div className="tc-meta">EXAMPLE 01</div>
        <div className="tc-meta" style={{ color: ACCENT }}>TITLE CARD · 6s</div>
      </div>
      {/* sits on the right end of the rule (rule: left 190, top ≈ 666, 10 tall) */}
      <div className="tc-dot" style={{ position: 'absolute', left: (190 + 980 + 16) * u, top: (671 - 29) * u, width: 58 * u, height: 58 * u, borderRadius: '50%', background: ACCENT, backgroundImage: `linear-gradient(90deg, transparent 46%, ${PAPER} 46%, ${PAPER} 54%, transparent 54%)` }} />

      {/* wipe bands */}
      {[ACCENT, TEAL, INK].map((c, i) => (
        <div key={c} className="tc-band" style={{ position: 'absolute', left: 0, top: (i * h) / 3, width: w, height: h / 3 + 1, background: c }} />
      ))}
      <div className="tc-close" style={{ position: 'absolute', inset: 0, background: INK, display: 'grid', placeItems: 'center' }}>
        <div className="tc-mark" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 96 * u, color: PAPER, letterSpacing: '-0.03em' }}>
          anim<span style={{ color: ACCENT }}>.</span>
        </div>
      </div>
    </div>
  );
}
