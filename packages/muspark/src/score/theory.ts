/**
 * Music theory helpers: note-name conversion, chord voicing, scale degrees.
 *
 * Implemented in-house rather than pulling in a theory library: muspark ships with every render,
 * and the theory it needs is small and well-defined, so doing it ourselves keeps it
 * dependency-free and testable.
 */
import type { Pitch } from './types';

const LETTER_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function accidentalOffset(text: string): number {
  let offset = 0;
  for (const ch of text) {
    if (ch === '#' || ch === '♯') offset += 1;
    else if (ch === 'b' || ch === '♭') offset -= 1;
  }
  return offset;
}

/** Pitch class (0–11) of a note name without an octave. Returns null if it cannot be parsed. */
export function pitchClassOf(name: string): number | null {
  const match = /^([A-Ga-g])([#b♯♭]*)$/.exec(name.trim());
  if (!match) return null;
  const base = LETTER_SEMITONES[match[1]!.toUpperCase()];
  if (base === undefined) return null;
  return (((base + accidentalOffset(match[2]!)) % 12) + 12) % 12;
}

/**
 * Note name or MIDI number → MIDI number.
 * Uses scientific pitch notation: C4 = 60, A4 = 69 (440Hz).
 */
export function midiOf(pitch: Pitch): number {
  if (typeof pitch === 'number') {
    if (!Number.isFinite(pitch)) throw new Error(`Invalid MIDI pitch: ${pitch}`);
    return pitch;
  }
  const text = String(pitch).trim();
  const match = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(text);
  if (!match) {
    const asNumber = Number(text);
    if (Number.isFinite(asNumber)) return asNumber;
    throw new Error(`Cannot parse pitch: ${pitch}`);
  }
  const base = LETTER_SEMITONES[match[1]!.toUpperCase()]!;
  const octave = Number(match[3]);
  return (octave + 1) * 12 + base + accidentalOffset(match[2]!);
}

/** MIDI number → note name; preferFlats picks flats or sharps for black keys. */
export function nameOf(midi: number, preferFlats = false): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[((rounded % 12) + 12) % 12]}${octave}`;
}

/** MIDI number → frequency (Hz), A4 = 440. */
export function hzOf(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Shift a pitch by some octaves and return the MIDI number. */
export function transposeOctave(pitch: Pitch, delta: number): number {
  return midiOf(pitch) + delta * 12;
}

/**
 * Chord quality → set of semitone intervals.
 *
 * Order matters: suffixes are matched longest first, otherwise 'maj7' would be swallowed by '7'
 * and 'm7b5' by 'm7'.
 */
const CHORD_QUALITIES: Array<[string, number[]]> = [
  ['maj13', [0, 4, 7, 11, 14, 21]],
  ['maj11', [0, 4, 7, 11, 14, 17]],
  ['m7b5', [0, 3, 6, 10]],
  ['m7#5', [0, 3, 8, 10]],
  ['mmaj7', [0, 3, 7, 11]],
  ['maj9', [0, 4, 7, 11, 14]],
  ['maj7', [0, 4, 7, 11]],
  ['dim7', [0, 3, 6, 9]],
  ['add11', [0, 4, 7, 17]],
  ['sus4', [0, 5, 7]],
  ['sus2', [0, 2, 7]],
  ['add9', [0, 4, 7, 14]],
  ['aug7', [0, 4, 8, 10]],
  ['7sus4', [0, 5, 7, 10]],
  ['7b13', [0, 4, 7, 10, 20]],
  ['7#11', [0, 4, 7, 10, 18]],
  ['7b9', [0, 4, 7, 10, 13]],
  ['7#9', [0, 4, 7, 10, 15]],
  ['7b5', [0, 4, 6, 10]],
  ['7#5', [0, 4, 8, 10]],
  ['m13', [0, 3, 7, 10, 14, 21]],
  ['m11', [0, 3, 7, 10, 14, 17]],
  ['m9', [0, 3, 7, 10, 14]],
  ['m6', [0, 3, 7, 9]],
  ['m7', [0, 3, 7, 10]],
  ['13', [0, 4, 7, 10, 14, 21]],
  ['11', [0, 4, 7, 10, 14, 17]],
  ['dim', [0, 3, 6]],
  ['aug', [0, 4, 8]],
  ['sus', [0, 5, 7]],
  ['maj', [0, 4, 7]],
  ['min', [0, 3, 7]],
  ['9', [0, 4, 7, 10, 14]],
  ['7', [0, 4, 7, 10]],
  ['6', [0, 4, 7, 9]],
  ['5', [0, 7]],
  ['m', [0, 3, 7]],
  ['-', [0, 3, 7]],
  ['+', [0, 4, 8]],
  ['°', [0, 3, 6]],
  ['ø', [0, 3, 6, 10]],
  ['', [0, 4, 7]],
];

export interface ParsedChord {
  /** Root pitch class, 0–11. */
  rootClass: number;
  /** Root name (as originally written). */
  root: string;
  /** Set of semitone intervals. */
  intervals: number[];
  /** Pitch class of the slash bass, e.g. the G in 'C/G'. */
  bassClass?: number;
}

/** Parse a chord symbol; throws if it is not recognized. */
export function parseChord(symbol: string): ParsedChord {
  const text = String(symbol).trim().replaceAll('♯', '#').replaceAll('♭', 'b');
  if (!text) throw new Error('Chord symbol is empty');

  const parts = text.split('/');
  if (parts.length > 2) throw new Error(`Cannot parse chord: ${symbol}`);
  const [main, bassPart] = parts;
  const rootMatch = /^([A-Ga-g][#b]*)/.exec(main!);
  if (!rootMatch) throw new Error(`Cannot parse chord root: ${symbol}`);
  const root = rootMatch[1]!;
  const rootClass = pitchClassOf(root);
  if (rootClass === null) throw new Error(`Cannot parse chord root: ${symbol}`);

  const suffix = main!.slice(root.length).trim();
  // Normalize a few equivalent spellings to keep the quality table short
  const normalized = suffix
    .replace(/^Maj/, 'maj').replace(/^MAJ/, 'maj')
    .replace(/^M(?![a-z])/, 'maj')
    .replace(/^Min/i, 'min')
    .replace(/^dom/i, '')
    .replace(/^half-dim$/i, 'ø');

  const quality = CHORD_QUALITIES.find(([name]) => name === normalized);
  if (!quality) throw new Error(`Unrecognized chord quality: ${symbol} (suffix "${suffix}")`);

  const out: ParsedChord = { rootClass, root, intervals: quality[1] };
  if (parts.length === 2) {
    const bassClass = pitchClassOf(bassPart!);
    if (bassClass === null) throw new Error(`Cannot parse chord bass: ${symbol}`);
    out.bassClass = bassClass;
  }
  return out;
}

export interface VoicingOptions {
  /** Root octave, default 4. */
  octave?: number;
  /** Inversion: 1 moves the root to the top. */
  inversion?: number;
  /** Keep only the first n chord tones. */
  voices?: number;
}

/**
 * Chord symbol → MIDI pitches voiced from low to high.
 *
 * Voicing rule: stack chord tones upward in order, raising any tone that falls below the previous
 * one by an octave, so voices never cross and it sounds like a chord rather than a pile of notes.
 */
export function voiceChord(symbol: string, options: VoicingOptions = {}): number[] {
  for (const [key, min, max] of [['octave', -1, 9], ['inversion', -32, 32], ['voices', 1, 16]] as const) {
    const value = options[key];
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
      throw new Error(`${key} must be an integer between ${min} and ${max}`);
    }
  }
  const parsed = parseChord(symbol);
  const octave = options.octave ?? 4;
  const rootMidi = (octave + 1) * 12 + parsed.rootClass;

  const limited = options.voices ? parsed.intervals.slice(0, Math.max(1, options.voices)) : parsed.intervals;
  const inversion = ((options.inversion ?? 0) % limited.length + limited.length) % limited.length;
  const ordered = [...limited.slice(inversion), ...limited.slice(0, inversion)];

  let previous = -Infinity;
  const pitches = ordered.map((interval) => {
    let midi = rootMidi + interval;
    while (midi <= previous) midi += 12;
    previous = midi;
    return midi;
  });

  if (parsed.bassClass !== undefined) {
    // Put the slash bass below the chord, in the octave just under the lowest tone
    let bass = (octave + 1) * 12 + parsed.bassClass;
    while (bass >= pitches[0]!) bass -= 12;
    pitches.unshift(bass);
  }
  return pitches;
}

/** MIDI pitch of the chord root, for writing bass lines. */
export function chordRoot(symbol: string, octave = 2): number {
  return (octave + 1) * 12 + parseChord(symbol).rootClass;
}

const SCALE_STEPS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  wholetone: [0, 2, 4, 6, 8, 10],
};

/**
 * Whether a key is spelled with flats or sharps.
 *
 * Decided by the key signature, not just whether the tonic name has a b: F major has one flat, so
 * its fourth degree is Bb, not A#. The latter is the same pitch, but a reader would take it for a
 * different scale degree.
 */
function prefersFlats(tonicClass: number, mode: string, tonicName: string): boolean {
  if (/b/.test(tonicName)) return true;
  if (/#/.test(tonicName)) return false;
  const minorish = mode === 'minor' || mode === 'aeolian' || mode === 'dorian'
    || mode === 'phrygian' || mode === 'locrian' || mode === 'harmonic minor'
    || mode === 'melodic minor' || mode === 'minor pentatonic';
  // The flat side of the circle of fifths
  const flatMajors = new Set([5, 10, 3, 8, 1, 6]);
  const flatMinors = new Set([2, 7, 0, 5, 10, 3]);
  return minorish ? flatMinors.has(tonicClass) : flatMajors.has(tonicClass);
}

/** Parse key descriptions like 'C major' / 'F# dorian'. */
export function parseKey(key: string): { tonicClass: number; tonic: string; steps: number[]; mode: string } {
  const text = String(key).trim().replaceAll('♯', '#').replaceAll('♭', 'b');
  const match = /^([A-Ga-g][#b]*)\s*(.*)$/.exec(text);
  if (!match) throw new Error(`Cannot parse key: ${key}`);
  const tonic = match[1]!;
  const tonicClass = pitchClassOf(tonic);
  if (tonicClass === null) throw new Error(`Cannot parse key tonic: ${key}`);
  const mode = (match[2] || 'major').trim().toLowerCase();
  const steps = SCALE_STEPS[mode];
  if (!steps) throw new Error(`Unknown mode: ${mode}`);
  return { tonicClass, tonic, steps, mode };
}

/** Note names in the key (one octave). */
export function scaleNotes(key: string, octave = 4): string[] {
  const { tonicClass, tonic, steps, mode } = parseKey(key);
  const preferFlats = prefersFlats(tonicClass, mode, tonic);
  return steps.map((step) => nameOf((octave + 1) * 12 + tonicClass + step, preferFlats));
}

/** Diatonic triad qualities for major and minor. */
const TRIAD_QUALITY_BY_DEGREE: Record<string, string[]> = {
  major: ['', 'm', 'm', '', '', 'm', 'dim'],
  minor: ['m', 'dim', '', 'm', 'm', '', ''],
};

const ROMAN_TO_DEGREE: Record<string, number> = {
  i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6,
};

/**
 * Roman-numeral degree → chord symbol.
 *
 * Uppercase is a major triad, lowercase a minor triad; a leading accidental (bVII / #IV) and a
 * suffix (V7 / ii7 / IVmaj7) are allowed. The quality defaults to the diatonic chord of the key.
 */
export function progression(key: string, numerals: string[]): string[] {
  const { tonicClass, tonic, steps, mode } = parseKey(key);
  if (steps.length !== 7) throw new Error('progression requires a seven-note scale');
  const naturalMode = mode === 'minor' || mode === 'aeolian' ? 'minor' : 'major';
  const keyPrefersFlats = prefersFlats(tonicClass, mode, tonic);

  return numerals.map((raw) => {
    const text = String(raw).trim();
    const match = /^([b#]*)([ivIV]+)(.*)$/.exec(text);
    if (!match) throw new Error(`Cannot parse scale degree: ${raw}`);
    const chromatic = accidentalOffset(match[1]!);
    const roman = match[2]!;
    const suffix = match[3]!.trim();

    const degree = ROMAN_TO_DEGREE[roman.toLowerCase()];
    if (degree === undefined) throw new Error(`Cannot parse scale degree: ${raw}`);

    const rootClass = (((tonicClass + steps[degree]! + chromatic) % 12) + 12) % 12;
    // The numeral's own accidental decides the spelling: bVII is Bb, not A#
    const preferFlats = chromatic < 0 ? true : chromatic > 0 ? false : keyPrefersFlats;
    const rootName = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[rootClass]!;

    // The third comes from the numeral's case; chromatic degrees do not take the diatonic quality
    const isLower = roman === roman.toLowerCase();
    const baseQuality = chromatic !== 0
      ? (isLower ? 'm' : '')
      : (() => {
        const natural = TRIAD_QUALITY_BY_DEGREE[naturalMode]![degree]!;
        if (isLower && natural === '') return 'm';
        if (!isLower && natural === 'm') return '';
        return natural;
      })();

    if (!suffix) return `${rootName}${baseQuality}`;
    // If the suffix already implies the third, use it as written (Imaj7 / iiø / IVsus4)
    if (/^(m|min|maj|M|dim|aug|sus|ø|°|\+|-)/.test(suffix)) return `${rootName}${suffix}`;
    // Pure extensions (7 / 9 / 13...) merge with the degree's own third: ii7 is Dm7, not D7
    if (baseQuality === 'dim') {
      // A seventh on a diminished triad is half-diminished in the key, the most common intent of this notation
      return suffix === '7' ? `${rootName}m7b5` : `${rootName}dim${suffix}`;
    }
    return `${rootName}${baseQuality}${suffix}`;
  });
}

/** The seven diatonic triads of the key. */
export function diatonicChords(key: string): string[] {
  return progression(key, ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii']);
}

/** A few common progressions. */
export const PROGRESSIONS = {
  /** The Pachelbel canon progression. */
  canon: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'],
  /** The four-chord pop progression. */
  pop: ['I', 'V', 'vi', 'IV'],
  /** The minor four-chord loop (starting on vi). */
  sad: ['vi', 'IV', 'I', 'V'],
  /** Jazz ii-V-I. */
  jazz: ['ii7', 'V7', 'Imaj7'],
  /** Harmonic skeleton of a twelve-bar blues. */
  blues: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'],
  /** Andalusian cadence. */
  andalusian: ['i', 'VII', 'VI', 'V'],
  /** The 1950s progression. */
  fifties: ['I', 'vi', 'IV', 'V'],
  /** A minor loop common in EDM. */
  edm: ['vi', 'IV', 'I', 'V'],
} as const;

export type ProgressionName = keyof typeof PROGRESSIONS;

/** Take a named progression and realize it in a given key. */
export function namedProgression(key: string, name: ProgressionName): string[] {
  return progression(key, [...PROGRESSIONS[name]]);
}
