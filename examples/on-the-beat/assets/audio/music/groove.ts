/**
 * The film's music: 16 beats at 120 bpm (8 s), written as data. The film.json audio track
 * renders it to a WAV; the scene imports the same events to put motion on them.
 * Only built-in synth voices and drums — nothing to download.
 */
import { bassLine, layChords, line, type DrumHit, type Score } from '@muspark/core';

export const BPM = 120;
export const BEATS = 16;

/** One chord per bar. */
export const harmony = layChords(['C', 'Am', 'F', 'G'], { beatsEach: 4 });

/** Four on the floor all the way through. */
export const kicks: DrumHit[] = Array.from({ length: BEATS }, (_, beat) => ({ drum: 'kick', beat, velocity: beat % 4 === 0 ? 1 : 0.8 }));
/** Backbeat from bar 2. */
export const snares: DrumHit[] = [5, 7, 9, 11, 13, 15].map((beat) => ({ drum: 'snare', beat, velocity: 0.7 }));
/** Off-beat hats from bar 2. */
export const hats: DrumHit[] = Array.from({ length: 12 }, (_, i) => ({ drum: 'closed-hat', beat: 4.5 + i, velocity: 0.45 }));

/** The hook: one note per beat over bars 2–4. */
export const lead = line(
  ['E5', 'G5', 'A5', 'G5', 'C6', 'A5', 'G5', 'E5', 'D5', 'E5', 'G5', 'B5'],
  { start: 4, step: 1, duration: 0.7, velocity: 0.8 },
);

const score: Score = {
  bpm: BPM,
  durationBeats: BEATS,
  tailSec: 0.8,
  channels: [
    { id: 'pad', instrument: 'synth-pad', chords: harmony.map((c) => ({ ...c, octave: 4 })), gainDb: -17 },
    { id: 'bass', instrument: 'synth-bass', notes: bassLine(harmony, { octave: 2, style: 'root-fifth', step: 1 }), gainDb: -9 },
    { id: 'lead', instrument: 'pluck', notes: lead, gainDb: -8, effects: { delay: { timeBeats: 0.75, feedback: 0.25, mix: 0.18 }, reverb: 0.15 } },
    { id: 'drums', hits: [...kicks, ...snares, ...hats], gainDb: -7 },
  ],
};
export default score;
