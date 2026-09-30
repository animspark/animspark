// Lyric lookups by word index (see mg/lyrics.ts for the table). Scenes use these, never raw times.
import { WORDS, LINES } from '../lyrics';
export { WORDS, LINES };
export const wStart = (i: number) => WORDS[i]![1];
export const wEnd = (i: number) => WORDS[i]![2];
export const wText = (i: number) => WORDS[i]![0];
/** 0..1 sung progress of word i at t */
export const wProg = (i: number, t: number) => Math.max(0, Math.min(1, (t - wStart(i)) / Math.max(0.05, wEnd(i) - wStart(i))));
/** per-character start times across word i (even split of the sung span, capped at 0.5 s) */
export function charTimes(i: number): number[] {
  const s = wText(i), a = wStart(i), d = Math.min(0.5, Math.max(0.12, wEnd(i) - a));
  return [...s].map((_, k) => a + (k / s.length) * d);
}
