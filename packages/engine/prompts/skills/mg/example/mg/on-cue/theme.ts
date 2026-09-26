import type { Shot } from './lib/camera';
import type { RGB } from './lib/paint';

/**
 * The visual language of "On Cue". Every scene and component reads these; nobody invents a second red.
 *
 * Colour carries meaning: chalk and pencil are the working notes, brass is what lasts, gels are moods
 * cast on the same set, and the cue light speaks in exactly two colours.
 */
export const ink = {
  house: '#0d0a10',
  houseDeep: '#06050a',
  velvet: '#6f1a2a',
  velvetHi: '#a6303f',
  velvetLo: '#3d0c16',
  oak: '#8d5f31',
  oakHi: '#c08d52',
  oakLo: '#4f3218',
  brass: '#c9a052',
  brassHi: '#f3dc95',
  brassLo: '#6e5120',
  chalk: '#efe6d3',
  paper: '#efe6d2',
  paperShade: '#d5c8ab',
  graphite: '#2a2830',
  pencil: '#2f5fb5',
  red: '#d43b2e',
  cueRed: '#ff4136',
  cueGreen: '#38e07f',
  tape: '#e9c95a',
  tapeWhite: '#f4efe3',
  metal: '#24262c',
  metalHi: '#565a64',
  cream: '#fff5df',
} as const;

/** Gel colours as numbers so the rig can tween them. */
export const gel: Record<'amber' | 'straw' | 'steel' | 'rose' | 'work' | 'ghost' | 'green', RGB> = {
  amber: [255, 170, 82],
  straw: [255, 226, 168],
  steel: [104, 150, 236],
  rose: [255, 118, 156],
  work: [236, 222, 196],
  ghost: [255, 208, 140],
  green: [86, 226, 140],
};

export const type = {
  marquee: '"Bungee", "Impact", sans-serif',
  label: '"Barlow Condensed", "Arial Narrow", sans-serif',
  typewriter: '"Special Elite", "Courier New", monospace',
  hand: '"Kalam", "Comic Sans MS", cursive',
  display: '"Playfair Display", "Times New Roman", serif',
} as const;

/** Picture lands a hair before the sound; the eye reads that as exactly on it. */
export const SYNC_LEAD = 0.03;

/**
 * Poses shared across cuts. The end of one scene and the start of the next read the same shot and
 * the same prop positions, so the eye never has to find the subject again.
 */
export const handoff = {
  /**
   * Where the four marquee words hang: one sign in two rows, all at one size, left edges aligned.
   * Row one hangs from the first batten, row two from the second, so the chains read as a real
   * double-hung sign. The block spans x 446–1474, y 246–512: clear of the lanterns at the batten
   * ends and above everything that stands on the floor.
   */
  marquee: {
    STAGE: { x: 673, y: 300, scale: 1, batten: 0 },
    SCENE: { x: 1247, y: 300, scale: 1, batten: 0 },
    CUE: { x: 673, y: 458, scale: 1, batten: 1 },
    TRACK: { x: 1151, y: 458, scale: 1, batten: 1 },
  },
  /** The slot one word hangs in when it is the word of the scene (CUE in 05, TRACK in 06–07). */
  word: { x: 960, y: 300 },
  /** The title is a flown marquee sign that takes the four words' place once they have gone back up. */
  title: { x: 960, y: 316 },
  /** The prompt corner: the stage manager's desk, downstage in the wing, half behind the leg. */
  desk: { sx: -0.75, sz: 0.14 },
  /** Spike marks the crate travels between in 04, and rests on from 05 to 07; same depth, so the move is a slide. */
  spikeA: { sx: -0.42, sz: 0.42 },
  spikeB: { sx: 0.38, sz: 0.42 },
  /** The ghost light's home: stage right, just outside the chalk frame, where it also stays when the curtain closes. */
  ghost: { sx: 0.78, sz: 0.26 },
  /**
   * The stage manager's mark: behind the desk's stage-left end (x ≈ 490, feet y 799), so the desk top
   * hides his legs and his front hand hangs over the cue light. 04 ends and 05 begins with him on it.
   */
  sm: { sx: -0.618, sz: 0.24 },
  /** Shots two adjacent scenes agree on. */
  shots: {
    house: { x: 960, y: 560, zoom: 1, roll: 0 } as Shot,
    /** y is as low as zoom 1.4 allows: 690 + 540 / 1.4 stays inside the 1080 world, so no black shows under the apron. */
    crateB: { x: 1180, y: 690, zoom: 1.4, roll: 0 } as Shot,
  },
} as const;
