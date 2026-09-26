/**
 * Contact sheet — a set of frames tiled into one image, each cell stamped with its millisecond time.
 *
 * The stamp is the whole point. Without it, an agent that sees "the hit in row 3, cell 4 is too
 * early" can't act on it — it would have to count cells and work back to milliseconds from the
 * sample rate, and a mistake there gives no warning. With the number on the cell, it can be used
 * as soon as it is seen.
 *
 * The time stamps are drawn in the browser when the frames are captured; tiling is left to ffmpeg
 * (`xstack`), which is already a dependency: one filter_complex, no canvas to spin up.
 */

import { execFile } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { FilmCliError } from './workspace';

const run = promisify(execFile);

/** mm:ss.mmm — the same notation as the times in `anim film get`, so nobody has to convert between them. */
export function stampOf(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const mm = String(Math.floor(total / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((total % 60_000) / 1000)).padStart(2, '0');
  return `${mm}:${ss}.${String(total % 1000).padStart(3, '0')}`;
}

/** Cells per row. Too small and you can't read the composition; too large and few frames fit — so it depends on the frame count. */
export function columnsFor(count: number): number {
  if (count <= 4) return count;
  if (count <= 9) return 3;
  if (count <= 24) return 4;
  return 6;
}

/**
 * Build a contact sheet.
 *
 * This only scales and tiles — the time stamps are rendered in the browser when the frames are
 * captured. ffmpeg's `drawtext` isn't used: that filter needs libfreetype, and whether ffmpeg is
 * built with it depends on which build is installed (the one on this machine isn't), so the same
 * command fails with "Filter not found" on another machine. Stamping text comes for free in the
 * browser, and it uses the page's own font stack.
 */

/** Size of an image. Cells are scaled to one size, and a frame may carry a time bar, so the ratio isn't necessarily 16:9. */
async function probeSize(path: string): Promise<{ w: number; h: number }> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', path,
  ]);
  const [w, h] = stdout.trim().split(',').map(Number);
  if (!w || !h) throw new FilmCliError(`Cannot read the dimensions of this frame: ${path}`);
  return { w, h };
}

/** Encoders need even dimensions. */
const evenUp = (n: number): number => (n % 2 === 0 ? n : n + 1);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function contactSheet(opts: {
  frames: readonly { atMs: number; path: string }[];
  outPath: string;
  cols?: number;
  /** Cell width in pixels. Defaults to 480 — enough to read the composition, and a 4×6 sheet is only 2880 wide. */
  cellWidth?: number;
}): Promise<{ cols: number; rows: number }> {
  if (!opts.frames.length) throw new FilmCliError('No frames to lay out');
  const cols = Math.max(1, opts.cols ?? columnsFor(opts.frames.length));
  const rows = Math.ceil(opts.frames.length / cols);
  const cellW = opts.cellWidth ?? 480;

  /* It isn't enough for the frame file to exist; it has to be **a real PNG**.
   *
   * Frame capture fails under heavy load (six headless Chromiums at once is enough), leaving an
   * empty file or half an image — while the `frames` array still has the entry. The receipt then
   * says "17 cells", the sheet shows only two, the rest are transparent holes, and whoever looks at
   * it thinks they've reviewed the whole film. Better to blow up here than hand out a misleading
   * contact sheet. */
  const bad: string[] = [];
  for (const frame of opts.frames) {
    if (!existsSync(frame.path)) { bad.push(`${frame.atMs}ms (the file is gone)`); continue; }
    const size = statSync(frame.path).size;
    /* This checks **structural completeness**, not size — a solid-color PNG can legitimately be
       about 300 bytes, and a byte-count threshold would reject good frames. It counts as fully
       written if it starts with the PNG header and ends with IEND. */
    if (size < 45) { bad.push(`${frame.atMs}ms (${size} bytes, empty)`); continue; }
    const head = Buffer.alloc(8);
    const tail = Buffer.alloc(12);
    const fd = openSync(frame.path, 'r');
    try {
      readSync(fd, head, 0, 8, 0);
      readSync(fd, tail, 0, 12, size - 12);
    } finally { closeSync(fd); }
    if (!head.equals(PNG_MAGIC)) bad.push(`${frame.atMs}ms (not a PNG)`);
    else if (!tail.includes('IEND')) bad.push(`${frame.atMs}ms (PNG written half-way, no end chunk)`);
  }
  if (bad.length) {
    throw new FilmCliError(
      `${bad.length} of ${opts.frames.length} frames did not come out:\n  ${bad.join('\n  ')}\n`
      + 'That usually means too much concurrency crushed the browser — run fewer at once, or lower --fps and try again.',
    );
  }

  /* One input per cell, positions computed here, laid out with `xstack`.
   *
   * This used to symlink the frames into a numbered sequence for the `tile` filter. **That path is
   * broken**: `tile` only emits an image once it has collected cols×rows frames, and emits nothing
   * if it can't fill them; forcing it with `-frames:v 1` yields a canvas with only the last two or
   * three cells and the rest blank — while ffmpeg exits 0 and the receipt still says "17 cells 4×5".
   * In other words, **whenever the frame count isn't a multiple of cols, the sheet is empty, with no
   * error**. Padding up to a multiple doesn't help either (tried): the padding frames show up and
   * the real ones are all lost.
   *
   * `xstack` doesn't buffer frames — N inputs, N coordinates, laid out in one go; a missing input
   * can't silently drop a cell. */
  const first = await probeSize(opts.frames[0]!.path);
  const cellH = evenUp(Math.round((first.h * cellW) / first.w));
  const PAD = 6;
  const inputs: string[] = [];
  const chains: string[] = [];
  const layout: string[] = [];
  opts.frames.forEach((frame, i) => {
    inputs.push('-i', frame.path);
    // Scale each cell to a common size, then pad right and bottom; tiled together, the padding forms the grid lines.
    chains.push(`[${i}:v]scale=${cellW}:${cellH}:flags=lanczos,`
      + `pad=${cellW + PAD}:${cellH + PAD}:0:0:color=#111111[c${i}]`);
    layout.push(`${(i % cols) * (cellW + PAD)}_${Math.floor(i / cols) * (cellH + PAD)}`);
  });
  const graph = `${chains.join(';')};${opts.frames.map((_, i) => `[c${i}]`).join('')}`
    + (opts.frames.length === 1 ? 'null[sheet]' : `xstack=inputs=${opts.frames.length}:layout=${layout.join('|')}:fill=#111111[sheet]`);

  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', graph,
    '-map', '[sheet]', '-frames:v', '1',
    opts.outPath,
  ], { maxBuffer: 64 * 1024 * 1024 });

  if (!existsSync(opts.outPath)) throw new FilmCliError('The contact sheet was never produced');
  return { cols, rows };
}

/**
 * Sample times.
 *
 * Both ends are included: a film's first and last frames are where things most often go wrong
 * (black opening, ending cut short), and stepping up from 0 at a fixed interval tends to skip
 * exactly the tail.
 */
export function sampleTimes(opts: {
  fromMs: number;
  toMs: number;
  /** Cells per second. Used when given; otherwise `count` evenly spaced samples. */
  fps?: number;
  count?: number;
}): number[] {
  const from = Math.max(0, Math.round(opts.fromMs));
  /* The end is exclusive: at exactly the film's duration, everything that should be on screen
     has already left. Without this clamp, the last cell of a default review is always black
     while `anim check` reports all green — two self-check tools contradicting each other, and the
     agent goes off to fix a black tail that doesn't exist. The export side's frameTimes has long
     applied the same clamp. */
  const to = Math.max(from, Math.round(opts.toMs) - 1);
  const span = to - from;
  if (span === 0) return [from];

  if (opts.fps && opts.fps > 0) {
    const step = 1000 / opts.fps;
    const out: number[] = [];
    /* The upper bound is `to`, not `to + 1`. That extra 1 ms would, when the step divides the
       duration evenly (6000 ms with --fps 2.5), put the last cell right back on the exclusive end
       — undoing the clamp above, and the black tail returns. */
    for (let t = from; t <= to; t += step) out.push(Math.round(t));
    // When the step doesn't divide evenly, the tail falls short; add the true last frame if the gap is over half a step, otherwise skip it to avoid a cramped extra cell.
    if (out.length > 0 && to - out[out.length - 1]! > step * 0.5) out.push(to);
    // Cap it: --from 0 --to 60000 --fps 30 is 1800 frames, which isn't a contact sheet, it's a render.
    if (out.length > 60) return sampleTimes({ fromMs: from, toMs: to, count: 60 });
    return out;
  }

  const count = Math.max(2, Math.min(40, opts.count ?? 24));
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(from + i * step));
}

/** Write a text index to accompany the contact sheet, for when reading the image directly isn't convenient. */
export function writeSheetIndex(outPath: string, frames: readonly { atMs: number }[], cols: number): void {
  const lines = frames.map((frame, index) => (
    `row ${Math.floor(index / cols) + 1}, cell ${(index % cols) + 1} = ${frame.atMs}ms (${stampOf(frame.atMs)})`
  ));
  writeFileSync(join(outPath), lines.join('\n'), 'utf8');
}
