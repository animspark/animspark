import type { Note, Score } from '@muspark/core';
import { CUTS, TOTAL } from '../data/cuts';

/**
 * The film's music, written as data and placed on the film's audio track, so it runs across cuts.
 * It is scored against the scene starts in data/cuts.ts (picture lock) and must be re-read when
 * the edit changes. 07 imports the same notes to light bulbs on them: the picture reads the score.
 *
 * One small band in the pit: pizzicato bass, celesta, vibraphone, a warm pad and brushes. 92 BPM,
 * C major, so the four-note "on cue" motif (C · E · G · C) can land on the cuts and resolve at the end.
 */
export const BPM = 92;
/** Beats after the last cut. Generous while scenes are still being laid out; trimmed at picture lock. */
const TAIL_BEATS = 2;
export const beat = (seconds: number): number => (seconds * BPM) / 60;
const start = (id: keyof typeof CUTS | '07-track' | '08-curtain', offset = 0): number =>
  beat(((CUTS as Record<string, number>)[id] ?? TOTAL) + offset);

const VOICINGS: Record<string, { bass: [string, string]; keys: string[]; pad: string[] }> = {
  C: { bass: ['C2', 'G2'], keys: ['C5', 'E5', 'G5', 'E5'], pad: ['C4', 'E4', 'G4'] },
  Am: { bass: ['A1', 'E2'], keys: ['A4', 'C5', 'E5', 'C5'], pad: ['A3', 'C4', 'E4'] },
  F: { bass: ['F1', 'C2'], keys: ['F4', 'A4', 'C5', 'A4'], pad: ['F3', 'A3', 'C4'] },
  G: { bass: ['G1', 'D2'], keys: ['G4', 'B4', 'D5', 'B4'], pad: ['G3', 'B3', 'D4'] },
  Em: { bass: ['E2', 'B2'], keys: ['E5', 'G5', 'B5', 'G5'], pad: ['E4', 'G4', 'B4'] },
};

const bass: Note[] = [], keys: Note[] = [], vibes: Note[] = [], pad: Note[] = [];
const brush: { drum: 'shaker'; beat: number; velocity: number }[] = [];

/** Lay a progression from `from` for `bars` bars, two bars per chord. */
function section(from: number, bars: number, progression: string[], opts: { keys?: boolean; brush?: boolean; padGain?: number; walk?: boolean }) {
  for (let bar = 0; bar < bars; bar++) {
    const at = from + bar * 4;
    const chord = VOICINGS[progression[Math.floor(bar / 2) % progression.length]!]!;
    if (opts.walk !== false) {
      bass.push({ pitch: chord.bass[0], beat: at, duration: 1.6, velocity: 0.68 }, { pitch: chord.bass[1], beat: at + 2, duration: 1.4, velocity: 0.52 });
    }
    if (bar % 2 === 0) pad.push(...chord.pad.map((pitch) => ({ pitch, beat: at, duration: 7.6, velocity: opts.padGain ?? 0.38 })));
    if (opts.keys) chord.keys.forEach((pitch, i) => keys.push({ pitch, beat: at + i, duration: 0.9, velocity: i === 0 ? 0.48 : 0.34 }));
    if (opts.brush) for (let b = 0; b < 4; b++) brush.push({ drum: 'shaker', beat: at + b + 0.5, velocity: 0.2 });
  }
}

/** The motif: four notes, on the beat, whenever the film changes gear. */
function motif(at: number, velocity = 0.7, instrument: Note[] = vibes) {
  ['C5', 'E5', 'G5', 'C6'].forEach((pitch, i) => instrument.push({ pitch, beat: at + i * 0.5, duration: 0.9, velocity: velocity - i * 0.06 }));
}

// 01 · the house: nothing until the work lights find the room (1.2 s of voice offset + "theatre").
const theatre = start('01-stage', 1.2 + 7.98);
pad.push(...VOICINGS.C!.pad.map((pitch) => ({ pitch, beat: theatre, duration: 12, velocity: 0.3 })));
bass.push({ pitch: 'C2', beat: theatre, duration: 3, velocity: 0.5 }, { pitch: 'C2', beat: theatre + 8, duration: 3, velocity: 0.42 });
motif(start('01-stage', 1.2 + 13.2 + 0.5), 0.55, keys); // the title is chalked

// 02–04 · the work: a quiet walk under the narration, brushes join for the set and the blocking.
const scriptAt = start('02-script'), setAt = start('03-set'), blockingAt = start('04-blocking'), cueAt = start('05-cue');
section(scriptAt, Math.floor((setAt - scriptAt) / 4), ['C', 'Am', 'F', 'G'], { keys: true });
section(setAt, Math.floor((blockingAt - setAt) / 4), ['F', 'C', 'G', 'Am'], { keys: true, brush: true });
section(blockingAt, Math.floor((cueAt - 4 - blockingAt) / 4), ['C', 'F', 'G', 'C'], { keys: false, brush: true });
motif(start('04-blocking', 0.5 + 8.51), 0.6); // "the curve"

// 05 · the cue: the band holds its breath; one chord on GO; another on "same syllable".
const go = start('05-cue', 0.6 + 6.19), same = start('05-cue', 0.6 + 12.14);
pad.push(...VOICINGS.G!.pad.map((pitch) => ({ pitch, beat: cueAt, duration: go - cueAt - 0.5, velocity: 0.26 })));
vibes.push(...['C4', 'E4', 'G4', 'C5'].map((pitch) => ({ pitch, beat: go, duration: 3, velocity: 0.9 })));
bass.push({ pitch: 'C2', beat: go, duration: 3, velocity: 0.8 });
pad.push(...VOICINGS.C!.pad.map((pitch) => ({ pitch, beat: go + 0.5, duration: same - go - 1, velocity: 0.3 })));
vibes.push(...['E4', 'G4', 'C5'].map((pitch) => ({ pitch, beat: same, duration: 2.5, velocity: 0.75 })));

// 06 · the change: minor, and moving.
const changeAt = start('06-change'), trackAt = start('07-track');
section(changeAt, Math.max(1, Math.floor((trackAt - changeAt) / 4)), ['Am', 'Em', 'Am', 'F'], { keys: false, brush: true, padGain: 0.42 });
['E5', 'D5', 'C5', 'B4', 'A4'].forEach((pitch, i) => keys.push({ pitch, beat: start('06-change', 0.5 + 2.92) + i * 0.5, duration: 0.8, velocity: 0.5 }));

// 07 · the track: bass keeps time under the rail; then the melody the picture reads, note by note.
const curtainAt = start('08-curtain');
section(trackAt, Math.max(1, Math.floor((curtainAt - trackAt) / 4)), ['F', 'G', 'C', 'C'], { keys: false, brush: true, padGain: 0.3 });
/** The notes 07 lights bulbs on. Beats are film beats; 07 reads them through a score window. */
export const READ: Note[] = ['C5', 'E5', 'G5', 'B5', 'A5', 'G5', 'E5', 'C6'].map((pitch, i) => ({
  pitch, beat: start('07-track', 0.6 + 8.72) + i * 0.5, duration: 0.45, velocity: i === 7 ? 0.9 : 0.62,
}));
keys.push(...READ);

// 08 · house lights: the whole band, and the motif resolves on the last word.
const bars08 = Math.max(2, Math.floor((beat(TOTAL) - curtainAt) / 4));
section(curtainAt, bars08, ['F', 'G', 'C', 'C'], { keys: true, brush: true, padGain: 0.42 });
const last = start('08-curtain', 0.6 + 10.18);
motif(last - 2, 0.8);
vibes.push(...['C4', 'E4', 'G4', 'C5'].map((pitch) => ({ pitch, beat: last, duration: 6, velocity: 0.85 })));
bass.push({ pitch: 'C2', beat: last, duration: 6, velocity: 0.8 });

const score: Score = {
  bpm: BPM,
  durationBeats: Math.ceil(beat(TOTAL)) + TAIL_BEATS,
  tailSec: 2.5,
  channels: [
    { id: 'bass', instrument: 'pizzicato', bank: 'sampled', notes: bass, gainDb: 2 },
    { id: 'celesta', instrument: 'celesta', bank: 'sampled', notes: keys, gainDb: -6 },
    { id: 'vibes', instrument: 'vibraphone', bank: 'sampled', notes: vibes, gainDb: -4 },
    { id: 'pad', instrument: 'warm-pad', bank: 'sampled', notes: pad, gainDb: -11 },
    { id: 'brush', bank: 'sampled', hits: brush, gainDb: -12 },
  ],
};
export default score;
