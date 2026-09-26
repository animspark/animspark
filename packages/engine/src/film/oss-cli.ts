/**
 * Commands for the pure-code workflow.
 *
 * Three of them: **compile and validate** (`check`), **look** (`look`, picture or `--sound`), and
 * **burn to mp4** (`render`). Editing a film needs no command: you edit code, with an editor.
 */

import type { FilmWord } from '@animspark/core';
import {
  checkFilm, compileFilmBrowser, evaluateFilm, filmBuildSnapshot, formatCheck, FilmCliError, readAssetIndex, readAssetWordBook, type CodeIssue,
} from '@animspark/film-build';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordFilmFacts } from './asset-sync';
import { CLIP_OUT_DIR, exportClip } from './clip-export';
import { durationIssues } from './duration-contract';
import { readTaskConfig, type WorkbenchTaskConfig } from '../workbench/workspace-env';
import { disposeShotPage, writeCodeShotPage } from './code-shoot';
import { collectCodeBundle, collectPreviewCode } from './code-bundle';
import { clockIssues } from './clock-check';
import { fontFamilyIssues, libraryFamilyIssues } from './font-family-check';
import { previewCompileIssues } from './preview-resolve';
import { FilmRenderError, lookStamp, shootFrames } from './shoot';
import type { FilmRenderFormat } from './render';
import { workspaceMediaFacts, workspaceMediaResolver } from '../workspace-media';
import { mgPreviewRequestSchema } from '../llm/mg-preview-contract';
import { rolePathAvailable } from '../llm/role-workspace-tools';
import { mgPreviewTimes } from '../mg/prepared';
import { speechEditReview } from './speech-edit-review';
import { filmReport } from './film-report';

/**
 * Evaluate. The media resolver is mandatory: after a source clip is uploaded directly, only a
 * pointer remains in the working tree, and without the resolver this pass can't ffprobe its
 * duration, which means the film's length is wrong. The owner is read from the workspace's task.json.
 *
 * Computed durations are written to the index along the way. This pass is the **authoritative
 * source** for every asset's duration: MG components actually ran (`Talk.duration` is what it is,
 * not a literal guessed by a regex), and source clips were actually ffprobed. Failing to write the
 * index shouldn't fail `check`: that's bookkeeping, not the question this command answers.
 */
const filmOf = async (ws: string): Promise<Awaited<ReturnType<typeof evaluateFilm>>> => {
  const film = await evaluateFilm(ws, {
    resolve: workspaceMediaResolver(ws),
    known: workspaceMediaFacts(ws),
  });
  try {
    recordFilmFacts(ws, film);
  } catch (error: unknown) {
    process.stderr.write(`[anim] could not write durations back to the asset index: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  return film;
};

interface Argv {
  positional: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

function parse(args: string[]): Argv {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const name = a.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) { values.set(name, next); i += 1; } else flags.add(name);
  }
  return { positional, flags, values };
}

const num = (a: Argv, k: string): number | undefined => {
  const v = a.values.get(k);
  if (v == null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FilmCliError(`--${k} takes a number, got ${v}`);
  return n;
};

/** CLI seconds → internal ms. `3.2` → 3200. */
const msOf = (a: Argv, k: string): number | undefined => {
  const n = num(a, k);
  if (n == null) return undefined;
  return Math.round(n * 1000);
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const s = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

/**
 * Usage for each command.
 *
 * `--help` used to be swallowed as "a flag with no value": typing `anim look --help` to check
 * whether flags combine instead grabbed a contact sheet of the whole film. A documentation lookup
 * that runs for thirty seconds and modifies the workspace is worse than not knowing the flag.
 */
const USAGE: Record<string, string> = {
  check: 'anim check [--timeline]\n'
    + '  Validate film.json and compile the MG browser code without rewriting author files.\n'
    + '  Times are authored as numeric seconds. Returns {"status":"Pass"} plus any warnings;\n'
    + '  failures report errors. --timeline also returns evaluated stage, duration and clip timings. Read tracks from film.json.',
  render: 'anim render [--fps <n>] [--width <px>] [--poster-at <s>] [--out <dir>]\n'
    + '  Burn an mp4 into .anim-out/. Refuses while check is red. Returns JSON: video / poster / audio paths, duration, frames, fps.\n'
    + '  To only hear it, use --fps 4 --width 480: the picture is mush, the audio is identical, and it takes seconds.',
  clip: 'anim clip <clip-id> [--format webm|prores|png|mp4] [--fps <n>] [--width <px>] [--out <dir>]\n'
    + '  Export one block on its own, over a transparent background. Silent. Returns JSON.\n'
    + '  · webm   VP9 + alpha. Web embedding. Chrome and Firefox play it, Safari does not. Default.\n'
    + '  · prores ProRes 4444. What After Effects / Premiere / Final Cut / Resolve all import natively. An order of magnitude bigger.\n'
    + '  · png    A numbered PNG sequence. Everything reads it. Biggest of the three.\n'
    + '  · mp4    No alpha — for when you just want to eyeball the block on its own.\n'
    + '  The receipt carries the measured transparency: alpha=false means the block painted its own background.\n'
    + '  Verifying a webm needs the right decoder: ffmpeg -c:v libvpx-vp9 -i out.webm … (the default vp9 decoder drops alpha silently).',
  look: 'anim look [--from <s>] [--to <s>] [--fps <n>] [--cols <n>]\n'
    + '       anim look --at <s> [--width <px>]\n'
    + '       anim look --sound [--from <s>] [--to <s>]\n'
    + '       anim look --sound --at <s>\n'
    + '  Two modes, do not mix them. Times are seconds. Returns JSON; the filename carries the time. Read the png yourself.\n'
    + '  · without --at = contact sheet. Thumbnails across [from, to) at fps. For checking pacing.\n'
    + '  · with --at    = one frame, native resolution. For checking quality — watermarks, gradient banding\n'
    + '    and small type are all invisible in a thumbnail.\n'
    + '  --sound draws the mix instead of the picture: loudness curve + which sound occupies which stretch + hit markers.\n'
    + '  Same --from / --to / --at, still seconds. --fps / --cols do nothing with --sound.\n'
    + '  With --at, the --from/--to/--fps/--cols flags do nothing.\n',
};

/** Open-source entry: every command runs in the author's own workspace — no preview checkout, no sandbox, no hosted services. */
export async function runCodeCli(ws: string, group: string, rest: string[], signal?: AbortSignal): Promise<string> {
  return runCodeCliInWorkspace(ws, group, rest, signal);
}

/** Trusted worker entry; the caller owns snapshot capture/publication outside the sandbox. */
export async function runCodeCliInWorkspace(ws: string, group: string, rest: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const argv = parse(rest);

  // MCP and the hosted CLI enter here without the standalone CLI's openWorkspace.
  // Reconcile local media before any command evaluates MG sounds or reads their facts.
  if (!argv.flags.has('help') && !argv.flags.has('h')
    && ['film', 'check', 'look', 'hear', 'render', 'clip'].includes(group)) {
    try {
      const { syncAssetIndex } = await import('./asset-sync');
      await syncAssetIndex(ws);
    } catch (error: unknown) {
      process.stderr.write(`[anim] could not sync the asset index: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    signal?.throwIfAborted();
  }

  /* `anim film` was merged into check. Old prompts still call it, so it runs, but usage no longer lists it. */
  if (group === 'film' || group === 'check') {
    if (argv.flags.has('help') || argv.flags.has('h')) return USAGE.check!;
    return cmdCheck(ws, argv.flags.has('timeline'));
  }

  /* Media commands run on a provider (AnimSpark Cloud after `anim login`, or your own key).
     Not set up → the answer points to `anim login`, own files under assets/, and local muspark scores. */
  const { isCloudGroup } = await import('../cloud/commands');
  if (isCloudGroup(group)) {
    const { runCloudCli } = await import('../cloud/cli');
    return runCloudCli(group, rest, { workspace: ws || undefined, signal });
  }

  /* `anim hear` was merged into look --sound. Old prompts still call it, so it runs, but usage no longer lists it. */
  if (group === 'look' || group === 'hear') {
    if (argv.flags.has('help') || argv.flags.has('h')) return USAGE.look!;
    if (group === 'hear') argv.flags.add('sound');
    return cmdLook(ws, argv);
  }
  if (argv.flags.has('help') || argv.flags.has('h')) {
    return USAGE[group] ?? `No such command: ${group}. Have: ${Object.keys(USAGE).join(' · ')}`;
  }
  if (group === 'render') return cmdRender(ws, argv, signal);
  if (group === 'clip') return cmdClip(ws, argv);
  throw new FilmCliError(`No such command: ${group}`);
}

/** A sound's name in reports: its path minus `assets/`. The filename is the name; no second mapping table. */
const shortSrc = (src: string): string => src.replace(/^assets\//, '');

type Words = { words?: readonly FilmWord[] };

/**
 * An asset's word timings: "cut points land on the voice" depends entirely on them.
 *
 * Reads the index. The previous version checked a central index first and fell back to a
 * same-named json; with two paths, one eventually gets forgotten.
 */
function readWordsOf(ws: string) {
  const index = readAssetIndex(ws);
  return (src: string): Words | null => index[src] ?? null;
}

/**
 * How far the delivered film length is from what this task asked for.
 *
 * `anim new --sec 25` writes 25 into task.json, but the check only ever read film.json, so the
 * one-second starter film Passed with zero warnings at 4% of the requested length. Likewise, a film
 * that overran to 39 seconds was only stopped because of a black gap in the middle; the extra 14
 * seconds themselves drew no comment.
 *
 * Tolerance and wording belong to duration-contract: the line the opening brief gives the agent
 * must be the same one judged here, or the agent follows the brief, then only learns the real
 * threshold by failing a check.
 */
function briefDuration(ws: string, film: Awaited<ReturnType<typeof filmOf>>): CodeIssue[] {
  let task: WorkbenchTaskConfig;
  try {
    task = readTaskConfig(ws);
  } catch {
    return [];
  }
  return durationIssues({
    wantedSec: task.durationSec,
    strict: task.durationStrict === true,
    gotSec: film.durationMs / 1000,
  });
}

async function auditFilm(ws: string, film: Awaited<ReturnType<typeof filmOf>>) {
  const bundle = await collectCodeBundle(ws);
  const preview = await collectPreviewCode(ws, bundle.files);
  return [
    ...checkFilm(film, shortSrc, readWordsOf(ws)),
    ...briefDuration(ws, film),
    ...Object.keys(preview.files)
      .filter(path => !rolePathAvailable('mg', path))
      .map(path => ({ level: 'error' as const, what: `${path}: this import is outside the author workspace. Move shared animation code under mg/ and data under assets/.` })),
    ...previewCompileIssues(preview.packages, preview.importedBy),
    ...fontFamilyIssues(preview.files),
    ...libraryFamilyIssues(preview.files),
    ...clockIssues(preview.files),
  ];
}

type ReportScene = { id: string; src: string; start: number; end: number };

/** Which MG blocks are on stage at this second: tells the agent which one it was when rendering throws. */
function scenesAt(film: Awaited<ReturnType<typeof filmOf>>, atMs: number | null): ReportScene[] {
  if (atMs == null) return [];
  const sec = atMs / 1000;
  return ((filmReport(film).scenes ?? []) as ReportScene[]).filter((scene) => sec >= scene.start && sec < scene.end);
}

function renderFailure(film: Awaited<ReturnType<typeof filmOf>>, error: FilmRenderError): FilmCliError {
  const on = scenesAt(film, error.atMs);
  return new FilmCliError(`${error.message}${on.length
    ? `\nOn screen then: ${on.map((scene) => `${scene.src} (clip ${scene.id}, ${scene.start}–${scene.end}s)`).join(', ')}`
    : ''}`);
}

/**
 * Smoke render: actually render one frame at the midpoint of each MG block. Compiling isn't the
 * same as running: reading a nonexistent property, or touching an unattached ref in render, only
 * blows up in the browser, and a version that passes check gets published to the user's preview.
 * Only checks whether it throws, not what it looks like; at most 12 blocks.
 */
async function smokeRender(ws: string, film: Awaited<ReturnType<typeof filmOf>>): Promise<void> {
  const scenes = ((filmReport(film).scenes ?? []) as ReportScene[]).filter((scene) => scene.end > scene.start).slice(0, 12);
  if (!scenes.length) return;
  const times = [...new Set(scenes.map((scene) => Math.round(((scene.start + scene.end) / 2) * 1000)))].sort((a, b) => a - b);
  const page = await writeCodeShotPage(ws, film.stage, film.durationMs, null, 'native', 'contain', filmBuildSnapshot(film));
  const outDir = join(ws, '.anim-look', 'check');
  try {
    await shootFrames({ page, stage: film.stage, workspace: ws, times, uniqueNames: true, outDir, width: 160 });
  } catch (error) {
    if (error instanceof FilmRenderError) throw renderFailure(film, error);
    throw error;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    disposeShotPage(page);
  }
}

async function cmdCheck(ws: string, timeline = false): Promise<string> {
  let editReview: { report: string; clips: number; joins: number } | undefined;
  try {
    const film = await filmOf(ws);
    const review = speechEditReview(film.sounds, readAssetWordBook(ws));
    if (review) {
      const report = 'assets/data/edit-review.json';
      mkdirSync(join(ws, 'assets/data'), { recursive: true });
      writeFileSync(join(ws, report), json(review));
      editReview = { report, clips: review.clips.length, joins: review.joins.length };
    }
    const issues = await auditFilm(ws, film);
    const errors = issues.filter(issue => issue.level === 'error');
    if (errors.length) throw new Error(errors.map(issue => issue.what).join('\n'));
    await compileFilmBrowser(ws, {
      snapshot: filmBuildSnapshot(film),
      resolve: workspaceMediaResolver(ws),
      known: workspaceMediaFacts(ws),
    });
    if (process.env.ANIM_CHECK_RENDER !== '0') await smokeRender(ws, film);
    /* Validation only by default. Evaluated timings are expanded on request, reusing this evaluation
       rather than a separate status tool. */
    const warnings = issues.filter(issue => issue.level === 'warn').map(issue => issue.what);
    return json({
      status: 'Pass',
      ...(editReview ? { editReview } : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(timeline ? { timeline: filmReport(film) } : {}),
    });
  } catch (error: unknown) {
    const what = error instanceof Error ? error.message : String(error);
    throw new FilmCliError(`${JSON.stringify({ status: 'Fail', errors: [what], ...(editReview ? { editReview } : {}) }, null, 2)}\n`);
  }
}

/**
 * Grab frames into a contact sheet, or draw the sound as an image.
 *
 * Defaults to the whole film. To check a specific alignment (a word, a hit), narrow the window and
 * raise the fps: at twenty frames per second you can see whether that light sweep actually passed,
 * while at whole-film scale it occupies a single frame, which is as good as nothing.
 *
 * `--sound` switches the sense, not the command: `--from` / `--to` / `--at` are still seconds, and
 * the receipt is still JSON.
 */
async function cmdLook(ws: string, argv: Argv): Promise<string> {
  if (argv.flags.has('sound')) return cmdLookSound(ws, argv);

  const film = await filmOf(ws);
  let requestedTimes: unknown;
  if (argv.values.has('times')) {
    try { requestedTimes = JSON.parse(argv.values.get('times')!); }
    catch { throw new FilmCliError('--times takes a JSON array of seconds.'); }
  }
  const request = mgPreviewRequestSchema.parse({ at: num(argv, 'at'), times: requestedTimes,
    from: num(argv, 'from'), to: num(argv, 'to'), fps: num(argv, 'fps'), cols: num(argv, 'cols') });
  const from = msOf(argv, 'from') ?? 0;
  const to = msOf(argv, 'to') ?? film.durationMs;
  const at = msOf(argv, 'at');
  /* Reject negatives up front instead of silently clamping to 0: "negative after subtracting the
     block's at" is a sign of a miscalculation, and frame 0 looks perfectly normal, wasting the round. */
  for (const [flag, ms] of [['--at', at], ['--from', msOf(argv, 'from')], ['--to', msOf(argv, 'to')]] as const) {
    if (ms != null && ms < 0) throw new FilmCliError(`${flag} is ${ms / 1000}s. Time on this film starts at 0.`);
  }
  const fps = request.fps ?? Math.min(1, 40 / ((request.to ?? film.durationMs / 1000) - (request.from ?? 0)));
  const toEnd = to;

  const times = mgPreviewTimes({ dur: film.durationMs / 1000, sceneTimes: [] },
    request.at === undefined && request.times === undefined ? { ...request, from: request.from ?? 0, to: request.to ?? film.durationMs / 1000 } : request).map(sec => sec * 1000);
  if (!times.length) throw new FilmCliError(`No frame to grab between ${s(from)} and ${s(to)}.`);

  const outDir = join(ws, '.anim-look');
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16);
  mkdirSync(outDir, { recursive: true });
  const page = await writeCodeShotPage(ws, film.stage, film.durationMs, null, 'native', 'contain', filmBuildSnapshot(film));
  /* Single frames get native resolution, contact sheets get thumbnails. The two land separately with
     the time in the filename, so grabbing the same moment next time doesn't read the old thumbnail. */
  const { frames, errors, choreo } = await shootFrames({
    page,
    stage: film.stage,
    workspace: ws,
    times,
    uniqueNames: request.times !== undefined,
    outDir: join(outDir, request.times ? `times-${requestHash}` : at != null ? 'at' : 'frames'),
    width: num(argv, 'width') ?? (at != null ? film.stage.w : 640),
    ...(at == null ? { label: (ms: number) => lookStamp(ms) } : {}),
  }).catch((error: unknown) => { throw error instanceof FilmRenderError ? renderFailure(film, error) : error; })
    .finally(() => disposeShotPage(page));
  /* Frozen-frame check: each MG block's choreography end (recorded at timeline build, collected at
     capture) against its block length. check can't tell whether the picture moves, and look is the
     required path for inspecting the picture, so the problem is reported here, where the agent sees
     it alongside the contact sheet. */
  const { frozenTailWarnings } = await import('./choreo-report');
  const warnings = frozenTailWarnings(film.scenes, choreo);

  const rel = (p: string) => relative(ws, p).split('\\').join('/');
  if (at != null) {
    /* A frame grabbed past the end isn't black: the film-wide base layers are still there, so it
       looks like a real frame of "this scene is empty". Someone who mistyped a time concludes "my
       scene is broken" and goes off to fix something that isn't broken. */
    const past = at > film.visualEndMs + 1
      ? `${Math.round(at) / 1000}s is past the end of this film (${Math.round(film.visualEndMs) / 1000}s) — nothing is scheduled there`
      : null;
    return json({
      mode: 'frame',
      at: request.at,
      path: rel(frames[0]!.path),
      ...(past ? { warning: past } : {}),
      ...(warnings.length ? { warnings } : {}),
      ...(errors.length ? { errors } : {}),
    });
  }

  const { contactSheet } = await import('@animspark/film-build');
  const sheet = join(outDir, request.times ? `times-${requestHash}.png` : `${lookStamp(from)}-${lookStamp(toEnd)}@${fps}fps.png`);
  await contactSheet({
    frames,
    outPath: sheet,
    ...(num(argv, 'cols') != null ? { cols: num(argv, 'cols')! } : {}),
  });
  return json({
    mode: 'sheet',
    times: times.map(ms => ms / 1000),
    ...(request.times ? {} : { from: request.from ?? 0, to: request.to ?? film.durationMs / 1000, fps }),
    path: rel(sheet),
    frames: frames.length,
    ...(warnings.length ? { warnings } : {}),
    ...(errors.length ? { errors } : {}),
  });
}

/**
 * Draw the sound: the other half of look.
 *
 * The picture can at least be inspected frame by frame; sound had no feedback at all in this
 * toolset. Output is still a png with the time in the filename, and the receipt is JSON, read the
 * same way as a contact sheet.
 *
 * `--at` is a close-up around that second (one second either side), like a single frame: don't mix
 * it with `--from` / `--to`.
 */
async function cmdLookSound(ws: string, argv: Argv): Promise<string> {
  const film = await filmOf(ws);
  /* No sound is an **answer**, not an error: asking "what does this film sound like" and getting a
     sentence that isn't JSON would throw at the step that parses the receipt per the manual. */
  if (!film.sounds.length) {
    return json({ mode: 'sound', path: null, sounds: 0, note: 'This film has no sound at all.' });
  }

  const at = msOf(argv, 'at');
  const from = at != null ? Math.max(0, at - 1000) : (msOf(argv, 'from') ?? 0);
  const to = at != null
    ? Math.min(film.durationMs, Math.max(from + 400, at + 1000))
    : Math.min(msOf(argv, 'to') ?? film.durationMs, film.durationMs);
  if (to <= from) throw new FilmCliError(`No sound to draw between ${s(from)} and ${s(to)}.`);

  const outDir = join(ws, '.anim-look');
  const dest = at != null
    ? join(outDir, 'sound', 'at', `${lookStamp(at)}.png`)
    : join(outDir, `sound-${lookStamp(from)}-${lookStamp(to)}.png`);

  const { hearFilm } = await import('./hear');
  const out = await hearFilm(ws, film, shortSrc, {
    fromMs: from,
    toMs: to,
    outPath: dest,
    ...(num(argv, 'width') != null ? { width: num(argv, 'width')! } : {}),
  });
  if (!out) {
    return json({
      mode: 'sound',
      path: null,
      sounds: film.sounds.length,
      note: film.sounds.length === 1
        ? 'The one sound in this film is held down — a muted track, or volume: 0 on that clip.'
        : `All ${film.sounds.length} sounds are held down — muted tracks, or volume: 0 on every clip.`,
    });
  }
  const rel = (p: string) => relative(ws, p).split('\\').join('/');
  /* Count sounds **in this window**, not in the whole film. Framing 14–16.5s and replying "sounds: 7"
     when the window holds three: readers count the bars in the image, so that number is actively
     misleading. This was called out in practice. */
  const inWindow = film.sounds.filter((x) => x.startMs < to && from < x.startMs + x.durMs).length;
  return json({
    mode: at != null ? 'sound-at' : 'sound',
    ...(at != null ? { at: Math.round(at) / 1000 } : {}),
    from: Math.round(from) / 1000,
    to: Math.round(to) / 1000,
    path: rel(out.path),
    peakDb: Number(out.peakDb.toFixed(1)),
    silent: out.silentSec,
    ...(out.silentRanges.length ? { silentRanges: out.silentRanges } : {}),
    sounds: inWindow,
  });
}

/**
 * Burn to mp4.
 *
 * Mix the sound first: it's cheap (hundreds of ms), while the picture needs every frame captured and
 * takes minutes. The other way round, a wrong mix parameter isn't reported until thousands of frames
 * have been captured.
 */
async function cmdRender(ws: string, argv: Argv, signal?: AbortSignal): Promise<string> {
  const film = await filmOf(ws);
  const issues = await auditFilm(ws, film);
  const blocking = issues.filter((x) => x.level === 'error');
  if (blocking.length) {
    throw new FilmCliError(formatCheck(film, issues));
  }

  const { renderFilm } = await import('./render');
  const page = await writeCodeShotPage(ws, film.stage, film.durationMs, null, 'native', 'contain', filmBuildSnapshot(film));
  signal?.throwIfAborted();
  const out = await renderFilm({
    signal,
    workspace: ws,
    sounds: film.sounds,
    page,
    stage: film.stage,
    durationMs: film.durationMs,
    outDir: argv.values.get('out') ? join(ws, argv.values.get('out')!) : join(ws, '.anim-out'),
    /* Unspecified means follow the source: an edited film's frame rate must equal the footage's, or
       the resampled output stutters compared to the original. Pure animation (no video assets) has no
       sourceFps; only then does the default apply. */
    ...(num(argv, 'fps') != null
      ? { fps: num(argv, 'fps')! }
      : film.sourceFps != null ? { fps: film.sourceFps } : {}),
    ...(num(argv, 'width') != null ? { width: num(argv, 'width')! } : {}),
    // The flag takes seconds (every CLI time is in seconds); the render side works in ms internally.
    ...(num(argv, 'poster-at') != null ? { posterAtMs: Math.round(num(argv, 'poster-at')! * 1000) } : {}),
  });
  /* The receipt matches check / look: JSON, times always in seconds. If this were the one command
     still replying in prose, anyone parsing "receipts are JSON" would trip at the final step of
     producing the film, the one step with no way around it. */
  return `${JSON.stringify({
    video: out.video,
    poster: out.poster,
    audio: out.audio,
    duration: Number((out.durationMs / 1000).toFixed(3)),
    frames: out.frames,
    fps: out.fps,
    took: Number((out.tookMs / 1000).toFixed(1)),
    ...(out.errors?.length ? { pageErrors: out.errors.slice(0, 6) } : {}),
  }, null, 2)}\n`;
}

/**
 * Single-block export: export one MG block on its own as an asset with a transparent background.
 *
 * The real implementation is in `clip-export.ts`; the UI button uses the same one. This only
 * translates command-line arguments and formats the receipt as JSON.
 */
async function cmdClip(ws: string, argv: Argv): Promise<string> {
  const id = argv.positional[0];
  if (!id) throw new FilmCliError('anim clip needs a clip id — see the clipId column in anim check');

  const out = await exportClip({
    workspace: ws,
    clipId: id,
    format: (argv.values.get('format') ?? 'webm') as FilmRenderFormat,
    ...(argv.values.get('out') != null ? { outDir: argv.values.get('out')! } : {}),
    ...(num(argv, 'fps') != null ? { fps: num(argv, 'fps')! } : {}),
    ...(num(argv, 'width') != null ? { width: num(argv, 'width')! } : {}),
  });

  return json({
    clip: out.clip,
    ...(out.src ? { src: out.src } : {}),
    video: join(ws, argv.values.get('out') ?? CLIP_OUT_DIR, out.file),
    format: out.format,
    at: out.atSec,
    duration: out.durationSec,
    frames: out.frames,
    fps: out.fps,
    /* Report transparency as measured. "Not transparent at all" doesn't mean the export broke; the
       block painted its own full-frame background. The two look identical in the file, and without
       saying so, the user can only assume our export is broken. */
    ...(out.alpha ? { alpha: out.alpha.any, painted: out.alpha.coverage } : {}),
    ...(out.note ? { note: out.note } : {}),
    took: out.tookSec,
    ...(out.errors?.length ? { pageErrors: out.errors } : {}),
  });
}
