/**
 * A film → the finished video (mp4 + poster).
 *
 * The whole conversation is hot-reloaded: the owner changes a line, the agent touches `film.tsx`,
 * and the next frame reflects it; nothing is ever bundled. Bundling happens only here, at the
 * moment the film is handed off (download, share, publish).
 *
 * Frames are captured the same way `anim look` does it: same shot page, same seek. Only the
 * density differs: look grabs a few dozen frames for the agent, this grabs every frame at the
 * frame rate. Sharing the path isn't a convenience, it's **required**: the frame the agent sees
 * while self-checking must be the same thing as the frame in the export. Otherwise it tunes the
 * timing against its check and the export comes out different.
 *
 * Frames never touch disk. A three-minute 1080p film is 5000+ frames, well over 10 GB as PNGs,
 * and their only purpose is to be eaten by x264 right away, so they go straight into ffmpeg's
 * stdin.
 */

import type { FilmSoundEntry } from '@animspark/core';
import { FilmCliError, mixdownFilm } from '@animspark/film-build';
import { spawn } from 'node:child_process';
import {
  closeSync, copyFileSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readSync, readdirSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { SHOT_SCALE_MAX, withShot } from './shoot';
import { workspaceMediaResolver } from '../workspace-media';

export const DEFAULT_RENDER_FPS = 30;
/** Frames are JPEG-compressed before x264. Lossless PNG here just multiplies encode time. */
const FRAME_QUALITY = 94;
const POSTER_QUALITY = 88;
const CRF = 20;
/** VP9 quality. Not the same scale as x264's crf: 20 is too soft here, 24 roughly matches. */
const VP9_CRF = 24;

/**
 * Output format.
 *
 * | | Codec | Alpha | Who reads it |
 * |---|---|---|---|
 * | `mp4`    | H.264 / yuv420p          | no  | Everything. Full-film delivery uses this |
 * | `webm`   | VP9 / yuva420p           | yes | Chrome / Firefox / the web. Not Safari |
 * | `prores` | ProRes 4444 / yuva444p10 | yes | AE / Premiere / FCP / Resolve. An order of magnitude larger |
 * | `png`    | PNG sequence             | yes | Everything (Unity / Blender / Nuke). Largest |
 *
 * **Verifying webm alpha requires naming the decoder explicitly.** VP9 alpha isn't in the pixel
 * format: it's a second VP9 stream stored in WebM BlockAdditional blocks, with `AlphaMode=1` on
 * the track. ffmpeg's built-in vp9 decoder can't read that layer: `ffprobe` reports `yuv420p` and
 * every decoded pixel is opaque. To see it, use `ffmpeg -c:v libvpx-vp9 -i out.webm`. This trap
 * is costly because it points the wrong way: the encode side is correct, the check says "alpha is
 * gone", and someone goes and changes a command that was never wrong. Browsers and libvpx both
 * read it; only ffmpeg's default decoder doesn't.
 */
export type FilmRenderFormat = 'mp4' | 'webm' | 'prores' | 'png';

/** Whether this format carries an alpha channel. */
export function formatCarriesAlpha(format: FilmRenderFormat): boolean {
  return format !== 'mp4';
}

const FORMAT_EXT: Record<FilmRenderFormat, string> = {
  mp4: 'mp4', webm: 'webm', prores: 'mov', png: '',
};

function videoArgs(format: FilmRenderFormat): string[] {
  if (format === 'webm') {
    return [
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
      /* `-b:v 0` doesn't mean "no bitrate": it switches libvpx to **constant quality** mode.
         Without it crf is only a cap, the default bitrate is what actually governs, and the
         picture comes out much softer than asked for. */
      '-b:v', '0', '-crf', String(VP9_CRF),
      '-row-mt', '1', '-threads', '4',
    ];
  }
  if (format === 'prores') {
    /* Only 4444 has alpha (the 422 profiles don't). `-alpha_bits 16` is the lossless setting:
       matte edges get keyed and composited, and saving those bits buys a ring of jaggies. */
    return ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-threads', '4'];
  }
  // Automatic threading plus medium's 40-frame lookahead retains gigabytes at 4K.
  // Bound both without changing resolution, frame rate, or the CRF quality target.
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(CRF), '-pix_fmt', 'yuv420p',
    '-threads', '4', '-rc-lookahead', '10'];
}

/**
 * Chromium's DSF tops out at 2. For 3x / 4x, capture at 2x and let ffmpeg upscale the rest.
 * 1 means "deliver at captured size"; ProRes doesn't even need the round-to-even step.
 */
export function extraCaptureScale(scale: number | undefined): number {
  if (scale == null || !(scale > SHOT_SCALE_MAX)) return 1;
  return scale / SHOT_SCALE_MAX;
}

/** The final `-vf`. `extra` is the further upscale relative to the capture, usually 1. */
export function encodeScaleFilter(format: FilmRenderFormat, extra = 1): string[] {
  const even = format !== 'prores';
  if (extra > 1.001) {
    const k = extra.toFixed(6).replace(/\.?0+$/, '');
    return even
      ? ['-vf', `scale=trunc(iw*${k}/2)*2:trunc(ih*${k}/2)*2`]
      : ['-vf', `scale=iw*${k}:ih*${k}`];
  }
  if (even) return ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
  return [];
}

/**
 * Output dimensions.
 *
 * The rasterized size has to come from the capture itself (`captured`); it can't be computed,
 * because Chromium's DSF rounding rules aren't ours. ffmpeg then changes it once more, and the
 * `trunc(iw*k/2)*2` in `encodeScaleFilter` is where these lines come from: the same formula lives
 * in two places, and the day someone changes the filter and forgets this, the manifest starts lying.
 */
export function encodedSize(
  captured: { w: number; h: number },
  format: FilmRenderFormat,
  extra = 1,
): { w: number; h: number } {
  if (format === 'prores' && !(extra > 1.001)) return { w: captured.w, h: captured.h };
  const k = extra > 1.001 ? extra : 1;
  if (format === 'prores') return { w: Math.round(captured.w * k), h: Math.round(captured.h * k) };
  const even = (n: number) => Math.trunc((n * k) / 2) * 2;
  return { w: even(captured.w), h: even(captured.h) };
}

/** Actual pixel size of the capture, read from the poster just written (same capture path as frames). */
async function capturedSize(poster: string): Promise<{ w: number; h: number } | null> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(poster).metadata();
    return meta.width && meta.height ? { w: meta.width, h: meta.height } : null;
  } catch {
    return null;
  }
}

/** PNG sequences skip the pipe, so 3x/4x has to upscale each file. */
async function scalePngDir(dir: string, extra: number): Promise<void> {
  const sharp = (await import('sharp')).default;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.png')) continue;
    const path = join(dir, name);
    const img = sharp(path);
    const meta = await img.metadata();
    const w = Math.max(2, Math.round((meta.width ?? 1) * extra / 2) * 2);
    const h = Math.max(2, Math.round((meta.height ?? 1) * extra / 2) * 2);
    writeFileSync(path, await img.resize(w, h).png().toBuffer());
  }
}

/** Time of each frame. The last is clamped inside the duration: at the very end, everything has exited. */
export function frameTimes(durationMs: number, fps: number): number[] {
  const count = Math.max(1, Math.ceil((durationMs / 1000) * fps));
  return Array.from({ length: count }, (_, i) => (
    Math.min(Math.round((i * 1000) / fps), Math.max(0, durationMs - 1))
  ));
}

/** Pipe that frames are fed into. If ffmpeg dies, surface what it said, not just EPIPE. */
interface Encoder {
  write(frame: Buffer): Promise<void>;
  finish(): Promise<void>;
  kill(): Promise<void>;
}

export function openEncoder(args: string[], signal?: AbortSignal): Encoder {
  signal?.throwIfAborted();
  /* Log down to warning. stderr is only shown on failure, and the line that actually explains
     it is often a warning (e.g. "Could not find codec parameters"); keep only errors and all
     you're left with is "Invalid argument". */
  const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', ...args], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk).slice(-4000); });
  // Swallow EPIPE on stdin: if ffmpeg dies first this becomes an unhandled exception that
  // buries the real cause (the line in stderr).
  proc.stdin.on('error', () => {});
  const closed = new Promise<number>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => resolve(code ?? -1));
  });
  const abort = () => { proc.kill('SIGKILL'); };
  signal?.addEventListener('abort', abort, { once: true });
  // Observe spawn errors even while the caller is still opening the browser.
  void closed.finally(() => signal?.removeEventListener('abort', abort)).catch(() => {});

  return {
    async write(frame) {
      if (!proc.stdin.writable) {
        /* Wait for it to actually exit first. ffmpeg dies before we've read its stderr;
           without waiting, that part of the thrown message is empty, and it's the only
           part that explains why. */
        const code = await closed.catch(() => -1);
        throw new FilmCliError(`ffmpeg exited early (code ${code}):\n${stderr}`);
      }
      // A drain-only wait never settles if ffmpeg exits while the pipe is full.
      // The write callback handles both backpressure and a closed/broken pipe.
      await new Promise<void>((resolve, reject) => {
        proc.stdin.write(frame, error => error ? reject(error) : resolve());
      }).catch(async () => {
        const code = await closed.catch(() => -1);
        throw new FilmCliError(`ffmpeg exited early (code ${code}):\n${stderr}`);
      });
    },
    async finish() {
      proc.stdin.end();
      const code = await closed;
      if (code !== 0) throw new FilmCliError(`ffmpeg exit code ${code}:\n${stderr}`);
    },
    async kill() {
      proc.kill('SIGKILL');
      await closed.catch(() => {});
    },
  };
}

/** Runs that don't use stdin (faststart remux, decode-one-frame check). stderr is surfaced on failure too. */
function runFfmpeg(args: string[]): Promise<void> {
  const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk).slice(-4000); });
  return new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new FilmCliError(`ffmpeg exit code ${code ?? -1}:\n${stderr}`));
    });
  });
}

/** mp4 top-level boxes. Reads only each box's 8-byte header, so a huge mdat never goes into memory. */
export interface Mp4Box {
  type: string;
  size: number;
  offset: number;
}

export function mp4TopLevelBoxes(path: string): Mp4Box[] {
  const fd = openSync(path, 'r');
  try {
    const fileSize = fstatSync(fd).size;
    const boxes: Mp4Box[] = [];
    const hdr = Buffer.alloc(16);
    let offset = 0;
    while (offset + 8 <= fileSize) {
      readSync(fd, hdr, 0, 8, offset);
      let size = hdr.readUInt32BE(0);
      const type = hdr.toString('ascii', 4, 8);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > fileSize) break;
        readSync(fd, hdr, 0, 8, offset + 8);
        size = Number(hdr.readBigUInt64BE(0));
        header = 16;
      } else if (size === 0) {
        size = fileSize - offset;
      }
      if (size < header || offset + size > fileSize) break;
      boxes.push({ type, size, offset });
      offset += size;
    }
    return boxes;
  } finally {
    closeSync(fd);
  }
}

/**
 * Whether this file will play.
 *
 * Broken files with normal duration and frame count per ffprobe do exist: two stacked moovs,
 * chunk offsets pointing into the second index's bytes, every decode an Invalid NAL, and the
 * player freezes on the first frame. ffmpeg still exits 0 when writing it. Counting moovs catches
 * this class on the spot; decoding the first frame is done separately in finalizeMp4.
 */
export function assertMp4Playable(path: string): void {
  const boxes = mp4TopLevelBoxes(path);
  const moov = boxes.filter((box) => box.type === 'moov');
  if (moov.length !== 1) {
    throw new FilmCliError(
      `mp4 mux is unusable: ${moov.length} moov atoms (need 1)`,
    );
  }
  if (!boxes.some((box) => box.type === 'mdat')) {
    throw new FilmCliError('mp4 mux is unusable: no mdat');
  }
}

/**
 * Move the moov to the front of the file. Must write a separate file and then rename: when
 * source and destination are the same path, ffmpeg's faststart inserts the new index ahead of the
 * old one without fixing chunk offsets, and playback freezes through the first half.
 */
export async function finalizeMp4(
  encoded: string,
  dest: string,
  /* Not dest + '.faststart': some players open `film.mp4.faststart` as a video by extension
     and lock the file mid-write. Use a proper name in the same directory. Local exports land
     in a directory the user picked, so that caller passes its own hidden name. */
  staged = join(dirname(dest), 'film.faststart.mp4'),
): Promise<void> {
  const drop = (file: string) => {
    try { if (existsSync(file)) unlinkSync(file); } catch { /* cleanup failure doesn't affect the result */ }
  };
  const sync = (file: string) => {
    const fd = openSync(file, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  };
  const install = (src: string) => {
    copyFileSync(src, dest);
    drop(src);
  };
  try {
    /* The pipe just closed; data may not be on disk yet. faststart on a partial file writes a bad index. */
    sync(encoded);
    await runFfmpeg(['-i', encoded, '-c', 'copy', '-movflags', '+faststart', staged]);
    sync(staged);
    assertMp4Playable(staged);
    await runFfmpeg(['-loglevel', 'error', '-xerror', '-i', staged, '-frames:v', '1', '-f', 'null', '-']);
    install(staged);
    drop(encoded);
  } catch (error) {
    drop(staged);
    /* If the remux fails, the piped encode (moov at the end) still plays locally; don't waste eight minutes. */
    if (existsSync(encoded)) {
      try {
        assertMp4Playable(encoded);
        await runFfmpeg(['-loglevel', 'error', '-xerror', '-i', encoded, '-frames:v', '1', '-f', 'null', '-']);
        install(encoded);
        return;
      } catch {
        drop(encoded);
      }
    }
    throw error;
  }
}

/**
 * Whether the exported file is actually transparent.
 *
 * **This field is mandatory.** Transparent exports have a whole family of silent failures: the MG
 * paints its own full-frame background (the manual says not to; the model does it anyway), the
 * clip's design relies on the film's background behind it, or `mix-blend-mode` loses its meaning
 * with no backdrop. All three export normally, with normal size and the right extension, and only
 * turn out to be a solid brick once layered in an editor.
 *
 * Without measuring, the user gets an opaque file called `xxx.webm` and the most reasonable
 * explanation is that our export is broken. Measuring lets us say on the spot which side is at
 * fault. The same check is already used by `anim image gen --transparent` (see image-cli's
 * alphaOf): the extension guarantees nothing; judge by pixels.
 */
export interface AlphaReport {
  /** Whether any pixel is actually transparent. false = the clip painted its own background. */
  any: boolean;
  /** Coverage: 1 = fully opaque, 0 = fully transparent. Mean alpha over the sampled frames. */
  coverage: number;
  /** Number of frames sampled. */
  frames: number;
}

/** Frames to sample. Decoding all is not worth it; transparency is a property of the clip, not one frame. */
const ALPHA_PROBES = 12;

/**
 * Alpha of the sampled frames: read `stats()` directly, don't go through `extractChannel`.
 *
 * **When a whole frame is opaque, the captured PNG has no alpha channel at all** (Chromium drops
 * it when encoding; `metadata().channels` is 3). On such an image `ensureAlpha().extractChannel(3)`
 * neither errors nor adds a channel: it returns the **red channel**. So exactly the case that should
 * scream "this clip has a background" measures as a small number (the mean R of a dark background),
 * which looks like "almost fully transparent": the conclusion is inverted, and nothing errors.
 * Measured: a full-frame dark-blue gradient background came out at 0.03, only an order of magnitude
 * from a genuine lower-third bar (0.001); the two were indistinguishable in the receipt.
 *
 * The channel count is itself the answer: three channels = no alpha in this frame, fully covered.
 */
export async function measureAlpha(frames: readonly Buffer[]): Promise<AlphaReport | null> {
  if (!frames.length) return null;
  try {
    const sharp = (await import('sharp')).default;
    let sum = 0;
    let sawTransparent = false;
    for (const buf of frames) {
      const stats = await sharp(buf).stats();
      const alphaBand = stats.channels[3];
      sum += alphaBand ? alphaBand.mean / 255 : 1;
      if (!stats.isOpaque) sawTransparent = true;
    }
    return { any: sawTransparent, coverage: sum / frames.length, frames: frames.length };
  } catch {
    /* Failing to measure isn't a failed export: better to drop the field than block a good film. */
    return null;
  }
}

export interface RenderFilmOptions {
  workspace: string;
  /**
   * Sound list: `FilmEval.sounds` as collected from the tree during evaluation, passed through as is.
   *
   * Sound only; picture comes from the shot page. The two stay separate through this whole
   * pipeline: picture is pixels, sound is a schedule, and each is composited by its own executor.
   */
  sounds: readonly FilmSoundEntry[];
  /** Picture: the already-written shot page (see code-shoot). */
  page: string;
  /** How long to export. For a single-clip export this is the clip's length, not the film's. */
  durationMs: number;
  /**
   * Film time (ms) to start capturing from. Default 0 (whole film).
   *
   * The output's own timeline still starts at 0: the export is a standalone video, not an offset
   * reference into the original.
   */
  fromMs?: number;
  /**
   * Keep only this clip on stage. Default is the full composited stage.
   *
   * Goes together with `fromMs` / `durationMs`: exporting one MG means "hide everything else on
   * stage and step frame by frame through this clip's own span".
   */
  only?: string;
  /** The clip's box in canvas coordinates. When set, captures are cropped to it. */
  crop?: { x: number; y: number; w: number; h: number };
  /**
   * Multiple of the clip's native size. Default 1. Chromium DSF tops out at 2; ffmpeg upscales beyond that.
   */
  scale?: number;
  /** Where the output goes. */
  outDir: string;
  /** Output format. Default mp4 (the full-film delivery path). */
  format?: FilmRenderFormat;
  fps?: number;
  /** Output width. Defaults to the stage's native size. */
  width?: number;
  stage: { w: number; h: number };
  posterAtMs?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface RenderFilmResult {
  /** The output. For `png` it's a directory of numbered frames. */
  video: string;
  poster: string;
  /** Films without sound still export; then this is null. */
  audio: string | null;
  frames: number;
  fps: number;
  /**
   * The output's real pixel size.
   *
   * **Not** the stage size from the options: `scale` goes through Chromium's raster density, and
   * the final ffmpeg step rounds edges to even. The delivery manifest (manifest.json) reports these
   * two numbers, and players and publishing read it. Report a computed theoretical value and a
   * 1080×1919 stage is off by a pixel, an error that only surfaces when someone crops by the manifest.
   */
  width: number;
  height: number;
  durationMs: number;
  posterAtMs: number;
  tookMs: number;
  format: FilmRenderFormat;
  /** Measured transparency. null for formats without alpha, or when it can't be measured. */
  alpha: AlphaReport | null;
  /** Errors the MG threw in the page. A render that succeeds with errors usually has blank frames. */
  errors: string[];
}

export async function renderFilm(opts: RenderFilmOptions): Promise<RenderFilmResult> {
  const startedAt = Date.now();
  const { durationMs } = opts;
  if (durationMs <= 0) throw new FilmCliError('This film is still empty — not one scene, nothing to export');

  const format = opts.format ?? 'mp4';
  const alpha = formatCarriesAlpha(format);
  const fps = opts.fps ?? DEFAULT_RENDER_FPS;
  /* Frame times are **local**: 0 is the start of this span. The export is a standalone video, so
     its own ms 0 must be the content's ms 0; `fromMs` supplies where on stage to seek. */
  const from = opts.fromMs ?? 0;
  const times = frameTimes(durationMs, fps);
  /* Poster at one third. Not the start: that's usually mid fade-in and captures black. (It used
     to be "200ms before the first beat ends", which landed on a transition fade-out, and a film
     got published with a solid black poster.) */
  const posterAtMs = opts.posterAtMs ?? Math.round(durationMs / 3);
  mkdirSync(opts.outDir, { recursive: true });

  /* The poster follows the picture. A jpg poster for an alpha format paints the transparency
     right back in, and the poster is often the first thing the user sees; a black-background
     thumbnail makes it look like the export itself failed. */
  const poster = join(opts.outDir, alpha ? 'poster.png' : 'poster.jpg');
  const video = format === 'png'
    ? join(opts.outDir, 'frames')
    : join(opts.outDir, `film.${FORMAT_EXT[format]}`);
  if (format === 'png') mkdirSync(video, { recursive: true });

  // Mix sound first: it's cheap (a few hundred ms) while picture takes minutes. The other way
  // round, a bad mix parameter would only be reported after thousands of frames were captured.
  const audio = await mixdownFilm({
    workspace: opts.workspace,
    sounds: opts.sounds,
    out: join(opts.outDir, 'audio.m4a'),
    totalMs: durationMs,
    resolve: workspaceMediaResolver(opts.workspace),
  });

  const extra = extraCaptureScale(opts.scale);
  /* PNG sequences skip ffmpeg: captures are already PNG, and another pass through the pipe
     would just re-encode them.
     mp4's +faststart can't run in the same piped encode: input is stdin, so ffmpeg can only
     rewrite the already-written file in place after finishing. A ~100s 1080p film ends up with
     two moovs: the new index inserted after ftyp, the old one still before mdat, and chunk
     offsets still computed as if there were one moov. The player's first read lands in the
     second moov's bytes, every NAL is corrupt, and the picture freezes on frame one.
     So the piped pass writes a file with moov at the end, and faststart is a separate copy remux. */
  const encodePath = format === 'mp4' ? join(opts.outDir, 'film.encode.mp4') : video;
  let encoder: Encoder | null = null;
  const killEncoder = async () => { await encoder?.kill(); };
  const encoderArgs = [
    /* The input codec must be stated, not sniffed. ffmpeg sniffs the first few KB of the pipe,
       and how many KB a frame is depends on the picture: one 1080p photo frame is enough, but
       several frames of a 480×270 solid color aren't, so it exits with "unknown codec". The
       symptom is that big films export and small ones don't, and the error says nothing about images. */
    '-filter_threads', '1',
    '-f', 'image2pipe', '-vcodec', alpha ? 'png' : 'mjpeg', '-threads', '1', '-framerate', String(fps), '-i', '-',
    ...(audio ? ['-i', audio] : []),
    ...videoArgs(format),
    /* Width and height must be even for 4:2:0 to encode (mp4's yuv420p and webm's yuva420p both
       are). Stage size comes from the user and 1080×1919 is just as valid; without this the error
       is "width not divisible by 2", which sounds like an ffmpeg bug. ProRes 4444 doesn't
       subsample and doesn't need it, but 3x/4x still relies on it to upscale the DSF=2 capture. */
    ...encodeScaleFilter(format, extra),
    /* The mixdown already trimmed the audio to the picture's length, so no -shortest here (it
       would cut to whichever is shorter, dropping the silent picture at the end).
       The mix is AAC: mp4 and mov accept it, so copy; WebM doesn't, so transcode to Opus.
       Copying it makes ffmpeg exit immediately with a message that never mentions the audio. */
    ...(audio ? ['-c:a', format === 'webm' ? 'libopus' : 'copy'] : ['-an']),
    encodePath,
  ];

  let done = 0;
  /* Sampled frames. Keep bytes, not paths: only the PNG sequence has intermediate files to read. */
  const probeEvery = Math.max(1, Math.floor(times.length / ALPHA_PROBES));
  const probes: Buffer[] = [];
  try {
    const { errors } = await withShot({
      page: opts.page,
      stage: opts.stage,
      workspace: opts.workspace,
      ...(opts.width != null ? { width: opts.width } : {}),
      ...(opts.scale != null ? { scale: opts.scale } : {}),
      ...(opts.crop ? { crop: opts.crop } : {}),
      ...(alpha ? { alpha: true } : {}),
      ...(opts.only ? { only: opts.only } : {}),
    }, async (shot) => {
      // Grab the poster in the same page; launching chromium again for one image wastes a few hundred ms.
      await shot.seek(from + posterAtMs);
      await shot.capture({ path: poster, jpegQuality: POSTER_QUALITY });
      /* Check the name after seeking: a clip is only mounted during its own span, so asking at
         the start of the film about a clip that appears at 30s always answers no. A mismatched
         name exports a fully transparent span: valid, silent, and entirely wrong. */
      if (opts.only && !await shot.onStage(opts.only)) {
        throw new FilmCliError(`No clip called "${opts.only}" on this stage — the shot list may have changed`);
      }

      // Start only after acquiring the browser slot; queued jobs must not own ffmpeg processes.
      if (format !== 'png') encoder = openEncoder(encoderArgs, opts.signal);
      for (const [i, atMs] of times.entries()) {
        if (opts.signal?.aborted) throw new FilmCliError('The export was cancelled');
        await shot.seek(from + atMs);
        const frame = await shot.capture({
          ...(format === 'png' ? { path: join(video, `${String(i).padStart(6, '0')}.png`) } : {}),
          ...(alpha ? {} : { jpegQuality: FRAME_QUALITY }),
        });
        if (encoder) await encoder.write(frame);
        if (alpha && i % probeEvery === 0 && probes.length < ALPHA_PROBES) probes.push(frame);
        done += 1;
        opts.onProgress?.(done, times.length);
      }
      await encoder?.finish();
      return null;
    });
    if (format === 'mp4') await finalizeMp4(encodePath, video);
    if (format === 'png' && extra > 1.001) await scalePngDir(video, extra);
    /* If it can't be measured, fall back to the stage size. A bit less precision beats voiding
       the whole export over a failed poster read; those thousands of frames are already spent. */
    const captured = await capturedSize(poster) ?? { w: opts.stage.w, h: opts.stage.h };
    const size = encodedSize(captured, format, extra);
    return {
      video,
      poster,
      audio,
      frames: times.length,
      fps,
      width: size.w,
      height: size.h,
      durationMs,
      posterAtMs,
      tookMs: Date.now() - startedAt,
      format,
      alpha: alpha ? await measureAlpha(probes) : null,
      errors,
    };
  } catch (error) {
    await killEncoder();
    throw error;
  }
}
