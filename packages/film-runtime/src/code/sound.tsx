/**
 * Audio: the only thing in the tree that has no pixels.
 *
 * The three components stand for three roles, not three file types: the same waveform placed as
 * `Music` ducks under narration; placed as `Sfx` it doesn't. **The role is how you use it, not a
 * property of the bytes.**
 *
 * Audio clips in the edit list render as these (see doc.tsx): a clip says "which file, from which
 * second, up to which second", and at this layer that becomes "at which film millisecond it plays,
 * and for how long".
 *
 * `src` is just the file path. **How long the file is is not the film author's concern**: during
 * collection it is recorded as "unknown", and the evaluator ffprobes it once it has the list. The
 * code only cares about "when it plays, and (optionally) for how long".
 */

import * as React from 'react';

import { useRegisterSpokenCaptions } from './captions';
import { type SpokenWord } from './spoken';
import { toMs, toSec } from './sec';
import {
  useRegisterSound,
  useSpanMs,
  useSpanStartMs,
} from './stage';

/**
 * A path, or an object carrying known facts - usually the whole entry from the asset ledger.
 *
 * All times are in **seconds**, the same unit as the ledger, `film.json` and gsap.
 */
export type SoundAsset = string | {
  src: string;
  /** Duration of this asset, in seconds. Omit it and the evaluator measures it. */
  dur?: number;
  /** The second in the file where "the hit" lands. `<Sfx>` uses it to align the hit with `at`. */
  attack?: number;
  /**
   * What this narration says. Voiceover assets come with it (TTS returns the source text; ASR
   * returns the same thing).
   *
   * When present, `<Vo>` registers the captions as well - see the comment there.
   */
  text?: string;
  /** Per-word timings (on the asset's own timeline). Needed to break long sentences into lines instead of dumping the whole passage on screen. */
  words?: readonly SpokenWord[];
  /**
   * Who says this line (a label from the `cast` book). In multi-character dialogue each line in the
   * ledger carries its own - a whole conversation placed as a single `<Vo src={LINES}>` then gets
   * per-speaker tracks and SRT without splitting it into one element per person.
   * `cast` on the element is the default when a line has none.
   */
  cast?: string;
};

const srcOf = (a: SoundAsset): string => (typeof a === 'string' ? a : a.src);
/** File duration in ms. Infinity when unknown - harmless inside min(), and the evaluator later clamps it to the measured value. */
const durOf = (a: SoundAsset): number => (
  typeof a === 'string' || a.dur == null ? Infinity : toMs(a.dur)
);
/** This narration's source text and per-word timings. String-form assets have neither. */
const saidOf = (a: SoundAsset): { text?: string; words?: readonly SpokenWord[] } => (
  typeof a === 'string' ? {} : { text: a.text, words: a.words }
);

/**
 * Register the asset's full length - the timeline uses it to clamp edge drags, the same field
 * `<Video>` fills.
 *
 * Leaving it out costs more than "one missing number": the clip's right edge on the timeline
 * becomes unbounded, an `end` written back after dragging past the end of the asset is rejected
 * by the next evaluation (see assertTrim in doc.tsx), and all the user sees is "this change didn't
 * take effect" - the clip snaps back with no hint that the asset length is the cause. Audio clips
 * used to lack this field, so dragging a picture clip to its end would stop, while dragging an
 * audio clip to its end would error.
 *
 * When the length is unknown (`src` is just a path) we still don't report it: there really is no
 * bound yet, and the server-side evaluation fills it in after ffprobe.
 */
function nativeMsOf(a: SoundAsset): { sourceDurMs?: number } {
  const ms = durOf(a);
  return Number.isFinite(ms) ? { sourceDurMs: ms } : {};
}

/** Ramp lengths (seconds) for the music bed fading in and out. */
const MUSIC_FADE_IN_SEC = 0.6;
const MUSIC_FADE_OUT_SEC = 1.2;

/** One narration clip can stack several lines (a whole conversation as one clip), spoken in turn - start times accumulate. */
function isMany(src: SoundAsset | readonly SoundAsset[]): src is readonly SoundAsset[] {
  return Array.isArray(src);
}

interface Common {
  src: SoundAsset;
  /** Source location injected at compile time - don't write it yourself (see jsx-dev-runtime). */
  __loc?: string;
  /** Volume offset relative to the file's original level; may be positive. */
  gainDb?: number;
  /** The second in the file to start from (the start of `time`). */
  start?: number;
  /** The second in the file to stop at (the end of `time`). Omit to play to the end of the file or of this layer's window. */
  end?: number;
  /** This clip's id in the edit list. Only used for registration - only clips rendered from the list have one (see doc.tsx). */
  clipId?: string;
}

/**
 * Convert a time relative to this layer's window into an absolute film time, and work out how
 * long to play.
 *
 * Without an explicit end, how long to play depends on the kind of audio, and the distinction
 * matters:
 *
 *   - **Narration and sound effects play the whole file.** They are discrete events whose natural
 *     length is the file length. A 2.4 s line in a 2.0 s scene should run past the cut and finish
 *     (audio overlapping a cut is standard practice), not lose its last 0.4 s - that would turn
 *     "the author miscalculated" into "the user hears half a sentence", with nothing visible in
 *     the picture. `anim check` flags the overrun.
 *   - **Music fills the window.** It's a bed; its natural length is "as long as needed".
 *
 * An explicit end is honored as written (still capped by the file itself), including deliberately
 * running past the picture - that is a black tail, which the health check should report rather
 * than have it quietly changed here.
 */
function useSpan(
  atSec: number,
  wantSec: number | undefined,
  srcDurMs: number,
  fromSec: number,
  fill: boolean,
): { startMs: number; durMs: number } {
  const spanStart = useSpanStartMs();
  const spanDur = useSpanMs();
  const at = toMs(atSec);
  const fromMs = toMs(fromSec);
  const startMs = spanStart + at;
  const room = Math.max(0, spanDur - at);
  const left = Math.max(0, srcDurMs - fromMs);
  const want = wantSec != null ? toMs(wantSec) : undefined;
  if (want != null) return { startMs, durMs: Math.min(want, left) };
  return { startMs, durMs: fill ? Math.min(room, left) : left };
}

function playSec(start: number, end: number | undefined): number | undefined {
  return end != null ? end - start : undefined;
}

/**
 * Narration / voiceover.
 *
 * `src` takes a single line, or a whole scene of lines stacked in one clip - the latter are spoken
 * in turn. A multi-character dialogue is one clip.
 *
 * **What is said is registered as captions automatically.** Voiceover assets carry their source
 * text and per-word timings, so this breaks them into lines and reports them (see spoken.ts).
 */
export function Vo({
  src, at = 0, gainDb, start = 0, end, __loc, clipId,
}: Omit<Common, 'src'> & {
  src: SoundAsset | readonly SoundAsset[];
  at?: number;
}): null {
  /* `at` is an offset relative to the outer window; the timeline subtracts it when writing back. */
  const spanStartForAnchor = useSpanStartMs();
  const many = isMany(src) ? src : [src];
  const fromMs = toMs(start);
  const want = playSec(start, end);
  /* Start times accumulate, so the **number** of hook calls here follows the length of src. The
     line count is fixed within a render (it comes from an imported json), so this doesn't break
     the rules of hooks; if you really need to add or remove lines dynamically, use several
     sibling `<Vo>` elements instead. */
  let cursor = at;
  const spans = many.map((one) => {
    const span = useSpan(cursor, want, durOf(one), start, false);
    cursor += toSec(span.durMs);
    return { one, span };
  });
  for (const { one, span } of spans) {
    /* Who says it: each line in the ledger carries its own (one entry per person per line in a multi-character dialogue). */
    const said = typeof one === 'string' ? undefined : one.cast;
    useRegisterSound({
      kind: 'voice', src: srcOf(one), inMs: fromMs, gainDb, ...span,
      ...nativeMsOf(one),
      ...(said ? { cast: said } : {}),
      ...(saidOf(one).text ? { text: saidOf(one).text } : {}),
      ...(__loc ? { loc: __loc } : {}),
      ...(clipId ? { clipId } : {}),
      anchor: { move: 'at', resize: 'end', trimFrom: start, parentStartMs: spanStartForAnchor },
    });
  }

  /* Captions. Trimmed to the part of each line actually used; the rules are in captions.ts - source-footage audio goes through the same ones. */
  for (const { one, span } of spans) {
    const said = saidOf(one);
    useRegisterSpokenCaptions({
      text: said.text,
      words: said.words,
      src: srcOf(one),
      sourceDurMs: durOf(one),
      fromMs,
      startMs: span.startMs,
      durMs: span.durMs,
      /* On the captions side the field is called speaker - that's SRT's own term, kept until serialization. */
      speaker: typeof one === 'string' ? undefined : one.cast,
      loc: __loc,
    });
  }
  return null;
}

/**
 * Music.
 *
 * Ducks itself by -9 dB while someone is speaking - the same ducking rule as the final mix, so
 * what you hear while editing is what the export sounds like. Without an end it fills the window
 * of the layer it sits in.
 */
export function Music({
  src, at = 0, gainDb, start = 0, end, __loc, clipId,
}: Common & { at?: number }): null {
  const spanStartForAnchor = useSpanStartMs();
  const span = useSpan(at, playSec(start, end), durOf(src), start, true);
  useRegisterSound({
    kind: 'music', src: srcOf(src), inMs: toMs(start), gainDb, duck: true,
    /* The bed needs a ramp in and out: hard-cutting into full-volume music sounds like a player glitch. */
    fadeInMs: toMs(MUSIC_FADE_IN_SEC), fadeOutMs: toMs(MUSIC_FADE_OUT_SEC), ...span,
    ...nativeMsOf(src),
    ...(__loc ? { loc: __loc } : {}),
    ...(clipId ? { clipId } : {}),
    anchor: { move: 'at', resize: 'end', trimFrom: start, parentStartMs: spanStartForAnchor },
  });
  return null;
}

/**
 * A sound effect.
 *
 * `at` is when the file starts playing. Files often start with a bit of silence or a pickup (the
 * "attack" recorded in the asset ledger); the component moves the start that much earlier, so
 * "the hit" lands exactly on `at` while the edit list only needs one number.
 */
export function Sfx({
  src, at = 0, gainDb, start = 0, end, __loc, clipId,
}: Common & { at?: number }): null {
  const spanStartForAnchor = useSpanStartMs();
  const leadMs = typeof src === 'string' ? 0 : toMs(src.attack ?? 0);
  /* Shifting earlier may land before the window start - then place it at the start and trim the
     head of the file, so "the hit" still lands on at. */
  const wantStart = at - toSec(leadMs);
  const clippedMs = Math.max(0, toMs(-wantStart));
  const span = useSpan(
    Math.max(0, wantStart), playSec(start, end), durOf(src), start + toSec(clippedMs), false,
  );
  useRegisterSound({
    kind: 'sfx', src: srcOf(src), inMs: toMs(start) + clippedMs, gainDb,
    ...nativeMsOf(src),
    ...(leadMs ? { attackMs: leadMs } : {}),
    ...(__loc ? { loc: __loc } : {}),
    ...(clipId ? { clipId } : {}),
    anchor: { move: 'at', resize: 'end', trimFrom: start, parentStartMs: spanStartForAnchor },
    ...span,
  });
  return null;
}

