/**
 * `film.json`: a film's arrangement.
 *
 * A film has two halves, each with its own home:
 *
 *   · **Placement** is **data** and lives in `film.json`. It is a list of **tracks**: a track's
 *     kind is the kind of its blocks (mg / video / audio), and a row holds only blocks of that kind.
 *     As in CapCut, rows have no names of their own; the kind is the identity. A block says just
 *     three things: `src` (which asset), `at` (the second it starts at) and `time` (which part to
 *     use), plus an `id` unique across the film (filled in from the asset name when omitted; see
 *     `filmClipIdFor`). For sound and footage, `src` is a file path, and user uploads work too; for
 *     MG, `src` is a module path. A block's name on the timeline is that path's file name.
 *
 *     **There is only one kind of sound track.** Narration, sound effects and music still
 *     **behave** in three ways (subtitles, onset alignment, ducking under voice), but that is a
 *     property of the asset, not of the row: the generation pipeline puts each kind of sound in its
 *     own directory (`assets/audio/vo|sfx|music/`), and behavior is read from the path (see
 *     `filmAudioRoleOf`). The previous version had one track kind per behavior, so even a pure
 *     housekeeping move like "put this sound effect on the music row" failed validation.
 *
 *     **Why blocks no longer restate their kind**: the previous version wrote
 *     `{ "music": "…/bed.mp3" }`, with the key as the kind. But the track already carries the kind,
 *     so that key carried zero information while adding one more place that could disagree with the
 *     track, which then needed an "a music clip goes on a music track" check to paper over it.
 *     CapCut takes a different route (a segment keeps only a `material_id` pointing into the media
 *     pool), but our paths already are the asset table's keys; an extra layer of id indirection on
 *     an arrangement the agent writes and reads by hand would only make its own writing unreadable
 *     to it. So: one `src`, and the kind comes from the track.
 *   · **How the picture moves** is **code** and lives in `mg/*.tsx`. An MG is a React component
 *     carrying `Talk.duration` (seconds). `film.json` only says "this block runs from second X to
 *     second Y".
 *   · Framing, masks, color grading and fades are all written inside the MG in plain React / CSS.
 *
 * Blocks deliberately have few fields: `at` (placement), `time` (trim), and `transform` / `volume`
 * on picture blocks. Picture processing belongs to the MG's code; the arrangement only covers where
 * a block sits, which part is used, and how loud it is.
 *
 * `at` is always a **number of seconds**; omitted = starts at 0. Query asset durations and word
 * times first, compute the placement yourself, then write it. `time: [in, out]` is a trim on the
 * block's own timeline (seconds) within `[0, element length]`; `[in]` alone trims the head but not
 * the tail; omitted = the whole element. Gaps are expressed through `at`; there are no blank blocks.
 *
 * Each block's timing is independent. Dragging, trimming, splitting or deleting a block never
 * changes other blocks through references.
 */

import { z } from 'zod';

import { filmStageSchema, type FilmStage } from './film-basics';

export const FILM_DOC_FILE = 'film.json';

/** A film has exactly one root, and it is this file. Opening, reusing a workspace and seeding templates all look for it. */
export function isFilmRootName(name: string): boolean {
  return name === FILM_DOC_FILE;
}

/* ── Time ────────────────────────────────────────────────────────────────── */

export const filmTimeValueSchema = z.number().finite();
export type FilmTimeValue = number;

/** `at` in the arrangement accepts only a precomputed, finite number of seconds. */
export const filmAtSchema = filmTimeValueSchema;
export type FilmAt = number;

/* ── Blocks ──────────────────────────────────────────────────────────────── */

/** Whether a ledger key is a file path. Only paths have a file duration. */
export function filmRefLooksLikePath(ref: string): boolean {
  return ref.includes('/') || filmSrcIsScore(ref) || /\.(m4a|mp3|wav|aac|ogg|flac|mp4|webm|mov)$/i.test(ref);
}

const AUDIO_PATH_MSG = 'has to be an audio file or Score module path, e.g. assets/audio/vo/line.m4a or assets/audio/music/theme.ts';

/** An audio source module defaults to a Muspark Score; its rendered WAV is host-owned. */
export function filmSrcIsScore(src: string): boolean {
  return /\.[cm]?[jt]s$/i.test(src) && !/\.d\.[cm]?ts$/i.test(src);
}

function audioPathField() {
  return z.string().min(1).refine(filmRefLooksLikePath, { message: AUDIO_PATH_MSG });
}

/**
 * Trim: `[start, end]` in seconds on the block's **own timeline**, within `[0, element length]`.
 * `[start]` alone trims the head but not the tail; omitted = the whole element. The block occupies
 * `end − start` seconds on the track.
 */
export const filmTimeSpanSchema = z
  .union([
    z.tuple([filmTimeValueSchema]),
    z.tuple([filmTimeValueSchema, filmTimeValueSchema]),
  ])
  .superRefine((v, ctx) => {
    if (v[0] < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'time is a trim on the element\'s own timeline — start cannot be below 0.',
      });
    }
    if (v.length === 2 && !(v[1]! > v[0])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'time is [start, end] with end greater than start (the clip occupies end − start on the track).',
      });
    }
  });
export type FilmTimeSpan = [number] | [number, number];

/** The block's in and out points (seconds). No `end` = play to the element's own end. */
export function filmClipTrim(clip: { time?: FilmTimeSpan }): { start: number; end?: number } {
  const t = clip.time;
  if (!t) return { start: 0 };
  return t.length === 2 ? { start: t[0], end: t[1] } : { start: t[0] };
}

/**
 * Placement shared by all blocks. The only time keys are `at` / `time`: `at` is the second in the
 * film at which the block starts (omitted = 0); `time` is the trim on the block's own timeline.
 */
const placementFields = {
  /**
   * This block's name, unique across the film. It names the **block**, not the asset: the same
   * asset placed twice is two blocks with two names.
   *
   * Authors may omit it: `parseFilmDocValue` fills it in from the asset name before validation, and
   * the filled-in name is saved with the file, so later insertions and deletions never shift it.
   */
  id: z.string({ required_error: 'every clip needs an id, unique across the film' }).min(1),
  at: filmAtSchema.optional(),
  time: filmTimeSpanSchema.optional(),
};

/**
 * Volume: a linear multiplier. `1` = unchanged, `0` = muted, `2` ≈ +6 dB.
 * The mixer still works in dB internally; see `filmVolumeToGainDb`.
 */
const volumeField = z.number().min(0);

/** `volume` → dB for the mixer. `1` / omitted = unchanged; `≤ 0` is mute and yields no dB. */
export function filmVolumeToGainDb(volume: number | undefined): number | undefined {
  if (volume == null || volume <= 0) return undefined;
  if (volume === 1) return undefined;
  return Math.round(20 * Math.log10(volume) * 1000) / 1000;
}

/** Like CapCut / AE, there is no separate mute switch: volume at 0 is mute. */
export function filmVolumeMuted(volume: number | undefined): boolean {
  return volume != null && volume <= 0;
}

/** The code form (film.tsx) uses `gainDb`; panels always show it as linear volume. */
export function filmGainDbToVolume(gainDb: number): number {
  return Math.round(10 ** (gainDb / 20) * 1000) / 1000;
}

/** Writes back `time`; drops the key when everything is at its default. */
export function filmTimeWrite(start: number, end?: number): FilmTimeSpan | undefined {
  if (!(start > 0) && end == null) return undefined;
  return end == null ? [start] : [start, end];
}

/**
 * Where the block sits on the canvas: `t` translate, `r` rotate, `s` scale. None written = no move,
 * no rotation, no scaling.
 *
 *   · `t: [x, y]`: px from the canvas's top-left corner to the element's top-left corner. May be
 *     negative and may leave the frame.
 *   · `r`: degrees, clockwise, about the element's center.
 *   · `s: [x, y]`: a multiplier per axis, `1` = original size. For uniform scaling, write both the
 *     same.
 *
 * The previous version had six keys (`x` / `y` / `scale` / `scaleX` / `scaleY` / `rotate`), with
 * scaling alone taking three: `scale` uniform and `scaleX` / `scaleY` per axis, and they could be
 * combined, so `{ scale: 0.35, scaleX: 2 }` was valid and reading it meant resolving each axis. A
 * value that can come from two places will eventually disagree with itself.
 */
export const filmTransformSchema = z
  .object({
    t: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    r: z.number().finite().optional(),
    s: z.tuple([z.number().positive(), z.number().positive()]).optional(),
  })
  .strict();
export type FilmTransform = z.infer<typeof filmTransformSchema>;

/** Per-axis multipliers. Omitted = 1. */
export function filmAxisScale(t?: FilmTransform): { scaleX: number; scaleY: number } {
  return { scaleX: t?.s?.[0] ?? 1, scaleY: t?.s?.[1] ?? 1 };
}

/** Translation, px. Omitted = no move. */
export function filmOffset(t?: FilmTransform): { x: number; y: number } {
  return { x: t?.t?.[0] ?? 0, y: t?.t?.[1] ?? 0 };
}

/** Shared by picture blocks (mg / video): placement, transform, volume. */
const pictureFields = {
  ...placementFields,
  transform: filmTransformSchema.optional(),
  volume: volumeField.optional(),
};

/**
 * A tweak a person made in the editor to one layer inside an MG: move it a bit, enlarge it, rotate
 * it, or apply a style that cannot be written back into the source.
 *
 * Why not edit the source directly: that layer's position is often **computed** (`left: n.x * 2`,
 * laid out by flex, animated there by GSAP), so there is no number in the source to change. And the
 * person does not want "change the layout" but "move just this one 12px to the right", which is
 * exactly what an override says. It layers on top of the animation (see element-overrides in
 * film-runtime): translate, scale and rotate use CSS's individual transform properties, which
 * multiply with the `transform` GSAP writes, so neither overwrites the other.
 *
 * Identifying the element: `at` is the tag's location in the source (`mg/hook.tsx:18:9`), and `n`
 * is which copy produced by `.map` (omitted = every copy). `fp` is what it looked like at the time
 * (tag + text): after the source is rewritten and line numbers shift, it is used to find the element
 * again; if it cannot be found, nothing moves. No guessing.
 *
 * Stored on the block rather than next to the MG: when the same MG is placed as two blocks, each
 * override follows its block. When the agent restructures the code it may fold the override into
 * the source, and then delete this entry.
 */
export const filmOverrideSchema = z
  .object({
    at: z.string().min(1).max(512),
    n: z.number().int().positive().optional(),
    fp: z
      .object({ tag: z.string().min(1).max(32), text: z.string().max(80).optional() })
      .strict()
      .optional(),
    /** Translation, in stage px. */
    t: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    /** Scale multiplier: a single number is uniform; `[x, y]` gives each axis its own multiplier. */
    s: z.union([z.number().positive(), z.tuple([z.number().positive(), z.number().positive()])]).optional(),
    /** Clockwise, degrees. */
    r: z.number().finite().optional(),
    /**
     * Styles: keys that cannot be written back into the source (computed ones like
     * `style={theme}` or `color: n.color * …`). Keys use React's camelCase, and numbers get px per
     * React's rules (except unitless keys). Applied with `!important` to beat the inline values GSAP
     * writes on the same node; the cost is that animation on that key stops.
     */
    style: z
      .record(z.string().regex(/^[a-zA-Z]{1,40}$/), z.union([z.string().max(200), z.number().finite()]))
      .refine((value) => Object.keys(value).length <= 24, 'at most 24 style keys')
      .optional(),
  })
  .strict();
export type FilmOverride = z.infer<typeof filmOverrideSchema>;

/* `src` comes first: saved key order follows the schema's declaration order, and the first question a block answers is "which asset?". */
export const filmMgClipSchema = z
  .object({
    src: z.string().min(1),
    ...pictureFields,
    overrides: z.array(filmOverrideSchema).max(200).optional(),
  })
  .strict();
export type FilmMgClip = z.infer<typeof filmMgClipSchema>;

export const filmVideoClipSchema = z
  .object({
    src: z.string().min(1),
    ...pictureFields,
  })
  .strict();
export type FilmVideoClip = z.infer<typeof filmVideoClipSchema>;

/** A sound block references an audio file or a source module whose default export is a Score; behavior is read from the path (filmAudioRoleOf). */
export const filmAudioClipSchema = z
  .object({
    src: audioPathField(),
    ...placementFields,
    volume: volumeField.optional(),
  })
  .strict();
export type FilmAudioClip = z.infer<typeof filmAudioClipSchema>;

export type FilmClip =
  | FilmMgClip
  | FilmVideoClip
  | FilmAudioClip;

/**
 * Track kinds, which are block kinds. Rows have no names of their own; the kind is the identity.
 *
 * The previous version split sound into three track kinds by behavior (vo / sfx / music). But all
 * three have exactly the same shape, and the split bought nothing except housekeeping bans like "a
 * sound effect cannot sit on the music row"; Premiere / DaVinci Resolve have just two families, V
 * and A. Now there are two picture kinds (MG is a module and footage is a file, genuinely different
 * shapes) and one sound kind; behavior follows the asset path.
 */
export const FILM_TRACK_KINDS = ['mg', 'video', 'audio'] as const;
export type FilmTrackKind = (typeof FILM_TRACK_KINDS)[number];

/**
 * The **role** a sound plays in mixing and subtitles; this is where the previous version's three
 * track kinds went.
 *
 *   · `voice`: produces subtitles when it has a word list, and speech is never cut off (see `<Vo>`
 *     in the runtime).
 *   · `sfx`: aligns the hit to `at` using the onset recorded in the ledger (`<Sfx>`).
 *   · `music`: ducks by −9dB whenever voice plays, with ramps in and out (`<Music>`).
 *
 * Read from the path: the generation pipeline puts each kind in its own directory (anim audio
 * vo/sfx/music), so the path records its origin. Anything outside those three directories (uploaded
 * voiceover, external files) is treated as voice: the kind you want to hear in full once it is on a
 * track and to subtitle after transcription, which is also the usual case for uploaded audio.
 */
export type FilmAudioRole = 'voice' | 'sfx' | 'music';

export function filmAudioRoleOf(src: string): FilmAudioRole {
  if (src.startsWith('assets/audio/sfx/')) return 'sfx';
  if (src.startsWith('assets/audio/music/') || filmSrcIsScore(src)) return 'music';
  return 'voice';
}


/**
 * Whether this block on a picture track is a **still image**.
 *
 * Stills and footage share the same kind of track (as in Premiere / DaVinci Resolve / CapCut, none
 * of which has a separate image track), and their blocks have the same shape. The one difference is
 * **where the length comes from**: footage has the file's own length and `time` trims a part of it;
 * a still has no length of its own, it is a source of unlimited duration, so the two numbers in
 * `time: [0, 8]` **are** its length.
 *
 * Detected by extension, the same approach as the three sound roles detected by directory: the
 * origin is written in the path, so there is no need for an extra block key that could contradict
 * the facts.
 *
 * `gif` counts as a still: `<img>` can show it, but it animates at its own pace rather than following
 * the host clock. To follow the film's timing it must first be converted to video.
 */
const STILL_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg',
]);

export function filmSrcIsStill(src: string): boolean {
  /* `> 0` rather than `>= 0`: this rejects both names without a dot (`mg/quote`) and names starting
     with one (`.jpg` is a nameless hidden file, not an asset). */
  const dot = src.lastIndexOf('.');
  return dot > 0 && STILL_EXTENSIONS.has(src.slice(dot + 1).toLowerCase());
}

/**
 * Track names (`M1` / `V2` / `A1`, Premiere / DaVinci Resolve style, as shown on track headers) are
 * **not stored in the arrangement**.
 *
 * They are **computed from position and kind**: counted top to bottom, each prefix counted
 * separately. There is exactly one place that computes them: `filmTrackBadges`.
 *
 * ## Why we went back from "stored" to "computed"
 *
 * The stored version guaranteed that inserting a track renames nothing: the user just said "add a
 * transition on M1", and with computed names, duplicating a track above it would make that sentence
 * point at a different track. The concern is real, but the cost of storing is bigger: once saved, a
 * name **never comes back**. After deleting M1 through M4, the lone survivor is still called M5 even
 * though it is now the only picture track. The timeline then carries a number that matches nothing,
 * indefinitely, with no way to reset it (reopening the project does not help; the number is on
 * disk).
 *
 * Weighing the two: a rename happens once, **while the user is watching** (and they see the header
 * change), whereas a wrong number is **permanent and silent**. So names are computed again.
 *
 * A stable identifier that follows a track (say, for the UI to remember which track is collapsed)
 * is a separate matter: that would call for a hidden `tid`, not using the human-facing number as an
 * id. Nothing needs one today: every edit (`loc`, `track`, `trackOrder`, the three switches) works
 * with **indexes**.
 */
export interface FilmTrack {
  kind: FilmTrackKind;
  clips: FilmClip[];
  /** Locked: clips on this track cannot be edited on the timeline. */
  locked?: boolean;
  /** Hidden: invisible and inaudible in both preview and export. The track is greyed out on the timeline. */
  hidden?: boolean;
  /** Original sound off / muted. The picture remains. */
  muted?: boolean;
}

/**
 * How this film uses the host's subtitles.
 *
 * Subtitles have a single source: the host generates them automatically from the film's speech (TTS
 * narration, transcribed recordings, the original sound of video blocks) and its word timings, and
 * the user picks style and on/off in the app. The agent does not write subtitles: hand-written ones
 * drift from the speech, cram two or three lines into one cue, and when drawn inside an MG they stack
 * on top of the host's layer (all of these have happened in practice). The film keeps only the two
 * things the host cannot do for it:
 *   · `fix`: misrecognized words (proper nouns most often, e.g. "Nvidia" heard as "and video") and
 *     numbers transcribed as spoken words. Word timings belong to the host; only the displayed text
 *     is replaced, and timing is untouched;
 *   · `language`: which language the subtitles use. When it differs from the speech, the host
 *     translates the transcript line by line (`audio translate`), and each subtitle keeps the timing
 *     of its original line.
 */
export interface FilmSubtitlesDoc {
  /** Recognized text → the text the subtitle should show. Replaced entry by entry against the original. */
  fix?: Record<string, string>;
  /** Subtitle language (BCP-47, e.g. `en`, `zh`). Defaults to the language of the speech. */
  language?: string;
}

const MAX_SUBTITLE_FIXES = 200;

function parseFilmSubtitles(raw: unknown, problems: string[]): FilmSubtitlesDoc | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('subtitles has to be an object: { "fix": { "wrong": "right" }, "language": "en" }.');
    return undefined;
  }
  const row = raw as Record<string, unknown>;
  /* `off` / `lines` are retired forms (the agent drawing / writing its own subtitles): accepted but not passed on, so the next save erases them. */
  const extra = Object.keys(row).filter((k) => !['fix', 'language', 'off', 'lines'].includes(k));
  if (extra.length) problems.push(`subtitles: unrecognised field: ${extra.join(' · ')} (it takes fix and language).`);
  const out: FilmSubtitlesDoc = {};
  if (row.fix !== undefined) {
    const fix = row.fix;
    if (!fix || typeof fix !== 'object' || Array.isArray(fix)) {
      problems.push('subtitles.fix has to be an object of { "as transcribed": "as it should read" }.');
    } else {
      const entries = Object.entries(fix as Record<string, unknown>);
      if (entries.length > MAX_SUBTITLE_FIXES) problems.push(`subtitles.fix takes at most ${MAX_SUBTITLE_FIXES} entries.`);
      const bad = entries.filter(([from, to]) => !from || typeof to !== 'string');
      if (bad.length) problems.push('subtitles.fix: every key must be non-empty text and every value text.');
      else if (entries.length) out.fix = Object.fromEntries(entries) as Record<string, string>;
    }
  }
  if (row.language !== undefined) {
    if (typeof row.language !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(row.language)) {
      problems.push('subtitles.language has to be a language code like "en", "zh" or "es".');
    } else out.language = row.language;
  }
  return out.fix || out.language ? out : undefined;
}

export interface FilmDoc {
  stage: FilmStage;
  tracks: FilmTrack[];
  subtitles?: FilmSubtitlesDoc;
}


export const FILM_CLIP_KINDS = ['mg', 'video', 'audio'] as const;
export type FilmClipKind = (typeof FILM_CLIP_KINDS)[number];

const CLIP_SCHEMAS: Record<FilmClipKind, z.ZodTypeAny> = {
  mg: filmMgClipSchema,
  video: filmVideoClipSchema,
  audio: filmAudioClipSchema,
};

export function filmClipSrcOf(clip: FilmClip): string {
  return clip.src;
}

export function filmTrackIsVisual(kind: FilmTrackKind): boolean {
  return kind === 'mg' || kind === 'video';
}

/** Flattened in track order, with indexes; evaluation, bundling and write-back all use this. */
export function filmDocEntries(doc: FilmDoc): Array<{
  clip: FilmClip;
  kind: FilmClipKind;
  trackIndex: number;
  clipIndex: number;
  track: FilmTrack;
}> {
  const out: Array<{
    clip: FilmClip;
    kind: FilmClipKind;
    trackIndex: number;
    clipIndex: number;
    track: FilmTrack;
  }> = [];
  doc.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip, clipIndex) => {
      out.push({ clip, kind: track.kind, trackIndex, clipIndex, track });
    });
  });
  return out;
}

/* ── Validation ──────────────────────────────────────────────────────────── */

/**
 * When a field name is wrong, also say what to write instead.
 *
 * This table only lists **names learned elsewhere**: the agent has seen other editing tools and CSS,
 * so it reaches for `duration` / `offset` / `gain` / `x` / `rotate` / `filter`. Adding "here it is
 * called…" when `.strict()` rejects a key saves a round trip compared with a bare
 * `unrecognised field: duration`.
 *
 * **It does not list this repository's own history.** `silent` / `captions` / `cutInSec` /
 * `lineGap` existed only in the previous version of this format and the agent has never seen them;
 * listing them would help nobody and would make every reader of this code first wonder whether the
 * field still exists.
 */
const FIELD_HINTS: Record<string, string> = {
  /* Duration / placement: every tool has its own name; these are the most common guesses. */
  duration: 'time: [start, end] (omit for the element\'s own length. It occupies end − start on the track)',
  length: 'time: [start, end] (omit for the element\'s own length. It occupies end − start on the track)',
  dur: 'time: [start, end] (omit for the element\'s own length. There is no dur field)',
  offset: 'at (which second this clip starts at in the film; omit for 0)',
  /* Sound. */
  gain: 'volume (linear, 1 = original, 0 = mute)',
  /* Placement. Three keys: t translate, r rotate, s scale. */
  x: 'transform.t: [x, y] (px, from the top left of the stage)',
  y: 'transform.t: [x, y] (px, from the top left of the stage)',
  rotate: 'transform.r (degrees, clockwise, about the centre)',
  scale: 'transform.s: [x, y] (per-axis multiplier; write both the same for uniform)',
  scaleX: 'transform.s: [x, y] (per-axis multiplier)',
  scaleY: 'transform.s: [x, y] (per-axis multiplier)',
  /* Picture processing is plain React / CSS inside the MG. */
  filter: 'React/CSS inside the MG component',
  effect: 'React/CSS inside the MG component',
  opacity: 'React/CSS inside the MG component',
  mask: 'React/CSS inside the MG component',
  crop: 'React/CSS inside the MG component',
  zoom: 'React/CSS inside the MG component',
  speed: 'media timing inside the MG component',
  rate: 'media timing inside the MG component',
  fx: 'React/CSS inside the MG component; clips have no fx field',
  /* Structure: tracks are an array, not a field on a block. */
  clips: 'nothing here — clips belong to a track, and the top level is tracks',
  track: 'nothing on the clip — moving between tracks means editing the tracks array',
  trackOrder: 'nothing on the clip — reordering means editing the tracks array',
  z: 'nothing — stacking follows the order of tracks, and the first track is on top',
  label: 'id (a clip has one name, unique across the film)',
  name: 'id (a clip has one name, unique across the film). Tracks have no name at all — kind is their identity',
};

function clipName(
  kind: FilmClipKind,
  raw: unknown,
  trackIndex: number,
  clipIndex: number,
): string {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).src : null;
  const who = `${kind}${typeof src === 'string' ? ` "${src}"` : ''}`;
  return `tracks[${trackIndex}].clips[${clipIndex}](${who})`;
}

function issueText(issue: z.ZodIssue): string {
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    const hints = issue.keys
      .map((k) => (FIELD_HINTS[k] ? `${k} → should be ${FIELD_HINTS[k]}` : k))
      .join(' · ');
    /* A bad key at the block's top level has an empty path; one inside `transform` carries
       `transform.`. Say which level, or where `x` should go is anyone's guess. */
    const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
    return `${where}unrecognised field: ${hints}`;
  }
  const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${path}${issue.message}`;
}

function parseOneClip(
  raw: unknown,
  trackIndex: number,
  clipIndex: number,
  trackKind: FilmTrackKind,
  problems: string[],
): FilmClip | null {
  /* The kind **is the track kind**. The previous version restated the kind on every block as its
     identity key, so there were two places that could disagree, plus an "a vo clip goes on a vo
     track" check to paper over it. Now a block only says which asset it points at. */
  const kind = trackKind;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    /* `at` is a number of seconds only. Lookups and arithmetic happen before writing; the arrangement never interprets references or expressions. */
    const expr = row.at;
    if (expr !== undefined && typeof expr !== 'number') {
      problems.push(
        `${clipName(kind, raw, trackIndex, clipIndex)}: at has to be a number of seconds.`
        + ` ${FILM_DOC_FILE} is plain data — query media timing and calculate the number before writing it.`,
      );
      return null;
    }
    if (row.time != null && !Array.isArray(row.time)) {
      problems.push(
        `${clipName(kind, raw, trackIndex, clipIndex)}: time has to be [start, end] in seconds.`,
      );
      return null;
    }
  }
  const parsed = CLIP_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${clipName(kind, raw, trackIndex, clipIndex)}: ${issueText(issue)}`);
    }
    return null;
  }
  return parsed.data as FilmClip;
}

/** The previous version's three behavior-based sound track kinds. Still readable; saved back as audio. */
const LEGACY_SOUND_KINDS = ['vo', 'sfx', 'music'] as const;

/** Track kind: one of three, the single key written on the track. */
function resolveTrackKind(row: Record<string, unknown>): { kind: FilmTrackKind } | { error: string } {
  const ask = 'kind has to be mg / video / audio. Tracks have no name.';
  if (typeof row.kind === 'string' && (FILM_TRACK_KINDS as readonly string[]).includes(row.kind)) {
    return { kind: row.kind as FilmTrackKind };
  }
  /* Arrangements from the previous version are still on disk. They are read as audio and saved as
     audio next time, with no change in behavior: narration / sound effect / music roles come from
     the asset path (filmAudioRoleOf), and generated sounds already live in their own directories. */
  if (typeof row.kind === 'string' && (LEGACY_SOUND_KINDS as readonly string[]).includes(row.kind)) {
    return { kind: 'audio' };
  }
  /* "image" gets its own message. `kind: "image"` is everyone's first instinct, and the message
     above only says the word is not in the list, so the author just guesses the next word, when the
     right answer is "pictures do not get their own track; they go with footage" (as in Premiere /
     DaVinci Resolve / CapCut).
     Not saying so has a measurable cost: once, after hitting this wall, an agent bypassed the CLI
     and hand-wrote ffmpeg, encoding seven downloaded images one by one into ten-second static mp4s
     before placing them on tracks. It lost quality, changed the aspect ratio and bypassed the asset
     ledger, when all it needed was "just place them directly". */
  if (row.kind === 'image' || row.kind === 'img' || row.kind === 'text') {
    return {
      error: `${ask} A picture is not a track of its own: put assets/image/….jpg straight on a`
        + ' video track, with time saying how long it stays (a still has no length of its own).',
    };
  }
  return { error: ask };
}

export function parseFilmDocValue(value: unknown): FilmDoc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${FILM_DOC_FILE} has to be an object: { stage, tracks }`);
  }
  const top = value as Record<string, unknown>;
  if ('clips' in top && !('tracks' in top)) {
    throw new Error(
      `${FILM_DOC_FILE} has tracks at the top level, not clips. Each track is { kind: "mg" | "video" | "audio", clips: […] }.`,
    );
  }
  const extra = Object.keys(top).filter((k) => k !== 'stage' && k !== 'tracks' && k !== 'subtitles');
  if (extra.length) {
    throw new Error(`${FILM_DOC_FILE} has only stage, tracks and subtitles at the top level. Do not recognise: ${extra.join(' · ')}`);
  }
  const stage = filmStageSchema.safeParse(top.stage);
  if (!stage.success) {
    throw new Error(
      `${FILM_DOC_FILE} wants a stage of positive whole numbers, like { w: 1920, h: 1080 } — the stage is the one thing that cannot be worked out from anything else.`,
    );
  }
  if (!Array.isArray(top.tracks)) {
    throw new Error(`${FILM_DOC_FILE} needs tracks: […] — each item is a track, with a kind and the clips on it.`);
  }
  fillClipIds(top.tracks);

  const tracks: FilmTrack[] = [];
  const problems: string[] = [];
  const seenIds = new Map<string, string>();

  top.tracks.forEach((raw, trackIndex) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(`tracks[${trackIndex}]: a track has to be an object: { kind: "mg", clips: […] }.`);
      return;
    }
    const row = raw as Record<string, unknown>;
    /* `id` is accepted but **not passed on** (see the FilmTrack comment: track names are computed
       again). Existing arrangements still carry stale numbers like `"id": "M5"`; rejecting them would
       fail with "unrecognised field" and the file would not open. Accepting them means the next save
       (serializeFilmDoc serializes only the parsed result) erases them: self-healing, no migration
       script. */
    const TRACK_KEYS = ['id', 'kind', 'clips', 'locked', 'hidden', 'muted'];
    const extraKeys = Object.keys(row).filter((k) => !TRACK_KEYS.includes(k));
    if (extraKeys.length) {
      problems.push(`tracks[${trackIndex}]: unrecognised field: ${extraKeys.join(' · ')}`);
    }
    if (!Array.isArray(row.clips)) {
      problems.push(`tracks[${trackIndex}]: needs clips: […].`);
      return;
    }
    const resolved = resolveTrackKind(row);
    if ('error' in resolved) {
      problems.push(`tracks[${trackIndex}]: ${resolved.error}`);
      return;
    }
    const kind = resolved.kind;
    const clips: FilmClip[] = [];
    row.clips.forEach((clipRaw, clipIndex) => {
      const clip = parseOneClip(clipRaw, trackIndex, clipIndex, kind, problems);
      if (!clip) return;
      const where = `tracks[${trackIndex}].clips[${clipIndex}]`;
      const dup = seenIds.get(clip.id);
      if (dup != null) {
        problems.push(`${where} and ${dup} both have the id "${clip.id}" — every clip id has to be unique.`);
        return;
      }
      seenIds.set(clip.id, where);
      clips.push(clip);
    });
    if (row.locked != null && typeof row.locked !== 'boolean') {
      problems.push(`tracks[${trackIndex}]: locked has to be true / false.`);
      return;
    }
    if (row.hidden != null && typeof row.hidden !== 'boolean') {
      problems.push(`tracks[${trackIndex}]: hidden has to be true / false.`);
      return;
    }
    if (row.muted != null && typeof row.muted !== 'boolean') {
      problems.push(`tracks[${trackIndex}]: muted has to be true / false.`);
      return;
    }
    tracks.push({
      kind,
      clips,
      ...(row.locked === true ? { locked: true } : {}),
      ...(row.hidden === true ? { hidden: true } : {}),
      ...(row.muted === true ? { muted: true } : {}),
    });
  });

  const subtitles = parseFilmSubtitles(top.subtitles, problems);
  if (problems.length) {
    throw new Error(`${FILM_DOC_FILE} has ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n  ${problems.join('\n  ')}`);
  }
  return { stage: stage.data, tracks, ...(subtitles ? { subtitles } : {}) };
}

/** Reads the bytes of `film.json` into an object. Pure data: only JSON.parse, never `new Function`. */
export function evalFilmDocSource(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${FILM_DOC_FILE} is empty — it wants { "stage": …, "tracks": [ … ] }.`);
  if (/^\s*(?:\/[/*]|export\s|import\s)/.test(text)) {
    throw new Error(
      `${FILM_DOC_FILE} is plain JSON: no export default, no comments, quoted keys.`,
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`${FILM_DOC_FILE} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function parseFilmDoc(text: string): FilmDoc {
  return parseFilmDocValue(evalFilmDocSource(text));
}

/** Writes the arrangement back to JSON. Validates first so bad data never reaches disk. */
export function serializeFilmDoc(doc: FilmDoc): string {
  /* Clone, then parse: leaves the caller's copy untouched and keeps bad data off disk. */
  const clone = JSON.parse(JSON.stringify(doc)) as FilmDoc;
  return `${JSON.stringify(parseFilmDocValue(clone), null, 2)}\n`;
}

/* ── Location tokens ─────────────────────────────────────────────────────── */

/** A block's location in the arrangement: `film.json#<track index>.<clip index>`. */
export function filmDocLoc(trackIndex: number, clipIndex: number): string {
  return `${FILM_DOC_FILE}#${trackIndex}.${clipIndex}`;
}

/**
 * Gives a block an unused name based on its asset name: `assets/audio/vo/02-turn.m4a` → `02-turn`,
 * or `02-turn-2` on a collision. When there is no asset name (the kind of block cannot be told yet),
 * falls back to `clip`.
 *
 * Separate from `mintFilmClipId`: that one is for splitting, where the right half wants "the left
 * half's name plus -b", meaning "this block was cut from that one"; this one names from scratch and
 * wants the asset's own name.
 */
export function filmClipIdFor(src: string | undefined, used: Iterable<string>): string {
  const base = (src ?? '').split(/[/\\]/).pop() ?? '';
  /* Letters are matched by Unicode: `\w` matches only ASCII, so a Chinese name like `我的片源.mp4` ("my footage.mp4") would collapse entirely into clip. */
  const stem = base
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'clip';
  const taken = new Set(used);
  if (!taken.has(stem)) return stem;
  let n = 2;
  while (taken.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/**
 * Fills in names, in place, for blocks without an id. This runs before validation, so everything
 * downstream (duplicate checks, evaluation, the timeline) still sees every block with a name, and
 * none of it needs to change.
 *
 * Mutating the original object is deliberate: `serializeFilmDoc` saves the parsed result, so a name
 * is fixed the first time it is saved. If ids never reached disk, each re-parse would number blocks
 * by their order, and inserting a block near the front would shift the names of all blocks after it.
 */
function fillClipIds(tracks: readonly unknown[]): void {
  const taken = new Set<string>();
  const blank: Array<Record<string, unknown>> = [];
  for (const track of tracks) {
    if (!track || typeof track !== 'object' || Array.isArray(track)) continue;
    const clips = (track as Record<string, unknown>).clips;
    if (!Array.isArray(clips)) continue;
    for (const clip of clips) {
      if (!clip || typeof clip !== 'object' || Array.isArray(clip)) continue;
      const row = clip as Record<string, unknown>;
      if (typeof row.id === 'string' && row.id) taken.add(row.id);
      else blank.push(row);
    }
  }
  for (const row of blank) {
    const id = filmClipIdFor(typeof row.src === 'string' ? row.src : undefined, taken);
    row.id = id;
    taken.add(id);
  }
}

/** The prefix for this kind of track. `M` = MG, `V` = footage, `A` = sound. */
export function filmTrackPrefix(kind: string): string {
  return kind === 'mg' ? 'M' : kind === 'video' ? 'V' : 'A';
}

/**
 * The name of every track, computed from **position and kind**, one per track, aligned with
 * `tracks`.
 *
 * Counting: **always top to bottom**, each prefix counted separately (the topmost picture track is
 * M1, the topmost sound track is A1).
 *
 * Premiere / DaVinci Resolve count picture tracks upward (V1 at the bottom) because the number
 * describes **stacking**: V1 is the base, and higher numbers sit in front. We do not, because if the
 * two groups counted in opposite directions, **the same visual position would read two opposite
 * ways**: scanning the headers top to bottom shows M3 M2 M1 A1 A2 A3, turning the divider into a
 * mirror. Here the number is not about stacking (stacking is shown by position itself) but about
 * **pointing**: the user must be able to say "the second picture track" and put a finger on it.
 * Pointing wants numbers that increase top to bottom.
 *
 * The numbers are not in the arrangement and never saved (see `FilmTrack` for why). So after
 * deleting M1 through M4, the lone survivor **is M1**: it is the only picture track right now, and
 * the number has exactly one source.
 *
 * Only the `kind` field is read, so half-parsed data (the UI's `doc`) can ask it directly.
 */
export function filmTrackBadges(tracks: readonly { kind: string }[]): string[] {
  const seen = new Map<string, number>();
  return tracks.map((track) => {
    const prefix = filmTrackPrefix(track.kind);
    const nth = (seen.get(prefix) ?? 0) + 1;
    seen.set(prefix, nth);
    return `${prefix}${nth}`;
  });
}

/** On split / paste, gives the right half or the new block an id not yet in the arrangement. */
export function mintFilmClipId(used: Iterable<string>, base?: string): string {
  const taken = new Set(used);
  const stem = base && /^[A-Za-z][\w-]*$/.test(base) ? `${base}-b` : 'clip';
  if (!taken.has(stem)) return stem;
  let n = 2;
  while (taken.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

export function parseFilmDocLoc(loc: string): { track: number; clip: number } | null {
  const m = new RegExp(`^${FILM_DOC_FILE.replace('.', '\\.')}#(\\d+)\\.(\\d+)$`).exec(loc);
  return m ? { track: Number(m[1]), clip: Number(m[2]) } : null;
}

/** Stable identities follow the host's successful build; old /vN identities stay pinned. */
export function parsePublishedMgSource(src: string): { assetId: string; revision?: number } | null {
  const match = /^assets\/mg\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?:\/v([1-9][0-9]*))?$/.exec(src);
  if (!match || (match[2] && !Number.isSafeInteger(Number(match[2])))) return null;
  return { assetId: match[1]!, ...(match[2] ? { revision: Number(match[2]) } : {}) };
}

/** Compatibility filename for explicit exports and old WebM-only deliveries. */
export function filmPublishedMgMediaSrc(src: string): string | null {
  return parsePublishedMgSource(src) ? `${src}/media.webm` : null;
}

export function filmDocMgSrcs(doc: FilmDoc): string[] {
  const out: string[] = [];
  for (const { clip, kind } of filmDocEntries(doc)) {
    if (kind === 'mg' && !filmPublishedMgMediaSrc(clip.src) && !out.includes(clip.src)) out.push(clip.src);
  }
  return out;
}

/** Score modules are code dependencies, never input media for ffprobe. */
export function filmDocScoreSrcs(doc: FilmDoc): string[] {
  return [...new Set(filmDocEntries(doc)
    .filter(({ kind, clip }) => kind === 'audio' && filmSrcIsScore(clip.src))
    .map(({ clip }) => clip.src))];
}

/**
 * Whether this source is an MG that can go on stage.
 *
 * The bundle entry writes `import x from 'mg/talk'` for each module (see doc-entry in film-build),
 * and the host mounts only the default export. Listing the asset cabinet does not execute files, it
 * only checks for this export: `.ts` / `.md` files or helpers with only named exports would render
 * nothing if dragged onto the timeline.
 */
export function isFilmMgModuleSource(src: string): boolean {
  return /\bexport\s+default\b/.test(src) || /\bexport\s*\{[^}]*\bdefault\b/.test(src);
}

/**
 * The "play just this one" address used when double-clicking in the asset cabinet or shooting a
 * poster on its own.
 *
 * Accepts only `mg/…`, the workspace modules that can actually go on stage, not the images in
 * `assets/mg/`. `..` and backslashes are rejected outright: this string goes into the iframe's
 * query string and is then used by the compiler as an import path.
 */
export function parseFilmMgPreview(raw: string | null | undefined): string | null {
  const src = (raw ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!src || src.includes('..') || src.includes('\\')) return null;
  return /^mg\/[A-Za-z0-9._/-]+$/.test(src) || filmPublishedMgMediaSrc(src) ? src : null;
}

const PREVIEW_FALLBACK_SEC = 3;

/** An arrangement containing only this MG. Length still comes from the module's `duration`; without one, the preview entry fills in 3 seconds. */
export function filmMgPreviewDoc(src: string, stage: FilmStage = { w: 1920, h: 1080 }): FilmDoc {
  return {
    stage,
    tracks: [{ kind: 'mg', clips: [{ id: 'preview', src }] }],
  };
}

/**
 * A compile entry that imports only this MG. The bundle already contains every `mg/*.tsx`, so
 * esbuild can resolve it.
 *
 * Same glue as `filmDocEntrySource(..., { mode: 'runtime' })`, with three differences: the
 * arrangement is the preview one above; a module without `duration` gets 3 seconds so modules
 * without a literal length can still play; and references are lenient (lenientRefs): the blocks it
 * refers to are not in this arrangement, so `at()` returns 0 instead of throwing. A `duration` written
 * as a reference also plays for 3 seconds in preview: the runtime handles that fallback (see
 * resolveRefs), and the module is left untouched here.
 */
export function filmMgPreviewEntry(src: string, stage: FilmStage = { w: 1920, h: 1080 }): string {
  const spec = JSON.stringify(`./${src}`);
  const key = JSON.stringify(src);
  return [
    `import { filmFromLiveDoc } from '@animspark/runtime';`,
    `import __mg from ${spec};`,
    `if (!((typeof __mg.duration === 'number' && __mg.duration > 0) || typeof __mg.duration === 'string')) __mg.duration = ${PREVIEW_FALLBACK_SEC};`,
    `const __film = filmFromLiveDoc(() => globalThis.__FILM_DOC__, {`,
    `  ${key}: __mg,`,
    `}, undefined, {}, { lenientRefs: true });`,
    `export const stage = ${JSON.stringify(stage)};`,
    `export default __film.Film;`,
    '',
  ].join('\n');
}

/**
 * The arrangement's **shape**: the sole criterion for "does this change need a recompile?".
 *
 * An arrangement has two parts: shape and positions. Positions are a set of numbers (`at` / `time`),
 * and changing them just re-places things. The shape determines **what the compiled output looks
 * like**: which MG modules are bundled, which assets need their durations probed, the stage size,
 * and whether the sound ledger is bundled (see doc-entry in film-build: all four are baked into the
 * generated glue).
 *
 * If the shape is unchanged there is no need to recompile: the server can keep using the module it
 * imported last time, and the preview page can accept just the new arrangement and re-render,
 * instead of compiling the whole film again. There must be only one criterion: if the server and the
 * iframe each had their own, the day they diverge shows up as "the block I just added is missing
 * from the picture", with both sides convinced they are right.
 *
 * `facts` is **whether the sound ledger exists on disk**. The ledger is one whole file, not per
 * entry. A sound that was just placed but not yet generated cannot enter the output (esbuild imports
 * are static, and pointing at a missing file breaks the whole compile), and the moment it is
 * generated and the ledger is written, the shape must change, or the cached output would never
 * contain its word list. Changes to the ledger's content are handled by `codeStamp`, so there is no
 * need to list every src here as well.
 *
 * Sorted: the same modules in a different order only produce different variable names, which is no
 * reason to recompile.
 */
export function filmDocShape(doc: FilmDoc, env: { facts?: readonly string[] } = {}): string {
  return [
    `stage\t${doc.stage.w}x${doc.stage.h}`,
    ...filmDocMgSrcs(doc).sort().map((src) => `mg\t${src}`),
    ...filmDocScoreSrcs(doc).sort().map((src) => `score\t${src}`),
    ...filmDocMediaSrcs(doc).sort().map((src) => `media\t${src}`),
    ...(env.facts == null ? [] : [...env.facts].sort().map((src) => `facts\t${src}`)),
  ].join('\n');
}

/**
 * Sound files referenced by the arrangement.
 *
 * Separate from `filmDocMediaSrcs`: that one lists what needs its duration probed, footage
 * included; this one lists what should have an entry in the ledger. For footage audio to enter the
 * film it must be placed as an audio block, at which point it naturally appears here.
 */
export function filmDocSoundSrcs(doc: FilmDoc): string[] {
  const out: string[] = [];
  for (const { clip, kind } of filmDocEntries(doc)) {
    if (kind !== 'audio') continue;
    const src = filmClipSrcOf(clip);
    if (!filmSrcIsScore(src) && filmRefLooksLikePath(src) && !out.includes(src)) out.push(src);
  }
  return out;
}

/**
 * Media files referenced by the arrangement (on picture and sound tracks), stills included, since
 * they are also bytes the film needs.
 *
 * **Callers probing durations must filter out stills first** (`filmSrcIsStill`). ffprobe does answer
 * for a jpg ("one frame, 25fps, 0.04 seconds"), but none of those three numbers is real: the 25
 * would be counted in the footage frame-rate vote, and 0.04 seconds would become the block's file
 * length (the image could only be stretched to 40 milliseconds on the timeline) and be written back
 * to the asset ledger. Probing it would also require pulling the bytes back from object storage to
 * local disk first, just to obtain three fake numbers.
 */
export function filmDocMediaSrcs(doc: FilmDoc): string[] {
  const out: string[] = [];
  for (const { clip, kind } of filmDocEntries(doc)) {
    if (kind === 'mg') {
      const media = filmPublishedMgMediaSrc(clip.src);
      if (media && !out.includes(media)) out.push(media);
      continue;
    }
    if (kind === 'video') {
      if (!out.includes(clip.src)) out.push(clip.src);
      continue;
    }
    if (kind === 'audio') {
      if (!filmSrcIsScore(clip.src) && filmRefLooksLikePath(clip.src) && !out.includes(clip.src)) out.push(clip.src);
    }
  }
  return out;
}
