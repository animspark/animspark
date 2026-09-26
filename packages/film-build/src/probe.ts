/**
 * Thin wrappers around ffprobe / ffmpeg.
 *
 * How long and how large a piece of media is must be **measured**, never estimated. The whole
 * timeline is built on `durMs`: estimate 200 ms wrong and every later segment has to move, and
 * after moving, every time hard-coded in the MG is invalid. So we'd rather run ffprobe once more
 * per asset.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface MediaFacts {
  durMs?: number;
  w?: number;
  h?: number;
  /**
   * The source's own frame rate.
   *
   * The export frame rate has to be able to follow it: exporting 25 fps footage at 30 fps repeats
   * one frame in every five, a visible stutter on motion. It feels choppier than the original, yet
   * every frame looks fine on its own, so screenshots can't catch it. Absent when it can't be
   * probed (animated images, audio-only, odd variable-frame-rate files).
   */
  fps?: number;
  /**
   * The video codec (`h264` / `prores` / `qtrle` / `vp9` …).
   *
   * It answers a question the container name can't: **can the browser decode it**. A `.mov` with
   * H.264 plays fine; with ProRes not a single pixel shows — and both have the same extension. The
   * decision has to use this field (see needsBrowserPreview in the engine).
   */
  vcodec?: string;
  /** Pixel format (`yuv420p` / `yuva444p10le` …). The ones with an `a` have a real alpha channel. */
  pixFmt?: string;
  hasAudio: boolean;
  hasVideo: boolean;
}

/** ffprobe reports a fraction like `30000/1001`; divide it to get the frame rate. */
function parseFrameRate(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const [num, den] = raw.split('/');
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n <= 0) return undefined;
  return Number((n / d).toFixed(3));
}

export interface ProbeOptions {
  /**
   * Kill after this many milliseconds. Omitted = wait forever.
   *
   * The export path should wait forever — a 4 GB master has to finish probing even if it takes a
   * while. The one that needs a limit is **reconciliation**: it runs before every `anim` command,
   * and ffprobe hitting a corrupt file can keep reading indefinitely. The symptom then isn't "this
   * asset has no duration", it is the whole CLI going silent.
   */
  timeoutMs?: number;
}

export async function probe(path: string, opts: ProbeOptions = {}): Promise<MediaFacts> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,r_frame_rate',
    '-of', 'json',
    path,
  ], opts.timeoutMs ? { timeout: opts.timeoutMs } : {});
  const json = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: {
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }[];
  };
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const seconds = Number(json.format?.duration ?? NaN);
  /* Prefer avg: r_frame_rate is the container's declared upper bound and can report numbers like
     1000 on VFR files; avg is computed from actual frames. Fall back to r when avg is missing
     (single-frame images). */
  const fps = parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate);
  return {
    ...(Number.isFinite(seconds) ? { durMs: Math.round(seconds * 1000) } : {}),
    ...(video?.width ? { w: video.width } : {}),
    ...(video?.height ? { h: video.height } : {}),
    ...(fps != null ? { fps } : {}),
    ...(video?.codec_name ? { vcodec: video.codec_name } : {}),
    ...(video?.pix_fmt ? { pixFmt: video.pix_fmt } : {}),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    hasVideo: Boolean(video),
  };
}

/** The common case where only the duration is needed. */
export async function durationMs(path: string): Promise<number> {
  const facts = await probe(path);
  if (facts.durMs == null) throw new Error(`Cannot read a duration from ${path}`);
  return facts.durMs;
}

export async function ffmpeg(args: string[]): Promise<void> {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    maxBuffer: 1024 * 1024 * 32,
  });
}

/**
 * The variant for when you need to read what ffmpeg prints (analysis filters such as ebur128).
 *
 * `ffmpeg` above sets loglevel to error, while analysis filters report at info level — running a
 * measurement through it always returns an empty string.
 */
export async function ffmpegCapture(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run('ffmpeg', ['-hide_banner', '-nostats', ...args], { maxBuffer: 1024 * 1024 * 32 });
}
