import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue } from '@animspark/runtime';
import { Theatre, useTheatre } from '../components/Theatre';
import { BOOK, BOOK_TRANSFORM, CUE_LIGHT_STYLE, CrateAt, DESK, DESK_SCALE, DeskAt, Dressing, SPIKE_A, SPIKE_B, settleWords, workedRig } from '../components/Set';
import { CueLight } from '../components/Fixtures';
import { Pencil, PromptBook, Typed } from '../components/Book';
import { PencilProp, Spike } from '../components/Marks';
import { camera, everyFrame, tween } from '../lib/camera';
import { hit, sceneLength, texture, voice } from '../sound';
import { SYNC_LEAD, handoff, ink } from '../theme';
import { BEATS, BRIEF } from '../data/script';

gsap.registerPlugin(useGSAP);

/*
 * 02 · Script.
 * The lens leaves the wide house and lands on the prompt book. One typed sentence is underlined,
 * then split by pencil into the eight beats of this very film; one beat opens into the three
 * questions every beat must answer, and the one that matters most gets circled in red.
 */
const vo = voice('02-script', 0.55);
const book = cue(vo, 'prompt book').start;
const sentence = cue(vo, 'One sentence').start;
const becomes = cue(vo, 'becomes').start;
const beats = cue(vo, 'beats').start;
const every = cue(vo, 'every beat').start;
const change = cue(vo, 'change').start;
const see = cue(vo, 'see').start;
const said = cue(vo, 'see').end;

/**
 * Book-local (x, y) → world px. The desk scales about its bottom centre, the book about its own
 * bottom centre, so both origins shift; the lens has to aim at the page where it actually is.
 */
const K = DESK_SCALE * BOOK.scale;
const BX0 = DESK.x + (BOOK.left + 280 * (1 - BOOK.scale) - 260) * DESK_SCALE;
const BY0 = DESK.y + (BOOK.top + 380 * (1 - BOOK.scale) - 300) * DESK_SCALE;
const bookPoint = (lx: number, ly: number) => ({ x: BX0 + lx * K, y: BY0 + ly * K });
/** The right-hand page starts at book-local x = 292. */
const PAGE_CENTRE = bookPoint(292 + 134, 150);
const LIST_CENTRE = bookPoint(292 + 134, 215);
/** Zoom that shows the page at a readable size: the page is 268 book px wide; give it 40% of the frame. */
const PAGE_ZOOM = (1920 * 0.4) / (268 * K);

/** The page's layout in page px: the beat list, and the red ring round the word SEE (its head sits at 132, 112 in 10 px capitals). */
const BEAT_X = 40, BEAT_TOP = 112, BEAT_STEP = 21;
const RING = { x0: 119, y0: 119, x1: 167, cx: 143, cy: 117, top: 104, bottom: 133 };
const RING_PATH = `M ${RING.x0} ${RING.y0} C ${RING.x0 - 2} ${RING.top}, ${RING.x1 + 1} ${RING.top - 2}, ${RING.x1} ${RING.cy} C ${RING.x1 - 1} ${RING.bottom - 1}, ${RING.x0 + 2} ${RING.bottom + 2}, ${RING.x0 + 1} ${RING.y0 + 2}`;

export const sounds = [
  vo,
  texture('desk-hum', 'hum', 0, 0.25, 4.2),
  hit('lamp-click', 'switch', book - SYNC_LEAD, 0.6),
  texture('underline', 'pencil', sentence + 0.1, 0.9, 0.6),
  ...BEATS.map((b, i) => texture(`write-${b.n}`, 'pencil', becomes + 0.15 + i * 0.19, 0.55, 0.16, (i % 3) * 0.3)),
  hit('page-tap', 'chalkTap', every + 0.05, 0.5),
  texture('circle', 'pencil', change - 0.05, 0.9, 0.5, 0.5),
  texture('sketch', 'pencil', see + 0.1, 0.7, 0.7),
];
export const durationSec = sceneLength(sounds, 0.8, said + 2.3);

export default function Script() {
  const theatre = useTheatre();
  useGSAP(() => {
    const tl = gsap.timeline();
    settleWords(tl);
    const rig = workedRig(0.5);
    const lens = camera(tl, handoff.shots.house);
    // In to the prompt corner, then right onto the page.
    lens.move({ x: DESK.x + 130, y: DESK.y - 140, zoom: 2.2, roll: -1.5 }, 0.15, 1.5)
      .move({ x: PAGE_CENTRE.x, y: PAGE_CENTRE.y, zoom: PAGE_ZOOM, roll: -1.5 }, book - 0.1, 1.4)
      .move({ x: LIST_CENTRE.x, y: LIST_CENTRE.y, zoom: PAGE_ZOOM * 1.15, roll: -1 }, every - 0.3, 1.2)
      // Out in two steps: back off the page first, then up to the battens, so the pull does not pass through the crate.
      .move({ x: DESK.x + 130, y: DESK.y - 200, zoom: 2.0, roll: -1 }, said + 0.4, 0.9, 'power2.in')
      .move({ x: 960, y: 330, zoom: 1.25, roll: 0 }, said + 1.3, 1.1, 'power2.out');

    // The clip lamp comes up on the book; the work light eases down so the page is the bright thing.
    tl.to('.oc-desk-lamp', { '--lamp': 1, duration: 0.25 }, book - SYNC_LEAD);
    tween(tl, rig, { work: 0.42, duration: 1.2 }, book);
    tween(tl, rig, { work: 0.62, duration: 1.2 }, said + 0.5);

    // Pencil: parked, then to the page. `pen` is the tip, in page px; the pencil's tip is at its wrapper's origin.
    const pen = { x: 250, y: 420, r: 0 };
    const root = theatre.root.current!;
    const penEl = root.querySelector<HTMLElement>('.oc-pen')!;
    const place = () => { penEl.style.transform = `translate(${pen.x}px, ${pen.y}px) rotate(${pen.r}deg)`; };
    place();
    const penTo = (x: number, y: number, at: number, d = 0.35, ease = 'power2.inOut') => tween(tl, pen, { x, y, duration: d, ease, onUpdate: place }, at);

    // "One sentence": underline the brief (the rule is at y 80–82, from x 22 to 236).
    penTo(22, 81, sentence - 0.35);
    penTo(236, 82, sentence + 0.1, 0.55, 'power1.inOut');
    tl.fromTo('.oc-underline', { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: 'power1.inOut' }, sentence + 0.1);

    // "becomes a list of beats": eight lines, each written in one stroke. The tip runs along each
    // line's baseline (14 px Kalam: 13 px down from the top) exactly as far as that line is long,
    // so the wipe that reveals the words and the tip that writes them stay together.
    BEATS.forEach((b, i) => {
      const at = becomes + 0.15 + i * 0.19;
      const width = root.querySelector<HTMLElement>(`.oc-beat-${b.n}`)?.offsetWidth || 18 + 7 * b.title.length;
      penTo(BEAT_X, BEAT_TOP + i * BEAT_STEP + 13, at - 0.08, 0.1, 'power1.out');
      penTo(BEAT_X + width, BEAT_TOP + i * BEAT_STEP + 14, at, 0.16, 'none');
      tl.fromTo(`.oc-beat-${b.n}`, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 -5% 0 0)', duration: 0.16, ease: 'none' }, at);
    });
    tl.fromTo('.oc-brace', { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.4, ease: 'power2.out' }, beats);

    // "every beat": the three questions open beside the list; beat 01 answers them.
    tl.fromTo('.oc-col-head', { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.1, ease: 'power2.out' }, every - 0.1);
    tl.fromTo('.oc-col-cell', { opacity: 0 }, { opacity: 1, duration: 0.35, stagger: 0.12, ease: 'power1.out' }, every + 0.25);
    tl.to('.oc-beat-1', { color: ink.red, duration: 0.2 }, every);

    // "change": the pencil turns red and rings the word SEE, starting at its left and going over the top.
    penTo(RING.x0, RING.y0, change - 0.4, 0.3);
    tl.to('.oc-pen-body', { fill: ink.red, duration: 0.15 }, change - 0.4);
    tl.fromTo('.oc-circle', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: 'power1.inOut' }, change - 0.05);
    tl.to(pen, { keyframes: [{ x: RING.cx, y: RING.top }, { x: RING.x1, y: RING.cy }, { x: RING.cx, y: RING.bottom }, { x: RING.x0 + 1, y: RING.y0 + 2 }], duration: 0.5, ease: 'sine.inOut', onUpdate: place }, change - 0.05);
    // Then the pencil lifts off the answers it would otherwise lie across, and waits in the blank margin below.
    penTo(150, 296, change + 0.55, 0.35);

    // "something you can see": a thumbnail of the chalk frame, sketched in the margin, and its caption.
    penTo(190, 300, see - 0.15, 0.25);
    tl.fromTo('.oc-sketch', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.7, ease: 'power1.inOut' }, see + 0.05);
    tl.to('.oc-pen-body', { fill: ink.pencil, duration: 0.15 }, see - 0.15);
    tl.to(pen, { keyframes: [{ x: 244, y: 300 }, { x: 252, y: 326 }, { x: 182, y: 326 }, { x: 190, y: 300 }], duration: 0.7, ease: 'none', onUpdate: place }, see + 0.05);
    tl.fromTo('.oc-fig', { opacity: 0 }, { opacity: 0.55, duration: 0.3 }, see + 0.7);
    penTo(300, 470, said + 0.3, 0.6, 'power2.in');

    everyFrame(tl, durationSec, (t) => theatre.paint(rig, lens.shot, t));
  }, { scope: theatre.root });

  return (
    <Theatre theatre={theatre}>
      <Dressing words={false}>
        <Spike at={SPIKE_A} label="A" angle={-4} />
        <Spike at={SPIKE_B} label="B" angle={3} colour={ink.tapeWhite} />
        <CrateAt at={SPIKE_A} />
        <DeskAt className="oc-desk-lamp" lamp={0}>
          <PromptBook style={{ left: BOOK.left, top: BOOK.top, transform: BOOK_TRANSFORM, transformOrigin: '50% 100%' }}
            left={<Typed size={13} style={{ padding: '26px 22px', opacity: 0.75 }}>PROMPT BOOK<br />ON CUE<br /><br />a short film<br />about four words<br /><br /><span style={{ fontSize: 10 }}>SM · standby</span></Typed>}
            right={
              <div style={{ position: 'absolute', inset: 0, padding: '22px 20px' }}>
                <Typed size={9} className="oc-label" style={{ fontFamily: 'inherit', opacity: 0.6 }}>BRIEF</Typed>
                <Typed size={12.5} className="oc-brief" style={{ marginTop: 6, width: 226 }}>{BRIEF}</Typed>
                <div className="oc-underline" style={{ position: 'absolute', left: 22, top: 80, width: 214, height: 2.4, background: ink.pencil, opacity: 0.85, transformOrigin: '0 50%', borderRadius: 2 }} />
                <div className="oc-brace" style={{ position: 'absolute', left: 26, top: 112, width: 8, height: 168, borderLeft: `2px solid ${ink.pencil}`, borderTop: `2px solid ${ink.pencil}`, borderBottom: `2px solid ${ink.pencil}`, opacity: 0.7, transformOrigin: '50% 0' }} />
                {BEATS.map((b, i) => (
                  <Pencil key={b.n} size={14} className={`oc-beat oc-beat-${b.n}`} style={{ position: 'absolute', left: BEAT_X, top: BEAT_TOP + i * BEAT_STEP, whiteSpace: 'nowrap', clipPath: 'inset(0 100% 0 0)' }}>
                    <span style={{ display: 'inline-block', width: 18, opacity: 0.7 }}>{b.n}</span>{b.title}
                  </Pencil>
                ))}
                {/* The three questions, answered for beat 01. */}
                {(['see', 'understand', 'next'] as const).map((k, i) => (
                  <div key={k}>
                    <Pencil size={10} className="oc-col-head" style={{ position: 'absolute', left: 132, top: 112 + i * 56, opacity: 0, textTransform: 'uppercase', letterSpacing: 1, color: ink.graphite }}>{k}</Pencil>
                    <Pencil size={10.5} className="oc-col-cell" style={{ position: 'absolute', left: 132, top: 126 + i * 56, width: 116, lineHeight: 1.15, opacity: 0, color: ink.pencil }}>{BEATS[0]![k]}</Pencil>
                  </div>
                ))}
                {/* Pencil lines drawn on by dash offset. Butt caps: with round caps an undrawn path still shows its start as a dot. */}
                <svg className="oc-abs" width={268} height={380} viewBox="0 0 268 380" style={{ left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
                  <path className="oc-circle" d={RING_PATH} fill="none" stroke={ink.red} strokeWidth="1.8" strokeLinecap="butt" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" opacity="0.9" />
                  <path className="oc-sketch" d="M 190 300 L 244 300 L 252 326 L 182 326 Z M 190 300 L 184 294 M 244 300 L 250 294" fill="none" stroke={ink.pencil} strokeWidth="1.4" strokeLinecap="butt" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" opacity="0.85" />
                </svg>
                <Typed size={8} className="oc-fig" style={{ position: 'absolute', left: 182, top: 332, opacity: 0 }}>fig. 1 — the frame</Typed>
              </div>
            } />
          {/* The pencil lives in book coordinates so it can write on the page; it is held down and to the right, off the notes. */}
          <div className="oc-abs" style={{ left: BOOK.left, top: BOOK.top, width: 560, height: 380, transform: BOOK_TRANSFORM, transformOrigin: '50% 100%', pointerEvents: 'none' }}>
            <div className="oc-abs oc-pen" style={{ left: 292, top: 0 }}><PencilProp length={96} angle={52} className="oc-pen-svg" /></div>
          </div>
          <CueLight style={CUE_LIGHT_STYLE} />
        </DeskAt>
      </Dressing>
    </Theatre>
  );
}
