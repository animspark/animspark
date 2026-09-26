import { said, spokenWordRanges, type FilmWord } from '@animspark/core/film';
import { scoreDuration, scoreTime, validateScore, type Score } from '@muspark/core';

export interface MediaTimeEntry {
  dur?: number;
  words?: readonly FilmWord[];
  text?: string;
}

export type MediaTimeIndex = Readonly<Record<string, MediaTimeEntry | undefined>>;

/** A sound placement on its owning MG's local timeline. */
export interface MediaCueSound {
  src?: string;
  score?: Score;
  at?: number;
  time?: readonly [number, number];
}

export interface MusicCueEvent { beat: number; duration: number }
export type MediaCueSelector = string | MusicCueEvent;
export type MediaDurationSource = string | MediaCueSound;

export interface MediaCueOptions {
  /** One-based occurrence in the full source, before its placement is trimmed. */
  occurrence?: number;
}

export interface MediaCue {
  readonly start: number;
  /** Throws when the source's final matched token has no measured end. */
  readonly end: number;
  /** Throws when the source's final matched token has no measured end. */
  readonly dur: number;
}

/** Public signature; a project bundle supplies the cached timing closure. */
export function cue(sound: MediaCueSound, selector: MediaCueSelector, options?: MediaCueOptions): MediaCue {
  if (sound?.score !== undefined) return musicCue(sound, selector, options);
  assertMediaSrc(sound?.src, 'cue(sound, phrase)');
  throw new Error('cue() needs project timing data. Run this MG in its project.');
}

/** Public signature; author bundles replace this export with their bound closure. */
export function at(src: string, phrase?: string): number {
  assertMediaSrc(src, 'at(src, phrase?)');
  throw new Error('Media at() needs project timing data. Run this MG in its project and use cue(sound, phrase).');
}

/** Public signature; a project bundle supplies the metadata-backed implementation. */
export function duration(source: MediaDurationSource): number {
  if (typeof source !== 'string' && source?.score !== undefined) return mediaDuration({}, source);
  assertMediaSrc(typeof source === 'string' ? source : source?.src, 'duration(source)');
  throw new Error('Media duration() needs project timing data. Run the code in the project, or use the duration tool.');
}

function assertMediaSrc(src: unknown, operation: string): asserts src is string {
  if (typeof src !== 'string' || !src.trim()) throw new Error(`${operation}: src must be a media path.`);
}

function mediaEntry(assets: MediaTimeIndex, src: string, operation: string): MediaTimeEntry {
  assertMediaSrc(src, operation);
  const entry = Object.prototype.hasOwnProperty.call(assets, src) ? assets[src] : undefined;
  if (!entry) throw new Error(`No timing data is available for "${src}". Check the media path.`);
  return entry;
}

function durationOf(entry: MediaTimeEntry, src: string): number {
  if (typeof entry.dur !== 'number' || !Number.isFinite(entry.dur) || entry.dur < 0) {
    throw new Error(`No duration is available for "${src}".`);
  }
  return entry.dur;
}

/** Total media length in seconds; independent of any clip, scene or phrase. */
export function mediaDuration(assets: MediaTimeIndex, source: MediaDurationSource): number {
  if (typeof source === 'string') return durationOf(mediaEntry(assets, source, 'duration(src)'), source);
  if (!source || typeof source !== 'object' || (source.src !== undefined) === (source.score !== undefined)) {
    throw new Error('duration(sound): provide exactly one of src or score.');
  }
  const full = source.score !== undefined ? scoreDuration(source.score)
    : durationOf(mediaEntry(assets, source.src!, 'duration(sound)'), source.src!);
  return soundWindow(source, full, 'duration(sound)').dur;
}

/** A pure phrase lookup. The optional-phrase duration form remains for existing code. */
export function mediaAt(assets: MediaTimeIndex, src: string, phrase?: string): number {
  const entry = mediaEntry(assets, src, 'at(src, phrase?)');
  if (phrase === undefined) return durationOf(entry, src);
  if (typeof phrase !== 'string' || !phrase.trim()) throw new Error('at(src, phrase): phrase must be non-empty text.');
  if (!entry.words?.length) {
    throw new Error(`No speech timing is available for "${src}". Run audio_transcribe first.`);
  }
  try {
    return said({
      words: entry.words,
      text: entry.text,
      ...(entry.dur != null ? { durMs: entry.dur * 1000 } : {}),
    }, phrase).start;
  } catch {
    throw new Error(`Phrase "${phrase}" was not found in "${src}".`);
  }
}

/**
 * Every compiled project receives its own closure before author modules load.
 * No React hook, mutable process-global project, filesystem or async call is
 * involved when the author calls at(). Every input is an exact media-source key.
 */
export function createMediaAt(assets: MediaTimeIndex): (src: string, phrase?: string) => number {
  return (src, phrase) => mediaAt(assets, src, phrase);
}

/** A project-local synchronous duration query, usable at module scope and in React. */
export function createMediaDuration(assets: MediaTimeIndex): (source: MediaDurationSource) => number {
  return (source) => mediaDuration(assets, source);
}

function soundWindow(sound: MediaCueSound, full: number, operation: string): { from: number; until: number; dur: number; at: number } {
  const at = sound.at ?? 0;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) throw new Error(`${operation}: at must be a nonnegative number.`);
  if (sound.time !== undefined && (!Array.isArray(sound.time) || sound.time.length !== 2)) throw new Error(`${operation}: time must be [sourceStart, sourceEnd].`);
  const [from, until] = sound.time ?? [0, full];
  if (![from, until].every(n => typeof n === 'number' && Number.isFinite(n)) || from < 0 || until <= from || until > full + 1e-6) {
    throw new Error(`${operation}: time exceeds or empties its ${full}s source.`);
  }
  return { from, until, dur: cueSeconds(until - from), at };
}

/** A note's written span, excluding its acoustic release, in the owning MG's seconds. */
function musicCue(sound: MediaCueSound, selector: MediaCueSelector, options?: MediaCueOptions): MediaCue {
  if (sound.src !== undefined || sound.score === undefined) throw new Error('cue(sound, note): provide score without src.');
  if (typeof selector !== 'object' || !selector || !Number.isFinite(selector.beat) || selector.beat < 0
    || !Number.isFinite(selector.duration) || selector.duration <= 0) throw new Error('cue(sound, note): note needs a nonnegative beat and positive duration.');
  if (options?.occurrence !== undefined) throw new Error('cue(sound, note): occurrence only applies to speech.');
  const score = validateScore(sound.score);
  if (selector.beat + selector.duration > score.durationBeats + 1e-6) {
    throw new Error(`cue(sound, note): the note at beat ${selector.beat} (duration ${selector.duration}) ends at beat ${selector.beat + selector.duration}, past the score's durationBeats ${score.durationBeats}.`);
  }
  const window = soundWindow(sound, scoreDuration(score), 'cue(sound, note)');
  const from = scoreTime(score, selector.beat), until = scoreTime(score, selector.beat + selector.duration);
  if (from < window.from - 1e-6 || until > window.until + 1e-6) {
    const f = (n: number) => `${Math.round(n * 1000) / 1000}s`;
    throw new Error(`cue(sound, note): the note at beat ${selector.beat} (duration ${selector.duration}) spans ${f(from)}–${f(until)} of the score, `
      + `but this sound plays only ${f(window.from)}–${f(window.until)} of it (sound.time). A note that starts inside the window but rings past its end counts as outside: `
      + 'pick only notes whose whole span (beat to beat + duration) lies inside it.');
  }
  return Object.freeze({ start: cueSeconds(window.at + from - window.from), end: cueSeconds(window.at + until - window.from), dur: cueSeconds(until - from) });
}

function cueInput(sound: MediaCueSound, phrase: string, options: MediaCueOptions): { at: number; occurrence?: number } {
  if (sound?.score !== undefined) throw new Error('cue(sound, phrase): speech needs src; use a note with a score.');
  assertMediaSrc(sound?.src, 'cue(sound, phrase)');
  if (typeof phrase !== 'string' || !phrase.trim()) throw new Error('cue(sound, phrase): phrase must be non-empty text.');
  const at = sound.at === undefined ? 0 : sound.at;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) throw new Error(`cue("${sound.src}"): sound.at must be a finite nonnegative number.`);
  if (sound.time !== undefined && (!Array.isArray(sound.time) || sound.time.length !== 2
    || !sound.time.every(n => typeof n === 'number' && Number.isFinite(n))
    || sound.time[0] < 0 || sound.time[1] <= sound.time[0])) {
    throw new Error(`cue("${sound.src}"): sound.time must be [start, end] with 0 <= start < end.`);
  }
  if (!options || typeof options !== 'object') throw new Error('cue(sound, phrase): options must be an object.');
  const occurrence = options.occurrence;
  if (occurrence !== undefined && (!Number.isSafeInteger(occurrence) || occurrence < 1)) {
    throw new Error('cue(sound, phrase): occurrence must be a positive integer, counted from 1 in the full source.');
  }
  return { at, occurrence };
}

const cueSeconds = (seconds: number): number => Number(seconds.toFixed(6));

/** Resolve a phrase against this sound instance; every result is in MG-local seconds. */
export function mediaCue(assets: MediaTimeIndex, sound: MediaCueSound, selector: MediaCueSelector, options: MediaCueOptions = {}): MediaCue {
  if (sound?.score !== undefined) return musicCue(sound, selector, options);
  if (typeof selector !== 'string') throw new Error('cue(sound, phrase): recorded speech needs a text phrase.');
  const phrase = selector;
  const { at, occurrence } = cueInput(sound, phrase, options);
  const entry = mediaEntry(assets, sound.src!, 'cue(sound, phrase)');
  if (!entry.words?.length) {
    throw new Error(`No speech timing is available for "${sound.src}". Run anim audio asr --src ${sound.src} first.`);
  }
  const from = sound.time?.[0] ?? 0;
  const nativeEnd = entry.dur === undefined ? Infinity : durationOf(entry, sound.src!);
  const until = sound.time?.[1] ?? nativeEnd;
  if (until > nativeEnd) throw new Error(`cue("${sound.src}"): sound.time ends at ${until}s, past the ${nativeEnd}s source.`);
  const hits = spokenWordRanges(entry.words, phrase);
  if (!hits.length) throw new Error(`Phrase "${phrase}" was not found in "${sound.src}".`);
  if (occurrence === undefined && hits.length > 1) {
    throw new Error(`Phrase "${phrase}" is ambiguous in "${sound.src}": ${hits.length} occurrences. Use { occurrence: 1 } through { occurrence: ${hits.length} }, counted in the full source.`);
  }
  const hit = hits[(occurrence ?? 1) - 1];
  if (!hit) throw new Error(`Phrase "${phrase}" occurs ${hits.length} times in "${sound.src}"; occurrence ${occurrence} does not exist.`);
  const first = entry.words[hit.firstWord]!;
  const last = entry.words[hit.lastWord]!;
  const end = last.endSec;
  let previousStart = -Infinity;
  for (const word of entry.words.slice(hit.firstWord, hit.lastWord + 1)) {
    if (!Number.isFinite(word.startSec) || word.startSec < 0
      || word.startSec < previousStart
      || (word.endSec !== undefined && (!Number.isFinite(word.endSec) || word.endSec < word.startSec))) {
      throw new Error(`Phrase "${phrase}" has invalid word timing in "${sound.src}". Run anim audio asr --src ${sound.src} to replace it.`);
    }
    previousStart = word.startSec;
  }
  if (first.startSec < from || last.startSec >= until || (end !== undefined && end > until)) {
    throw new Error(`Phrase "${phrase}" occurrence ${occurrence ?? 1} in "${sound.src}" is outside or partially outside sound.time [${from}, ${until}]. Choose an audible phrase or adjust the trim.`);
  }
  const start = cueSeconds(at + first.startSec - from);
  if (end === undefined) {
    const missingEnd = (): never => {
      throw new Error(`Phrase "${phrase}" in "${sound.src}" has no measured end for token "${last.token}". cue.start is available; cue.end and cue.dur require word end times. Run anim audio asr --src ${sound.src} to supply them.`);
    };
    return Object.freeze({ start, get end(): number { return missingEnd(); }, get dur(): number { return missingEnd(); } });
  }
  return Object.freeze({ start, end: cueSeconds(at + end - from), dur: cueSeconds(end - first.startSec) });
}

/** One immutable project metadata snapshot owns one reusable query cache. */
export function createMediaCue(assets: MediaTimeIndex): (sound: MediaCueSound, selector: MediaCueSelector, options?: MediaCueOptions) => MediaCue {
  const cache = new Map<string, MediaCue>();
  return (sound, phrase, options = {}) => {
    if (sound?.score !== undefined) return musicCue(sound, phrase, options);
    if (typeof phrase !== 'string') throw new Error('cue(sound, phrase): recorded speech needs a text phrase.');
    const { at, occurrence } = cueInput(sound, phrase, options);
    const key = JSON.stringify([sound.src, at, sound.time ?? null, phrase, occurrence ?? null]);
    let result = cache.get(key);
    if (!result) {
      result = mediaCue(assets, sound, phrase, options);
      cache.set(key, result);
    }
    return result;
  };
}
