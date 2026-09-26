import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue } from '@animspark/runtime';
import { Theatre, useTheatre } from '../components/Theatre';
import { BOOK, BOOK_TRANSFORM, CUE_LIGHT_STYLE, CrateAt, DeskAt, Dressing, GHOST, GhostlightAt, HungMarquee, SPIKE_B, TITLE_GAP, WORDS_GONE, hung, settleWords, workedRig } from '../components/Set';
import { CueLight, Ghostlight } from '../components/Fixtures';
import { CueSheet, PromptBook, Typed, type CueRow } from '../components/Book';
import { Flat, PaletteArt, SurfaceArt, TypeArt } from '../components/Flats';
import { Hand, HAND_JOINTS } from '../components/Hand';
import { Marquee, marqueeWidth } from '../components/Marquee';
import { Curtain } from '../components/Curtain';
import { ChalkText } from '../components/Marks';
import { camera, everyFrame, tween } from '../lib/camera';
import { floor, standAt } from '../lib/stage';
import { hit, run, sceneLength, texture, voice } from '../sound';
import { SYNC_LEAD, gel, handoff, ink } from '../theme';
import { BEATS, BRIEF, WORDS } from '../data/script';

gsap.registerPlugin(useGSAP);

/*
 * 08 · Curtain.
 * House lights. Everything that appeared comes back and stands in a line: the flats, the lanterns,
 * the desk, the crate, the four words. Each family bows on its name. The film's own cue sheet
 * unrolls, its rows chase, and the last row calls the curtain. The ghost light is left on.
 */
const vo = voice('08-curtain', 0.6);
const house = cue(vo, 'House lights').start;
const everything = cue(vo, 'Everything').start;
const bow = cue(vo, 'bow').start;
const theSet = cue(vo, 'the set').start;
const theLight = cue(vo, 'the light').start;
const theSound = cue(vo, 'the sound').start;
const theWords = cue(vo, 'the words').start;
const film = cue(vo, 'This film').start;
const called = cue(vo, 'called').start;
const sheet = cue(vo, 'cue sheet').start;
const said = cue(vo, 'sheet').end;
const curtain = said + 0.5;

const FLATS = [floor(-0.62, 0.62), floor(0, 0.66), floor(0.62, 0.62)];
const FLAT_W = 300, FLAT_H = 380;
/** The four words in one row for the call, sized to sit between the two lanterns (x 408–1512) with room to bow, and clear of the sheet that drops under them. */
const ROW_Y = 290, ROW_SCALE = 0.54, ROW_GAP = 44;
const ROW: Record<string, { x: number; scale: number }> = (() => {
  const widths = WORDS.map((w) => hung(w).width * ROW_SCALE);
  const total = widths.reduce((a, b) => a + b, 0) + ROW_GAP * (WORDS.length - 1);
  let x = 960 - total / 2;
  const out: Record<string, { x: number; scale: number }> = {};
  WORDS.forEach((w, i) => { out[w] = { x: x + widths[i]! / 2, scale: ROW_SCALE }; x += widths[i]! + ROW_GAP; });
  return out;
})();
/**
 * The line-up leaves every flat's painting visible: the flats stand at x 471–671, 861–1059 and
 * 1249–1449, so the crate takes the gap right of centre and the stage manager the gap left of it.
 * Both are inside the sheet's footprint (x 687–1233, y 360–776), so when it drops nothing pokes out.
 */
const CRATE_AT = floor(0.27, 0.3);
const HAND_AT = floor(-0.28, 0.3);
const SHEET = { top: 360, scale: 1.05 };
/** The four words bow one after another; wide enough apart that each bulb ping is heard on its own. */
const BOW_STEP = 0.13;
/**
 * After the curtain starts in (1.6 s to meet): the sheet behind it goes as the panels cover it; the
 * title sign fades up as they meet and its bulbs light after; the credit line follows, and holds
 * long enough to read before the bulbs go out.
 */
const CURTAIN_MET = 1.6, TITLE_IN = 1.4, TITLE_LIT = 1.8, NOTE_IN = 2.5, LIGHTS_OUT = 4.2;

/** The film's own cue sheet: the word each beat is called on, and what it did. */
const ROWS: CueRow[] = [
  { q: 'LX 1', page: '1', line: 'theatre', action: 'work lights bump on' },
  { q: 'FX 2', page: '2', line: 'sentence', action: 'pencil underlines the brief' },
  { q: 'FLY 3', page: '3', line: 'built once', action: 'three flats fly in' },
  { q: 'FX 4', page: '4', line: 'step', action: 'crate A → B, power3.inOut' },
  { q: 'LX 12', page: '5', line: 'go', action: 'spot full · CUE lit · crate lands' },
  { q: 'FLY 6', page: '6', line: 'moves', action: 'CUE out · TRACK in · cyc to steel' },
  { q: 'SQ 7', page: '7', line: 'notes', action: 'celesta; the bulbs read it' },
  { q: 'CURT 8', page: '8', line: 'cue sheet', action: 'curtain in · ghost light stays' },
];

export const sounds = [
  vo,
  hit('house-relay', 'relay', house - SYNC_LEAD, 0.9),
  texture('house-up', 'house', house, 1.0),
  texture('everyone-in', 'rope', everything - 0.2, 0.7, 1.7),
  texture('desk-back', 'slide', everything + 0.1, 0.5, 0.9),
  texture('crate-in', 'scrape', everything + 0.3, 0.6, 1.0),
  // Three flats land 150 ms apart (run() trims each clear of the next); the words ping as their bulbs light, as in 01.
  ...run('battenStop', [0, 1, 2].map((i) => ({ id: `flat-in-${i}`, at: everything + 1.2 + i * 0.15, volume: 0.5 })), 0.3),
  ...run('ping', WORDS.map((w, i) => ({ id: `word-lit-${i}`, at: everything + 1.5 + i * 0.12, volume: 0.35 })), 0.2),
  texture('bow-set', 'whoosh', theSet - 0.05, 0.5, 0.7),
  hit('bow-light', 'spot', theLight - SYNC_LEAD, 0.8),
  hit('bow-light-2', 'bulb', theLight + 0.15, 0.6),
  hit('bow-sound', 'switch', theSound - SYNC_LEAD, 0.8),
  hit('bow-sound-2', 'tick', theSound + 0.2, 0.6),
  ...run('ping', [0, 1, 2, 3].map((i) => ({ id: `bow-word-${i}`, at: theWords - SYNC_LEAD + i * BOW_STEP, volume: 0.5 })), 0.2),
  hit('sheet-drop', 'page', film + 0.05, 0.9),
  texture('sheet-unroll', 'whoosh', film, 0.4, 0.8),
  ...run('switch', ROWS.map((r, i) => ({ id: `row-${i}`, at: called + 0.05 + i * 0.13, volume: 0.4 })), 0.1),
  hit('sheet-last', 'go', sheet - SYNC_LEAD, 0.9),
  texture('curtain-in', 'curtain', curtain, 1.0),
  hit('curtain-stop', 'battenStop', curtain + 1.55, 0.6),
  texture('ghost-buzz', 'buzz', curtain + 1.6, 0.35, 3.6),
  // The title's bulbs light once the curtain has met (1.6 s), never over the words still showing through the gap.
  ...run('bulb', ['O', 'N', 'C', 'U', 'E'].map((ch, i) => ({ id: `title-${i}`, at: curtain + TITLE_LIT + i * 0.12, volume: 0.5 })), 0.1),
];
export const durationSec = sceneLength(sounds, 0.4, curtain + 5.4);

export default function CurtainCall() {
  const theatre = useTheatre();
  useGSAP(() => {
    const tl = gsap.timeline();
    settleWords(tl);
    const rig = workedRig();
    rig.work = 0.5; rig.cycOn = 0.7;
    rig.lamps[0]!.on = 0;
    const lx12 = rig.lamps.find((l) => l.id === 'lx12')!;
    lx12.on = 1.0; lx12.radius *= 1.25; Object.assign(lx12, { r: gel.straw[0], g: gel.straw[1], b: gel.straw[2] });
    const fill = rig.lamps.find((l) => l.id === 'fill')!, wash = rig.lamps.find((l) => l.id === 'wash')!;
    const ghost = rig.lamps[0]!;
    const lens = camera(tl, handoff.shots.house);
    lens.move({ x: 960, y: 560, zoom: 0.98 }, house, 1.6)
      .move({ x: 960, y: 540, zoom: 1.08 }, film - 0.3, 1.2)
      .move({ x: 960, y: 560, zoom: 1.0 }, curtain - 0.2, 1.8)
      .move({ x: 960, y: 596, zoom: 1.12 }, curtain + 2.0, 3.0, 'power1.inOut');

    // "House lights": the whole room comes up, warm.
    tween(tl, rig, { house: 1, work: 0.95, foot: 0.85, cycOn: 0.9, cycR: gel.amber[0], cycG: gel.amber[1], cycB: gel.amber[2], duration: 1.2, ease: 'power2.out' }, house - SYNC_LEAD);
    tween(tl, lx12, { on: 0.7, duration: 1.2 }, house);
    tween(tl, fill, { on: 0.55, duration: 1.2 }, house + 0.2);
    tween(tl, wash, { on: 0.5, duration: 1.2 }, house + 0.4);

    // "Everything you saw": the cast assembles.
    tl.set('.oc-flat-call', { y: -1000 }, 0);
    tl.to('.oc-flat-call', { y: 0, duration: 1.3, ease: 'power2.inOut', stagger: 0.15 }, everything - 0.1);
    for (const w of WORDS) {
      const rest = hung(w), to = ROW[w]!;
      tl.set(`.oc-hung-${w.toLowerCase()}`, { x: to.x - rest.centreX, y: WORDS_GONE, scale: to.scale / rest.scale, transformOrigin: '50% 50%' }, 0);
      tl.to(`.oc-hung-${w.toLowerCase()}`, { y: ROW_Y - rest.centreY, duration: 1.4, ease: 'power2.inOut' }, everything + 0.2 + WORDS.indexOf(w) * 0.12);
      tl.to(`.oc-hung-${w.toLowerCase()} .oc-mq-letter`, { '--lit': 1, duration: 0.2, stagger: 0.05 }, everything + 1.5 + WORDS.indexOf(w) * 0.12);
      const halo = rig.lamps.find((l) => l.id === `halo-${w}`)!;
      Object.assign(halo, { x: to.x, y: WORDS_GONE, tx: to.x, ty: WORDS_GONE });
      tween(tl, halo, { y: ROW_Y, ty: ROW_Y + 30, duration: 1.4, ease: 'power2.inOut' }, everything + 0.2 + WORDS.indexOf(w) * 0.12);
      tween(tl, halo, { on: 0.45, duration: 0.4 }, everything + 1.5 + WORDS.indexOf(w) * 0.12);
    }
    tl.set('.oc-desk', { x: -700 }, 0);
    tl.to('.oc-desk', { x: 0, duration: 1.2, ease: 'power2.inOut' }, everything + 0.1);
    tl.set('.oc-ghost-roll', { x: 800 }, 0);
    tl.to('.oc-ghost-roll', { x: 0, duration: 1.2, ease: 'power2.inOut' }, everything + 0.2);
    tween(tl, ghost, { on: 0.6, duration: 0.6 }, everything + 1.0);
    tl.set('.oc-crate-call', { x: SPIKE_B.x - CRATE_AT.x, y: SPIKE_B.y - CRATE_AT.y }, 0);
    tl.to('.oc-crate-call', { x: 0, y: 0, duration: 1.0, ease: 'power2.inOut' }, everything + 0.3);
    tween(tl, lx12, { tx: CRATE_AT.x, ty: CRATE_AT.y, duration: 1.0, ease: 'power2.inOut' }, everything + 0.3);
    tl.set('.oc-hand-call', { x: -500 }, 0);
    tl.to('.oc-hand-call', { x: 0, duration: 1.3, ease: 'power1.inOut' }, everything + 0.4);
    tl.set('.oc-hand-torso', { svgOrigin: HAND_JOINTS.torso }, 0);
    tl.set('.oc-hand-arm-f', { svgOrigin: HAND_JOINTS.armF }, 0);
    tl.set('.oc-hand-arm-b', { svgOrigin: HAND_JOINTS.armB }, 0);

    // "takes a bow": each family in turn.
    const bowIt = (sel: string, at: number, deg = 8, origin = '50% 100%') => {
      tl.to(sel, { rotation: deg, duration: 0.35, ease: 'power2.out', transformOrigin: origin, stagger: 0.06 }, at);
      tl.to(sel, { rotation: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)', stagger: 0.06 }, at + 0.4);
    };
    tl.to('.oc-hand-torso', { rotation: 24, duration: 0.4, ease: 'power2.out' }, bow - SYNC_LEAD);
    tl.to('.oc-hand-arm-f, .oc-hand-arm-b', { rotation: 40, duration: 0.4, ease: 'power2.out' }, bow - SYNC_LEAD);
    tl.to('.oc-hand-torso, .oc-hand-arm-f, .oc-hand-arm-b', { rotation: 0, duration: 0.7, ease: 'power2.inOut' }, bow + 0.8);
    bowIt('.oc-flat-call', theSet - SYNC_LEAD, -7, '50% 100%');
    bowIt('.oc-lantern', theLight - SYNC_LEAD, 14, '50% 0%');
    tween(tl, lx12, { on: 1.3, duration: 0.2, yoyo: true, repeat: 1 }, theLight - SYNC_LEAD);
    tween(tl, fill, { on: 1.0, duration: 0.2, yoyo: true, repeat: 1 }, theLight + 0.1);
    tween(tl, wash, { on: 1.0, duration: 0.2, yoyo: true, repeat: 1 }, theLight + 0.2);
    bowIt('.oc-ghost-roll svg', theLight + 0.1, 6);
    tl.to('.oc-cuelight', { '--red': 1, '--green': 0, duration: 0.05 }, theSound - SYNC_LEAD);
    tl.to('.oc-cuelight', { '--red': 0, '--green': 1, duration: 0.05 }, theSound + 0.2);
    tl.to('.oc-cuelight', { '--green': 0, duration: 0.3 }, theSound + 0.8);
    tween(tl, rig, { foot: 1.2, duration: 0.18, yoyo: true, repeat: 3 }, theSound - SYNC_LEAD);
    bowIt('.oc-desk', theSound, -4);
    for (const w of WORDS) {
      const i = WORDS.indexOf(w);
      tl.to(`.oc-hung-${w.toLowerCase()}`, { y: `+=26`, duration: 0.3, ease: 'power2.out' }, theWords - SYNC_LEAD + i * BOW_STEP);
      tl.to(`.oc-hung-${w.toLowerCase()}`, { y: `-=26`, duration: 0.7, ease: 'elastic.out(1, 0.5)' }, theWords + 0.32 + i * BOW_STEP);
      tl.to(`.oc-hung-${w.toLowerCase()} .oc-mq-letter`, { '--lit': 2.2, duration: 0.1, yoyo: true, repeat: 1, stagger: 0.04 }, theWords - SYNC_LEAD + i * BOW_STEP);
    }

    // "This film was called from its own cue sheet": the sheet unrolls and its rows chase.
    tl.set('.oc-callsheet', { y: -900 }, 0);
    tl.to('.oc-callsheet', { y: 0, duration: 0.8, ease: 'power3.out' }, film);
    ROWS.forEach((_, i) => {
      tl.to(`.oc-callsheet .oc-cue-row-${i}`, { backgroundColor: ink.tape, duration: 0.08 }, called + 0.05 + i * 0.13);
      if (i < ROWS.length - 1) tl.to(`.oc-callsheet .oc-cue-row-${i}`, { backgroundColor: 'rgba(0,0,0,0)', duration: 0.3 }, called + 0.05 + i * 0.13 + 0.2);
    });
    tl.to(`.oc-callsheet .oc-cue-row-${ROWS.length - 1}`, { backgroundColor: ink.cueGreen, duration: 0.1 }, sheet - SYNC_LEAD);

    // Curtain in. The ghost light rolls to the front and is left on; ON CUE lights above the curtain.
    tl.set('.oc-curtain-l', { xPercent: -100 }, 0);
    tl.set('.oc-curtain-r', { xPercent: 100 }, 0);
    tl.to('.oc-curtain-l, .oc-curtain-r', { xPercent: 0, duration: CURTAIN_MET, ease: 'power2.inOut' }, curtain);
    // The sheet (x 700–1220) is three-quarters covered at 1.2 s and gone as the panels meet; faded any earlier it would vanish in plain view.
    tl.to('.oc-callsheet', { opacity: 0, duration: 0.35, ease: 'power1.in' }, curtain + CURTAIN_MET - 0.35);
    tl.to('.oc-ghost-roll', { x: -(GHOST.x - 1180), duration: 1.5, ease: 'power1.inOut' }, curtain - 0.2);
    tween(tl, ghost, { tx: 1180, x: 1180, on: 0.9, duration: 1.5, ease: 'power1.inOut' }, curtain - 0.2);
    // As the curtain meets, the ghost light is the one thing in front of it.
    tl.fromTo('.oc-ghost-front', { opacity: 0 }, { opacity: 1, duration: 0.3 }, curtain + 1.25);
    tl.to('.oc-ghost-front', { y: -6, duration: 2.2, yoyo: true, repeat: -1, ease: 'sine.inOut' }, curtain + 1.5);
    tween(tl, rig, { house: 0.25, work: 0.15, foot: 0.3, duration: 1.8 }, curtain + 0.2);
    tween(tl, lx12, { on: 0, duration: 1.0 }, curtain);
    tween(tl, fill, { on: 0, duration: 1.0 }, curtain);
    tween(tl, wash, { on: 0, duration: 1.0 }, curtain);
    // The sign is in screen space in front of the curtain, over where the row of words hangs in the
    // world; it fades up only as the panels meet, so the two never show together.
    tl.fromTo('.oc-final', { opacity: 0, y: -30 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, curtain + TITLE_IN);
    tl.fromTo('.oc-final .oc-mq-letter', { '--lit': 0 }, { '--lit': 1, duration: 0.25, stagger: 0.1, ease: 'power2.out' }, curtain + TITLE_LIT);
    tl.fromTo('.oc-final-note', { opacity: 0 }, { opacity: 1, duration: 0.6 }, curtain + NOTE_IN);
    tl.to('.oc-final .oc-mq-letter', { '--lit': 0, duration: 0.3, stagger: 0.12 }, curtain + LIGHTS_OUT);
    tween(tl, rig, { house: 0.08, work: 0.05, foot: 0.1, duration: 1.2 }, curtain + LIGHTS_OUT);

    everyFrame(tl, durationSec, (t) => theatre.paint(rig, lens.shot, t));
  }, { scope: theatre.root });

  const onW = marqueeWidth('ON', 34), cueW = marqueeWidth('CUE', 34), gap = 34 * TITLE_GAP;
  const finalW = onW + gap + cueW;
  return (
    <Theatre theatre={theatre} above={
      <>
        <Curtain />
        <div className="oc-abs oc-final" style={{ left: 960 - finalW / 2, top: 120, width: finalW, height: 34 * 6, opacity: 0 }}>
          <Marquee word="ON" unit={34} style={{ left: -34 * 1.2, top: -34 * 1.4 }} />
          <Marquee word="CUE" unit={34} style={{ left: onW + gap - 34 * 1.2, top: -34 * 1.4 }} />
        </div>
        <ChalkText className="oc-final-note" x={960} y={400} size={30} align="middle" colour={ink.chalk} opacity={0.85}>a film about four borrowed words · made with AnimSpark</ChalkText>
        {/* Left on in front of the closed curtain, as every theatre does. */}
        <div className="oc-abs oc-ghost-front" style={{ left: 1120, top: 640, opacity: 0 }}>
          <div className="oc-abs" style={{ left: -240, top: -260, width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,210,140,.5), rgba(255,190,110,.12) 40%, rgba(255,190,110,0) 70%)', mixBlendMode: 'screen' }} />
          <Ghostlight lit={1} style={{ left: 0, top: 0 }} />
          <div className="oc-abs" style={{ left: -60, top: 400, width: 240, height: 60, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(255,200,130,.35), rgba(255,200,130,0) 70%)' }} />
        </div>
      </>
    }>
      <Dressing title={false} ghost={false} words={false}>
        {[<PaletteArt key="p" />, <TypeArt key="t" />, <SurfaceArt key="s" />].map((art, i) => (
          <Flat key={i} className="oc-flat-call" width={FLAT_W} height={FLAT_H} label={['PALETTE', 'TYPEFACE', 'SURFACE'][i]!}
            style={standAt(FLATS[i]!, FLAT_W, FLAT_H)}>{art}</Flat>
        ))}
        <DeskAt lamp={0.8}>
          <PromptBook style={{ left: BOOK.left, top: BOOK.top, transform: BOOK_TRANSFORM, transformOrigin: '50% 100%' }}
            left={<Typed size={13} style={{ padding: '26px 22px', opacity: 0.75 }}>PROMPT BOOK<br />ON CUE</Typed>} right={<Typed size={12.5} style={{ padding: '22px 20px' }}>{BRIEF}</Typed>} />
          <CueLight className="oc-cuelight" style={CUE_LIGHT_STYLE} />
        </DeskAt>
        <div className="oc-abs oc-ghost-roll" style={{ left: 0, top: 0 }}><GhostlightAt lit={1} /></div>
        <div className="oc-abs oc-crate-call" style={{ left: 0, top: 0 }}><CrateAt at={CRATE_AT} /></div>
        <div className="oc-abs oc-hand-call" style={{ left: 0, top: 0 }}><Hand style={standAt(HAND_AT, 160, 380)} /></div>
        {WORDS.map((w) => <HungMarquee key={w} word={w} className="oc-hung-lit" />)}
        {/* The film's own cue sheet flies in as a drop, under the row of words, on two lines from the grid. */}
        <div className="oc-abs oc-callsheet" style={{ left: 960 - 260, top: SHEET.top, width: 520, transformOrigin: '50% 0' }}>
          {[30, 490].map((x) => <div key={x} className="oc-abs" style={{ left: x - 1, top: -2000, width: 2, height: 2000, background: 'linear-gradient(180deg, rgba(160,150,130,0) 80%, rgba(160,150,130,.55))' }} />)}
          <CueSheet rows={ROWS} title="CUE SHEET · ON CUE · the whole film" flag="AS CALLED" style={{ left: 0, top: 0, transform: `scale(${SHEET.scale})`, transformOrigin: '50% 0' }} />
        </div>
      </Dressing>
    </Theatre>
  );
}
