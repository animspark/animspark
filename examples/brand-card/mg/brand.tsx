/**
 * AnimSpark brand card — the README hero (1600×520, a seamless 6 s loop) and, on a 1280×640
 * stage, the social preview. Frame 0 is the complete picture; the motion is ambient:
 *   · the pinwheel mark turns 90° (it has four-fold symmetry, so the loop is seamless),
 *   · a playhead sweeps a timeline of clips and wraps,
 *   · a caret blinks after the commands.
 */
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { useStage } from '@animspark/runtime';

export const durationSec = 6;

const NIGHT = '#0b0c0f';
const ON = '#f4f4f2';
const DIM = '#a3a7ae';
const MUTED = '#6d727b';
const G1 = '#2f9e63', G2 = '#3cbc93', G3 = '#55bfd0';
const MARK = 'M84.1148 67.3453H136.194C136.637 67.3453 137 67.7028 137 68.1397V134.043C137 134.484 136.633 134.845 136.186 134.841C99.0222 134.416 68.9737 104.827 68.502 68.2191V134.206C68.502 134.643 68.1392 135 67.6958 135H0.814284C0.366822 135 -2.06673e-05 134.639 0.00401052 134.198C0.439379 97.2879 30.9354 67.5042 68.498 67.5002H0.806238C0.362807 67.5002 0 67.1427 0 66.7057V0.802561C0 0.361644 0.366822 0.000171863 0.814284 0.00414409C37.9778 0.429172 68.0263 30.0183 68.498 66.6263V0.794617C68.498 0.357672 68.8608 0.000171819 69.3042 0.000171819H136.186C136.633 0.000171819 137 0.361644 136.996 0.802561C136.621 32.4969 114.079 58.94 83.9334 65.7802C83.0022 65.9907 83.1594 67.3453 84.1189 67.3453H84.1148Z';

/* Timeline motif: rows of clips (start, length in 0..1 of the lane), coloured like the preview. */
const LANES: Array<{ color: string; clips: Array<[number, number]> }> = [
  { color: '#7b83ff', clips: [[0.0, 0.28], [0.3, 0.34], [0.66, 0.34]] },
  { color: '#35b5a3', clips: [[0.12, 0.3], [0.52, 0.22]] },
  { color: '#c46ae0', clips: [[0.0, 1.0]] },
  { color: '#e46a6a', clips: [[0.18, 0.04], [0.43, 0.04], [0.61, 0.04], [0.86, 0.04]] },
];

export default function Brand() {
  const root = useRef<HTMLDivElement>(null);
  const { w, h } = useStage();
  const social = h / w > 0.4;
  const u = social ? h / 640 : h / 520;

  useGSAP(() => {
    const tl = gsap.timeline();
    // The mark: hold, turn a quarter, hold — identical at 0 s and 6 s.
    tl.fromTo('.b-mark', { rotate: 0 }, { rotate: 90, duration: 1.1, ease: 'expo.inOut' }, 2.2);
    // Playhead: left edge → right edge over the whole loop.
    tl.fromTo('.b-head', { xPercent: 0, left: '0%' }, { left: '100%', duration: 6, ease: 'none' }, 0);
    // Caret blink, six times a loop.
    for (let i = 0; i < 6; i += 1) tl.to('.b-caret', { opacity: 0, duration: 0.01 }, i + 0.5).to('.b-caret', { opacity: 1, duration: 0.01 }, i + 1);
    // Clips light up as the playhead passes over them.
    root.current!.querySelectorAll<HTMLElement>('.b-clip').forEach((el) => {
      const at = Number(el.dataset.at) * 6;
      if (Number(el.dataset.len) >= 0.99) { gsap.set(el, { opacity: 0.8 }); return; } // the music bed: always on, so the loop is seamless
      tl.fromTo(el, { opacity: 0.35 }, { opacity: 0.9, duration: 0.25, ease: 'power2.out' }, at)
        .to(el, { opacity: 0.35, duration: 0.8, ease: 'power2.in' }, at + Number(el.dataset.len) * 6 + 0.05);
    });
  }, { scope: root });

  const markSize = (social ? 176 : 200) * u;
  const laneW = social ? w - 2 * 110 * u : w - 2 * 90 * u;
  const lanesTop = social ? h - 150 * u : h - 118 * u;
  const laneH = (social ? 18 : 14) * u;

  return (
    <div ref={root} style={{ position: 'absolute', inset: 0, background: NIGHT, overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* brand glow */}
      <div style={{ position: 'absolute', left: -200 * u, top: -300 * u, width: 900 * u, height: 900 * u, borderRadius: '50%', background: `radial-gradient(circle, ${G2}33, transparent 62%)` }} />
      <div style={{ position: 'absolute', right: -260 * u, bottom: -420 * u, width: 900 * u, height: 900 * u, borderRadius: '50%', background: `radial-gradient(circle, ${G3}22, transparent 60%)` }} />

      {/* mark + words */}
      <div style={{
        position: 'absolute', left: social ? 110 * u : '50%', top: social ? 120 * u : 64 * u,
        transform: social ? undefined : 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: (social ? 46 : 56) * u,
      }}>
        <svg className="b-mark" viewBox="-11 -12 159 159" style={{ width: markSize, height: markSize, flexShrink: 0 }}>
          <defs>
            <linearGradient id="bg" x1="0" y1="27" x2="137" y2="115" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={G1} /><stop offset="50%" stopColor={G2} /><stop offset="100%" stopColor={G3} />
            </linearGradient>
          </defs>
          <path fill="url(#bg)" d={MARK} />
        </svg>
        <div>
          <div style={{ fontWeight: 800, fontSize: (social ? 112 : 124) * u, lineHeight: 1, letterSpacing: '-0.035em', color: ON }}>AnimSpark</div>
          <div style={{ marginTop: 18 * u, fontWeight: 600, fontSize: (social ? 40 : 42) * u, letterSpacing: '-0.01em', background: `linear-gradient(90deg, ${G2}, ${G3})`, WebkitBackgroundClip: 'text', color: 'transparent' }}>
            The open-source video agent
          </div>
          <div style={{ marginTop: 20 * u, fontFamily: "'Geist Mono', monospace", fontSize: (social ? 22 : 24) * u, color: DIM, whiteSpace: 'nowrap' }}>
            <span style={{ color: G2 }}>$</span> anim new <span style={{ color: MUTED }}>·</span> anim preview <span style={{ color: MUTED }}>·</span> anim render
            <span className="b-caret" style={{ display: 'inline-block', width: 12 * u, height: 26 * u, marginLeft: 8 * u, verticalAlign: -4 * u, background: ON }} />
          </div>
        </div>
      </div>

      {social && (
        <div style={{ position: 'absolute', left: 110 * u, top: 372 * u, fontSize: 28 * u, color: DIM, lineHeight: 1.45, maxWidth: 1000 * u }}>
          Your coding agent writes the film. The engine renders every frame — motion graphics, music, voice and the cut. Apache-2.0.
        </div>
      )}

      {/* timeline motif */}
      <div style={{ position: 'absolute', left: social ? 110 * u : 90 * u, top: lanesTop, width: laneW }}>
        {LANES.map((lane, i) => (
          <div key={i} style={{ position: 'relative', height: laneH, marginBottom: 8 * u }}>
            {lane.clips.map(([at, len], j) => (
              <div key={j} className="b-clip" data-at={at} data-len={len} style={{
                position: 'absolute', left: `${at * 100}%`, width: `calc(${len * 100}% - ${4 * u}px)`, top: 0, bottom: 0,
                borderRadius: 4 * u, background: lane.color, opacity: 0.35,
              }} />
            ))}
          </div>
        ))}
        <div className="b-head" style={{ position: 'absolute', left: 0, top: -12 * u, bottom: -6 * u, width: 2 * u, background: '#ffb547', boxShadow: `0 0 ${12 * u}px #ffb54799` }} />
      </div>
    </div>
  );
}
