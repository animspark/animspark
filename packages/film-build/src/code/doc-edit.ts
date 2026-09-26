/**
 * Write timeline edits back to `film.json`.
 *
 * Location tokens are `film.json#track.clip`. Every edit passes the schema before it is written.
 *
 * ## Freezing references
 *
 * An `at` in the doc can be a reference (`"sc-02.end"`, `"vo@[pours] + 0.05"`; see film-ref.ts in
 * core); while it is live, it moves whenever the referenced clip moves. When the user changes clip
 * X's timing on the timeline (drag, trim, split, delete), we first convert **the references
 * connected to X** into their pre-gesture numbers — X's own `at` and every `at` that references X
 * — and then apply the gesture. So only X moves and no other clip shifts: it feels exactly like a
 * doc of plain numbers.
 *
 * The numbers come from the caller (`DocBake.resolved`): the browser's evaluated projection, with
 * each clip's absolute start. Without them the references stay live — the only honest option when
 * the numbers aren't available, and the UI can always provide them.
 *
 * References in code (a component's `duration`, `at('…')`) aren't handled here: that is source
 * code, rewritten on the server (see the code-ref bake in the engine). This file only handles the
 * doc.
 */

import {
  filmClipIdFor,
  filmClipTrim,
  filmDocEntries,
  filmGainDbToVolume,
  filmRefTargetId,
  filmTimeWrite,
  mintFilmClipId,
  parseFilmDoc,
  parseFilmDocLoc,
  serializeFilmDoc,
  type FilmClip,
  type FilmClipKind,
  type FilmDoc,
} from '@animspark/core/film';

import { FilmCliError } from '../cli-error';

import { coerceTimePropValue, type PropEdit, type SplitEdit } from './edit-types';

export type { PropEdit, SplitEdit };

type RawClip = Record<string, unknown>;

const DROPPED_PROPS = new Set([
  'silent', 'link', 'fadeIn', 'fadeOut', 'captions', 'cast', 'lineGap', 'attack', 'duck',
]);

function docOf(text: string): FilmDoc {
  try {
    return parseFilmDoc(text);
  } catch (e) {
    throw new FilmCliError(
      `the film.json on disk is not valid to begin with, so the timeline's edits have nowhere to land:\n${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function clipAt(doc: FilmDoc, loc: string): {
  trackIndex: number;
  clipIndex: number;
  clip: RawClip;
  kind: FilmClipKind;
} {
  const parsed = parseFilmDocLoc(loc);
  if (parsed == null) throw new FilmCliError(`unrecognised location: ${loc}`);
  const track = doc.tracks[parsed.track];
  if (!track) {
    throw new FilmCliError(`${loc}: the film has no track ${parsed.track} (there are ${doc.tracks.length}).`);
  }
  const clip = track.clips[parsed.clip];
  if (!clip) {
    throw new FilmCliError(
      `${loc}: track ${parsed.track} has no clip ${parsed.clip} (there are ${track.clips.length}).`,
    );
  }
  return {
    trackIndex: parsed.track,
    clipIndex: parsed.clip,
    clip: clip as unknown as RawClip,
    kind: track.kind,
  };
}

function serialize(doc: FilmDoc): string {
  return serializeFilmDoc(doc);
}

/** Each clip's absolute start (seconds) before the gesture, by clip id. This is the timeline's projection. */
export interface DocBake {
  resolved: Readonly<Record<string, { atSec: number }>>;
}

/** Doc props that change a clip's timing. Touching any of them counts as a gesture. */
const TIME_GESTURE_PROPS = new Set(['at', 'start', 'end']);

function snap3(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

/**
 * Convert the references connected to these clips into numbers: their own `at` (they are now
 * placed by hand) and every `at` that references them. Returns what was converted (for receipts /
 * logs). A clip with no number at hand stays live — nothing is made up.
 */
function bakeRefsAround(doc: FilmDoc, ids: Iterable<string>, bake: DocBake | undefined): string[] {
  if (!bake) return [];
  const touched = new Set(ids);
  const baked: string[] = [];
  for (const { clip } of filmDocEntries(doc)) {
    const at = (clip as RawClip).at;
    if (typeof at !== 'string') continue;
    const target = filmRefTargetId(at);
    if (!touched.has(clip.id) && !(target != null && touched.has(target))) continue;
    const sec = bake.resolved[clip.id]?.atSec;
    if (sec == null || !Number.isFinite(sec)) continue;
    (clip as RawClip).at = snap3(sec);
    baked.push(`${clip.id}: at "${at}" → ${snap3(sec)}`);
  }
  return baked;
}

function usedIds(doc: FilmDoc): Set<string> {
  return new Set(
    filmDocEntries(doc).map((e) => e.clip.id).filter((id): id is string => Boolean(id)),
  );
}

function setField(
  clip: RawClip,
  prop: string,
  value: PropEdit['value'],
): void {
  /* Moving to another track / reordering changes the tracks array, not a field on the clip.
     Writing it into the clip fails the schema (unknown field: track), which breaks as soon as a
     drop creates a new track. */
  if (prop === 'track' || prop === 'trackOrder' || prop === 'locked' || prop === 'hidden' || prop === 'muted') {
    return;
  }
  if (DROPPED_PROPS.has(prop)) {
    delete clip[prop];
    return;
  }
  if (prop === 'start' || prop === 'end') {
    const cur = filmClipTrim(clip as { time?: [number] | [number, number] });
    if (prop === 'start') cur.start = value === null ? 0 : Number(value);
    else if (value === null) delete cur.end;
    else cur.end = Number(value);
    const time = filmTimeWrite(cur.start, cur.end);
    if (time) clip.time = time;
    else delete clip.time;
    return;
  }
  if (prop === 'volume') {
    if (value === null || value === 1) delete clip.volume;
    else clip.volume = value;
    return;
  }
  if (prop === 'gainDb') {
    if (value === null) delete clip.volume;
    else if (typeof value === 'number') {
      const volume = filmGainDbToVolume(value);
      if (volume === 1) delete clip.volume;
      else clip.volume = volume;
    }
    return;
  }
  if (value === null) {
    delete clip[prop];
    return;
  }
  clip[prop] = value;
}

export interface DocEditResult {
  text: string;
  /** Which references this gesture converted into numbers. `"id: at \"sc-02.end\" → 13.411"`. */
  unlinked: string[];
}

type DocTrack = FilmDoc['tracks'][number];

/**
 * Move each clip in this batch to its target track, or open a new track of the same kind at the
 * given index and put it there.
 *
 * ## Why the whole batch moves together instead of one edit at a time
 *
 * A location token is "track n . clip m". After moving the first clip, the locs of the remaining
 * edits are all off — the source track lost a clip, and an emptied row gets removed, shifting every
 * track below it. The one-at-a-time version, when a marquee-selected group was moved up or down
 * together, sent the second clip somewhere unexpected, and **silently**: the shifted loc still
 * resolves to a clip, just not the one the user dragged.
 *
 * So first resolve every clip and its destination to object references against the **original**
 * doc, then act — object references don't care about indices shifting. This also removes the old
 * manual correction of "decrement the target index when a track was emptied".
 *
 * Order: detach all → drop into existing tracks → insert new tracks (rows haven't been removed yet,
 * so the anchor's index is still its original one) → finally remove emptied rows. Removing rows
 * last is required: a track may both send one clip away and receive another, so it was never empty
 * at any moment.
 */
function moveClipsToTracks(doc: FilmDoc, edits: readonly PropEdit[]): void {
  interface Step {
    kind: FilmClipKind;
    from: DocTrack;
    clip: DocTrack['clips'][number];
    /** The existing track to drop into. Absent when opening a new track. */
    to?: DocTrack;
    /** Open a new track **before this one**. Absent = at the end. */
    before?: DocTrack;
    insert: boolean;
  }
  const plan: Step[] = [];
  for (const edit of edits) {
    const { trackIndex, clipIndex, kind } = clipAt(doc, edit.loc);
    const dest = edit.value;
    const insertAt = dest && typeof dest === 'object' && !Array.isArray(dest) && typeof dest.insert === 'number'
      ? dest.insert
      : null;
    const destIndex = typeof dest === 'number' ? dest : null;
    if (insertAt == null && destIndex == null) {
      throw new FilmCliError(`${edit.loc}: track has to be the index of the track to land on, or { insert: index } to open a new one.`);
    }
    const from = doc.tracks[trackIndex]!;
    const clip = from.clips[clipIndex]!;
    if (insertAt == null) {
      if (destIndex === trackIndex) continue;
      const to = doc.tracks[destIndex!];
      if (!to) {
        throw new FilmCliError(`${edit.loc}: there is no track ${destIndex} (there are ${doc.tracks.length}).`);
      }
      if (to.kind !== kind) {
        throw new FilmCliError(
          `${edit.loc}: this is a ${kind} clip and track ${destIndex} is ${to.kind} — a clip only lands on a track of its own kind.`,
        );
      }
      plan.push({ kind, from, clip, to, insert: false });
      continue;
    }
    plan.push({
      kind,
      from,
      clip,
      insert: true,
      ...(doc.tracks[insertAt] ? { before: doc.tracks[insertAt]! } : {}),
    });
  }

  /* Everything that should be rejected has been rejected above. If one edit in a batch doesn't
     hold, nothing moves — leaving a film half moved would take the user several undos to get back
     from, after making a single gesture. */
  for (const step of plan) {
    const at = step.from.clips.indexOf(step.clip);
    if (at >= 0) step.from.clips.splice(at, 1);
  }
  for (const step of plan) {
    if (step.to) step.to.clips.push(step.clip);
  }
  for (const step of plan) {
    if (!step.insert) continue;
    const before = step.before ? doc.tracks.indexOf(step.before) : -1;
    /* The new row takes the source track's kind — the row type is the kind, and a moved clip
       keeps it. No track name is needed: it is computed from position and kind (see
       filmTrackBadges), and the tracks above get renumbered by this insert. */
    doc.tracks.splice(before >= 0 ? before : doc.tracks.length, 0, { kind: step.kind, clips: [step.clip] });
  }
  for (const step of plan) {
    if (step.from.clips.length) continue;
    const at = doc.tracks.indexOf(step.from);
    if (at >= 0) doc.tracks.splice(at, 1);
  }
}

const TRACK_FLAGS = new Set(['locked', 'hidden', 'muted']);

function setTrackFlag(doc: FilmDoc, loc: string, prop: string, value: PropEdit['value']): void {
  const { trackIndex } = clipAt(doc, loc);
  const track = doc.tracks[trackIndex] as FilmDoc['tracks'][number] & Record<string, unknown>;
  if (!track) return;
  if (value === true) track[prop] = true;
  else delete track[prop];
}

/** Move a whole track. The index is the doc's; rows split out into layers share one index. */
function reorderTracks(doc: FilmDoc, dest: PropEdit['value']): void {
  if (!dest || typeof dest !== 'object' || Array.isArray(dest)) {
    throw new FilmCliError('trackOrder has to be two indices: { from, to }.');
  }
  const from = (dest as { from?: unknown }).from;
  const to = (dest as { to?: unknown }).to;
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to)) {
    throw new FilmCliError('trackOrder has to be two indices: { from, to }.');
  }
  if (!doc.tracks[from]) {
    throw new FilmCliError(`trackOrder: there is no track ${from} (there are ${doc.tracks.length}).`);
  }
  if (from === to) return;
  const clamped = Math.max(0, Math.min(doc.tracks.length - 1, to));
  const [taken] = doc.tracks.splice(from, 1);
  if (!taken) return;
  doc.tracks.splice(clamped, 0, taken);
}

export function applyFilmDocEdits(text: string, edits: readonly PropEdit[], bake?: DocBake): DocEditResult {
  const doc = docOf(text);
  const fields = edits.filter((e) => e.prop !== 'track' && e.prop !== 'trackOrder' && !TRACK_FLAGS.has(e.prop));
  const flags = edits.filter((e) => TRACK_FLAGS.has(e.prop));
  const moves = edits.filter((e) => e.prop === 'track');
  const orders = edits.filter((e) => e.prop === 'trackOrder');
  /* Clips whose timing changed: freeze their connected references first, then edit. Track moves, volume and the like don't touch timing and freeze nothing. */
  const gestured = fields
    .filter((e) => TIME_GESTURE_PROPS.has(e.prop))
    .map((e) => clipAt(doc, e.loc).clip.id as string);
  const unlinked = bakeRefsAround(doc, gestured, bake);
  /* Change at / to first, then move tracks using the original locs — moving first would make
     the track.clip in each loc point at the wrong clip. The move step handles the whole batch at
     once (see moveClipsToTracks) for the same reason: by the time the second clip moves, the first
     has already shuffled the indices. Whole-track reordering goes last: it changes the indices
     themselves. */
  for (const edit of fields) {
    const { clip } = clipAt(doc, edit.loc);
    setField(clip, edit.prop, coerceTimePropValue(edit.prop, edit.value));
  }
  for (const edit of flags) {
    setTrackFlag(doc, edit.loc, edit.prop, edit.value);
  }
  moveClipsToTracks(doc, moves);
  for (const edit of orders) {
    reorderTracks(doc, edit.value);
  }
  /* An earlier version may have written track into the clip, and it may still be on disk. Strip it before writing so the doc doesn't fail to compile. */
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      delete (clip as RawClip).track;
      delete (clip as RawClip).trackOrder;
      delete (clip as RawClip).locked;
      delete (clip as RawClip).hidden;
      delete (clip as RawClip).muted;
    }
  }
  return { text: serialize(doc), unlinked };
}

export function removeFilmDocClip(text: string, loc: string, bake?: DocBake): string {
  const doc = docOf(text);
  const { trackIndex, clipIndex, clip } = clipAt(doc, loc);
  /* Freeze references to it before deleting — afterwards they would dangle, and deleting one clip shouldn't make other clips error out or jump around. */
  bakeRefsAround(doc, [clip.id as string], bake);
  const track = doc.tracks[trackIndex]!;
  track.clips.splice(clipIndex, 1);
  /* Deleting the last clip removes the track too — empty tracks take no row (as in CapCut). The
     move path (moveClipToTrack) always did this; the delete path used to miss it: after deleting
     everything, the doc kept a few `clips: []` rows and the timeline showed dead tracks forever. */
  if (track.clips.length === 0) doc.tracks.splice(trackIndex, 1);
  return serialize(doc);
}

export function splitFilmDocClip(text: string, edit: SplitEdit, bake?: DocBake): string {
  const doc = docOf(text);
  const { trackIndex, clipIndex, clip } = clipAt(doc, edit.loc);
  /* Splitting is a gesture too: freeze its own at and references to it. The right half is a new clip; nothing references it yet. */
  bakeRefsAround(doc, [clip.id as string], bake);
  /* Deep copy — with a shallow copy both halves share one `transform` object. Dragging the left
     half on the stage after a split would move the right half too: the two clips are no longer
     two, and nothing in the UI shows it. */
  const left = JSON.parse(JSON.stringify(clip)) as RawClip;
  const right = JSON.parse(JSON.stringify(clip)) as RawClip;
  right.id = mintFilmClipId(usedIds(doc), typeof clip.id === 'string' ? clip.id : undefined);
  for (const [prop, value] of Object.entries(edit.left)) {
    setField(left, prop, coerceTimePropValue(prop, value));
  }
  for (const [prop, value] of Object.entries(edit.right)) {
    setField(right, prop, coerceTimePropValue(prop, value));
  }
  doc.tracks[trackIndex]!.clips.splice(
    clipIndex,
    1,
    left as unknown as FilmClip,
    right as unknown as FilmClip,
  );
  return serialize(doc);
}

export interface DocInsertEdit {
  /** A JSON string — insert a brand-new clip (written by the agent, or brought from elsewhere). */
  element?: string;
  /**
   * The clip's kind.
   *
   * The clip itself doesn't say — the kind is the track type, and at this point it hasn't landed on
   * any track. `from` (copy an existing clip) and `after` (insert after a clip) carry the answer;
   * only a from-scratch `element` needs to be told.
   */
  kind?: FilmClipKind;
  /**
   * Or copy an existing clip in the doc: its location.
   *
   * Paste uses this instead of having the frontend assemble an `element`: the clip on the timeline
   * is an evaluated **projection** and can't be turned back into the original — the timeline has
   * no idea which component an MG uses or what props it passes (it only has a title). Copying the
   * one on disk loses not a single field.
   */
  from?: string;
  /** Where it lands (absolute seconds). A copy needs its own position, otherwise the two clips sit exactly on top of each other. */
  at?: number;
  after?: string;
  /**
   * Which track it lands on: an index = put it in that existing track, `{ insert: index }` = open
   * a new track there.
   *
   * Dragging media onto the timeline has to name a track: if the drop range is already occupied,
   * the clip may not overlap it (overlaps spread into two rows sharing one number), so a new track
   * has to be opened on the spot — which "use the last track of the same kind" can't express.
   * When given together with `after`, `after` wins (it fixes both track and position).
   */
  track?: number | { insert: number };
}

/**
 * Copy a clip.
 *
 * `id` isn't carried over (with duplicates the film can't tell which is which).
 * Every other field stays as is — a copy must look exactly like the original; that is all copying means.
 */
function cloneClip(clip: RawClip): RawClip {
  const out = JSON.parse(JSON.stringify(clip)) as RawClip;
  delete out.id;
  delete out.link;
  delete out.group;
  delete out.label;
  delete out.z;
  return out;
}

/* An earlier version had a `new Function` fallback here, because inserted clips could contain
   `(t) =>`. Now that the doc is plain data there is no such thing, and one less place that executes
   foreign strings comes for free. */
function parseInsertElement(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new FilmCliError(
      `a clip going into the film has to be a JSON object: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function insertFilmDocClip(text: string, edit: DocInsertEdit): string {
  const doc = docOf(text);
  const clip = (edit.from != null
    ? cloneClip(clipAt(doc, edit.from).clip)
    : parseInsertElement(edit.element ?? '')) as RawClip;
  /* The kind is whatever track it lands on. A copy follows the source track, an insert-after follows that clip's track; only with neither do we ask for kind. */
  const kind = edit.from != null
    ? clipAt(doc, edit.from).kind
    : edit.after != null
      ? clipAt(doc, edit.after).kind
      : edit.kind;
  if (!kind) {
    throw new FilmCliError(
      'a clip going into the film needs a kind (mg / video / audio) —'
      + ' the kind is the track it lands on, and the clip itself does not say.',
    );
  }
  if (typeof clip.src !== 'string' || !clip.src) {
    throw new FilmCliError('a clip going into the film needs src — the thing it points at.');
  }
  if (edit.at != null) clip.at = Math.round(edit.at * 1000) / 1000;
  if (typeof clip.id !== 'string' || !clip.id) {
    clip.id = filmClipIdFor(clip.src, usedIds(doc));
  }
  if (edit.after != null) {
    const { trackIndex, clipIndex } = clipAt(doc, edit.after);
    doc.tracks[trackIndex]!.clips.splice(clipIndex + 1, 0, clip as FilmClip);
  } else if (edit.track != null && typeof edit.track === 'object' && !Array.isArray(edit.track)) {
    /* Open a new track at the given index — used when dropping between tracks or onto an occupied spot. */
    const at = Math.max(0, Math.min(doc.tracks.length, Math.trunc(edit.track.insert)));
    doc.tracks.splice(at, 0, { kind, clips: [clip as FilmClip] });
  } else if (typeof edit.track === 'number') {
    const track = doc.tracks[edit.track];
    if (!track) {
      throw new FilmCliError(`insert: there is no track ${edit.track} (there are ${doc.tracks.length}).`);
    }
    if (track.kind !== kind) {
      throw new FilmCliError(
        `insert: this is a ${kind} clip and track ${edit.track} is ${track.kind} — a clip only lands on a track of its own kind.`,
      );
    }
    track.clips.push(clip as FilmClip);
  } else {
    /* Automatic placement follows the convention: the last track of the same kind. If there is none, open a new row. */
    const track = [...doc.tracks].reverse().find((t) => t.kind === kind);
    if (track) {
      track.clips.push(clip as FilmClip);
    } else {
      doc.tracks.push({ kind, clips: [clip as FilmClip] });
    }
  }
  return serialize(doc);
}
