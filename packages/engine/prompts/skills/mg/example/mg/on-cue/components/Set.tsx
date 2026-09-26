import { BATTENS, floor, standAt, type FloorPoint } from '../lib/stage';
import type { Timeline } from '../lib/camera';
import type { CSSProperties, Children, Key } from './types';
import { defaultRig, lamp, type Lamp, type Rig } from '../lib/rig';
import { gel, handoff, ink, type } from '../theme';
import { Marquee, marqueeWidth } from './Marquee';
import { Ghostlight, Lantern } from './Fixtures';
import { Crate, Desk } from './Props';
import { Chalk, ChalkDefs, ChalkText, floorPath } from './Marks';
import { WORDS, type Word } from '../data/script';

/**
 * Where everything lives. Scenes compose the same pieces from the same places, so a cut between two
 * scenes lands on the same world; only what a scene needs to move is moved.
 *
 * The floor plan, in one glance (viewer's left to right, downstage at the bottom):
 *   – prompt corner: the desk, half behind the stage-left leg (x ≤ 504)
 *   – spike A (x 672) and spike B (x 1220) at one depth; the crate slides between them
 *   – the ghost light just outside the chalk frame, stage right (x 1545)
 *   – the chalk frame itself: sx ±0.58, sz 0.22–0.84 (screen y 615–810)
 * and in the air:
 *   – lanterns at the batten ends (x 360 and 1560), so the centre is free to hang words in
 *   – the four words as one sign, two rows, y 246–512
 *   – the title, a flown sign that lands on the deck at the back of the frame
 */

const MARQUEE_UNIT = 18;

export interface Hung { x: number; y: number; scale: number; width: number; height: number; chain: number; centreX: number; centreY: number; batten: number }

/** A marquee word's hanging geometry: it hangs from its batten on chains, centred where the theme says. */
export function hung(word: Word): Hung {
  const { x: cx, y: cy, scale, batten } = handoff.marquee[word];
  const width = marqueeWidth(word, MARQUEE_UNIT) * scale;
  const height = 6 * MARQUEE_UNIT * scale;
  const top = cy - height / 2;
  const railY = top - MARQUEE_UNIT * 0.9 * scale;
  return { x: cx - width / 2, y: top, scale, width, height, chain: (railY - BATTENS[batten]!) / scale, centreX: cx, centreY: cy, batten };
}

/** The top row hangs in front of the lower row's chains. */
export function HungMarquee({ word, className = '' }: { word: Word; className?: string; key?: Key }) {
  const g = hung(word);
  return (
    <div className={`oc-abs oc-hung oc-hung-${word.toLowerCase()} ${className}`} style={{ left: g.x, top: g.y, width: g.width, height: g.height, transformOrigin: `50% ${-g.chain * g.scale}px`, zIndex: g.batten === 0 ? 3 : 2 }}>
      <Marquee word={word} unit={MARQUEE_UNIT} chain={g.chain} style={{ transform: `scale(${g.scale})`, transformOrigin: '0 0', left: -MARQUEE_UNIT * 1.2 * g.scale, top: -(g.chain + MARQUEE_UNIT * 1.4) * g.scale }} />
    </div>
  );
}

/** Where a single word hangs when it is the word of the scene, as a GSAP offset from its place in the sign. */
export function wordSlot(word: Word, at: { x: number; y: number } = handoff.word): { x: number; y: number } {
  const rest = hung(word);
  return { x: at.x - rest.centreX, y: at.y - rest.centreY };
}
/** 05 hangs CUE over spike A instead, so the lantern's line to the go chip passes under it; 06 flies it out from there. */
export const CUE_SLOT = { x: 700, y: handoff.word.y } as const;

/** The rig's soft halo for a lit marquee: no cone, just light around the letters and on the floor below. */
export function marqueeHalo(word: Word, on = 0): Lamp {
  const g = hung(word);
  return { id: `halo-${word}`, x: g.centreX, y: g.centreY, tx: g.centreX, ty: g.centreY + 40 * g.scale, radius: g.width * 0.62, r: gel.amber[0], g: gel.amber[1], b: gel.amber[2], on, cone: 0, flicker: 0, seed: word.length };
}

export const GHOST = floor(handoff.ghost.sx, handoff.ghost.sz);
export const DESK = floor(handoff.desk.sx, handoff.desk.sz);
export const SPIKE_A = floor(handoff.spikeA.sx, handoff.spikeA.sz);
export const SPIKE_B = floor(handoff.spikeB.sx, handoff.spikeB.sz);
/** Where the stage manager stands at the prompt desk (body x 449–517, behind its stage-left end), facing the book: 04 walks him here, 05 finds him here. */
export const SM_AT = floor(handoff.sm.sx, handoff.sm.sz);
export const SM_SIZE = { w: 160, h: 380 } as const;

/** The ghost light as a rig lamp: a nervous bulb with a small warm pool at its feet. */
export function ghostLamp(on = 1): Lamp {
  const l = lamp('ghost', GHOST.x, GHOST.y - 374 * GHOST.scale, GHOST.x, GHOST.y, 250 * GHOST.scale, gel.ghost, on, 0.35, 5);
  l.flicker = 0.32;
  return l;
}

/** The fixture itself is `.oc-ghostlight`; scenes that roll it wrap it in their own class, so nothing else on stage shares its selector. */
export function GhostlightAt({ className = '', lit = 1 }: { className?: string; lit?: number }) {
  return <Ghostlight className={`oc-ghostlight ${className}`} lit={lit} style={standAt(GHOST, 120, 420)} />;
}

export function CrateAt({ at, className = '', style }: { at: FloorPoint; className?: string; style?: CSSProperties }) {
  return <Crate className={`oc-crate ${className}`} style={{ ...standAt(at, 240, 200), ...style }} />;
}

/** The desk is drawn at 520 × 300 but stands a little smaller than the floor scale says: it is a small desk. */
export const DESK_SIZE = 0.7;
export const DESK_SCALE = DESK.scale * DESK_SIZE;
/** The prompt book's pose on the desk, shared by every scene that shows it (02 reads the page here). */
export const BOOK = { left: 30, top: -104, scale: 0.42 } as const;
export const BOOK_TRANSFORM = `perspective(1400px) rotateX(12deg) scale(${BOOK.scale})`;
/** The cue light sits at the back of the desk, past the book. */
export const CUE_LIGHT_STYLE: CSSProperties = { left: 430, top: 58, transform: 'scale(0.6)', transformOrigin: '0 0' };

/** The desk with whatever the scene lays on it (book, cue light, sheet), all scaled with the desk. */
export function DeskAt({ children, className = '', lamp = 0 }: { children?: Children; className?: string; lamp?: number }) {
  return (
    <div className={`oc-abs oc-desk ${className}`} style={{ left: DESK.x - 260, top: DESK.y - 300, width: 520, height: 300, transformOrigin: '50% 100%', transform: `scale(${DESK_SCALE})` }}>
      <Desk lamp={lamp} style={{ left: 0, top: 0 }} />
      {children}
    </div>
  );
}

/**
 * Two lanterns the house always shows, hung at the ends of the battens where a real first electric
 * keeps them and where nothing flown will pass through them: LX 12 (the spot on spike B) stage left,
 * a steel fill stage right. A third lamp, the rose wash, comes from front of house above the frame,
 * so only its pool is seen.
 */
export const LANTERNS = {
  lx12: { batten: BATTENS[0], x: 1560, aim: handoff.spikeB, gel: ink.brassHi },
  fill: { batten: BATTENS[1], x: 360, aim: { sx: -0.1, sz: 0.5 }, gel: '#9fb8ff' },
} as const;

export function lanternLamp(id: keyof typeof LANTERNS, radius: number, colour: readonly [number, number, number], on = 0): Lamp {
  const l = LANTERNS[id];
  const t = floor(l.aim.sx, l.aim.sz);
  return lamp(id, l.x, l.batten + 108, t.x, t.y, radius * t.scale, colour, on, 1, id.length + Math.round(l.x / 100));
}

export function washLamp(radius: number, colour: readonly [number, number, number], on = 0): Lamp {
  const t = floor(0.62, 0.72);
  return lamp('wash', 1500, -140, t.x, t.y, radius * t.scale, colour, on, 0.25, 7);
}

/** A lantern's lens point in world px: where a beam starts, and where 05 pins its LIGHT mark. */
export function lens(id: keyof typeof LANTERNS): { x: number; y: number } {
  const l = LANTERNS[id];
  return { x: l.x, y: l.batten + 108 };
}

export function LanternsOnBattens({ tilt = 0 }: { tilt?: number }) {
  return (
    <>
      {(Object.keys(LANTERNS) as (keyof typeof LANTERNS)[]).map((id) => {
        const l = LANTERNS[id];
        return <Lantern key={id} className={`oc-lantern oc-lantern-${id}`} gel={l.gel} tilt={tilt} style={{ left: l.x - 48, top: l.batten - 2 }} />;
      })}
    </>
  );
}

/* ─────────────────────────── the title ─────────────────────────── */

export const TITLE_UNIT = 22;
/** The word space in ON CUE, in glyph units: wider than the letter gap (1.3) by enough to read as two words. */
export const TITLE_GAP = 4.4;
export function titleGeometry() {
  const onW = marqueeWidth('ON', TITLE_UNIT), cueW = marqueeWidth('CUE', TITLE_UNIT), gap = TITLE_UNIT * TITLE_GAP;
  const w = onW + gap + cueW, h = 6 * TITLE_UNIT;
  const top = handoff.title.y - h / 2;
  const railY = top - TITLE_UNIT * 0.9;
  return { onW, cueW, gap, w, h, left: handoff.title.x - w / 2, top, chain: railY - BATTENS[0] };
}

/**
 * ON CUE as a flown marquee sign, hung where the four words were. Scenes fly it with `y` on
 * `.oc-title` (−900 is in the grid); its letters light through `.oc-title .oc-mq-letter`.
 */
export function HungTitle({ className = '', lit = 0 }: { className?: string; lit?: number }) {
  const g = titleGeometry();
  return (
    <div className={`oc-abs oc-title ${className}`} style={{ left: g.left, top: g.top, width: g.w, height: g.h, transformOrigin: `50% ${-g.chain}px` }}>
      <Marquee word="ON" unit={TITLE_UNIT} chain={g.chain} lit={lit} style={{ left: -TITLE_UNIT * 1.2, top: -(g.chain + TITLE_UNIT * 1.4) }} />
      <Marquee word="CUE" unit={TITLE_UNIT} chain={g.chain} lit={lit} style={{ left: g.onW + g.gap - TITLE_UNIT * 1.2, top: -(g.chain + TITLE_UNIT * 1.4) }} />
    </div>
  );
}

export function titleHalo(on = 0): Lamp {
  const g = titleGeometry();
  return { id: 'halo-title', x: handoff.title.x, y: handoff.title.y, tx: handoff.title.x, ty: handoff.title.y + 44, radius: g.w * 0.6, r: gel.amber[0], g: gel.amber[1], b: gel.amber[2], on, cone: 0, flicker: 0, seed: 9 };
}

/* ─────────────────────────── rig states scenes start from ─────────────────────────── */

/** Flown all the way into the grid, out of sight. */
export const WORDS_GONE = -900;

/** The rig as 01 leaves it: work lights on, cyc warm, footlights up, the ghost light lit, the words gone. 02–03 keep the title's halo. */
export function workedRig(titleLit = 0): Rig {
  const rig = defaultRig([
    ghostLamp(0.55),
    ...WORDS.map((w) => marqueeHalo(w, 0)),
    titleHalo(titleLit),
    lanternLamp('lx12', 240, gel.straw, 0),
    lanternLamp('fill', 380, gel.steel, 0),
    washLamp(420, gel.rose, 0),
  ]);
  rig.dark = 0.94;
  rig.work = 0.62;
  rig.cycOn = 0.5;
  rig.foot = 0.55;
  return rig;
}

/** Standing dressing 02–08 inherit from 01: chalk frame, title on the deck, lanterns, ghost light. */
export function Dressing({ title = true, words = true, frame = true, ghost = true, children }: { title?: boolean; words?: boolean; frame?: boolean; ghost?: boolean; children?: Children }) {
  return (
    <>
      <ChalkDefs />
      {frame && <Chalk className="oc-frame" d={floorPath(FRAME)} width={5} drawn={1} />}
      {frame && <FrameLabel />}
      {title && <HungTitle lit={1} />}
      {children}
      {ghost && <GhostlightAt />}
      <LanternsOnBattens />
      {words && WORDS.map((w) => <HungMarquee key={w} word={w} className="oc-hung-lit" />)}
    </>
  );
}

/** Put the words where the previous scene left them, at time 0 of this scene's own timeline. */
export function settleWords(tl: Timeline, y = WORDS_GONE, lit = 0): void {
  tl.set('.oc-hung-lit', { y }, 0);
  tl.set('.oc-hung-lit .oc-mq-letter', { '--lit': lit }, 0);
}

/** The battens carry the words to another height; their halos travel with them. */
export function flyWords(tl: Timeline, rig: Rig, toY: number, at: number, duration: number, ease = 'power2.inOut'): void {
  tl.to('.oc-hung-lit', { y: toY, duration, ease, stagger: 0.05 }, at);
  for (const w of WORDS) {
    const h = rig.lamps.find((l) => l.id === `halo-${w}`);
    if (!h) continue;
    const base = hung(w);
    tl.to(h, { y: base.centreY + toY, ty: base.centreY + 40 * base.scale + toY, duration, ease }, at);
  }
}

/** The chalk frame on the boards: the film's 1920 × 1080, and its label at the front-right corner, clear of the desk. */
export const FRAME = [[-0.58, 0.22], [0.58, 0.22], [0.58, 0.84], [-0.58, 0.84]] as const;
export const FRAME_FRONT = floor(0.58, 0.22);
export function FrameLabel({ className = 'oc-frame-size' }: { className?: string }) {
  return <ChalkText className={className} x={FRAME_FRONT.x - 12} y={FRAME_FRONT.y + 30 * FRAME_FRONT.scale} size={28 * FRAME_FRONT.scale} align="end" font={type.label} weight={600}>1920 × 1080</ChalkText>;
}
