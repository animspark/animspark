/**
 * Scene starts in film seconds, as laid out in film.json at picture lock: each scene's `durationSec` as
 * `anim check` measured it (assets/index.jsonl, kind mg), end to end. Generated; if a scene's length changes,
 * lay the clips out again and rewrite this file from film.json rather than editing it by hand.
 */
export const CUTS = {
  '01-stage': 0.0,
  '02-script': 18.94,
  '03-set': 30.271,
  '04-blocking': 44.542,
  '05-cue': 58.002,
  '06-change': 74.242,
  '07-track': 83.262,
  '08-curtain': 97.322,
} as const;
export const TOTAL = 115.182;
