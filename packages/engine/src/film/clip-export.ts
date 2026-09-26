/**
 * Export **one clip** of a film on its own, as a transparent-background asset.
 *
 * ## Why one shared function instead of wiring the CLI and the UI separately
 *
 * There are two entry points: `anim clip` typed by the agent, and the button the user clicks in
 * the inspector. Both need **the same file**: if what the user layers in AE differs from what the
 * agent self-checks, neither side is authoritative. When wired separately, what drifts first isn't
 * the picture but the murky details: one side muted and the other with sound, one measures alpha
 * and the other doesn't, one gives PNGs as a directory and the other as an archive. None of these
 * errors; one side's users just get an asset that's "close but wrong".
 *
 * Following the `/film/audio` precedent, both entry points end up in the same function.
 *
 * ## Why each clip gets its own name in the export directory
 *
 * `renderFilm` always writes `film.<ext>`: it was built for the whole film, one at a time, so name
 * collisions don't matter. Single-clip export is different: users export several clips in a row,
 * and if they're all `film.webm` each one **silently overwrites** the last, while the browser's
 * download bar shows `film.webm`, `film (1).webm`, ... with no way to tell which is which. So this
 * layer renames the output to the clip name at the end, and each clip renders into its own temp
 * directory first so two concurrent exports don't collide on the same `film.webm`.
 */

import { clipOwnedSounds } from '@animspark/core';
import { FilmCliError, evaluateFilm, ffmpeg, filmBuildSnapshot } from '@animspark/film-build';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { disposeShotPage, writeCodeShotPage } from './code-shoot';
import type { FilmRenderFormat } from './render';
import { SHOT_SCALE_MAX, SHOT_SCALE_MIN } from './shoot';
import { recordFilmFacts } from './asset-sync';
import { workspaceMediaFacts, workspaceMediaResolver } from '../workspace-media';

/** Formats single-clip export accepts. Full-film `mp4` stays too, for an opaque version of one clip. */
export const CLIP_FORMATS = new Set<FilmRenderFormat>(['webm', 'prores', 'png', 'mp4']);

/** Where exports land in the workspace. Not in version history (see task-archive's ARCHIVE_SKIP_DIRS). */
export const CLIP_OUT_DIR = '.anim-out/clip';

/**
 * What file each format lands as.
 *
 * Extension and MIME live together because **the download side only has the file name**: the
 * route receives `lw1.mov` and can only answer "what is this" from the extension. With two tables,
 * adding a format and forgetting one means the downloaded file won't open on double-click (or
 * macOS picks the wrong decoder), while both pieces of code look correct.
 *
 * PNG sequences are zipped: browsers can't download a directory.
 */
const DOWNLOAD: Record<FilmRenderFormat, { ext: string; mime: string }> = {
  webm: { ext: 'webm', mime: 'video/webm' },
  /* ProRes lives in a MOV container; labeled video/mp4, macOS opens it with the wrong decoder. */
  prores: { ext: 'mov', mime: 'video/quicktime' },
  png: { ext: 'zip', mime: 'application/zip' },
  mp4: { ext: 'mp4', mime: 'video/mp4' },
};

/** MIME type of this format's download. */
export function clipMime(format: FilmRenderFormat): string {
  return DOWNLOAD[format].mime;
}

/** The download route only has the file name, so answer by extension. Unknown: let the browser guess. */
export function clipMimeForFile(name: string): string {
  const hit = Object.values(DOWNLOAD).find((one) => name.endsWith(`.${one.ext}`));
  return hit?.mime ?? 'application/octet-stream';
}

/**
 * Turn a clip name into something usable as a file name.
 *
 * Clip names are chosen by the user in `film.json` and can contain slashes, spaces, CJK
 * characters, runs of dots. Used directly as a file name, at best it shows up garbled in the
 * download bar; at worst a name like `a/b` creates a subdirectory under the export directory, and
 * since the download route looks up a single file name, the export succeeds but can't be downloaded.
 */
export function clipFileStem(clipId: string): string {
  const safe = clipId.replace(/[^\w.\u4e00-\u9fff-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return safe.slice(0, 64) || 'clip';
}

export interface ClipExportResult {
  clip: string;
  /** The clip's source module, e.g. `mg/hook`. Video clips have none. */
  src?: string;
  /** Name of the file in the export directory. This is what the download route looks up. */
  file: string;
  bytes: number;
  format: FilmRenderFormat;
  /** The clip's start and length within the film, in seconds. */
  atSec: number;
  durationSec: number;
  frames: number;
  fps: number;
  /** Measured transparency. Absent for `mp4`. */
  alpha?: { any: boolean; coverage: number };
  /** When nothing measured transparent, explains why; it's usually not a broken export. */
  note?: string;
  tookSec: number;
  /** Errors the page reported during capture. If present, the picture may be missing something. */
  errors?: string[];
}

/**
 * Frame rate cap.
 *
 * Not a format limit but a **time** one: every frame is a seek plus a capture, so the run time is
 * proportional to fps. A 10-odd-second MG takes 30-40s at 30 fps and over two minutes at 120. No
 * delivery format needs more, and every step above is time the user spends waiting.
 */
const MAX_CLIP_FPS = 120;

/**
 * If the requested width doesn't make sense, say so right away instead of silently clamping.
 *
 * `width` is converted to a `deviceScaleFactor` (see shoot's SHOT_SCALE_MIN / MAX), so the allowed
 * range **depends on this film's stage**: 192 to 3840 for a 1920 film, 108 to 2160 for a 1080
 * portrait film. The layer below can only clamp; it doesn't know who asked for the number. Clamping
 * means asking for 4K gets 3840×2160, which is right, but on a 1080-wide portrait film it gets 2160
 * wide and the receipt says nothing. The file itself looks fine; the user discovers the wrong
 * resolution in their editor, after exporting twice.
 */
export function clipShotWidth(width: number | undefined, stageW: number): number | undefined {
  if (width == null) return undefined;
  const min = Math.ceil(stageW * SHOT_SCALE_MIN);
  const max = Math.floor(stageW * SHOT_SCALE_MAX);
  if (!Number.isFinite(width) || width < min || width > max) {
    throw new FilmCliError(
      `--width takes ${min}…${max} for this film (the stage is ${stageW} wide); got ${width}.`,
    );
  }
  return Math.round(width);
}

/**
 * Scale cap. Chromium's DSF tops out at 2; for 3x/4x ffmpeg upscales the 2x capture.
 * No delivery format needs more, and the UI doesn't offer it.
 */
const MAX_CLIP_SCALE = 4;
const MIN_CLIP_SCALE = 0.25;

export function clipShotFps(fps: number | undefined): number | undefined {
  if (fps == null) return undefined;
  if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_CLIP_FPS) {
    throw new FilmCliError(`--fps takes 1…${MAX_CLIP_FPS}; got ${fps}.`);
  }
  return fps;
}

export function clipShotScale(scale: number | undefined): number | undefined {
  if (scale == null) return undefined;
  if (!Number.isFinite(scale) || scale < MIN_CLIP_SCALE || scale > MAX_CLIP_SCALE) {
    throw new FilmCliError(`--scale takes ${MIN_CLIP_SCALE}…${MAX_CLIP_SCALE}; got ${scale}.`);
  }
  return scale;
}

export function clipShotCrop(crop: unknown): { x: number; y: number; w: number; h: number } | undefined {
  if (crop == null) return undefined;
  if (typeof crop !== 'object' || Array.isArray(crop)) {
    throw new FilmCliError('crop must be {x, y, w, h}');
  }
  const rec = crop as Record<string, unknown>;
  const x = rec.x;
  const y = rec.y;
  const w = rec.w;
  const h = rec.h;
  if ([x, y, w, h].some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    throw new FilmCliError('crop x, y, w, h must be finite numbers');
  }
  if ((w as number) < 8 || (h as number) < 8) {
    throw new FilmCliError('crop must be at least 8×8');
  }
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

export interface ClipExportOptions {
  workspace: string;
  clipId: string;
  format: FilmRenderFormat;
  fps?: number;
  width?: number;
  /**
   * Multiple of the clip's native size. 1 = native. Default 1.
   * Chromium's DSF tops out at 2; the render layer upscales anything larger afterwards.
   */
  scale?: number;
  /** The clip's box in canvas coordinates. When set, captures are cropped to it instead of measuring live. */
  crop?: unknown;
  /** Relative to the workspace. Default `.anim-out/clip`. */
  outDir?: string;
  signal?: AbortSignal;
  /**
   * How many frames have been captured.
   *
   * The UI needs this: a 10-odd-second MG takes 30-40 seconds, and a spinner that isn't moving
   * looks identical to one that's stuck. By second ten the user decides it's broken and clicks again.
   */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Export one clip.
 *
 * Narration, sound effects, and video audio inside the MG travel with the clip. Only sounds owned
 * by this instance count; the film's score is not pulled in just because it overlaps in time.
 */
export async function exportClip(opts: ClipExportOptions): Promise<ClipExportResult> {
  const { workspace: ws, clipId, format } = opts;
  if (!CLIP_FORMATS.has(format)) {
    throw new FilmCliError(`--format takes one of: ${[...CLIP_FORMATS].join(' · ')}`);
  }

  const film = await evaluateFilm(ws, {
    resolve: workspaceMediaResolver(ws),
    known: workspaceMediaFacts(ws),
  });
  try {
    recordFilmFacts(ws, film);
  } catch {
    /* A bookkeeping failure shouldn't take the export down with it. */
  }

  const scene = film.scenes.find((one) => one.clipId === clipId);
  if (!scene) {
    /* Which clips exist is a fact about **this film**, not something the user should guess. A
       typo and a deleted clip look identical here; only listing the names tells them apart. */
    const have = film.scenes.map((one) => one.clipId).filter(Boolean);
    throw new FilmCliError(
      `No clip called "${clipId}" in this film.`
      + (have.length ? `\nThis film has: ${have.join(' · ')}` : '\nThis film has no named clips.'),
    );
  }

  /* Validate width only after the stage is known: the allowed width depends on this film. */
  const fps = clipShotFps(opts.fps);
  const width = clipShotWidth(opts.width, film.stage.w);
  const scale = clipShotScale(opts.scale);
  const crop = clipShotCrop(opts.crop);

  const outRoot = join(ws, opts.outDir ?? CLIP_OUT_DIR);
  const stem = clipFileStem(clipId);
  /* Render into its own temp directory first: concurrent exports all get `film.<ext>` from `renderFilm`. */
  const stage = join(outRoot, `.${stem}.tmp`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  const { renderFilm } = await import('./render');
  const page = await writeCodeShotPage(ws, film.stage, film.durationMs, null, 'native', 'contain', filmBuildSnapshot(film));
  try {
    const out = await renderFilm({
      workspace: ws,
      sounds: clipOwnedSounds(film.sounds, scene),
      page,
      stage: film.stage,
      only: clipId,
      fromMs: scene.startMs,
      durationMs: scene.durMs,
      format,
      outDir: stage,
      ...(fps != null ? { fps } : {}),
      ...(width != null ? { width } : {}),
      ...(scale != null ? { scale } : {}),
      ...(crop ? { crop } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });

    const file = `${stem}.${DOWNLOAD[format].ext}`;
    const dest = join(outRoot, file);
    rmSync(dest, { force: true });
    if (format === 'png') await zipFrames(out.video, dest, out.audio);
    else renameSync(out.video, dest);
    pruneExports(outRoot, dest);

    const alpha = out.alpha;
    return {
      clip: clipId,
      ...(scene.src ? { src: scene.src } : {}),
      file,
      bytes: statSync(dest).size,
      format,
      atSec: Number((scene.startMs / 1000).toFixed(3)),
      durationSec: Number((out.durationMs / 1000).toFixed(3)),
      frames: out.frames,
      fps: out.fps,
      ...(alpha
        ? {
          alpha: { any: alpha.any, coverage: Number(alpha.coverage.toFixed(3)) },
          ...(alpha.any ? {} : {
            note: 'No transparent pixels: this block paints its own full-bleed background. '
              + 'Backgrounds belong on their own bottom-track block — see the mg skill.',
          }),
        }
        : {}),
      tookSec: Number((out.tookMs / 1000).toFixed(1)),
      ...(out.errors?.length ? { errors: out.errors.slice(0, 6) } : {}),
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
    disposeShotPage(page);
  }
}

/**
 * Total size cap for the export directory. Over it, delete oldest first.
 *
 * 2 GB is sized for the most expensive format: 1080p ProRes 4444 is about 40 MB/s, so a ten-second
 * MG is 400 MB. Exporting every clip of a ten-clip film is 4 GB, and **nobody ever comes back to
 * clean up**: the export directory isn't in version history, so it's on no existing cleanup path
 * and only goes away when the whole workspace is reclaimed. The more users export, the faster the
 * disk fills, and once it's full what breaks is something else (generation, uploads), with no log
 * pointing back here.
 */
const EXPORT_BUDGET_BYTES = 2 * 1024 ** 3;

/**
 * Shrink the export directory back under budget, oldest first.
 *
 * The file just exported is always kept: the user is about to download it. If a single file is
 * over budget on its own (a very long ProRes clip), keeping it and clearing everything else beats
 * deleting the one the user is waiting for.
 */
export function pruneExports(dir: string, keep: string, budget = EXPORT_BUDGET_BYTES): void {
  let rows: { path: string; size: number; mtime: number }[];
  try {
    rows = readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((path) => path !== keep)
      .flatMap((path) => {
        try {
          const stat = statSync(path);
          return stat.isFile() ? [{ path, size: stat.size, mtime: stat.mtimeMs }] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return;
  }

  let total = rows.reduce((sum, row) => sum + row.size, 0);
  try {
    total += statSync(keep).size;
  } catch {
    /* If the file just written is gone, count 0: this run fails anyway; no need for another error here. */
  }

  rows.sort((a, b) => a.mtime - b.mtime);
  for (const row of rows) {
    if (total <= budget) break;
    try {
      rmSync(row.path, { force: true });
      total -= row.size;
    } catch {
      /* Skip what can't be deleted. A cleanup failure shouldn't turn a successful export into a failure. */
    }
  }
}

/**
 * Zip a directory of numbered frames.
 *
 * No compression (`STORE`). PNG is already deflated; compressing again saves only a few percent
 * but runs thousands of frames through the server again. A five-second 1080p sequence is 100+ MB,
 * and that CPU pass would cost more than the whole export.
 */
export async function zipFrames(dir: string, dest: string, audio?: string | null): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const name of readdirSync(dir).sort()) {
    zip.file(name, await readFile(join(dir, name)));
  }
  if (audio) {
    const wav = `${dest}.audio.wav`;
    try {
      await ffmpeg(['-i', audio, '-c:a', 'pcm_s16le', '-y', wav]);
      zip.file('audio.wav', await readFile(wav));
    } finally {
      rmSync(wav, { force: true });
    }
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(dest, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
}
