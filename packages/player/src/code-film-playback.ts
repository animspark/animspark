/**
 * Plays a code film: the audio, the clock, and the iframe that holds the picture.
 *
 * New projects are rooted at `film.json` + `mg/*`; older workspaces may still have a
 * single `film.tsx`. This layer doesn't care: it consumes the evaluated manifest
 * (duration, audio, iframe time), whatever the root file looks like.
 *
 *   - Audio is the **master clock**. The ear notices a gap in audio immediately, while
 *     nobody sees a picture one frame off, so the picture follows the audio. When there
 *     is audio that isn't ready yet, time holds at the requested position; loading time
 *     must never be skipped as if it were film duration. Films without audio use the
 *     wall clock.
 *   - The picture lives in an iframe. The film's build needs its own React/gsap
 *     singletons; loaded into the same page as the app's copies, hooks would throw
 *     outright. So it is isolated, and time is pushed over via postMessage.
 *
 * The iframe does not run rAF: if it ran its own, the two clocks would drift apart
 * and audio/picture would slip further and further out of sync, a bug that is very
 * hard to track down. It renders once each time it receives a time.
 *
 * **The picture and the UI update at different rates**; see UI_TICK_MS below.
 */
'use client';

import {
  StemAudioPlayer, soundsStemManifest, type FilmSoundEntry, type FilmTransform,
} from '@animspark/core';
import * as React from 'react';

/** The evaluated result returned by `/api/projects/:id/film`. */
export interface CodeFilm {
  /** Host policy. Historical and derived previews are explicitly read-only. */
  readonly?: boolean;
  stage: { w: number; h: number };
  durationMs: number;
  visualEndMs: number;
  scenes: {
    key: string;
    label: string;
    startMs: number;
    durMs: number;
    loc?: string;
    clipId?: string;
    src?: string;
    sourceDurMs?: number;
    inMs?: number;
    transform?: FilmTransform;
    z?: number;
    silent?: boolean;
    volume?: number;
    /**
     * Drag anchor (see TimelineBlock in timeline-layout for the full set). Only
     * `trimFrom` is used here: thumbnails need it to compute the in-clip offset.
     * After trimming two seconds off the start, the same moment no longer shows the
     * same frame.
     */
    anchor?: { trimFrom?: number; parentStartMs: number };
    track?: {
      index: number;
      name: string;
      kind: string;
      hidden?: boolean;
      muted?: boolean;
      locked?: boolean;
    };
  }[];
  sounds: FilmSoundEntry[];
  videos: {
    key: string;
    src: string;
    startMs: number;
    durMs: number;
    inMs: number;
    sourceDurMs?: number;
    /** Which source line it's written on; deleting and splitting both need this first. */
    loc?: string;
    clipId?: string;
    transform?: FilmTransform;
    z?: number;
    gainDb?: number;
    volume?: number;
    silent?: boolean;
    track?: {
      index: number;
      name: string;
      kind: string;
      hidden?: boolean;
      muted?: boolean;
      locked?: boolean;
    };
  }[];
  captions: { key: string; startMs: number; durMs: number; text: string; speaker?: string }[];
  /**
   * Every workspace path the film asks for, whether or not it exists on disk (see
   * collectFilm in the runtime).
   *
   * Diff it against the asset list and what's left are the **gaps**: files the code
   * points at that aren't on disk.
   */
  assets: string[];
  sourceFps?: number;
  /**
   * Fingerprint of this version of the source (computed from the contents of every
   * file in the workspace).
   *
   * The thumbnail cache uses it as a key. The same source always yields the same
   * value no matter how many reloads, so frames captured yesterday are still valid
   * today.
   */
  srcHash?: string;
  /**
   * Fingerprint of this version of the **code**: same as above but excluding
   * `film.json` (see sourceStamps in the engine).
   *
   * Thumbnails are stored per picture, and a picture is fixed by the code plus each
   * block's appearance, regardless of which millisecond it sits at (see
   * thumb-frame). Moving a block changes `srcHash` but not this, so those frames
   * don't need to be captured again.
   */
  codeStamp?: string;
  /**
   * The **shape** of this film doc (see filmDocShape in core): which MGs and assets
   * it uses, and the stage size.
   *
   * Moving things around doesn't change the shape at all, and an unchanged shape
   * means the build the preview page already has still fits the new doc: just hand
   * it the doc and re-render, no rebuild needed (see pushFilmDoc below). Code-form
   * films don't have this.
   */
  docShape?: string;
  /**
   * The `film.json` on disk. Sent on open and after every workspace change. The
   * browser edits it locally, then POSTs it back to disk. Code-form films don't have
   * this field.
   */
  doc?: unknown;
  /**
   * The film on disk is still the starter template written by the platform, i.e. the
   * project doesn't really have a film yet. For new projects that's a `film.json`
   * with a stage size and no blocks at all; older empty shells may be a `film.tsx`,
   * or one of the early docs pinned to an `mg/hello` hint card (those all count as
   * the user's film).
   *
   * The server determines this by exact comparison (see isFilmScaffold in the
   * engine), not by guessing from the film's shape: a single-scene title card is
   * structurally identical to the shell, and the guessing version hid films users
   * had actually made.
   */
  scaffold?: boolean;
}

export function isFilmReadOnly(film: CodeFilm | null | undefined): boolean {
  // Existing film.json and film.tsx responses predate the policy flag. Their
  // editing callbacks remain valid; only an absent film or an explicit host
  // restriction disables the editor.
  return !film || film.readonly === true;
}

/**
 * A collect lacks the fields the server computes (the two fingerprints, the shape,
 * scaffold). Keep them from the previous film if it has them. Lose the fingerprints
 * and the iframe swaps its src and every thumbnail key changes; lose the shape and
 * the next drag forces a full rebuild; lose scaffold and an empty project's aspect
 * button falls back from "resize the canvas" to "letterbox".
 */
export function retainFilmMeta(next: CodeFilm, prev: CodeFilm | null): CodeFilm {
  return {
    ...next,
    readonly: next.readonly ?? prev?.readonly ?? false,
    srcHash: next.srcHash ?? prev?.srcHash,
    codeStamp: next.codeStamp ?? prev?.codeStamp,
    docShape: next.docShape ?? prev?.docShape,
    doc: next.doc ?? prev?.doc,
    scaffold: typeof next.scaffold === 'boolean' ? next.scaffold : prev?.scaffold,
  };
}

/**
 * Converts what the iframe's collect pushes back into the shape this player uses.
 *
 * A collect has no srcHash / scaffold (the server computes those against the
 * workspace), so keep them from the previous film if present. Otherwise the lost
 * fingerprint changes the iframe `src` and the freshly drawn picture goes black
 * again.
 */
export function adoptClientFilm(raw: unknown, prev: CodeFilm | null): CodeFilm | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.durationMs !== 'number' || !Number.isFinite(o.durationMs) || o.durationMs < 0) {
    return null;
  }
  const stage = o.stage as { w?: number; h?: number } | undefined;
  const sounds = Array.isArray(o.sounds) ? o.sounds as CodeFilm['sounds'] : [];
  /* How long the same sound was in the previous film. The iframe's own collect
     reports Infinity for clips whose length hasn't been probed yet (it has no
     ffprobe). Clamped to 0, the manifest drops that entry entirely (see
     `durMs <= 0` in film-audio). So during editing, every collect made the clips
     that were just playing vanish together, decodeKey changed, the whole player was
     torn down, and with an empty manifest it was never rebuilt. The symptom was
     "pause, play again, total silence", which only fixed itself once a server
     evaluation came back with lengths. So keep the measured value. */
  /* Match by "which file, starting from which millisecond", not by key (the key
     contains startMs, so moving a clip changes it). Only "play to the end of the
     asset" clips land on this path, and their length is determined by exactly
     those two values anyway. */
  const knownDur = new Map<string, number>();
  for (const s of prev?.sounds ?? []) {
    if (Number.isFinite(s.durMs) && s.durMs > 0) knownDur.set(`${s.src}@${s.inMs}`, s.durMs);
  }
  return retainFilmMeta({
    // An iframe reports playback data, never permission to edit the project.
    readonly: prev ? prev.readonly ?? false : true,
    stage: stage?.w && stage.h ? { w: stage.w, h: stage.h } : prev?.stage ?? { w: 1920, h: 1080 },
    durationMs: o.durationMs,
    visualEndMs: typeof o.visualEndMs === 'number' && Number.isFinite(o.visualEndMs)
      ? o.visualEndMs
      : o.durationMs,
    scenes: Array.isArray(o.scenes) ? o.scenes as CodeFilm['scenes'] : [],
    sounds: sounds.map((s) => ({
      ...s,
      durMs: Number.isFinite(s.durMs) ? s.durMs : knownDur.get(`${s.src}@${s.inMs}`) ?? 0,
    })),
    videos: Array.isArray(o.videos) ? o.videos as CodeFilm['videos'] : [],
    captions: Array.isArray(o.captions) ? o.captions as CodeFilm['captions'] : [],
    /* Treat a missing field as "not received", not "needs nothing": older host
       pages don't send it, and treating it as empty would make the gaps just shown
       on the canvas vanish for a round. */
    assets: Array.isArray(o.assets)
      ? o.assets.filter((one): one is string => typeof one === 'string')
      : prev?.assets ?? [],
    sourceFps: typeof o.sourceFps === 'number' ? o.sourceFps : prev?.sourceFps,
  }, prev);
}

/**
 * How often the time shown in the UI updates: 50ms, i.e. 20Hz.
 *
 * The picture is **not** throttled by this: the iframe receives the time every frame
 * (see the playback loop), so it draws as smoothly as the display. Only the React
 * state is throttled, and its consumers are the timeline playhead and the transport
 * timecode. Those look no different at 20Hz than at 60Hz, but at 60Hz they drag a
 * two-thousand-line component tree through sixty re-renders a second.
 *
 * The two used to be coupled (time went into state, then an effect pushed it to the
 * iframe), so "the picture must be smooth" also set the whole tree's re-render rate
 * to 60Hz. Decoupled, each gets the rate it needs.
 */
const UI_TICK_MS = 50;

/** Loading is not film time. Only a film without sound can use wall time. */
export function codeFilmClock(input: {
  hasSounds: boolean;
  audioPlaying: boolean;
  audioMs: number;
  heldMs: number;
  wallMs: number;
}): { timeMs: number; live: boolean } {
  if (!input.hasSounds) return { timeMs: input.wallMs, live: true };
  if (input.audioPlaying) return { timeMs: input.audioMs, live: true };
  return { timeMs: input.heldMs, live: false };
}

/**
 * The playback time as an external store.
 *
 * The `timeMs` React state re-renders the caller's whole tree. A five-thousand-line
 * editor page re-rendering twenty times a second saturates the main thread just
 * running hooks and rebuilding JSX. Only a few leaves actually need to follow the
 * clock (playhead, timecode, captions, stage selection), and each can subscribe here
 * on its own; see `usePlaybackTime`.
 */
export interface PlaybackClock {
  get(): number;
  subscribe(fn: () => void): () => void;
}

function createPlaybackClock(): PlaybackClock & { set(ms: number): void } {
  let now = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => now,
    set(ms: number) {
      if (ms === now) return;
      now = ms;
      for (const fn of listeners) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

const NO_SUBSCRIBE = () => () => {};

/** Subscribes to a PlaybackClock; with no clock (the legacy player path) it uses the given `fallback`. */
export function usePlaybackTime(clock: PlaybackClock | null | undefined, fallback: number): number {
  const read = (): number => (clock ? clock.get() : fallback);
  return React.useSyncExternalStore(clock ? clock.subscribe : NO_SUBSCRIBE, read, read);
}

export interface CodeFilmPlayback {
  /**
   * The time shown in the UI. With `liveTimeInState: false` this value does **not**
   * advance during playback (it stays at the moment playback started); it only
   * updates on pause, seek and scrub. Leaves that must follow playback subscribe to
   * `clock`.
   */
  timeMs: number;
  /** Time advanced every UI_TICK_MS during playback; equal to `timeMs` when stopped. Stable reference. */
  clock: PlaybackClock;
  totalMs: number;
  playing: boolean;
  audioReady: boolean;
  /**
   * Play was pressed but the clock is held by the audio (still decoding / buffering).
   * The play button already shows "pause" while the picture and timecode don't move;
   * without telling the user, it just looks broken. State is written only when this
   * flips.
   */
  buffering: boolean;
  error: string | null;
  /** Audio failures have their own recovery lifecycle; a ready frame cannot clear them. */
  audioError: string | null;
  /**
   * Media sources this browser can't play: black on the timeline, and waiting won't
   * fix them.
   *
   * There is almost only one source of these: ProRes 4444 / qtrle with alpha, i.e.
   * **transparent clips exported by this very product** (chapter cards, caption bars,
   * stickers), which users commonly upload back into their asset library. The server
   * is supposed to store a playable copy alongside (see the host's
   * AssetPointer.preview), so ending up here means that copy hasn't been transcoded
   * yet, or the transcode failed.
   *
   * The point is to **not leave that slot silently black**: a black picture looks
   * exactly like "still loading", and this slot will never fix itself. Paths are
   * workspace-relative, reported by the iframe (see reportUnplayable in
   * film-runtime).
   */
  unplayable: readonly string[];
  /** Attach to the iframe; time is pushed through it. */
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  onFrameLoad: () => void;
  /**
   * Which document the iframe currently holds; incremented on every load.
   *
   * Code that attaches things to that document (keyboard events: once focus is inside
   * the iframe, key presses don't bubble to the parent page) uses this to know when
   * to reattach. Changing src is an asynchronous navigation, and until `onLoad`
   * `contentWindow` is still the **previous** document. Reattaching on the version
   * number alone would attach to a window about to be discarded, leaving the new one
   * with no listeners; the symptom is Space suddenly not working after an edit.
   */
  frameEpoch: number;
  /**
   * The film in the iframe has mounted and replied `ready`.
   *
   * `onLoad` only means the HTML arrived; React hasn't committed yet and the picture
   * is still black at that instant. Opening a project must wait for this flag,
   * otherwise removing the loading screen first reveals a black block, and the text
   * and logos appear a second later.
   */
  hostReady: boolean;
  toggle: () => void;
  /** Pause (a no-op if already stopped). Stable reference, safe to pass as a prop. */
  pause: () => void;
  seek: (ms: number) => void;
  scrubPreview: (ms: number) => void;
  /**
   * Commit the position on release. By default it stops at the new position (the
   * timeline's rule; see the comment below). `resume` is the player seek bar's path:
   * if it was playing before the drag it keeps playing, if stopped it stays stopped,
   * like the homepage player and YouTube.
   */
  scrubCommit: (ms: number, opts?: { resume?: boolean }) => void;
  /** Master volume 0..1 and mute, used by the fullscreen control bar. All audio goes through the stem player's master bus, so changing it here is enough. */
  volume: number;
  muted: boolean;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  /** Playback rate. The stem player schedules audio at this rate, and the picture's wall clock is multiplied by it. */
  rate: number;
  setRate: (r: number) => void;
}

export function useCodeFilmPlayback(opts: {
  film: CodeFilm | null;
  fileUrl: (src: string) => string;
  /**
   * URL the audio path fetches bytes from (`/film/stem/`).
   *
   * It serves the same master as `fileUrl`; the only difference is that **this route
   * never 302s**. The stem player feeds the stream into Web Audio, and if the bucket
   * domain a redirect lands on lacks a CORS header, the whole film goes silent while
   * the picture plays normally. If omitted it falls back to `fileUrl`, which becomes a
   * silent film whenever it hits a direct link, so the editor must pass it
   * explicitly.
   */
  stemUrl?: (src: string) => string;
  /** Version of the iframe `src`. When it changes, wait for `ready` again; the previous document's ready must not stand in for this one. */
  hostKey?: string | number;
  /**
   * The timeline the iframe collected itself. Opening a project no longer waits for
   * the server's `/film`; the timeline comes from here.
   */
  onFilm?: (film: CodeFilm) => void;
  /**
   * Whether to write the time into React state on every UI tick during playback
   * (default true, the old behavior). Large pages pass false: during playback only
   * `clock` advances, and the caller's whole tree no longer re-renders at 20Hz.
   */
  liveTimeInState?: boolean;
}): CodeFilmPlayback {
  const { film } = opts;
  const liveTimeInState = opts.liveTimeInState !== false;
  const clockRef = React.useRef<ReturnType<typeof createPlaybackClock> | null>(null);
  if (!clockRef.current) clockRef.current = createPlaybackClock();
  const uiClock = clockRef.current;
  const filmRef = React.useRef(film);
  filmRef.current = film;
  const [timeMs, setTimeMsState] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [audioReady, setAudioReady] = React.useState(false);
  const [buffering, setBuffering] = React.useState(false);
  const bufferingRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [audioError, setAudioError] = React.useState<string | null>(null);
  const [unplayable, setUnplayable] = React.useState<readonly string[]>([]);
  const [hostReady, setHostReady] = React.useState(false);
  const [volume, setVolumeState] = React.useState(1);
  const [muted, setMutedState] = React.useState(false);
  const player = React.useRef<StemAudioPlayer | null>(null);
  /* The player gets rebuilt wholesale (when the asset set changes), and the new
     instance must inherit the current volume and mute. Otherwise volume the user just
     turned down jumps back to full after the next edit. */
  const mixRef = React.useRef({ volume: 1, muted: false, rate: 1 });
  const [rate, setRateState] = React.useState(1);
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const frameReady = React.useRef(false);
  const playingRef = React.useRef(false);

  const fileUrl = React.useRef(opts.fileUrl);
  fileUrl.current = opts.fileUrl;
  const stemUrl = React.useRef(opts.stemUrl ?? opts.fileUrl);
  stemUrl.current = opts.stemUrl ?? opts.fileUrl;
  const onFilm = React.useRef(opts.onFilm);
  onFilm.current = opts.onFilm;

  const totalMs = film?.durationMs ?? 0;

  /* Keep the time in a ref too. The two places below (iframe reports ready, document
     finishes loading) need "the current millisecond" but otherwise have nothing to do
     with time. Putting it in their deps would detach and reattach the message
     listener every 50ms during playback, twenty times a second, just to read a
     number. */
  const timeRef = React.useRef(0);
  /* Every change while stopped (seek, scrub, pause) updates the ref, the state and the
     clock together; per-tick updates during playback live in the rAF loop. The ref is
     no longer copied from state during render: during playback state may be stale
     (liveTimeInState: false), and copying it back would yank the advancing time back
     to where playback started. */
  const setTimeMs = React.useCallback((ms: number) => {
    timeRef.current = ms;
    setTimeMsState(ms);
    uiClock.set(ms);
  }, [uiClock]);

  /* Push the time to the picture. If the iframe isn't ready yet, hold it; it gets
     pushed again as soon as the iframe is ready (see below). `playing` must travel
     with it: `<video>` only lets the decoder run on its own while playing, otherwise
     it seeks every frame and any video footage in the film stutters (see
     useVideoSync in film-runtime). */
  const push = React.useCallback((ms: number, live = playingRef.current) => {
    if (!frameReady.current) return;
    frameRef.current?.contentWindow?.postMessage(
      { source: 'anim-host', type: 'seek', timeMs: ms, playing: live, durationMs: totalMs },
      '*',
    );
  }, [totalMs]);

  /* While stopped (seek, dragging the playhead, keyboard), push from here. During
     playback defer to the rAF loop: it pushes every frame, and pushing here too would
     just send the same time twice. */
  React.useEffect(() => {
    if (!playing) push(timeMs);
  }, [timeMs, push, playing]);

  const [frameEpoch, setFrameEpoch] = React.useState(0);
  /**
   * When src changes, the previous document's ready is void; otherwise, on switching
   * projects, the loading screen would think the picture is already drawn.
   *
   * Keyed on `hostKey` only, no longer on `srcHash`. Blacking out the picture on every
   * film edit until it rebuilt was necessary back when edits replaced the document
   * (the iframe really was empty at that moment). Edits now **rebuild in place**: the
   * previous version stays on screen and watchable, so covering it in black would
   * only cause a needless flicker.
   */
  React.useEffect(() => {
    frameReady.current = false;
    setHostReady(false);
    setError(null);
    setUnplayable([]);
  }, [opts.hostKey]);
  const onFrameLoad = React.useCallback(() => {
    frameReady.current = true;
    setFrameEpoch((n) => n + 1);
    push(timeRef.current);
  }, [push]);

  /* Errors inside the iframe are invisible from here; without catching them the picture goes blank with no clue why. */
  React.useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const data = e.data as {
        source?: string;
        type?: string;
        message?: string;
        src?: string;
      } | null;
      if (!data || data.source !== 'anim-film') return;
      /* Only listen to our own iframe. The page also has an iframe for capturing
         thumbnails (see ShotFrame) that runs the same host page and sends the same
         messages. Without checking the source, its ready would make us think the
         picture is ready (pushing the first seek to a document that hasn't mounted),
         and its errors would be shown here as ours. */
      if (e.source !== frameRef.current?.contentWindow) return;
      if (data.type === 'ready') {
        frameReady.current = true;
        setHostReady(true);
        /* A new version is running, so the previous version's error is stale. Without
           clearing it, it would stay on the picture: the agent breaks the film once,
           fixes it two seconds later, and the user is left staring at "the film can't
           load" over a perfectly good film. */
        setError(null);
        /* Start over for each new version: it may no longer use that asset at all, and the message would otherwise stay up. */
        setUnplayable([]);
        const collected = adoptClientFilm(
          (data as { film?: unknown }).film,
          filmRef.current,
        );
        if (collected) onFilm.current?.(collected);
        push(timeRef.current);
      }
      if (data.type === 'error' && data.message) setError(data.message);
      /* One media source may be split into a dozen blocks on the timeline. The iframe
         already dedupes by src (see reportUnplayable); we dedupe again here because
         replacing the document clears its record. Without both, the same message would
         stack a dozen times. */
      if (data.type === 'media-unplayable' && data.src) {
        const src = data.src;
        setUnplayable((prev) => (prev.includes(src) ? prev : [...prev, src]));
      }
    };
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); };
  }, [push]);

  /*
   * Say hello on arrival.
   *
   * The iframe's `ready` is **one-shot**: it's sent once when the build finishes, and
   * lost if nobody is listening. And the iframe can easily be ready before this tree:
   * on a build-cache hit it finishes drawing in a few hundred milliseconds, before
   * hydration completes (measured in dev: the iframe reported ready at 965ms, when no
   * listener was attached here yet). Losing that message doesn't just mean slower:
   * the picture is already on screen, but the outer page stays on the loading screen
   * forever and the play button never works.
   *
   * So once we're attached, we ask, and the iframe sends it again if it has it. This
   * also covers `onFrameLoad`: if the document finished loading before React bound
   * onLoad, that callback never fires either.
   */
  const loadRef = React.useRef(onFrameLoad);
  loadRef.current = onFrameLoad;
  React.useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    if (win.document?.readyState === 'complete') loadRef.current();
    win.postMessage({ source: 'anim-host', type: 'hello' }, '*');
  }, [opts.hostKey]);

  /*
   * Audio: the master clock.
   *
   * Keyed on the signature only. Rebuilding the StemAudioPlayer means decoding every
   * track again, and dragging the seek bar shouldn't cut out the audio.
   */
  const manifest = React.useMemo(
    () => (film
      ? soundsStemManifest(film.sounds, {
        totalMs: film.durationMs,
        mapUrl: (src) => stemUrl.current(src),
      })
      : null),
    [film],
  );
  const manifestKey = React.useMemo(() => (manifest ? JSON.stringify(manifest) : ''), [manifest]);
  /**
   * When a full rebuild is warranted: only **which files are needed and how long each
   * one is**.
   *
   * This used to be the JSON of the whole manifest, which includes every clip's start.
   * Moving one line of voiceover on the timeline would destroy and reload the player,
   * re-download and re-decode ten stems (400ms and up, measured), reset `audioReady`
   * and grey out the play button in front of the user, while not a single byte of
   * samples had changed.
   *
   * Position, length, trim points and gain never enter this key: they change how
   * things are scheduled, and scheduling is redone on every seek anyway (0.4ms).
   * Those changes go through `retime`.
   *
   * `sourceDurMs` is included because **paths get overwritten in place**: when the
   * agent re-records a line of voiceover it still writes `assets/audio/vo/01.m4a`, and
   * that URL is a fixed no-store address. Keyed on URL alone, the newly recorded line
   * would never play and you'd still hear the old one; the asset's real length is the
   * only value in this chain that can tell them apart.
   */
  /**
   * The last **measured** real length of the asset at each URL.
   *
   * Sounds in a film doc can read their length from the asset registry, and the
   * iframe's collect carries it too. Ones not in the registry (on the code-form path
   * `src` is just a path) only get it from the server evaluation's ffprobe. During
   * editing the two kinds of film routinely alternate (drag -> local collect, save ->
   * server evaluation). Feeding `sourceDurMs ?? 0` straight into the key would flip
   * the same untouched asset between 184320 and 0, and every flip tears down the
   * whole player for nothing: re-download every stem, re-decode, go silent mid-play.
   * So remember the measured value: a film without it reuses the old value, and the
   * key changes only when the asset really changed (a **different** measured value).
   */
  const knownSrcDur = React.useRef(new Map<string, number>());
  const decodeKey = React.useMemo(() => {
    if (!film) return '';
    const per = new Map<string, number>();
    /* Same rule as the manifest: sounds whose duration hasn't been measured never make it into the manifest, so there's nothing to decode. */
    for (const s of film.sounds) {
      if (!Number.isFinite(s.durMs) || s.durMs <= 0) continue;
      const url = stemUrl.current(s.src);
      if (!url) continue;
      const measured = s.sourceDurMs ?? 0;
      if (measured > 0) knownSrcDur.current.set(url, measured);
      per.set(url, measured > 0 ? measured : knownSrcDur.current.get(url) ?? 0);
    }
    return [...per].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([u, d]) => `${u}\t${d}`).join('\n');
  }, [film]);
  /* When retime refuses (the set of tracks changed), this forces a full rebuild instead. */
  const [rebuildNonce, setRebuildNonce] = React.useState(0);
  const latest = React.useRef(manifest);
  latest.current = manifest;
  /* Anchors for the playback loop (wall-clock origin). The audio rebuild effect needs them too: resuming interrupted playback requires knowing the current time. */
  const startedAt = React.useRef(0);
  const startedFrom = React.useRef(0);
  React.useEffect(() => {
    player.current?.destroy();
    player.current = null;
    setAudioReady(false);
    setAudioError(null);

    const built = latest.current;
    if (!built?.clips.length) return undefined;

    const reportAudioError = (e: unknown) => {
      if (player.current !== p) return;
      setAudioError(e instanceof Error ? e.message : String(e));
      playingRef.current = false;
      setPlaying(false);
    };
    const p = new StemAudioPlayer({
      manifest: built,
      /* On end, the ref must be cleared too. Changing only state leaves the ref stuck
         at true, and the wall clock keeps counting from the moment playback started.
         At the next rebuild the "resume by itself" check would fire and start playback
         from a time long past the end of the film, scheduling zero sources: the
         picture moves with no sound at all, and playingState stays stuck for good, so
         every play() exits immediately until the page is reloaded. */
      onEnded: () => {
        if (player.current !== p) return;
        playingRef.current = false;
        setPlaying(false);
      },
      onError: reportAudioError,
    });
    p.volume = mixRef.current.volume;
    p.muted = mixRef.current.muted;
    p.rate = mixRef.current.rate;
    player.current = p;
    void p.load().then(() => {
      if (player.current !== p) return;
      setAudioReady(true);
      setAudioError(null);
      /* Rebuilt wholesale mid-playback (the asset set really changed): the new
         instance resumes by itself once loaded. Otherwise the picture keeps going but
         the audio stops at the rebuild, and the rest of the film is silent until the
         user presses play again. */
      if (playingRef.current && !p.playing) {
        void p.play(timeRef.current).catch(reportAudioError);
      }
    }).catch(() => {});
    return () => {
      p.destroy();
      if (player.current === p) player.current = null;
    };
  }, [decodeKey, rebuildNonce, opts.hostKey]);

  /* Things only moved: reschedule in place. A freshly built player already has this manifest, so no need to schedule again. */
  React.useEffect(() => {
    const p = player.current;
    const next = latest.current;
    if (!next || (p && p.manifest === next)) return;
    if (!p) {
      /* No player (the previous manifest was empty, or building failed). This used to
         just return, so nothing revived it once the manifest had clips again, and a
         film that had been silent stayed silent until reload. Now a full rebuild
         happens as soon as the manifest has clips. */
      if (next.clips.length) setRebuildNonce((n) => n + 1);
      return;
    }
    if (!p.retime(next)) setRebuildNonce((n) => n + 1);
  }, [manifestKey]);

  /*
   * The picture follows the audio.
   *
   * With audio, wait until it's ready before advancing; the seconds spent loading
   * are not content the user asked to cut. Films without audio play on the wall
   * clock as usual.
   *
   * The loop doesn't run while stopped: an idle setState every frame is wasted work.
   */
  React.useEffect(() => {
    if (!playing) {
      if (bufferingRef.current) { bufferingRef.current = false; setBuffering(false); }
      return undefined;
    }
    startedAt.current = performance.now();
    startedFrom.current = timeRef.current;
    let raf = 0;
    let lastUi = 0;
    const tick = (): void => {
      const now = performance.now();
      const wall = startedFrom.current + (now - startedAt.current) * mixRef.current.rate;
      const p = player.current;
      const clock = codeFilmClock({
        hasSounds: Boolean(latest.current?.clips.length), audioPlaying: Boolean(p?.playing),
        audioMs: p?.currentMs ?? 0, heldMs: timeRef.current, wallMs: wall,
      });
      const raw = clock.timeMs;
      const at = totalMs > 0 ? Math.min(totalMs, raw) : raw;
      if (bufferingRef.current !== !clock.live) {
        bufferingRef.current = !clock.live;
        setBuffering(!clock.live);
      }

      /* Push to the picture every frame: it bypasses React, so each push is just one postMessage. */
      push(at, clock.live);
      timeRef.current = at;

      const done = Boolean(totalMs) && at >= totalMs - 8;
      /* The UI updates every UI_TICK_MS. The final update isn't throttled: missing
         those 50ms would leave the playhead a little short of the end when the film
         has clearly finished. Stop exactly at the film duration, not past it. */
      if (done || now - lastUi >= UI_TICK_MS) {
        lastUi = now;
        if (done || liveTimeInState) setTimeMs(done ? totalMs : at);
        else uiClock.set(at);
      }
      if (done) {
        /* Handle the end here rather than waiting for the player's endTimer: it's
           computed from "milliseconds remaining", so when decoding lags a bit it fires
           after this frame, and meanwhile the ref still says "playing". */
        player.current?.pause();
        playingRef.current = false;
        startedFrom.current = totalMs;
        startedAt.current = now;
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // timeMs is read only once, when the loop starts; it can't be a dep or the loop would restart every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, totalMs, push, liveTimeInState, setTimeMs, uiClock]);

  /** Synchronously unlocks the AudioContext within the click, then asynchronously starts audio at the picture's current position. */
  const startAudio = React.useCallback(() => {
    const p = player.current;
    if (!p) return;
    p.unlock();
    void (async () => {
      try {
        await p.load();
        if (!playingRef.current || player.current !== p) return;
        await p.play(timeRef.current);
        if (player.current !== p) return;
        setAudioReady(true);
        setAudioError(null);
      } catch (e) {
        if (playingRef.current && player.current === p) {
          setAudioError(e instanceof Error ? e.message : String(e));
          playingRef.current = false;
          setPlaying(false);
        }
      }
    })();
  }, []);

  /**
   * Stop: audio, the two refs and the React state all stop together.
   *
   * Factored out because "stop" has four entry points (play button, clicking the
   * picture, dragging the timeline, clicking the timeline). Each used to have its own
   * copy, and three of them forgot to reset the wall clock. The wall clock is "moment
   * playback started + time elapsed since", and that difference keeps growing after
   * stopping. An audio rebuild uses it to resume the playback position (see the effect
   * above), so stopping for ten minutes and then hitting a rebuild would resume past
   * the end of the film: zero sources scheduled, the picture moving with no sound, and
   * the player stuck on "playing" for good until the page is reloaded.
   *
   * `atMs` is where to stop; if omitted, it's wherever the clock is now.
   */
  const halt = React.useCallback((atMs?: number) => {
    const at = atMs ?? (player.current?.playing ? player.current.currentMs : timeRef.current);
    player.current?.pause();
    playingRef.current = false;
    timeRef.current = at;
    setTimeMs(at);
    startedFrom.current = at;
    startedAt.current = performance.now();
    setPlaying(false);
  }, [setTimeMs]);

  /**
   * Pause. Does nothing if already stopped.
   *
   * Separate from `toggle` because the callers differ: `toggle` means "the user pressed
   * the play button" and needs to know the current state, whereas this means "the
   * action just taken needs the picture to stop moving" (clicking an element on the
   * stage), which only goes one way. Using `toggle` would require reading `playing`
   * outside first, and that value may be stale in a closure.
   *
   * Its only dep, `halt`, has no deps itself, so this reference is stable too. It's
   * passed as a prop to FilmStageSelect, which memoizes on prop identity; a callback
   * that changes every frame would disable the memoization entirely.
   */
  const pause = React.useCallback(() => {
    if (!playingRef.current) return;
    halt();
  }, [halt]);

  /**
   * Start playback from a given time. Reads refs only, never closure state: it's called
   * in the same tick right after a seek (commit on release, then resume), when the
   * `timeMs` state is still stale.
   */
  const playFrom = React.useCallback((fromMs: number) => {
    if (playingRef.current) return;
    const p = player.current;
    // Pressing play while stopped at the end means "watch again", not "stay put".
    let from = fromMs;
    if (totalMs > 0 && from >= totalMs - 8) {
      p?.seek(0);
      from = 0;
      setTimeMs(0);
    }
    startedFrom.current = from;
    timeRef.current = from;
    startedAt.current = performance.now();
    playingRef.current = true;
    startAudio();
    setPlaying(true);
  }, [totalMs, startAudio, setTimeMs]);

  const toggle = React.useCallback(() => {
    if (playing) {
      halt();
      return;
    }
    playFrom(timeRef.current);
  }, [playing, halt, playFrom]);

  const seek = React.useCallback((ms: number) => {
    const at = Math.max(0, Math.min(totalMs, ms));
    player.current?.seek(at);
    timeRef.current = at;
    setTimeMs(at);
  }, [totalMs, setTimeMs]);

  /*
   * Scrubbing has two steps: while dragging only the picture moves; the audio is
   * updated on release.
   *
   * Doing it in one step costs the ear: dragging across a twenty-second film produces
   * hundreds of seeks, and every seek during playback reschedules the sources of every
   * track, which sounds like continuous tearing.
   *
   * On the timeline, seeking during playback = **stop at the new position**, don't
   * keep playing. Pointing at a new moment means "I want to look here"; if playback
   * continued, that frame would be swept away before you could see it. To keep
   * playing, Space is right there.
   * The player seek bar follows a different rule (`resume`): there you're **watching**
   * the film, and a click jumps ahead and keeps watching. Whether it was playing before
   * the drag is stored in scrubWasPlaying, because the preview step has already stopped
   * it, so reading state on release wouldn't tell the truth.
   */
  const scrubWasPlaying = React.useRef<boolean | null>(null);
  const scrubPreview = React.useCallback((ms: number) => {
    const at = Math.max(0, Math.min(totalMs, ms));
    if (scrubWasPlaying.current === null) scrubWasPlaying.current = playingRef.current;
    if (playing) halt(at);
    if (liveTimeInState) {
      setTimeMs(at);
      return;
    }
    /* No state writes while dragging: each write re-renders the whole host (a project
       page thousands of lines long), and a second of dragging brings twenty-odd ticks.
       The time goes into the ref and the clock (leaves that follow it read the clock),
       and is pushed directly to the picture; only the release (scrubCommit -> seek)
       lands it in state. */
    timeRef.current = at;
    uiClock.set(at);
    push(at, false);
  }, [playing, totalMs, halt, setTimeMs, liveTimeInState, uiClock, push]);

  const scrubCommit = React.useCallback((ms: number, opts?: { resume?: boolean }) => {
    const at = Math.max(0, Math.min(totalMs, ms));
    const wasPlaying = scrubWasPlaying.current ?? playingRef.current;
    scrubWasPlaying.current = null;
    /* A click skips the preview step (see click-to-seek on the timeline), so if playing, stop first here too. */
    if (playingRef.current) halt(at);
    seek(at);
    if (opts?.resume && wasPlaying) playFrom(at);
  }, [seek, halt, totalMs, playFrom]);

  const setVolume = React.useCallback((v: number) => {
    const next = Math.max(0, Math.min(1, v));
    mixRef.current.volume = next;
    if (player.current) player.current.volume = next;
    setVolumeState(next);
    /* Turning the volume up means "I want to hear it": unmute as well, like other players do. */
    if (next > 0 && mixRef.current.muted) {
      mixRef.current.muted = false;
      if (player.current) player.current.muted = false;
      setMutedState(false);
    }
  }, []);

  const setMuted = React.useCallback((m: boolean) => {
    mixRef.current.muted = m;
    if (player.current) player.current.muted = m;
    setMutedState(m);
  }, []);

  const setRate = React.useCallback((r: number) => {
    const next = Number.isFinite(r) && r > 0 ? r : 1;
    /* Changing rate during playback: settle the wall clock up to now at the old rate
       first, otherwise "elapsed time x new rate" would make the time jump on the
       spot. */
    if (playingRef.current) {
      const now = performance.now();
      startedFrom.current += (now - startedAt.current) * mixRef.current.rate;
      startedAt.current = now;
    }
    mixRef.current.rate = next;
    if (player.current) player.current.rate = next;
    setRateState(next);
  }, []);

  return {
    timeMs,
    clock: uiClock,
    totalMs,
    playing,
    audioReady,
    buffering,
    error,
    audioError,
    unplayable,
    frameRef,
    onFrameLoad,
    frameEpoch,
    hostReady,
    toggle,
    pause,
    seek,
    scrubPreview,
    scrubCommit,
    volume,
    muted,
    setVolume,
    setMuted,
    rate,
    setRate,
  };
}
