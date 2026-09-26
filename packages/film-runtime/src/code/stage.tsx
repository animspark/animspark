/**
 * Time and registration: the foundation of code-based films.
 *
 * In one sentence: **a film is a React tree, and time is a number in context.** Playing,
 * scrubbing, frame extraction and export are all "set that number to N and render once".
 * There is no second code path, so the preview and the final film can't disagree.
 *
 * Audio is the only thing here that needs special handling: it has no pixels, so rendering
 * can't produce it. Instead, audio components register themselves on a sink **during render**:
 *
 *   - In the browser, the registry feeds the existing stem engine for playback.
 *   - In node (export, checks), the whole tree is rendered once in "collect mode", and the
 *     resulting registry is the mix list.
 *
 * Registration must happen during render, not in an effect: `renderToStaticMarkup` doesn't
 * run effects, and the node-side pass depends on it. The cost is that render has side effects
 * (impure in React's eyes), so the sink dedupes by key and a double render in strict mode still
 * registers once.
 */

import type { FilmTransform } from '@animspark/core/film';
import * as React from 'react';

import { windowShowsAt } from './window-range';

export type SoundKind = 'voice' | 'music' | 'sfx';

/** The millisecond, in the clip's own time, at which a word of a narration clip lands. Used by the timeline for tick marks and drag snapping. */
export interface FilmClipCue {
  word: string;
  tMs: number;
}

/**
 * The doc's notes for this clip. **Placement ignores all of them**; they only travel to the
 * timeline.
 *
 * They get their own channel because they live on the doc while registration happens inside
 * components: `<Vo>` doesn't know, and shouldn't know, what this narration clip's per-word
 * marks look like. So the doc layer puts them into context and they are merged in at
 * registration (see ClipMetaContext), the same way for all three registries.
 */
export interface ClipMeta {
  /** Authored score module, while the sound src identifies its rendered audio bytes. */
  sourceSrc?: string;
  /** Per-word marks (narration only). */
  cues?: readonly FilmClipCue[];
  /** The doc's raw `at`, present only when it is a reference (`"sc-02.end"`). The inspector displays it, and it is what gets recognized when freezing. */
  atRef?: string;
  /** The component's raw `duration`, present only when it is a reference. */
  durRef?: string;
}

/** Where one sound sits in the film. The shape matches the existing stem list so the mix layer stays untouched. */
export interface SoundEntry {
  key: string;
  /** Source line it was written on (`file:line:column`). Injected at compile time; the timeline uses it to write drags back to source. */
  loc?: string;
  /**
   * Total length of the source asset (ms).
   *
   * The timeline uses it to decide how far the clip can still be dragged right: past the end
   * of the asset the rest is silence, even though on screen the clip looks longer. Filled in
   * by ffprobe during evaluation (see measureSounds).
   */
  sourceDurMs?: number;
  /** How to edit this clip in source. */
  anchor?: TimeAnchor;
  kind: SoundKind;
  /**
   * Who is speaking (narration only): a label from the asset registry's `cast` list.
   *
   * It is registered on the sound and not just on captions because the timeline splits tracks
   * by character: "who speaks when" is the most important thing to see at a glance in a
   * multi-character film, and caption data lives on a separate path the tracks can't read.
   */
  cast?: string;
  /** What is said. Narration only. `anim check` uses it to read the script back in playback order. */
  text?: string;
  /** Workspace-relative path. */
  src: string;
  startMs: number;
  /** How long it plays. During collection the file length may be unknown (Infinity); the evaluator clamps it to the measured value after ffprobe. */
  durMs: number;
  /** Millisecond of the file to start reading from. */
  inMs: number;
  gainDb?: number;
  /** Duck under speech (meaningful for music only). */
  duck?: boolean;
  /** Milliseconds after start at which "the hit" lands (an Sfx's attackMs). Used by `anim look --sound` to draw hit-point lines. */
  attackMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  /** The track is muted / hidden. Still registered (the timeline draws it), but skipped in the mix. */
  off?: boolean;
  /** Track on the doc. Absent = code-form film; the timeline groups tracks by kind itself. */
  track?: FilmTrackRef;
  /** The doc's notes for this clip (origin / per-word marks). */
  meta?: ClipMeta;
  /** This clip's id on the doc. Tracks use it to map back to rows on the doc (see the alignment in timeline-layout). */
  clipId?: string;
}

/** A track on the doc. */
export interface FilmTrackRef {
  index: number;
  name: string;
  kind: string;
  hidden?: boolean;
  muted?: boolean;
  locked?: boolean;
}

/**
 * How this clip is edited on the doc: which field a timeline drag writes back to.
 *
 * Every clip on the doc is placed by `at` and trimmed by `time`, so these two fields are
 * fixed. The layer exists because "can it be dragged" isn't a UI choice: a clip with no
 * location (no loc reported during collection) can only be viewed, not dragged, and then these
 * keys are omitted.
 */
export interface TimeAnchor {
  /** Field written when moving. Absent = can't be moved. */
  move?: 'at';
  /** Field written when resizing (the end of `time`). Absent = can't be resized. */
  resize?: 'end';
  /**
   * The second of the asset this clip starts using (the start of `time`).
   *
   * Dragging the right edge writes back an end point = this number + the new duration, while
   * collection reports absolute times in the film.
   */
  trimFrom?: number;
  /**
   * Start of the enclosing window.
   *
   * `at` is an offset **relative to this number**, while collection reports absolute film
   * times. Without it, dragging a sound effect nested in a scene at second 30 would compute an
   * `at` that includes those 30 seconds, moving it to second 30 of the film on top of where it
   * already was. The symptom: "I dragged it a little and it jumped somewhere else".
   */
  parentStartMs: number;
}

export interface SceneSpan {
  key: string;
  label: string;
  startMs: number;
  durMs: number;
  /** Source line it was written on (`file:line:column`). Injected at compile time; the timeline uses it to write drags back to source. */
  loc?: string;
  /** How to edit this clip in source. */
  anchor?: TimeAnchor;
  /** Track on the doc. Absent = code-form film; the timeline groups tracks by kind itself. */
  track?: FilmTrackRef;
  /** The doc's notes for this clip (origin). */
  meta?: ClipMeta;
  /** This clip's id on the doc. UI selection and the inspector key on it. */
  clipId?: string;
  /** MG module path. */
  src?: string;
  /**
   * The element's own duration (ms): the component's `duration` for an MG, the file length for footage.
   * The timeline clamps edge drags with it: stop at the limit rather than write an invalid `to` into source.
   */
  sourceDurMs?: number;
  /** Millisecond on the element's own timeline to start from (`from`). */
  inMs?: number;
  transform?: FilmTransform;
  z?: number;
  silent?: boolean;
  volume?: number;
}

/**
 * A stretch of video footage that appears in the film.
 *
 * Two uses, both essential:
 *   - **Export frame rate must follow the footage.** Exporting 25fps footage at 30fps repeats
 *     a frame every five, so the film stutters more than the source, and frame-by-frame
 *     screenshots can't catch it (each frame looks right on its own).
 *   - **The video track on the timeline.** "This footage is used from second X to second Y" is
 *     exactly this entry, and only the runtime knows it: the duration comes from the enclosing
 *     window and isn't written on the `<Video>` line in source.
 */
export interface MediaEntry {
  key: string;
  /** Source line it was written on. */
  loc?: string;
  /** Workspace-relative path. */
  src: string;
  /** Film millisecond at which it appears. */
  startMs: number;
  /** How long it lasts (the length of its window). */
  durMs: number;
  /** Asset millisecond to start from: the edit's in point. */
  inMs: number;
  /** Total file length. The timeline needs it to know how far the clip can still be dragged right. */
  sourceDurMs?: number;
  /** Name of this piece (`<Video label>`), printed on its timeline block; falls back to the file name. */
  label?: string;
  /** Track on the doc. */
  track?: FilmTrackRef;
  /** The doc's notes for this clip (origin). */
  meta?: ClipMeta;
  clipId?: string;
  transform?: FilmTransform;
  z?: number;
  /** Drop this video's own audio. Read by the inspector's mute toggle. */
  silent?: boolean;
  /** Gain offset for the original audio (dB). Used by the mix. */
  gainDb?: number;
  /** Linear volume from the doc. Read by the inspector. */
  volume?: number;
}

/**
 * One caption.
 *
 * Not drawn into the picture: it exports as SRT and the player lays it out. Style, position
 * and on/off are viewer preferences; burning captions in would decide for everyone, and
 * changing the style would mean re-rendering the whole film.
 */
export interface CaptionEntry {
  key: string;
  /** Source line it was written on. */
  loc?: string;
  startMs: number;
  durMs: number;
  text: string;
  /** Who is speaking. Included in the exported SRT for multi-speaker dialogue. */
  speaker?: string;
}

export interface Sink {
  sound(entry: SoundEntry): void;
  scene(span: SceneSpan): void;
  media(entry: MediaEntry): void;
  caption(entry: CaptionEntry): void;
}

/* ── context ─────────────────────────────────────────────────────────────── */

/** Current time in the film. */
const TimeContext = React.createContext<number>(0);

/** Film duration. When parked at the end, it tells whether a clip is showing the last frame. */
const DurationContext = React.createContext<number>(0);

/** The current window: start and length relative to the film. The root is { startMs: 0, durMs: film duration }. */
const WindowContext = React.createContext<{ startMs: number; durMs: number }>({
  startMs: 0,
  durMs: 0,
});

/**
 * Collect mode.
 *
 * When non-null, Seq doesn't cull by time and always renders its subtree, and audio components
 * register themselves. This pass isn't meant for viewing; it answers "how long is this film,
 * and what sounds when" without running a browser.
 */
const SinkContext = React.createContext<Sink | null>(null);

/** Whether the host is playing continuously or stopped. Decoder-backed elements need to tell the difference; the picture itself shouldn't depend on it. */
const PlayingContext = React.createContext<boolean>(false);

const TrackInfoContext = React.createContext<FilmTrackRef | null>(null);

/**
 * Notes attached by the doc layer, merged in at registration.
 *
 * Only the doc knows these things, and registration happens in three components that don't;
 * going through context avoids changing their props.
 */
const ClipMetaContext = React.createContext<ClipMeta | null>(null);

/** silent / volume on a picture clip, applied to the sounds registered beneath it. Sounds inside an MG go through this. */
const ClipSoundContext = React.createContext<{ silent?: boolean; gainDb?: number } | null>(null);

export function ClipSoundInfo({
  silent, gainDb, children,
}: {
  silent?: boolean;
  gainDb?: number;
  children: React.ReactNode;
}): React.ReactElement {
  const value = React.useMemo(
    () => (silent || gainDb != null ? { silent, gainDb } : null),
    [silent, gainDb],
  );
  return <ClipSoundContext.Provider value={value}>{children}</ClipSoundContext.Provider>;
}

export function ClipMetaInfo(
  { meta, children }: { meta: ClipMeta; children: React.ReactNode },
): React.ReactElement {
  return <ClipMetaContext.Provider value={meta}>{children}</ClipMetaContext.Provider>;
}

/** Empty notes stay out of the registry: a code-form film shouldn't gain a single extra field. */
function metaFields(own: ClipMeta | undefined, ctx: ClipMeta | null): { meta?: ClipMeta } {
  const meta = own ?? ctx ?? undefined;
  return meta && Object.keys(meta).length ? { meta } : {};
}

/** Canvas pixels, from the stage in film.json / film.tsx rather than a hard-coded 1920x1080. */
const StageContext = React.createContext<{ w: number; h: number } | null>(null);

function stageFromWindow(): { w: number; h: number } | null {
  if (typeof window === 'undefined') return null;
  const s = (window as Window & { __FILM_STAGE__?: { w?: number; h?: number } }).__FILM_STAGE__;
  return s?.w && s.h ? { w: s.w, h: s.h } : null;
}

/** This film's canvas. Use these two numbers for coordinates, font sizes and viewBox; don't assume 1920x1080. */
export function useStage(): { w: number; h: number } {
  return React.useContext(StageContext) ?? stageFromWindow() ?? { w: 1920, h: 1080 };
}

/** The doc attaches "which track this clip is on"; it is merged into the span at registration so the timeline draws by track instead of grouping by kind on the fly. */
export function TrackInfo({ track, children }: {
  track: FilmTrackRef;
  children: React.ReactNode;
}): React.ReactElement {
  return <TrackInfoContext.Provider value={track}>{children}</TrackInfoContext.Provider>;
}

export function useTrackInfo(): FilmTrackRef | null {
  return React.useContext(TrackInfoContext);
}

export const useFilmTimeMs = (): number => React.useContext(TimeContext);
export const useFilmDurationMs = (): number => React.useContext(DurationContext);
export const useFilmPlaying = (): boolean => React.useContext(PlayingContext);

/** Whether this clip should be on screen now. Parked at the film duration it still draws the last frame; see windowShowsAt. */
export function useWindowShows(startMs: number, durMs: number): boolean {
  return windowShowsAt(useFilmTimeMs(), startMs, durMs, useFilmDurationMs());
}

/**
 * Pin the subtree's clock at timeMs and render it as "stopped".
 *
 * Used to pre-mount video clips that haven't come on yet: pinned at its own entry time, the
 * <video> inside seeks to its first frame and pauses, so the decoder fills its buffer out of
 * sight. When the clip comes on, the frame is already in hand and the seam no longer flashes
 * black.
 *
 * **The switch is `pinned`, not "wrap in this layer or not".** The two look equivalent; the
 * difference is on React's side. Wrapped and unwrapped are different element types, and when
 * the type at a position changes, the whole subtree unmounts and remounts along with its DOM.
 * That happens exactly on the frame that crosses the seam: the `<video>` that just filled its
 * buffer is destroyed, and the new one starts from scratch fetching bytes, parsing metadata and
 * seeking back to mid-file. For those tens to hundreds of milliseconds it can't draw a pixel,
 * and the black background showing through is the flash the user sees. The warm-up was done,
 * then thrown away on the very frame it was meant to pay off.
 */
export function ClockPin({ pinned, timeMs, children }: {
  pinned: boolean;
  timeMs: number;
  children: React.ReactNode;
}): React.ReactElement {
  const liveMs = React.useContext(TimeContext);
  const livePlaying = React.useContext(PlayingContext);
  return (
    <PlayingContext.Provider value={pinned ? false : livePlaying}>
      <TimeContext.Provider value={pinned ? timeMs : liveMs}>{children}</TimeContext.Provider>
    </PlayingContext.Provider>
  );
}
export const useCollecting = (): boolean => React.useContext(SinkContext) != null;

/**
 * Whether preview / export hides tracks that are switched off.
 *
 * The thumbnail iframe (`?shot=1`) must turn this off: a hidden track is still on the
 * timeline, and its thumbnail still has to show its own picture. Only the copy in front of
 * the user and the final film hide it.
 */
const HonorHideContext = React.createContext(true);

export function useHonorHide(): boolean {
  return React.useContext(HonorHideContext);
}

/** Current millisecond within this window. 0 = the first frame of this span. */
export function useLocalMs(): number {
  const time = React.useContext(TimeContext);
  const win = React.useContext(WindowContext);
  return time - win.startMs;
}

/** Current time within this window, in seconds. Same unit as gsap and `cue`. */
export function useLocal(): number {
  return useLocalMs() / 1000;
}

/** Length of this window. `useLocalMs() / useSpanMs()` = progress. */
export function useSpanMs(): number {
  return React.useContext(WindowContext).durMs;
}

/** Start of this window in the film; audio components use it to turn relative times into absolute ones. */
export function useSpanStartMs(): number {
  return React.useContext(WindowContext).startMs;
}

/* ── registration ────────────────────────────────────────────────────────── */

/**
 * Register one sound during render.
 *
 * It registers outside collect mode too: during browser playback that registry is what feeds
 * the stem engine. Both sides use the same data, so "the preview sounds different from the
 * export" is structurally impossible.
 */
export function useRegisterSound(
  /* Accepting null lets "don't register this time" be written as an unconditional hook call.
     `<Video silent>` is exactly that case, and wrapping the call itself in an if would break
     the rules of hooks. */
  entry: (Omit<SoundEntry, 'key'> & { key?: string }) | null,
): void {
  const sink = React.useContext(SinkContext);
  const track = React.useContext(TrackInfoContext);
  const meta = React.useContext(ClipMetaContext);
  const clipSound = React.useContext(ClipSoundContext);
  if (!sink || !entry) return;
  const key = entry.key ?? `${entry.kind}:${entry.src}@${Math.round(entry.startMs)}`;
  const resolved = entry.track ?? track ?? undefined;
  const off = Boolean(entry.off || clipSound?.silent || resolved?.hidden || resolved?.muted);
  const gainDb = addGainDb(entry.gainDb, clipSound?.gainDb);
  sink.sound({
    ...entry,
    key,
    ...(gainDb != null ? { gainDb } : {}),
    ...(off ? { off: true } : {}),
    ...(resolved ? { track: resolved } : {}),
    ...metaFields(entry.meta, meta),
  });
}

function addGainDb(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

/** Same reasoning as useRegisterSound: register during render so the collect pass can see it. */
export function useRegisterMedia(entry: Omit<MediaEntry, 'key'> & { key?: string }): void {
  const sink = React.useContext(SinkContext);
  const track = React.useContext(TrackInfoContext);
  const meta = React.useContext(ClipMetaContext);
  if (!sink) return;
  const resolved = entry.track ?? track ?? undefined;
  sink.media({
    ...entry,
    key: entry.key ?? `video:${entry.src}@${Math.round(entry.startMs)}`,
    ...(resolved ? { track: resolved } : {}),
    ...metaFields(entry.meta, meta),
  });
}

export function useRegisterCaption(
  /* Accepts null like useRegisterSound: "don't register this caption this time" must be
     writable as an **unconditional** hook call. When narration trims captions at a cut, the
     lines trimmed away are exactly that case (see Vo). */
  entry: Omit<CaptionEntry, 'key'> | null,
): void {
  const sink = React.useContext(SinkContext);
  const track = React.useContext(TrackInfoContext);
  const clipSound = React.useContext(ClipSoundContext);
  if (!sink || !entry || clipSound?.silent || track?.hidden || track?.muted) return;
  sink.caption({ ...entry, key: `cap@${Math.round(entry.startMs)}:${entry.text.slice(0, 12)}` });
}

export function useRegisterScene(span: SceneSpan): void {
  const sink = React.useContext(SinkContext);
  const track = React.useContext(TrackInfoContext);
  const meta = React.useContext(ClipMetaContext);
  const resolved = span.track ?? track ?? undefined;
  if (sink) {
    sink.scene({
      ...span,
      ...(resolved ? { track: resolved } : {}),
      ...metaFields(span.meta, meta),
    });
  }
}

/* ── provider ────────────────────────────────────────────────────────────── */

export function FilmRoot({
  timeMs,
  durationMs,
  playing = false,
  sink = null,
  stage = null,
  honorHide = true,
  children,
}: {
  timeMs: number;
  durationMs: number;
  playing?: boolean;
  sink?: Sink | null;
  stage?: { w: number; h: number } | null;
  honorHide?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const win = React.useMemo(() => ({ startMs: 0, durMs: durationMs }), [durationMs]);
  const canvas = stage?.w && stage.h ? stage : stageFromWindow();
  return (
    <DurationContext.Provider value={durationMs}>
      <StageContext.Provider value={canvas}>
        <SinkContext.Provider value={sink}>
          <HonorHideContext.Provider value={honorHide}>
            <PlayingContext.Provider value={playing}>
              <WindowContext.Provider value={win}>
                <TimeContext.Provider value={timeMs}>{children}</TimeContext.Provider>
              </WindowContext.Provider>
            </PlayingContext.Provider>
          </HonorHideContext.Provider>
        </SinkContext.Provider>
      </StageContext.Provider>
    </DurationContext.Provider>
  );
}

/** Internal: open a new window layer. */
export function Window({
  startMs,
  durMs,
  children,
}: {
  startMs: number;
  durMs: number;
  children: React.ReactNode;
}): React.ReactElement {
  const value = React.useMemo(() => ({ startMs, durMs }), [startMs, durMs]);
  return <WindowContext.Provider value={value}>{children}</WindowContext.Provider>;
}
