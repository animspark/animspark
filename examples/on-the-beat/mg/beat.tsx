/**
 * Motion on the music. The score in assets/audio/music/groove.ts plays on the film's audio
 * track; this scene imports the same events and turns each into a cue:
 *   kick  → the ring punches          snare → the side bars flash
 *   hat   → the ticks along the floor  lead  → a key of the roll lights, pitch = height
 *   chord → the colour field and the chord name change
 * `cue(music, event).start` is in scene seconds, so moving or trimming the music moves the motion.
 */
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue, useStage } from '@animspark/runtime';
import score, { harmony, hats, kicks, lead, snares } from '../assets/audio/music/groove';

gsap.registerPlugin(useGSAP);
export const durationSec = 8;

/* The window of the film-level music this scene sits on (film seconds 0–8). Not a sound of
   the scene — the music is on the film's audio track — only the clock to read events on. */
const music = { score, time: [0, 8] as const };
/* Picture leads sound by ~30 ms; the eye reads that as together. */
const LEAD = 0.03;
const at = (beat: number, duration = 0.2) => cue(music, { beat, duration }).start;
/** Where a hit lands on the timeline: its cue, nudged early, never before 0. */
const hit = (t: number) => Math.max(0, t - LEAD);

const BG = ['#121a2c', '#2b1233', '#0c2e2f', '#33200e'];
const HUE = ['#ffb347', '#ff6f91', '#5ee1c8', '#ffd84d'];
const PITCH: Record<string, number> = { D5: 0, E5: 1, G5: 2, A5: 3, B5: 4, C6: 5 };
const TITLE = 'ON THE BEAT';

export default function Beat() {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useStage();
  const u = h / 1080;
  const rollX = 360 * u;
  const keyW = (w - rollX * 2) / lead.length;

  useGSAP(() => {
    const tl = gsap.timeline();
    // bar 1: the title lands one word per kick, then clears for the groove
    const words = TITLE.split(' ');
    words.forEach((_, i) => {
      tl.fromTo(`.ob-w${i}`, { opacity: 0, scale: 1.6, y: -30 * u }, { opacity: 1, scale: 1, y: 0, duration: 0.25, ease: 'back.out(2.5)' }, hit(at(i)));
    });
    tl.to('.ob-title', { y: -60 * u, scale: 0.42, duration: 0.45, ease: 'power3.inOut' }, at(3.25));

    // kick → ring punch (every beat)
    kicks.forEach((k) => {
      const t = hit(at(k.beat));
      const big = k.beat % 4 === 0 ? 1.22 : 1.1;
      tl.fromTo('.ob-ring', { scale: big }, { scale: 1, duration: 0.42, ease: 'power3.out', immediateRender: false }, t);
      tl.fromTo('.ob-ripple', { scale: 1, opacity: 0.55 }, { scale: 1.9, opacity: 0, duration: 0.5, ease: 'power2.out', immediateRender: false }, t);
    });
    // snare → side bars flash
    snares.forEach((s) => {
      const t = hit(at(s.beat));
      tl.fromTo('.ob-bar', { opacity: 1, scaleY: 1 }, { opacity: 0.12, scaleY: 0.35, duration: 0.35, ease: 'power2.out', immediateRender: false }, t);
    });
    // hats → the tick under the playhead lights
    hats.forEach((hat, i) => {
      tl.fromTo(`.ob-tick-${i}`, { opacity: 1, scaleY: 1.8 }, { opacity: 0.35, scaleY: 1, duration: 0.3, ease: 'power2.out', immediateRender: false }, hit(at(hat.beat)));
    });
    // lead → roll key lights and holds for the note's length
    lead.forEach((note, i) => {
      const c = cue(music, note);
      tl.fromTo(`.ob-key-${i}`, { opacity: 0.18, scaleY: 0.6 }, { opacity: 1, scaleY: 1, duration: 0.12, ease: 'power2.out', immediateRender: false }, hit(c.start))
        .to(`.ob-key-${i}`, { opacity: 0.45, duration: c.dur, ease: 'sine.out' }, c.start + 0.12);
      tl.to('.ob-head', { x: rollX + (i + 0.5) * keyW, duration: 0.18, ease: 'power2.out' }, hit(c.start));
    });
    // chord → colour field and name
    harmony.forEach((span, i) => {
      const t = hit(at(span.beat));
      tl.to(ref.current, { backgroundColor: BG[i], duration: 0.3, ease: 'power1.out' }, t)
        .to('.ob-ring', { borderColor: HUE[i], duration: 0.2 }, t)
        .to('.ob-head, .ob-tick, .ob-bar', { backgroundColor: HUE[i], duration: 0.2 }, t)
        .fromTo(`.ob-chord-${i}`, { opacity: 0, y: 24 * u }, { opacity: 1, y: 0, duration: 0.22, ease: 'power3.out', immediateRender: false }, t);
      if (i > 0) tl.to(`.ob-chord-${i - 1}`, { opacity: 0, y: -24 * u, duration: 0.1, ease: 'power2.in' }, t - 0.1);
    });
    // out: everything settles into the ring on the last beat
    tl.to('.ob-roll, .ob-floor, .ob-bar, .ob-chords', { opacity: 0, duration: 0.4 }, at(15.5));
    tl.to('.ob-ring', { scale: 0.2, opacity: 0, duration: 0.45, ease: 'power3.in' }, at(15.5));
  }, { scope: ref });

  const ring = 360 * u;
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, background: BG[0], color: '#f6f1e7', overflow: 'hidden', fontFamily: "'Space Grotesk', sans-serif" }}>
      {/* side bars (snare) */}
      {[0, 1].map((side) => (
        <div key={side} className="ob-bar" style={{ position: 'absolute', top: 0, bottom: 0, [side ? 'right' : 'left']: 0, width: 38 * u, background: HUE[0], opacity: 0.12, transformOrigin: '50% 50%' } as React.CSSProperties} />
      ))}

      {/* ring (kick) */}
      <div style={{ position: 'absolute', left: w / 2 - ring / 2, top: h * 0.46 - ring / 2, width: ring, height: ring }}>
        <div className="ob-ripple" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `${3 * u}px solid #f6f1e7`, opacity: 0 }} />
        <div className="ob-ring" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `${22 * u}px solid ${HUE[0]}`, boxShadow: `0 0 ${80 * u}px rgba(255,255,255,0.08)` }} />
        <div className="ob-chords" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          {harmony.map((span, i) => (
            <div key={i} className={`ob-chord-${i}`} style={{ gridArea: '1 / 1', fontWeight: 700, fontSize: 120 * u, letterSpacing: '-0.03em', opacity: 0 }}>{span.symbol}</div>
          ))}
        </div>
      </div>

      {/* title (bar 1) */}
      <div className="ob-title" style={{ position: 'absolute', left: 0, right: 0, top: 110 * u, textAlign: 'center', fontWeight: 700, fontSize: 150 * u, transformOrigin: '50% 0%', letterSpacing: '-0.02em', lineHeight: 1 }}>
        {TITLE.split(' ').map((word, i) => (
          <span key={i} className={`ob-w${i}`} style={{ display: 'inline-block', margin: `0 ${20 * u}px`, opacity: 0 }}>{word}</span>
        ))}
      </div>

      {/* piano roll (lead) */}
      <div className="ob-roll" style={{ position: 'absolute', left: 0, top: h * 0.77, width: w, height: 120 * u }}>
        {lead.map((note, i) => {
          const level = PITCH[String(note.pitch)] ?? 0;
          const kh = (34 + level * 16) * u;
          return (
            <div key={i} className={`ob-key-${i}`} style={{ position: 'absolute', left: rollX + i * keyW + 6 * u, width: keyW - 12 * u, bottom: 0, height: kh, borderRadius: 8 * u, background: '#f6f1e7', opacity: 0.18, transformOrigin: '50% 100%' }} />
          );
        })}
        <div className="ob-head" style={{ position: 'absolute', left: -6 * u, top: -26 * u, width: 12 * u, height: 12 * u, borderRadius: '50%', background: HUE[0], transform: `translateX(${rollX}px)` }} />
      </div>

      {/* floor ticks (hats) */}
      <div className="ob-floor" style={{ position: 'absolute', left: rollX, right: rollX, top: h * 0.77 + 150 * u, height: 16 * u }}>
        {hats.map((_, i) => (
          <div key={i} className={`ob-tick ob-tick-${i}`} style={{ position: 'absolute', left: `${((i + 0.5) / hats.length) * 100}%`, width: 6 * u, marginLeft: -3 * u, height: 16 * u, background: HUE[0], opacity: 0.35, transformOrigin: '50% 100%' }} />
        ))}
      </div>

      <div style={{ position: 'absolute', left: 90 * u, bottom: 60 * u, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, fontSize: 24 * u, color: 'rgba(246,241,231,0.55)' }}>
        120 BPM · 4/4 · score: assets/audio/music/groove.ts
      </div>
    </div>
  );
}
