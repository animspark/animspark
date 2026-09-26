/**
 * Reconciliation: bring `assets/index.json` in line with what is on disk right now.
 *
 * The index has five write paths (generate, search, compose, upload, rename), and each one records
 * its own entry. **What was missing is a reconciler**: files don't only come in through those five
 * paths. A `curl` into `assets/upload/`, a git checkout of an old tree, unzipping an asset pack, the
 * user editing the `duration` of `mg/talk.tsx` in an editor: none of these go through a write path,
 * yet the index still claims to record "what is on disk right now".
 *
 * A fact describing something that doesn't exist is worse than no fact: `anim check` counts it
 * toward the film length and code that `import`s it gets a duration, while the file is gone. The
 * reverse is just as bad: a source clip that was just curl'ed in isn't in the index, so the agent
 * has to ffprobe it itself, or simply treats it as absent.
 *
 * So this pass walks the disk, compares against the index, adds what's new, updates what changed,
 * and drops what's gone. It runs before every `anim` command and every web-side evaluation; both
 * sides share this code.
 *
 * ## Three cost tiers
 *
 *   · Tier 0: existence, byte size, kind, stamp. Pure `stat`, always done. Most files stop here:
 *     if the stamp matches, not a byte changes.
 *   · Tier 1: duration, dimensions. Needs ffprobe, **only for new and changed files**.
 *   · Tier 2: peaks, onsets, word timings. Costs money or a full decode, never done here: whoever
 *     produces them records them. Reconciliation only invalidates stale word lists, provenance and
 *     cache identity when the source is replaced (see staleFacts).
 *
 * ## MG is an asset too
 *
 * MG blocks are code and don't live under `assets/`, but "how long this block occupies on the
 * timeline" and "how long this mp3 is" are the same kind of fact. With two separate ledgers, an
 * agent wanting an MG block's length would have to read its source or run `anim check`, and
 * neither of those is "look it up in the index".
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { isFilmMgModuleSource } from '@animspark/core';
import {
  ASSET_TRANSCRIPTS_DIR,
  assetKindOf,
  isAssetIndexPath,
  probe,
  readAssetIndex,
  refreshAssetIndexViews,
  updateAssetIndex,
  type AssetEntry,
  type AssetIndex,
  type AssetKind,
} from '@animspark/film-build';

import { workspaceAssetsDirName } from '../scene/workspace-assets';
import { isPointerPath, parsePointer, realPathForPointer } from '../asset-pointer';
import { assetContentHash, assetStat, stampOf } from './asset-stamp';
import { mgDurationSpecOf } from './mg-source';

/** Code assets live in these directories, alongside `assets/`. */
const CODE_DIRS = ['mg'] as const;
const MODULE_EXT = /\.tsx$/i;
const MODULE_READ_MAX = 256 * 1024;
const MAX_DEPTH = 8;
/** Reconciliation runs before every command, and ffprobe can read a corrupt file forever, silently hanging the CLI. */
const PROBE_TIMEOUT_MS = 10_000;
const PROBE_CONCURRENCY = 6;

/** The measured fields. All invalidated when the source is replaced: they describe the previous version. */
const CONTENT_FACTS = ['dur', 'w', 'h', 'fps', 'vcodec', 'pixFmt', 'hasAudio', 'hasVideo',
  'peakDb', 'attack', 'words', 'speakerTurns', 'text', 'cast', 'voice_uid', 'sig', 'from', 'transparent',
  'preview', 'frames', 'lastFrame', 'title', 'family', 'fontWeight', 'transcribed'] as const;

/** ms to seconds. The probes (ffprobe, browser, evaluation) report ms; **the index is always in seconds**. */
const sec = (ms: number): number => Number((ms / 1000).toFixed(3));

export interface AssetSyncResult {
  added: string[];
  changed: string[];
  dropped: string[];
}

const NOTHING: AssetSyncResult = { added: [], changed: [], dropped: [] };

interface OnDisk {
  src: string;
  kind: AssetKind;
  bytes: number;
  stamp: string;
  /** Last modification time. Fresh files don't trust the stamp; see the distrust window in `syncAssetIndex`. */
  mtimeMs: number;
  /** Absolute path when real bytes are on disk. Null for a bare pointer: don't pull back GBs of master to reconcile. */
  abs: string | null;
  /** Values probed at upload time (carried in the pointer); no need to probe again. */
  known?: { durMs?: number; w?: number; h?: number; fps?: number };
  /** Code assets: duration read from the source (seconds). */
  dur?: number;
}

/* ── Walk the disk ────────────────────────────────────────────────────────── */

interface Scan {
  files: Map<string, OnDisk>;
  /**
   * Paths seen on disk that by rule don't go into the index.
   *
   * Their old entries must be removed, **even though the file is still on disk**. Font slices are
   * exactly this case: a CJK font family is hundreds of woff2 slices, once one entry each, making a
   * 125KB index that `import assets from '../assets/index.json'` swallowed whole into context. After
   * the rule became "only font.css", someone had to clear out those hundreds of old entries, and the
   * delete side's "still on disk, don't delete" guard would block exactly that. This set tells that
   * guard "I looked at these; they are excluded on purpose".
   */
  excluded: Set<string>;
  /**
   * Roots that this pass actually walked successfully.
   *
   * If a walk fails (permissions, being swapped out by another process), **entries must not be
   * deleted**: "not on disk" is an illusion at that moment, and what would be deleted are facts
   * someone paid to measure. Better to keep one stale entry than wrongly wipe the whole index.
   */
  roots: string[];
}

function scanWorkspace(workspace: string): Scan {
  const scan: Scan = { files: new Map(), excluded: new Set(), roots: [] };
  const assetsDir = workspaceAssetsDirName(workspace);
  const fontsPrefix = `${assetsDir}/fonts/`;
  for (const rel of [assetsDir, ...CODE_DIRS]) {
    if (walk(workspace, rel, scan, fontsPrefix, 0)) scan.roots.push(rel);
  }
  return scan;
}

/** Collect this directory. Returns whether the walk succeeded (missing counts: nothing is under it). */
function walk(workspace: string, rel: string, scan: Scan, fontsPrefix: string, depth: number): boolean {
  if (depth > MAX_DEPTH) return true;
  if (!existsSync(join(workspace, rel))) return true;
  let entries;
  try {
    entries = readdirSync(join(workspace, rel), { withFileTypes: true });
  } catch {
    return false;
  }
  let ok = true;
  for (const entry of entries) {
    // Hidden files are tool leftovers (.DS_Store, .gitkeep), not assets.
    if (entry.name.startsWith('.')) continue;
    const childRel = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!walk(workspace, childRel, scan, fontsPrefix, depth + 1)) ok = false;
      continue;
    }
    // Regular files only: symlinks may point outside the workspace.
    if (!entry.isFile()) continue;
    const one = describe(workspace, childRel, fontsPrefix);
    if (one) scan.files.set(one.src, one);
    else scan.excluded.add(childRel);
  }
  return ok;
}

/** Which index entry this file is. Returns null for files that don't belong in the index. */
function describe(workspace: string, rel: string, fontsPrefix: string): OnDisk | null {
  // The index itself isn't an asset, and neither are its materialized query views (index.jsonl /
  // transcripts/*.vtt); otherwise every index write would be picked up as new assets on the next pass.
  if (isAssetIndexPath(rel) || rel === 'assets/index.jsonl' || rel.endsWith('.words.jsonl')
    || rel.startsWith(`${ASSET_TRANSCRIPTS_DIR}/`)) return null;

  /* WAVs rendered from an MG component's internal audio, and their stamp sidecars: they belong to
     the component, not assets you can place on a track. They re-render whenever the score changes;
     indexing them would only leave entries pointing at old bytes. */

  /* A font family is **one** entry (the `…/font.css` one, recorded when font search lands it),
     not hundreds. The woff2 slices are an implementation detail of the css: packages split by
     unicode-range. No single slice is "an asset", and they can bloat the index past readability. */
  if (rel.startsWith(fontsPrefix) && !/\.css$/i.test(rel)) return null;

  /* A pointer isn't an asset: it records where the bytes of **the file next to it** live. If the
     real file is on disk, it wins; if not, the pointer is that asset's only trace in this tree
     (directly uploaded assets are exactly this case). */
  if (isPointerPath(rel)) {
    const real = realPathForPointer(rel);
    if (!real || existsSync(join(workspace, real))) return null;
    const stat = assetStat(workspace, real);
    if (!stat) return null;
    let pointer;
    try {
      pointer = parsePointer(readFileSync(join(workspace, rel), 'utf8'));
    } catch {
      return null;
    }
    if (!pointer) return null;
    return {
      src: real,
      kind: assetKindOf(real),
      /* The byte size is the asset's, not the ~100-byte pointer's; `assetStat` reads this same
         number (it must match here; see the comment in asset-stamp for why). */
      bytes: stat.size,
      stamp: stampOf(stat),
      mtimeMs: stat.mtimeMs,
      abs: null,
      ...(pointer.meta ? { known: pointer.meta } : {}),
    };
  }

  const stat = assetStat(workspace, rel);
  if (!stat) return null;
  /* Anything under `mg/` is judged as a code asset, not by extension: `.ts` / `.css` files there
     are helpers, not assets, and going by extension would index them as `kind: 'file'`. */
  const dir = CODE_DIRS.find((one) => rel.startsWith(`${one}/`));
  if (dir) return describeModule(workspace, rel, dir, stat, stampOf(stat));
  return {
    src: rel, kind: rel.startsWith(fontsPrefix) ? 'font' : assetKindOf(rel), bytes: stat.size, stamp: stampOf(stat),
    mtimeMs: stat.mtimeMs, abs: join(workspace, rel),
  };
}

/**
 * Which index entry an `mg/*.tsx` file is.
 *
 * Only modules with a default export count: `mg/shared/colors.ts` and modules exporting only a
 * few helpers are code, not assets. Indexing them would blur the "which blocks does this film have"
 * view.
 */
function describeModule(
  workspace: string,
  rel: string,
  kind: (typeof CODE_DIRS)[number],
  stat: { size: number; mtimeMs: number },
  stamp: string,
): OnDisk | null {
  if (!MODULE_EXT.test(rel) || stat.size <= 0 || stat.size > MODULE_READ_MAX) return null;
  let text: string;
  try {
    text = readFileSync(join(workspace, rel), 'utf8');
  } catch {
    return null;
  }
  if (!isFilmMgModuleSource(text)) return null;
  const dur = mgDurationOf(text);
  return {
    src: rel,
    kind,
    bytes: stat.size,
    stamp,
    mtimeMs: stat.mtimeMs,
    abs: join(workspace, rel),
    ...(dur != null ? { dur } : {}),
  };
}

/**
 * The `duration` in the source, in seconds: exactly what the component declares. Null if it can't
 * be read.
 *
 * The asset list reads numeric declarations first; computed expressions get their duration recorded
 * by recordFilmFacts after actual evaluation.
 */
export function mgDurationOf(source: string): number | null {
  const spec = mgDurationSpecOf(source);
  return typeof spec === 'number' ? spec : null;
}

/* ── Measure ──────────────────────────────────────────────────────────────── */

async function measure(one: OnDisk): Promise<Partial<AssetEntry>> {
  if (one.dur != null) return { dur: one.dur };
  // The browser probed this at upload and the pointer carries it; probing again means pulling the bytes back.
  if (one.known) {
    return {
      ...(one.known.durMs != null ? { dur: sec(one.known.durMs) } : {}),
      ...(one.known.w != null ? { w: one.known.w } : {}),
      ...(one.known.h != null ? { h: one.known.h } : {}),
      ...(one.known.fps != null ? { fps: one.known.fps } : {}),
    };
  }
  if (!one.abs) return {};
  if (one.kind !== 'audio' && one.kind !== 'video' && one.kind !== 'image') return {};
  const facts = await probe(one.abs, { timeoutMs: PROBE_TIMEOUT_MS }).catch(() => null);
  if (!facts) return {};
  return {
    /* No duration for images: ffprobe reports 0.04s for a png (one frame at 25fps), and once that
       number is in the index it's a false fact: whoever places the image trims a 40ms shot from it. */
    ...(facts.durMs != null && one.kind !== 'image' ? { dur: sec(facts.durMs) } : {}),
    ...(facts.w != null ? { w: facts.w } : {}),
    ...(facts.h != null ? { h: facts.h } : {}),
    ...(one.kind !== 'image' ? {
      hasAudio: facts.hasAudio, hasVideo: facts.hasVideo,
      ...(facts.fps != null ? { fps: facts.fps } : {}),
      ...(facts.vcodec ? { vcodec: facts.vcodec } : {}),
      ...(facts.pixFmt ? { pixFmt: facts.pixFmt } : {}),
    } : {}),
  };
}

async function measureAll(workspace: string, plan: readonly OnDisk[]): Promise<Map<string, Partial<AssetEntry>>> {
  const out = new Map<string, Partial<AssetEntry>>();
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next; i < plan.length; i = next) {
      next = i + 1;
      const one = plan[i]!;
      out.set(one.src, { ...await measure(one), contentHash: assetContentHash(workspace, one.src) });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, plan.length) }, () => worker()),
  );
  return out;
}

/* ── Merge ────────────────────────────────────────────────────────────────── */

/** Compare content, not duration or mtime. Legacy entries acquire a hash on their next scan. */
function staleFacts(had: AssetEntry, one: OnDisk, measured: Partial<AssetEntry>): boolean {
  if (had.contentHash && measured.contentHash) return had.contentHash !== measured.contentHash;
  if (had.bytes != null && had.bytes !== one.bytes) return true;
  return had.dur != null && measured.dur != null && !sameSec(had.dur, measured.dur);
}

/** Whether two second values are equal. Within 1ms counts: that's measurement jitter, not change. */
function sameSec(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.001;
}

function merge(had: AssetEntry | undefined, one: OnDisk, measured: Partial<AssetEntry>): AssetEntry {
  const next: AssetEntry = {
    ...had,
    src: one.src,
    /* If whoever recorded the entry wrote a `kind`, respect it: an mp4 used only for its audio
       track is a sound in this film, while the extension will always say video. */
    kind: one.kind === 'font' ? 'font' : had?.kind ?? one.kind,
    bytes: one.bytes,
    stamp: one.stamp,
  };
  if (had && staleFacts(had, one, measured)) {
    for (const key of CONTENT_FACTS) delete next[key];
  }
  return { ...next, ...measured };
}

/** Whether reconciliation owns this key: only keys under roots actually walked in this pass. */
function inScope(key: string, roots: readonly string[]): boolean {
  return roots.some((root) => key === root || key.startsWith(`${root}/`));
}

/**
 * Reconcile once. Returns what this pass changed (three empty arrays if nothing).
 *
 * Probing runs outside the lock; the merge happens inside it. ffprobe takes tens of ms per file,
 * and holding a cross-process lock while waiting would queue up a concurrent `anim image gen`.
 * Inside the lock we get the **current** index, not the one read hundreds of ms earlier, so entries
 * another process just recorded aren't wiped by this pass.
 */
/**
 * How long "the stamp didn't change" doesn't count for a freshly written file.
 *
 * The stamp is `bytes:ms-timestamp`. Two versions of **exactly the same size** landing in the same
 * millisecond (re-running a generation, changing one number in the same template) leave the stamp
 * untouched while the index values describe the previous version: the next command Passes with the
 * old duration, and the one after is right again. This "fixes itself one command later" case has
 * actually happened. So anything with an mtime in the last few seconds is re-measured regardless of
 * stamp; if the result is identical, nothing is written.
 */
const DISTRUST_RECENT_MS = 2000;

export async function syncAssetIndex(workspace: string): Promise<AssetSyncResult> {
  const { files, excluded, roots } = scanWorkspace(workspace);
  if (!roots.length) return NOTHING;
  const before = readAssetIndex(workspace);

  const now = Date.now();
  const plan: OnDisk[] = [];
  for (const one of files.values()) {
    const had = before[one.src];
    const suspect = Math.abs(now - one.mtimeMs) < DISTRUST_RECENT_MS;
    if (had?.contentHash && had.stamp === one.stamp && had.bytes === one.bytes && !suspect) continue;
    plan.push(one);
  }
  const dropped = Object.keys(before).filter((key) => inScope(key, roots) && !files.has(key));

  /* Take the lock even when there's nothing to change: that pass is the only chance to convert units
     in an old index (see updateAssetIndex), and it's just one mkdir and one read, no write. */
  const measured = await measureAll(workspace, plan);
  const added: string[] = [];
  const changed: string[] = [];
  const gone: string[] = [];

  updateAssetIndex(workspace, (entries: AssetIndex) => {
    for (const one of plan) {
      // A generator may replace this file while ffprobe is running. Never commit facts for that snapshot.
      const current = assetStat(workspace, one.src);
      if (!current || stampOf(current) !== one.stamp) continue;
      const had = entries[one.src];
      /* Compare the **merged entry** against the current one, not the stamp. Files in the distrust
         window get re-measured even with an unchanged stamp; the result is usually identical, and
         then nothing is written: the index is committed to git, and a needless write is an empty diff. */
      const next = merge(had, one, measured.get(one.src) ?? {});
      if (had && JSON.stringify(had) === JSON.stringify(next)) continue;
      entries[one.src] = next;
      (had ? changed : added).push(one.src);
    }
    for (const key of dropped) {
      if (!(key in entries)) continue;
      /* Look at the disk again inside the lock. This pass takes hundreds of ms, and a concurrent
         `anim image gen` may land a file on this key in the meantime; deleting based on a judgment
         from hundreds of ms ago would delete an asset someone just paid for. The only exception is
         paths the scan saw and ruled out of the index (see `Scan.excluded`): for those, "still on
         disk" is itself the reason to delete. */
      if (!excluded.has(key) && assetStat(workspace, key)) continue;
      delete entries[key];
      gone.push(key);
    }
    return added.length || changed.length || gone.length ? entries : null;
  });

  refreshAssetIndexViews(workspace);
  return { added, changed, dropped: gone };
}

/* ── After evaluation: write real values back ─────────────────────────────── */

/** The part of an evaluation result the index cares about: only "which asset, and how long". */
interface FilmFacts {
  scenes: readonly { src?: string; sourceDurMs?: number }[];
  sounds: readonly { src: string; sourceDurMs?: number }[];
  videos: readonly { src: string; sourceDurMs?: number }[];
}

/** The film says `mg/talk`; on disk it's `mg/talk.tsx` (or `mg/talk/index.tsx`). */
function moduleFileOf(workspace: string, src: string): string | null {
  for (const rel of MODULE_EXT.test(src) ? [src] : [`${src}.tsx`, `${src}/index.tsx`]) {
    if (existsSync(join(workspace, rel))) return rel;
  }
  return null;
}

/**
 * Write durations just computed by an evaluation back to the index.
 *
 * For MG this is the **authoritative value**: the component actually ran, so `Talk.duration` is
 * what it is, unlike reconciliation, which can only guess a literal with a regex. Same for source
 * clips: evaluation ffprobed them, so record it now and skip probing next time.
 *
 * Only writes when a value actually changed. The index is committed to git, and this runs after
 * every `anim check` and every web-side evaluation; writing every time would turn each timeline drag
 * into a diff and needlessly trigger a rebuild on the next pass.
 */
export function recordFilmFacts(workspace: string, film: FilmFacts): boolean {
  /* The evaluation layer works in ms internally (integers don't drift over hundreds of additions),
     while the index is always in seconds; the conversion happens at this boundary. */
  const facts = new Map<string, number>();
  for (const scene of film.scenes) {
    if (!scene.src || scene.sourceDurMs == null) continue;
    const rel = moduleFileOf(workspace, scene.src);
    if (rel) facts.set(rel, sec(scene.sourceDurMs));
  }
  for (const one of [...film.sounds, ...film.videos]) {
    if (one.sourceDurMs != null && Number.isFinite(one.sourceDurMs)) facts.set(one.src, sec(one.sourceDurMs));
  }
  if (!facts.size) return false;

  return updateAssetIndex(workspace, (entries) => {
    let touched = false;
    for (const [src, dur] of facts) {
      const had = entries[src];
      /* Not in the index: the asset is on disk but was never recorded (just curl'ed in, or this
         evaluation ran before reconciliation). Add a minimal entry; the other fields wait for the
         next reconciliation. */
      if (had?.dur != null && sameSec(had.dur, dur)) continue;
      entries[src] = { ...had, src, kind: had?.kind ?? assetKindOf(src), dur };
      touched = true;
    }
    return touched ? entries : null;
  });
}
