import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue } from '@animspark/runtime';
import { Theatre, useTheatre } from '../components/Theatre';
import { BOOK, BOOK_TRANSFORM, CUE_LIGHT_STYLE, DeskAt, Dressing, SPIKE_A, SPIKE_B, settleWords, workedRig } from '../components/Set';
import { CueLight, Ghostlight, Lantern } from '../components/Fixtures';
import { Crate } from '../components/Props';
import { Marquee, marqueeWidth } from '../components/Marquee';
import { PromptBook, Typed } from '../components/Book';
import { Diorama, Flat, PaletteArt, SurfaceArt, Tag, TypeArt } from '../components/Flats';
import { ChalkText, Spike } from '../components/Marks';
import { camera, everyFrame, tween } from '../lib/camera';
import { floor, standAt } from '../lib/stage';
import { hit, run, sceneLength, texture, voice } from '../sound';
import { SYNC_LEAD, handoff, ink } from '../theme';
import { BRIEF } from '../data/script';

gsap.registerPlugin(useGSAP);

/*
 * 03 · Set.
 * Looking up at the battens, three painted flats fly in: the film's own palette, typefaces and
 * surfaces. Then the pieces that recur line up downstage with brass tags, and three miniature
 * stages show the same pieces in different arrangements. The crate ends on spike A for 04.
 */
const vo = voice('03-set', 0.6);
const built = cue(vo, 'built once').start;
const palette = cue(vo, 'palette').start;
const typeface = cue(vo, 'typeface').start;
const surface = cue(vo, 'surface').start;
const pieces = cue(vo, 'few pieces').start;
const ret = cue(vo, 'return').start;
const every = cue(vo, 'every scene').start;
const rearranged = cue(vo, 'Rearranged').start;
const never = cue(vo, 'never redrawn').start; // 'never' alone also matches inside 'in every'
const redrawn = cue(vo, 'redrawn').start;
const said = cue(vo, 'redrawn').end;

/** Three flats upstage, spaced so the desk (x ≤ 504) and the ghost light (x ≥ 1497) stay clear of them. */
const FLATS = [floor(-0.32, 0.54), floor(0.14, 0.56), floor(0.6, 0.54)];
const FLAT_W = 320, FLAT_H = 420;
/**
 * The line-up on the apron, one depth for all three: the crate (x 534–733, lid from y 758) clears the
 * desk (x ≤ 504) and stays under the palette flat's brass tag (y ≤ 712) during the close-up, and its own
 * tag (y 932–956) stays above the footlights; the lantern stays left of the chalk frame's size label
 * (x 1275–1395) so it never stands on it.
 */
const LINE = [floor(-0.37, 0.06), floor(-0.06, 0.06), floor(0.2, 0.06)];
/** Three miniature stages on a rail, hung between the two lanterns (x 408–1512) and above the ghost light's cage. */
const CARDS = { top: 240, left: 488, step: 328, scale: 0.9 };
const MINI = [
  { label: '01 STAGE', gel: '#ffaa52', word: 'STAGE' },
  { label: '05 CUE', gel: '#6896ec', word: 'CUE' },
  { label: '08 CURTAIN', gel: '#ff769c', word: 'TRACK' },
] as const;
/** The miniatures' own floor plan: feet on the boards at y 150; the crate left, the ghost light right, the word hung between, centred on x 165. */
const MINI_FEET = 150, MINI_CRATE_X = 36, MINI_CRATE_S = 0.3, MINI_GHOST_X = 262, MINI_GHOST_S = 0.22, MINI_WORD_S = 0.3;
const MINI_SWAP = { crate: 150, ghost: -206 };
/** The Marquee svg starts 1.2 units left of its first letter, so a word centred on x 165 is placed by its letters, not its box. */
const miniWordLeft = (word: string) => 165 - (marqueeWidth(word, 18) / 2 + 18 * 1.2) * MINI_WORD_S;
const flatAt = (i: number) => FLATS[i]!.y - FLAT_H * FLATS[i]!.scale; // world y of a flat's top as rendered (it scales about its feet)
const flatCentre = (i: number) => ({ x: FLATS[i]!.x, y: flatAt(i) + FLAT_H * FLATS[i]!.scale * 0.5 });

export const sounds = [
  vo,
  texture('crate-down', 'scrape', 0.2, 0.5, 1.0),
  texture('flats-rope', 'rope', built - 0.3, 0.8, 1.7),
  // Runs of one hit go through run(): it thins them to a minimum gap and trims each clear of the next.
  ...run('battenStop', [0, 1, 2].map((i) => ({ id: `flat-land-${i}`, at: built + 0.95 + i * 0.22, volume: 0.7 }))),
  ...run('tape', [0, 1, 2, 3, 4, 5, 6].map((i) => ({ id: `chip-${i}`, at: palette + 0.05 + i * 0.07, volume: 0.35 })), 0.12),
  ...run('chalkTap', [{ id: 'type-a', at: typeface + 0.02, volume: 0.7 }, { id: 'type-b', at: typeface + 0.24, volume: 0.5 }]),
  texture('sweep', 'whoosh', surface + 0.1, 0.5, 0.8),
  texture('lineup-slide', 'scrape', pieces - 0.1, 0.6, 1.1),
  ...run('crate', [0, 1, 2].map((i) => ({ id: `lineup-stop-${i}`, at: pieces + 0.55 + i * 0.12, volume: 0.45 })), 0.25),
  // One rope covers the flats going out and the rail coming in; the rail lands once, then each card pats down.
  texture('rails', 'rope', ret - 0.4, 0.7, 1.7),
  hit('cards-stop', 'battenStop', ret + 0.55, 0.6, 0.45),
  ...run('tape', [0, 1, 2].map((i) => ({ id: `card-${i}`, at: ret + 0.6 + i * 0.14, volume: 0.3 })), 0.12),
  // Two whooshes from different parts of the file, back to back, not on top of each other.
  texture('swap-0', 'whoosh', rearranged + 0.05, 0.3, 0.6),
  texture('swap-1', 'whoosh', rearranged + 0.67, 0.3, 0.6, 0.3),
  ...run('ping', [0, 1, 2, 3].map((i) => ({ id: `tag-${i}`, at: never + 0.1 + i * 0.16, volume: 0.5 })), 0.15),
  texture('crate-to-a', 'scrape', redrawn + 0.4, 0.8, 1.2),
  hit('crate-at-a', 'crate', redrawn + 1.55, 0.8),
];
export const durationSec = sceneLength(sounds, 0.9, redrawn + 2.2);

export default function Set() {
  const theatre = useTheatre();
  useGSAP(() => {
    const tl = gsap.timeline();
    settleWords(tl);
    const rig = workedRig(0.5);
    const titleHalo = rig.lamps.find((l) => l.id === 'halo-title')!;
    const lens = camera(tl, { x: 960, y: 330, zoom: 1.25, roll: 0 });
    lens.move({ x: 960, y: 520, zoom: 1.02 }, built - 0.3, 2.0)
      .move({ x: flatCentre(0).x + 20, y: flatCentre(0).y, zoom: 1.75, roll: -1 }, palette - 0.35, 0.8)
      .move({ x: flatCentre(1).x, y: flatCentre(1).y, zoom: 1.75, roll: 0 }, typeface - 0.35, 0.7)
      .move({ x: flatCentre(2).x - 20, y: flatCentre(2).y, zoom: 1.75, roll: 1 }, surface - 0.35, 0.7)
      .move({ x: 1040, y: 665, zoom: 1.3, roll: 0 }, pieces - 0.45, 1.1) // 665 + 540 / 1.3 = 1080: the apron is the frame's bottom edge
      .move({ x: 960, y: 520, zoom: 1.02 }, ret - 0.2, 1.4)
      .move({ ...handoff.shots.house }, redrawn + 0.3, 1.6);

    // The title flies back into the grid as the set comes down: this beat belongs to the set.
    tl.to('.oc-title', { y: -900, duration: 1.3, ease: 'power2.inOut' }, 0.05);
    tween(tl, titleHalo, { on: 0, duration: 0.5 }, 0.05);

    // Flats fly in from the grid and land, one after another.
    tl.set('.oc-flat-set', { y: -1000 }, 0);
    tl.to('.oc-flat-set', { y: 0, duration: 1.25, ease: 'power2.inOut', stagger: 0.22 }, built - 0.3);
    tl.to('.oc-flat-set', { y: -6, duration: 0.5, ease: 'elastic.out(1, 0.5)', stagger: 0.22 }, built + 0.95);
    tween(tl, rig, { cycOn: 0.62, duration: 1.2 }, built);

    // Palette: chips fan out from the nail; typeface: specimens pop; surface: a light sweeps across.
    tl.set('.oc-chip', { rotation: -42, opacity: 0 }, 0);
    tl.to('.oc-chip', { opacity: 1, duration: 0.05, stagger: 0.07 }, palette);
    [0, 1, 2, 3, 4, 5, 6].forEach((i) => tl.to(`.oc-chip-${i}`, { rotation: -42 + i * 14, duration: 0.45, ease: 'back.out(1.6)' }, palette + 0.05 + i * 0.07));
    tl.fromTo('.oc-face-big', { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2)', stagger: 0.18 }, typeface);
    tl.fromTo('.oc-face:not(.oc-face-big)', { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'power2.out', stagger: 0.08 }, typeface + 0.3);
    tl.fromTo('.oc-surface', { x: 14, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power2.out', stagger: 0.1 }, surface - 0.05);
    tl.fromTo('.oc-surface-art', { '--sweep': 0 }, { '--sweep': 1, duration: 1.1, ease: 'power1.inOut' }, surface + 0.1);

    // The crate, which 02 left on spike A, is slid downstage first so the flats have the stage; it is
    // the front of the line the other pieces will join. (It stands 595–750 × 590–715 on A, inside the
    // palette flat's footprint, so it cannot stay there while the flats are read.)
    const lineAt = LINE[0]!, spikeA = SPIKE_A;
    tl.to('.oc-crate-travel', { x: lineAt.x - spikeA.x, y: lineAt.y - spikeA.y, scale: lineAt.scale / spikeA.scale, duration: 1.0, ease: 'power2.inOut' }, 0.2);
    // "a few pieces return": the marquee letter and the lantern come in from the wings and take their tags.
    tl.set('.oc-lineup:not(.oc-lineup-crate)', { x: 1500, opacity: 0 }, 0);
    tl.to('.oc-lineup:not(.oc-lineup-crate)', { x: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.12 }, pieces + 0.02);
    tl.fromTo('.oc-lineup .oc-tag', { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.12, ease: 'power2.out' }, pieces + 0.55);

    // Three miniature stages fly in on a rail as the flats fly out; the same pieces stand in each, arranged differently.
    tl.to('.oc-flat-set', { y: -1000, duration: 1.1, ease: 'power2.inOut', stagger: 0.08 }, ret - 0.4);
    tl.set('.oc-cards', { y: -700 }, 0);
    tl.to('.oc-cards', { y: 0, duration: 1.1, ease: 'power2.inOut' }, ret - 0.2);
    tl.fromTo('.oc-card', { scale: 0.92, opacity: 0.6 }, { scale: 1, opacity: 1, duration: 0.4, stagger: 0.14, ease: 'power2.out' }, ret + 0.6);
    // "Rearranged": inside every card, pieces trade places.
    tl.to('.oc-mini-a', { x: MINI_SWAP.crate, duration: 0.7, ease: 'power2.inOut', stagger: 0.12 }, rearranged);
    tl.to('.oc-mini-b', { x: MINI_SWAP.ghost, duration: 0.7, ease: 'power2.inOut', stagger: 0.12 }, rearranged);
    tl.to('.oc-mini-c', { y: -22, duration: 0.35, ease: 'power2.out', yoyo: true, repeat: 1, stagger: 0.12 }, rearranged + 0.15);
    // "never redrawn": brass tags catch the light, and the chalk says so.
    tl.fromTo('.oc-tag', { filter: 'brightness(1)' }, { filter: 'brightness(1.9)', duration: 0.12, yoyo: true, repeat: 1, stagger: 0.16 }, never + 0.05);
    tl.fromTo('.oc-note-once', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, never);

    // The crate goes back up to spike A, where 04 needs it; its tag comes off. The others slide back to the wings.
    tl.to('.oc-lineup-crate .oc-tag', { opacity: 0, duration: 0.25 }, redrawn + 0.3);
    tl.to('.oc-crate-travel', { x: 0, y: 0, scale: 1, duration: 1.2, ease: 'power2.inOut' }, redrawn + 0.4);
    tl.to('.oc-lineup:not(.oc-lineup-crate)', { x: 1500, opacity: 0, duration: 0.7, ease: 'power2.in', stagger: 0.08 }, redrawn + 0.5);
    tl.to('.oc-cards', { y: -700, duration: 1.0, ease: 'power2.inOut' }, redrawn + 0.8);

    everyFrame(tl, durationSec, (t) => theatre.paint(rig, lens.shot, t));
  }, { scope: theatre.root });

  return (
    <Theatre theatre={theatre}>
      <Dressing words={false}>
        <Spike at={SPIKE_A} label="A" angle={-4} />
        <Spike at={SPIKE_B} label="B" angle={3} colour={ink.tapeWhite} />
        {/* Three flats, upstage. */}
        {[<PaletteArt key="p" />, <TypeArt key="t" />, <div key="s" className="oc-abs oc-surface-art" style={{ inset: 0 }}><SurfaceArt /></div>].map((art, i) => (
          <Flat key={i} className={`oc-flat-set oc-flat-${i}`} width={FLAT_W} height={FLAT_H} label={['PALETTE', 'TYPEFACE', 'SURFACE'][i]!}
            style={standAt(FLATS[i]!, FLAT_W, FLAT_H)}>{art}</Flat>
        ))}

        <DeskAt lamp={0.6}>
          <PromptBook style={{ left: BOOK.left, top: BOOK.top, transform: BOOK_TRANSFORM, transformOrigin: '50% 100%' }}
            left={<Typed size={13} style={{ padding: '26px 22px', opacity: 0.75 }}>PROMPT BOOK<br />ON CUE</Typed>} right={<Typed size={12.5} style={{ padding: '22px 20px' }}>{BRIEF}</Typed>} />
          <CueLight style={CUE_LIGHT_STYLE} />
        </DeskAt>

        {/* The line-up of recurring pieces, downstage. The crate starts on spike A (from 02) and travels back to it at the end.
            GSAP owns `.oc-crate-travel` (x, y and a scale about the crate's feet, all relative to 1); the depth scale stays
            on the box inside, because a GSAP `scale` target is absolute and would replace it. */}
        <div className="oc-lineup oc-lineup-crate oc-abs" style={{ left: 0, top: 0 }}>
          <div className="oc-abs oc-crate-travel" style={{ left: 0, top: 0, transformOrigin: `${SPIKE_A.x}px ${SPIKE_A.y}px` }}>
            <div className="oc-abs" style={standAt(SPIKE_A, 240, 200)}>
              <Crate style={{ left: 0, top: 0 }} />
              <Tag style={{ left: 58, top: 208, opacity: 0 }}>CRATE</Tag>
            </div>
          </div>
        </div>
        <div className="oc-lineup oc-abs" style={standAt(LINE[1]!, 300, 220)}>
          <Marquee word="C" unit={28} lit={1} style={{ left: 50, top: 24 }} className="oc-lineup-letter" />
          <Tag style={{ left: 88, top: 232 }}>MARQUEE</Tag>
        </div>
        {/* A lantern on a boom stand: base, pole, a side arm at the top, and the lantern clamped to the arm, hanging beside the pole. */}
        <div className="oc-lineup oc-abs" style={standAt(LINE[2]!, 160, 240)}>
          <div className="oc-abs" style={{ left: 30, top: 226, width: 100, height: 14, borderRadius: 7, background: '#2b2d33' }} />
          <div className="oc-abs" style={{ left: 74, top: 24, width: 12, height: 204, background: 'linear-gradient(90deg,#3a3d45,#8a8f9a,#23252b)' }} />
          <div className="oc-abs" style={{ left: 80, top: 22, width: 34, height: 6, borderRadius: 3, background: 'linear-gradient(180deg,#5a5e68,#2b2d33)' }} />
          <Lantern style={{ left: 62, top: 26, ['--lit' as string]: 0.35 }} gel={ink.brassHi} />
          <Tag style={{ left: 18, top: 252 }}>LANTERN</Tag>
        </div>

        {/* Three miniature stages on a rail. */}
        <div className="oc-cards oc-abs" style={{ left: 0, top: 0 }}>
          <div className="oc-abs" style={{ left: 420, top: CARDS.top - 12, width: 1080, height: 8, background: 'linear-gradient(180deg,#5a5e68,#24262c)' }} />
          {/* Each card pops in on `.oc-card`, a wrapper GSAP scales from 0.92 to 1; the card's own 0.9 sits on the Diorama inside, untouched. */}
          {MINI.map((m, i) => (
            <div key={i} className="oc-abs oc-card" style={{ left: CARDS.left + i * CARDS.step, top: CARDS.top, transformOrigin: '0 0' }}>
              <Diorama className={`oc-card-${i}`} label={m.label} gelColour={m.gel} style={{ left: 0, top: 0, transform: `scale(${CARDS.scale})`, transformOrigin: '0 0' }}>
                <div className="oc-abs" style={{ left: 8, top: -2000, width: 2, height: 2000 + 2, background: 'rgba(160,150,130,.5)' }} />
                <div className="oc-abs" style={{ left: 310, top: -2000, width: 2, height: 2000 + 2, background: 'rgba(160,150,130,.5)' }} />
                {/* Inside each card (320 × 190, boards from y 105): a lantern top left, the word hung centre (letters y 50–82),
                    the crate and the ghost light standing on the boards at y 150 either side of it. The swap sends the crate
                    right and the ghost light left, and both paths stay under the word and clear of the lantern. */}
                <div className="oc-abs oc-mini-a" style={{ left: MINI_CRATE_X + (i % 2) * 16, top: MINI_FEET, transform: `scale(${MINI_CRATE_S})`, transformOrigin: '0 100%' }}><Crate style={{ left: 0, top: -200 }} /></div>
                <div className="oc-abs oc-mini-b" style={{ left: MINI_GHOST_X - (i % 2) * 8, top: MINI_FEET, transform: `scale(${MINI_GHOST_S})`, transformOrigin: '0 100%' }}><Ghostlight lit={1} style={{ left: 0, top: -420 }} /></div>
                <div className="oc-abs oc-mini-c" style={{ left: miniWordLeft(m.word), top: 42, transform: `scale(${MINI_WORD_S})`, transformOrigin: '0 0' }}><Marquee word={m.word} unit={18} lit={1} /></div>
                <div className="oc-abs" style={{ left: 8, top: -6, transform: 'scale(0.5)', transformOrigin: '0 0' }}><Lantern style={{ ['--lit' as string]: 1 }} gel={m.gel} /></div>
              </Diorama>
            </div>
          ))}
        </div>
        {/* Chalked on the back wall between the cards' tags (y ≤ 455) and the crate's lid once it is back on spike A (y ≥ 590). */}
        <ChalkText className="oc-note-once" x={960} y={505} size={34} align="middle" colour={ink.chalk} opacity={0.85}>same pieces — arranged again, never drawn again</ChalkText>
      </Dressing>
    </Theatre>
  );
}
