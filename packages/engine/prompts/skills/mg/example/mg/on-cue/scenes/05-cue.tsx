import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue, duration } from '@animspark/runtime';
import { Theatre, useTheatre } from '../components/Theatre';
import { BATTENS, standAt } from '../lib/stage';
import { BOOK, BOOK_TRANSFORM, CUE_LIGHT_STYLE, CUE_SLOT, CrateAt, DESK, DESK_SCALE, DeskAt, Dressing, HungMarquee, SM_AT, SM_SIZE, SPIKE_A, SPIKE_B, WORDS_GONE, hung, lens as lensOf, settleWords, workedRig } from '../components/Set';
import { CueLight } from '../components/Fixtures';
import { CueSheet, PromptBook, Typed } from '../components/Book';
import { Hand, HAND_JOINTS } from '../components/Hand';
import { Waveform, type Chip } from '../components/Waveform';
import { chipsFor } from '../lib/words';
import { ChalkText, Spike } from '../components/Marks';
import { camera, everyFrame, tween } from '../lib/camera';
import { hit, run, sceneLength, texture, voice } from '../sound';
import { SYNC_LEAD, gel, handoff, ink, type } from '../theme';
import { BRIEF } from '../data/script';

gsap.registerPlugin(useGSAP);

/*
 * 05 · Cue.
 * The word CUE flies in. At the prompt desk the stage manager reads the line off the cue sheet,
 * where its waveform is printed, puts LX 12 on standby, and on "go" three things happen in one
 * frame: the spot snaps full, the marquee lights, the crate lands its hop, with one sound. Then the
 * strip rises off the sheet into the air and grows; every spoken word sits on it at its measured
 * second; "go" is the cue, and light, sound and motion are shown hanging from the same syllable.
 */
const vo = voice('05-cue', 0.6);
const theCue = cue(vo, 'the cue', { occurrence: 1 }).start;
const manager = cue(vo, 'stage manager').start;
const listens = cue(vo, 'listens').start;
const lights = cue(vo, 'Lights twelve').start; // 'Lights' alone also matches 'light, sound'
const go = cue(vo, 'go. Here').start;
const here = cue(vo, 'Here, the').start;
const spoken = cue(vo, 'spoken word').start;
const isTheCue = cue(vo, 'the cue', { occurrence: 2 }).start;
const light = cue(vo, 'light, sound').start;
const sound = cue(vo, 'sound and motion').start;
const motion = cue(vo, 'motion').start;
const same = cue(vo, 'same syllable').start;
const said = cue(vo, 'syllable').end;

/** Every spoken word of this line, placed by its measured start: the chips on the strip. */
const WORDS = ['Then', 'the', 'cue', 'A', 'stage', 'manager', 'listens', 'and', 'calls', 'it', 'Lights', 'twelve', 'go', 'Here', 'the', 'spoken', 'word', 'is', 'the', 'cue', 'and', 'light', 'sound', 'and', 'motion', 'land', 'on', 'the', 'same', 'syllable'];
const CHIPS: Chip[] = chipsFor(vo, WORDS, 'go');
const GO_CHIP = CHIPS.findIndex((c) => c.hot);

/**
 * The strip in the air: hung from the first batten between the two lanterns (its chains at x 434
 * and 1486 clear both), under CUE (bottom y 354) and above the crate (top y 590): the four rows of
 * chips this line needs end at 566. 1100 px for 13 s gives thirty words room to sit on their own seconds.
 */
const STRIP = { left: 410, top: 386, w: 1100, h: 82 };
const goX = STRIP.left + ((CHIPS[GO_CHIP]!.at) / duration(vo)) * STRIP.w;
const CUE_AT = CUE_SLOT;
const SHEET_ROWS = [
  { q: 'LX 11', page: '3', line: 'a settle after', action: 'crate spot to 45%' },
  { q: 'SQ 4', page: '3', line: 'the character', action: 'room tone under' },
  { q: 'LX 12', page: '4', line: 'go', action: 'spot full · CUE lit · crate lands' },
  { q: 'LX 13', page: '4', line: 'same syllable', action: 'cyc to steel' },
];
const SHEET_FOOT = 52;
/**
 * The stage manager is on his mark from 04: behind the desk's near end (body x 449–517), facing the
 * book, his front hand hanging over the cue light (x 449–478, y 713–745). In the sheet close-up his
 * torso shows above the desk top at the frame's top edge, and the hand comes down into it on "go".
 */
const HAND_AT = SM_AT;
const LENS = lensOf('lx12');
const CRATE_EDGE = { x: SPIKE_B.x - 88 * SPIKE_B.scale, y: SPIKE_B.y - 80 * SPIKE_B.scale };
/** The three marks keep clear of the crate (x ≥ 1143 from y 590) and of the desk corner (x ≤ 517): SOUND sits under the strip's right half, its label to the left of its dot. */
const chipsBottom = STRIP.top + STRIP.h + 78;
const SOUND_DOT = { x: goX + 120, y: chipsBottom + 54 };
const SAME_LINE_END = chipsBottom + 174;

export const sounds = [
  vo,
  texture('cue-word-down', 'rope', theCue - 0.7, 0.6, 1.4),
  hit('cue-word-stop', 'battenStop', theCue + 0.75, 0.6),
  texture('spot-hum', 'hum', 0, 0.35, 4.2),
  hit('sheet-down', 'page', manager + 0.05, 0.9),
  texture('listen-strip', 'pencil', listens + 0.05, 0.35, 0.5),
  hit('standby', 'switch', lights - SYNC_LEAD, 0.9),
  hit('marker', 'chalkTap', lights + 0.1, 0.5),
  hit('go-button', 'go', go - SYNC_LEAD, 1),
  hit('go-relay', 'relay', go - SYNC_LEAD, 0.8),
  hit('go-spot', 'spot', go - SYNC_LEAD + 0.02, 1),
  hit('go-marquee', 'ping', go - SYNC_LEAD + 0.03, 0.7),
  hit('go-crate', 'thud', go - SYNC_LEAD + 0.24, 0.8),
  texture('strip-up', 'whoosh', here - 0.1, 0.6, 0.9),
  // Chips pop every 45 ms; run() sounds every other one so no pat rings over the next.
  ...run('tape', CHIPS.map((c, i) => ({ id: `chip-${i}`, at: here + 0.35 + i * 0.045, volume: 0.25 })), 0.1),
  hit('mark-light', 'bulb', light - SYNC_LEAD, 0.8),
  hit('mark-sound', 'tick', sound - SYNC_LEAD, 0.8),
  hit('mark-motion', 'crate', motion - SYNC_LEAD, 0.6, 0.3),
  hit('same-line', 'relay', same - SYNC_LEAD, 0.6),
];
export const durationSec = sceneLength(sounds, 0.9, said + 1.7);

export default function Cue() {
  const theatre = useTheatre();
  useGSAP(() => {
    const tl = gsap.timeline();
    settleWords(tl);
    const rig = workedRig();
    rig.work = 0.4;
    const lx12 = rig.lamps.find((l) => l.id === 'lx12')!;
    lx12.on = 0.45;
    const cueHalo = rig.lamps.find((l) => l.id === 'halo-CUE')!;
    const cueRest = hung('CUE');
    // CUE flies down from the grid into its slot, dark, and lights on "go".
    Object.assign(cueHalo, { on: 0, x: CUE_AT.x, y: CUE_AT.y, tx: CUE_AT.x, ty: CUE_AT.y + 40 });
    tl.set('.oc-hung-cue', { x: CUE_AT.x - cueRest.centreX, y: -900 }, 0);
    tl.to('.oc-hung-cue', { y: CUE_AT.y - cueRest.centreY, duration: 1.4, ease: 'power2.inOut' }, theCue - 0.7);
    tl.to('.oc-hung-cue', { y: CUE_AT.y - cueRest.centreY - 6, duration: 0.5, ease: 'elastic.out(1, 0.5)' }, theCue + 0.75);

    // The cue sheet's centre in world px (desk-local 360, 190 under the desk's scale), for the lens to read the LX 12 row.
    const sheetAt = { x: DESK.x + (360 - 260) * DESK_SCALE, y: DESK.y + (190 - 300) * DESK_SCALE };
    const lens = camera(tl, handoff.shots.crateB);
    // To the prompt corner with desk and stage manager in one frame; then onto the sheet, with the
    // manager's torso behind the desk at the top edge, so the standby hand and the go can be seen.
    lens.move({ x: 760, y: 440, zoom: 1.3 }, theCue - 0.6, 1.6)
      .move({ x: 520, y: 760, zoom: 2.2, roll: -1 }, manager - 0.4, 1.2)
      .move({ x: sheetAt.x + 10, y: sheetAt.y, zoom: 4.2, roll: -1 }, listens + 0.3, 0.9)
      .move({ x: SPIKE_B.x - 60, y: SPIKE_B.y - 200, zoom: 1.35, roll: 0 }, go - SYNC_LEAD, 0.28, 'power4.out')
      .move({ x: 900, y: 480, zoom: 1.25 }, here - 0.2, 1.4)
      // A slow creep while the marks are read, so the long diagram beat is never a freeze frame.
      .move({ x: 930, y: 468, zoom: 1.21 }, here + 1.3, said - (here + 1.3), 'none')
      .move({ ...handoff.shots.house }, said + 0.4, 1.8);
    // At 4× the chalk frame's edge behind the desk becomes a 20 px white bar across the page: take it down while we read.
    tl.to('.oc-frame, .oc-frame-size', { opacity: 0.25, duration: 0.6 }, manager - 0.4);
    tl.to('.oc-frame, .oc-frame-size', { opacity: 1, duration: 0.4 }, go - SYNC_LEAD);

    // The stage manager at the desk: leans in to listen, raises a hand on "Lights twelve" (standby), and
    // drops it on "go": the call is the gesture, the desk does the rest. Then he stands easy.
    tl.set('.oc-hand-torso', { svgOrigin: HAND_JOINTS.torso }, 0);
    tl.set('.oc-hand-arm-f', { svgOrigin: HAND_JOINTS.armF }, 0);
    tl.set('.oc-hand-leg-f', { svgOrigin: HAND_JOINTS.legF }, 0);
    tl.set('.oc-hand-leg-b', { svgOrigin: HAND_JOINTS.legB }, 0);
    tl.to('.oc-hand-torso', { rotation: -6, duration: 0.6, ease: 'power2.out' }, listens - 0.2);
    tl.to('.oc-hand-arm-f', { rotation: -165, duration: 0.5, ease: 'power2.out' }, lights - 0.3);
    tl.to('.oc-hand-arm-f', { rotation: -20, duration: 0.16, ease: 'power3.in' }, go - SYNC_LEAD - 0.14);
    tl.to('.oc-hand-arm-f', { rotation: -28, duration: 0.3, ease: 'power2.out' }, go + 0.05);
    tl.to('.oc-hand-torso', { rotation: 0, duration: 0.8, ease: 'power2.inOut' }, here);
    tl.to('.oc-hand-arm-f', { rotation: 0, duration: 0.7, ease: 'power2.inOut' }, here + 0.3);

    // The sheet comes down onto the desk; its printed strip listens; standby on "Lights".
    tl.fromTo('.oc-sheet', { y: -60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'power2.out' }, manager);
    tween(tl, { v: 0 }, { v: 1, duration: duration(vo), ease: 'none', onUpdate() { theatre.root.current?.querySelectorAll<HTMLElement>('.oc-wave').forEach((el) => el.style.setProperty('--play', String((this.targets()[0] as { v: number }).v))); } }, vo.at);
    tl.to('.oc-cue-row-2', { backgroundColor: ink.tape, duration: 0.15 }, lights - SYNC_LEAD);
    tl.to('.oc-cuelight', { '--red': 1, duration: 0.05 }, lights - SYNC_LEAD);
    tl.fromTo('.oc-standby', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3 }, lights + 0.05);

    // GO. One instant: the lamp, the letters, the crate, the cue light, the sound.
    const at = go - SYNC_LEAD;
    tl.to('.oc-cuelight', { '--red': 0, '--green': 1, duration: 0.04 }, at);
    tween(tl, lx12, { on: 1.45, radius: lx12.radius * 1.25, r: gel.straw[0], g: gel.straw[1], b: gel.straw[2], duration: 0.06, ease: 'power4.out' }, at);
    tween(tl, lx12, { on: 1.0, duration: 0.5, ease: 'power2.out' }, at + 0.06);
    tl.to('.oc-hung-cue .oc-mq-letter', { '--lit': 1, duration: 0.05 }, at);
    tween(tl, cueHalo, { on: 0.7, duration: 0.15 }, at);
    tl.to('.oc-crate-hop', { y: -34, duration: 0.24, ease: 'power2.out' }, at - 0.24);
    tl.to('.oc-crate-hop', { y: 0, duration: 0.22, ease: 'power3.in' }, at);
    tl.to('.oc-crate-hop', { scaleY: 0.94, scaleX: 1.04, duration: 0.08, ease: 'power2.out' }, at + 0.22)
      .to('.oc-crate-hop', { scaleY: 1, scaleX: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' }, at + 0.3);
    tl.fromTo('.oc-go-flash', { opacity: 0.55 }, { opacity: 0, duration: 0.35, ease: 'power2.out' }, at);
    tl.fromTo('.oc-go-word', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'back.out(2.5)' }, at);
    tl.to('.oc-go-word', { opacity: 0, duration: 0.4 }, here - 0.3);
    tween(tl, rig, { work: 0.3, duration: 0.4 }, at);

    // "Here, the spoken word is the cue": the strip rises off the sheet into the air and grows; every word sits on its second.
    tl.set('.oc-strip-air', { opacity: 0, scale: 0.3, transformOrigin: '0% 100%' }, 0);
    tl.to('.oc-sheet, .oc-standby', { opacity: 0, duration: 0.3 }, here - 0.1);
    tl.to('.oc-strip-air', { opacity: 1, scale: 1, duration: 0.9, ease: 'power3.inOut' }, here - 0.1);
    tl.fromTo('.oc-strip-air .oc-chipword', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.25, ease: 'back.out(2)', stagger: 0.045 }, here + 0.35);
    tl.fromTo('.oc-strip-air .oc-chip-mark', { opacity: 0 }, { opacity: 1, duration: 0.2, stagger: 0.045 }, here + 0.35);
    tl.fromTo(`.oc-strip-air .oc-chipword-${GO_CHIP}`, { scale: 1 }, { scale: 1.35, duration: 0.25, ease: 'back.out(3)', yoyo: true, repeat: 1 }, spoken);
    tl.fromTo('.oc-code', { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, isTheCue);

    // Light, sound, motion: three marks that all hang from the "go" syllable.
    for (const [k, at] of [['light', light], ['sound', sound], ['motion', motion]] as const) {
      tl.fromTo(`.oc-mark-${k}.oc-mark-dot`, { opacity: 0, scale: 0.2, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(3)' }, at - SYNC_LEAD);
      tl.fromTo(`.oc-mark-${k}.oc-mark-label`, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, at - SYNC_LEAD);
      tl.fromTo(`.oc-mark-${k}.oc-mark-line`, { opacity: 0, strokeDashoffset: 1 }, { opacity: 1, strokeDashoffset: 0, duration: 0.5, ease: 'power2.inOut' }, at - SYNC_LEAD + 0.1);
    }
    tween(tl, lx12, { on: 1.3, duration: 0.12, yoyo: true, repeat: 1 }, light - SYNC_LEAD);
    tl.to('.oc-crate-hop', { y: -18, duration: 0.18, ease: 'power2.out', yoyo: true, repeat: 1 }, motion - SYNC_LEAD);
    // "land on the same syllable": one red line through the go chip, the lamp flares, the letters pulse.
    tl.fromTo('.oc-same-line', { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.35, ease: 'power3.out', transformOrigin: '50% 0%' }, same - SYNC_LEAD);
    tween(tl, cueHalo, { on: 1.0, duration: 0.15, yoyo: true, repeat: 1 }, same - SYNC_LEAD);
    tween(tl, lx12, { on: 1.25, duration: 0.15, yoyo: true, repeat: 1 }, same - SYNC_LEAD);
    tl.fromTo('.oc-same-word', { opacity: 0 }, { opacity: 1, duration: 0.35 }, same + 0.1);

    // Hand-off: the diagram is struck. The strip lifts and is gone before its top reaches CUE's letters
    // (bottom y 354, 32 px above it), so it never prints behind the sign; the marks and captions go,
    // and the stage manager walks off into the prompt corner (behind the leg at x 300), so 06 opens
    // on the crate under its spot with CUE lit and nothing else to account for.
    tl.to('.oc-strip-air', { y: WORDS_GONE, duration: 1.2, ease: 'power2.in' }, said + 0.3);
    tl.to('.oc-strip-air', { opacity: 0, duration: 0.4, ease: 'none' }, said + 0.3); // gone at 0.4 s; the top passes y 354 at 0.35 s
    tl.to('.oc-mark-dot, .oc-mark-label, .oc-mark-line, .oc-same-line, .oc-same-word, .oc-code', { opacity: 0, duration: 0.5 }, said + 0.3);
    tl.to('.oc-sm', { x: 130 - HAND_AT.x, duration: 1.4, ease: 'power1.inOut' }, said + 0.2);
    tl.to('.oc-hand-leg-f', { rotation: 16, duration: 0.3, yoyo: true, repeat: 3, ease: 'sine.inOut' }, said + 0.25);
    tl.to('.oc-hand-leg-b', { rotation: -16, duration: 0.3, yoyo: true, repeat: 3, ease: 'sine.inOut' }, said + 0.25);

    everyFrame(tl, durationSec, (t) => theatre.paint(rig, lens.shot, t));
  }, { scope: theatre.root });

  return (
    <Theatre theatre={theatre}>
      <Dressing title={false} words={false}>
        <Spike at={SPIKE_A} label="A" angle={-4} />
        <Spike at={SPIKE_B} label="B" angle={3} colour={ink.tapeWhite} />
        {/* The stage manager, on his mark from 04 and facing the desk, in a wrapper the exit can slide. */}
        <div className="oc-abs oc-sm" style={{ left: 0, top: 0 }}>
          <Hand style={{ ...standAt(HAND_AT, SM_SIZE.w, SM_SIZE.h), transform: `${standAt(HAND_AT, SM_SIZE.w, SM_SIZE.h).transform} scaleX(-1)` }} />
        </div>
        <DeskAt className="oc-desk-lamp" lamp={1}>
          <PromptBook style={{ left: BOOK.left, top: BOOK.top, transform: BOOK_TRANSFORM, transformOrigin: '50% 100%' }}
            left={<Typed size={13} style={{ padding: '26px 22px', opacity: 0.75 }}>PROMPT BOOK<br />ON CUE</Typed>} right={<Typed size={12.5} style={{ padding: '22px 20px' }}>{BRIEF}</Typed>} />
          <CueLight className="oc-cuelight" style={CUE_LIGHT_STYLE} />
          {/* The cue sheet lands on the open book, propped the same way; the line's waveform is printed along its foot. */}
          <CueSheet className="oc-sheet" rows={SHEET_ROWS} footerHeight={SHEET_FOOT} style={{ left: 100, top: -8, transform: 'perspective(1400px) rotateX(12deg) scale(0.55) rotate(-1.5deg)', transformOrigin: '50% 100%', opacity: 0 }}
            footer={<Waveform className="oc-strip-desk" id="05-cue" seconds={duration(vo)} width={476} height={40} paper={false} style={{ left: 0, top: 6 }} />} />
          {/* The call, chalked on the wall over the desk's near end: right of the leg (world x 300, desk x 187) and above the
              lamp shade (desk x 322–396 from y 30), so the whole line shows in the sheet close-up. */}
          <div className="oc-abs oc-standby oc-label" style={{ left: 216, top: 0, fontSize: 12, color: ink.cueRed, opacity: 0, letterSpacing: 2, whiteSpace: 'nowrap' }}>STANDBY LX 12</div>
        </DeskAt>

        {/* The crate under LX 12, ready to land on the word. GSAP hops and squashes `.oc-crate-hop` about the crate's feet
            (scale relative to 1); the depth scale stays on the crate inside, so the elastic settle to 1 lands it at its own size. */}
        <div className="oc-abs oc-crate-hop" style={{ left: 0, top: 0, transformOrigin: `${SPIKE_B.x}px ${SPIKE_B.y}px` }}><CrateAt at={SPIKE_B} /></div>
        <HungMarquee word="CUE" className="oc-hung-lit" />
        <div className="oc-abs oc-go-flash" style={{ inset: 0, background: 'radial-gradient(ellipse at 63% 60%, rgba(255,235,200,.9), rgba(255,235,200,0) 55%)', opacity: 0, mixBlendMode: 'screen' }} />
        <ChalkText className="oc-go-word" x={SPIKE_B.x} y={SPIKE_B.y - 520 * SPIKE_B.scale} size={120} align="middle" font={type.marquee} colour={ink.chalk} opacity={0.95}>GO</ChalkText>

        {/* The strip in the air, hung from the batten: the line as it was said, one chip per word. */}
        <div className="oc-abs oc-strip-air" style={{ left: STRIP.left, top: STRIP.top, width: STRIP.w, height: STRIP.h, opacity: 0 }}>
          {[24, STRIP.w - 24].map((x) => <div key={x} className="oc-abs" style={{ left: x - 1, top: BATTENS[0] - STRIP.top, width: 2, height: STRIP.top - BATTENS[0], background: 'linear-gradient(180deg, rgba(160,150,130,.15), rgba(160,150,130,.6))' }} />)}
          <Waveform id="05-cue" seconds={duration(vo)} width={STRIP.w} height={STRIP.h} chips={CHIPS} style={{ left: 0, top: 0 }} />
        </div>
        {/* The call in code, as a caption right of the sign (which ends at x 831), above the line to the LX 12 lantern, which passes y 303 at x 1090. */}
        <div className="oc-abs oc-code oc-type" style={{ left: 850, top: 268, width: 240, textAlign: 'left', fontSize: 20, color: ink.cream, opacity: 0, textShadow: '0 2px 6px rgba(0,0,0,.6)' }}>cue(voice, 'go').start</div>

        {/* Light, sound, motion: three marks, at the lantern, under the strip and at the crate, each tied to the go chip. */}
        <svg className="oc-abs" width={1920} height={1080} viewBox="0 0 1920 1080" style={{ left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
          <path className="oc-mark-light oc-mark-line" d={`M${LENS.x} ${LENS.y} L${goX} ${STRIP.top - 6}`} stroke={ink.brassHi} strokeWidth={3} fill="none" pathLength={1} strokeDasharray="1" strokeDashoffset="1" strokeLinecap="round" opacity={0.9} />
          <path className="oc-mark-sound oc-mark-line" d={`M${SOUND_DOT.x} ${SOUND_DOT.y} L${goX} ${chipsBottom}`} stroke={ink.pencil} strokeWidth={3} fill="none" pathLength={1} strokeDasharray="1" strokeDashoffset="1" strokeLinecap="round" opacity={0.9} />
          <path className="oc-mark-motion oc-mark-line" d={`M${CRATE_EDGE.x} ${CRATE_EDGE.y} L${goX} ${chipsBottom}`} stroke={ink.red} strokeWidth={3} fill="none" pathLength={1} strokeDasharray="1" strokeDashoffset="1" strokeLinecap="round" opacity={0.9} />
          <circle className="oc-mark-light oc-mark-dot" cx={LENS.x} cy={LENS.y} r={9} fill={ink.brassHi} />
          <circle className="oc-mark-sound oc-mark-dot" cx={SOUND_DOT.x} cy={SOUND_DOT.y} r={9} fill={ink.pencil} />
          <circle className="oc-mark-motion oc-mark-dot" cx={CRATE_EDGE.x} cy={CRATE_EDGE.y} r={9} fill={ink.red} />
        </svg>
        <div className="oc-abs oc-mark-light oc-mark-label oc-label" style={{ left: LENS.x - 164, top: LENS.y - 12, fontSize: 22, color: ink.brassHi, letterSpacing: 3, textShadow: '0 2px 6px rgba(0,0,0,.7)' }}>LIGHT</div>
        <div className="oc-abs oc-mark-sound oc-mark-label oc-label" style={{ left: SOUND_DOT.x - 134, top: SOUND_DOT.y - 14, width: 110, textAlign: 'right', fontSize: 22, color: ink.pencil, letterSpacing: 3, textShadow: '0 2px 6px rgba(0,0,0,.7)' }}>SOUND</div>
        <div className="oc-abs oc-mark-motion oc-mark-label oc-label" style={{ left: CRATE_EDGE.x - 128, top: CRATE_EDGE.y - 4, fontSize: 22, color: ink.red, letterSpacing: 3, textShadow: '0 2px 6px rgba(0,0,0,.7)' }}>MOTION</div>
        {/* The red line through "go" runs down to the boards; its caption lies on the floor in front of the crate (whose foot is y 715). */}
        <div className="oc-abs oc-same-line" style={{ left: goX - 2, top: STRIP.top - 30, width: 4, height: SAME_LINE_END - (STRIP.top - 30), background: ink.red, opacity: 0, boxShadow: `0 0 18px ${ink.red}` }} />
        <ChalkText className="oc-same-word" x={goX + 22} y={SAME_LINE_END + 26} size={30} opacity={0.9}>one syllable, three things</ChalkText>
      </Dressing>
    </Theatre>
  );
}
