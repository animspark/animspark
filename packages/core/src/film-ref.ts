/**
 * References: a way of writing "a moment in another block".
 *
 * Internal parser for legacy layouts and component durations. In current film.json, `at` accepts
 * only numbers and MG animations use numeric times directly; these legacy expressions are not an
 * authoring interface:
 *
 *     sc-02                  start of another block
 *     sc-02.end              end of another block
 *     sc-02.dur              length of another block on its track (meaningful only in duration)
 *     turn@[pours]           when this phrase starts in its word list
 *     turn@[pours].end       when the phrase finishes
 *     turn@[the]#3           the 3rd occurrence (counting from 1)
 *     …  + 0.35  /  …  - 0.2  offset; the minus needs a space before it, since `-` is also valid in ids
 *
 * Parsing is kept for internal callers that still use legacy layout nodes; check neither compiles
 * nor rewrites time references.
 *
 * ## Two coordinate systems
 *
 * Where a reference is written determines the coordinate system of its value: in `at` it yields
 * **film seconds**; in `duration` and component code it yields **seconds on the component's own
 * timeline** (film time minus this block's start, plus the head trim of this block's `time`). `.dur`
 * is a length and has no coordinate system.
 *
 * ## Phrases
 *
 * Always bracketed with `@[…]`: without brackets, `@boxes.end` could mean "when boxes finishes" or
 * a phrase called "boxes.end", and phrases containing spaces or `+` could not be split at all.
 * Matching goes through `said()`: punctuation, spaces and case are removed, then a contiguous
 * substring is searched for in the sentence built from the word list, so punctuation inside the
 * brackets never affects the match.
 *
 */

import { filmClipTrim, type FilmTimeSpan } from './film-doc';
import { said, spokenRanges, type SpokenSource } from './film-speech';

/**
 * The only characters allowed in a reference id. Auto-generated ids already use this set (see
 * filmClipIdFor); `.` `@` `[` `+` and whitespace are separators in the grammar, and an id containing
 * them could not be split.
 */
export const FILM_REF_ID_RE = /^[\p{L}\p{N}_-]+$/u;

export type FilmRefPoint =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'dur' }
  | { kind: 'word'; phrase: string; nth: number; end: boolean };

export interface FilmRef {
  id: string;
  point: FilmRefPoint;
  /** Seconds. 0 when omitted. */
  offset: number;
}

/*
 * Matches the whole string at once. Groups: id · point (.start/.end/.dur) · phrase · occurrence ·
 * phrase end · offset. Offsets: `+` never appears in ids, so the space before it is optional; `-`
 * does, so the minus **must** be preceded by whitespace.
 */
const REF_RE = new RegExp(
  '^\\s*'
  + '([\\p{L}\\p{N}_-]+)'                                   // 1 id
  + '(?:'
  +   '\\.(start|end|dur)'                                  // 2 point
  +   '|@\\[([^\\]]*)\\](?:#(\\d+))?(\\.end)?'              // 3 phrase 4 occurrence 5 end
  + ')?'
  + '(?:\\s*(\\+)\\s*(\\d+(?:\\.\\d+)?)|\\s+(-)\\s*(\\d+(?:\\.\\d+)?))?'  // 6/7 plus 8/9 minus
  + '\\s*$',
  'u',
);

const GRAMMAR = '<id>[.end | .dur | @[phrase][#n][.end]] [+ sec | - sec]';

/** Whether this value is reference text (rather than a number). Checks only the shape, not whether the content is valid. */
export function isFilmRefText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Parses a reference. Throws on malformed input, with the grammar in the error. */
export function parseFilmRef(text: string): FilmRef {
  if (typeof text !== 'string') throw new Error(`a reference has to be a string (${GRAMMAR}).`);
  const m = REF_RE.exec(text);
  if (!m) {
    const hint = /^\s*[\p{L}\p{N}_-]+@[^[]/u.test(text)
      ? ' The phrase goes in square brackets: turn@[pours].'
      : /[\p{L}\p{N}_-]-\d/u.test(text)
        ? ' A minus offset needs a space before the sign: sc-02.end - 0.2 (the id may itself contain -).'
        : '';
    throw new Error(`"${text}" is not a reference. Grammar: ${GRAMMAR}.${hint}`);
  }
  const id = m[1]!;
  const offset = m[6] ? Number(m[7]) : m[8] ? -Number(m[9]) : 0;
  let point: FilmRefPoint;
  if (m[3] != null) {
    const phrase = m[3].trim();
    if (!phrase) throw new Error(`"${text}": the phrase in @[…] is empty.`);
    const nth = m[4] != null ? Number(m[4]) : 1;
    if (!(nth >= 1)) throw new Error(`"${text}": #n counts occurrences from 1.`);
    point = { kind: 'word', phrase, nth, end: m[5] != null };
  } else if (m[2] === 'end') {
    point = { kind: 'end' };
  } else if (m[2] === 'dur') {
    point = { kind: 'dur' };
  } else {
    point = { kind: 'start' };
  }
  return { id, point, offset };
}

export function tryParseFilmRef(text: unknown): FilmRef | null {
  if (!isFilmRefText(text)) return null;
  try {
    return parseFilmRef(text);
  } catch {
    return null;
  }
}

/** Which block this reference points at. Returns null when it is not a reference (a number, or malformed). */
export function filmRefTargetId(value: unknown): string | null {
  return tryParseFilmRef(value)?.id ?? null;
}

export function formatFilmRef(ref: FilmRef): string {
  let out = ref.id;
  const p = ref.point;
  if (p.kind === 'end') out += '.end';
  else if (p.kind === 'dur') out += '.dur';
  else if (p.kind === 'word') {
    out += `@[${p.phrase}]`;
    if (p.nth !== 1) out += `#${p.nth}`;
    if (p.end) out += '.end';
  }
  if (ref.offset > 0) out += ` + ${trimNum(ref.offset)}`;
  else if (ref.offset < 0) out += ` - ${trimNum(-ref.offset)}`;
  return out;
}

function trimNum(n: number): string {
  return String(Number(n.toFixed(3)));
}

/* ── Resolution: turn every reference in an arrangement into a number ───────── */

/** Everything the resolver needs to know about a block. */
export interface FilmRefNode {
  id: string;
  /** The `at` in the arrangement: a number, a reference, or omitted (= 0). */
  at?: number | string | undefined;
  /** Trim on the block's own timeline. */
  time?: FilmTimeSpan | undefined;
  /**
   * The element's own length (seconds); when an MG component writes `duration` as a reference, this
   * is that string. Stills have no length; pass the end of `time` (consistent with stillNativeSec in
   * the runtime).
   */
  native: number | string;
  /** Blocks with a word list (voice, transcribed footage). `@[…]` can only point at these. */
  words?: SpokenSource | undefined;
}

export interface FilmRefPlaced {
  id: string;
  /** Start in the film, seconds. */
  startSec: number;
  /** The element's own length (resolved number). */
  nativeSec: number;
  /** Head trim, seconds. */
  fromSec: number;
  /** Length occupied on the track. */
  lenSec: number;
  /** End in the film. */
  endSec: number;
  /** Original text; present only when `at` is a reference. */
  atRef?: string;
  /** Original text; present only when `duration` is a reference. */
  durRef?: string;
}

interface Working {
  node: FilmRefNode;
  atRef: FilmRef | null;
  durRef: FilmRef | null;
  start?: number;
  native?: number;
}

const round3 = (n: number): number => Number(n.toFixed(3));

function lenOf(w: Working): number | undefined {
  if (w.native == null) return undefined;
  const trim = filmClipTrim({ time: w.node.time });
  return (trim.end ?? w.native) - trim.start;
}

class Unready extends Error {}

/**
 * The moment in the film (seconds) that a reference points at. `.dur` returns a length.
 * Throws Unready if the target is not resolved yet; the outer loop simply tries again.
 */
function pointOf(ref: FilmRef, target: Working, where: string): number {
  const p = ref.point;
  if (p.kind === 'dur') {
    const len = lenOf(target);
    if (len == null) throw new Unready();
    return len;
  }
  if (target.start == null) throw new Unready();
  if (p.kind === 'start') return target.start;
  if (p.kind === 'end') {
    const len = lenOf(target);
    if (len == null) throw new Unready();
    return target.start + len;
  }
  const words = target.node.words;
  if (!words || !(words.words?.length)) {
    throw new Error(`${where}: "${ref.id}" has no word list, so @[${p.phrase}] cannot be looked up.`);
  }
  const sec = wordSec(words, p, `${where}: in ${ref.id}, `);
  const trim = filmClipTrim({ time: target.node.time });
  const len = lenOf(target);
  if (sec + 1e-6 < trim.start || (len != null && sec - 1e-6 > trim.start + len)) {
    throw new Error(`${where}: "${p.phrase}" is at ${sec}s in ${ref.id}, outside the part of it on the track (time ${JSON.stringify(target.node.time)}).`);
  }
  return target.start + (sec - trim.start);
}

/** Second on the asset's own timeline where the phrase starts (or ends). Throws, with context, if not found or if there are too few occurrences. */
function wordSec(words: SpokenSource, p: Extract<FilmRefPoint, { kind: 'word' }>, where: string): number {
  try {
    const hit = said(words, p.phrase, p.nth - 1);
    return p.end ? hit.end : hit.start;
  } catch (e) {
    throw new Error(`${where}${e instanceof Error ? e.message : String(e)}`);
  }
}

/** How many times the phrase occurs in this word list. Used by `check` to warn "no #n given, but it occurs more than once". */
export function filmRefPhraseCount(words: SpokenSource | undefined, phrase: string): number {
  return spokenRanges(words?.words ?? [], phrase).length;
}

/**
 * Resolves everything. Returns the table when all resolve; throws when some cannot (cycles, dangling
 * references, wrong words), listing each problem.
 *
 * Iterates to a fixed point: each pass resolves whatever it can, and if a pass makes no progress
 * with work remaining, there is a cycle. Blocks are finite, so passes never exceed twice the number
 * of blocks (one step each for start and length).
 */
export function resolveFilmRefs(nodes: readonly FilmRefNode[]): Map<string, FilmRefPlaced> {
  const problems: string[] = [];
  const byId = new Map<string, Working>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      problems.push(`"${node.id}" is used as the id of two clips — every clip id has to be unique.`);
      continue;
    }
    const w: Working = { node, atRef: null, durRef: null };
    if (typeof node.at === 'string') {
      try {
        w.atRef = parseFilmRef(node.at);
        if (w.atRef.point.kind === 'dur') {
          problems.push(`${node.id}: at "${node.at}" — .dur is a length, not a moment; at wants .start / .end / @[phrase].`);
        }
      } catch (e) {
        problems.push(`${node.id}: at ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (typeof node.at === 'number') {
      w.start = node.at;
    } else {
      w.start = 0;
    }
    if (typeof node.native === 'string') {
      try {
        w.durRef = parseFilmRef(node.native);
      } catch (e) {
        problems.push(`${node.id}: duration ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      w.native = node.native;
    }
    byId.set(node.id, w);
  }
  for (const w of byId.values()) {
    for (const [what, ref] of [['at', w.atRef], ['duration', w.durRef]] as const) {
      if (!ref) continue;
      if (ref.id === w.node.id) {
        problems.push(`${w.node.id}: ${what} "${what === 'at' ? w.node.at : w.node.native}" refers to itself.`);
      } else if (!byId.has(ref.id)) {
        problems.push(`${w.node.id}: ${what} refers to "${ref.id}", and there is no clip with that id. Ids on hand: ${[...byId.keys()].join(' · ') || '(none)'}.`);
      }
    }
  }
  if (problems.length) throw new Error(problemText(problems));

  let progress = true;
  let guard = byId.size * 2 + 2;
  while (progress && guard-- > 0) {
    progress = false;
    for (const w of byId.values()) {
      if (w.native == null && w.durRef) {
        const target = byId.get(w.durRef.id)!;
        try {
          const point = pointOf(w.durRef, target, `${w.node.id}: duration "${w.node.native}"`);
          if (w.durRef.point.kind === 'dur') {
            w.native = point + w.durRef.offset;
          } else {
            if (w.start == null) throw new Unready();
            const trim = filmClipTrim({ time: w.node.time });
            w.native = trim.start + (point - w.start) + w.durRef.offset;
          }
          if (!(w.native > 0)) {
            problems.push(`${w.node.id}: duration "${w.node.native}" works out to ${round3(w.native)}s — it has to be above 0.`);
          }
          progress = true;
        } catch (e) {
          if (!(e instanceof Unready)) problems.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (w.start == null && w.atRef) {
        const target = byId.get(w.atRef.id)!;
        try {
          w.start = pointOf(w.atRef, target, `${w.node.id}: at "${w.node.at}"`) + w.atRef.offset;
          progress = true;
        } catch (e) {
          if (!(e instanceof Unready)) problems.push(e instanceof Error ? e.message : String(e));
        }
      }
    }
    if (problems.length) throw new Error(problemText(problems));
  }

  const stuck = [...byId.values()].filter((w) => w.start == null || w.native == null);
  if (stuck.length) {
    for (const w of stuck) {
      const refs = [
        w.start == null && w.atRef ? `at "${w.node.at}"` : null,
        w.native == null && w.durRef ? `duration "${w.node.native}"` : null,
      ].filter(Boolean).join(', ');
      problems.push(`${w.node.id}: ${refs} cannot be worked out — the references go round in a circle.`);
    }
    throw new Error(problemText(problems));
  }

  const out = new Map<string, FilmRefPlaced>();
  for (const w of byId.values()) {
    const trim = filmClipTrim({ time: w.node.time });
    const len = lenOf(w)!;
    out.set(w.node.id, {
      id: w.node.id,
      startSec: w.start!,
      nativeSec: w.native!,
      fromSec: trim.start,
      lenSec: len,
      endSec: w.start! + len,
      ...(w.atRef ? { atRef: w.node.at as string } : {}),
      ...(w.durRef ? { durRef: w.node.native as string } : {}),
    });
  }
  return out;
}

function problemText(problems: string[]): string {
  return problems.length === 1
    ? problems[0]!
    : `${problems.length} reference problems:\n  ${problems.join('\n  ')}`;
}

/* ── After resolution: references in code ──────────────────────────────────── */

/**
 * The moment in the film (seconds) a reference points at, against an already-resolved table.
 * `at('…')` in component code, timeline freeze references and `check`'s converted values all go
 * through this one function. `.dur` returns a length.
 */
export function filmRefFilmSec(
  ref: FilmRef,
  placed: ReadonlyMap<string, FilmRefPlaced>,
  wordsOf: (id: string) => SpokenSource | undefined,
): number {
  const target = placed.get(ref.id);
  if (!target) {
    throw new Error(`"${formatFilmRef(ref)}" refers to "${ref.id}", and there is no clip with that id.`);
  }
  const p = ref.point;
  if (p.kind === 'dur') return target.lenSec + ref.offset;
  if (p.kind === 'start') return target.startSec + ref.offset;
  if (p.kind === 'end') return target.endSec + ref.offset;
  const words = wordsOf(ref.id);
  if (!words?.words?.length) {
    throw new Error(`"${ref.id}" has no word list, so @[${p.phrase}] cannot be looked up.`);
  }
  const sec = wordSec(words, p, `in ${ref.id}, `);
  if (sec + 1e-6 < target.fromSec || sec - 1e-6 > target.fromSec + target.lenSec) {
    throw new Error(`"${p.phrase}" is at ${sec}s in ${ref.id}, outside the part of it on the track.`);
  }
  return target.startSec + (sec - target.fromSec) + ref.offset;
}

/**
 * Film time → seconds on the component's own timeline. `fromSec` is the head trim of this block's
 * `time`. `.dur` references return a length and are not converted.
 */
export function filmRefLocalSec(
  ref: FilmRef,
  filmSec: number,
  self: { startSec: number; fromSec: number },
): number {
  if (ref.point.kind === 'dur') return filmSec;
  return self.fromSec + (filmSec - self.startSec);
}
