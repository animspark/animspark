import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue, duration } from '@animspark/runtime';
import { Theatre, useTheatre } from '../components/Theatre';
import { CrateAt, Dressing, HungMarquee, SPIKE_B, WORDS_GONE, settleWords, wordSlot, workedRig } from '../components/Set';
import { ChalkText, Spike } from '../components/Marks';
import { camera, everyFrame, tween } from '../lib/camera';
import { BATTENS, lieOnFloor } from '../lib/stage';
import { hit, run, sceneLength, texture, voice, type Sound } from '../sound';
import { SYNC_LEAD, gel, handoff, ink } from '../theme';
import { BEATS } from '../data/script';
import { bars, type VoiceId } from '../data/envelopes';
import { CUTS, TOTAL } from '../data/cuts';
import { scoreDuration } from '@muspark/core';
import score, { BPM, READ } from '../music/score';
import { ActFlat, NEW_FLATS, NEW_SPIKES } from './06-change';
import { sounds as s01 } from './01-stage';
import { sounds as s02 } from './02-script';
import { sounds as s03 } from './03-set';
import { sounds as s04 } from './04-blocking';
import { sounds as s05 } from './05-cue';
import { sounds as s06 } from './06-change';

gsap.registerPlugin(useGSAP);

/*
 * 07 · Track.
 * Under TRACK, a rail comes down carrying this film's own running order: one tag per scene, as wide
 * as the scene is long, each with the measured waveform of its narration and a dot for every effect
 * it owns; below it the audio track, one brass bar. The fly crew slides 05 along the rail and its
 * sounds ride with it. Then a sheet of note data is laid on the boards downstage, in the boards'
 * own perspective, and the marquee reads the notes as they play.
 */
const vo = voice('07-track', 0.6);
const each = cue(vo, 'Each scene').start;
const own = cue(vo, 'own sound').start;
const slide = cue(vo, 'Slide it').start; // 'slide' is also inside 'slides'
const track = cue(vo, 'the track').start;
const slides = cue(vo, 'sound slides').start;
const withIt = cue(vo, 'with it').start;
const music = cue(vo, 'music').start;
const written = cue(vo, 'written').start;
const notes = cue(vo, 'notes').start;
const picture = cue(vo, 'picture').start;
const read = cue(vo, 'read').start;
const said = cue(vo, 'read').end;

const at = (id: string) => (CUTS as Record<string, number>)[id];
const SCENE_START = at('07-track') ?? TOTAL;
const OWN: Record<string, readonly Sound[]> = { '01-stage': s01, '02-script': s02, '03-set': s03, '04-blocking': s04, '05-cue': s05, '06-change': s06 };

/**
 * The rails hang under TRACK (which ends at y 354) and above the crate (top y 590). The bar itself runs
 * into both wings (x 260–1680, behind the legs at 300 and 1620); the cards use x 320–1494 of it, so the
 * last card still hangs clear of the stage-right leg after its 100 px slide.
 */
const RAIL = { x: 320, y: 380, w: 1180 };
const RAIL_BAR = { left: RAIL.x - 60, width: RAIL.w + 180 };
const CARD_H = 84, CARD_TOP = RAIL.y + 40;
const AUDIO_RAIL = { y: CARD_TOP + CARD_H + 16, h: 32 };
const PX_PER_SEC = RAIL.w / Math.max(TOTAL, 90);
/** Where each scene tag hangs: at its start second, as wide as it lasts. Later scenes fall back to a guess until picture lock. */
const CARDS = BEATS.map((b, i) => {
  const s = at(b.id) ?? (at(BEATS[i - 1]!.id) ?? 0) + 12;
  const e = i < BEATS.length - 1 ? (at(BEATS[i + 1]!.id) ?? s + 12) : TOTAL;
  return { ...b, x: RAIL.x + s * PX_PER_SEC, w: Math.max(40, (e - s) * PX_PER_SEC - 6), seconds: e - s, own: OWN[b.id] ?? [] };
});
const CARD_05 = CARDS.findIndex((c) => c.id === '05-cue');
const SLIDE_PX = 100;

/** The pit paper: the notes of the score that fall in this scene's window, as pins on a grid, laid on the boards downstage left of the crate. */
const beatToSec = (b: number) => (b * 60) / BPM;
const WINDOW_SEC = 14;
const WINDOW = { score, time: [SCENE_START, Math.min(SCENE_START + WINDOW_SEC, scoreDuration(score) - 0.01)] as const };
const key = (n: { pitch: string | number; beat: number }) => `${n.pitch}@${n.beat}`;
const READ_KEYS = new Map(READ.map((n, i) => [key(n), i]));
const PAPER = { w: 760, h: 250 };
const PAPER_ON_FLOOR = lieOnFloor(PAPER.w, PAPER.h, -0.54, 0.16, 0.4, 0.07);
const midi = (p: string | number) => typeof p === 'number' ? p : ((['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'].indexOf(p.slice(0, -1).toLowerCase().replace('db', 'c#').replace('eb', 'd#').replace('gb', 'f#').replace('ab', 'g#').replace('bb', 'a#'))) + 12 * (Number(p.slice(-1)) + 1));
const GRID = { left: 56, top: 44, right: 24, bottom: 44 };
const PINS = score.channels.flatMap((ch) => ('notes' in ch && ch.notes ? ch.notes : []).map((n) => ({ ...n, ch: ch.id, sec: beatToSec(n.beat) })))
  .filter((n) => n.sec >= SCENE_START && n.sec < SCENE_START + WINDOW_SEC)
  .map((n) => ({ ...n, x: GRID.left + ((n.sec - SCENE_START) / WINDOW_SEC) * (PAPER.w - GRID.left - GRID.right), y: PAPER.h - GRID.bottom - ((midi(n.pitch) - 33) / 55) * (PAPER.h - GRID.top - GRID.bottom), read: READ_KEYS.get(key(n)) ?? -1 }));
const READ_AT = READ.map((n) => cue(WINDOW, n).start);

export const sounds = [
  vo,
  texture('rail-down', 'rope', 0.15, 0.8, 1.7),
  hit('rail-stop', 'battenStop', each + 0.25, 0.8),
  // Cards arrive 70 ms apart and strips light 80 ms apart: run() thins each to every other one.
  ...run('tape', CARDS.map((c, i) => ({ id: `tag-${i}`, at: each + 0.3 + i * 0.07, volume: 0.3 })), 0.12),
  ...run('switch', CARDS.map((c, i) => ({ id: `strip-${i}`, at: own + 0.05 + i * 0.08, volume: 0.35 })), 0.12, 0.1),
  texture('pull-rope', 'rope', slide - 0.1, 0.8, 1.2, 0.3),
  texture('card-slide', 'slide', track - SYNC_LEAD, 0.7, 0.8),
  hit('card-stop', 'battenStop', track + 0.75, 0.6),
  hit('sound-rides', 'ping', slides - SYNC_LEAD, 0.6),
  hit('with-it', 'chalkTap', withIt, 0.5),
  texture('pit-paper', 'whoosh', music - 0.2, 0.5, 0.8),
  hit('paper-land', 'page', music + 0.45, 0.9),
  // Pins appear every 30 ms; run() keeps one pat per 90 ms, which still reads as the run.
  ...run('tape', PINS.slice(0, 40).map((p, i) => ({ id: `pin-${i}`, at: written + 0.1 + i * 0.03, volume: 0.18 })), 0.08, 0.09),
  ...READ_AT.map((t, i) => hit(`read-${i}`, 'bulb', t - SYNC_LEAD, 0.5, 0.12)),
  // The strike: one rope run as the rail, the flats and TRACK go back up (kept inside the scene's tail).
  texture('strike', 'rope', said + 1.1, 0.55, 0.9),
];
export const durationSec = sceneLength(sounds, 0.9, Math.max(said + 2.0, READ_AT[READ_AT.length - 1]! + 1.2));

export default function Track() {
  const theatre = useTheatre();
  useGSAP(() => {
    const tl = gsap.timeline();
    settleWords(tl);
    const rig = workedRig();
    rig.work = 0.18; rig.cycOn = 0.75; Object.assign(rig, { cycR: gel.steel[0], cycG: gel.steel[1], cycB: gel.steel[2] });
    rig.lamps[0]!.on = 0;
    const lx12 = rig.lamps.find((l) => l.id === 'lx12')!;
    lx12.on = 1.0; lx12.radius *= 1.25; Object.assign(lx12, { r: gel.straw[0], g: gel.straw[1], b: gel.straw[2] });
    const trackHalo = rig.lamps.find((l) => l.id === 'halo-TRACK')!;
    const trackAt = wordSlot('TRACK');
    Object.assign(trackHalo, { on: 0.6, x: handoff.word.x, y: handoff.word.y, tx: handoff.word.x, ty: handoff.word.y + 40 });
    tl.set('.oc-hung-track', { x: trackAt.x, y: trackAt.y }, 0);
    tl.set('.oc-hung-track .oc-mq-letter', { '--lit': 1 }, 0);

    const lens = camera(tl, handoff.shots.house);
    lens.move({ x: 960, y: 470, zoom: 1.12 }, 0.2, 1.6)
      .move({ x: CARDS[CARD_05]!.x + 100, y: CARD_TOP + 30, zoom: 1.7 }, slide - 0.5, 1.0)
      .move({ x: 960, y: 500, zoom: 1.1 }, withIt + 0.2, 1.0)
      .move({ x: 880, y: 640, zoom: 1.2 }, music - 0.3, 1.2)
      .move({ ...handoff.shots.house }, said + 1.0, 1.8); // lands at said + 2.8, inside the scene's said + 2.9

    // One fly move to open: the act flats from 06 go back up as the rail with the running order comes
    // down (the rail is the width of the stage, and would otherwise hang across the flats' numerals).
    // Tags hang; strips light one by one.
    tl.to('.oc-flat-new', { y: -1100, duration: 1.3, ease: 'power2.inOut', stagger: 0.1 }, 0.1);
    tl.set('.oc-rail', { y: -700 }, 0);
    tl.to('.oc-rail', { y: 0, duration: 1.4, ease: 'power2.inOut' }, 0.15);
    tl.to('.oc-rail', { y: -6, duration: 0.5, ease: 'elastic.out(1, 0.5)' }, each + 0.25);
    tl.fromTo('.oc-tag-card', { opacity: 0, y: -14 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.07, ease: 'power2.out' }, each + 0.3);
    tl.fromTo('.oc-tag-strip', { opacity: 0.15 }, { opacity: 1, duration: 0.3, stagger: 0.08 }, own + 0.05);
    tl.fromTo('.oc-tag-dot', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.2, stagger: 0.012, ease: 'back.out(2)' }, own + 0.2);
    tl.fromTo('.oc-audio-rail', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5 }, own + 0.6);

    // The fly crew pulls from the wing; 05 slides along the rail; its sound goes with it.
    tl.to(`.oc-tag-${CARD_05}`, { x: SLIDE_PX, duration: 0.8, ease: 'power2.inOut' }, track - SYNC_LEAD);
    for (let i = CARD_05 + 1; i < CARDS.length; i++) tl.to(`.oc-tag-${i}`, { x: SLIDE_PX, duration: 0.8, ease: 'power2.inOut' }, track - SYNC_LEAD + 0.04 * (i - CARD_05));
    tl.fromTo('.oc-gap', { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.8, ease: 'power2.inOut', transformOrigin: '0 50%' }, track - SYNC_LEAD);
    tl.fromTo(`.oc-tag-${CARD_05} .oc-tag-strip`, { filter: 'brightness(1)' }, { filter: 'brightness(1.6)', duration: 0.25, yoyo: true, repeat: 3 }, slides - SYNC_LEAD);
    tl.fromTo(`.oc-tag-${CARD_05} .oc-tag-dot`, { scale: 1 }, { scale: 2, duration: 0.2, yoyo: true, repeat: 3, stagger: 0.01 }, slides - SYNC_LEAD);
    tl.fromTo('.oc-rides-note', { opacity: 0 }, { opacity: 1, duration: 0.3 }, withIt);

    // The pit: a sheet of note data is laid on the boards; pins appear; the marquee reads them as they sound.
    tl.set('.oc-pit', { opacity: 0 }, 0);
    tl.to('.oc-pit', { opacity: 1, duration: 0.3 }, music - 0.2);
    tl.fromTo('.oc-pit-sheet', { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 0.7, ease: 'power3.out' }, music - 0.2);
    tl.fromTo('.oc-grid-line', { scaleX: 0 }, { scaleX: 1, duration: 0.4, stagger: 0.02, ease: 'power2.out', transformOrigin: '0 50%' }, music + 0.2);
    tl.fromTo('.oc-pin', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, stagger: 0.03, ease: 'back.out(2.5)' }, written + 0.1);
    tl.fromTo('.oc-paper-label', { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.08 }, notes);
    tween(tl, { p: 0 }, { p: 1, duration: WINDOW_SEC, ease: 'none', onUpdate() { const el = theatre.root.current?.querySelector<HTMLElement>('.oc-playhead'); if (el) el.style.transform = `translateX(${(this.targets()[0] as { p: number }).p * (PAPER.w - GRID.left - GRID.right)}px)`; } }, 0);
    tl.fromTo('.oc-playhead', { opacity: 0 }, { opacity: 1, duration: 0.3 }, picture);
    READ_AT.forEach((t, i) => {
      const letter = i % 5;
      tl.fromTo(`.oc-hung-track .oc-mq-letter-${letter}`, { '--lit': 1 }, { '--lit': 2.2, duration: 0.12, yoyo: true, repeat: 1 }, t - SYNC_LEAD);
      tl.fromTo(`.oc-pin-read-${i}`, { scale: 1 }, { scale: 2.1, duration: 0.14, yoyo: true, repeat: 1, ease: 'power2.out' }, t - SYNC_LEAD);
      tween(tl, rig, { foot: 0.9, duration: 0.1, yoyo: true, repeat: 1 }, t - SYNC_LEAD);
      tween(tl, trackHalo, { on: 1.0, duration: 0.12, yoyo: true, repeat: 1 }, t - SYNC_LEAD);
    });
    tl.fromTo('.oc-read-note', { opacity: 0 }, { opacity: 1, duration: 0.4 }, read);

    // Hand-off: the house begins to warm for the curtain call; the paper is taken up, and the set is
    // struck: the rail and TRACK fly back into the grid, the new spikes are lifted, so 08 opens on a
    // bare stage with only the crate left on B.
    tween(tl, rig, { work: 0.5, cycR: gel.amber[0], cycG: gel.amber[1], cycB: gel.amber[2], duration: 2.0 }, said + 1.0);
    tl.to('.oc-pit', { opacity: 0, duration: 0.9, ease: 'power2.in' }, said + 1.3);
    tl.to('.oc-rail', { y: -760, duration: 1.3, ease: 'power2.inOut' }, said + 1.2);
    tl.to('.oc-hung-track', { y: WORDS_GONE, duration: 1.2, ease: 'power2.inOut' }, said + 1.4);
    tween(tl, trackHalo, { on: 0, duration: 0.5 }, said + 1.4);
    tl.to('.oc-new-spike', { opacity: 0, duration: 0.4 }, said + 1.5);

    everyFrame(tl, durationSec, (t) => theatre.paint(rig, lens.shot, t));
  }, { scope: theatre.root });

  return (
    <Theatre theatre={theatre}>
      <Dressing title={false} ghost={false} words={false}>
        {NEW_SPIKES.map((p, i) => <Spike key={i} className="oc-new-spike" at={p} label={['C', 'D'][i]} angle={i ? -6 : 5} colour={ink.tape} />)}
        {/* The act flats as 06 left them; they go back up in the opening fly move. */}
        {NEW_FLATS.map((_, i) => <ActFlat key={i} i={i} />)}
        <CrateAt at={SPIKE_B} />

        {/* The rail: film.json's mg track, in the air, and the audio track under it. */}
        <div className="oc-abs oc-rail" style={{ left: 0, top: 0 }}>
          <div className="oc-abs" style={{ left: RAIL_BAR.left, top: RAIL.y - 6, width: RAIL_BAR.width, height: 12, background: 'linear-gradient(180deg, #6a6e78, #2b2d33 60%, #15161a)', borderRadius: 6, boxShadow: '0 6px 14px rgba(0,0,0,.6)' }} />
          {[RAIL.x + 100, RAIL.x + RAIL.w - 100].map((x) => <div key={x} className="oc-abs" style={{ left: x - 2, top: BATTENS[0], width: 4, height: RAIL.y - BATTENS[0], background: 'linear-gradient(180deg, rgba(120,110,95,.2), rgba(120,110,95,.7))' }} />)}
          <div className="oc-abs oc-label" style={{ left: RAIL.x + 100, top: RAIL.y - 30, fontSize: 14, color: ink.chalk, letterSpacing: 3, opacity: 0.85, whiteSpace: 'nowrap' }}>TRACK · mg · 8 scenes · {Math.round(TOTAL)} s</div>
          <div className="oc-abs oc-gap" style={{ left: CARDS[CARD_05]!.x - 3, top: CARD_TOP, width: SLIDE_PX, height: CARD_H, border: `2px dashed ${ink.chalk}`, opacity: 0, borderRadius: 4 }} />
          {CARDS.map((c, i) => (
            <div key={c.id} className={`oc-abs oc-tag-card oc-tag-${i}`} style={{ left: c.x, top: CARD_TOP, width: c.w, height: CARD_H }}>
              <div className="oc-abs" style={{ left: 10, top: -40, width: 2, height: 40, background: 'rgba(160,150,130,.6)' }} />
              <div className="oc-abs" style={{ left: c.w - 12, top: -40, width: 2, height: 40, background: 'rgba(160,150,130,.6)' }} />
              <div className="oc-abs" style={{ inset: 0, background: `linear-gradient(180deg, ${ink.paper}, ${ink.paperShade})`, borderRadius: 4, boxShadow: '0 8px 20px rgba(0,0,0,.5)', border: `1px solid rgba(0,0,0,.35)` }} />
              <div className="oc-abs oc-label" style={{ left: 8, top: 5, fontSize: 13, color: ink.graphite, letterSpacing: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', width: c.w - 16 }}>{String(c.n).padStart(2, '0')} {c.title.toUpperCase()}</div>
              {/* Only tags wide enough for both keep their length; on a short scene the title alone is the label. */}
              {c.w >= 150 && <div className="oc-abs oc-type" style={{ left: 'auto', right: 8, top: 5, fontSize: 11, color: ink.graphite, opacity: 0.7 }}>{c.seconds.toFixed(1)}s</div>}
              {/* the scene's narration, measured; and a dot for every sound it owns */}
              <svg className="oc-abs oc-tag-strip" width={c.w - 16} height={34} style={{ left: 8, top: 24 }} viewBox={`0 0 ${c.w - 16} 34`}>
                {bars(c.id as VoiceId, Math.max(12, Math.floor((c.w - 16) / 5))).map((v, k, arr) => {
                  const bw = (c.w - 16) / arr.length, h = Math.max(1.5, v * 28);
                  return <rect key={k} x={k * bw + bw * 0.2} y={17 - h / 2} width={Math.max(1, bw * 0.6)} height={h} fill={ink.pencil} opacity={0.4 + v * 0.6} />;
                })}
              </svg>
              <div className="oc-abs" style={{ left: 8, top: 64, width: c.w - 16, height: 12 }}>
                {c.own.filter((s) => s.kind === 'sfx').map((s, k) => (
                  <div key={k} className="oc-tag-dot" style={{ position: 'absolute', left: Math.min(c.w - 22, (s.at / c.seconds) * (c.w - 16)), top: 2, width: 6, height: 6, borderRadius: 3, background: ink.red, opacity: 0 }} />
                ))}
              </div>
            </div>
          ))}
          {/* The audio track below: the film's music, one long bar. */}
          <div className="oc-abs oc-audio-rail" style={{ left: RAIL.x, top: AUDIO_RAIL.y, width: RAIL.w, height: AUDIO_RAIL.h, opacity: 0 }}>
            <div className="oc-abs" style={{ inset: 0, background: `linear-gradient(180deg, ${ink.brassHi}, ${ink.brass} 40%, ${ink.brassLo})`, borderRadius: 4, boxShadow: '0 6px 14px rgba(0,0,0,.5)' }} />
            <div className="oc-abs oc-label" style={{ left: 12, top: 8, fontSize: 13, color: '#2a1e08', letterSpacing: 2 }}>TRACK · audio · music/score.ts · {BPM} bpm</div>
            <div className="oc-abs oc-type" style={{ left: 'auto', right: 12, top: 9, fontSize: 12, color: '#2a1e08' }}>{score.channels.length} channels</div>
          </div>
          <ChalkText className="oc-rides-note" x={RAIL.x + RAIL.w - 10} y={RAIL.y - 14} size={24} align="end" opacity={0.85}>move the scene, not the sounds</ChalkText>
        </div>
        <HungMarquee word="TRACK" className="oc-hung-lit" />

        {/* The pit: the score as pins on a sheet lying on the boards, in the boards' perspective. */}
        <div className="oc-abs oc-pit" style={{ left: 0, top: 0, opacity: 0 }}>
          <div style={PAPER_ON_FLOOR}>
            <div className="oc-abs oc-pit-sheet" style={{ left: 0, top: 0, width: PAPER.w, height: PAPER.h, background: ink.paper, backgroundImage: 'repeating-linear-gradient(0deg, rgba(120,100,60,.05) 0 1px, transparent 1px 3px)', boxShadow: '0 6px 18px rgba(0,0,0,.5)' }}>
              <div className="oc-label oc-paper-label" style={{ position: 'absolute', left: 18, top: 12, fontSize: 17, color: ink.graphite, letterSpacing: 2, opacity: 0 }}>SCORE · music/score.ts · this scene's window</div>
              <div className="oc-type oc-paper-label" style={{ position: 'absolute', right: 18, top: 14, fontSize: 14, color: ink.graphite, opacity: 0 }}>{BPM} bpm · 5 voices</div>
              {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="oc-grid-line" style={{ position: 'absolute', left: GRID.left, top: GRID.top + i * ((PAPER.h - GRID.top - GRID.bottom) / 5), width: PAPER.w - GRID.left - GRID.right, height: 1.5, background: ink.graphite, opacity: 0.25 }} />)}
              {Array.from({ length: 15 }, (_, i) => <div key={i} style={{ position: 'absolute', left: GRID.left + i * ((PAPER.w - GRID.left - GRID.right) / 14), top: GRID.top, width: 1.5, height: PAPER.h - GRID.top - GRID.bottom, background: ink.graphite, opacity: i % 2 ? 0.08 : 0.18 }} />)}
              <div className="oc-type" style={{ position: 'absolute', left: 12, top: PAPER.h - GRID.bottom - 16, fontSize: 13, color: ink.graphite, opacity: 0.6 }}>low</div>
              <div className="oc-type" style={{ position: 'absolute', left: 12, top: GRID.top, fontSize: 13, color: ink.graphite, opacity: 0.6 }}>high</div>
              <div className="oc-abs oc-playhead" style={{ left: GRID.left, top: GRID.top - 8, width: 3, height: PAPER.h - GRID.top - GRID.bottom + 16, background: ink.red, opacity: 0, boxShadow: `0 0 8px ${ink.red}` }} />
              {/* The celesta run is eight notes half a beat apart: 15.8 px on this grid, so a read pin is 13 px across with a
                  dark rim to keep it from its neighbours; the pulse to 2.1× on the note is what makes it big. */}
              {PINS.map((p, i) => {
                const k = p.read;
                const isRead = k >= 0;
                const r = isRead ? 6.5 : 4.5;
                return (
                  <div key={i} className={`oc-abs oc-pin ${isRead ? `oc-pin-read-${k}` : ''}`} style={{ left: p.x - r, top: p.y - r, width: r * 2, height: r * 2, borderRadius: '50%', opacity: 0,
                    background: isRead ? `radial-gradient(circle at 35% 35%, ${ink.brassHi}, ${ink.brass} 55%, ${ink.brassLo})` : p.ch === 'bass' ? ink.graphite : p.ch === 'pad' ? ink.pencil : ink.velvetHi,
                    boxShadow: isRead ? '0 0 0 1.5px rgba(26,18,6,.8), 0 2px 4px rgba(0,0,0,.6)' : 'none' }} />
                );
              })}
              <div className="oc-hand oc-read-note" style={{ position: 'absolute', left: GRID.left, top: PAPER.h - 34, fontSize: 24, color: ink.pencil, opacity: 0 }}>the bulbs read the celesta ↑</div>
            </div>
          </div>
        </div>
      </Dressing>
    </Theatre>
  );
}
