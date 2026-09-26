/**
 * Interprets `film.json` - the film doc goes in, a tree that renders and registers comes out.
 *
 *   - **resolveFilmDoc**: gathers each clip's own length (MG reads the `time` end or a legacy
 *     component `duration`; audio and footage read the file; the asset index fills in words /
 *     attack by path), hands the references in `at` and `duration` to core's resolveFilmRefs to
 *     turn them into numbers (see film-ref.ts), then places the clips.
 *   - **FilmDocClips**: opens a window per entry, mounts MGs, places sounds. Registration goes
 *     through the same sink as `<Tracks>`.
 */

import * as React from 'react';

import {
  filmAudioRoleOf,
  filmClipTrim,
  filmDocEntries,
  filmDocLoc,
  filmPublishedMgMediaSrc,
  filmRefLooksLikePath,
  filmSrcIsStill,
  filmSrcIsScore,
  filmVolumeMuted,
  filmVolumeToGainDb,
  parseFilmDocValue,
  resolveFilmRefs,
  type FilmClip,
  type FilmClipKind,
  type FilmDoc,
  type FilmMgClip,
  type FilmOverride,
  type FilmRefNode,
  type FilmRefPlaced,
  type FilmTrackKind,
  type FilmTransform,
  type FilmVideoClip,
  type SpokenSource,
} from '@animspark/core/film';

import { wordStartSec } from '@animspark/core/film';
import { planMgSoundClips, type PlannedMgSound } from './mg-sounds';
import { MgCompositionContext } from './mg-context';
import { FilmSubtitlesContext, useRegisterSpokenCaptions } from './captions';
import { applyElementOverrides, restoreWipedOverrides } from './element-overrides';
import { filmContainBox, filmLayerStyle, filmMgLayerStyle, filmPaintedBox, hasLayerTransform } from './layer';
import { Still, Video } from './media';
import { PreparedMgSurface, type FilmPreparedMgProject } from './mg-project';
import { FilmClipIdContext, type FilmRefTable } from './refs';
import { toMs } from './sec';
import { Music, Vo, Sfx, type SoundAsset } from './sound';
import type { SpokenWord } from './spoken';
import {
  ClipMetaInfo,
  ClipSoundInfo,
  ClockPin,
  TrackInfo,
  Window,
  useCollecting,
  useFilmTimeMs,
  useHonorHide,
  useRegisterScene,
  useRegisterSound,
  useStage,
  useWindowShows,
  useSpanMs,
  useSpanStartMs,
  type ClipMeta,
  type FilmClipCue,
  type FilmTrackRef,
} from './stage';

export interface FilmAssetEntry {
  src: string;
  title?: string;
  /** What this entry is. The index holds every kind of asset; only ones that make sound use the fields below. */
  kind?: 'audio' | 'video' | 'image' | 'font' | 'mg' | 'file';
  /** The asset's own length, in **seconds**. All times in the index are seconds (see asset-index in film-build). */
  dur?: number;
  w?: number;
  h?: number;
  text?: string;
  words?: readonly SpokenWord[];
  /** Caption lines translated by the host: language -> lines (source seconds). Used when captions switch to that language (see captions.ts). */
  translations?: Readonly<Record<string, readonly { startSec: number; endSec: number; text: string }[]>>;
  /** Who is speaking - a label from the index's `cast` roster. */
  cast?: string;
  /** The second in the file where "the hit" lands. */
  attack?: number;
}

/**
 * Path -> facts about that asset.
 *
 * The generated entry imports `assets/index.json` and lays it out as this table keyed by path
 * (see doc-entry in film-build). The film doc also refers to assets by path, so this is a direct
 * lookup.
 */
export type FilmAssetIndex = Record<string, FilmAssetEntry>;

/**
 * Asset index + word index -> one table.
 *
 * On disk these are two files (see `ASSET_WORDS_PATH` in film-build for why), but **film code
 * shouldn't know that** - `assets[src].words` still works and `<Captions src={take}>` still gets
 * the whole entry. The split is bookkeeping, not API, so the merge lives in the bundle entry and
 * nowhere else.
 */
export function filmAssetsWithWords(
  index: FilmAssetIndex,
  words: Record<string, readonly SpokenWord[]> | undefined,
): FilmAssetIndex {
  if (!words) return index;
  const out: FilmAssetIndex = { ...index };
  for (const [src, said] of Object.entries(words)) {
    // Only fill in existing assets. When the word index has orphans (asset deleted), conjuring an asset with no src would be worse.
    if (out[src] && said?.length) out[src] = { ...out[src], words: said };
  }
  return out;
}

/** File path -> seconds. For footage, and for directly linked audio that has no length in the asset index. */
export type FilmMediaIndex = Record<string, number>;

/**
 * A plain React module. The clip's `time: [start, end]` gives the time range it uses; no static
 * property is needed. A legacy component `duration` is still accepted: seconds or a reference
 * (`'03-generate.dur + 0.6'`, grammar in core's film-ref.ts).
 */
export type FilmMgModule = React.ComponentType<Record<string, unknown>> & {
  duration?: number | string;
  /** Named export from the TSX module; independent of React render and frame. */
  sounds?: unknown;
};
/** Workspace source path → MG component and its declarations. */
export type FilmMgModules = Record<string, FilmMgModule | undefined>;

export interface FilmDocResolveOpts {
  audio?: FilmAssetIndex;
  mg?: FilmMgModules;
  media?: FilmMediaIndex;
  projects?: Record<string, FilmPreparedMgProject>;
  /**
   * Set when previewing a single MG in the asset library: the clips it references aren't in this
   * doc, so `at()` returns 0 with a warning and `duration` references fall back to a preview
   * length. **Not** set for the final film or the whole film while editing - there an unresolved
   * reference is an error.
   */
  lenientRefs?: boolean;
}

export type { FilmClipCue };

export interface PlacedFilmClip {
  clip: FilmClip;
  kind: FilmClipKind;
  trackIndex: number;
  clipIndex: number;
  loc: string;
  label: string;
  timeless: boolean;
  /** Absolute start in the film (ms). Once resolved, `at` is an absolute time, so the base is always 0. */
  baseMs: number;
  atMs: number;
  durMs: number;
  fromMs?: number;
  /** The doc's raw `at` text, present only when it's a reference. */
  atRef?: string;
  /** The component's raw `duration` text, present only when it's a reference. */
  durRef?: string;
  /** The element's own length (s). Registered so the timeline can clamp edge drags. */
  nativeSec?: number;
  /** The asset's own frame size (footage). The clip's size on stage is computed from this, not from the canvas. */
  nativeBox?: { w: number; h: number };
  track: FilmTrackRef & { kind: FilmTrackKind };
  assets?: readonly SoundAsset[];
  /** Provenance / per-word ticks. **Not used for placement** - only the timeline reads them. */
  meta?: ClipMeta;
}

/** Human-readable name for this track kind, used in the "asset not found" error. */
const SOUND_ROLE: Record<FilmClipKind, string> = {
  mg: 'MG',
  video: 'video',
  audio: 'audio',
};
const TRIM_EPS = 1e-6;

/** The only key in the asset index that isn't a path. Skipped when looking up assets. */
const ASSET_CAST_KEY = 'cast';

function soundKeys(audio: FilmAssetIndex | undefined): string[] {
  return Object.keys(audio ?? {}).filter((key) => key !== ASSET_CAST_KEY);
}

function listSrcs(audio: FilmAssetIndex | undefined): string {
  const srcs = soundKeys(audio);
  return srcs.length ? srcs.join(' · ') : '(not one)';
}

/** The name shown on the timeline: last path segment without extension. `assets/upload/b-roll.mp4` -> `b-roll`. */
function fileStem(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[a-z0-9]{1,5}$/i, '') || base;
}

/**
 * A miss is not an error, as long as it looks like a path.
 *
 * That's the case for a sound that was just placed and hasn't had `anim audio` run yet: it isn't
 * in the asset index, its length comes from the probed media, and it still renders. Treating it
 * as an error would break the "place first, generate later" order.
 */
function factsOf(
  audio: FilmAssetIndex | undefined,
  src: string,
  where: string,
  what: string,
): FilmAssetEntry {
  if (src === ASSET_CAST_KEY) {
    if (filmRefLooksLikePath(src)) return { src };
    throw new Error(`${where}: ${what} has to be a file path. On hand: ${listSrcs(audio)}.`);
  }
  const hit = audio?.[src];
  if (hit) return hit;
  if (filmRefLooksLikePath(src)) return { src };
  throw new Error(`${where}: ${what} has to be a file path. On hand: ${listSrcs(audio)}.`);
}

function entryDurSec(
  entry: FilmAssetEntry,
  media: FilmMediaIndex | undefined,
  where: string,
): number {
  if (entry.dur != null && entry.dur > 0) return entry.dur;
  const file = media?.[entry.src];
  if (file != null && file > 0) return file;
  /* Being placed in the doc doesn't mean it's on disk. The previous message said "the asset index
     or the file must tell how long this is" - the reader had to learn there is an index, then how
     it's produced, before acting. There's really only one thing to do. */
  throw new Error(
    `${where}: ${entry.src} is not there yet — neither the sound file nor its matching json turned up,`
    + ' so there is no length to measure.'
    + '\n  Run anim audio to make it; if the file is already there, check the path.',
  );
}

/** Plain React uses the clip's `time` end; a legacy component's declared duration is still authoritative for its length. */
function mgNativeSec(clip: FilmClip, mg: FilmMgModules | undefined, where: string): number | string {
  const src = clip.src;
  const component = mg?.[src];
  if (!component) throw new Error(`${where}: MG module "${src}" is not here — check the path and its default React export.`);
  const d = component.duration ?? (component as { durationSec?: unknown }).durationSec;
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return d;
  if (typeof d === 'string' && d.trim()) return d;
  if (d !== undefined) {
    throw new Error(`${where}: MG "${src}" has an invalid duration — it must be a positive number or a reference. Remove it and set time: [0, seconds] in film.json to use a plain React component.`);
  }
  const end = filmClipTrim(clip).end;
  if (typeof end === 'number' && Number.isFinite(end) && end > 0) return end;
  throw new Error(
    `${where}: MG "${src}" needs an explicit time range in film.json, e.g. "time": [0, 6].`
    + '\n  The two numbers select seconds on this React component\'s timeline; its source length is the end value.',
  );
}

/**
 * How long a still lasts - it doesn't know, so the clip must say.
 *
 * Footage has the file's own length and `time` trims a span out of it; a still is a source of
 * **infinite length**, so the two `time` numbers are its length. That way `time: [0, 8]` keeps
 * its meaning and the clip needs no new key.
 *
 * A missing value must fail right here, not get a default: an image silently holding 5 seconds
 * looks just as plausible as the 0.6 or 12 seconds the user wanted - that kind of mistake only
 * surfaces when watching the film, and by then nobody knows who chose the number.
 */
function stillNativeSec(clip: FilmClip, where: string): number {
  const end = filmClipTrim(clip).end;
  if (typeof end === 'number' && Number.isFinite(end) && end > 0) return end;
  throw new Error(
    `${where}: a still has no length of its own — say how long it stays with time, e.g. "time": [0, 4].`
    + '\n  On a video track time is a trim into the file; on a picture there is nothing to trim,'
    + ' so those two numbers are the length.',
  );
}

function videoNativeSec(src: string, media: FilmMediaIndex | undefined, where: string): number {
  const d = media?.[src];
  if (typeof d === 'number' && Number.isFinite(d) && d > 0) return d;
  /* Nine times out of ten the path is wrong - while "could not measure length" sends people off
     to debug codecs. Say both, the common cause first. */
  throw new Error(
    `${where}: no length for video "${src}" — most likely there is no file at that path`
    + ' (ls it; uploads live under assets/upload/). If the file is there, it could not be measured.',
  );
}

interface Pending {
  clip: FilmClip;
  kind: FilmClipKind;
  trackIndex: number;
  clipIndex: number;
  loc: string;
  label: string;
  timeless: boolean;
  track: FilmTrackRef & { kind: FilmTrackKind };
  assets?: readonly SoundAsset[];
  /** The element's own length (s). When a component's `duration` is a reference, this is that text until resolved. */
  native: number | string;
  /** The element's length after resolution (s). */
  nativeSec?: number;
  /** The asset's own frame size (footage). */
  nativeBox?: { w: number; h: number };
  fromMs?: number;
  durMs: number;
  /** The resolved start in the film (s). */
  startSec?: number;
}

function whereOf(p: Pending): string {
  return `tracks[${p.trackIndex}].clips[${p.clipIndex}](${p.kind})`;
}

function pendingOf(
  clip: FilmClip,
  trackIndex: number,
  clipIndex: number,
  track: FilmTrackRef & { kind: FilmTrackKind },
  opts: FilmDocResolveOpts,
): Pending {
  const kind = track.kind;
  const loc = filmDocLoc(trackIndex, clipIndex);
  const where = `tracks[${trackIndex}].clips[${clipIndex}](${kind})`;
  const shared = {
    clip,
    kind,
    trackIndex,
    clipIndex,
    loc,
    label: opts.audio?.[clip.src]?.title || fileStem(clip.src),
    timeless: kind === 'audio',
    track,
    durMs: 0,
  };

  const publishedMedia = kind === 'mg' ? filmPublishedMgMediaSrc(clip.src) : null;
  const project = kind === 'mg' ? opts.projects?.[clip.src] : undefined;
  if (project) return { ...shared, native: project.dur, nativeBox: { w: project.w, h: project.h },
    ...(project.words?.length || project.text ? { assets: [{ src: clip.src, dur: project.dur, words: project.words, text: project.text }] } : {}) };
  if (kind === 'mg' && !publishedMedia) return { ...shared, native: mgNativeSec(clip, opts.mg, where) };
  if (kind === 'video' || publishedMedia) {
    const mediaSrc = publishedMedia ?? clip.src;
    /* Frame size comes from the asset index. A miss isn't an error (just uploaded, not measured yet); the stage layer will ask the decoder. */
    const facts = opts.audio?.[clip.src] ?? opts.audio?.[mediaSrc];
    const box = facts && facts.w != null && facts.h != null && facts.w > 0 && facts.h > 0
      ? { w: facts.w, h: facts.h }
      : undefined;
    return {
      ...shared,
      native: filmSrcIsStill(mediaSrc)
        ? stillNativeSec(clip, where)
        : videoNativeSec(mediaSrc, opts.media, where),
      ...(box ? { nativeBox: box } : {}),
      /* Pass this footage's transcript and word timings from the asset index through as is - the
         captions for the footage's own audio depend on them (see media.tsx). Shares the `assets`
         slot with audio clips: both are "the index entry this clip points at", same shape. */
      ...(facts?.text || facts?.words?.length ? { assets: [{ ...facts }] } : {}),
    };
  }

  const entry = factsOf(opts.audio, clip.src, where, SOUND_ROLE[kind]);
  return { ...shared, native: entryDurSec(entry, opts.media, where), assets: [{ ...entry }] };
}

/** This clip's word list (if any) - what `@[...]` references look up. */
function spokenOf(p: Pending): SpokenSource | undefined {
  const first = p.assets?.[0];
  if (!first || typeof first === 'string' || !first.words?.length) return undefined;
  return {
    words: first.words,
    ...(first.text ? { text: first.text } : {}),
    ...(first.dur != null ? { durMs: toMs(first.dur) } : {}),
  };
}

/**
 * Turn the doc's references (`at` and component `duration`) into numbers. Errors propagate as is
 * - a mistake in the doc is an error and blocks rendering, just like "MG module not found".
 */
function resolveRefs(pending: readonly Pending[], opts: FilmDocResolveOpts): FilmRefTable {
  const spoken = new Map<string, SpokenSource>();
  const nodes: FilmRefNode[] = pending.map((p) => {
    const words = spokenOf(p);
    if (words) spoken.set(p.clip.id, words);
    return {
      id: p.clip.id,
      at: p.clip.at,
      time: p.clip.time,
      native: p.native,
      ...(words ? { words } : {}),
    };
  });
  let placed: Map<string, FilmRefPlaced>;
  try {
    placed = resolveFilmRefs(nodes);
  } catch (e) {
    if (!opts.lenientRefs) throw e;
    /* Standalone preview: the referenced clips aren't in this doc. Start at 0 and use the preview fallback for referenced durations, so at least the picture renders. */
    placed = resolveFilmRefs(nodes.map((n) => ({
      ...n,
      at: typeof n.at === 'string' ? 0 : n.at,
      native: typeof n.native === 'string' ? PREVIEW_FALLBACK_SEC : n.native,
    })));
  }
  return { placed, wordsOf: (id) => spoken.get(id), lenient: Boolean(opts.lenientRefs) };
}

/** Assumed length when previewing a single MG whose `duration` is a reference. Same number as core's filmMgPreviewEntry. */
const PREVIEW_FALLBACK_SEC = 3;

function assertTrim(fromSec: number, toSec: number, nativeSec: number, where: string, holdable: boolean): void {
  if (fromSec < -TRIM_EPS) {
    throw new Error(
      `${where}: time start ${fromSec} cannot be below 0`
      + ' (time is a trim, it only lives in [0, element length]).',
    );
  }
  if (toSec + TRIM_EPS < fromSec) {
    throw new Error(`${where}: time end has to be greater than start (right now [${fromSec}, ${toSec}]).`);
  }
  /* An MG may run past its end: it's a gsap timeline that stops on its last frame, so the extra
     part is a freeze frame. Assets (footage, audio) can't - once the file ends there's nothing to play. */
  if (!holdable && toSec > nativeSec + TRIM_EPS) {
    throw new Error(
      `${where}: time end ${toSec} is past this clip's length of ${nativeSec}`
      + ' (time is a trim, it only lives in [0, element length]).',
    );
  }
  if (fromSec > nativeSec + TRIM_EPS) {
    throw new Error(
      `${where}: time start ${fromSec} is past this clip's length of ${nativeSec}`
      + ' (time is a trim, it only lives in [0, element length]).',
    );
  }
}

/**
 * Trim to a fixed length: both `time` numbers are seconds on this clip's own timeline,
 * independent of anything else.
 *
 * An MG's end may exceed its own length (freezing on the last frame). The timeline needs exactly
 * that when stretching an MG, or when moving a whole MG whose length is a reference
 * (`duration = 'q3.end + 3.4'`): after the move the reference computes a different length, but
 * the user wants "this clip stays this long" - the timeline writes the length at that moment into
 * `time`, and this must accept it.
 */
function trimClip(p: Pending): void {
  const where = whereOf(p);
  const nativeSec = p.nativeSec;
  if (nativeSec == null) throw new Error(`${where}: no length to trim against.`);
  const trim = filmClipTrim(p.clip);
  const fromSec = trim.start;
  const toSec = trim.end ?? nativeSec;
  assertTrim(fromSec, toSec, nativeSec, where, p.kind === 'mg' && !filmPublishedMgMediaSrc(p.clip.src));
  p.fromMs = toMs(fromSec);
  p.durMs = toMs(toSec - fromSec);
}

/**
 * The millisecond (on the clip's own timeline) at which each word in a narration clip lands.
 *
 * Accumulated the same way as `anim audio time` (chaining by each asset's own length) - the ticks
 * drawn on the timeline must match the number the agent queried and wrote into the doc.
 */
function cuesOf(assets: readonly SoundAsset[] | undefined): FilmClipCue[] {
  const out: FilmClipCue[] = [];
  let offsetSec = 0;
  for (const line of assets ?? []) {
    if (typeof line === 'string') continue;
    const words = line.words ?? [];
    for (const w of words) out.push({ word: w.token, tMs: toMs(offsetSec + wordStartSec(w)) });
    offsetSec += line.dur ?? (words.length ? wordStartSec(words[words.length - 1]!) : 0);
  }
  return out;
}

export function resolveFilmDoc(doc: FilmDoc, opts: FilmDocResolveOpts = {}): PlacedFilmClip[] {
  return resolveFilmDocWithRefs(doc, opts).placed;
}

/** Placement + reference table. `FilmDocClips` needs the latter for `at()` in components (via useTimeline). */
export function resolveFilmDocWithRefs(
  doc: FilmDoc,
  opts: FilmDocResolveOpts = {},
): { placed: PlacedFilmClip[]; refs: FilmRefTable } {
  const pending = filmDocEntries(doc).map((e) => pendingOf(e.clip, e.trackIndex, e.clipIndex, {
    index: e.trackIndex,
    /* A row's identity is its kind. The timeline header also needs a name, so the kind stands in. */
    name: e.track.kind,
    kind: e.track.kind,
    ...(e.track.hidden ? { hidden: true } : {}),
    ...(e.track.muted ? { muted: true } : {}),
    ...(e.track.locked ? { locked: true } : {}),
  }, opts));

  const refs = resolveRefs(pending, opts);
  for (const p of pending) {
    const hit = refs.placed.get(p.clip.id)!;
    p.nativeSec = hit.nativeSec;
    p.startSec = hit.startSec;
    trimClip(p);
  }

  const cueTable = new Map<Pending, FilmClipCue[]>();
  for (const p of pending) {
    /* Only voice has per-word ticks: SFX / music have no word list in the index, so the result would be empty anyway. */
    if (p.kind === 'audio' && filmAudioRoleOf(p.clip.src) === 'voice') {
      cueTable.set(p, cuesOf(p.assets));
    }
  }

  const placed = pending.map((p): PlacedFilmClip => {
    const cues = cueTable.get(p);
    const hit = refs.placed.get(p.clip.id)!;
    const meta: ClipMeta = {
      ...(cues?.length ? { cues } : {}),
      ...(hit.atRef ? { atRef: hit.atRef } : {}),
      ...(hit.durRef ? { durRef: hit.durRef } : {}),
    };
    return {
      clip: p.clip,
      kind: p.kind,
      trackIndex: p.trackIndex,
      clipIndex: p.clipIndex,
      loc: p.loc,
      label: p.label,
      timeless: p.timeless,
      track: p.track,
      assets: p.assets,
      fromMs: p.fromMs,
      nativeSec: p.nativeSec,
      ...(p.nativeBox ? { nativeBox: p.nativeBox } : {}),
      durMs: p.durMs,
      baseMs: 0,
      atMs: toMs(p.startSec ?? 0),
      ...(hit.atRef ? { atRef: hit.atRef } : {}),
      ...(hit.durRef ? { durRef: hit.durRef } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    };
  });
  return { placed, refs };
}

/**
 * The layer for a picture clip: once the clip's natural size is known, fit it into one box per
 * the film.json transform.
 *
 * An MG's natural size must be measured (the component sets its own width/height). Until then it
 * fills the canvas (same path as footage), and shrinks once measured - useLayoutEffect finishes
 * before paint, so the user never sees the full-canvas frame. The root is position:absolute, so
 * the parent must have a size before measuring.
 *
 * Footage's natural size is **the asset's own frame size**, not the canvas: portrait footage in a
 * landscape canvas only has picture in the middle strip. The caller passes `frame` (the canvas)
 * and a known `natural` (asset size, from the asset index), and this contains one in the other to
 * get that strip. When the index doesn't have it (just uploaded, not measured) it falls back to
 * the `videoWidth/Height` the `<video>` reports - always correct, it just waits for metadata.
 *
 * Video goes through this layer (instead of the bare div it used to) for two reasons: the stage
 * selection layer recognizes exactly these `data-film-*` markers plus the geometry "outer box
 * rotates about its center, inner layer scales from the top-left". With video and MG sharing it,
 * the drag preview and the redraw after saving don't disagree by half a rotation origin.
 */
function MgClipLayer({
  loc,
  clipId,
  layer,
  kind = 'mg',
  frame,
  natural,
  overrides,
  children,
}: {
  loc: string;
  clipId: string;
  layer?: FilmTransform;
  /** Geometry tweaks a person made in the editor to layers inside this clip (see element-overrides). */
  overrides?: readonly FilmOverride[];
  kind?: FilmClipKind;
  /** The canvas. Footage needs it to compute where it lands after contain; MG doesn't pass it. */
  frame?: { w: number; h: number };
  /** The asset's own frame size (w/h from the asset index). Measured if not passed. */
  natural?: { w: number; h: number } | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const stageBox = useStage();
  const [measured, setMeasured] = React.useState<{ w: number; h: number } | null>(null);
  /**
   * Where on the canvas this clip's painted area sits - the clip's origin.
   *
   * Without it, an MG whose root is shrunk to its content size (the style the manual asks for)
   * is misaligned in the editor: the box's **size** follows the measured box but its **position**
   * only follows `transform.t`, so the content is mid-frame while the box is at the top-left.
   * A full-canvas root is the only self-consistent case of that geometry - which is exactly why
   * every MG drifted to full canvas.
   *
   * What's measured is the union of the root and its descendants (see filmPaintedBox), so when
   * children overflow the root this origin **falls outside the root's top-left**. It and
   * `measured` must come from the same measurement; taking them separately gives a box that's off
   * by one step.
   */
  const [rootAt, setRootAt] = React.useState<{ x: number; y: number } | null>(null);

  /*
   * Apply overrides to nodes. Nodes mount and unmount over time (conditional rendering, a `.map`
   * changing length), so re-apply whenever a new node mounts in this clip; also re-apply when the
   * overrides themselves change (a drag in the editor pushes a new doc) - nodes no longer targeted
   * get those three properties removed. With no overrides, not even the observer is attached:
   * the vast majority of films have none.
   */
  const overridden = React.useRef<Set<HTMLElement>>(new Set());
  React.useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    /* Also watch the style of the targeted nodes themselves: when GSAP clears transforms it also
       writes those three override properties to none (see restoreWipedOverrides in
       element-overrides), and without restoring them moved things jump back. Only those nodes are
       watched, not the whole subtree - during playback GSAP writes styles on many nodes every frame. */
    let styles: MutationObserver | null = null;
    const watch = () => {
      styles ??= new MutationObserver(() => { restoreWipedOverrides(overridden.current); });
      styles.disconnect();
      for (const node of overridden.current) styles.observe(node, { attributes: true, attributeFilter: ['style'] });
    };
    const run = () => {
      overridden.current = applyElementOverrides(root, overrides, overridden.current);
      if (overrides?.length) watch();
    };
    run();
    if (!overrides?.length) return undefined;
    const ob = new MutationObserver((records) => {
      if (records.some((record) => record.addedNodes.length > 0)) run();
    });
    ob.observe(root, { childList: true, subtree: true });
    return () => {
      ob.disconnect();
      styles?.disconnect();
    };
  }, [overrides]);

  React.useLayoutEffect(() => {
    const inner = ref.current?.querySelector(':scope > [data-film-mg-inner] > *') as HTMLElement | null;
    if (!inner) return;
    /* For MG we measure "the painted area", not the root's own box - children often overflow the
       root (see filmPaintedBox). The union's origin can lie outside the root's top-left, so position
       and size must both come from it, not from two different places. */
    const paint = frame ? null : filmPaintedBox(inner);
    if (paint) {
      /* The offset is measured relative to the inner layer, which is exactly the canvas cell (see
         `canvas` in filmMgLayerStyle). On the transformed path the inner layer has already been
         shifted back by one origin, so this number is the same on both paths and doesn't feed back.
         An <svg> root has no offsetLeft/Top (reads undefined), so use 0 - the manual requires an
         absolutely positioned root, so its origin is the wrapper's. If any value isn't finite, don't
         set state: NaN !== NaN, so this effect would setState on every render, React #185, and the
         whole clip goes blank. */
      const at = { x: (inner.offsetLeft ?? 0) + paint.x, y: (inner.offsetTop ?? 0) + paint.y };
      if (Number.isFinite(at.x) && Number.isFinite(at.y)) {
        setRootAt((cur) => (cur && cur.x === at.x && cur.y === at.y ? cur : at));
      }
    }
    if (natural) return;
    /* For footage we measure the original frame size the decoder reports, not how large it's
       stretched on the page - that would be the canvas, the very wrong answer this whole block is
       escaping. Before metadata arrives videoWidth is 0; wait for the next frame. Stills likewise,
       except the number is naturalWidth and "not yet" means the image hasn't decoded. */
    const media = frame
      ? (inner instanceof HTMLVideoElement || inner instanceof HTMLImageElement ? inner : null)
      : null;
    const w = media
      ? (media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth)
      : (paint?.w ?? inner.offsetWidth);
    const h = media
      ? (media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight)
      : (paint?.h ?? inner.offsetHeight);
    if (!(w > 0 && h > 0)) return;
    setMeasured((cur) => (cur && cur.w === w && cur.h === h ? cur : { w, h }));
  });

  /* Footage: contain the asset's frame in the canvas. While neither is known, use the full canvas
     (as before) and shrink to the real strip once metadata arrives - the pixels in between were
     drawn with contain anyway, so nothing jumps. */
  const size = natural ?? measured;
  const fit = frame ? filmContainBox(size ?? frame, frame) : null;
  const box = fit ?? size;
  const origin = fit ?? rootAt ?? undefined;
  /* Footage is always placed by its box: its origin isn't the canvas top-left, which the `inset:0`
     path can't express. An MG without a transform still fills the canvas - the component lays
     itself out with its own absolute positioning, and boxing it would only get in the way. */
  const fitted = Boolean(box) && (frame != null || hasLayerTransform(layer));
  const mgStyle = fitted && box
    ? filmMgLayerStyle(layer ?? {}, box, origin, frame ? undefined : stageBox)
    : null;
  const outer = mgStyle?.outer ?? filmLayerStyle(layer);
  /* Without a transform, footage's inner layer must also fill: the <video>'s 100% needs a sized
     parent. MG doesn't - the component lays itself out absolutely, and an extra sized layer would
     only get in the way. */
  const inner = mgStyle?.inner ?? (frame ? { width: '100%', height: '100%' } : undefined);

  return (
    <div
      ref={ref}
      data-film-clip={loc}
      data-film-kind={kind}
      data-film-clip-id={clipId}
      data-film-box={box ? `${box.w}x${box.h}` : undefined}
      data-film-origin={origin ? `${origin.x}x${origin.y}` : undefined}
      data-film-transform={hasLayerTransform(layer) ? JSON.stringify(layer) : undefined}
      style={{ ...outer, pointerEvents: 'auto' }}
    >
      <div data-film-mg-inner style={inner}>
        {children}
      </div>
    </div>
  );
}

/* Video segments mount early and unmount late: between entering the DOM and painting its first
   frame a <video> has to decode, so mounting right at the entry time flashes black at the seam
   (especially after a cut - the new segment first has to seek into the middle of the file).
   Mounting this many ms early, hidden and pinned on its first frame to buffer, means the frame is
   already in the decoder when it appears; unmounting late leaves room for scrubbing back and forth
   / loop jumps. MG doesn't need this: the GSAP tree paints synchronously. */
const VIDEO_WARM_MS = 1200;
const VIDEO_COOL_MS = 300;

interface DocWindowProps {
  placed: PlacedFilmClip;
  mg: FilmMgModules;
  projects?: Record<string, FilmPreparedMgProject> | undefined;
  audio?: FilmAssetIndex | undefined;
}

/**
 * The "gate" of a picture clip: the only part that reads the clock.
 *
 * During playback the time changes every frame, and every component reading TimeContext
 * re-renders every frame. The whole clip (registration, styles, content element, several
 * Providers) used to live in this one component, so **every clip on the timeline** fully re-ran
 * every frame, even one a minute away from the playhead - in a film with a few dozen clips, most
 * of the iframe's main thread (the same one as the editor page) went to that. Now the gate only
 * computes three booleans (on screen, warming, clock pinned) and hands them to the memoized
 * DocWindowBody, which re-renders only when one of them flips. Elements inside that really do move
 * with time still get the time from context every frame.
 */
function DocWindow(props: DocWindowProps): React.ReactElement | null {
  const { placed } = props;
  const parentStart = useSpanStartMs();
  const collecting = useCollecting();
  const startMs = parentStart + placed.atMs;
  const { clip, kind } = placed;
  const project = kind === 'mg' ? props.projects?.[clip.src] : undefined;
  const publishedMedia = kind === 'mg' && !project ? filmPublishedMgMediaSrc(clip.src) : null;
  const componentMg = kind === 'mg' && !publishedMedia;
  const nowMs = useFilmTimeMs();
  const inRange = useWindowShows(startMs, placed.durMs);
  const nearRange = useWindowShows(
    startMs - VIDEO_WARM_MS,
    placed.durMs + VIDEO_WARM_MS + VIDEO_COOL_MS,
  );
  /* Warming: not on screen yet (or just left), but mounted hidden to buffer. Only video does this -
     stills have no decode step (an `<img>` is there as soon as it mounts), so mounting early would
     just waste a layer and a layout. */
  const still = kind === 'video' && filmSrcIsStill(clip.src);
  const warming = !collecting && !componentMg && !still && !inRange && nearRange;
  /* Only pin the clock on the "not yet" side - pinning means "wait on your own first frame".
     The 300ms after leaving is not pinned: pinning back to the in-point would demand another
     backward seek on the seam frame, exactly when the decoder is busy producing the next segment.
     Let it run out those few hundred ms on its own clock, with no seek at all. */
  const preroll = warming && nowMs < startMs;
  /* When something outside **deliberately re-renders** (the host swaps the film doc or a module
     version, a test changes a dependency and renders again), the inside must re-render too - that's
     React's normal semantics and memoization shouldn't swallow it. It can be told apart from a
     plain clock tick: a tick always changes the time, while a re-render from above usually doesn't.
     If the time didn't change, bump a counter to force the inner re-render. */
  const lastMs = React.useRef<number | null>(null);
  const pass = React.useRef(0);
  if (lastMs.current === nowMs) pass.current += 1;
  lastMs.current = nowMs;
  return <DocWindowBody {...props} inRange={inRange} warming={warming} preroll={preroll} pass={pass.current} />;
}

const DocWindowBody = React.memo(function DocWindowBody({ placed, mg, projects, audio = {}, inRange, warming, preroll }: DocWindowProps & {
  inRange: boolean;
  warming: boolean;
  preroll: boolean;
  /** Only used to break memoization, see DocWindow. */
  pass: number;
}): React.ReactElement | null {
  const parentStart = useSpanStartMs();
  const collecting = useCollecting();
  const honorHide = useHonorHide();
  const stage = useStage();
  const startMs = parentStart + placed.atMs;
  const { clip, kind } = placed;
  const project = kind === 'mg' ? projects?.[clip.src] : undefined;
  const publishedMedia = kind === 'mg' && !project ? filmPublishedMgMediaSrc(clip.src) : null;
  const componentMg = kind === 'mg' && !publishedMedia;
  const fromSec = (placed.fromMs ?? 0) / 1000;

  const z = -placed.track.index;
  const layer = 'transform' in clip ? clip.transform : undefined;
  const volume = 'volume' in clip ? clip.volume : undefined;
  const muted = filmVolumeMuted(volume);

  useRegisterScene({
    key: `${placed.label || kind}#${placed.trackIndex}.${placed.clipIndex}`,
    label: placed.label,
    startMs,
    durMs: placed.durMs,
    loc: placed.loc,
    track: placed.track,
    clipId: clip.id,
    ...(kind === 'mg' ? { src: clip.src } : {}),
    ...(layer ? { transform: layer } : {}),
    z,
    ...(muted ? { silent: true } : {}),
    ...(volume != null ? { volume } : {}),
    ...(placed.meta ? { meta: placed.meta } : {}),
    ...(placed.nativeSec != null ? { sourceDurMs: toMs(placed.nativeSec) } : {}),
    ...(placed.fromMs ? { inMs: placed.fromMs } : {}),
    anchor: {
      move: 'at',
      resize: 'end',
      trimFrom: fromSec,
      parentStartMs: parentStart,
    },
  });

  const still = kind === 'video' && filmSrcIsStill(clip.src);
  if (!collecting && honorHide && placed.track.hidden) return null;
  if (!collecting && !inRange && !warming) return null;

  let content: React.ReactNode;
  if (project) {
    content = <>
      <PreparedMgSurface project={project} />
      {project.hasAudio && project.audioSrc && !muted ? <Vo
        src={{ src: project.audioSrc, dur: project.dur, words: project.words, text: project.text }}
        at={fromSec} start={fromSec} end={fromSec + placed.durMs / 1000} clipId={clip.id} __loc={placed.loc}
      /> : null}
    </>;
  } else if (componentMg) {
    const src = clip.src;
    const Mg = mg[src];
    if (!Mg) {
      throw new Error(
        `tracks[${placed.trackIndex}].clips[${placed.clipIndex}] wants the MG module "${src}", which is not here.`
        + ` Bundled in: ${Object.keys(mg).join(' · ') || '(not one)'}.`,
      );
    }
    const durationSec = placed.nativeSec ?? (typeof Mg.duration === 'number' ? Mg.duration : fromSec + placed.durMs / 1000);
    const declared = planMgSoundClips(Mg.sounds, durationSec, audio, {
      id: `${placed.loc}/${clip.id}`, at: startMs / 1000,
      time: [fromSec, fromSec + placed.durMs / 1000], loc: placed.loc, clipId: clip.id,
    });
    content = <MgCompositionContext.Provider value={{
      durationSec, startMs, fromMs: placed.fromMs ?? 0, durMs: placed.durMs,
      ...(typeof Mg.duration === 'number' && Mg.duration > 0 ? { naturalSec: Mg.duration } : {}),
      instanceId: `${placed.loc}/${clip.id}`, loc: placed.loc, assets: audio,
    }}>
      <FilmClipIdContext.Provider value={clip.id}><Mg /></FilmClipIdContext.Provider>
      {declared.map(sound => <MgDeclaredSound key={sound.key} sound={sound} />)}
    </MgCompositionContext.Provider>;
  } else if (still) {
    const v = clip as FilmVideoClip;
    /* The still path has three things fewer than footage, and each is something it simply doesn't
       have: no audio (so no volume and no captions from its own audio), no in-point (a constant
       source looks the same wherever you sample it), no file length. The last one matters most -
       see the note in <Still>. */
    content = (
      <Still
        src={v.src}
        {...(placed.label ? { label: placed.label } : {})}
        clipId={v.id}
        {...(layer ? { layer } : {})}
        z={z}
        __loc={placed.loc}
      />
    );
  } else {
    const v = clip as FilmVideoClip;
    const gainDb = filmVolumeToGainDb(v.volume);
    /* What this footage says, per the asset index - captions for its own audio depend on it; <Video> trims them to the cut. */
    const said = typeof placed.assets?.[0] === 'object' ? placed.assets[0] : undefined;
    content = (
      <Video
        src={publishedMedia ?? v.src}
        from={fromSec}
        silent={filmVolumeMuted(v.volume)}
        {...(gainDb != null ? { gainDb } : {})}
        {...(v.volume != null ? { volume: v.volume } : {})}
        {...(placed.label ? { label: placed.label } : {})}
        clipId={v.id}
        {...(placed.nativeSec != null ? { sourceDurMs: toMs(placed.nativeSec) } : {})}
        {...(said?.text ? { text: said.text } : {})}
        {...(said?.words?.length ? { words: said.words } : {})}
        {...(said?.cast ? { cast: said.cast } : {})}
        {...(layer ? { layer } : {})}
        z={z}
        __loc={placed.loc}
      />
    );
  }
  const clockFromMs = componentMg ? (placed.fromMs ?? 0) : 0;
  /* Footage gets a track (the one frame capture registers against); MG isn't wrapped - sounds from
     elements inside a component shouldn't pose as clips in the film doc.
     The outer layer fills the canvas but is transparent; transform / mask are on the inner layer.
     The outer layer has pointer-events:none: it covers the whole canvas, and otherwise a click on
     the picture would always hit the topmost layer and a PIP in the bottom-right could never be
     selected. Only the inner layer takes pointer events, so the hit box follows scaling. */
  const windowed = (
    <Window startMs={startMs - clockFromMs} durMs={placed.durMs + clockFromMs}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'transparent',
          zIndex: z,
          pointerEvents: 'none',
          ...(warming ? { visibility: 'hidden' } : {}),
        }}
        data-film-seq={placed.label || undefined}
      >
        {componentMg && !project ? (
          <MgClipLayer
            loc={placed.loc}
            clipId={clip.id}
            layer={layer}
            overrides={(clip as FilmMgClip).overrides}
          >
            {content}
          </MgClipLayer>
        ) : (
          <MgClipLayer
            loc={placed.loc}
            clipId={clip.id}
            layer={layer}
            kind={kind}
            frame={stage}
            natural={placed.nativeBox}
          >
            {content}
          </MgClipLayer>
        )}
      </div>
    </Window>
  );
  /* While warming, the clock is pinned to the clip's own entry time: the <video> inside waits on
     its first frame buffering and doesn't fight the real playback timeline. This layer is always
     mounted (see ClockPin): crossing a seam only flips `pinned`, the subtree stays in place. */
  const timed = (
    <ClockPin pinned={preroll} timeMs={startMs - clockFromMs}>{windowed}</ClockPin>
  );
  const gainDb = filmVolumeToGainDb(volume);
  const pictured = (
    <TrackInfo track={placed.track}>
      <ClipMetaInfo meta={placed.meta ?? {}}>
        {componentMg
          ? <ClipSoundInfo silent={muted} gainDb={gainDb}>{timed}</ClipSoundInfo>
          : timed}
      </ClipMetaInfo>
    </TrackInfo>
  );
  return pictured;
});

function MgDeclaredSound({ sound }: { sound: PlannedMgSound }): null {
  const { words, ...entry } = sound;
  useRegisterSound(entry);
  useRegisterSpokenCaptions({
    text: !sound.off && sound.kind === 'voice' ? sound.text : undefined,
    words, sourceDurMs: sound.sourceDurMs, src: sound.src,
    fromMs: sound.inMs, startMs: sound.startMs, durMs: sound.durMs, loc: sound.loc,
  });
  return null;
}

function DocSound({ placed }: { placed: PlacedFilmClip }): React.ReactElement {
  const parentStart = useSpanStartMs();
  const parentDur = useSpanMs();
  const atSec = placed.atMs / 1000;
  const startSec = (placed.fromMs ?? 0) / 1000;
  const endSec = startSec + placed.durMs / 1000;
  const { clip } = placed;

  /* There's only one audio track kind; which element it renders as (captions / attack / ducking) is decided by the asset path. */
  const role = filmAudioRoleOf(clip.src);
  const volume = 'volume' in clip ? clip.volume : undefined;
  const gainDb = filmVolumeToGainDb(volume);
  const muted = filmVolumeMuted(volume);
  let inner: React.ReactElement;
  if (role === 'voice') {
    /* A multi-line narration clip's trim can't be passed down - Vo would treat the end as each line's own end. */
    const many = (placed.assets?.length ?? 0) > 1;
    inner = (
      <Vo
        src={placed.assets as SoundAsset[]}
        at={atSec}
        {...(gainDb != null ? { gainDb } : {})}
        start={many ? 0 : startSec}
        {...(!many ? { end: endSec } : {})}
        __loc={placed.loc}
        clipId={clip.id}
      />
    );
  } else if (role === 'sfx') {
    inner = (
      <Sfx
        src={placed.assets![0]!}
        at={atSec}
        {...(gainDb != null ? { gainDb } : {})}
        start={startSec}
        end={endSec}
        __loc={placed.loc}
        clipId={clip.id}
      />
    );
  } else {
    inner = (
      <Music
        src={placed.assets![0]!}
        at={atSec}
        {...(gainDb != null ? { gainDb } : {})}
        start={startSec}
        end={endSec}
        __loc={placed.loc}
        clipId={clip.id}
      />
    );
  }

  return (
    <TrackInfo track={placed.track}>
      <ClipMetaInfo meta={{ ...placed.meta, ...(filmSrcIsScore(clip.src) ? { sourceSrc: clip.src } : {}) }}>
        {/* Pass only `silent`, **not gainDb**. This clip's volume is already on the element's
            `gainDb` above, and useRegisterSound adds the element's own gain to the context's - give
            it in both places and the dB doubles, i.e. the linear gain squares: `volume: 0.5` comes
            out at a quarter, `volume: 2` is +12 dB and clips. The doc says plainly "linear
            multiplier", and nothing along this chain would warn you otherwise.
            The context is for sounds registered **inside picture clips** (MG element sounds,
            footage audio); audio clips don't use it. */}
        <ClipSoundInfo silent={muted}>
          <Window startMs={parentStart} durMs={Math.max(parentDur, placed.atMs + placed.durMs)}>
            {inner}
          </Window>
        </ClipSoundInfo>
      </ClipMetaInfo>
    </TrackInfo>
  );
}

export function FilmDocClips({ doc, mg, audio, media, lenientRefs, projects }: {
  doc: FilmDoc;
  mg: FilmMgModules;
  audio?: FilmAssetIndex | undefined;
  media?: FilmMediaIndex | undefined;
  lenientRefs?: boolean | undefined;
  projects?: Record<string, FilmPreparedMgProject>;
}): React.ReactElement {
  const { placed } = React.useMemo(
    () => resolveFilmDocWithRefs(doc, { audio, mg, media, projects, ...(lenientRefs ? { lenientRefs } : {}) }),
    [doc, audio, mg, media, lenientRefs, projects],
  );
  return (
    <FilmSubtitlesContext.Provider value={doc.subtitles ? { ...doc.subtitles, index: audio } : undefined}>
      {placed.map((p) => (p.timeless
        ? <DocSound key={p.loc} placed={p} />
        : <DocWindow key={p.loc} placed={p} mg={mg} projects={projects} audio={audio} />))}
    </FilmSubtitlesContext.Provider>
  );
}

export function filmFromDoc(
  docValue: unknown,
  mg: FilmMgModules,
  audio?: unknown,
  media?: FilmMediaIndex,
  projects?: Record<string, FilmPreparedMgProject>,
): { stage: { w: number; h: number }; Film: React.ComponentType } {
  const doc = parseFilmDocValue(docValue);
  const index = (audio ?? undefined) as FilmAssetIndex | undefined;
  const Film = (): React.ReactElement => (
    <FilmDocClips doc={doc} mg={mg} audio={index} media={media} projects={projects} />
  );
  Film.displayName = 'FilmDoc';
  return { stage: doc.stage, Film };
}

/**
 * The same build output, paired with a film doc that **can change**.
 *
 * `filmFromDoc` bakes the doc into the module, so moving a clip on the timeline means rebuilding
 * the whole film (an in-browser esbuild pass takes hundreds of ms to seconds). Yet moving a clip
 * changes one number; not a character of the MG code changed.
 *
 * Here the doc is demoted to an input **read on every render**: the host replaces the global copy
 * and re-renders, and the picture is new. Each clip is keyed by `loc`, so changing only `at`
 * doesn't remount the MG instance - no video re-decode, no `useTimeline` rebuild, no canvas
 * flicker. Validation still goes through `parseFilmDocValue` (whatever is pushed in could be
 * anything), but memoized by the doc's identity: playback renders every frame, and running the
 * schema every frame is not an option.
 *
 * **Module initialization doesn't read the doc** - not a single field. The stage size is baked in
 * as a literal by the generated entry (it's part of the shape, and changing it requires a rebuild
 * anyway, see doc-entry in film-build), so between import and first render this module doesn't
 * depend on what's in the global. A server process may have several projects open at once and
 * import is async: if someone else swapped the global in between, it would read their stage size.
 *
 * Editing only. The final film uses `filmFromDoc` - a delivered film shouldn't depend on someone
 * stuffing a global at runtime.
 */
export function filmFromLiveDoc(
  getDoc: () => unknown,
  mg: FilmMgModules,
  audio?: unknown,
  media?: FilmMediaIndex,
  opts: { lenientRefs?: boolean; projects?: Record<string, FilmPreparedMgProject> } = {},
): { Film: React.ComponentType } {
  const index = (audio ?? undefined) as FilmAssetIndex | undefined;
  let lastRaw: unknown;
  let lastDoc: FilmDoc | null = null;
  const docFor = (raw: unknown): FilmDoc => {
    if (lastDoc && raw === lastRaw) return lastDoc;
    lastDoc = parseFilmDocValue(raw);
    lastRaw = raw;
    return lastDoc;
  };
  const Film = (): React.ReactElement => {
    const raw = getDoc();
    const doc = React.useMemo(() => docFor(raw), [raw]);
    return (
      <FilmDocClips
        doc={doc}
        mg={mg}
        audio={index}
        media={media}
        projects={opts.projects}
        {...(opts.lenientRefs ? { lenientRefs: true } : {})}
      />
    );
  };
  Film.displayName = 'FilmLiveDoc';
  return { Film };
}
