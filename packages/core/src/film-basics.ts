/**
 * The few conventions every film follows.
 *
 * A film's root is `film.json` (the arrangement: placement is data, visuals are code; see
 * film-doc.ts). This file holds what is shared across processes: where assets live, how the stage
 * size is written, and at which second a word falls.
 */

import { z } from 'zod';

/** All assets live here. */
export const ASSETS_DIR = 'assets';

/**
 * Stage size.
 *
 * The one thing that cannot be inferred from the visuals: a render tells you how many blocks there
 * are, how long they run and what sounds when, but not whether the film is 16:9 or vertical.
 */
export const filmStageSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type FilmStage = z.infer<typeof filmStageSchema>;

/**
 * The second at which a word falls within its own asset (not within the whole film).
 *
 * Measured during TTS synthesis or reported by ASR; both sources produce the same shape. This table
 * is the foundation of all timing: in "the cat is scared off by a bang", the millisecond of the bang
 * is computed from here and baked into the MG code.
 */
export const filmWordSchema = z.object({
  token: z.string(),
  startSec: z.number().min(0),
  /**
   * When the word finishes.
   *
   * Clean cuts depend on it. With only start times, cutting after a sentence has to use the next
   * word's start as the out point, which drags in the pause between sentences along with the next
   * onset; tighten it a little and you clip this sentence's tail instead. Both problems are two sides
   * of the same missing data. With end times the silence is known (endSec → next word's startSec), and
   * cutting inside it is clean on both sides.
   *
   * Both TTS and ASR provide it. Only the local `say` interpolation fallback lacks it.
   */
  endSec: z.number().min(0).optional(),
});
export type FilmWord = z.infer<typeof filmWordSchema>;

/** Where the word starts. */
export function wordStartSec(word: { startSec?: number }): number {
  const n = word.startSec;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}
