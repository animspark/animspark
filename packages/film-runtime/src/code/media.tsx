/**
 * Assets that go into the picture: video and images.
 *
 * Images don't need this layer (`<img src={m.photo.src}/>` is all it takes); video does: it carries
 * a decoder, the only thing in the whole tree with state of its own, so it can't be "redrawn from
 * the current time every frame" like a div.
 *
 * You don't pass a time; the component asks the clock. So `<Video src={m.talk}/>` means "this video
 * follows the time of the scene it sits in" - wherever that scene is seeked, it follows, so
 * scrubbing, frame capture and export all line up.
 *
 * **Source audio is on by default.** The `<video>` element itself is always muted - all audio goes
 * through the mix, which is the only thing that knows who ducks for whom; letting the element play
 * sound would play it twice alongside the mix. So what this does is **register a sound on its
 * behalf**, exactly equivalent to writing `<Vo src={the same file}>`.
 *
 * Why on by default rather than muted: in edited films the audio already lives in the footage, and
 * "using the footage" and "wanting its audio" are almost always the same thing in practice. The
 * opposite design was tried and measured - even with the prompt saying to add a separate `<Vo>`,
 * the model still left it out, and the symptom of leaving it out is a normal picture, an all-green
 * health check and a successful export; only actually listening reveals the whole film is silent.
 * Write `silent` when you want it muted - that's the minority case, and forgetting it is audible
 * immediately.
 *
 * **Captions likewise.** If the ledger has this footage's source text and per-word timings
 * (produced by `anim audio asr`), they register themselves without anyone writing them again - they
 * share the captions.ts rules with `<Vo>` and follow the cuts however the footage is split.
 */

import * as React from 'react';

import { useRegisterSpokenCaptions } from './captions';
import { MgCompositionContext } from './mg-context';
import { planMgSoundClips, type PlannedMgSound } from './mg-sounds';
import { FilmClipIdContext } from './refs';
import { toMs } from './sec';
import type { SpokenWord } from './spoken';
import {
  useFilmPlaying,
  useFilmTimeMs,
  useCollecting,
  useLocalMs,
  useRegisterMedia,
  useRegisterSound,
  useSpanMs,
  useSpanStartMs,
  useWindowShows,
} from './stage';

/** The shape of a visual asset entry in the ledger (only the fields this layer uses). */
export interface VisualAsset {
  src: string;
  durMs?: number;
  w?: number;
  h?: number;
  /**
   * What is said in this footage, plus per-word timings - the output of `anim audio asr`.
   *
   * The same thing, from the same source, as those two fields on narration ledger entries. When
   * present, captions appear on their own; see captions.ts for the reasoning and the behavior
   * during editing.
   */
  text?: string;
  words?: readonly SpokenWord[];
  /** Who is speaking in this footage (a label from the `cast` book). Not needed for single-speaker films. */
  cast?: string;
}

const PAUSED_SEEK_EPSILON_SECONDS = 1e-6;
const PLAYING_DRIFT_SECONDS = 0.25;
// Cover the allowed decoder drift plus time for the next host-clock update.
const CUT_GUARD_SECONDS = PLAYING_DRIFT_SECONDS + 0.1;

interface VideoSourceWindow {
  inMs: number;
  outMs: number;
}

function clampVideoSourceMs(sourceMs: number, window?: VideoSourceWindow): number {
  if (!window) return Math.max(0, sourceMs);
  // Source ranges are half-open. The stopped film end and hidden postroll
  // must retain a selected frame, never request the first discarded frame.
  return Math.max(window.inMs, Math.min(sourceMs, window.outMs - 0.001));
}

/**
 * Pin a `<video>` to a given source time.
 *
 * In the middle of a clip, 250ms of drift is tolerated so the decoder can play continuously. Near
 * the in and out points the decoder's independent clock is paused and frames are taken precisely
 * from the timeline; otherwise a decoder running ahead or behind would show trimmed-away frames.
 * When stopped or exporting, only 1us of numeric error is tolerated, because every adjacent frame
 * must be hit. 50ms would swallow the next frame at 24/30/60fps and make a frame-by-frame export
 * repeat the previous picture.
 *
 * **Don't issue a new seek until the previous one has landed.** While the playhead is dragged the
 * time changes dozens of times a second, and each `currentTime` write to the decoder can't be
 * immediate: it flushes buffers, falls back to a keyframe and re-decodes a run of frames, tens of
 * ms each time, all billed to the main thread - the same thread that draws the playhead. The faster
 * the drag, the bigger the backlog; the symptom is "the mouse is long gone and the line is still
 * crawling after it".
 *
 * So follow the decoder's own pace: while it is still seeking, just remember the latest target, and
 * issue the next seek once it lands (`seeked`). All the intermediate targets are dropped - the user
 * never meant to look at them; they want **the frame where the hand stopped**, and this guarantees
 * that is the last one to land.
 */
export function useVideoSync(
  ref: React.RefObject<HTMLVideoElement | null>,
  sourceMs: number,
  playing: boolean,
  sourceWindow?: VideoSourceWindow,
): void {
  const latest = React.useRef({ sourceMs, playing, sourceWindow });
  latest.current = { sourceMs, playing, sourceWindow };

  const sync = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { sourceMs, playing, sourceWindow } = latest.current;
    const want = clampVideoSourceMs(sourceMs, sourceWindow) / 1000;
    const nearCut = sourceWindow && (
      want <= sourceWindow.inMs / 1000 + CUT_GUARD_SECONDS
      || want >= sourceWindow.outMs / 1000 - CUT_GUARD_SECONDS
      || el.currentTime < sourceWindow.inMs / 1000
      || el.currentTime >= sourceWindow.outMs / 1000
    );
    const freeRunning = playing && !nearCut;
    const drift = Math.abs(el.currentTime - want);
    if (!freeRunning && !el.paused) el.pause();
    // A seek before metadata can be discarded by the browser. Reapply the
    // latest target when metadata arrives, including a paused, prewarmed clip.
    if (el.readyState === 0) return;
    const epsilon = freeRunning ? PLAYING_DRIFT_SECONDS : PAUSED_SEEK_EPSILON_SECONDS;
    // Keep just the latest target while a seek is in flight. `seeked` reapplies
    // it; interrupting a slow decoder can prevent it from presenting any frame.
    if (drift > epsilon && !el.seeking) {
      el.currentTime = want;
    }
    // A trimmed video may resume only after its pending source seek settles.
    if (freeRunning && el.paused && (!sourceWindow || !el.seeking)) void el.play().catch(() => {});
  }, [ref]);

  React.useLayoutEffect(sync, [sync, sourceMs, playing, sourceWindow?.inMs, sourceWindow?.outMs]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    el.addEventListener('loadedmetadata', sync);
    el.addEventListener('seeked', sync);
    sync(); // Cached metadata may have arrived between commit and this effect.
    return () => {
      el.removeEventListener('loadedmetadata', sync);
      el.removeEventListener('seeked', sync);
    };
  }, [ref, sync]);
}

/**
 * How long to wait before each retry. Once these are used up, stop retrying.
 *
 * The first wait is short (400ms) because the vast majority of failures are just "the asset isn't
 * hydrated yet" - a large file is still only a pointer in the working tree at that moment, and
 * fetching its bytes takes a detour through CAS. The later waits grow to leave room for a source
 * file of several hundred MB: nearly 19 s in total. A file that truly doesn't exist only gets five
 * knocks, while slow hydrations get to finish.
 *
 * ## Why there's no "give up immediately" branch
 *
 * Intuitively there should be one: for a source the browser has no decoder for, five more knocks
 * give the same result, wasting 19 s. That intuition gives you "stop waiting when
 * `MediaError.code === 3` (`MEDIA_ERR_DECODE`)". Two things defeat it:
 *
 * 1. **That code never shows up.** Measured (the last section of scripts/probe-browser-preview.mts;
 * rerun it for each new Chrome version): a ProRes master, a truncated mp4, an mp4 with garbage in
 * the bitstream, a 404, a transfer cut off halfway, a failed connection - Chrome reports 4 for all
 * of them. Only `message` tells them apart (`NO_SUPPORTED_STREAMS` / `COULD_NOT_OPEN` /
 * `Format error`), and that is an internal string, not part of the spec.
 *
 * 2. Even going by `message`, **it picks the wrong culprit**. "This browser can't decode it" is, in
 * the hosted service, precisely a state that **fixes itself**: the timeline asks for the playable
 * version (`prefer=preview`), and until it has been transcoded the server serves the master first
 * while transcoding in the background (see edit-routes). At that moment `<video>` receives a
 * ProRes file and reports exactly `NO_SUPPORTED_STREAMS` - giving up on it would pin to a black
 * screen exactly the assets this whole mechanism exists to rescue. A refetch a few hundred ms later
 * gets a WebM that plays. (The refetch can get the new version because that route is always
 * `no-store`: the master must never be cached and served in its place.)
 *
 * So always go through the whole ladder. Sources that truly can't be decoded stay black for the
 * full 19 s as a result - in exchange, the ones that would recover actually do. The trade is right:
 * waiting wrongly is only slow, while giving up wrongly means that frame never comes back on its
 * own. For those still failing at the end of the ladder, **the reason is reported** (see
 * reportUnplayable), so the UI has something to say instead of a silent black box.
 */
const RELOAD_WAITS_MS = [400, 1000, 2500, 5000, 10000] as const;

/**
 * Report "this browser can't play this footage" to the outer page.
 *
 * Nobody reads the iframe's console, and on screen this frame looks exactly like "still loading" -
 * without a report, all the user gets is a block of black that never changes. The outer page uses
 * this to show a notice in the editor (see `unplayable` in useCodeFilmPlayback).
 *
 * Report once only: the same source may be cut into a dozen clips on the timeline, each its own
 * `<video>`, and each will fail once. Reporting a dozen times would stack the same message a dozen
 * times in the UI.
 */
const reported = new Set<string>();
function reportUnplayable(src: string): void {
  if (!src || reported.has(src)) return;
  reported.add(src);
  try {
    parent.postMessage({ source: 'anim-film', type: 'media-unplayable', src }, '*');
  } catch {
    /* No outer page (the capture page opened on its own, the export page) - nobody is listening there, so dropping it is fine. */
  }
}

/**
 * Refetch a few times when loading fails - **one failure shouldn't leave this frame black until a
 * page refresh**.
 *
 * After one bad response, `<video>` writes the URL off: `networkState` stays at `NO_SOURCE`, and
 * even once the same URL works it never looks again on its own. Failures on this path are
 * **inherently temporary**: a large asset starts out as a pointer in the working tree, and the real
 * bytes wait for hydration; fetching it during those seconds fails, and a few seconds later the
 * same URL returns 206. What we observed: the whole frame black, while a fetch of the same URL at
 * that moment got the bytes.
 *
 * So this does one thing: after a failure, wait a bit and call `load()` again - that's exactly the
 * spec's button for making a media element rerun source selection, without touching the URL.
 *
 * **Don't remove src and put it back first.** It looks more thorough but backfires: `load()` with
 * no source fires an error event itself, so the retry counter gets eaten by self-inflicted errors,
 * all the attempts burn out within a few hundred ms, and the real retry never happens - behaving
 * exactly as if there were no retry at all. The `pending` flag exists for the same reason: while a
 * retry is in flight, don't let its errors queue another one.
 *
 * After reloading, the time must be restored: the freshly loaded element starts at 0 s, while the
 * footage may currently be stopped at 12 s. During playback useVideoSync corrects it every frame;
 * while stopped it doesn't - and that is the case most likely to be noticed (the user has dragged
 * to a frame and is staring at it).
 */
export function useVideoReload(
  ref: React.RefObject<HTMLVideoElement | null>,
  url: string,
  sourceMs: number,
): void {
  /* Read the time from a ref: it changes every frame, and as a dependency it would restart the retry timer every frame, so it would never fire. */
  const wantRef = React.useRef(sourceMs);
  wantRef.current = sourceMs;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let tries = 0;
    let timer = 0;
    let pending = false;

    const reload = (): void => {
      pending = false;
      const want = Math.max(0, wantRef.current / 1000);
      const back = (): void => {
        el.removeEventListener('loadedmetadata', back);
        if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
      };
      el.addEventListener('loadedmetadata', back);
      el.load();
    };

    const onError = (): void => {
      if (pending) return;
      /* Out of knocks - stop here and report why: this frame stays black from now on, and a
         silent black frame only tells the user "looks like it's still loading". (For why we don't
         give up sooner, see the comment above.) */
      if (tries >= RELOAD_WAITS_MS.length) {
        reportUnplayable(url);
        return;
      }
      pending = true;
      /* The index can't go out of bounds: the check above already rules out tries >= length. */
      timer = window.setTimeout(reload, RELOAD_WAITS_MS[tries]!);
      tries += 1;
    };

    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('error', onError);
      window.clearTimeout(timer);
    };
  }, [ref, url]);
}

/**
 * A ledger entry -> a real URL, with a clear error on the spot if given the wrong thing.
 *
 * This step has to be strict: **film code isn't type-checked** (esbuild only transpiles), so a
 * wrong shape isn't caught at compile time. Pass a whole object and React will dutifully turn it
 * into `src="[object Object]"`, the browser reports `net::ERR_FILE_NOT_FOUND`, and the picture is
 * black - and that error mentions neither the component nor the asset, so it looks like a missing
 * file. This actually happened.
 */
/**
 * A ledger entry or a path string -> a workspace-relative path.
 *
 * It returns a **relative path**, not a full URL: the capture page lives in the workspace, where a
 * relative path works as is; in the hosted product the page is on the app's domain, and the host
 * page's `<base>` points it at the file-serving route. Neither side needs a single change to the
 * film, and even hand-written `<img src="assets/x.png">` in a film is resolved against the base.
 */
function assetPath(src: VisualAsset | string, who: string): string {
  if (typeof src === 'string') return src;
  if (src && typeof src.src === 'string') return src.src;
  throw new Error(
    `<${who} src={…}> wants a ledger entry (\`m.xxx\`) or a path string, and got ${JSON.stringify(src)}.`
    + ' A ledger entry looks like { src: "assets/…", durMs: … } — most likely the name is misspelt'
    + ' and `m` has no such entry.',
  );
}

export interface VideoProps extends Omit<
  React.VideoHTMLAttributes<HTMLVideoElement>,
  'src' | 'muted' | 'autoPlay' | 'controls' | 'loop'
> {
  src: VisualAsset | string;
  /** MG-local placement in seconds. Defaults to 0. */
  at?: number;
  /** Source interval in seconds. Defaults to the complete measured video. */
  time?: readonly [number, number];
  /**
   * The second of the asset shown when this clip appears - the in point in editing terms, the first
   * number of `time` in the edit list.
   *
   * There's no out point here: the picture follows its window and plays as long as the window
   * lasts.
   */
  from?: number;
  /**
   * Drop this video's source audio.
   *
   * Use it where the video is just a visual bed and the sound comes from elsewhere - B-roll under
   * narration, or footage that's a silent scene anyway. Otherwise leave it out: an edited film
   * wants the footage's own audio.
   */
  silent?: boolean;
  /** Volume offset of the source audio (dB, relative to the file's original level). */
  gainDb?: number;
  /** Linear volume from the edit list. Only used for registration; the mix still uses gainDb. */
  volume?: number;
  /**
   * What this segment is called - the name printed on its clip in the timeline.
   *
   * Falls back to the file name. Once a long asset is cut into six segments, six clips all named
   * `raw-talk` can't be told apart, yet when the user says "move the boss's line earlier" they mean
   * one specific clip. Same purpose as `<Seq label>`.
   */
  label?: string;
  /**
   * Total file length (ms). The edit list knows element durations; including it at registration
   * lets the timeline clamp edge drags. Can be omitted when the ledger entry has its own `durMs` -
   * registration copies that one.
   */
  sourceDurMs?: number;
  /** This clip's id in the edit list. Only used for registration; not passed to `<video>`. */
  clipId?: string;
  /**
   * What this footage says, per-word timings, and who says it - the three ledger fields.
   *
   * Not needed when `src` is a ledger entry (`m.take`); they're read from there. On the edit-list
   * path `src` is a path string, and doc.tsx looks these up and passes them in.
   */
  text?: string;
  words?: readonly SpokenWord[];
  cast?: string;
  /** Canvas-layer translate / scale / rotate. Only used for registration; rendering happens in the outer layer. */
  layer?: import('@animspark/core').FilmTransform;
  z?: number;
  /** Source location injected at compile time - don't write it yourself (see jsx-dev-runtime). */
  __loc?: string;
}

export function Video(props: VideoProps): React.ReactElement | null {
  const composition = React.useContext(MgCompositionContext);
  if (composition) return <MgVideo {...props} composition={composition} />;
  if (props.at !== undefined || props.time !== undefined) throw new Error('Video at/time are MG-local parameters; use this Video inside an MG component.');
  return <NativeVideo {...props} />;
}

type MgComposition = NonNullable<React.ContextType<typeof MgCompositionContext>>;

/** Video and its original sound use the same validated placement and trim. */
function MgVideo({ composition, ...props }: VideoProps & { composition: MgComposition }): React.ReactElement | null {
  const id = React.useId();
  const clipId = React.useContext(FilmClipIdContext);
  const src = assetPath(props.src, 'Video');
  if (props.from !== undefined) throw new Error(`Video "${src}": use time: [sourceStart, sourceEnd] inside an MG, instead of from.`);
  if (props.gainDb !== undefined && !Number.isFinite(props.gainDb)) throw new Error(`Video "${src}": gainDb must be finite.`);
  const legacyGain = props.gainDb === undefined ? 1 : 10 ** (props.gainDb / 20);
  const volume = props.volume === undefined ? 1 : props.volume;
  if (!Number.isFinite(volume) || volume < 0) throw new Error(`Video "${src}": volume must be a finite nonnegative number.`);
  const effectiveVolume = props.silent ? 0 : volume * legacyGain;
  const known = composition.assets[src];
  const ledger = typeof props.src === 'object' ? props.src : undefined;
  const knownMs = props.sourceDurMs ?? ledger?.durMs;
  const full = known?.dur ?? (knownMs === undefined ? undefined : knownMs / 1000);
  const assets = { [src]: { ...known, dur: full, text: props.text ?? known?.text ?? ledger?.text, words: props.words ?? known?.words ?? ledger?.words } };
  const sound = planMgSoundClips([{ id: 'video', kind: 'voice', src, at: props.at, time: props.time, volume: effectiveVolume }],
    composition.durationSec, assets, {
      id: `${composition.instanceId}/${id}`, at: composition.startMs / 1000,
      time: [composition.fromMs / 1000, (composition.fromMs + composition.durMs) / 1000],
      loc: composition.loc, ...(clipId ? { clipId } : {}),
    })[0];
  if (!sound) return null;
  return <MgVideoEntry {...props} source={src} sound={sound} volume={effectiveVolume} />;
}

function MgVideoEntry({ source, sound, volume, label, layer, z, cast, src, style, ...props }: VideoProps & {
  source: string; sound: PlannedMgSound; volume: number;
}): React.ReactElement | null {
  const now = useFilmTimeMs();
  const collecting = useCollecting();
  const visible = useWindowShows(sound.startMs, sound.durMs);
  useRegisterMedia({
    key: sound.key, src: source, startMs: sound.startMs, durMs: sound.durMs, inMs: sound.inMs,
    sourceDurMs: sound.sourceDurMs, loc: sound.loc, clipId: sound.clipId, volume,
    ...(sound.off ? { silent: true } : {}), ...(sound.gainDb !== undefined ? { gainDb: sound.gainDb } : {}),
    ...(label ? { label } : {}), ...(layer ? { transform: layer } : {}), ...(z !== undefined ? { z } : {}),
  });
  useRegisterSound(sound);
  useRegisterSpokenCaptions({
    text: sound.off ? undefined : sound.text, words: sound.words, src: sound.src,
    sourceDurMs: sound.sourceDurMs, fromMs: sound.inMs, startMs: sound.startMs, durMs: sound.durMs,
    speaker: cast ?? (typeof src === 'object' ? src.cast : undefined), loc: sound.loc,
  });
  if (!collecting && !visible) return null;
  const { at: _at, time: _time, from: _from, silent: _silent, gainDb: _gainDb, sourceDurMs: _sourceDurMs,
    clipId: _clipId, text: _text, words: _words, __loc: _loc, ...attributes } = props;
  // At a stopped film end, retain the last decodable frame rather than seeking
  // exactly past the selected source interval.
  const localMs = Math.max(0, Math.min(now - sound.startMs, sound.durMs - 0.001));
  return <VideoFrame url={source} sourceMs={sound.inMs + localMs}
    sourceWindow={{ inMs: sound.inMs, outMs: sound.inMs + sound.durMs }} style={style} {...attributes} />;
}

function NativeVideo({
  src, from = 0, silent = false, gainDb, volume, label,
  sourceDurMs, clipId, layer, z,
  text, words, cast,
  __loc, style, ...rest
}: VideoProps): React.ReactElement {
  const url = assetPath(src, 'Video');
  const inMs = toMs(from);
  const ledger = typeof src === 'object' && src ? src : undefined;
  /* Picture and source audio are both registered as "follow the window": they span the whole window, exactly the same range. */
  const span = useSpanMs();
  const start = useSpanStartMs();
  const ledgerDur = typeof src === 'object' && src && src.durMs != null && src.durMs > 0
    ? src.durMs
    : undefined;
  const nativeMs = sourceDurMs ?? ledgerDur;
  useRegisterMedia({
    src: url,
    startMs: start,
    durMs: span,
    inMs,
    ...(nativeMs != null ? { sourceDurMs: nativeMs } : {}),
    ...(label ? { label } : {}),
    ...(__loc ? { loc: __loc } : {}),
    ...(clipId ? { clipId } : {}),
    ...(layer ? { transform: layer } : {}),
    ...(z != null ? { z } : {}),
    ...(silent ? { silent: true } : {}),
    ...(gainDb != null ? { gainDb } : {}),
    ...(volume != null ? { volume } : {}),
  });
  useRegisterSound(silent ? null : {
    kind: 'voice',
    src: url,
    startMs: start,
    durMs: span,
    inMs,
    ...(gainDb != null ? { gainDb } : {}),
    ...(__loc ? { loc: __loc } : {}),
  });
  /* If the source audio plays, its captions should appear too - they're two renderings of the
     same speech, and this audio is the only voice the user hears in the film. `silent` ones don't
     count: the picture is just a bed and the sound comes from elsewhere. */
  useRegisterSpokenCaptions({
    text: silent ? undefined : text ?? ledger?.text,
    words: words ?? ledger?.words,
    src: typeof src === 'string' ? src : ledger?.src,
    sourceDurMs: nativeMs,
    fromMs: inMs,
    startMs: start,
    durMs: span,
    speaker: cast ?? ledger?.cast,
    loc: __loc,
  });
  const sourceMs = inMs + useLocalMs();
  return <VideoFrame url={url} sourceMs={sourceMs}
    sourceWindow={{ inMs, outMs: inMs + span }} style={style} {...rest} />;
}

/**
 * Direct media URL for a local project's footage in the desktop app shell
 * (`anim-media://p/<id>/assets/...`). Returns null when unavailable, falling back to `<base>`.
 *
 * The host page sets `__FILM_MEDIA_BASE__` only after confirming the outer page really is the
 * desktop shell (see client-compile / desktopMediaBase in gen-video). Only paths under `assets/`
 * qualify: those are the user's assets, and that copy on disk is the real one. Other paths
 * (published MG outputs and the like) aren't in the user's folder and still take the normal route.
 */
export function directMediaUrl(url: string): string | null {
  const base = typeof window === 'undefined'
    ? undefined
    : (window as { __FILM_MEDIA_BASE__?: unknown }).__FILM_MEDIA_BASE__;
  if (typeof base !== 'string' || !base || !url.startsWith('assets/')) return null;
  return base + url.split('/').map(encodeURIComponent).join('/');
}

function VideoFrame({ url, sourceMs, sourceWindow, style, ...rest }: Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> & {
  url: string; sourceMs: number; sourceWindow: VideoSourceWindow;
}): React.ReactElement {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  const targetMs = clampVideoSourceMs(sourceMs, sourceWindow);
  /* If the direct URL fails (the shell's protocol isn't wired up, or the file uses a codec this
     machine can't decode - the normal route serves a transcoded copy), fall back to the normal
     route, once. After falling back src has changed, so the retry ladder starts over (see
     useVideoReload). */
  const direct = directMediaUrl(url);
  const [directFailed, setDirectFailed] = React.useState(false);
  const src = direct && !directFailed ? direct : url;
  useVideoSync(ref, targetMs, useFilmPlaying(), sourceWindow);
  useVideoReload(ref, src, targetMs);
  return (
    <video
      {...rest}
      ref={ref}
      src={src}
      /* Cross-origin footage without CORS would taint the canvas: capture, thumbnails and export all read pixels from this frame. */
      {...(src === direct ? { crossOrigin: 'anonymous' as const } : {})}
      onError={src === direct ? () => setDirectFailed(true) : rest.onError}
      muted
      autoPlay={false}
      controls={false}
      loop={false}
      playsInline
      preload="auto"
      /* `...style` goes last: composition is the agent's job, this only provides the default layout.
         contain doesn't crop: portrait footage shows the full frame, with black bars when the
         aspect ratio doesn't match - users see exactly what they uploaded. For a full-bleed crop
         the agent overrides objectFit explicitly. */
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        ...style,
      }}
    />
  );
}

/* Timeline clips must be able to point back to their source line - the custom jsx runtime
   recognizes this marker and injects `__loc` into them (see jsx-dev-runtime). Unmarked components
   are forwarded unchanged, so an unknown prop doesn't leak all the way to the DOM. */
Video.__animTracked = true;

export interface StillProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>, 'src'
> {
  src: VisualAsset | string;
  label?: string;
  clipId?: string;
  layer?: import('@animspark/core').FilmTransform;
  z?: number;
  __loc?: string;
}

/**
 * A still image on a picture track.
 *
 * It sits on the same kind of track as `<Video>` and goes through the same registration, so the
 * timeline, layer selection and effects need no changes. What it lacks are things it never had: no
 * audio (no sound registration, no source-audio captions), no in point (a constant source is the
 * same wherever you sample it), and no clock syncing (`useVideoSync` would have nothing to do).
 *
 * **No `sourceDurMs`** - the most important line in this component, and since it's something
 * *not* written, it's especially easy for some future refactor to "complete" it. That field means
 * "how long the file is", and a jpg has no length: a clip's `time: [0, 8]` is **how long this clip
 * lasts**, not how long the image is. Mixing them up costs more than a wrong display -
 * `recordFilmFacts` writes the registered `sourceDurMs` back to the asset ledger as that asset's
 * duration, so the disk ends up saying "this jpg is 8 seconds long". The ledger is where everyone
 * looks up facts later; writing a made-up fact into it is far worse than writing nothing (same
 * reasoning as the `from.prompt` field).
 *
 * Its absence is also the answer the timeline needs: no upper bound, so the right edge can be
 * dragged out indefinitely.
 */
export function Still({
  src, label, clipId, layer, z, __loc, style, ...rest
}: StillProps): React.ReactElement {
  const url = assetPath(src, 'Still');
  const span = useSpanMs();
  const start = useSpanStartMs();
  useRegisterMedia({
    src: url,
    startMs: start,
    durMs: span,
    inMs: 0,
    ...(label ? { label } : {}),
    ...(__loc ? { loc: __loc } : {}),
    ...(clipId ? { clipId } : {}),
    ...(layer ? { transform: layer } : {}),
    ...(z != null ? { z } : {}),
    /* Register as silent: the mix shouldn't open a track for an image, and the inspector's mute toggle shouldn't light up for it. */
    silent: true,
  });
  return (
    <img
      src={url}
      alt=""
      /* Laid out exactly like <Video>: contain doesn't crop, with black bars when the aspect ratio
         doesn't match. For a full-bleed crop the agent overrides objectFit explicitly - both kinds
         of picture follow the same composition rules; being an image is no reason for an exception. */
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        ...style,
      }}
      {...rest}
    />
  );
}

Still.__animTracked = true;
