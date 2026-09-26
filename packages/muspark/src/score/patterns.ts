/**
 * Arrangement patterns: expand "chord progression + pattern" into notes.
 *
 * This is muspark's value over hand-written MIDI - the author declares "arpeggiate these 8 chords on harp"
 * instead of entering notes one by one. Changing key, pattern, or adding another pass is a single parameter change.
 */
import { chordRoot, midiOf, voiceChord } from './theory';
import type { DrumHit, Note } from './types';

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and > 0`);
  return value;
}
function countOf(length: number, step: number): number {
  positive(length, 'duration'); positive(step, 'step');
  const count = Math.ceil(length / step - 1e-10);
  if (count > 100_000) throw new Error('pattern exceeds 100000 events');
  return count;
}

export interface ChordSpan {
  symbol: string;
  /** Start beat. */
  beat: number;
  /** Length in beats. */
  duration: number;
}

/** Lay a chord sequence out on the timeline at a fixed length per chord. */
export function layChords(
  symbols: string[],
  options: { startBeat?: number; beatsEach: number },
): ChordSpan[] {
  const start = options.startBeat ?? 0;
  positive(options.beatsEach, 'beatsEach');
  return symbols.map((symbol, i) => ({
    symbol,
    beat: start + i * options.beatsEach,
    duration: options.beatsEach,
  }));
}

export interface ArpeggioOptions {
  /** Length of each note (in beats), which is also the pattern step. */
  step: number;
  /** The pattern as chord-tone indices, 0 being the lowest chord tone; indices past the end go up an octave automatically. */
  shape?: number[];
  octave?: number;
  voices?: number;
  velocity?: number;
  /** Accent multiplier for the first note of each group; defaults to 1.15. */
  accent?: number;
}

/**
 * Chord -> arpeggio notes. Accepts a single ChordSpan or an array.
 *
 * shape expresses the pattern as chord-tone indices: [0,1,2,1] is the classic "root-third-fifth-third" back and forth,
 * [0,1,2,3] ascends, [2,1,0,1] starts descending. Indices past the number of chord tones go up an octave automatically,
 * so [0,1,2,3,4] on a triad naturally reaches the root and third an octave up.
 */
export function arpeggio(spans: ChordSpan | ChordSpan[], options: ArpeggioOptions): Note[] {
  if (Array.isArray(spans)) return spans.flatMap((span) => arpeggioOne(span, options));
  return arpeggioOne(spans, options);
}

function arpeggioOne(span: ChordSpan, options: ArpeggioOptions): Note[] {
  const pitches = voiceChord(span.symbol, {
    octave: options.octave ?? 3,
    voices: options.voices,
  });
  const shape = options.shape ?? [0, 1, 2, 1];
  if (!shape.length || shape.some(index => !Number.isInteger(index) || index < 0)) throw new Error('shape requires nonnegative integer indices');
  const velocity = options.velocity ?? 0.6;
  const accent = options.accent ?? 1.15;
  const count = countOf(span.duration, options.step);
  const notes: Note[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = shape[i % shape.length]!;
    const octaveUp = Math.floor(index / pitches.length);
    const pitch = pitches[index % pitches.length]! + octaveUp * 12;
    notes.push({
      pitch,
      beat: span.beat + i * options.step,
      duration: Math.min(options.step, span.duration - i * options.step),
      velocity: Math.min(1, velocity * (i % shape.length === 0 ? accent : 1)),
    });
  }
  return notes;
}

export interface BlockChordOptions {
  octave?: number;
  inversion?: number;
  voices?: number;
  velocity?: number;
  /** Staccato ratio: 0.9 means the chord fills only 90% of its duration, leaving room to breathe. */
  sustain?: number;
}

/** Chord -> block chord (a group of notes sounding together). Accepts a single ChordSpan or an array. */
export function blockChord(spans: ChordSpan | ChordSpan[], options: BlockChordOptions = {}): Note[] {
  if (Array.isArray(spans)) return spans.flatMap((span) => blockChordOne(span, options));
  return blockChordOne(spans, options);
}

function blockChordOne(span: ChordSpan, options: BlockChordOptions): Note[] {
  const pitches = voiceChord(span.symbol, {
    octave: options.octave ?? 3,
    inversion: options.inversion,
    voices: options.voices,
  });
  const duration = span.duration * (options.sustain ?? 0.95);
  return pitches.map((pitch) => ({
    pitch,
    beat: span.beat,
    duration,
    velocity: options.velocity ?? 0.5,
  }));
}

export type BassStyle = 'root' | 'root-fifth' | 'walking' | 'octave';

export interface BassOptions {
  octave?: number;
  velocity?: number;
  style?: BassStyle;
  /** Subdivision step for walking / root-fifth; defaults to two notes per chord. */
  step?: number;
}

/** Chord sequence -> bass line. */
export function bassLine(spans: ChordSpan[], options: BassOptions = {}): Note[] {
  const octave = options.octave ?? 2;
  const velocity = options.velocity ?? 0.7;
  const style = options.style ?? 'root';
  const notes: Note[] = [];

  for (const span of spans) {
    const root = chordRoot(span.symbol, octave);
    if (style === 'root') {
      notes.push({ pitch: root, beat: span.beat, duration: span.duration, velocity });
      continue;
    }
    const step = options.step ?? span.duration / 2;
    const count = countOf(span.duration, step);
    const tones = voiceChord(span.symbol, { octave });
    for (let i = 0; i < count; i += 1) {
      let pitch = root;
      if (style === 'root-fifth') pitch = i % 2 === 0 ? root : (tones[2] ?? root);
      if (style === 'octave') pitch = i % 2 === 0 ? root : root + 12;
      if (style === 'walking') pitch = tones[i % tones.length]!;
      notes.push({
        pitch,
        beat: span.beat + i * step,
        duration: Math.min(step, span.duration - i * step),
        velocity: velocity * (i === 0 ? 1 : 0.85),
      });
    }
  }
  return notes;
}

/** A one-bar drum template: keys are drum pieces, values are beat offsets within the bar. */
export type DrumTemplate = Partial<Record<DrumHit['drum'], number[]>>;

export const DRUM_TEMPLATES: Record<string, DrumTemplate> = {
  /** Basic 4/4 rock: kick on 1 and 3, snare on 2 and 4, closed hi-hat in eighths. */
  rock: {
    kick: [0, 2],
    snare: [1, 3],
    'closed-hat': [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  },
  /** Ballad: kick on the pulse, snare only on the backbeat, a sparse hi-hat to leave space. */
  ballad: {
    kick: [0, 2.5],
    snare: [2],
    'closed-hat': [0, 1, 2, 3],
  },
  /** Swing: ride plays a triplet feel, snare lands on 2 and 4. */
  swing: {
    ride: [0, 0.66, 1, 1.66, 2, 2.66, 3, 3.66],
    snare: [1, 3],
    kick: [0],
  },
  /** Light percussion of shaker plus a single ride hit, suited to children's songs and music boxes. */
  gentle: {
    shaker: [0, 1, 2, 3],
    ride: [0],
  },
};

export interface DrumPatternOptions {
  /** Beat to start from. */
  startBeat?: number;
  /** Number of bars to repeat. */
  bars: number;
  /** Beats per bar; defaults to 4. */
  beatsPerBar?: number;
  velocity?: number;
  /** Accent multiplier for the first beat of each bar. */
  accent?: number;
}

/** Drum template -> percussion events. */
export function drumPattern(
  template: DrumTemplate | keyof typeof DRUM_TEMPLATES,
  options: DrumPatternOptions,
): DrumHit[] {
  const resolved = typeof template === 'string' ? DRUM_TEMPLATES[template]! : template;
  if (!resolved) throw new Error(`unknown drum template: ${String(template)}`);
  const beatsPerBar = options.beatsPerBar ?? 4;
  positive(beatsPerBar, 'beatsPerBar');
  if (!Number.isInteger(options.bars) || options.bars < 0 || options.bars > 10_000) throw new Error('bars must be an integer between 0 and 10000');
  const start = options.startBeat ?? 0;
  const velocity = options.velocity ?? 0.75;
  const accent = options.accent ?? 1.2;
  const hits: DrumHit[] = [];
  for (let bar = 0; bar < options.bars; bar += 1) {
    const barStart = start + bar * beatsPerBar;
    for (const [drum, offsets] of Object.entries(resolved)) {
      for (const offset of offsets ?? []) {
        if (!Number.isFinite(offset) || offset < 0 || offset >= beatsPerBar) throw new Error('drum offset must fit inside beatsPerBar');
        hits.push({
          drum: drum as DrumHit['drum'],
          beat: barStart + offset,
          velocity: Math.min(1, velocity * (offset === 0 ? accent : 1)),
        });
      }
    }
  }
  return hits;
}

/** A line of equal-length notes; null means a rest. */
export function line(
  pitches: Array<string | number | null>,
  options: { start?: number; step: number; duration?: number; velocity?: number },
): Note[] {
  const start = options.start ?? 0;
  positive(options.step, 'step');
  const duration = options.duration ?? options.step;
  positive(duration, 'duration');
  const notes: Note[] = [];
  pitches.forEach((pitch, i) => {
    if (pitch === null) return;
    notes.push({
      pitch,
      beat: start + i * options.step,
      duration,
      velocity: options.velocity ?? 0.75,
    });
  });
  return notes;
}

/**
 * A sequence of notes with varying lengths; each element is [pitch, duration], and a null pitch means a rest.
 * Each note follows directly after the previous one; use it for melodies in free rhythm.
 */
export function seq(
  events: Array<[string | number | null, number]>,
  options: { start?: number; velocity?: number; legato?: number } = {},
): Note[] {
  let beat = options.start ?? 0;
  const legato = options.legato ?? 0.96;
  positive(legato, 'legato');
  const notes: Note[] = [];
  for (const [pitch, duration] of events) {
    positive(duration, 'duration');
    if (pitch !== null) {
      notes.push({
        pitch,
        beat,
        duration: duration * legato,
        velocity: options.velocity ?? 0.75,
      });
    }
    beat += duration;
  }
  return notes;
}

/** Chord tones sounding together, given directly as a pitch array; use it for fixed voicings. */
export function stack(
  pitches: Array<string | number>,
  options: { beat: number; duration: number; velocity?: number },
): Note[] {
  return pitches.map((pitch) => ({
    pitch,
    beat: options.beat,
    duration: options.duration,
    velocity: options.velocity ?? 0.6,
  }));
}

/** Shift a run of notes by some number of beats, for duplicating a section. */
export function shift(notes: Note[], deltaBeats: number): Note[] {
  return notes.map((note) => ({ ...note, beat: note.beat + deltaBeats }));
}

/** Transpose a run of notes by some number of semitones. */
export function transpose(notes: Note[], semitones: number): Note[] {
  if (!Number.isFinite(semitones) || !Number.isInteger(semitones)) throw new Error('semitones must be a finite integer');
  return notes.map((note) => ({
    ...note,
    pitch: midiOf(note.pitch) + semitones,
  }));
}

/** Repeat a run of notes several times, shifting by one period each time. */
export function repeat(notes: Note[], times: number, periodBeats: number): Note[] {
  if (!Number.isInteger(times) || times < 0 || notes.length * times > 100_000) throw new Error('repeat requires a nonnegative integer count and at most 100000 events');
  positive(periodBeats, 'periodBeats');
  const out: Note[] = [];
  for (let i = 0; i < times; i += 1) out.push(...shift(notes, i * periodBeats));
  return out;
}
