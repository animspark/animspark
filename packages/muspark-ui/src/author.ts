/**
 * This is what `import { Score } from '@muspark/ui/react'` gives you: two real React components,
 * built on the spot from their declarations by this package's own `notationComponent` (see react.tsx).
 *
 * It is a separate entry point because only this branch needs React. Server-side score computation
 * and `anim doc` rendering go through the root entry, and not a single line of React should be bundled there.
 */
import { notationComponent } from './react';

import { PIANO_ROLL_DEF } from './piano-roll';
import { MUSIC_SCORE_DEF } from './score';

export const Score = notationComponent(MUSIC_SCORE_DEF);
export const PianoRoll = notationComponent(PIANO_ROLL_DEF);

export type { NotationComponent, NotationProps } from './react';
