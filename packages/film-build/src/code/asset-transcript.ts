/**
 * The agent-facing side of speech media: two fields on the index row, and a WebVTT split at pauses.
 *
 * The word-level table belongs to the host (see the private word book in asset-index): cue(),
 * captions and the cut-point checks all read it there; the agent doesn't. What the agent needs to
 * read the text, find phrases and pick cut points is **phrases** — so every transcribed asset gets
 * a materialized `assets/transcripts/<path>.vtt` that plain read / rg can search, with no dedicated
 * query tool. Like index.jsonl it is a view: it is rewritten whole every time the word book
 * changes, never saved on its own, so it can't drift from its source.
 *
 * Segments are split at silences, with the same threshold as the `speechRuns` used for editing:
 * there is always a pause between two adjacent segments, so every segment boundary is a place you
 * can cut. The text is sliced from the original transcript with punctuation kept; the segments
 * joined in order are the full text.
 */
import { SPEECH_GAP_SEC, stripAudioTags, wordStartSec, type FilmWord } from '@animspark/core/film';
import type { AssetEntry } from './asset-index';

export const ASSET_TRANSCRIPTS_DIR = 'assets/transcripts';

/** When someone talks too long without a pause, split again at a sentence end — a 20-second cue is hard to read and offers no cut points. */
const LONG_CUE_SEC = 12;
const SENTENCE_END = /[。！？!?…]|\.(?=\s|$)/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Where an asset's transcript view lives. Entries outside assets/ (voice rows, MG) have none. */
export function assetTranscriptPath(src: string): string | null {
  if (!src.startsWith('assets/') || src.startsWith(`${ASSET_TRANSCRIPTS_DIR}/`)) return null;
  return `${ASSET_TRANSCRIPTS_DIR}/${src.slice('assets/'.length)}.vtt`;
}

/** Discovery fields on the index row and in command receipts. */
export interface AssetTranscriptInfo {
  alignment?: 'ready' | 'missing';
  transcript?: string;
}

export function assetTranscriptInfo(entry: AssetEntry): AssetTranscriptInfo {
  const aligned = (entry.words?.length ?? 0) > 0;
  if (!aligned && entry.text === undefined && !entry.transcribed) return {};
  const transcript = assetTranscriptPath(entry.src ?? '');
  return {
    alignment: aligned ? 'ready' as const : 'missing' as const,
    ...(transcript ? { transcript } : {}),
  };
}

function joinTokens(tokens: readonly string[]): string {
  let out = '';
  for (const token of tokens) {
    out += out && !CJK.test(out.slice(-1)) && !CJK.test(token.slice(0, 1)) ? ` ${token}` : token;
  }
  return out;
}

function stamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(ms / 3_600_000))}:${two(Math.floor(ms / 60_000) % 60)}:${two(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, '0')}`;
}

/** Cue text can't contain `<` or `&`, nor blank lines; a NOTE also can't contain `-->`. */
function cueText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function noteText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/-->/g, '->');
}

/** Character offset of each word in the text; words that don't match get -1 (TTS sometimes reads "10%" as a different token sequence). */
function positions(text: string, words: readonly FilmWord[]): number[] {
  let cursor = 0;
  return words.map((word) => {
    const at = text.indexOf(word.token, cursor);
    if (at < 0) return -1;
    cursor = at + word.token.length;
    return at;
  });
}

interface Run { first: number; last: number; pos: number }

/**
 * Split into segments at pauses; overlong stretches are split again at sentence ends. A segment
 * that can't be matched to the text is merged into the previous one, so every segment has a text
 * offset, and the text between two adjacent offsets belongs to the earlier segment.
 */
function runs(text: string, words: readonly FilmWord[], at: readonly number[]): Run[] {
  const endOf = (word: FilmWord) => word.endSec ?? wordStartSec(word);
  const out: Run[] = [];
  let first = 0;
  let lastMapped = at[0] ?? -1;
  const close = (last: number) => {
    const pos = at.slice(first, last + 1).find((p) => p >= 0) ?? -1;
    if (pos < 0 && out.length) out.at(-1)!.last = last;
    else out.push({ first, last, pos });
  };
  for (let i = 1; i < words.length; i += 1) {
    const gap = wordStartSec(words[i]!) - endOf(words[i - 1]!) >= SPEECH_GAP_SEC;
    const long = wordStartSec(words[i]!) - wordStartSec(words[first]!) >= LONG_CUE_SEC;
    const between = lastMapped >= 0 && at[i]! > lastMapped ? text.slice(lastMapped, at[i]) : '';
    if (gap || (long && SENTENCE_END.test(between))) { close(i - 1); first = i; }
    if (at[i]! >= 0) lastMapped = at[i]!;
  }
  close(words.length - 1);
  if (out.length > 1 && out[0]!.pos < 0) {
    const lead = out.shift()!;
    out[0]!.first = lead.first;
  }
  return out;
}

export function transcriptVtt(entry: AssetEntry): string | null {
  const src = entry.src ?? '';
  if (!assetTranscriptPath(src)) return null;
  const words = (entry.words ?? []).filter((word) => word.token && Number.isFinite(wordStartSec(word)));
  const text = stripAudioTags(entry.text ?? '').trim() || joinTokens(words.map((word) => word.token));
  if (!text) return null;

  const speakers = [...new Set((entry.speakerTurns ?? []).map((turn) => turn.speaker))];
  const facts = [
    typeof entry.dur === 'number' ? `${Number(entry.dur.toFixed(1))} s` : '',
    speakers.length > 1 ? `speakers ${speakers.join(', ')}` : '',
  ].filter(Boolean).join(', ');
  const head = `WEBVTT\n\nNOTE\nTranscript of ${src}${facts ? ` (${facts})` : ''}. Times are seconds in the source media.`;
  if (!words.length) return `${head}\nNo timing yet: this media has text but no alignment.\n\nNOTE\n${noteText(text)}\n`;

  const segments = runs(text, words, positions(text, words));
  const blocks: string[] = [];
  for (const [r, run] of segments.entries()) {
    const from = r === 0 ? 0 : run.pos;
    const to = segments[r + 1]?.pos ?? text.length;
    const said = cueText(from >= 0 && to > from ? text.slice(from, to) : joinTokens(words.slice(run.first, run.last + 1).map((word) => word.token)));
    if (!said) continue;
    const start = wordStartSec(words[run.first]!);
    const following = words[run.last + 1] ? wordStartSec(words[run.last + 1]!) : entry.dur;
    const end = Math.max(start + 0.001, words[run.last]!.endSec ?? following ?? wordStartSec(words[run.last]!) + 0.3);
    const speaker = speakers.length > 1
      ? entry.speakerTurns!.find((turn) => turn.start <= start + 1e-3 && turn.end > start)?.speaker
      : undefined;
    /* The cue's identifier line states how long the pause before it is. Cues also break where the
       speaker changes, often with only tens of milliseconds between them; a reader who doesn't
       work it out from the timestamps would treat that as a pause and cut there (observed:
       a sentence cut in half). */
    const previous = run.first > 0 ? words[run.first - 1]! : null;
    /* Without an end time on the previous word we can't tell how long the pause is — writing nothing beats writing a wrong number. */
    const gap = previous?.endSec !== undefined ? start - previous.endSec : null;
    const id = gap === null ? '' : `pause ${Math.max(0, gap).toFixed(2)}s\n`;
    blocks.push(`${id}${stamp(start)} --> ${stamp(end)}\n${speaker ? `<v ${cueText(speaker)}>` : ''}${said}`);
  }
  const guide = 'Each cue is continuous speech; the line above a cue is the silence before it. Cut only in a pause of 0.12s or more —'
    + ' shorter gaps (often where the speaker changes) run straight on. Transcribed word ends are early: put an out point about 0.15s after'
    + ' the last word and an in point about 0.08s before the first, both inside the pause.'
    + ' In MG scenes, time animation with cue(sound, "phrase") instead of copying these numbers.';
  return `${head}\n${guide}\n\n${blocks.join('\n\n')}\n`;
}
