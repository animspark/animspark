/**
 * Zero-config fallback synthesis: turns a line of text into narration with per-word timing.
 *
 * When no provider key is configured, `anim audio` falls back to this (see the trade-offs in film/tts.ts),
 * and it is also what external coding agents rely on to run the whole workflow on their own machines.
 *
 * This local version speaks with macOS `say` and measures timing with ffprobe. It **splits the text into
 * clauses at punctuation, synthesizes each clause, measures each clause's real length, then joins them
 * with the pause each punctuation mark calls for**:
 *
 * - Clause boundaries are **measured**, not estimated, because that is exactly where choreography aligns.
 *   A "Bang!" becomes its own clause, and the millisecond it lands on is a measured value, the very one
 *   the MG hard-codes.
 * - Inside a clause, timing is interpolated by character count. Real ASR/TTS gives measured per-word
 *   timing, which this cannot match; but the inside of a clause is not a choreography anchor anyway, and
 *   the clause boundaries are accurate enough.
 *
 * Why not synthesize the whole text once and split it: that could only guess boundaries by silence
 * detection, and nobody would know when a guess was wrong. Per-clause boundaries are constructed, not
 * inferred, so they cannot be wrong. The cost is that pauses between clauses are ours rather than the
 * TTS's natural ones; in exchange the timing can be trusted, which is a good trade in editing.
 */

import { type FilmWord } from '@animspark/core';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { durationMs, ffmpeg } from './probe';

const run = promisify(execFile);

/** How long each punctuation mark pauses (ms). These few numbers are the rhythm of the speech. */
const PAUSE_MS: Record<string, number> = {
  '，': 220, ',': 220,
  '、': 160,
  '；': 280, ';': 280,
  '：': 200, ':': 200,
  '。': 420, '.': 420,
  '！': 420, '!': 420,
  '？': 440, '?': 440,
  '…': 500,
  '\n': 520,
};

const SAMPLE_RATE = 24_000;

interface Clause {
  /** The text to speak (without punctuation). */
  text: string;
  /** How long to pause after it. */
  pauseMs: number;
}

/**
 * `.` `,` `:` between letters or digits are not punctuation but part of a word.
 *
 * Ignoring this has a concrete cost: `film.json` would be split into two clauses with a 420ms pause in the
 * middle, and that word happens to be one of the most common things in the voice-over of these films.
 * Version numbers, decimals and timecodes follow the same rule.
 */
function isIntraWord(text: string, index: number): boolean {
  if (!/[.,:]/.test(text[index]!)) return false;
  const before = text[index - 1];
  const after = text[index + 1];
  return Boolean(before && after && /[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after));
}

/** Split into clauses at punctuation. Punctuation is silent itself and only contributes the pause after it. */
export function splitClauses(text: string): Clause[] {
  const clauses: Clause[] = [];
  const trimmed = text.trim();
  let buffer = '';
  for (let index = 0; index < trimmed.length; index += 1) {
    const ch = trimmed[index]!;
    const pause = isIntraWord(trimmed, index) ? undefined : PAUSE_MS[ch];
    if (pause == null) {
      buffer += ch;
      continue;
    }
    if (buffer.trim()) clauses.push({ text: buffer.trim(), pauseMs: pause });
    else if (clauses.length) {
      // Two punctuation marks in a row (e.g. "!?" or "……"): add the pause to the previous clause instead of creating an empty one.
      clauses[clauses.length - 1]!.pauseMs += pause;
    }
    buffer = '';
  }
  if (buffer.trim()) clauses.push({ text: buffer.trim(), pauseMs: 0 });
  return clauses;
}

/**
 * Split a clause into "words".
 *
 * Chinese by character, Latin scripts by spaces: per-character granularity is enough for Chinese (what
 * needs aligning is the moment a given character is spoken), and in mixed text an English word is not
 * split into letters.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  let latin = '';
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    // `film.json` is one word, not three: the same test as clause splitting.
    if (/[A-Za-z0-9'’\-]/.test(ch) || (latin && isIntraWord(text, index))) {
      latin += ch;
      continue;
    }
    if (latin) {
      out.push(latin);
      latin = '';
    }
    if (ch.trim()) out.push(ch);
  }
  if (latin) out.push(latin);
  return out;
}

export interface TtsResult {
  /** Measured total length. */
  durMs: number;
  words: FilmWord[];
}

/**
 * Synthesize to `outPath` (m4a).
 *
 * Intermediate files go to a temp directory: the workspace should hold only the film and assets/, not a pile of aiff files.
 */
export async function synthesize(opts: {
  text: string;
  voice: string;
  outPath: string;
}): Promise<TtsResult> {
  const clauses = splitClauses(opts.text);
  if (!clauses.length) throw new Error('The text to synthesize is empty');

  const work = mkdtempSync(join(tmpdir(), 'anim-tts-'));
  try {
    const pieces: string[] = [];
    const words: FilmWord[] = [];
    let cursorMs = 0;

    for (const [index, clause] of clauses.entries()) {
      const aiff = join(work, `c${index}.aiff`);
      const wav = join(work, `c${index}.wav`);
      await run('say', ['-v', opts.voice, '-o', aiff, '--', clause.text]);
      await ffmpeg(['-i', aiff, '-ar', String(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', wav]);
      const clauseMs = await durationMs(wav);
      pieces.push(wav);

      // Inside a clause, split by token count: each token gets an equal share of the clause's time.
      const tokens = tokenize(clause.text);
      const per = tokens.length ? clauseMs / tokens.length : 0;
      tokens.forEach((token, i) => {
        const atMs = cursorMs + i * per;
        const endMs = i + 1 < tokens.length ? cursorMs + (i + 1) * per : cursorMs + clauseMs;
        words.push({
          token,
          startSec: Number((atMs / 1000).toFixed(3)),
          endSec: Number((endMs / 1000).toFixed(3)),
        });
      });
      cursorMs += clauseMs;

      if (clause.pauseMs > 0) {
        const sil = join(work, `s${index}.wav`);
        await ffmpeg([
          '-f', 'lavfi',
          '-i', `anullsrc=r=${SAMPLE_RATE}:cl=mono`,
          '-t', (clause.pauseMs / 1000).toFixed(3),
          '-c:a', 'pcm_s16le',
          sil,
        ]);
        pieces.push(sil);
        cursorMs += clause.pauseMs;
      }
    }

    const list = join(work, 'list.txt');
    writeFileSync(list, pieces.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    await ffmpeg([
      '-f', 'concat', '-safe', '0', '-i', list,
      '-c:a', 'aac', '-b:a', '96k', '-ar', String(SAMPLE_RATE), '-ac', '1',
      opts.outPath,
    ]);

    // Measure again after joining: aac encoding aligns the length to frames, and the ledger must record the final file's length.
    return { durMs: await durationMs(opts.outPath), words };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
