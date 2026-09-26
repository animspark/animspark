/**
 * Draw sound as an image.
 *
 * `anim look --sound` fills the one step in this toolkit that was **impossible to self-check**.
 * Picture has contact sheets: sample frames, read them, fix what's wrong. Sound had no equivalent:
 * the receipt said "after placing, sample frames and check the hit points", but nothing in the
 * picture shows at which ms a sound's onset sits in the file. "Render a `--fps 4` pass and listen"
 * works for a person at a screen, not for the agent: it can't listen to an mp4.
 *
 * That left the only part of a film that could only be guessed, and it hides the costliest kind of
 * mistake: a −40dB sound effect that might as well not be there, an impact 200ms ahead of the
 * picture, a score that drops out three seconds before the end. check catches none of these (it
 * doesn't listen), and contact sheets can't show them.
 *
 * So draw the loudness. **What you can see, you can fix**: whether the mix envelope has that peak,
 * at which ms, whether two narration lines really have a breath between them. On the image each is
 * obvious at a glance.
 */

import { mixdownFilm, type FilmEval } from '@animspark/film-build';
import { workspaceMediaResolver } from '../workspace-media';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Envelope time resolution. 20ms per bin: finer isn't visible, coarser smears out a short click. */
const STEP_MS = 20;
/** Decode sample rate. The envelope doesn't need fidelity; a low rate saves a lot of decode time. */
const RATE = 8000;

const W = 1680;
const PAD_L = 132;
const PAD_R = 24;
const ENV_H = 150;
const ROW_H = 21;

export interface HearOptions {
  fromMs?: number;
  toMs?: number;
  /** Output path. Defaults to `.anim-look/sound.png` (legacy name; callers now always pass a timed one). */
  outPath?: string;
  width?: number;
}

/** dB → 0..1 height. Below −60dB counts as silence; the ear can't tell differences down there. */
function dbToUnit(db: number): number {
  if (!Number.isFinite(db) || db < -60) return 0;
  return Math.min(1, (db + 60) / 60);
}

/** Decode to mono PCM and compute RMS (dBFS) per STEP_MS bin. */
async function envelope(path: string): Promise<number[]> {
  const { stdout } = await run(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 256 },
  );
  const pcm = stdout as unknown as Buffer;
  const per = Math.max(1, Math.round((RATE * STEP_MS) / 1000));
  const out: number[] = [];
  for (let i = 0; i + per <= pcm.length / 2; i += per) {
    let sum = 0;
    for (let j = 0; j < per; j += 1) {
      const v = pcm.readInt16LE((i + j) * 2) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / per);
    out.push(rms > 0 ? 20 * Math.log10(rms) : -Infinity);
  }
  return out;
}

const esc = (s: string): string => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c));

const KIND_COLOR: Record<string, string> = {
  voice: '#60a5fa',
  music: '#a78bfa',
  sfx: '#fbbf24',
};

/**
 * Draw the chart.
 *
 * One mix envelope plus a colored band per sound. The envelope answers "is it audible", the bands
 * answer "who sounds when", and both share one time axis, so "does this sound stand out in the
 * mix" is read off by comparison, not computed.
 */
function draw(
  env: number[],
  sounds: FilmEval['sounds'],
  nameOf: (src: string) => string,
  fromMs: number,
  toMs: number,
  width = W,
): string {
  const spanMs = Math.max(1, toMs - fromMs);
  const plotW = width - PAD_L - PAD_R;
  const x = (ms: number): number => PAD_L + ((ms - fromMs) / spanMs) * plotW;
  const rows = sounds.length;
  const H = 54 + ENV_H + 26 + rows * ROW_H + 20;
  const envTop = 46;
  const envBase = envTop + ENV_H;

  const p: string[] = [];
  p.push(`<rect width="${width}" height="${H}" fill="#0b0f18"/>`);

  // Time ticks. Interval picked by span so there are 8-16 per view and the labels stay readable.
  const stepMs = [200, 500, 1000, 2000, 5000, 10_000].find((s) => spanMs / s <= 16) ?? 20_000;
  for (let t = Math.ceil(fromMs / stepMs) * stepMs; t <= toMs; t += stepMs) {
    p.push(`<line x1="${x(t).toFixed(1)}" y1="30" x2="${x(t).toFixed(1)}" y2="${H - 12}" stroke="#1e293b" stroke-width="1"/>`);
    p.push(`<text x="${x(t).toFixed(1)}" y="24" fill="#64748b" font-size="12" font-family="monospace" text-anchor="middle">${(t / 1000).toFixed(t % 1000 ? 1 : 0)}s</text>`);
  }

  // Reference lines at −6 / −20 / −40 dB. "Is this loud enough" needs a ruler, not just relative height.
  for (const db of [-6, -20, -40]) {
    const y = envBase - dbToUnit(db) * ENV_H;
    p.push(`<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${width - PAD_R}" y2="${y.toFixed(1)}" stroke="#334155" stroke-width="1" stroke-dasharray="3 4"/>`);
    p.push(`<text x="${PAD_L - 8}" y="${(y + 4).toFixed(1)}" fill="#475569" font-size="11" font-family="monospace" text-anchor="end">${db}dB</text>`);
  }

  // Mix envelope.
  const pts: string[] = [];
  for (let i = 0; i < env.length; i += 1) {
    const ms = i * STEP_MS;
    if (ms < fromMs || ms > toMs) continue;
    pts.push(`${x(ms).toFixed(1)},${(envBase - dbToUnit(env[i]!) * ENV_H).toFixed(1)}`);
  }
  if (pts.length) {
    p.push(`<polygon points="${x(fromMs).toFixed(1)},${envBase} ${pts.join(' ')} ${x(toMs).toFixed(1)},${envBase}" fill="#22d3ee" fill-opacity="0.22"/>`);
    p.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#22d3ee" stroke-width="1.4"/>`);
  }
  p.push(`<line x1="${PAD_L}" y1="${envBase}" x2="${width - PAD_R}" y2="${envBase}" stroke="#334155" stroke-width="1"/>`);
  p.push(`<text x="${PAD_L - 8}" y="${envTop + 12}" fill="#94a3b8" font-size="12" font-family="monospace" text-anchor="end">mix</text>`);

  /* Draw each sound effect's hit point up onto the envelope. **This is the most important mark on
     the chart**: "which second does the hit land on" is the one thing choreography must line up,
     and it can only be verified on the same axis as the actual peak. Line on the peak is right; line
     0.2s left of the peak is that much early. Looking at two separate numbers, nobody can tell. */
  for (const s of sounds) {
    if (s.kind !== 'sfx') continue;
    const hit = s.startMs + (s.attackMs ?? 0);
    if (hit < fromMs || hit > toMs) continue;
    const hx = x(hit).toFixed(1);
    p.push(`<line x1="${hx}" y1="${envTop - 8}" x2="${hx}" y2="${envBase}" stroke="#fbbf24" stroke-width="1" stroke-opacity="0.75"/>`);
    // Seconds: same unit as the chart's ticks and the shot list's `at`, so no mental conversion.
    p.push(`<text x="${hx}" y="${envTop - 12}" fill="#fbbf24" font-size="10" font-family="monospace" text-anchor="middle">${(hit / 1000).toFixed(2)}s</text>`);
  }

  // One row per sound.
  let y = envBase + 30;
  for (const s of sounds) {
    const color = KIND_COLOR[s.kind] ?? '#94a3b8';
    const x0 = Math.max(PAD_L, x(s.startMs));
    const x1 = Math.min(width - PAD_R, x(s.startMs + s.durMs));
    if (x1 > x0) {
      p.push(`<rect x="${x0.toFixed(1)}" y="${y}" width="${(x1 - x0).toFixed(1)}" height="${ROW_H - 7}" rx="2" fill="${color}" fill-opacity="0.5"/>`);
    }
    /* Truncate the name, never the gain: the first 18 chars of `video/plate.mp4 -10.5dB` cut the
       gain to `-1`, a different number. Truncate the name's **head** and keep its tail; file names
       differ at the end. */
    const gain = s.gainDb ? ` ${s.gainDb > 0 ? '+' : ''}${Number(s.gainDb.toFixed(1))}dB` : '';
    const name = nameOf(s.src);
    const room = Math.max(6, 18 - gain.length);
    const label = `${name.length > room ? `…${name.slice(name.length - room + 1)}` : name}${gain}`;
    p.push(`<text x="${PAD_L - 8}" y="${y + ROW_H - 11}" fill="${color}" font-size="11" font-family="monospace" text-anchor="end">${esc(label)}</text>`);
    y += ROW_H;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">${p.join('')}</svg>`;
}

/**
 * Where the silent stretches are.
 *
 * Reporting only a total tells the reader "4.5s of silence" but not where; they'd have to open the
 * image and count bins. And the two usual causes (a tail with no music under it / a dropout in the
 * middle) are fixed in completely different places. Gaps under half a second aren't reported:
 * sentences naturally pause.
 */
function silentRanges(env: number[], fromMs: number, toMs: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let open: number | null = null;
  for (let i = 0; i < env.length; i += 1) {
    const ms = i * STEP_MS;
    if (ms < fromMs || ms > toMs) continue;
    const quiet = !Number.isFinite(env[i]!) || env[i]! < -60;
    if (quiet && open == null) open = ms;
    if (!quiet && open != null) {
      if (ms - open >= 500) out.push({ from: open / 1000, to: ms / 1000 });
      open = null;
    }
  }
  if (open != null && toMs - open >= 500) out.push({ from: open / 1000, to: Math.round(toMs) / 1000 });
  return out;
}

/**
 * Mix once, draw once.
 *
 * The mix goes through the **same** path as export (`mixdownFilm`), so the levels on the image are
 * the levels in the final video. A separate estimate could look good while the export is wrong,
 * which is worse than no image at all.
 */
export async function hearFilm(
  ws: string,
  film: FilmEval,
  nameOf: (src: string) => string,
  opts: HearOptions = {},
): Promise<{
  path: string;
  peakDb: number;
  /** Total fully silent time in this range, seconds. */
  silentSec: number;
  silentRanges: { from: number; to: number }[];
} | null> {
  const outDir = join(ws, '.anim-look');
  mkdirSync(outDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'anim-hear-'));
  try {
    const mixed = await mixdownFilm({
      workspace: ws,
      sounds: film.sounds,
      out: join(tmp, 'mix.m4a'),
      totalMs: film.durationMs,
      resolve: workspaceMediaResolver(ws),
    });
    /* Nothing mixed = every sound is held down (track muted, clip `volume: 0`). Throwing would
       produce a plain-text error, but this command promises JSON; let the caller report "all silent". */
    if (!mixed) return null;

    const env = await envelope(mixed);
    const fromMs = Math.max(0, opts.fromMs ?? 0);
    const toMs = Math.min(film.durationMs, opts.toMs ?? film.durationMs);

    const svg = draw(env, film.sounds, nameOf, fromMs, toMs, opts.width);
    const { Resvg } = await import('@resvg/resvg-js');
    const png = new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
    const path = opts.outPath ?? join(outDir, 'sound.png');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);

    // Also report a few numbers: peak level, seconds of total silence, where the silences are.
    // The image shows the trend; the numbers give the verdict.
    const inRange = env.filter((_, i) => i * STEP_MS >= fromMs && i * STEP_MS <= toMs);
    const peakDb = inRange.length ? Math.max(...inRange.map((d) => (Number.isFinite(d) ? d : -120))) : -120;
    const silentMs = inRange.filter((d) => !Number.isFinite(d) || d < -60).length * STEP_MS;
    return { path, peakDb, silentSec: silentMs / 1000, silentRanges: silentRanges(env, fromMs, toMs) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Sound of a single asset: `look --src <audio>`.
 *
 * When the agent wanted to "listen to this sound effect by itself", all it had was the film-mix
 * route: put it on the timeline, mix, then pick it out of the mix. In two rounds of testing this
 * failed both times (an mp3 went down the frame-sampling path and reported no picture), so it fell
 * back to running ffmpeg in bash to measure levels, a dozen-plus round trips. Draw this one asset's
 * loudness curve directly.
 */
export async function hearSource(
  file: string,
  src: string,
  opts: { outPath: string; fromMs?: number; toMs?: number; width?: number },
): Promise<{ path: string; dur: number; peakDb: number; silentSec: number; silentRanges: { from: number; to: number }[] } | null> {
  let env: number[];
  try {
    env = await envelope(file);
  } catch {
    return null;
  }
  if (!env.length) return null;
  const durMs = env.length * STEP_MS;
  const fromMs = Math.max(0, opts.fromMs ?? 0);
  const toMs = Math.min(durMs, opts.toMs ?? durMs);
  const kind = /\/sfx\//.test(src) ? 'sfx' : /\/music\//.test(src) ? 'music' : /\/(voice|tts|speech)\//.test(src) ? 'voice' : 'audio';
  const sound = { src, kind, startMs: 0, durMs } as unknown as FilmEval['sounds'][number];
  const svg = draw(env, [sound], (x) => x.split('/').pop() ?? x, fromMs, toMs, opts.width);
  const { Resvg } = await import('@resvg/resvg-js');
  const png = new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
  mkdirSync(dirname(opts.outPath), { recursive: true });
  writeFileSync(opts.outPath, png);
  const inRange = env.filter((_, i) => i * STEP_MS >= fromMs && i * STEP_MS <= toMs);
  const peakDb = inRange.length ? Math.max(...inRange.map((d) => (Number.isFinite(d) ? d : -120))) : -120;
  const silentMs = inRange.filter((d) => !Number.isFinite(d) || d < -60).length * STEP_MS;
  return { path: opts.outPath, dur: durMs / 1000, peakDb, silentSec: silentMs / 1000, silentRanges: silentRanges(env, fromMs, toMs) };
}

