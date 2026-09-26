import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue } from '@animspark/runtime';
import { Theatre, useTheatre } from '../components/Theatre';
import { BOOK, BOOK_TRANSFORM, CUE_LIGHT_STYLE, DeskAt, Dressing, SM_AT, SM_SIZE, SPIKE_A, SPIKE_B, settleWords, workedRig } from '../components/Set';
import { CueLight } from '../components/Fixtures';
import { Crate } from '../components/Props';
import { Hand, HAND_JOINTS } from '../components/Hand';
import { PromptBook, Typed } from '../components/Book';
import { Chalk, ChalkText, Spike } from '../components/Marks';
import { camera, everyFrame, tween } from '../lib/camera';
import { floor, standAt } from '../lib/stage';
import { hit, sceneLength, texture, voice } from '../sound';
import { SYNC_LEAD, handoff, ink, type } from '../theme';
import { BRIEF } from '../data/script';

gsap.registerPlugin(useGSAP);

/*
 * 04 · Blocking.
 * The crate has to get from spike A to spike B. A ghost crate does it the wrong way, on a straight
 * chalk line, to a metronome. Then the stagehand does it properly: a breath back, a step with a
 * curve, a settle; the spacing ticks the move leaves behind are the same curve the chalk draws on
 * the cyc. The crate ends on B under the spot 05 will call, and the stagehand walks to the desk,
 * where 05 finds him.
 */
const vo = voice('04-blocking', 0.5);
const move = cue(vo, 'move').start;
const never = cue(vo, 'Never').start;
const straight = cue(vo, 'straight').start;
const A = cue(vo, 'from A').start;
const B = cue(vo, 'to B').start;
const breath = cue(vo, 'breath').start;
const step = cue(vo, 'step').start;
const settle = cue(vo, 'settle').start;
const curve = cue(vo, 'curve').start;
const character = cue(vo, 'character').start;
const said = cue(vo, 'character').end;

const EASE = 'power3.inOut';
const STEP = 1.05; // how long the real move takes
/** The same curve GSAP runs, as a function, so the ticks and the graph are computed from it. */
const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const DX = SPIKE_B.x - SPIKE_A.x;
const TICKS = 13;
const tickX = (i: number) => SPIKE_A.x + DX * ease(i / (TICKS - 1));
/** The stagehand waits upstage-left of the crate, so the crate hides his legs and the desk is well clear of him. */
const HAND_AT = floor(handoff.spikeA.sx - 0.1, 0.5);
/** Once the crate has settled he turns and walks to his mark behind the desk, where 05 opens on him; the walk is four steps. */
const WALK_AT = settle + 0.9, TURN = 0.25, WALK = 1.2, STEPS = 4;

/** The ease as a chalk graph on the cyc: time along, position up; it sits right of centre, clear of the desk and the stage manager's walk to it. */
const GRAPH = { x: 800, y: 210, w: 520, h: 260 };
const curvePath = Array.from({ length: 41 }, (_, i) => {
  const p = i / 40;
  return `${i ? 'L' : 'M'}${(GRAPH.x + p * GRAPH.w).toFixed(1)} ${(GRAPH.y + GRAPH.h - ease(p) * GRAPH.h).toFixed(1)}`;
}).join(' ');
const linePath = `M${GRAPH.x} ${GRAPH.y + GRAPH.h} L${GRAPH.x + GRAPH.w} ${GRAPH.y}`;

export const sounds = [
  vo,
  // Same-file textures must not overlap (they phase): each stroke ends before the next begins.
  texture('chalk-straight', 'chalk', move - 0.1, 0.8, Math.min(0.8, never + 0.03 - (move - 0.1))),
  hit('tick-a', 'tick', move + 0.25, 0.8),
  hit('tick-b', 'tick', move + 1.15, 0.8),
  texture('ghost-slide', 'slide', move + 0.25, 0.35, 0.9),
  texture('chalk-cross', 'chalk', never + 0.05, 0.9, 0.5),
  texture('chalk-cross-2', 'chalk', never + 0.56, 0.7, 0.4, 0.4),
  hit('mark-a', 'chalkTap', A, 0.7),
  hit('mark-b', 'chalkTap', B, 0.7),
  hit('breath-dust', 'dust', breath + 0.05, 0.7),
  texture('crate-scrape', 'scrape', step - SYNC_LEAD, 0.9, STEP + 0.1),
  hit('crate-settle', 'thud', step + STEP - SYNC_LEAD, 0.9),
  hit('settle-rock', 'crate', settle + 0.32, 0.35, 0.3),
  texture('chalk-graph', 'chalk', curve - 0.2, 0.8, 0.85),
  texture('chalk-graph-2', 'chalk', curve + 0.7, 0.6, Math.min(0.6, character + 0.08 - (curve + 0.7)), 0.2),
  texture('chalk-words', 'chalk', character + 0.1, 0.7, 0.8),
  hit('spot-warm', 'spot', said + 0.4, 0.6),
];
export const durationSec = sceneLength(sounds, 0.9, said + 1.9);

export default function Blocking() {
  const theatre = useTheatre();
  useGSAP(() => {
    const tl = gsap.timeline();
    settleWords(tl);
    const rig = workedRig();
    const lx12 = rig.lamps.find((l) => l.id === 'lx12')!;
    const lens = camera(tl, handoff.shots.house);
    // Floor-level, but no lower than the world: at zoom 1.32 the frame reaches 409 px below its centre.
    lens.move({ x: 960, y: 670, zoom: 1.32 }, 0.1, 1.6)
      .move({ x: 1040, y: 670, zoom: 1.32 }, step, STEP, EASE)
      .move({ x: 960, y: 560, zoom: 1.05 }, curve - 0.5, 1.4)
      .move({ ...handoff.shots.crateB }, said + 0.3, 1.8);

    // Stagehand waits behind the crate, breathing. The breath stops when he sets off.
    tl.set('.oc-hand-torso', { svgOrigin: HAND_JOINTS.torso }, 0);
    tl.set('.oc-hand-arm-f', { svgOrigin: HAND_JOINTS.armF }, 0);
    tl.set('.oc-hand-arm-b', { svgOrigin: HAND_JOINTS.armB }, 0);
    tl.set('.oc-hand-leg-f', { svgOrigin: HAND_JOINTS.legF }, 0);
    tl.set('.oc-hand-leg-b', { svgOrigin: HAND_JOINTS.legB }, 0);
    // An even number of half-breaths, all finished before the lean at "breath": two tweens on one
    // property must not overlap in a seekable timeline, and the last half-breath ends at rest.
    const breaths = Math.floor((breath - 0.05) / 1.7) & ~1;
    if (breaths >= 2) tl.to('.oc-hand-torso', { rotation: 1.5, duration: 1.7, yoyo: true, repeat: breaths - 1, ease: 'sine.inOut' }, 0);

    // The wrong way: a straight chalk line and a ghost crate on a metronome.
    tl.fromTo('.oc-straight .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.8, ease: 'none' }, move - 0.1);
    tl.set('.oc-ghost-crate', { x: 0, opacity: 0 }, 0);
    tl.to('.oc-ghost-crate', { opacity: 0.42, duration: 0.15 }, move + 0.15);
    tl.to('.oc-ghost-crate', { x: DX, duration: 0.9, ease: 'none' }, move + 0.25);
    // "Never straight": a red chalk cross, and the ghost is dismissed.
    tl.fromTo('.oc-cross .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.7, ease: 'power1.inOut' }, never + 0.05);
    tl.to('.oc-ghost-crate', { opacity: 0, duration: 0.5 }, straight + 0.2);
    // "from A to B": the spikes answer.
    tl.fromTo('.oc-ring-a .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.35 }, A - 0.05);
    tl.fromTo('.oc-ring-b .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.35 }, B - 0.05);

    // "a breath before the step": lean back, crate tilts on its heel.
    tl.to('.oc-hand-torso', { rotation: -9, duration: 0.45, ease: 'power2.out' }, breath - 0.05);
    tl.to('.oc-hand-arm-f', { rotation: -30, duration: 0.45, ease: 'power2.out' }, breath - 0.05);
    tl.to('.oc-hand-arm-b', { rotation: -20, duration: 0.45, ease: 'power2.out' }, breath - 0.05);
    tl.to('.oc-crate-move', { rotation: -5, duration: 0.45, ease: 'power2.out' }, breath - 0.05);
    tl.fromTo('.oc-puff', { opacity: 0.55, scale: 0.3 }, { opacity: 0, scale: 1.6, duration: 0.8, ease: 'power2.out' }, breath);
    // "step": the move, with its curve. Ticks appear as the crate passes them: the spacing chart.
    tl.to('.oc-hand-torso', { rotation: 16, duration: 0.3, ease: 'power3.in' }, step - SYNC_LEAD);
    tl.to('.oc-hand-arm-f', { rotation: -70, duration: 0.3, ease: 'power3.in' }, step - SYNC_LEAD);
    tl.to('.oc-hand-arm-b', { rotation: -55, duration: 0.3, ease: 'power3.in' }, step - SYNC_LEAD);
    tl.to('.oc-mover', { x: DX, duration: STEP, ease: EASE }, step - SYNC_LEAD);
    tl.to('.oc-crate-move', { rotation: 6, duration: STEP * 0.5, ease: 'power2.inOut' }, step - SYNC_LEAD);
    tl.to('.oc-crate-move', { y: -26, duration: STEP * 0.5, ease: 'sine.inOut', yoyo: true, repeat: 1 }, step - SYNC_LEAD);
    tl.fromTo('.oc-arc .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: STEP, ease: EASE }, step - SYNC_LEAD);
    for (let i = 0; i < TICKS; i++) {
      tl.fromTo(`.oc-tick-${i}`, { opacity: 0, scaleY: 0.2 }, { opacity: 0.95, scaleY: 1, duration: 0.12, ease: 'power2.out' }, step - SYNC_LEAD + (i / (TICKS - 1)) * STEP);
    }
    tl.fromTo('.oc-spacing', { opacity: 0 }, { opacity: 1, duration: 0.3 }, step + STEP * 0.5);
    // "settle after": overshoot, rock back, dust.
    tl.to('.oc-crate-move', { rotation: -3, duration: 0.28, ease: 'power2.out' }, step + STEP - SYNC_LEAD);
    tl.to('.oc-crate-move', { rotation: 0, duration: 0.9, ease: 'elastic.out(1, 0.35)' }, step + STEP + 0.25);
    tl.to('.oc-hand-torso', { rotation: 0, duration: 0.8, ease: 'elastic.out(1, 0.45)' }, step + STEP);
    tl.to('.oc-hand-arm-f, .oc-hand-arm-b', { rotation: 0, duration: 0.8, ease: 'power2.out' }, step + STEP);
    tl.fromTo('.oc-land-dust', { opacity: 0.6, scale: 0.2 }, { opacity: 0, scale: 1.8, duration: 0.9, ease: 'power2.out' }, step + STEP - SYNC_LEAD);

    // His job here is done: he turns to face the prompt corner and walks to his mark behind the desk's
    // near end, growing as he comes downstage; the desk (drawn last) takes his legs as he arrives.
    // He is standing there, facing the book, when 05 cuts in.
    tl.to('.oc-hand-turn', { scaleX: -HAND_AT.scale, duration: TURN, ease: 'power1.inOut' }, WALK_AT);
    // He clears the crate's side before he comes downstage (he is drawn behind it), so y follows x.
    tl.to('.oc-hand-walk', { x: SM_AT.x - HAND_AT.x, duration: WALK, ease: 'power1.inOut' }, WALK_AT + TURN);
    tl.to('.oc-hand-walk', { y: SM_AT.y - HAND_AT.y, duration: WALK, ease: 'power2.in' }, WALK_AT + TURN);
    tl.to('.oc-hand-turn', { scaleX: -SM_AT.scale, scaleY: SM_AT.scale, duration: WALK, ease: 'power2.in' }, WALK_AT + TURN);
    tl.to('.oc-hand-leg-f', { rotation: 16, duration: WALK / STEPS, yoyo: true, repeat: STEPS - 1, ease: 'sine.inOut' }, WALK_AT + TURN);
    tl.to('.oc-hand-leg-b', { rotation: -16, duration: WALK / STEPS, yoyo: true, repeat: STEPS - 1, ease: 'sine.inOut' }, WALK_AT + TURN);
    tl.to('.oc-hand-arm-f', { rotation: -10, duration: WALK / STEPS, yoyo: true, repeat: STEPS - 1, ease: 'sine.inOut' }, WALK_AT + TURN);
    tl.to('.oc-hand-arm-b', { rotation: 10, duration: WALK / STEPS, yoyo: true, repeat: STEPS - 1, ease: 'sine.inOut' }, WALK_AT + TURN);

    // "The curve is the character": the same ease, chalked on the cyc, with the ticks it produces.
    tl.fromTo('.oc-graph-axes .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.6, ease: 'power1.inOut' }, curve - 0.35);
    tl.fromTo('.oc-graph-line .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: 'none' }, curve - 0.1);
    tl.fromTo('.oc-graph-curve .oc-chalk-line', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.85, ease: 'power1.inOut' }, curve + 0.05);
    tl.fromTo('.oc-graph-label', { opacity: 0 }, { opacity: 1, duration: 0.3, stagger: 0.1 }, curve + 0.5);
    for (let i = 0; i < TICKS; i++) {
      tl.fromTo(`.oc-gtick-${i}`, { opacity: 0 }, { opacity: 0.9, duration: 0.1 }, curve + 0.05 + (i / (TICKS - 1)) * 0.85);
    }
    tl.fromTo('.oc-character', { clipPath: 'inset(-20% 100% -20% 0)' }, { clipPath: 'inset(-20% -2% -20% 0)', duration: 0.9, ease: 'power1.inOut' }, character + 0.05);

    // Hand-off: the spot over B warms up on the crate, and the work light steps back. The chalk is
    // wiped (floor marks, then the graph and its caption) so 05 opens on the same frame with only
    // the crate, the spikes and the desk to account for: no jump at the cut.
    tween(tl, lx12, { on: 0.45, duration: 1.1, ease: "power2.inOut" }, said + 0.4);
    tween(tl, rig, { work: 0.4, duration: 1.4 }, said + 0.4);
    tl.to('.oc-straight, .oc-cross, .oc-ring-a, .oc-ring-b, .oc-arc, .oc-tick, .oc-spacing', { opacity: 0, duration: 0.6, ease: 'power1.in' }, said + 0.7);
    tl.to('.oc-graph-axes, .oc-graph-line, .oc-graph-curve, .oc-gtick, .oc-graph-label, .oc-character', { opacity: 0, duration: 0.7, ease: 'power1.in' }, said + 0.9);

    everyFrame(tl, durationSec, (t) => theatre.paint(rig, lens.shot, t));
  }, { scope: theatre.root });

  const base = SPIKE_A;
  return (
    <Theatre theatre={theatre}>
      <Dressing title={false} words={false}>
        <Spike at={SPIKE_A} label="A" angle={-4} />
        <Spike at={SPIKE_B} label="B" angle={3} colour={ink.tapeWhite} />
        {/* Floor marks the move leaves behind. */}
        <Chalk className="oc-straight" d={`M${SPIKE_A.x} ${SPIKE_A.y + 6} L${SPIKE_B.x} ${SPIKE_B.y + 6}`} width={4} opacity={0.75} />
        <Chalk className="oc-cross" d={`M${(SPIKE_A.x + SPIKE_B.x) / 2 - 36} ${base.y - 30} L${(SPIKE_A.x + SPIKE_B.x) / 2 + 36} ${base.y + 40} M${(SPIKE_A.x + SPIKE_B.x) / 2 + 36} ${base.y - 30} L${(SPIKE_A.x + SPIKE_B.x) / 2 - 36} ${base.y + 40}`} width={6} colour={ink.red} />
        <Chalk className="oc-ring-a" d={`M${SPIKE_A.x - 70} ${SPIKE_A.y} a70 30 0 1 0 140 0 a70 30 0 1 0 -140 0`} width={4} />
        <Chalk className="oc-ring-b" d={`M${SPIKE_B.x - 70} ${SPIKE_B.y} a70 30 0 1 0 140 0 a70 30 0 1 0 -140 0`} width={4} />
        <Chalk className="oc-arc" d={`M${SPIKE_A.x} ${base.y - 4} Q${(SPIKE_A.x + SPIKE_B.x) / 2} ${base.y - 150} ${SPIKE_B.x} ${base.y - 4}`} width={4} opacity={0.8} />
        {Array.from({ length: TICKS }, (_, i) => (
          <div key={i} className={`oc-abs oc-tick oc-tick-${i}`} style={{ left: tickX(i) - 2, top: base.y + 14, width: 4, height: 26, background: ink.chalk, opacity: 0, borderRadius: 2, transformOrigin: '50% 0', boxShadow: `0 0 6px ${ink.chalk}88` }} />
        ))}
        <ChalkText className="oc-spacing" x={SPIKE_A.x} y={base.y + 70} size={20} align="middle" font={type.label} weight={600} opacity={0.7}>SPACING</ChalkText>

        {/* The cyc graph. */}
        <Chalk className="oc-graph-axes" d={`M${GRAPH.x} ${GRAPH.y - 20} L${GRAPH.x} ${GRAPH.y + GRAPH.h} L${GRAPH.x + GRAPH.w + 30} ${GRAPH.y + GRAPH.h}`} width={4} />
        <Chalk className="oc-graph-line" d={linePath} width={3} colour={ink.red} opacity={0.6} />
        <Chalk className="oc-graph-curve" d={curvePath} width={6} />
        {Array.from({ length: TICKS }, (_, i) => (
          <div key={i} className={`oc-abs oc-gtick oc-gtick-${i}`} style={{ left: GRAPH.x + ease(i / (TICKS - 1)) * GRAPH.w - 2, top: GRAPH.y + GRAPH.h + 8, width: 3, height: 16, background: ink.chalk, opacity: 0 }} />
        ))}
        <ChalkText className="oc-graph-label" x={GRAPH.x + GRAPH.w + 40} y={GRAPH.y + GRAPH.h + 6} size={22} font={type.label} weight={600} opacity={0.8}>TIME →</ChalkText>
        <ChalkText className="oc-graph-label" x={GRAPH.x - 14} y={GRAPH.y - 32} size={22} align="end" font={type.label} weight={600} opacity={0.8}>POSITION ↑</ChalkText>
        <ChalkText className="oc-graph-label" x={GRAPH.x + 150} y={GRAPH.y + 60} size={20} font={type.label} weight={600} colour={ink.red} opacity={0.75}>STRAIGHT</ChalkText>
        <ChalkText className="oc-graph-label" x={GRAPH.x + GRAPH.w - 20} y={GRAPH.y + GRAPH.h - 120} size={20} align="end" font={type.label} weight={600} opacity={0.85}>ease: {EASE}</ChalkText>
        {/* The caption sits under the graph, above the crate's lid (y 590) and well right of the desk the stage manager walks to. */}
        <div className="oc-abs oc-character" style={{ left: 0, top: 0, width: 1920, height: 1080, clipPath: 'inset(-20% 100% -20% 0)' }}>
          <ChalkText x={GRAPH.x + GRAPH.w / 2} y={GRAPH.y + GRAPH.h + 65} size={44} align="middle" opacity={0.95}>the curve is the character</ChalkText>
        </div>

        {/* The ghost crate, then the real one with the stagehand behind it. He turns and walks inside `.oc-hand-turn`, which scales about his feet. */}
        <div className="oc-abs oc-ghost-crate" style={{ ...standAt(SPIKE_A, 240, 200), opacity: 0, filter: 'grayscale(1) brightness(0.7)' }}><Crate style={{ left: 0, top: 0 }} stencil="STRAIGHT" /></div>
        <div className="oc-abs oc-mover oc-hand-walk" style={{ left: 0, top: 0 }}>
          <div className="oc-abs oc-hand-turn" style={standAt(HAND_AT, SM_SIZE.w, SM_SIZE.h)}><Hand /></div>
        </div>
        <div className="oc-abs oc-mover" style={{ left: 0, top: 0 }}>
          <div className="oc-abs oc-crate-move" style={{ ...standAt(SPIKE_A, 240, 200), transformOrigin: '50% 100%' }}>
            <Crate style={{ left: 0, top: 0 }} />
            <div className="oc-abs oc-puff" style={{ left: -40, top: 150, width: 320, height: 70, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(230,215,180,.6), rgba(230,215,180,0) 70%)', opacity: 0 }} />
            <div className="oc-abs oc-land-dust" style={{ left: -60, top: 140, width: 360, height: 90, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(230,215,180,.7), rgba(230,215,180,0) 70%)', opacity: 0 }} />
          </div>
        </div>

        {/* The desk is the most downstage thing here, so it is drawn last: the stagehand exits behind it into the wing. */}
        <DeskAt lamp={0.6}>
          <PromptBook style={{ left: BOOK.left, top: BOOK.top, transform: BOOK_TRANSFORM, transformOrigin: '50% 100%' }}
            left={<Typed size={13} style={{ padding: '26px 22px', opacity: 0.75 }}>PROMPT BOOK<br />ON CUE</Typed>} right={<Typed size={12.5} style={{ padding: '22px 20px' }}>{BRIEF}</Typed>} />
          <CueLight style={CUE_LIGHT_STYLE} />
        </DeskAt>
      </Dressing>
    </Theatre>
  );
}
