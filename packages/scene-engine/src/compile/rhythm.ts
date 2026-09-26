/** Rhythm constants, shared by playback and TTS stitching; kept separate from compileFilm to keep the runtime bundle small. */
export const RHYTHM = {
  MS_PER_CHAR: 150,
  SAY_TAIL: 650,
  SHOT_TRANS: 950,
  SHOT_GAP: 350,
  LEAD_IN: 400,
} as const;

export type Rhythm = typeof RHYTHM;
