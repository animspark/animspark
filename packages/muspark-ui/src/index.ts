/**
 * `@muspark/ui` — score visualization.
 *
 * The sound half lives in `@muspark/core` (music-theory conversions, pattern generation, two
 * synthesis backends); the two **share one score data model**. That is exactly why they live
 * under the same scope: a score used to be written twice (once to be heard, once to be seen),
 * the two copies sooner or later diverged, and when they did nothing reported an error — what
 * you heard and what you saw were two different pieces.
 *
 * Zero dependencies on AnimSpark: types are declared locally (see types.ts) and the React
 * wrappers are built in (see react.tsx).
 */
import type { ScenePackage } from './types';
import { MUSIC_SCORE_DEF } from './score';
import { PIANO_ROLL_DEF } from './piano-roll';

export { MUSIC_SCORE_DEF } from './score';
export { PIANO_ROLL_DEF } from './piano-roll';
export {
  Score,
  PianoRoll,
} from './author';

export const musparkUiPackage: ScenePackage = {
  name: '@muspark/ui',
  doc: 'Score visualization: staff notation and piano rolls. '
    + 'Shares one score data model with @muspark/core — one score, both heard and seen.',
  components: [
    MUSIC_SCORE_DEF,
    PIANO_ROLL_DEF,
  ],
};

export default musparkUiPackage;
