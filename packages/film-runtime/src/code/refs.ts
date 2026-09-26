import * as React from 'react';
import type { FilmRefPlaced, SpokenSource } from '@animspark/core/film';

/** Internal placement table used by the film document resolver. */
export interface FilmRefTable {
  placed: ReadonlyMap<string, FilmRefPlaced>;
  wordsOf: (id: string) => SpokenSource | undefined;
  lenient: boolean;
}

/** Clip identity for choreography diagnostics; animation timing is numeric. */
export const FilmClipIdContext = React.createContext<string | null>(null);
