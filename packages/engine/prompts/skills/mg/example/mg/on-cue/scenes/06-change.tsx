import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue } from '@animspark/runtime';
import { Theatre, useTheatre } from '../components/Theatre';
import { BOOK, BOOK_TRANSFORM, CUE_LIGHT_STYLE, CUE_SLOT, CrateAt, DeskAt, Dressing, GhostlightAt, HungMarquee, SPIKE_A, SPIKE_B, WORDS_GONE, hung, settleWords, wordSlot, workedRig } from '../components/Set';
import { CueLight } from '../components/Fixtures';
import { PromptBook, Typed } from '../components/Book';
import { Flat } from '../components/Flats';
import { Chalk, ChalkText, Spike } from '../components/Marks';
import { camera, everyFrame, tween } from '../lib/camera';
import { floor, standAt } from '../lib/stage';
import { hit, run, sceneLength, texture, voice } from '../sound';
import { SYNC_LEAD, gel, handoff, ink, type } from '../theme';
import { BRIEF } from '../data/script';

gsap.registerPlugin(useGSAP);

/*
 * 06 · Change.
 * A scene change. A chalk ring is drawn round the crate: it is the one thing that holds still. Then
 * the world goes: CUE flies out, TRACK flies in, the cyc turns to steel, two new flats come down,
 * the spikes are re-laid, the ghost light rolls off. The lens pushes in slowly on the crate the
 * whole time, so the eye is never asked to look for anything.
 */
const vo = voice('06-change', 0.5);
const change = cue(vo, 'change').start;
const holds = cue(vo, 'holds').start;
const still = cue(vo, 'still').start;
const world = cue(vo, 'world').start;
const moves = cue(vo, 'moves').start;
const around = cue(vo, 'around').start;
const eye = cue(vo, 'eye').start;
const never = cue(vo, 'never').start;
const search = cue(vo, 'search').start;
const said = cue(vo, 'search').end;

/** Two plain flats at the sides, inside the legs and clear of the word slot; 07 opens with them in the same places and flies them out as its rail comes in. */
export const NEW_FLATS = [floor(-0.62, 0.5), floor(0.8, 0.46)];
export const FLAT_W = 300, FLAT_H = 460;
export const NEW_SPIKES = [floor(-0.25, 0.62), floor(0.62, 0.7)];

/** An act flat, plain painted with its number chalked on: one drawing, so the cut into 07 changes nothing on it. */
export function ActFlat({ i, className = '' }: { i: number; className?: string; key?: number }) {
  return (
    <Flat className={`oc-flat-new ${className}`} width={FLAT_W} height={FLAT_H} style={standAt(NEW_FLATS[i]!, FLAT_W, FLAT_H)}>
      <div className="oc-abs" style={{ inset: 0, background: `linear-gradient(180deg, #23345a, #182742 60%, #10192c)` }} />
      <div className="oc-abs" style={{ inset: 0, backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,.04) 0 2px, transparent 2px 9px)' }} />
      <div className="oc-hand" style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', fontSize: 150, color: ink.chalk, opacity: 0.85 }}>{['II', 'III'][i]}</div>
      <div className="oc-label" style={{ position: 'absolute', left: 0, right: 0, top: 330, textAlign: 'center', fontSize: 18, color: ink.chalk, opacity: 0.6, letterSpacing: 4 }}>{['ACT TWO', 'ACT THREE'][i]}</div>
    </Flat>
  );
}
/** The chalk eye on the apron, above the footlights. */
const EYE = { x: 960, y: 900 };

export const sounds = [
  vo,
  texture('spot-hum', 'hum', 0, 0.3, 4.2),
  texture('chalk-ring', 'chalk', holds - 0.05, 0.8, 0.85),
  texture('chalk-still', 'chalk', still + 0.05, 0.6, 0.5, 0.3),
  // One rope run carries the words out and the new flats in; three battens land in turn (run() trims each clear of the next).
  texture('fly', 'rope', world - 0.3, 0.7, 1.7),
  ...run('battenStop', [
    { id: 'track-land', at: around + 0.9, volume: 0.5 },
    { id: 'flat-land-0', at: moves + 1.35, volume: 0.7 },
    { id: 'flat-land-1', at: moves + 1.55, volume: 0.6 },
  ]),
  ...run('tape', [{ id: 'tape-1', at: around + 0.1, volume: 0.6 }, { id: 'tape-2', at: around + 0.35, volume: 0.6 }]),
  texture('ghost-roll', 'slide', world + 0.3, 0.5, 0.9),
  hit('cyc-relay', 'relay', moves - SYNC_LEAD, 0.5),
  texture('chalk-eye', 'chalk', eye - 0.05, 0.6, Math.min(0.5, never + 0.15 - (eye - 0.05) - 0.01)),
  hit('eye-tap', 'chalkTap', never + 0.1, 0.5),
  texture('chalk-line', 'chalk', never + 0.15, 0.5, 0.5, 0.35),
];
export const durationSec = sceneLength(sounds, 0.9, said + 1.7);

export default function Change() {
  const theatre = useTheatre();
  useGSAP(() => {
    const tl = gsap.timeline();
    settleWords(tl);
    const rig = workedRig();
    rig.work = 0.3;
    const lx12 = rig.lamps.find((l) => l.id === 'lx12')!;
    lx12.on = 1.0; lx12.radius *= 1.25; Object.assign(lx12, { r: gel.straw[0], g: gel.straw[1], b: gel.straw[2] });
    const cueHalo = rig.lamps.find((l) => l.id === 'halo-CUE')!;
    const trackHalo = rig.lamps.find((l) => l.id === 'halo-TRACK')!;
    // CUE is where 05 left it, lit.
    const cueAt = wordSlot('CUE', CUE_SLOT);
    Object.assign(cueHalo, { on: 0.7, x: CUE_SLOT.x, y: CUE_SLOT.y, tx: CUE_SLOT.x, ty: CUE_SLOT.y + 40 });
    tl.set('.oc-hung-cue', { x: cueAt.x, y: cueAt.y - 6 }, 0);
    tl.set('.oc-hung-cue .oc-mq-letter', { '--lit': 1 }, 0);
    // TRACK will come down into the word slot over the centre, for 07.
    const trackAt = wordSlot('TRACK');
    Object.assign(trackHalo, { on: 0, x: handoff.word.x, y: WORDS_GONE, tx: handoff.word.x, ty: handoff.word.y + 40 });
    tl.set('.oc-hung-track', { x: trackAt.x, y: WORDS_GONE }, 0);
    tl.set('.oc-hung-track .oc-mq-letter', { '--lit': 0 }, 0);

    // One slow push on the crate, start to end.
    const lens = camera(tl, handoff.shots.house);
    lens.move({ x: SPIKE_B.x - 80, y: SPIKE_B.y - 180, zoom: 1.28 }, 0.2, durationSec - 2.2, 'power1.inOut')
      .move({ ...handoff.shots.house }, said + 0.6, 1.6);

    // The ring: this is the thing that stays.
    tl.fromTo('.oc-ring .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.85, ease: 'power1.inOut' }, holds - 0.05);
    tl.fromTo('.oc-still', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35 }, still);

    // "while the world moves around it": everything else leaves or arrives.
    tl.to('.oc-hung-cue', { y: WORDS_GONE, duration: 1.4, ease: 'power2.inOut' }, world - 0.3);
    tween(tl, cueHalo, { on: 0, duration: 0.6 }, world - 0.2);
    tl.to('.oc-hung-track', { y: trackAt.y, duration: 1.5, ease: 'power2.inOut' }, moves + 0.3);
    tl.to('.oc-hung-track .oc-mq-letter', { '--lit': 1, duration: 0.2, stagger: 0.06 }, around + 0.9);
    tween(tl, trackHalo, { y: handoff.word.y, on: 0.6, duration: 0.6 }, around + 0.8);
    tween(tl, rig, { cycR: gel.steel[0], cycG: gel.steel[1], cycB: gel.steel[2], cycOn: 0.75, duration: 1.2, ease: 'power2.inOut' }, moves - SYNC_LEAD);
    tween(tl, rig, { work: 0.18, duration: 1.2 }, moves);
    tl.set('.oc-flat-new', { y: -1100 }, 0);
    tl.to('.oc-flat-new', { y: 0, duration: 1.35, ease: 'power2.inOut', stagger: 0.2 }, moves + 0.2);
    tl.to('.oc-flat-new', { y: -5, duration: 0.5, ease: 'elastic.out(1, 0.5)', stagger: 0.2 }, moves + 1.35);
    tl.to('.oc-ghost-roll', { x: 900, duration: 1.1, ease: 'power2.in' }, world + 0.3);
    tween(tl, rig.lamps[0]!, { on: 0, duration: 0.8 }, world + 0.6);
    tl.to('.oc-old-spike', { opacity: 0, duration: 0.4 }, around);
    tl.fromTo('.oc-new-spike', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, stagger: 0.25, ease: 'back.out(2)' }, around + 0.1);
    tl.to('.oc-frame, .oc-frame-size', { opacity: 0.45, duration: 1 }, moves);
    tl.to('.oc-desk', { x: -600, duration: 1.3, ease: 'power2.inOut' }, world);

    // "your eye never has to search": a chalk eye at the front, one sightline, no hunting.
    tl.fromTo('.oc-eye .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: 'power1.inOut' }, eye - 0.05);
    tl.fromTo('.oc-sight .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: 'power2.out' }, never + 0.15);
    tl.fromTo('.oc-search', { opacity: 0 }, { opacity: 1, duration: 0.35 }, search + 0.1);

    // Hand-off: the chalk notes of this beat are wiped as the lens pulls back, and the frame comes back
    // to full strength, so 07 opens on the same house with nothing left over to explain.
    tl.to('.oc-ring, .oc-still, .oc-eye, .oc-sight, .oc-search', { opacity: 0, duration: 0.6 }, said + 0.7);
    tl.to('.oc-frame, .oc-frame-size', { opacity: 1, duration: 0.9 }, said + 0.6);

    everyFrame(tl, durationSec, (t) => theatre.paint(rig, lens.shot, t));
  }, { scope: theatre.root });

  const ringD = `M${SPIKE_B.x - 190} ${SPIKE_B.y + 8} a190 82 0 1 0 380 0 a190 82 0 1 0 -380 0`;
  const crateTop = { x: SPIKE_B.x, y: SPIKE_B.y - 200 * SPIKE_B.scale };
  return (
    <Theatre theatre={theatre}>
      <Dressing title={false} ghost={false} words={false}>
        <Spike className="oc-old-spike" at={SPIKE_A} label="A" angle={-4} />
        <Spike className="oc-old-spike" at={SPIKE_B} label="B" angle={3} colour={ink.tapeWhite} />
        {NEW_SPIKES.map((p, i) => <Spike key={i} className="oc-new-spike" at={p} label={['C', 'D'][i]} angle={i ? -6 : 5} colour={ink.tape} />)}

        {/* New flats, plain painted, with act numbers chalked on. */}
        {NEW_FLATS.map((_, i) => <ActFlat key={i} i={i} />)}

        <DeskAt lamp={0.8}>
            <PromptBook style={{ left: BOOK.left, top: BOOK.top, transform: BOOK_TRANSFORM, transformOrigin: '50% 100%' }}
              left={<Typed size={13} style={{ padding: '26px 22px', opacity: 0.75 }}>PROMPT BOOK<br />ON CUE</Typed>} right={<Typed size={12.5} style={{ padding: '22px 20px' }}>{BRIEF}</Typed>} />
            <CueLight style={{ ...CUE_LIGHT_STYLE, ['--green' as string]: 1 }} />
        </DeskAt>
        {/* The ghost light rolls off stage right with the rest of the world. */}
        <div className="oc-abs oc-ghost-roll" style={{ left: 0, top: 0 }}><GhostlightAt /></div>

        {/* The one still thing. */}
        <Chalk className="oc-ring" d={ringD} width={5} />
        <ChalkText className="oc-still" x={SPIKE_B.x + 210} y={SPIKE_B.y + 60} size={34} opacity={0.9}>still</ChalkText>
        <CrateAt at={SPIKE_B} />
        <HungMarquee word="CUE" className="oc-hung-lit" />
        <HungMarquee word="TRACK" className="oc-hung-lit" />

        {/* The eye, and its one sightline. */}
        <Chalk className="oc-eye" d={`M${EYE.x - 60} ${EYE.y} Q${EYE.x} ${EYE.y - 48} ${EYE.x + 60} ${EYE.y} Q${EYE.x} ${EYE.y + 48} ${EYE.x - 60} ${EYE.y} M${EYE.x - 14} ${EYE.y} a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0`} width={4} />
        <Chalk className="oc-sight" d={`M${EYE.x} ${EYE.y - 40} L${crateTop.x} ${crateTop.y + 40}`} width={3} opacity={0.65} />
        <ChalkText className="oc-search" x={EYE.x - 90} y={EYE.y - 60} size={26} align="end" opacity={0.85} font={type.hand}>the eye stays</ChalkText>
      </Dressing>
    </Theatre>
  );
}
