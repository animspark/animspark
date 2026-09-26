/**
 * What a narration line says, broken into caption lines.
 *
 * **Why this happens on the narration side instead of waiting for someone to write
 * `<Captions>`.** A voiceover asset arrives with its script and per-word timings (TTS provides
 * them, and ASR gives the same thing); they are already in the object `<Vo src={L}>` receives,
 * and were simply being thrown away. So "the film has narration but no captions" became the
 * norm, which is exactly why the CC button stayed greyed out: the data was at hand, nobody
 * registered it.
 *
 * Lines break by common captioning conventions, not by splitting time evenly:
 *   - Always break after sentence-ending punctuation: one sentence per line is the easiest
 *     shape to read.
 *   - If too long, break after secondary punctuation (commas, the CJK enumeration comma);
 *     with no punctuation available, break hard by length.
 *   - Also break when the speaker pauses longer than `GAP_MS`: that pause is already a
 *     semantic boundary.
 *
 * A line's **text** comes from the script (`text`) and its timing from the word table
 * (`words`). Tokens aren't glued back together because the spaces and punctuation between
 * them would be lost; invisible in Chinese, but English would run together.
 *
 * Performance tags in the script (`[short pause]` and the like) are stripped first. They are
 * instructions to TTS, not dialogue: all three providers either consume them as instructions
 * or strip them before synthesis, so they never appear in the word table. Only this code broke
 * lines from the raw script, so "[short pause] Alibaba, still on its way." got printed on
 * screen verbatim.
 */

import { stripAudioTags, wordStartSec, type FilmWord } from '@animspark/core/film';

/** Per-word timing. The `words` array in the JSON that TTS/ASR produce has exactly this shape. */
export type SpokenWord = FilmWord;

/** One broken-out line; its times are still on the asset's own timeline. */
export interface SpokenLine {
  text: string;
  startMs: number;
  endMs: number;
  /** Each aligned word in the line: its index in `text` and when it is spoken. Used to trim the text when a cut trims off one end of the line. */
  marks?: { index: number; startMs: number }[];
}

/** Maximum "cells" per line. A full-width character is one cell, anything else half a cell; 20 CJK characters is about the most a line can hold and still be read. */
const MAX_CELLS = 20;
/** Don't start a new line when only this many cells of the sentence remain: an orphan tail like 「…软硬件协 / 同的合作。」 is harder to read than a slightly longer line. */
const TAIL_CELLS = 6;
/** When breaking hard, look for a pause in the line: the gap between two words must be at least this long to count as a break point. */
const MIN_BREAK_GAP_MS = 120;
/** Break the line on a pause this long: that pause is already a semantic boundary. */
const GAP_MS = 700;
/** Roughly how long a line takes to say when there is no word table; only a fallback for assets without timings. */
const FALLBACK_MS_PER_CELL = 180;

const SENTENCE_END = /[。！？!?…;；]/;
/* List both full-width and half-width forms: the comma in Chinese prose is `，` (U+FF0C), not `,`.
   In a previous version these positions held two half-width commas and two half-width colons
   (the full-width half got folded away in some edit), so Chinese sentences **never found
   secondary punctuation to fall back on**: a long sentence always fell through to a hard break
   at cell 20, landing mid-word, as in 「…的钱算清楚，销 / 量从三十万…」. Every long caption line
   in every Chinese film looked like that, and it passed for the line breaker just being crude. */
const CLAUSE_END = /[,，、:：]/;

/**
 * Whether this period ends a sentence.
 *
 * A half-width period can't always count: in Chinese text it is mostly inside numbers
 * ("1.21x", "up 0.5%"), and breaking there would cut a sentence at the decimal point. It
 * counts only when followed by whitespace (or the end) and not preceded by a digit, which is
 * exactly the shape of an English sentence end.
 */
function endsSentence(text: string, i: number): boolean {
  const ch = text[i]!;
  if (SENTENCE_END.test(ch)) return true;
  if (ch !== '.') return false;
  const next = text[i + 1];
  if (next != null && !/\s/.test(next)) return false;
  return !/\d/.test(text[i - 1] ?? '');
}
/** Full-width characters (CJK ideographs, kana, full-width punctuation) take a whole cell. */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;

function cells(text: string): number {
  let n = 0;
  for (const ch of text) n += WIDE.test(ch) ? 1 : 0.5;
  return n;
}

/**
 * Where each token sits in the script.
 *
 * The word table was read aloud from the script, so tokens appear in the script in order; a
 * single forward scan aligns them. A token that doesn't match is skipped (TTS occasionally
 * splits "10%" into two tokens that don't quite correspond), so one mismatch doesn't ruin the
 * whole line.
 */
function alignedAt(text: string, words: readonly SpokenWord[]): { index: number; startSec: number; endSec?: number }[] {
  const out: { index: number; startSec: number; endSec?: number }[] = [];
  let cursor = 0;
  for (const w of words) {
    if (!w.token) continue;
    const index = text.indexOf(w.token, cursor);
    if (index < 0) continue;
    out.push({ index, startSec: wordStartSec(w), ...(w.endSec !== undefined ? { endSec: w.endSec } : {}) });
    cursor = index + w.token.length;
  }
  return out;
}

/**
 * Fallback for Chinese when there is no pause to break at: break after the last structural
 * particle (的, 了, 地, 得, 着) in the second half of the line.
 * 「…整个天玑的在早期的 / 芯片的定位」 reads better than 「…早期的芯 / 片的定位」: a particle is
 * almost always followed by a word boundary.
 */
/* 的 了 地 得 着, written as escapes: the host bundle must contain no Chinese (code-host test). */
const PARTICLE = /[\u7684\u4e86\u5730\u5f97\u7740]/;
function particleBreak(text: string, from: number, to: number): number {
  for (let k = to - 1; k > from; k -= 1) {
    if (cells(text.slice(from, k)) < MAX_CELLS / 2) break;
    if (PARTICLE.test(text[k - 1]!)) return k;
  }
  return -1;
}

/**
 * How many cells from i to the next breakable punctuation (comma or sentence end).
 *
 * When the line fills up exactly at the end of a word and the punctuation is the very next
 * character ("...center of the blast" is exactly 40 characters and the comma is the 41st),
 * without this check it would back off to the previous space and leave a line reading "blast,".
 */
function restOfClause(text: string, i: number): number {
  let j = i;
  while (j < text.length && !endsSentence(text, j) && !CLAUSE_END.test(text[j]!)) j += 1;
  return cells(text.slice(i, j + 1));
}

/**
 * Break the script into pieces by punctuation and length; returns each piece's start/end
 * indices in the script.
 *
 * `pauseAt(from, to)`: when there's no punctuation to fall back on, break before the word in
 * (from, to] with the longest pause. Chinese has no spaces, so previously the only option was
 * a hard break at cell 20, right in the middle of a word (「协 / 同」). Where the speaker
 * pauses is a word boundary.
 */
function chunks(text: string, pauseAt?: (from: number, to: number) => number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let from = 0;
  /** The last place we can fall back to breaking at (after secondary punctuation). */
  let fallback = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (CLAUSE_END.test(ch)) fallback = i + 1;
    const long = cells(text.slice(from, i + 1)) >= MAX_CELLS;
    if (endsSentence(text, i)) {
      /* When sentence-ending punctuation repeats ("?!", "……"), keep it all on this line. */
      let to = i + 1;
      while (to < text.length && SENTENCE_END.test(text[to]!)) to += 1;
      out.push({ from, to });
      from = to;
      i = to - 1;
      fallback = -1;
      continue;
    }
    if (!long) continue;
    /* No punctuation to fall back on and only a few cells to the next one: keep it on this line rather than leave an orphan. */
    if (fallback <= from && cells(text.slice(from, i + 1)) < MAX_CELLS + TAIL_CELLS && restOfClause(text, i + 1) <= TAIL_CELLS) continue;
    /*
     * Too long. Three levels of fallback: secondary punctuation, then word boundary, then a
     * hard break right here.
     *
     * The middle level was added for Latin script. Chinese can break after any character;
     * English can't. A long sentence without commas ("Four of the nine start over — and the
     * film comes back two days later.", where the dash isn't in the secondary punctuation
     * table) would be cut exactly at character 40, giving "...and the f" and "ilm comes
     * back...". With no space to fall back on (Chinese) it naturally drops to the hard break,
     * so that behavior is unchanged.
     */
    let to = fallback > from ? fallback : -1;
    if (to <= from) {
      const space = text.lastIndexOf(' ', i);
      const pause = space > from ? -1 : pauseAt?.(from, i + 1) ?? -1;
      const particle = pause > from || space > from ? -1 : particleBreak(text, from, i + 1);
      to = space > from ? space + 1 : pause > from ? pause : particle > from ? particle : i + 1;
    }
    out.push({ from, to });
    from = to;
    i = to - 1;
    fallback = -1;
  }
  if (from < text.length) out.push({ from, to: text.length });
  return out.filter((c) => text.slice(c.from, c.to).trim().length > 0);
}

/**
 * Break one narration line into caption lines.
 *
 * `durMs` is the asset's total length, used to end the last line. If unknown it is estimated
 * from speaking rate; underestimating ends the caption early, which beats dragging it over the
 * next sentence.
 */
export function spokenLines(
  text: string | undefined,
  words: readonly SpokenWord[] | undefined,
  durMs: number | undefined,
): SpokenLine[] {
  const said = stripAudioTags(text ?? '').trim();
  if (!said) return [];
  const total = Number.isFinite(durMs) ? durMs! : undefined;

  const marks = words?.length ? alignedAt(said, words) : [];
  if (!marks.length) {
    /* No per-word timings: the whole thing is one line. Broken lines would have no times to give, so splitting would only stack every line on the same moment. */
    return [{ text: said, startMs: 0, endMs: total ?? cells(said) * FALLBACK_MS_PER_CELL }];
  }

  /* Each piece starts at its first aligned word. If none align (the piece is all digits or
     punctuation), it follows right after the previous piece, which beats starting it at 0. */
  /* When a line is too long and has no punctuation, break between the two words with the longest pause (see chunks). Keep at least half a line before it so we don't cut off a short head. */
  const pauseAt = (from: number, to: number): number => {
    let best = -1, bestGap = MIN_BREAK_GAP_MS / 1000;
    for (let k = 1; k < marks.length; k += 1) {
      const m = marks[k]!, prev = marks[k - 1]!;
      if (m.index <= from || m.index > to || cells(said.slice(from, m.index)) < MAX_CELLS / 2) continue;
      const gap = m.startSec - (prev.endSec ?? prev.startSec);
      if (gap > bestGap) { best = m.index; bestGap = gap; }
    }
    return best;
  };
  const started = chunks(said, pauseAt).map((piece) => {
    const mark = marks.find((m) => m.index >= piece.from && m.index < piece.to);
    const raw = said.slice(piece.from, piece.to);
    const lead = raw.length - raw.trimStart().length;
    return {
      text: raw.trim(),
      startMs: mark ? Math.round(mark.startSec * 1000) : 0,
      marks: marks.filter((m) => m.index >= piece.from && m.index < piece.to)
        .map((m) => ({ index: m.index - piece.from - lead, startMs: Math.round(m.startSec * 1000) })),
    };
  });
  for (const [i, one] of started.entries()) {
    if (i > 0 && one.startMs <= started[i - 1]!.startMs) one.startMs = started[i - 1]!.startMs + 1;
  }

  return started.map((one, i) => {
    /* A line stays up until the next line starts: a gap would leave the screen blank for a
       moment while the viewer is still reading the previous sentence. The last line stays
       until the asset ends. */
    const until = started[i + 1]?.startMs ?? total ?? Infinity;
    /* Unless that's a long silence: a caption lingering long after the words are said makes
       viewers think the sentence isn't finished. Estimate from speaking rate and allow GAP_MS
       of slack. */
    const spoken = Math.max(500, cells(one.text) * FALLBACK_MS_PER_CELL);
    return {
      text: one.text,
      startMs: one.startMs,
      endMs: Math.min(until, one.startMs + spoken + GAP_MS),
      ...(one.marks.length ? { marks: one.marks } : {}),
    };
  }).filter((l) => l.endMs > l.startMs);
}
