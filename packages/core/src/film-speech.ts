/**
 * The speech layer answers just two questions: **at which second was that phrase said**, and
 * **which stretches of this asset contain speech**.
 *
 * Both are computed from `words` on demand, never stored. The disk used to hold a pre-split
 * `lines` as well, a second copy of the same information: re-transcribe or swap the asset and
 * `words` changes while `lines` stays stale, so cuts line up with the previous version's sentences.
 * Derived data that gets stored drifts from its source, and this drift is invisible on screen.
 *
 * **There are two kinds of splitting; don't mix them.** Subtitles split at punctuation (the unit of
 * reading; see `spokenLines` in the runtime); editing splits at silence (where you can cut). A single
 * stored `lines` serving both always shortchanges one of them. This module handles only the latter.
 */

import { wordStartSec, type FilmWord } from './film-basics';

/** The span a phrase occupies on its asset's own timeline (seconds). */
export interface SpokenRange {
  start: number;
  end: number;
  /** How long the phrase took to say. Precomputed here: if every call site subtracts on its own, sooner or later one gets it backwards. */
  dur: number;
}

/** An asset that contains speech (pass the whole ledger entry). */
export interface SpokenSource {
  words?: readonly FilmWord[];
  text?: string;
  durMs?: number;
}

/** The three shapes a lookup accepts: one asset, a bare word list, or a whole conversation. */
export type SpokenInput = SpokenSource | readonly FilmWord[] | readonly SpokenSource[];

/**
 * The form used for comparison: all whitespace and punctuation removed.
 *
 * Both sides need it, for different reasons. On the word-list side, ASR already drops standalone
 * punctuation, but English has one entry per word, which concatenates to `Fourofthenine`. On the
 * caller's side, the most natural use is to copy a sentence verbatim from `text`, and that sentence
 * inevitably carries commas and periods that the full text has but the word list does not. Without
 * normalization, looking up a single Chinese word happens to work, but "copy a sentence from the full
 * text" never matches, and that is the very reason this function exists.
 */
const PUNCT_OR_SPACE = /[\s\p{P}\p{S}]+/gu;

/*
 * Case is erased as well.
 *
 * The manual says punctuation and spaces need not match, but says nothing about case, so `roast it`
 * failed while `Roast it` matched, and the error printed the full text underneath (which plainly
 * contains `Roast it`); the reader could only conclude the tool was broken. ASR's sentence-initial
 * capitals and mid-sentence lowercase are not part of the content anyway.
 */
function bare(text: string): string {
  return text.replace(PUNCT_OR_SPACE, '').toLowerCase();
}

/** The whole normalized text, plus which word each character came from. */
function flatten(words: readonly FilmWord[]): { text: string; owner: number[] } {
  let text = '';
  const owner: number[] = [];
  for (const [i, word] of words.entries()) {
    const piece = bare(word.token);
    text += piece;
    for (let k = 0; k < piece.length; k += 1) owner.push(i);
  }
  return { text, owner };
}

/**
 * When this word finishes.
 *
 * When the gateway reports no end time, fall back to the next word's start: that counts the
 * silence in between as part of this phrase, making it slightly long. Using the word's own start as
 * its end would instead clip the whole tail. Of the two errors, only the latter is audible.
 */
function wordEndSec(words: readonly FilmWord[], i: number): number {
  const word = words[i]!;
  if (typeof word.endSec === 'number') return word.endSec;
  const next = words[i + 1];
  return next ? wordStartSec(next) : wordStartSec(word);
}

/**
 * Rounds to milliseconds.
 *
 * Subtracting and adding offsets produces tails like `0.6000000000000001`, and these numbers are
 * **printed in receipts for people to copy into the arrangement**. Milliseconds are the downstream
 * resolution anyway (`toMs` stops there); extra digits carry no information, only noise.
 */
function round3(n: number): number {
  return Number(n.toFixed(3));
}

/** Normalizes to a list of assets. A bare word list counts as a single asset. */
function sourcesOf(input: SpokenInput): readonly SpokenSource[] {
  if (!Array.isArray(input)) return [input as SpokenSource];
  const arr = input as readonly unknown[];
  if (!arr.length) return [];
  // Bare word list: elements have `token`; a whole conversation: elements have `words` / `src`.
  return typeof (arr[0] as { token?: unknown })?.token === 'string'
    ? [{ words: input as readonly FilmWord[] }]
    : (input as readonly SpokenSource[]);
}

/** How long this asset plays; the next one continues from here. Without `durMs`, falls back to the last word's time. */
function spanSec(one: SpokenSource, words: readonly FilmWord[]): number {
  if (one.durMs != null) return one.durMs / 1000;
  return words.length ? wordStartSec(words[words.length - 1]!) : 0;
}

/** Inclusive token indexes for one normalized phrase match. */
export interface SpokenWordRange {
  firstWord: number;
  lastWord: number;
}

/** Shared text matching without inventing missing token end times. */
export function spokenWordRanges(words: readonly FilmWord[], phrase: string): SpokenWordRange[] {
  const needle = bare(phrase);
  if (!needle || !words.length) return [];
  const flat = flatten(words);
  const out: SpokenWordRange[] = [];
  for (let at = flat.text.indexOf(needle); at >= 0; at = flat.text.indexOf(needle, at + 1)) {
    out.push({ firstWord: flat.owner[at]!, lastWord: flat.owner[at + needle.length - 1]! });
  }
  return out;
}

/** Every occurrence of the phrase in this word list, overlapping ones included, in order. */
export function spokenRanges(words: readonly FilmWord[], phrase: string): SpokenRange[] {
  return spokenWordRanges(words, phrase).map(({ firstWord: first, lastWord: last }) => {
    const start = round3(wordStartSec(words[first]!));
    const end = round3(Math.max(start, wordEndSec(words, last)));
    return { start, end, dur: round3(end - start) };
  });
}

/**
 * At which second the phrase is said.
 *
 * Nearly all choreography is timed to some word in the narration: the hit lands on "bang", the
 * number pops on "forty-seven". The ledger's `words` records the second of every word, so in theory
 * you could copy them into the code, but **the moment you do, the film is welded to this take**.
 * Change one word of narration, switch voices, or resynthesize, and every time shifts by tens to
 * hundreds of milliseconds, so every hand-copied number is wrong. It fails in the worst way: the code
 * compiles, the picture renders, checks are green, and every motion is simply half a beat off, which
 * a contact sheet cannot show.
 *
 * So look it up; don't copy it. If the lookup fails it throws: breaking immediately when a word
 * changes is far better than being silently half a beat off.
 *
 * **A whole conversation is one unit too.** Pass an array and the word lists are chained in speaking
 * order, so "a word the third speaker says" works exactly like "a word the first speaker says",
 * without first adding up how long the earlier assets are.
 *
 * @param nth Which occurrence to take when the phrase is said more than once, from 0. Defaults to the
 *   first.
 */
export function said(input: SpokenInput, phrase: string, nth = 0): SpokenRange {
  const sources = sourcesOf(input);
  if (!sources.some((one) => one.words?.length)) {
    throw new Error(
      `This asset has no word list, so "${phrase}" cannot be looked up.`
      + ' Run `anim audio asr --src <src>` on it first.',
    );
  }

  let seen = 0;
  let offset = 0;
  for (const one of sources) {
    const words = one.words ?? [];
    for (const hit of spokenRanges(words, phrase)) {
      if (seen === nth) {
        return { start: round3(offset + hit.start), end: round3(offset + hit.end), dur: hit.dur };
      }
      seen += 1;
    }
    offset += spanSec(one, words);
  }

  const full = sources
    .map((one) => one.text ?? (one.words ?? []).map((w) => w.token).join(''))
    .join(' ');
  throw new Error(
    seen > 0
      ? `"${phrase}" only turns up ${seen} times here, so there is no #${nth + 1}.`
      : `The word list has no "${phrase}". What gets said: ${full}`,
  );
}

/** A stretch of continuous speech: from which second to which, and what was said. */
export interface SpeechRun {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * How much silence ends a stretch of speech.
 *
 * In continuous Chinese narration, gaps between words are usually under 100ms, while breaths
 * between sentences exceed 300ms. 350ms is chosen: smaller would chop a sentence into pieces, larger
 * would glue two sentences together.
 */
export const SPEECH_GAP_SEC = 0.35;

/** No space between CJK tokens, but a space between Latin ones; otherwise an English sentence joins into `Fourofthenine`. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function joinTokens(tokens: readonly string[]): string {
  let out = '';
  for (const token of tokens) {
    if (!out) { out = token; continue; }
    const tight = CJK.test(out.slice(-1)) || CJK.test(token.slice(0, 1));
    out += (tight ? '' : ' ') + token;
  }
  return out;
}

/**
 * Splits a word list into stretches of continuous speech.
 *
 * The split is based on silence between words, not punctuation, because whoever asks this wants to
 * cut: wherever nobody is speaking, you can cut. Punctuation is the structure of reading, which is
 * unrelated to whether there is an audible gap ("So," is often followed by no pause at all).
 *
 * Without `endSec`, the word list falls back to gaps between start times. That errs conservative
 * (the previous word's duration counts as silence): better to miss a cut than to cut mid-sentence.
 */
export function speechRuns(
  words: readonly FilmWord[],
  gapSec: number = SPEECH_GAP_SEC,
): SpeechRun[] {
  if (!words.length) return [];
  const endOf = (w: FilmWord): number => w.endSec ?? wordStartSec(w);

  const groups: FilmWord[][] = [[]];
  for (const [i, word] of words.entries()) {
    if (i > 0 && wordStartSec(word) - endOf(words[i - 1]!) >= gapSec) groups.push([]);
    groups.at(-1)!.push(word);
  }

  const round = (n: number): number => Number(n.toFixed(3));
  return groups.filter((g) => g.length).map((group) => ({
    text: joinTokens(group.map((w) => w.token)),
    startSec: round(wordStartSec(group[0]!)),
    endSec: round(endOf(group.at(-1)!)),
  }));
}
