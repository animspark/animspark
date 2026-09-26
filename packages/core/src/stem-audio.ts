/**
 * animspark-stem-audio/1: the stem audio manifest + a Web Audio stem player.
 *
 * Why stems: a film's audio used to be a single FFmpeg-premixed `audio.m4a`, so even "change one
 * line of narration" re-ran the whole TTS → mix → AAC re-encode → bundle chain (a dozen-plus seconds
 * in practice). But every piece was already a separate file in the build directory (per-line TTS
 * slices, music, sound effects); premixing just welded them together. Handing the manifest to the
 * browser and letting Web Audio schedule at runtime means changing one line only resynthesizes that
 * line. Editing needs no bundling at all, and bundling is reserved for publishing.
 *
 * Measurements (2026-08-03, atelier, 123s, ten shots):
 *   - per-line placement accuracy within a 0.06ms range; the reassembly vs FFmpeg `narration.wav`
 *     correlation is 0.9987;
 *   - sum of three tracks vs the final mix: corr 0.972 / level difference 0.66dB; the residual comes
 *     from bus glue + limiting (a publishing step);
 *   - real-time clock drift of 0.4ms over 20s; rescheduling every source on seek takes 0.4ms;
 *     scheduling 500 voices at once takes 9.8ms.
 *
 * Clock ownership: AudioContext.currentTime is the single master clock. The picture (GSAP) follows
 * it and stems hang off it too, so both share a source. This is steadier than the old approach of
 * using `<audio>.currentTime` as the clock (that reading is coarse-grained).
 */

import { z } from 'zod';
import { timeStretchBuffer } from './time-stretch';

// ──────────────────────────────────────────────────────────────
//  Manifest
// ──────────────────────────────────────────────────────────────

export const STEM_AUDIO_FORMAT = 'animspark-stem-audio/1' as const;

/** Track kinds. voice triggers ducking; music/sfx can be ducked. */
export const STEM_TRACK_KINDS = ['voice', 'music', 'sfx'] as const;
export type StemTrackKind = (typeof STEM_TRACK_KINDS)[number];

export const stemTrackSchema = z.object({
  id: z.string(),
  kind: z.enum(STEM_TRACK_KINDS),
  /** Static track gain (dB). Corresponds to that column in tracks.json. */
  gainDb: z.number().default(0),
  /**
   * When set, this track is ducked by the voice track: lowered by this many dB (negative) during
   * speech. Recreates the feel of FFmpeg sidechain compression with a precomputed automation curve:
   * Web Audio has no native sidechain, and we already know exactly where every line is, so there is no
   * need to infer it by signal detection.
   */
  duckDb: z.number().optional(),
});
export type StemTrack = z.infer<typeof stemTrackSchema>;

export const stemClipSchema = z.object({
  id: z.string(),
  /** Path relative to the manifest's baseUrl. */
  url: z.string(),
  track: z.string(),
  /**
   * Absolute start in the film (ms, fractions allowed).
   * Must not be rounded to whole ms: at 48kHz, 0.5ms = 24 samples, enough to misalign waveforms.
   */
  startMs: z.number(),
  /**
   * Clip duration (ms). 0 = unknown (e.g. the build could not read an mp3 header); after decoding,
   * the player always uses the AudioBuffer's actual length.
   */
  durationMs: z.number(),
  /** Per-clip gain adjustment (dB); defaults to 0. */
  gainDb: z.number().optional(),
  /**
   * The millisecond of the source at which to start.
   *
   * Its presence means the clip is trimmed: the player plays exactly [inMs, inMs+durationMs) and
   * stops at the out point. Old manifests lack this field (each audio file is one whole line), and
   * their behavior is unchanged: the clip plays until the source ends naturally, avoiding a click
   * from a hard cut on the tail at a millisecond duration.
   */
  inMs: z.number().optional(),
  /**
   * Fade in / fade out (ms).
   *
   * Hard-cutting into a recording with a noise floor pops, and music ending abruptly sounds like
   * the plug was pulled; these two numbers remove that. They describe this clip's own head and tail,
   * independent of where it sits in the film; if they add up to more than the clip length, each is
   * scaled proportionally so the fade-out does not start before the fade-in finishes.
   */
  fadeInMs: z.number().min(0).optional(),
  fadeOutMs: z.number().min(0).optional(),
  /** Owning shot; used for locating clips when shots are added/removed or hot-swapped per shot. */
  shot: z.number().optional(),
  /**
   * Switched off, but **kept in the manifest**.
   *
   * Muting a track used to remove its clips from the manifest. The set of urls then changed,
   * `sameStemSources` reported a difference, and a single mute tore down and rebuilt the whole
   * player (re-downloading and re-decoding); when the only clip was removed, the player became null
   * and unmuting had nothing to revive. Keeping the clip with a flag makes mute/unmute a cheap
   * retime: the samples are still in hand, and rescheduling brings the sound back. Scheduling
   * (planStemSchedule) and ducking (collectVoiceIntervals) both skip flagged clips.
   */
  muted: z.boolean().optional(),
});
export type StemClip = z.infer<typeof stemClipSchema>;

export const stemAudioManifestSchema = z.object({
  format: z.literal(STEM_AUDIO_FORMAT),
  totalMs: z.number(),
  /** Duration of each shot (ms), in playback order. The picture timeline is derived from this rather than baked into the HTML. */
  shotDurationsMs: z.array(z.number()).optional(),
  tracks: z.array(stemTrackSchema),
  clips: z.array(stemClipSchema),
  /** Ducking envelope parameters; defaults to DEFAULT_DUCK. */
  duck: z.object({
    attackMs: z.number(),
    releaseMs: z.number(),
    /** Adjacent speech closer than this is merged into one interval, avoiding pumping between phrases. */
    mergeGapMs: z.number(),
  }).partial().optional(),
});
export type StemAudioManifest = z.infer<typeof stemAudioManifestSchema>;

/**
 * Ducking defaults, matching the feel of the BGM-stage sidechaincompress in mix-tracks.ts: shallow
 * reduction, fast attack, medium release, so the music comes back up at pauses between phrases
 * without being hollowed out.
 */
export const DEFAULT_DUCK = { attackMs: 120, releaseMs: 260, mergeGapMs: 420 } as const;

// ──────────────────────────────────────────────────────────────
//  Pure functions: scheduling and ducking (no Web Audio dependency, testable in Node)
// ──────────────────────────────────────────────────────────────

export interface ScheduledClip {
  clip: StemClip;
  /** Start time relative to the scheduling base (seconds). */
  startAtSec: number;
  /** Second within the clip at which to start (clips straddling the start point are entered midway). */
  clipOffsetSec: number;
  /** Play only this long (seconds); trimmed clips stop at the out point. Omitted = play until the source ends naturally. */
  playDurSec?: number;
}

/**
 * Clamps a clip's duration to what the source actually has.
 *
 * For trimmed clips (with inMs) the document is authoritative and only the upper bound is clamped:
 * the out point cannot pass the end of the source. Untrimmed clips are the reverse: in old manifests
 * one audio file is one whole line, and `durationMs` may be 0 or an upper bound estimated from the
 * total, so the source is the ground truth.
 */
export function clampClipToSource(clip: StemClip, srcMs: number): StemClip {
  const room = Math.max(0, srcMs - (clip.inMs ?? 0));
  if (clip.inMs == null) return { ...clip, durationMs: room };
  return clip.durationMs <= room ? clip : { ...clip, durationMs: room };
}

/**
 * Which clips to play from fromMs onward, and how to cut each.
 *
 * Clips already finished are skipped; clips straddling fromMs are entered midway. That is why
 * seeking into the middle of a sentence picks the sound up at that very word instead of replaying
 * the whole line.
 *
 * Clips with inMs (trimmed by the document model) have one more rule: the out point is hard too, and
 * playback stops at durationMs. Otherwise, after shortening a music clip on the timeline, you would
 * still hear it playing on.
 *
 * **`clipOffsetSec` / `playDurSec` are seconds in the source; `startAtSec` is seconds on the
 * timeline.**
 */
export function planStemSchedule(clips: readonly StemClip[], fromMs: number): ScheduledClip[] {
  const out: ScheduledClip[] = [];
  for (const clip of clips) {
    if (clip.muted) continue;
    if (!(clip.durationMs > 0)) continue;
    const endMs = clip.startMs + clip.durationMs;
    if (endMs <= fromMs) continue;
    const trimmed = clip.inMs != null;
    const inSec = (clip.inMs ?? 0) / 1000;
    if (clip.startMs >= fromMs) {
      out.push({
        clip,
        startAtSec: (clip.startMs - fromMs) / 1000,
        clipOffsetSec: inSec,
        ...(trimmed ? { playDurSec: clip.durationMs / 1000 } : {}),
      });
    } else {
      const skipSec = (fromMs - clip.startMs) / 1000;
      out.push({
        clip,
        startAtSec: 0,
        clipOffsetSec: inSec + skipSec,
        ...(trimmed ? { playDurSec: clip.durationMs / 1000 - skipSec } : {}),
      });
    }
  }
  return out;
}

/**
 * How many milliseconds this clip's fade-in and fade-out actually take.
 *
 * Fades adding up to more than the clip length are routine while editing (trimming music with a
 * 2-second fade-out down to 1 second). They are scaled proportionally rather than truncated:
 * truncation would let whichever comes first take everything and leave nothing for the other, which
 * sounds half-finished.
 */
export function clipFadeMs(clip: Pick<StemClip, 'durationMs' | 'fadeInMs' | 'fadeOutMs'>): {
  inMs: number;
  outMs: number;
} {
  const dur = Math.max(0, clip.durationMs);
  const wantIn = Math.max(0, clip.fadeInMs ?? 0);
  const wantOut = Math.max(0, clip.fadeOutMs ?? 0);
  const total = wantIn + wantOut;
  if (!dur || !total) return { inMs: Math.min(wantIn, dur), outMs: Math.min(wantOut, dur) };
  if (total <= dur) return { inMs: wantIn, outMs: wantOut };
  const k = dur / total;
  return { inMs: wantIn * k, outMs: wantOut * k };
}

export interface StemInterval { startMs: number; endMs: number }

/**
 * Intervals occupied by speech (merged by mergeGapMs).
 * Merging is necessary: two lines in a shot may be only 300 milliseconds apart, and without merging
 * the music would dip and recover in between, which sounds like pumping.
 */
export function collectVoiceIntervals(
  manifest: Pick<StemAudioManifest, 'tracks' | 'clips'>,
  mergeGapMs: number = DEFAULT_DUCK.mergeGapMs,
): StemInterval[] {
  const voiceTracks = new Set(
    manifest.tracks.filter((t) => t.kind === 'voice').map((t) => t.id),
  );
  const raw = manifest.clips
    /* Muted clips do not trigger ducking: switched-off voiceover should not keep pushing the music down. */
    .filter((c) => !c.muted && voiceTracks.has(c.track) && c.durationMs > 0)
    .map((c) => ({ startMs: c.startMs, endMs: c.startMs + c.durationMs }))
    .sort((a, b) => a.startMs - b.startMs);

  const merged: StemInterval[] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv.startMs - last.endMs <= mergeGapMs) {
      if (iv.endMs > last.endMs) last.endMs = iv.endMs;
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

export interface StemAutomationPoint { tMs: number; gain: number }

/**
 * Ducking automation curve. Semantics follow FFmpeg sidechain compression: full reduction within
 * attack after speech starts, back up within release after it stops. Each speech interval produces
 * only 4 points, a few dozen for a whole film, so the manifest does not bloat (compare: a dense
 * curve precomputed at a 64-sample step would be 90,000 points).
 *
 * Curve times must be non-decreasing: `linearRampToValueAtTime` throws when time goes backwards, and
 * the whole track goes silent on the spot. Two situations would go backwards, both handled here:
 *   1. the next speech starts before the release finishes → merge them (holding the duck beats
 *      pumping);
 *   2. the speech is shorter than the attack → the fully-ducked time is clamped to the end of the
 *      interval.
 */
export function planDuckAutomation(
  intervals: readonly StemInterval[],
  opts: { duckDb: number; attackMs?: number; releaseMs?: number },
): StemAutomationPoint[] {
  const attackMs = opts.attackMs ?? DEFAULT_DUCK.attackMs;
  const releaseMs = opts.releaseMs ?? DEFAULT_DUCK.releaseMs;
  const ducked = Math.pow(10, opts.duckDb / 20);

  const merged: StemInterval[] = [];
  for (const iv of [...intervals].sort((a, b) => a.startMs - b.startMs)) {
    const last = merged[merged.length - 1];
    if (last && iv.startMs - last.endMs < releaseMs + attackMs) {
      if (iv.endMs > last.endMs) last.endMs = iv.endMs;
    } else {
      merged.push({ startMs: Math.max(0, iv.startMs), endMs: iv.endMs });
    }
  }

  const pts: StemAutomationPoint[] = [{ tMs: 0, gain: 1 }];
  for (const iv of merged) {
    const prev = pts[pts.length - 1]!;
    if (prev.tMs < iv.startMs) pts.push({ tMs: iv.startMs, gain: 1 });
    const downEnd = Math.min(iv.startMs + attackMs, iv.endMs);
    if (downEnd > prev.tMs || pts[pts.length - 1]!.tMs < downEnd) pts.push({ tMs: downEnd, gain: ducked });
    if (iv.endMs > downEnd) pts.push({ tMs: iv.endMs, gain: ducked });
    pts.push({ tMs: iv.endMs + releaseMs, gain: 1 });
  }
  return pts;
}

/**
 * Whether two manifests need the same **sources** and **tracks**.
 *
 * If so, the new one merely moves or resizes the same sounds: the decoded samples are still usable,
 * and so is the audio graph already wired up (see `StemAudioPlayer.retime`). Only these two things
 * are compared:
 *
 *   · **Sources**: decoded results are keyed by url, so if the set of urls is unchanged, not a single
 *     byte needs refetching. Clip ids, positions, lengths, trim points and gains do not affect this;
 *     they are scheduling concerns, and scheduling is redone on every seek anyway.
 *   · **Tracks**: gain nodes are built per track, so if the list of tracks or their parameters
 *     change, the graph must be rewired. That is rare while editing (it takes deleting the last music
 *     clip in the whole film), not worth an in-place graph update path.
 */
export function sameStemSources(
  a: Pick<StemAudioManifest, 'tracks' | 'clips'>,
  b: Pick<StemAudioManifest, 'tracks' | 'clips'>,
): boolean {
  const urls = (m: typeof a): string => [...new Set(m.clips.map((c) => c.url))].sort().join('\n');
  if (urls(a) !== urls(b)) return false;
  const tracks = (m: typeof a): string => m.tracks
    .map((t) => `${t.id}\t${t.kind}\t${t.gainDb ?? 0}\t${t.duckDb ?? ''}`)
    .sort()
    .join('\n');
  return tracks(a) === tracks(b);
}

/** The curve's value at a given time (linear interpolation); a seek landing mid-ramp must start from the right value. */
export function duckGainAt(points: readonly StemAutomationPoint[], tMs: number): number {
  if (points.length === 0) return 1;
  const first = points[0]!;
  if (tMs <= first.tMs) return first.gain;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (tMs <= b.tMs) {
      const span = b.tMs - a.tMs;
      if (span <= 0) return b.gain;
      return a.gain + (b.gain - a.gain) * ((tMs - a.tMs) / span);
    }
  }
  return points[points.length - 1]!.gain;
}

/** Derives each shot's start in the film (ms) from shot durations. The timeline is recomputed from this after shots are added or removed. */
export function shotStartsMs(shotDurationsMs: readonly number[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const d of shotDurationsMs) {
    out.push(t);
    t += d;
  }
  return out;
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

// ──────────────────────────────────────────────────────────────
//  Player
// ──────────────────────────────────────────────────────────────

/**
 * How large a source can be before it is no longer decoded in full.
 *
 * `decodeAudioData` needs the **whole file**, and it produces raw float32 samples: an hour of 48k
 * stereo is 1.4 GB. Compressed sources expand ten to several dozen times when decoded, so placing a
 * two-hour interview on the timeline would need two or three GB in the tab just to hear it. That is
 * not slow; it crashes.
 *
 * The limit is in **bytes** rather than duration because the cut must happen before decoding:
 * duration is known only after decoding, and by then the memory is already spent. The byte count is
 * in the response headers (Content-Length); its ratio to decoded size varies by codec (about 2× for
 * WAV, dozens of times for AAC), so this is not a precise threshold but a safety valve: regular
 * assets under 24 MiB (narration, sound effects, a few minutes of music) take the usual path, and
 * anything larger streams instead (see the media element branch in scheduleFrom), with memory
 * managed by the browser.
 */
export const STEM_DECODE_MAX_BYTES = 24 * 1024 * 1024;

/**
 * Lossy compressed sources (mp3 / aac / opus…) get a tighter valve.
 *
 * The 24 MiB limit is based on WAV's expansion (about 2× when decoded). A 24 MiB 128 kbps mp3 is
 * twenty-five minutes, which decodes to over 500 MB of 48k stereo float32: one music track could
 * crash the tab. Lossy sources are capped at 8 MiB (about eight minutes at that bitrate, around 180
 * MB decoded); anything longer streams, with memory left to the browser. Applies only when the
 * caller does not pass `decodeMaxBytes` explicitly.
 */
export const STEM_DECODE_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;

/**
 * Decoded samples, shared across players.
 *
 * Players are rebuilt wholesale (one more sound on the timeline = the set of sources changed), and
 * each rebuild used to refetch and re-decode **every** track (ten stems took 400 milliseconds to
 * start, and the decoded samples took another copy of memory); on the editor page, the main view and
 * the compound-clip view each decoded separately too. Decoded buffers are remembered by "url +
 * server ETag + sample rate": a matching ETag means the same bytes, so the buffer is reused.
 * Responses without an ETag are not cached: paths get overwritten in place (a re-recorded
 * narration is still 01.m4a), and matching by url alone would play the previous version.
 *
 * Capped by sample bytes; the most recently used entries are kept.
 */
const DECODED_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const decodedCache = new Map<string, { buf: AudioBuffer; bytes: number }>();
let decodedCacheBytes = 0;

function decodedKey(url: string, etag: string | null | undefined, sampleRate: number): string | null {
  return etag ? `${url}\n${etag}\n${sampleRate}` : null;
}

function takeDecoded(key: string | null): AudioBuffer | null {
  if (!key) return null;
  const hit = decodedCache.get(key);
  if (!hit) return null;
  decodedCache.delete(key);
  decodedCache.set(key, hit);
  return hit.buf;
}

function keepDecoded(key: string | null, buf: AudioBuffer): void {
  if (!key || decodedCache.has(key)) return;
  const raw = buf.length * buf.numberOfChannels * 4;
  const bytes = Number.isFinite(raw) ? raw : 0;
  if (bytes > DECODED_CACHE_MAX_BYTES / 2) return;
  decodedCache.set(key, { buf, bytes });
  decodedCacheBytes += bytes;
  for (const [k, v] of decodedCache) {
    if (decodedCacheBytes <= DECODED_CACHE_MAX_BYTES) break;
    decodedCache.delete(k);
    decodedCacheBytes -= v.bytes;
  }
}

const COMPRESSED_AUDIO_RE = /^audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac|ogg|opus|webm)|^video\/(mp4|webm|quicktime)/i;

/**
 * How long to wait before retrying a sound that failed to fetch. No more retries once these run out.
 *
 * The same schedule as the picture side (see RELOAD_WAITS_MS in film-runtime), because the failure
 * has the same cause: a large asset is first a pointer in the working tree, and its real bytes arrive
 * only after hydration, so fetching it during those seconds is bound to fail. About 19 seconds in
 * total.
 */
export const STEM_REFETCH_WAITS_MS = [400, 1000, 2500, 5000, 10000] as const;

export interface StemAudioPlayerOptions {
  manifest: StemAudioManifest;
  /** Base for relative clip urls (usually the manifest's directory). */
  baseUrl?: string;
  context?: AudioContext;
  onEnded?: () => void;
  onError?: (err: Error) => void;
  /**
   * Scheduling lookahead (seconds). The time given to start() must be in the future, or the browser
   * treats it as "play immediately" and the clip starts slightly early. 50ms comfortably covers the JS
   * cost of one scheduling pass (measured at 0.4ms).
   */
  lookaheadSec?: number;
  /**
   * Also compute waveform envelopes (see `waveforms`).
   *
   * Off by default. The editing timeline's waveform no longer comes from here: it uses the server's
   * peaks sidecar (about 3 KB of JSON, `/film/wave/`), with no need for the browser to decode
   * samples. Only the packaged-film playback chain (video-player) still uses this, so it remains as a
   * switch instead of being removed.
   *
   * Computing it scans every channel's samples from start to end, which alone takes a few hundred
   * milliseconds on long assets.
   */
  waveforms?: boolean;
  /** Above this many bytes, stream instead of decoding in full. Defaults to STEM_DECODE_MAX_BYTES. */
  decodeMaxBytes?: number;
}

interface TrackNodes { duck: GainNode; out: GainNode; automation: StemAutomationPoint[] | null }

/** A streamed clip: an `<audio>` element plus the node that connects it to the graph. */
interface StreamVoice {
  el: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  timers: Array<ReturnType<typeof setTimeout>>;
  /** Alignment callback fired once enough is buffered; must be removed on teardown (see align in scheduleStream). */
  onCanPlay: () => void;
  onMetadata: () => void;
}

/**
 * Which kinds of sound are muted or soloed while monitoring.
 *
 * Affects only how this machine plays right now, never the film: rendering goes through a different
 * chain (mix-tracks) that does not read it. "Mute the music to hear the voiceover" is an everyday
 * editing move, but it must not quietly change the delivered film.
 */
export interface StemMix {
  muted: readonly StemTrackKind[];
  solo: readonly StemTrackKind[];
}

export const EMPTY_STEM_MIX: StemMix = { muted: [], solo: [] };

/**
 * How many milliseconds one peak bin represents.
 *
 * 5 milliseconds: at the closest zoom level (0.4 px/ms) a bin is about two pixels wide, and anything
 * finer cannot be drawn. For a one-minute film, all clips together take a dozen-odd KB; saving that
 * memory is not worth waveforms breaking into blocks when zoomed in.
 */
export const STEM_PEAK_BIN_MS = 5;

/**
 * What a sound looks like when drawn: the loudest moment in each bin.
 *
 * Keeps only the envelope, not the samples. A sound on the timeline is at most a few hundred pixels
 * wide, while raw audio has over forty thousand points per second; carrying samples all the way to
 * the UI and recomputing on every redraw would redo the same work every frame. The envelope is
 * computed once and lasts; zooming just reads it at a different density.
 */
export interface StemWaveform {
  binMs: number;
  /** Peak of each bin, 0–255. */
  peaks: Uint8Array;
}

/**
 * Decoded audio → envelope.
 *
 * Multichannel audio takes the maximum across channels rather than the average: a line may sit on
 * only one side (as with mono material on a stereo track), and averaging would draw it at half
 * height, as if it were spoken quietly.
 */
export function stemWaveform(buffer: AudioBuffer, binMs: number = STEM_PEAK_BIN_MS): StemWaveform {
  const perBin = Math.max(1, Math.round((buffer.sampleRate * binMs) / 1000));
  const bins = Math.max(1, Math.ceil(buffer.length / perBin));
  const peaks = new Uint8Array(bins);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < bins; i += 1) {
      const from = i * perBin;
      const to = Math.min(data.length, from + perBin);
      let peak = 0;
      for (let s = from; s < to; s += 1) {
        const v = data[s]! < 0 ? -data[s]! : data[s]!;
        if (v > peak) peak = v;
      }
      // Float audio may exceed 1 (not yet limited); anything out of range is drawn at full height.
      const scaled = peak >= 1 ? 255 : Math.round(peak * 255);
      if (scaled > peaks[i]!) peaks[i] = scaled;
    }
  }
  return { binMs, peaks };
}

/**
 * A stem manifest → one fully mixed audio track (offline rendering).
 *
 * Export needs a complete audio track, and editing has none: the sound is dozens of clips assembled
 * live by the player. Without this step, a user who edits a film on the timeline and presses export
 * gets a silent film (the export page cannot find `manifest.audio` and ends up with no sound).
 *
 * Placement is identical to `StemAudioPlayer.scheduleFrom` and computed by the same pure functions
 * (planStemSchedule / clipFadeMs / planDuckAutomation): **what you hear and what you export must be
 * the same film**. With separate implementations, the day they diverge the user says "the music got
 * quieter after export", and neither side can say which is right.
 *
 * The caller fetches the assets (the export page has its own same-origin proxy and auth); this
 * function only decodes and places them.
 */
export async function renderStemMix(opts: {
  manifest: StemAudioManifest;
  /** Clip url → a fetchable absolute URL. */
  resolveUrl: (url: string) => string;
  fetchBytes: (url: string) => Promise<ArrayBuffer>;
  /** Defaults to 48k, matching the export encoding and saving a resample. */
  sampleRate?: number;
  /** A standalone asset export must not deliver with a clip missing; existing callers such as playback keep per-clip fault tolerance. */
  strict?: boolean;
}): Promise<AudioBuffer | null> {
  const { manifest } = opts;
  const Offline = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext;
  if (!Offline) throw new Error('no Web Audio in this environment, cannot mix');
  const totalMs = Math.max(0, manifest.totalMs);
  if (!totalMs || !manifest.clips.length) return null;

  const sampleRate = opts.sampleRate ?? 48_000;
  /* Leave half a second of tail: the last clip's fade-out and the duck's release may sit right on the total length, and cutting exactly there would clip them. */
  const frames = Math.ceil(((totalMs + 500) / 1000) * sampleRate);
  const ctx = new Offline(2, frames, sampleRate);

  /**
   * One at a time, not concurrently.
   *
   * This used to be `Promise.all`: every asset downloaded and decoded at once, so peak memory was the
   * sum of **all** decoded samples. Export is already the most memory-hungry step on the machine (the
   * offline context itself holds the whole film as stereo float), and stacking that on top meant films
   * with long assets lost the tab halfway through.
   *
   * Queued, the peak is the largest single clip rather than all clips combined. Export runs in the
   * background: nobody watches it being a bit slower, but if it crashes the film cannot be exported.
   */
  const buffers = new Map<string, AudioBuffer>();
  /* Muted clips are not fetched: the offline mix is one-shot and they never enter the graph, so downloading them would be wasted. */
  for (const url of new Set(manifest.clips.filter((c) => !c.muted).map((c) => c.url))) {
    try {
      buffers.set(url, await ctx.decodeAudioData(await opts.fetchBytes(opts.resolveUrl(url))));
    } catch (e) {
      if (opts.strict) throw e;
      // One missing clip should not silence the whole film; the same rule as the player.
      console.warn('[stem-audio] this one never arrived while mixing, skipped:', url, e);
    }
  }
  if (!buffers.size) return null;

  // Trimmed clips follow the document; the rest follow the decoded result (see clampClipToSource for why).
  const clips: StemClip[] = manifest.clips.map((clip) => {
    const buf = buffers.get(clip.url);
    return buf ? clampClipToSource(clip, buf.duration * 1000) : clip;
  });

  const duckCfg = { ...DEFAULT_DUCK, ...manifest.duck };
  const intervals = collectVoiceIntervals({ tracks: manifest.tracks, clips }, duckCfg.mergeGapMs);
  const trackIn = new Map<string, GainNode>();
  for (const track of manifest.tracks) {
    const out = ctx.createGain();
    out.gain.value = dbToGain(track.gainDb ?? 0);
    out.connect(ctx.destination);
    const duck = ctx.createGain();
    duck.gain.value = 1;
    duck.connect(out);
    if (track.duckDb != null && intervals.length) {
      const automation = planDuckAutomation(intervals, {
        duckDb: track.duckDb,
        attackMs: duckCfg.attackMs,
        releaseMs: duckCfg.releaseMs,
      });
      duck.gain.setValueAtTime(automation[0]?.gain ?? 1, 0);
      for (const p of automation) duck.gain.linearRampToValueAtTime(p.gain, p.tMs / 1000);
    }
    trackIn.set(track.id, duck);
  }

  for (const { clip, startAtSec, clipOffsetSec, playDurSec } of planStemSchedule(clips, 0)) {
    const buf = buffers.get(clip.url);
    const into = trackIn.get(clip.track);
    if (!buf || !into) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flat = clip.gainDb != null && clip.gainDb !== 0 ? dbToGain(clip.gainDb) : 1;
    const fade = clipFadeMs(clip);
    if (flat === 1 && fade.inMs <= 0 && fade.outMs <= 0) {
      src.connect(into);
    } else {
      const g = ctx.createGain();
      g.gain.setValueAtTime(fade.inMs > 0 ? 0 : flat, startAtSec);
      if (fade.inMs > 0) g.gain.linearRampToValueAtTime(flat, startAtSec + fade.inMs / 1000);
      if (fade.outMs > 0) {
        const tail = startAtSec + clip.durationMs / 1000;
        g.gain.setValueAtTime(flat, Math.max(startAtSec, tail - fade.outMs / 1000));
        g.gain.linearRampToValueAtTime(0, tail);
      }
      src.connect(g);
      g.connect(into);
    }
    if (playDurSec != null && playDurSec > 0) src.start(startAtSec, clipOffsetSec, playDurSec);
    else src.start(startAtSec, clipOffsetSec);
  }

  return ctx.startRendering();
}

/**
 * AudioBuffer → 16-bit PCM WAV bytes.
 *
 * After the export page has an AudioBuffer, it hands it to `<audio>` for preview and to the encoder
 * for muxing into mp4; both want a file. WAV is the shortest path: browsers decode it natively, and
 * no extra encoder is needed.
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(at + i, s.charCodeAt(i));
  };
  const dataSize = frames * channels * 2;
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  const data = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  let at = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      // The mix may overshoot (several clips stacked); it must be clamped before writing 16-bit, or it wraps around into harsh pops.
      const v = Math.max(-1, Math.min(1, data[ch]![i]!));
      view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  }
  return bytes;
}

/**
 * Stem player. Its public shape deliberately mirrors `HTMLAudioElement`
 * (play/pause/currentTime/duration), so switching the player's master clock over from `<audio>`
 * required almost no changes from callers.
 */
export class StemAudioPlayer {
  private manifestValue: StemAudioManifest;

  private readonly baseUrl: string;
  private readonly lookaheadSec: number;
  private readonly onEnded?: () => void;
  private readonly onError?: (err: Error) => void;
  private readonly wantWaveforms: boolean;
  private readonly decodeMaxBytes: number;
  /** The caller set the limit explicitly: lossy sources then use it too, with no tighter cap. */
  private readonly decodeMaxExplicit: boolean;

  private ctx: AudioContext | null = null;
  private readonly ownsContext: boolean;
  private readonly buffers = new Map<string, AudioBuffer>();
  /**
   * Urls too large to be worth decoding in full (see STEM_DECODE_MAX_BYTES).
   *
   * They never enter `buffers`: scheduling opens an `<audio>` on the spot to stream them, and the
   * browser fetches only the part being played. The cost is no sample-accurate alignment (the
   * element's play lands on the wall clock, not the audio clock), but the assets on this path are
   * long interviews, full screen recordings and beds of dozens of minutes, where nobody hears a few
   * milliseconds, whereas "the whole film won't open" is unacceptable to everyone.
   */
  private readonly streamed = new Set<string>();
  private streams: StreamVoice[] = [];
  /* Waveform envelopes, computed during decoding: the samples are in hand at that moment, and this
     is the only place on this path that has them. Otherwise the UI would fetch and decode the same
     file again just to draw a few hundred pixels. */
  private readonly waveformCache = new Map<string, StemWaveform>();
  private readonly tracks = new Map<string, TrackNodes>();
  /** Tracks muted / soloed while monitoring (see StemMix). */
  private readonly mutedTracks = new Set<string>();
  private readonly soloTracks = new Set<string>();
  /** Master volume; every track feeds into it, so adjusting volume never touches per-track gains or ducking curves. */
  private master: GainNode | null = null;
  private volumeValue = 1;
  private mutedValue = false;
  private rateValue = 1;
  /**
   * Buffers stretched to the current speed (pitch-preserving; see time-stretch), keyed by url. Only
   * **one** speed is kept: changing speed clears everything and recomputes, because keeping several
   * would make the 0.25× copy four times the size of the original.
   */
  private readonly stretched = new Map<string, AudioBuffer>();
  private stretchedRate = 1;
  private sources: AudioBufferSourceNode[] = [];
  /** Manifest clips + real durations after decoding; scheduling and ducking always use this. */
  private effectiveClips: StemClip[] = [];

  private loadPromise: Promise<void> | null = null;
  private loadedState = false;
  private playingState = false;
  /**
   * Whether the user wants to hear it right now, which is different from whether it is already
   * playing.
   *
   * `play()` is async (fetching files, resuming the context), and `playingState` is not set yet in
   * the meantime. Without this flag, a pause request during that window would be dropped as "it was
   * not playing anyway".
   */
  private wantPlay = false;
  private destroyed = false;
  private readonly loadAbort = new AbortController();

  /** Which refetch round we are on (see STEM_REFETCH_WAITS_MS). */
  private refetchRound = 0;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Film time while paused (ms); while playing, derived from the anchor. */
  private pausedMs = 0;
  private anchorCtxSec = 0;
  private anchorFilmMs = 0;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: StemAudioPlayerOptions) {
    this.manifestValue = opts.manifest;
    this.baseUrl = opts.baseUrl ?? '';
    this.lookaheadSec = opts.lookaheadSec ?? 0.05;
    this.onEnded = opts.onEnded;
    this.onError = opts.onError;
    this.wantWaveforms = opts.waveforms ?? false;
    this.decodeMaxBytes = opts.decodeMaxBytes ?? STEM_DECODE_MAX_BYTES;
    this.decodeMaxExplicit = opts.decodeMaxBytes != null;
    this.ctx = opts.context ?? null;
    this.ownsContext = !opts.context;
  }

  /** The manifest currently being played. After a move it is the new one (see retime). */
  get manifest(): StemAudioManifest { return this.manifestValue; }

  get durationMs(): number { return this.manifest.totalMs; }
  get loaded(): boolean { return this.loadedState; }
  get playing(): boolean { return this.playingState; }
  get context(): AudioContext | null { return this.ctx; }

  /** Current film time (ms). While playing, derived from the AudioContext master clock. */
  get currentMs(): number {
    if (!this.playingState || !this.ctx) return this.pausedMs;
    // elapsed is negative within the lookahead; clamp to 0 so time never runs backwards.
    const elapsed = Math.max(0, (this.ctx.currentTime - this.anchorCtxSec) * 1000);
    // At other speeds, wall time and film time differ: 1 second of wall time is rate seconds of film.
    return Math.min(this.durationMs, this.anchorFilmMs + elapsed * this.rateValue);
  }

  /**
   * What each sound looks like when drawn, indexed by clip url (a file placed twice gets its
   * envelope computed once).
   *
   * Empty until loading completes, and broken clips are absent. Callers treat "missing" as "draw no
   * waveform": the clip is still a normal clip, just without visible dynamics.
   */
  get waveforms(): ReadonlyMap<string, StemWaveform> { return this.waveformCache; }

  get volume(): number { return this.volumeValue; }
  set volume(v: number) {
    this.volumeValue = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
    this.applyMasterGain();
  }

  get muted(): boolean { return this.mutedValue; }
  set muted(v: boolean) {
    this.mutedValue = !!v;
    this.applyMasterGain();
  }

  /** Playback speed. Changing it while playing reschedules in place: sources already scheduled run at the old rate and would drift from the picture otherwise. */
  get rate(): number { return this.rateValue; }
  set rate(v: number) {
    const next = Number.isFinite(v) && v > 0 ? v : 1;
    if (next === this.rateValue) return;
    const at = this.currentMs;
    this.rateValue = next;
    if (this.playingState && this.loadedState) this.scheduleFrom(at);
  }

  private applyMasterGain(): void {
    if (this.master) this.master.gain.value = this.mutedValue ? 0 : this.volumeValue;
  }

  /* ── Monitoring: mute some tracks, or listen to only some ──
   *
   * When anything is soloed, solo wins. That is the convention on every mixing desk: press solo and
   * everything not soloed goes quiet, while each track's mute state is set aside (it is still there
   * when solo is released, no need to press it again). */

  /** Whether this track is audible right now. */
  private audible(id: string): boolean {
    return this.soloTracks.size ? this.soloTracks.has(id) : !this.mutedTracks.has(id);
  }

  /**
   * Applies the switches to the gains.
   *
   * A short ramp rather than direct assignment: dropping gain from 1 to 0 during playback leaves a
   * cliff in the waveform, heard as a click. A 10ms time constant is too short to hear as a fade but
   * enough to turn the cliff into a slope. Ducking is a separate stage (duck); the two multiply
   * without interfering.
   */
  private applyTrackGains(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const track of this.manifest.tracks) {
      const nodes = this.tracks.get(track.id);
      if (!nodes) continue;
      const target = this.audible(track.id) ? dbToGain(track.gainDb ?? 0) : 0;
      if (this.ctx) nodes.out.gain.setTargetAtTime(target, now, 0.01);
      else nodes.out.gain.value = target;
    }
  }

  /**
   * Applies all monitoring switches at once, by **kind**.
   *
   * The UI says "music", and a film's music may be split across two tracks (bed + transition pad):
   * the user is toggling "music", not a particular track. Setting everything at once has another
   * benefit: hot reload replaces the player entirely, and the new one must restore the previous
   * state from a single call, which a per-track interface cannot do.
   */
  setMix(mix: StemMix): void {
    const muted = new Set(mix.muted);
    const solo = new Set(mix.solo);
    this.mutedTracks.clear();
    this.soloTracks.clear();
    for (const track of this.manifest.tracks) {
      if (muted.has(track.kind)) this.mutedTracks.add(track.id);
      if (solo.has(track.kind)) this.soloTracks.add(track.id);
    }
    this.applyTrackGains();
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!Ctor) throw new Error('no Web Audio in this environment');
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  /**
   * Fetches and decodes every clip. Each url is decoded only once.
   *
   * One broken clip does not take down the film: while editing, these files are regenerated as
   * changes happen, the manifest may be half a second ahead of the disk, and a line's TTS may be half
   * written. Failing the whole load when one clip cannot be fetched would silence the entire film and
   * show a "music failed to load" banner, when in fact one line is missing and the other nine plus the
   * music are fine. So the broken clip is dropped and the rest play; only total failure counts as
   * failure.
   *
   * A clip that is too large is neither decoded nor considered broken: it streams instead (see
   * STEM_DECODE_MAX_BYTES).
   *
   * **Clips that could not be fetched are retried after a while.** Failures on this path are
   * inherently temporary: a large asset is first a pointer in the working tree, its real bytes arrive
   * after hydration, and fetching it during those seconds always fails. This promise used to be
   * settled only once: `loadPromise` never retried, so one transient 404 meant the sound stayed silent
   * until a refresh. The picture side has had five retry levels for a long time (see useVideoReload in
   * film-runtime) while sound had none, so within the same hydration window the picture recovered on
   * its own and the sound never came.
   */
  load(): Promise<void> {
    if (this.destroyed) return Promise.reject(this.loadAbort.signal.reason);
    if (this.loadPromise) return this.loadPromise;
    const promise = (async () => {
      const ctx = this.ensureContext();
      const urls = [...new Set(this.manifest.clips.map((c) => c.url))];
      const broken: string[] = [];
      /** Urls that did not arrive; fetched again after a while (see scheduleRefetch). */
      const brokenUrls = new Set<string>();
      /* Bytes arrived but decode to no sound (e.g. footage with no audio track registered as its own
         original sound). That is not "the sound path is broken": the network works and the asset is
         simply silent, so carry on muted without reporting an error. */
      let undecodable = 0;
      await Promise.all(urls.map(async (url) => {
        try {
          const res = await fetch(this.resolve(url), { signal: this.loadAbort.signal });
          this.loadAbort.signal.throwIfAborted();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const cacheKey = decodedKey(this.resolve(url), res.headers?.get?.('etag'), ctx.sampleRate);
          const cached = takeDecoded(cacheKey);
          if (cached) {
            void res.body?.cancel().catch(() => {});
            this.buffers.set(url, cached);
            this.stretched.delete(url);
            if (this.wantWaveforms) this.waveformCache.set(url, stemWaveform(cached));
            return;
          }
          /* Don't read large ones in. Reading the whole thing before deciding not to decode would
             already spend half the memory, and saving that memory is the whole point of this cut. */
          const bytes = await this.readWithinBudget(res);
          this.loadAbort.signal.throwIfAborted();
          if (!bytes) {
            this.streamed.add(url);
            return;
          }
          try {
            const buf = await ctx.decodeAudioData(bytes);
            this.loadAbort.signal.throwIfAborted();
            keepDecoded(cacheKey, buf);
            this.buffers.set(url, buf);
            this.stretched.delete(url);
            if (this.wantWaveforms) this.waveformCache.set(url, stemWaveform(buf));
          } catch (e) {
            undecodable += 1;
            throw e;
          }
        } catch (e) {
          broken.push(`${url}(${e instanceof Error ? e.message : String(e)})`);
          brokenUrls.add(url);
        }
      }));
      this.loadAbort.signal.throwIfAborted();
      // Nothing succeeded, and none was "fetched but undecodable": the sound path really is broken
      // (session gone, proxy down), so report it.
      if (urls.length && broken.length === urls.length && undecodable === 0) {
        throw new Error(`not one stem clip could be fetched: ${broken.join(' · ')}`);
      }
      if (broken.length) console.warn('[stem-audio] these never played, the rest carried on:', broken.join(' · '));
      this.effectiveClips = this.clampClips();
      this.buildTrackNodes();
      this.loadedState = true;
      if (brokenUrls.size) this.scheduleRefetch(brokenUrls);
    })();
    promise.catch((e) => {
      /* Total failure: drop this promise so the next play / load gets a chance to retry. Kept, it
         would keep rejecting with the same error, and the caller would see "pressed play, nothing
         happened". */
      if (this.loadPromise === promise) this.loadPromise = null;
      if (!this.destroyed) this.onError?.(e instanceof Error ? e : new Error(String(e)));
    });
    this.loadPromise = promise;
    return promise;
  }

  /**
   * Refetches the clips that did not arrive.
   *
   * Same intervals as the picture side (see RELOAD_WAITS_MS in film-runtime): the first is short,
   * because most failures are just an asset that has not finished hydrating; then they grow, adding
   * up to about 19 seconds, enough for footage of a few hundred MB. Once fetched, the nodes are rebuilt;
   * if playing, playback is rescheduled in place and the sound joins on its own, without the user
   * pressing stop and play.
   */
  private scheduleRefetch(urls: ReadonlySet<string>): void {
    const wait = STEM_REFETCH_WAITS_MS[this.refetchRound];
    if (wait == null || this.destroyed) return;
    this.refetchRound += 1;
    this.refetchTimer = setTimeout(() => {
      this.refetchTimer = null;
      void this.refetch(urls);
    }, wait);
  }

  private async refetch(urls: ReadonlySet<string>): Promise<void> {
    const ctx = this.ctx;
    if (this.destroyed || !ctx) return;
    const still = new Set<string>();
    let got = 0;
    await Promise.all([...urls].map(async (url) => {
      if (this.buffers.has(url) || this.streamed.has(url)) return;
      try {
        const res = await fetch(this.resolve(url), { signal: this.loadAbort.signal });
        this.loadAbort.signal.throwIfAborted();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await this.readWithinBudget(res);
        this.loadAbort.signal.throwIfAborted();
        if (!bytes) {
          this.streamed.add(url);
          got += 1;
          return;
        }
        const buf = await ctx.decodeAudioData(bytes);
        this.loadAbort.signal.throwIfAborted();
        this.buffers.set(url, buf);
        this.stretched.delete(url);
        if (this.wantWaveforms) this.waveformCache.set(url, stemWaveform(buf));
        got += 1;
      } catch {
        /* Undecodable ones (the asset really has no audio track) stay on the list too: retries run out
           after a few rounds at limited cost, while telling them apart would need extra state just to
           save a few fetches that are bound to fail. */
        still.add(url);
      }
    }));
    if (this.destroyed) return;
    if (got) {
      this.effectiveClips = this.clampClips();
      this.buildTrackNodes();
      if (this.playingState) this.scheduleFrom(this.currentMs);
    }
    if (still.size) this.scheduleRefetch(still);
  }

  private resolve(url: string): string {
    if (!this.baseUrl || /^(https?:)?\/\//.test(url) || url.startsWith('/')) return url;
    return this.baseUrl.replace(/\/$/, '') + '/' + url.replace(/^\.?\//, '');
  }

  /**
   * How large the response headers say it is; only Content-Length counts.
   *
   * Without that header (chunked transfer) it is treated as "not large": the only way to know the
   * size then is to read it all, and deciding after reading is too late. Both of our own paths (the
   * local file server and direct object-storage links) send the header, so this valve is effective on
   * the paths that matter.
   */
  private tooBigToDecode(res: { headers?: { get(name: string): string | null } }): boolean {
    const raw = res.headers?.get('content-length');
    if (!raw) return false;
    const bytes = Number(raw);
    return Number.isFinite(bytes) && bytes > this.decodeCapFor(res);
  }

  /** Which limit applies to this response: lossy sources get a tighter one (see STEM_DECODE_MAX_COMPRESSED_BYTES). */
  private decodeCapFor(res: { headers?: { get(name: string): string | null } }): number {
    if (this.decodeMaxExplicit) return this.decodeMaxBytes;
    const type = res.headers?.get('content-type') ?? '';
    return COMPRESSED_AUDIO_RE.test(type)
      ? Math.min(this.decodeMaxBytes, STEM_DECODE_MAX_COMPRESSED_BYTES)
      : this.decodeMaxBytes;
  }

  /**
   * Reads the bytes to decode; past the limit, gives up midway and returns null (stream instead).
   *
   * With Content-Length, the decision is immediate. Without it (chunked transfer, compressed
   * responses), the whole body used to be read and decoded as "not large", letting through exactly
   * the kind that most needed stopping. Now bytes are counted while reading and the read is cancelled
   * past the line, wasting at most one limit's worth of bytes. Environments that cannot stream still
   * read everything.
   */
  private async readWithinBudget(res: Response): Promise<ArrayBuffer | null> {
    if (!this.canStream()) return res.arrayBuffer();
    if (this.tooBigToDecode(res)) {
      void res.body?.cancel().catch(() => {});
      return null;
    }
    const reader = res.headers?.get('content-length') ? null : res.body?.getReader?.();
    if (!reader) return res.arrayBuffer();
    const cap = this.decodeCapFor(res);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out.buffer;
  }

  /** Whether this environment can stream (needs `<audio>` and createMediaElementSource). */
  private canStream(): boolean {
    const doc = (globalThis as { document?: { createElement?: unknown } }).document;
    return typeof doc?.createElement === 'function'
      && typeof this.ctx?.createMediaElementSource === 'function';
  }

  /** Clamps durations to what the source actually has; trimmed clips follow the document (see clampClipToSource for why). */
  private clampClips(): StemClip[] {
    return this.manifest.clips.map((clip) => {
      const buf = this.buffers.get(clip.url);
      return buf ? clampClipToSource(clip, buf.duration * 1000) : clip;
    });
  }

  /**
   * Ducking curves, one per track.
   *
   * They go stale as soon as placement changes: a curve describes when someone is speaking, which
   * is exactly what moving a line of narration changes. So they pair with `effectiveClips`: whenever
   * one is recomputed, so is the other (see retime).
   */
  private planDuckCurves(): Map<string, StemAutomationPoint[] | null> {
    const duckCfg = { ...DEFAULT_DUCK, ...this.manifest.duck };
    const intervals = collectVoiceIntervals(
      { tracks: this.manifest.tracks, clips: this.effectiveClips },
      duckCfg.mergeGapMs,
    );
    const out = new Map<string, StemAutomationPoint[] | null>();
    for (const track of this.manifest.tracks) {
      out.set(track.id, track.duckDb != null && intervals.length
        ? planDuckAutomation(intervals, { duckDb: track.duckDb, attackMs: duckCfg.attackMs, releaseMs: duckCfg.releaseMs })
        : null);
    }
    return out;
  }

  private buildTrackNodes(): void {
    const ctx = this.ensureContext();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.master = master;
    this.applyMasterGain();
    const curves = this.planDuckCurves();
    for (const track of this.manifest.tracks) {
      const out = ctx.createGain();
      out.gain.value = dbToGain(track.gainDb ?? 0);
      out.connect(master);
      const duck = ctx.createGain();
      duck.gain.value = 1;
      duck.connect(out);
      this.tracks.set(track.id, { duck, out, automation: curves.get(track.id) ?? null });
    }
    // Switches may have been toggled before decoding finished (the UI does not wait for sound). Apply them again here so that toggle is not lost.
    this.applyTrackGains();
  }

  /**
   * Switches to a manifest that has only **moved things around**, without refetching or decoding.
   *
   * Dragging a sound on the timeline changes a few numbers in the manifest, yet this used to destroy
   * and reload the entire player: every stem refetched and re-run through `decodeAudioData`, several
   * hundred milliseconds for a ten-track film, during which `audioReady` dropped to zero and the play
   * button greyed out in front of the user. Not a single sample byte had changed.
   *
   * This only recomputes placement: clamp clip durations to their sources, redraw ducking curves, and
   * if playing, reschedule sources from the current position (the same path as seek, measured at
   * 0.4ms). When stopped, not even rescheduling is needed; the next play schedules from the new
   * manifest.
   *
   * Returns `false` when it cannot switch (the sources or the list of tracks changed); the caller
   * should then replace the whole player.
   */
  retime(next: StemAudioManifest): boolean {
    if (this.destroyed) return false;
    if (!sameStemSources(this.manifestValue, next)) return false;
    this.manifestValue = next;
    /* Still decoding: the load() pass will compute from the new manifest, so nothing to do here. The
       sources are unchanged, so it is still fetching the same files. */
    if (!this.loadedState) return true;
    this.effectiveClips = this.clampClips();
    const curves = this.planDuckCurves();
    for (const [id, nodes] of this.tracks) nodes.automation = curves.get(id) ?? null;
    if (this.playingState) this.scheduleFrom(this.currentMs);
    else this.pausedMs = Math.min(this.pausedMs, this.durationMs);
    return true;
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try { s.onended = null; s.stop(); } catch { /* stopping an already stopped source throws; harmless */ }
    }
    this.sources = [];
    for (const voice of this.streams) {
      for (const timer of voice.timers) clearTimeout(timer);
      try { voice.el.removeEventListener('canplay', voice.onCanPlay); } catch { /* not supported in this environment */ }
      try { voice.el.removeEventListener('loadedmetadata', voice.onMetadata); } catch { /* not supported in this environment */ }
      try { voice.el.pause(); } catch { /* already stopped */ }
      try { voice.node.disconnect(); } catch { /* already disconnected */ }
      /* Removing src and calling load() once more is what makes the browser actually release the
         stream and its decoder. With only pause, it keeps holding the buffer, one per seek, until it
         is no better than not streaming at all. */
      try { voice.el.removeAttribute('src'); voice.el.load(); } catch { /* not supported in this environment */ }
    }
    this.streams = [];
    if (this.endTimer != null) { clearTimeout(this.endTimer); this.endTimer = null; }
  }

  /**
   * A clip's own fade-in and fade-out.
   *
   * The curve is drawn against the clip's own head and tail, then intersected with the playback
   * start: seeking into the middle of a fade-in must continue from that point on the curve rather than
   * fade again from zero (which sounds like the sound being held down and released).
   */
  private applyClipFades(
    g: AudioParam,
    clip: StemClip,
    at: { base: number; rate: number; fromMs: number; flat: number; startCtxSec: number },
  ): void {
    const { base, rate, fromMs, flat, startCtxSec } = at;
    const fade = clipFadeMs(clip);
    const headCtxSec = base + (clip.startMs - fromMs) / 1000 / rate;
    const tailCtxSec = headCtxSec + clip.durationMs / 1000 / rate;
    const inEnd = headCtxSec + fade.inMs / 1000 / rate;
    const outStart = tailCtxSec - fade.outMs / 1000 / rate;
    const level = (t: number): number => {
      let k = 1;
      if (fade.inMs > 0 && t < inEnd) k = Math.max(0, (t - headCtxSec) / (inEnd - headCtxSec));
      if (fade.outMs > 0 && t > outStart) k = Math.min(k, Math.max(0, (tailCtxSec - t) / (tailCtxSec - outStart)));
      return flat * k;
    };
    g.setValueAtTime(level(startCtxSec), startCtxSec);
    if (fade.inMs > 0 && inEnd > startCtxSec) g.linearRampToValueAtTime(flat, inEnd);
    if (fade.outMs > 0 && tailCtxSec > startCtxSec) {
      if (outStart > startCtxSec) g.setValueAtTime(flat, outStart);
      g.linearRampToValueAtTime(0, tailCtxSec);
    }
  }

  /**
   * The large-asset path: stream through an `<audio>` element instead of decoding in full.
   *
   * The only difference from the buffer path is how playback starts: there, `src.start(when)` is
   * scheduled on the audio clock, sample-accurate; here, a wall-clock timer calls `play()`, a few
   * milliseconds off. Gain, fades and ducking all use the same nodes and the same pure functions, so
   * apart from the start there is no other audible divergence.
   *
   * What ends up here is long interviews, full screen recordings and beds of dozens of minutes. Nobody
   * hears a few milliseconds on those, while decoding them fully into memory takes several GB, and the
   * tab dies.
   */
  private scheduleStream(
    plan: { clip: StemClip; startAtSec: number; clipOffsetSec: number; playDurSec?: number },
    track: TrackNodes,
    base: number,
    rate: number,
    fromMs: number,
  ): void {
    const ctx = this.ensureContext();
    if (!this.canStream()) return;
    const { clip, startAtSec, clipOffsetSec, playDurSec } = plan;
    const speed = rate;
    let el: HTMLAudioElement;
    let node: MediaElementAudioSourceNode;
    try {
      el = (globalThis as unknown as { document: Document }).document.createElement('audio');
      el.preload = 'auto';
      /* Needed for both the same-origin proxy and direct links: direct links are on the object
         storage domain, and without this the stream cannot feed Web Audio (createMediaElementSource
         yields silence for cross-origin media without CORS). */
      el.crossOrigin = 'anonymous';
      el.src = this.resolve(clip.url);
      node = ctx.createMediaElementSource(el);
    } catch {
      /* If it cannot be created, treat this clip as silent: the same degradation as a failed fetch, which must not bring down the film. */
      return;
    }

    const flat = clip.gainDb != null && clip.gainDb !== 0 ? dbToGain(clip.gainDb) : 1;
    const fade = clipFadeMs(clip);
    const startCtxSec = base + startAtSec / rate;
    let out: AudioNode = node;
    if (flat !== 1 || fade.inMs > 0 || fade.outMs > 0) {
      const g = ctx.createGain();
      g.gain.value = flat;
      node.connect(g);
      out = g;
      if (fade.inMs > 0 || fade.outMs > 0) {
        this.applyClipFades(g.gain, clip, { base, rate, fromMs, flat, startCtxSec });
      }
    }
    out.connect(track.duck);

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const startInMs = Math.max(0, (startCtxSec - ctx.currentTime) * 1000);
    /**
     * Re-align once enough is buffered.
     *
     * `play()` is only a request: the element must buffer the first bit of data before any sound,
     * which takes **seconds** for a large file still being pulled from remote. Meanwhile the picture
     * moves on by its own clock, and when the sound finally starts it begins from the frame at which
     * play was requested: seconds late, and staying that far behind. The user hears "the sound takes
     * ages to come and is out of sync when it does".
     *
     * So once playback is actually possible, recompute the correct position from the audio master
     * clock. If the difference is small (under 120ms), leave it: a seek itself clicks, and a gap that
     * small is inaudible.
     */
    let asked = false;
    // Fetch/decode the selected source interval while this clip is waiting on
    // the timeline. Waiting until its start timer fires buffers file time 0
    // instead, then makes a cold seek (often many minutes) at every cut.
    const prepare = (): void => {
      try {
        const elapsed = asked ? Math.max(0, ctx.currentTime - startCtxSec) * speed : 0;
        el.currentTime = clipOffsetSec + elapsed;
      } catch { /* loadedmetadata will retry a seek made before metadata */ }
    };
    const align = (): void => {
      if (!asked) return;
      const elapsed = Math.max(0, ctx.currentTime - startCtxSec) * speed;
      /* This clip's window has already passed: re-aligning now would drag back and replay sound that should have stopped. */
      if (playDurSec != null && elapsed >= playDurSec) return;
      const want = clipOffsetSec + elapsed;
      try {
        if (Math.abs(el.currentTime - want) > 0.12) el.currentTime = want;
      } catch { /* element was torn down */ }
    };
    el.addEventListener('loadedmetadata', prepare);
    el.addEventListener('canplay', align);
    prepare();
    timers.push(setTimeout(() => {
      try {
        // Do not invalidate an already prepared decoder at the cut.
        if (Math.abs(el.currentTime - clipOffsetSec) > 0.12) el.currentTime = clipOffsetSec;
        el.playbackRate = speed;
        asked = true;
        void el.play().catch(() => { /* autoplay blocked: the main path already resumed inside the user gesture */ });
        /* If already buffered, canplay has long since fired and will not fire again, so align right here. */
        if (el.readyState >= 3) align();
      } catch { /* element was torn down */ }
    }, startInMs));
    /* playDurSec is **source time** (as produced by planStemSchedule); divide by the speed to get wall time. */
    if (playDurSec != null && playDurSec > 0) {
      timers.push(setTimeout(() => {
        try { el.pause(); } catch { /* already stopped */ }
      }, startInMs + (playDurSec / speed) * 1000));
    }
    this.streams.push({ el, node, timers, onCanPlay: align, onMetadata: prepare });
  }

  /** This source's buffer stretched to the current speed, computed and remembered on first use. A speed change clears everything from the previous speed. */
  private stretchedBuffer(ctx: BaseAudioContext, url: string, buf: AudioBuffer, rate: number): AudioBuffer {
    if (this.stretchedRate !== rate) {
      this.stretched.clear();
      this.stretchedRate = rate;
    }
    let out = this.stretched.get(url);
    if (!out) {
      out = timeStretchBuffer(ctx, buf, rate);
      this.stretched.set(url, out);
    }
    return out;
  }

  /** Reschedules every source and ducking curve from fromMs. Both play and seek go through here. */
  private scheduleFrom(startMs: number): void {
    /* Clamp to the film length first. An out-of-range value would make every clip skip via
       `endMs <= fromMs`, scheduling zero sources and no sound at all; worse, the endTimer at the end
       would compute a negative delay and never be set, so playingState would never drop, and every
       later play() would bail out immediately until the page was refreshed. Out-of-range values from
       upstream are not unusual: on some paths the wall-clock anchor keeps growing through the paused
       time. */
    const fromMs = Number.isFinite(startMs)
      ? Math.max(0, Math.min(this.durationMs, startMs))
      : 0;
    const ctx = this.ensureContext();
    this.stopSources();
    const base = ctx.currentTime + this.lookaheadSec;
    const rate = this.rateValue;
    this.anchorCtxSec = base;
    this.anchorFilmMs = fromMs;

    for (const { clip, startAtSec, clipOffsetSec, playDurSec } of planStemSchedule(this.effectiveClips, fromMs)) {
      const buf = this.buffers.get(clip.url);
      const track = this.tracks.get(clip.track);
      if (!track) continue;
      if (!buf) {
        /* Not decoded for one of two reasons: fetch failed (skip; that clip is silent), or it is large enough to stream. */
        if (this.streamed.has(clip.url)) {
          this.scheduleStream({ clip, startAtSec, clipOffsetSec, playDurSec }, track, base, rate, fromMs);
        }
        continue;
      }
      const src = ctx.createBufferSource();
      /* The film's playback speed (the user watching at 2×). **playbackRate is left alone**: it is
         tape-style, and at double speed narration goes up an octave and sounds like another voice.
         Instead the source is first stretched to the speed (pitch unchanged) and played at 1×, so
         seconds in the source must be divided by the speed to get seconds in the stretched buffer. */
      src.buffer = rate === 1 ? buf : this.stretchedBuffer(ctx, clip.url, buf, rate);
      const flat = clip.gainDb != null && clip.gainDb !== 0 ? dbToGain(clip.gainDb) : 1;
      const fade = clipFadeMs(clip);
      let node: AudioNode = src;
      if (flat !== 1 || fade.inMs > 0 || fade.outMs > 0) {
        const g = ctx.createGain();
        g.gain.value = flat;
        src.connect(g);
        node = g;
      }
      node.connect(track.duck);
      const startCtxSec = base + startAtSec / rate;
      /* The third argument is how much of the source to play. planStemSchedule gives source time; the
         buffer is already stretched, so both offset and length are converted to stretched seconds
         (divided by the speed). */
      if (playDurSec != null && playDurSec > 0) src.start(startCtxSec, clipOffsetSec / rate, playDurSec / rate);
      else src.start(startCtxSec, clipOffsetSec / rate);
      if (node !== src && (fade.inMs > 0 || fade.outMs > 0)) {
        this.applyClipFades((node as GainNode).gain, clip, { base, rate, fromMs, flat, startCtxSec });
      }
      this.sources.push(src);
    }

    for (const nodes of this.tracks.values()) {
      const g = nodes.duck.gain;
      g.cancelScheduledValues(base);
      if (!nodes.automation) { g.setValueAtTime(1, base); continue; }
      g.setValueAtTime(duckGainAt(nodes.automation, fromMs), base);
      for (const p of nodes.automation) {
        if (p.tMs <= fromMs) continue;
        g.linearRampToValueAtTime(p.gain, base + (p.tMs - fromMs) / 1000 / rate);
      }
    }

    const remainMs = (this.durationMs - fromMs) / rate;
    if (remainMs > 0) {
      this.endTimer = setTimeout(() => {
        this.endTimer = null;
        if (!this.playingState) return;
        this.pausedMs = this.durationMs;
        this.playingState = false;
        this.stopSources();
        this.onEnded?.();
      }, remainMs + this.lookaheadSec * 1000);
    }
  }

  /**
   * Resumes the AudioContext synchronously inside the user gesture.
   *
   * `play()` must first `await load()` (fetch and decode), and the await uses up the click's transient
   * activation: a later `resume()` in Chrome stays suspended and currentTime does not advance. The
   * player UI already shows the pause button while the clock is stuck at 0, which looks like "pressed
   * play and nothing happened". The resume must be issued before any await, still on the click
   * handler's synchronous stack.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') void ctx.resume();
  }

  async play(fromMs?: number): Promise<void> {
    if (this.destroyed || this.playingState) return;
    this.wantPlay = true;
    /* Resume the context first, then decode. The order must not be reversed; see unlock. */
    this.unlock();
    await this.load();
    if (this.destroyed || this.playingState || !this.wantPlay) return;
    const ctx = this.ensureContext();
    /* Not just suspended: when Safari is interrupted by a call or another tab it reports
       interrupted, and currentTime does not advance then either. Checking only for suspended would
       let it through as if all were well, and none of the scheduled sources would sound. */
    if (ctx.state !== 'running') await ctx.resume();
    if (!this.wantPlay || this.destroyed) return;
    if (ctx.state !== 'running') {
      throw new Error('the browser is holding the sound back, press play again');
    }
    const from = fromMs ?? (this.pausedMs >= this.durationMs ? 0 : this.pausedMs);
    this.playingState = true;
    this.scheduleFrom(from);
  }

  pause(): void {
    /*
     * Withdraw the intent first, then check whether it is playing.
     *
     * `play()` spans two awaits (fetching files, resuming the context), during which `playingState`
     * is still false. The `if (!this.playingState) return` line used to make this pause do nothing,
     * and once those awaits returned the sound was scheduled anyway: the UI showed paused while the
     * speakers played; pressing play again, `play()` saw playingState was true and bailed out, and the
     * button stopped working from then on.
     */
    this.wantPlay = false;
    if (!this.playingState) return;
    this.pausedMs = this.currentMs;
    this.playingState = false;
    this.stopSources();
  }

  /** Seek. While playing, reschedules immediately (measured at 0.4ms); while paused, only records the position. */
  seek(ms: number): void {
    const target = Math.max(0, Math.min(this.durationMs, ms));
    this.pausedMs = target;
    if (this.playingState && this.loadedState) this.scheduleFrom(target);
  }

  destroy(): void {
    this.destroyed = true;
    this.loadAbort.abort();
    this.loadedState = false;
    this.effectiveClips = [];
    this.loadPromise = null;
    this.playingState = false;
    this.wantPlay = false;
    if (this.refetchTimer) {
      clearTimeout(this.refetchTimer);
      this.refetchTimer = null;
    }
    this.stopSources();
    for (const nodes of this.tracks.values()) {
      try { nodes.duck.disconnect(); nodes.out.disconnect(); } catch { /* already disconnected */ }
    }
    try { this.master?.disconnect(); } catch { /* already disconnected */ }
    this.master = null;
    this.tracks.clear();
    this.buffers.clear();
    this.stretched.clear();
    this.waveformCache.clear();
    this.streamed.clear();
    if (this.ownsContext && this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
