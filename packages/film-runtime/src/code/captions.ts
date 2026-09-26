/**
 * "What is said in this span" -> registered as captions.
 *
 * Narration and the source footage's own audio share this one path. Both have the same shape:
 * a clip carrying its transcript and per-word timings, of which the film uses one span (in-point
 * `fromMs`, length `durMs`). What we compute is which lines fall inside that span and at which
 * millisecond of the film each one lands.
 *
 * **Why the footage side needs it too.** See the header of spoken.ts: the data was always at hand,
 * nobody registered it. That note is about narration, but in an edited film the speech isn't on
 * a narration track - it's in the footage's own audio. Talking-head cleanup, podcast clipping,
 * landscape-to-portrait, B-roll cutaways: in that whole family of tasks the speech is the voice
 * that `<Video>` registers for its source, and on that path the transcript and word list were
 * dropped. So "ran ASR, cut it right, not a single caption" became the typical result for these
 * tasks: the film renders, every check is green, the CC button is greyed out, and nothing reports
 * an error.
 */

import * as React from 'react';
import type { FilmSubtitlesDoc } from '@animspark/core';
import { spokenLines, type SpokenLine, type SpokenWord } from './spoken';
import type { FilmAssetIndex } from './doc';
import { useRegisterCaption } from './stage';

/**
 * The `subtitles` block of the film doc (see FilmSubtitlesDoc in core): replace misrecognized
 * words, switch caption language. Passed down by FilmDocClips; a code-form film has no film doc,
 * so it gets the default - captions as usual, no replacements.
 */
export const FilmSubtitlesContext = React.createContext<(FilmSubtitlesDoc & { index?: FilmAssetIndex }) | undefined>(undefined);

/** Replace by source text, longest first, so a short key can't eat half of a longer one that contains it. */
export function applySubtitleFixes(text: string, fix: Readonly<Record<string, string>> | undefined): string {
  if (!fix) return text;
  let out = text;
  for (const from of Object.keys(fix).sort((a, b) => b.length - a.length)) out = out.split(from).join(fix[from]!);
  return out;
}

/**
 * The minimum time a caption line must stay on screen.
 *
 * Anything shorter is debris from a cut, not speech: when a cut lands mid-sentence, the part left
 * on this side may be only a few dozen milliseconds - and that flash of half a sentence is worse
 * than nothing.
 */
export const MIN_CAPTION_MS = 300;

export interface SpokenSpan {
  /** Which clip (workspace path). When the caption language is switched, used to look up the host-translated lines in the asset index. */
  src?: string | undefined;
  /** What this clip says. No text, no captions. */
  text?: string | undefined;
  /** Per-word timings (on the clip's own timeline). Needed to break the text into lines. */
  words?: readonly SpokenWord[] | undefined;
  /** Total clip length (ms), used to close the last line. Pass undefined if unknown. */
  sourceDurMs?: number | undefined;
  /** Millisecond of the clip to start from - the in-point of the edit. */
  fromMs: number;
  /** Millisecond of the film at which this span appears. */
  startMs: number;
  /** How long this span lasts. */
  durMs: number;
  /** Who is speaking. Dropped when the final list is assembled if the whole film has only one speaker (see collect.ts). */
  speaker?: string | undefined;
  loc?: string | undefined;
}

/**
 * Lines are broken on the clip's own timeline, then trimmed to the span actually used.
 *
 * When one clip is cut into several spans placed around the film (each with a different
 * `fromMs`), each span only claims the lines that fall inside its own window - that is exactly
 * "captions follow the edited timeline": cut speech doesn't appear, kept speech lands at its new
 * position.
 *
 * Ownership is decided by the **midpoint**, not by overlap. A line that straddles a cut overlaps
 * both sides, so counting overlap would show it once on each side of the cut; the midpoint falls
 * on only one side, so every line has exactly one owner.
 */
/** Keep a word only if it starts inside the window (within SLACK_MS); lines without word positions are returned as is. */
const SLACK_MS = 60;
const EDGE_PUNCT = /^[\s，,、。．.；;：:！!？?…]+|[\s，,、；;：:]+$/g;

/**
 * What captions don't print: standalone fillers (the CJK hesitation sounds, uh, um) and lines that
 * are only punctuation once stripped. The audio is untouched - this is only the reading layer,
 * the same idea as a "remove filler words" option in video editors. Sentence-final particles that
 * carry meaning are kept.
 */
/* The three CJK fillers (U+5443, U+55EF, U+989D) are written as escapes: the host bundle must not contain Chinese (code-host test). */
const FILLER = /(^|[\s，,、。.！!？?])(?:\u5443|\u55ef|\u989d|uh|um|erm|mm+|hmm+|mhm)(?=$|[\s，,、。.！!？?])[，,、]?/giu;

/** Stubs of a self-correction ("a- and", "th- the"): ASR marks them with a trailing hyphen and the next word is the finished version. Captions drop them. */
const FALSE_START = /(^|\s)([\p{L}']{1,4})-\s+(?=(\p{L}+))/gu;

/** Half-width punctuation after CJK characters (agents often use it when writing TTS text in a shell): CJK caption typography uses full-width. */
const HALF_PUNCT = /(?<=[\u3400-\u9fff])\s*([,;:?!])(?=\s*(?:[\u3400-\u9fff\u201c\u2018\u300a\u300c]|$))/gu;
const FULL_PUNCT: Record<string, string> = { ',': '\uff0c', ';': '\uff1b', ':': '\uff1a', '?': '\uff1f', '!': '\uff01' };

export function captionText(text: string): string {
  const out = text.replace(FALSE_START, (all, lead: string, stub: string, next: string) => (next.toLowerCase().startsWith(stub.toLowerCase()) ? lead : all))
    .replace(HALF_PUNCT, (_all, mark: string) => FULL_PUNCT[mark] ?? mark)
    .replace(FILLER, '$1').replace(/\s+(?:\.{2,}|…+)\s*$/u, '').replace(/\s{2,}/g, ' ').replace(EDGE_PUNCT, '').trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : '';
}

export function trimToWindow(line: SpokenLine, fromMs: number, untilMs: number): string {
  const marks = line.marks;
  if (!marks?.length || (line.startMs >= fromMs - SLACK_MS && line.endMs <= untilMs + SLACK_MS)) return line.text;
  const first = marks.findIndex((m) => m.startMs >= fromMs - SLACK_MS);
  if (first < 0) return '';
  let last = marks.length - 1;
  while (last >= first && marks[last]!.startMs >= untilMs - SLACK_MS) last -= 1;
  if (last < first) return '';
  const begin = first === 0 ? 0 : marks[first]!.index;
  const end = last === marks.length - 1 ? line.text.length : marks[last + 1]!.index;
  return line.text.slice(begin, end).replace(EDGE_PUNCT, '');
}

export function useRegisterSpokenCaptions(span: SpokenSpan): void {
  const policy = React.useContext(FilmSubtitlesContext);
  /* The caption language was switched and this clip has host-translated lines (audio translate):
     use those instead of lines broken from the transcript. Their times are the original lines'
     times, so they still follow the cuts; clips that were never translated show the original. */
  const translated = span.text && policy?.language && span.src ? policy.index?.[span.src]?.translations?.[policy.language] : undefined;
  const lines: SpokenLine[] = translated?.length
    ? translated.map((line) => ({ text: line.text, startMs: Math.round(line.startSec * 1000), endMs: Math.round(line.endSec * 1000) }))
    : spokenLines(span.text, span.words, span.sourceDurMs);
  const until = span.fromMs + span.durMs;
  for (const line of lines) {
    const from = Math.max(line.startMs, span.fromMs);
    const to = Math.min(line.endMs, until);
    /* Does this line belong to this span? With word positions: does any word start inside the cut
       - the text is then trimmed to those words, so a line straddling a cut shows its own half on
       each side. We used to judge by the line's midpoint, but the line end is estimated (it lingers
       after the last word), so a line with a tight out-point had its midpoint land outside the cut
       and the whole caption vanished (observed). Without word positions we fall back to the
       midpoint, so a line isn't shown on both sides. */
    const mine = line.marks?.length
      ? line.marks.some((m) => m.startMs >= span.fromMs - SLACK_MS && m.startMs < until - SLACK_MS)
      : (line.startMs + line.endMs) / 2 >= span.fromMs && (line.startMs + line.endMs) / 2 < until;
    /* When a cut trims one end of this line, the text is trimmed with it: the half sentence that
       was cut away shouldn't still hang in the caption (observed: a caption opening with the tail
       of the previous, cut sentence). */
    const text = captionText(trimToWindow(line, span.fromMs, until));
    useRegisterCaption(!mine || !text || to - from < MIN_CAPTION_MS ? null : {
      startMs: span.startMs + (from - span.fromMs),
      durMs: to - from,
      text: applySubtitleFixes(text, policy?.fix),
      ...(span.speaker ? { speaker: span.speaker } : {}),
      ...(span.loc ? { loc: span.loc } : {}),
    });
  }
}

