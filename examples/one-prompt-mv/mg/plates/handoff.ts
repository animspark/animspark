// Hand-off contracts: where the motif sits on screen at each boundary, so the film plays as one take.
// Both plates of a boundary call these; screen coordinates are logical 1920x1080 px, y down.
import { wStart } from './lyric';

const BEAT = 0.4918032786885246, FB = 0.102;
/** the last beat at or before t */
export const beatBefore = (t: number) => FB + Math.floor((t - FB) / BEAT + 1e-6) * BEAT;

/** plate boundaries (song s), cut on the beat before each plate's first line */
export const CUT = {
  prompt: beatBefore(wStart(2)), // "Type"
  ridge: beatBefore(wStart(9)), // "Hear"
  city: beatBefore(wStart(15)), // "Stack"
  plot: beatBefore(wStart(34)), // "Lights,"
  hook: beatBefore(wStart(37)), // "One" (chorus)
  zoetrope: beatBefore(wStart(41)), // "Say"
  beam: beatBefore(wStart(48)), // "Every"
  marquee: beatBefore(wStart(53)), // "One" (… tonight)
  sky: beatBefore(wStart(58)), // "Paint"
  mix: beatBefore(wStart(70)), // "Make"
  stadium: beatBefore(wStart(76)), // "Rain"
  edit: beatBefore(wStart(82)), // "Cut!"
  hook2: beatBefore(wStart(92)), // "One" (final chorus)
  earth: beatBefore(wStart(96)), // "Say"
  premiere: beatBefore(wStart(108)), // "One" (… tonight)
  outro: beatBefore(wStart(113)), // "All"
};

/** H1 leader → prompt: the caret, a signal block, steady (not blinking) across the cut */
export const CARET_H1 = { x: 300, y: 540, w: 14, h: 58 };

/**
 * H2 prompt → ridge: the letters of "drop" fall out of the prompt and keep falling across the cut.
 * Screen position of letter k (0..3) at t, while the camera follows them down (so they fall slowly on
 * screen): typed at x0 + k*38.4, y 540 at t0 = start of "drop"; they are at y≈890..904 at the cut,
 * then the ridge plate lands them on the front ridge on "hit" (word 11).
 */
export function dropLetter(k: number, t: number) {
  const t0 = wStart(8) + 0.1 + k * 0.07;
  const x0 = DROP_X0 + k * 38.4;
  if (t < t0) return { x: x0, y: 540, rot: 0, v: 0 };
  const d = t - t0;
  // first a real fall (0.35 s), then the camera catches up: screen velocity eases to a slow 60 px/s
  const fall = 0.5 * 1800 * Math.min(d, 0.35) ** 2 + (d > 0.35 ? (1800 * 0.35) * (1 - Math.exp(-(d - 0.35) * 4)) / 4 + 60 * (d - 0.35) : 0);
  const spin = (k % 2 ? 1 : -1) * (0.9 + 0.35 * k) * Math.min(d, 1.2);
  return { x: x0 + (k - 1.5) * 14 * Math.min(d, 1), y: 540 + fall, rot: spin, v: 60 };
}
/** x of the "d" of "drop" as typed in the prompt (the prompt plate owns the layout; keep in sync) */
export const DROP_X0 = 316 + 38.4 * 23; // "Type a word and let it " is 23 characters of 64 px Plex Mono (advance 38.4)

/** H3 ridge → city: a single bone hairline across the frame (the ground line), the spark riding it */
export const GROUND_H3 = { y: 780, sparkX: 1500 };

/** H4 city → plot: one lit window at frame centre, which becomes the Fresnel lens */
export const WINDOW_H4 = { x: 960, y: 540, w: 60, h: 40 };

/** H5 plot → hook: the caret blinking at frame centre */
export const CARET_H5 = { x: 960, y: 540, w: 14, h: 58 };

/** FRAMES, the in-world counter: frames of film made so far (24 fps, from "line") */
export const frames = (t: number) => (t < wStart(1) ? 0 : Math.floor(24 * (t - wStart(1))) + 1);

/* ── the second half ─────────────────────────────────────────────────────────── */
/** H6 hook1 → zoetrope: a signal ring at frame centre (the zoetrope's drum, seen from straight above) */
export const RING_H6 = { x: 960, y: 540, r: 260 };
/** H7 zoetrope → beam: one bright vertical slit at frame centre (a zoetrope slit = the projector's gate) */
export const SLIT_H7 = { x: 960, y: 540, w: 12, h: 300 };
/** H8 beam → marquee: the lit cinema screen, a bone-lit rectangle, which is the marquee's letter board */
export const SCREEN_H8 = { x: 960, y: 500, w: 1000, h: 420 };
/** H9 marquee → sky: a roofline hairline at y = 900 with open night sky above it (the camera tilted up) */
export const ROOF_H9 = { y: 900 };
/** H11 sky → mix: the murmuration condensed to one hot dot at frame centre (the VU needle's pivot) */
export const DOT_H11 = { x: 960, y: 540, r: 6 };
/** H12 mix → stadium: the hard-clipped waveform: two signal rails (0 dBFS) across the frame */
export const RAILS_H12 = { y1: 300, y2: 780 };
/** H13 stadium → edit: three horizontal hairlines across the frame (touchlines become timeline tracks) */
export const TRACKS_H13 = { ys: [380, 560, 740] as const };
/** H14 edit → hook2: the frame is solid signal orange (inside the BEAT! clip) */
export const ORANGE_H14 = true;
/** H15 hook2 → earth: a bone circle at frame centre (the globe's limb) */
export const GLOBE_H15 = { x: 960, y: 540, r: 380 };
/** H17 earth → premiere: one hot point of city light at frame centre (the city we descend into) */
export const POINT_H17 = { x: 960, y: 540 };
/** H18 premiere → outro: one bone hairline across the frame at y = 540 with the spark at x = 1500 */
export const LINE_H18 = { y: 540, sparkX: 1500 };
/** H19 outro → brand: the caret block (CARET_H1's size) at the mark's centre, where the line retracts */
export const MARK_C = { x: 515, y: 540 };
/** outro → leader (loop): the film's last frame is its first: black, the caret dim at CARET_H1 */
