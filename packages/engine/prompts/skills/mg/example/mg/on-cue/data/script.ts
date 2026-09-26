/**
 * The film's own prompt book. One user sentence, eight beats; every beat answers the three
 * questions the narration names in 02: what changes, what you understand from it, what comes next.
 * 02 writes this list into the book; 08 reads it back as the cue sheet.
 */
export const BRIEF = 'A short science explainer about how AnimSpark makes a film.';

export interface Beat {
  n: number;
  id: string;
  title: string;
  /** The theatre word this beat borrows, if it puts one on the marquee. */
  word?: 'STAGE' | 'SCENE' | 'CUE' | 'TRACK';
  see: string;
  understand: string;
  next: string;
}

export const BEATS: readonly Beat[] = [
  { n: 1, id: '01-stage', title: 'Stage', word: 'STAGE', see: 'four words light up in an empty house', understand: 'the words came from here; the frame is fixed', next: 'walk to the prompt corner' },
  { n: 2, id: '02-script', title: 'Script', see: 'one sentence splits into beats', understand: 'every beat must change the picture', next: 'look up at the battens' },
  { n: 3, id: '03-set', title: 'Set', word: 'SCENE', see: 'flats fly in; the same pieces rearrange', understand: 'design once, reuse everywhere', next: 'bring the crate to spike A' },
  { n: 4, id: '04-blocking', title: 'Blocking', see: 'the crate breathes, moves, settles', understand: 'the curve is the character', next: 'hold the crate in its spot' },
  { n: 5, id: '05-cue', title: 'Cue', word: 'CUE', see: 'GO: light, sound and motion at once', understand: 'the word is the cue', next: 'keep the spot on' },
  { n: 6, id: '06-change', title: 'Change', see: 'the set changes; the crate stays', understand: 'one thing still, the eye never searches', next: 'go down to the pit' },
  { n: 7, id: '07-track', title: 'Track', word: 'TRACK', see: 'a scene slides; its sound slides too', understand: 'sound belongs to the scene; music is data', next: 'house lights' },
  { n: 8, id: '08-curtain', title: 'Curtain', see: 'everything bows; the cue sheet unrolls', understand: 'this film was called from its own sheet', next: 'ghost light on' },
];

export const WORDS = ['STAGE', 'SCENE', 'CUE', 'TRACK'] as const;
export type Word = (typeof WORDS)[number];

/** What each borrowed word meant in the theatre, and what it does in AnimSpark. */
export const MEANINGS: Record<Word, { theatre: string; animspark: string }> = {
  STAGE: { theatre: 'the fixed frame the audience looks into', animspark: 'stage: { w: 1920, h: 1080 }' },
  SCENE: { theatre: 'a complete unit of the play: set, action and sound', animspark: 'one scene file: picture, motion, sounds' },
  CUE: { theatre: 'the exact word a change is called on', animspark: "cue(voice, 'go').start" },
  TRACK: { theatre: 'the rail a piece of scenery travels on', animspark: 'tracks: [{ kind: "mg", clips }]' },
};
