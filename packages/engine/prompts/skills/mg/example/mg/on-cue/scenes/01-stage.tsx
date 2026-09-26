import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue } from '@animspark/runtime';
import { Theatre, useTheatre } from '../components/Theatre';
import { BOOK, BOOK_TRANSFORM, CUE_LIGHT_STYLE, CrateAt, DeskAt, FRAME, FrameLabel, GhostlightAt, HungMarquee, LanternsOnBattens, SPIKE_A, SPIKE_B, HungTitle, WORDS_GONE, flyWords, ghostLamp, lanternLamp, marqueeHalo, titleHalo, washLamp } from '../components/Set';
import { CueLight } from '../components/Fixtures';
import { PromptBook, Typed } from '../components/Book';
import { Chalk, ChalkDefs, ChalkText, Spike, floorPath } from '../components/Marks';
import { camera, everyFrame, tween } from '../lib/camera';
import { defaultRig } from '../lib/rig';
import { floor } from '../lib/stage';
import { hit, run, sceneLength, texture, voice } from '../sound';
import { SYNC_LEAD, gel, ink } from '../theme';
import { BRIEF, WORDS } from '../data/script';

gsap.registerPlugin(useGSAP);

/*
 * 01 · Stage.
 * An empty house, one ghost light. Four words light up in the dark as they are spoken; the work
 * lights bump on and show the theatre they hang in; a chalk frame is drawn on the floor, and on
 * "inside it" the frame answers. Then the words fly back into the grid and the title comes down in
 * their place. Everything the film will use is already on stage, in its place.
 */
const vo = voice('01-stage', 1.6);
const W = {
  STAGE: cue(vo, 'Stage', { occurrence: 1 }).start,
  SCENE: cue(vo, 'Scene').start,
  CUE: cue(vo, 'Cue').start,
  TRACK: cue(vo, 'Track').start,
};
const brand = cue(vo, 'AnimSpark').start;
const borrowed = cue(vo, 'borrowed').start;
const theatre = cue(vo, 'theatre').start;
const fixed = cue(vo, 'fixed').start;
const frame = cue(vo, 'frame').start;
const everything = cue(vo, 'everything').start;
const inside = cue(vo, 'inside').start;
const said = cue(vo, 'inside it').end;
const landed = inside + 0.9;

export const sounds = [
  vo,
  texture('ghost-buzz', 'buzz', 0, 0.35, theatre),
  // One ping per spoken word, then three bulb clicks as its letters catch; run() keeps each click clear of the next.
  ...run('ping', WORDS.map((w, i) => ({ id: `ping-${w}`, at: W[w] - SYNC_LEAD, volume: 0.55 - i * 0.05 }))),
  ...run('bulb', WORDS.flatMap((w) => [0.05, 0.16, 0.28].map((d, k) => ({ id: `bulb-${w}-${k}`, at: W[w] - SYNC_LEAD + d, volume: 0.5 }))), 0.1),
  hit('brand-ping', 'ping', brand - SYNC_LEAD, 0.45),
  hit('work-relay', 'relay', theatre - SYNC_LEAD, 0.9),
  texture('work-hum', 'house', theatre, 0.9),
  texture('chalk-frame', 'chalk', fixed - 0.05, 0.8, 0.8),
  texture('chalk-frame-2', 'chalk', fixed + 0.8, 0.6, 0.6),
  hit('chalk-corner', 'chalkTap', frame + 0.12, 0.8),
  // One rope run carries the words up and the title down; the title lands once and lights letter by letter.
  texture('fly', 'rope', everything - 0.35, 0.7, landed - (everything - 0.35)),
  hit('title-stop', 'battenStop', landed, 0.8),
  ...run('bulb', ['O', 'N', 'C', 'U', 'E'].map((ch, i) => ({ id: `title-${i}`, at: landed + 0.15 + i * 0.12, volume: 0.5 })), 0.1),
  texture('chalk-sub', 'chalk', landed + 0.9, 0.6, 0.7),
];
export const durationSec = sceneLength(sounds, 0.9, said + 3.0);

export default function Stage() {
  const theatre$ = useTheatre();
  useGSAP(() => {
    const tl = gsap.timeline();
    const rig = defaultRig([
      ghostLamp(1),
      ...WORDS.map((w) => marqueeHalo(w, 0)),
      titleHalo(0),
      lanternLamp('lx12', 240, gel.straw, 0),
      lanternLamp('fill', 380, gel.steel, 0),
      washLamp(420, gel.rose, 0),
    ]);
    rig.dark = 0.94;
    const halo = (w: string) => rig.lamps.find((l) => l.id === `halo-${w}`)!;
    const ghost = rig.lamps[0]!;
    const tHalo = rig.lamps.find((l) => l.id === 'halo-title')!;

    // Lens: hold close on the ghost light while it breathes, then one pull out to the sign that
    // finishes as the first word lights; later the whole house. The lamp stays in frame throughout.
    const lens = camera(tl, { x: 1500, y: 620, zoom: 1.9, roll: -2 });
    lens.move({ x: 960, y: 470, zoom: 1.18, roll: 0 }, W.STAGE - 1.0, 0.9, 'power2.inOut')
      .move({ x: 960, y: 560, zoom: 1.0 }, theatre - 0.3, 1.6)
      .move({ x: 960, y: 600, zoom: 1.12 }, fixed - 0.4, 1.4, 'power2.inOut')
      .move({ x: 960, y: 560, zoom: 1.0 }, everything + 0.3, 1.8, 'power2.inOut');

    // The ghost light breathes; the sign sways on its chains.
    tween(tl, ghost, { on: 0.8, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }, 0);
    for (const w of WORDS) {
      tl.set(`.oc-hung-${w.toLowerCase()}`, { rotation: -1.0 + WORDS.indexOf(w) * 0.5 }, 0);
      tl.to(`.oc-hung-${w.toLowerCase()}`, { rotation: 0.9 - WORDS.indexOf(w) * 0.35, duration: 2.6 + WORDS.indexOf(w) * 0.3, yoyo: true, repeat: -1, ease: 'sine.inOut' }, 0);
    }

    // Each word lights bulb by bulb on its own name.
    for (const w of WORDS) {
      const at = W[w] - SYNC_LEAD;
      tl.to(`.oc-hung-${w.toLowerCase()} .oc-mq-letter`, { '--lit': 1, duration: 0.22, stagger: 0.075, ease: 'power3.out' }, at);
      tween(tl, halo(w), { on: 0.55, duration: 0.5, ease: 'power2.out' }, at);
      tl.fromTo(`.oc-hung-${w.toLowerCase()}`, { y: -6 }, { y: 0, duration: 0.7, ease: 'elastic.out(1, 0.55)' }, at);
    }
    // "borrowed": the words tug on their chains, as if taken.
    tl.to('.oc-hung', { y: 14, duration: 0.22, ease: 'power2.in', stagger: 0.05 }, borrowed - 0.05)
      .to('.oc-hung', { y: 0, duration: 0.9, ease: 'elastic.out(1, 0.45)', stagger: 0.05 }, borrowed + 0.17);
    // "AnimSpark": a chase runs through the sign — one dark bulb-gap travels letter by letter across
    // both rows — and each halo flares as it passes; a brass plate on the desk catches the light.
    tl.to('.oc-hung-lit .oc-mq-letter', { '--lit': 0.1, duration: 0.08, ease: 'power1.inOut', stagger: { each: 0.045, repeat: 1, yoyo: true } }, brand - SYNC_LEAD);
    WORDS.forEach((w, i) => tween(tl, halo(w), { on: 0.95, duration: 0.2, yoyo: true, repeat: 1, ease: 'power1.inOut' }, brand - SYNC_LEAD + i * 0.24));
    tl.fromTo('.oc-plate', { opacity: 0 }, { opacity: 1, duration: 0.3 }, brand);

    // "theatre": work lights bump on, and the house is a place.
    tween(tl, rig, { work: 0.85, duration: 0.12, ease: 'power4.out' }, theatre - SYNC_LEAD);
    tween(tl, rig, { work: 0.62, duration: 1.4, ease: 'power2.out' }, theatre + 0.15);
    tween(tl, rig, { cycOn: 0.5, foot: 0.55, duration: 0.6, ease: 'power2.out' }, theatre);
    tween(tl, ghost, { on: 0.55, duration: 0.4 }, theatre);
    tl.to('.oc-desk-lamp', { '--lamp': 1, duration: 0.3 }, theatre + 0.2);

    // "fixed frame": chalk the stage's rectangle on the boards, then its size.
    tl.fromTo('.oc-frame .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.35, ease: 'power1.inOut' }, fixed - 0.05);
    tl.fromTo('.oc-frame-size', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }, frame + 0.1);
    tl.fromTo('.oc-frame-corner', { opacity: 0 }, { opacity: 1, duration: 0.2, stagger: 0.08 }, frame + 0.1);

    // "everything has to happen inside it": the frame answers, corner by corner, and the borrowed
    // words go back up into the grid; the title comes down in their place.
    tl.to('.oc-frame-corner', { scale: 1.8, duration: 0.18, yoyo: true, repeat: 1, stagger: 0.09, ease: 'power2.out', transformOrigin: '50% 50%' }, inside - 0.05);
    tl.fromTo('.oc-frame .oc-chalk-line', { opacity: 0.9 }, { opacity: 1, duration: 0.25, yoyo: true, repeat: 1 }, inside);
    flyWords(tl, rig, WORDS_GONE, everything - 0.1, 1.5);
    for (const w of WORDS) tween(tl, halo(w), { on: 0, duration: 0.6 }, everything);
    tl.set('.oc-title', { y: -900 }, 0);
    tl.to('.oc-title', { y: 0, duration: 1.3, ease: 'power2.inOut' }, landed - 1.3);
    tl.to('.oc-title', { y: -5, duration: 0.5, ease: 'elastic.out(1, 0.5)' }, landed);
    tl.to('.oc-title .oc-mq-letter', { '--lit': 1, duration: 0.2, stagger: 0.12, ease: 'power3.out' }, landed + 0.15);
    tween(tl, tHalo, { on: 0.5, duration: 0.6 }, landed + 0.2);
    tl.fromTo('.oc-title-sub', { clipPath: 'inset(-20% 100% -20% 0)' }, { clipPath: 'inset(-20% -2% -20% 0)', duration: 0.8, ease: 'power1.inOut' }, landed + 0.9);

    everyFrame(tl, durationSec, (t) => theatre$.paint(rig, lens.shot, t));
  }, { scope: theatre$.root });

  return (
    <Theatre theatre={theatre$}>
      <ChalkDefs />
      {/* Floor marks: spikes for the crate, and the chalk frame that the narration calls fixed. */}
      <Spike at={SPIKE_A} label="A" angle={-4} />
      <Spike at={SPIKE_B} label="B" angle={3} colour={ink.tapeWhite} />
      <Chalk className="oc-frame" d={floorPath(FRAME)} width={5} />
      {FRAME.map(([sx, sz], i) => {
        const p = floor(sx, sz);
        return <div key={i} className="oc-abs oc-frame-corner" style={{ left: p.x - 6, top: p.y - 6, width: 12, height: 12, borderRadius: 6, background: ink.chalk, opacity: 0, boxShadow: `0 0 8px ${ink.chalk}` }} />;
      })}
      <FrameLabel />
      {/* The set, dark until the work lights find it. */}
      <CrateAt at={SPIKE_A} />
      <DeskAt className="oc-desk-lamp" lamp={0}>
        <PromptBook style={{ left: BOOK.left, top: BOOK.top, transform: BOOK_TRANSFORM, transformOrigin: '50% 100%' }}
          left={<Typed size={13} style={{ padding: '26px 22px', opacity: 0.75 }}>PROMPT BOOK<br />ON CUE<br /><br />a short film<br />about four words</Typed>}
          right={<Typed size={13} style={{ padding: '26px 22px' }}>BRIEF<br /><br />{BRIEF}</Typed>} />
        <CueLight style={CUE_LIGHT_STYLE} />
        <div className="oc-abs oc-plate oc-label" style={{ left: 214, top: 134, width: 92, height: 18, background: `linear-gradient(180deg, ${ink.brassHi}, ${ink.brass} 45%, ${ink.brassLo})`, color: '#2a1e08', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 2, opacity: 0, boxShadow: '0 1px 2px rgba(0,0,0,.6)' }}>AnimSpark</div>
      </DeskAt>
      <GhostlightAt />
      <LanternsOnBattens />

      {/* The four borrowed words, one sign in two rows. */}
      {WORDS.map((w) => <HungMarquee key={w} word={w} className="oc-hung-lit" />)}

      {/* The title: flown in at the end where the words hung. Its line is chalked on the cyc under it. */}
      <HungTitle />
      <div className="oc-abs oc-title-sub" style={{ left: 0, top: 0, width: 1920, height: 1080, clipPath: 'inset(-20% 100% -20% 0)' }}>
        <ChalkText x={960} y={452} size={32} align="middle" colour={ink.chalk} opacity={0.85}>a short film about four borrowed words</ChalkText>
      </div>
    </Theatre>
  );
}
