/**
 * Stem manifest → one mixed audio track for the final film.
 *
 * Mixing has two executors in this repository: Web Audio in the browser at edit time
 * (stem-audio), and ffmpeg here at export. Two implementations, one set of numbers — how tracks
 * are split, their gains, how far the music ducks under the voice all come solely from the stem
 * manifest produced by `soundsStemManifest`. What the film's owner hears in the editor must sound
 * the same after export; if each side computed it separately, differences would only be found in
 * the final film, by which time it has already been published.
 *
 * So this layer consumes the manifest itself, not some intermediate format: what the browser feeds
 * to Web Audio and what this side feeds to ffmpeg are the same object.
 *
 * Ducking (music making room for voice) therefore doesn't use ffmpeg's own sidechaincompress —
 * that sounds different. It uses the same envelope from `planDuckAutomation`, translated verbatim
 * into a volume expression.
 */

import {
  collectVoiceIntervals,
  DEFAULT_DUCK,
  planDuckAutomation,
  soundsStemManifest,
  type FilmSoundEntry,
  type StemAudioManifest,
  type StemAutomationPoint,
} from '@animspark/core';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAll, type MediaResolver } from './media-resolver';
import { ffmpeg, ffmpegCapture, probe } from './probe';

const SAMPLE_RATE = 48_000;

/**
 * Normalize every input's format on the way in.
 *
 * Media comes from everywhere: TTS gives 24k mono, music is 44.1k stereo, a talking-head shot on a
 * phone may be 48k mono. `amix` rejects mismatched inputs — the error is "Input link parameters
 * differ", and it points at the mix step, a whole graph away from the real cause (one asset has a
 * different sample rate). So it is flattened at the entrance.
 */
const FORMAT = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;

/** Numbers going into a filter string: trim float noise, or things like 33.800000000000004 end up on the command line. */
function num(n: number): string {
  return String(Number(n.toFixed(6)));
}

function linear(db: number): number {
  return 10 ** (db / 20);
}

/* ── Duck envelope → volume expression ───────────────────────────────────── */

/**
 * One ramp. `fromSec === toSec` means the step is vertical (jumps straight to the new value).
 */
export interface DuckWedge {
  delta: number;
  fromSec: number;
  toSec: number;
}

export interface DuckCurve {
  base: number;
  wedges: DuckWedge[];
}

/**
 * Split a polyline into "base value + a series of ramps".
 *
 * Why not write the polyline as nested ifs: one stretch of voice produces 4 points and a normal
 * film has dozens to hundreds, which nests into `if(lt(t,..),..,if(...))` dozens of levels deep.
 * Split into ramps it becomes a **flat sum**: each term is 0 before its segment, climbs linearly
 * within it and stays at full value after, and the sum is exactly the original polyline. No
 * nesting, length grows linearly, and it still reads like something a human wrote.
 */
export function duckCurve(points: readonly StemAutomationPoint[]): DuckCurve {
  if (!points.length) return { base: 1, wedges: [] };
  const base = points[0]!.gain;
  const wedges: DuckWedge[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (b.gain === a.gain) continue;
    wedges.push({
      delta: b.gain - a.gain,
      fromSec: a.tMs / 1000,
      toSec: Math.max(a.tMs, b.tMs) / 1000,
    });
  }
  return { base, wedges };
}

/** The curve's value at a given second. For tests — they need to prove this curve is the same as the player's. */
export function duckCurveGainAt(curve: DuckCurve, tSec: number): number {
  let gain = curve.base;
  for (const w of curve.wedges) {
    const span = w.toSec - w.fromSec;
    const k = span <= 0
      ? (tSec >= w.toSec ? 1 : 0)
      : Math.min(Math.max((tSec - w.fromSec) / span, 0), 1);
    gain += w.delta * k;
  }
  return gain;
}

/**
 * Curve → ffmpeg volume expression (`t` in seconds).
 *
 * The expression contains commas (min/max arguments), and commas are separators in a filtergraph —
 * so the caller must wrap it in single quotes, or ffmpeg takes half the expression as the next
 * filter and reports an error that has nothing to do with volume.
 */
export function duckVolumeExpr(points: readonly StemAutomationPoint[]): string {
  const curve = duckCurve(points);
  const terms = curve.wedges.map((w) => {
    if (w.toSec <= w.fromSec) return `${num(w.delta)}*gte(t,${num(w.toSec)})`;
    return `${num(w.delta)}*min(max((t-${num(w.fromSec)})/${num(w.toSec - w.fromSec)},0),1)`;
  });
  return [num(curve.base), ...terms].join('+');
}

/* ── Mix graph ───────────────────────────────────────────────────────────── */

export interface MixPlan {
  /** ffmpeg `-i` order; the index is the input number in the filter. */
  inputs: string[];
  /** The full filter_complex. */
  filter: string;
  /** The final output label (without brackets). */
  out: string;
  totalMs: number;
}

export interface MixPlanOptions {
  /** Relative path in the doc → real file; null = the asset isn't on disk, skip it. */
  mapSrc: (src: string) => string | null;
  /**
   * Film duration. Defaults to the end of the last sound.
   *
   * Code-only films must pass it: their duration is set by the picture, which isn't in this data.
   * Without it, a film whose picture outlasts its sound gets a short audio track — the last few
   * seconds of the film go suddenly silent, while every sound checked on its own is correct.
   */
  totalMs?: number;
}

/**
 * Build a mix graph. A pure function — no disk, no processes — so whether the graph is right can
 * be tested.
 *
 * Returns null = the film has no sound at all. The caller then exports a silent video instead of
 * mixing an empty track (ffmpeg reports a syntax error for a filter_complex with no inputs).
 */
export function mixPlan(manifest: StemAudioManifest, opts: MixPlanOptions): MixPlan | null {
  const totalMs = opts.totalMs ?? manifest.totalMs;
  /* URLs in the manifest are workspace-relative; `mapSrc` resolves them to absolute paths on disk.
     Clips that can't be resolved (the file hasn't arrived yet) are left out of the graph — letting
     ffmpeg hit a missing input yields an I/O error unrelated to sound. Muted clips are left out
     too: they stay in the manifest only so they can be restored cheaply at edit time; in the final
     film that sound simply isn't there. */
  const sourced = manifest.clips
    .filter((clip) => !clip.muted)
    .map((clip) => ({ clip, path: opts.mapSrc(clip.url) }))
    .filter((x): x is { clip: typeof x.clip; path: string } => x.path != null);
  if (!sourced.length || totalMs <= 0) return null;

  const inputs: string[] = [];
  const chains: string[] = [];
  const byTrack = new Map<string, string[]>();
  const totalSec = totalMs / 1000;

  /* A file used ten times goes in ten times — no dedup. In a filtergraph an output pad can only be
     connected once; reuse would need asplit, with the fan-out computed from how often each file is
     used. A few extra decoders is a good price for eliminating that whole class of errors. */
  sourced.forEach(({ clip, path }, index) => {
    inputs.push(path);
    const inSec = (clip.inMs ?? 0) / 1000;
    const durSec = clip.durationMs / 1000;
    const parts = [
      FORMAT,
      `atrim=start=${num(inSec)}:end=${num(inSec + durSec)}`,
      'asetpts=PTS-STARTPTS',
    ];
    if (clip.gainDb) parts.push(`volume=${num(linear(clip.gainDb))}`);
    if (clip.fadeInMs) parts.push(`afade=t=in:st=0:d=${num(clip.fadeInMs / 1000)}`);
    if (clip.fadeOutMs) {
      const st = Math.max(0, durSec - clip.fadeOutMs / 1000);
      parts.push(`afade=t=out:st=${num(st)}:d=${num(clip.fadeOutMs / 1000)}`);
    }
    // Place it at its position in the film. 0 needs no move — adelay=0 is a no-op but makes the graph harder to read.
    if (clip.startMs > 0) parts.push(`adelay=${Math.round(clip.startMs)}:all=1`);
    /* Pad every input with silence to the full film length so all amix inputs are equally long.
       Without it we'd be gambling on amix's end-of-stream semantics: in ffmpeg 8.1's multithreaded
       filtergraph, the input that ends first sometimes takes the whole amix with it — the same
       command randomly produces either full length or a cut at the first input's end, and in the
       final film the cut version is "the whole film goes silent after 41 seconds". The atrim at
       the end trims the padded tail back, so here we only need them aligned, not exact. */
    parts.push(`apad=whole_dur=${num(totalSec)}`);

    const label = `c${index}`;
    chains.push(`[${index}:a]${parts.join(',')}[${label}]`);
    const list = byTrack.get(clip.track);
    if (list) list.push(label); else byTrack.set(clip.track, [label]);
  });

  const duckCfg = { ...DEFAULT_DUCK, ...manifest.duck };
  /* The duck curve only counts clips that actually made it into the graph. Computed from the full
     manifest, a narration whose file is missing would still push the music down — in the final
     film, "the music gets quieter for no reason and nobody is talking". */
  const voice = collectVoiceIntervals(
    { ...manifest, clips: sourced.map((x) => x.clip) },
    duckCfg.mergeGapMs,
  );

  const trackLabels: string[] = [];
  for (const track of manifest.tracks) {
    const members = byTrack.get(track.id);
    if (!members?.length) continue;
    const parts: string[] = [];
    /* normalize=0 is required. The default of 1 divides each input by the input count — a
       four-track film exports 12 dB quieter overall, which sounds "just a bit quiet" rather than
       broken, so it very easily makes it all the way to production. */
    if (members.length > 1) {
      parts.push(`amix=inputs=${members.length}:normalize=0:dropout_transition=0`);
    }
    if (track.gainDb) parts.push(`volume=${num(linear(track.gainDb))}`);
    if (track.duckDb != null && voice.length) {
      const expr = duckVolumeExpr(planDuckAutomation(voice, {
        duckDb: track.duckDb,
        attackMs: duckCfg.attackMs,
        releaseMs: duckCfg.releaseMs,
      }));
      parts.push(`volume='${expr}':eval=frame`);
    }
    // A track with one clip and no processing would get an empty chain — an empty chain is a syntax error in ffmpeg.
    if (!parts.length) parts.push('anull');
    const label = `t${trackLabels.length}`;
    chains.push(`${members.map((m) => `[${m}]`).join('')}${parts.join(',')}[${label}]`);
    trackLabels.push(label);
  }

  const tail = [
    trackLabels.length > 1
      ? `amix=inputs=${trackLabels.length}:normalize=0:dropout_transition=0`
      : 'anull',
    /* The audio must be **exactly as long** as the picture, not "about the same". Too short, and
       downstream alignment with -shortest cuts off the silent picture at the end; too long, and the
       end gets a stretch of black screen with music still playing. Pad, then trim flat. */
    `apad=whole_dur=${num(totalSec)}`,
    // All branches are already 48 kHz. Bound samples instead of filter timestamps:
    // ffmpeg 8.1 can otherwise drop adelay's leading silence at this second atrim.
    `atrim=end_sample=${Math.round(totalMs * SAMPLE_RATE / 1000)}`,
    FORMAT,
  ];
  chains.push(`${trackLabels.map((l) => `[${l}]`).join('')}${tail.join(',')}[mix]`);

  return { inputs, filter: chains.join(';'), out: 'mix', totalMs };
}

/** Master bus delivery level. Matches the old architecture's chain (published films measured −13.9 LUFS). */
const TARGET_LUFS = -14;
/** True-peak ceiling. Leaves 1 dB for lossy-codec overshoot — decoded AAC comes out slightly above the original waveform. */
const TARGET_TP_DB = -1;
/** The most the limiter may pull down, in dB. Beyond this it isn't catching transients, it is flattening the dynamics. */
const MAX_LIMIT_DB = 6;

export interface Loudness {
  lufs: number;
  peakDb: number;
}

/**
 * Read the integrated loudness from ebur128's stderr. Returns null if it can't (too short, pure
 * silence).
 *
 * **Only the part after `Summary:` counts.** ebur128 prints a reading with `I:` for every frame
 * along the way, and the first one is the opening silence's `I: -70.0` — grabbing the first match
 * in the whole stderr always gets that. That number makes mastering think the film is silent and
 * compute a 56 dB gain, which the cap clamps, so both passes push the same capped value and it
 * looks like "fixed but not taking effect". This has bitten before, so parsing is split out and
 * pinned by tests.
 */
export function readLoudness(stderr: string): Loudness | null {
  const at = stderr.lastIndexOf('Summary:');
  if (at < 0) return null;
  const summary = stderr.slice(at);
  const lufs = Number(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(summary)?.[1]);
  const peakDb = Number(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(lufs) || lufs <= -70) return null;
  return { lufs, peakDb: Number.isFinite(peakDb) ? peakDb : 0 };
}

async function measureLoudness(path: string): Promise<Loudness | null> {
  const { stderr } = await ffmpegCapture(['-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  return readLoudness(stderr);
}

/**
 * Mastering: bring the whole film up to the delivery level.
 *
 * The level coming out of the mix depends on how many tracks the film has and each one's gainDb —
 * those are **relative**: the author sets "how much quieter the music is than the narration", and
 * nobody sets how loud the whole film is in absolute terms. Without this step, the same
 * arrangement can land more than 5 dB apart on different films (one film measured −19.1 LUFS,
 * while the same film on the old architecture was −13.9), which sounds like "this version's audio
 * is worse" — even though every sound is where it should be.
 *
 * **Static gain** is used rather than loudnorm's dynamic mode: the latter compresses dynamic range,
 * flattening "the beat of silence before the climax" into the climax itself, which is exactly
 * where the arrangement works hardest. Measure once, compute one number, multiply the whole film —
 * the loudness relationships between sections don't change at all.
 */
async function master(path: string, out: string): Promise<boolean> {
  const m = await measureLoudness(path);
  if (!m) return false;
  const wanted = TARGET_LUFS - m.lufs;
  /* Pushing to the target usually hits the peak ceiling, which is exactly the limiter's job — it
     only holds down the few highest transients, and the average loudness still rises. Pushing
     only by headroom, a film with one loud sound effect would be held back by that one hit and
     come out 3 dB quieter overall. But the limiter can't be allowed to cut without bound: past
     MAX_LIMIT_DB it isn't catching transients but squashing the waveform, and then we'd rather
     deliver a slightly quieter film. */
  const headroom = TARGET_TP_DB - m.peakDb;
  let gainDb = Math.min(wanted, headroom + MAX_LIMIT_DB);
  if (Math.abs(gainDb) < 0.3) return false;

  const apply = async (db: number): Promise<void> => {
    await ffmpeg([
      '-i', path,
      '-af', `volume=${num(db)}dB,alimiter=limit=${num(10 ** (TARGET_TP_DB / 20))}:level=disabled`,
      '-c:a', 'aac', '-b:a', '192k', '-ar', String(SAMPLE_RATE),
      '-y', out,
    ]);
  };
  await apply(gainDb);

  /* Measure again, and correct once more if it is far off.
   *
   * Static gain should be 1 dB in, 1 dB out, but the limiter isn't linear: the transients it holds
   * down carry real weight in the LUFS gated average, and once they are cut the whole film ends up
   * louder (measured: a 5.1 dB push rose by 8). If it can't be computed exactly, don't force it —
   * measure once, correct once, and two passes reliably land within half a dB. */
  const after = await measureLoudness(out);
  const drift = after ? TARGET_LUFS - after.lufs : 0;
  if (after && Math.abs(drift) > 0.5) {
    gainDb = Math.min(gainDb + drift, headroom + MAX_LIMIT_DB);
    await apply(gainDb);
  }
  return true;
}

/**
 * Keep only the files that have an audio stream.
 *
 * A video clip is also a sound source, but a video with no audio stream (a screen recording,
 * generated b-roll, a transparent export) fed to `[n:a]` makes ffmpeg reject the whole graph:
 * "Stream specifier ':a' ... matches no streams" — and a film whose sound is fine cannot render.
 * A file that cannot be probed (timeout, damaged) is kept: better a real ffmpeg error than a
 * narration silently dropped.
 *
 * The probe is injectable for tests; planning the graph (mixPlan) stays pure.
 */
export async function audibleSources(
  resolved: ReadonlyMap<string, string | null>,
  probeFile: (path: string) => Promise<{ hasAudio: boolean }> = (path) => probe(path, { timeoutMs: 15_000 }),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const checked = new Map<string, Promise<boolean>>();
  await Promise.all([...resolved].map(async ([src, abs]) => {
    if (!abs) return;
    let job = checked.get(abs);
    if (!job) {
      job = probeFile(abs).then((facts) => facts.hasAudio, () => true);
      checked.set(abs, job);
    }
    if (await job) out.set(src, abs);
  }));
  return out;
}

/**
 * Mix down to an m4a. Returns null = the film has no sound.
 */
export async function mixdownFilm(opts: {
  workspace: string;
  /** The sound list collected from the tree (`FilmEval.sounds`). */
  sounds: readonly FilmSoundEntry[];
  out: string;
  totalMs?: number;
  /**
   * Where the asset bytes are. Without it, the old rule: use the file if it's on disk, otherwise
   * skip that clip.
   *
   * With it, bytes can also be fetched from remote — source media uploaded directly leaves only a
   * pointer in the working tree, `existsSync` returns false for it, and a whole narration would
   * quietly vanish from the final film.
   */
  resolve?: MediaResolver;
}): Promise<string | null> {
  const manifest = soundsStemManifest(opts.sounds, {
    ...(opts.totalMs != null ? { totalMs: opts.totalMs } : {}),
  });
  /* Resolve all paths first, then build the graph: graph building is a pure function (so whether
     the graph is right can be tested) and must not turn async just to fetch bytes. */
  const resolved = await resolveAll(
    manifest.clips.map((clip) => clip.url),
    opts.resolve ?? (async (src) => {
      const abs = join(opts.workspace, src);
      return existsSync(abs) ? abs : null;
    }),
  );
  const audible = await audibleSources(resolved);
  const plan = mixPlan(manifest, {
    mapSrc: (src) => audible.get(src) ?? null,
    ...(opts.totalMs != null ? { totalMs: opts.totalMs } : {}),
  });
  if (!plan) return null;

  /* Mix to a side file and only land on out after mastering — if something fails midway, out
     isn't left holding an unmastered half-product, which looks exactly like the finished one,
     just 5 dB quieter. */
  const raw = `${opts.out}.raw.m4a`;
  await ffmpeg([
    ...plan.inputs.flatMap((path) => ['-i', path]),
    '-filter_complex', plan.filter,
    '-map', `[${plan.out}]`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', String(SAMPLE_RATE),
    '-y', raw,
  ]);
  try {
    if (!(await master(raw, opts.out))) renameSync(raw, opts.out);
  } finally {
    rmSync(raw, { force: true });
  }
  return opts.out;
}
