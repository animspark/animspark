/**
 * A stamp of the workspace right now: "is this film's source still the same as a moment ago".
 *
 * Two places need it:
 *   · **Skip rebuilding on evaluation.** The `/film` esbuild pass returns the previous result when
 *     the source hasn't changed. `/film/host` no longer bundles the film into the HTML, so there the
 *     stamp is only a thumbnail cache key.
 *   · **The thumbnail cache key.** The browser stores captured images locally keyed by "which
 *     version of the source" (see thumb-cache), so that "which version" must be a property of the
 *     source itself, not "the Nth change in this session": the latter restarts on refresh, and
 *     opening it tomorrow would collide with today's keys and read back another version's picture.
 *
 * How it's computed: code files are hashed by content; everything else (assets: images, audio,
 * video) contributes only "path + size + mtime + ctime". Assets use full-precision modification and
 * change times to avoid collisions from rapid writes; analysis caches that need strong content
 * identity verify a byte hash separately.
 *
 * Pointer files are a third category; see `pointerIdentity`.
 */
import { assetWordBookStamp, publishedMgProjectsStamp } from '@animspark/film-build';
import { FILM_DOC_FILE } from '@animspark/core';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { POINTER_SUFFIX, parsePointer } from '../asset-pointer';

/** Directories left out of the stamp. Installed deps, version history, temp output: none change the picture. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.anim', 'dist', 'out', '.next', 'renders']);

/** Files hashed by content. All text, and all small. */
const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|css|json|txt|md|srt|vtt)$/i;

/**
 * Cap on how many files to walk.
 *
 * A workspace normally has a few dozen files. If one really has tens of thousands (the agent
 * unzipped something), giving up beats turning every request into a full-disk walk; see how walk
 * handles exceeding the cap.
 */
const MAX_FILES = 4000;

interface Walked {
  lines: string[];
  count: number;
  overflow: boolean;
}

async function walk(root: string, dir: string, out: Walked, exclude: readonly string[] = []): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  /* Sort: entry order is up to the filesystem; unsorted, one workspace would stamp differently on two machines. */
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.overflow) return;
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    const abs = join(dir, entry.name);
    const rel = relative(root, abs);
    if (exclude.some(path => rel === path || rel.startsWith(path + '/'))) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(root, abs, out, exclude);
      continue;
    }
    if (!entry.isFile()) continue;
    out.count += 1;
    if (out.count > MAX_FILES) {
      out.overflow = true;
      return;
    }
    if (entry.name.endsWith(POINTER_SUFFIX)) {
      out.lines.push(`${rel}\u0000${await pointerIdentity(abs)}`);
    } else if (CODE_EXT.test(entry.name)) {
      const text = await readFile(abs, 'utf8').catch(() => '');
      out.lines.push(`${rel}\u0000${createHash('sha1').update(text).digest('hex')}`);
    } else {
      const info = await stat(abs).catch(() => null);
      if (info) out.lines.push(`${rel}\u0000${info.size}\u0000${info.mtimeMs}\u0000${info.ctimeMs}`);
    }
  }
}

/**
 * In a pointer, **only the master's two lines count**.
 *
 * Identifying versions by size and mtime is wrong here, and expensively so: pointers get patched in
 * place. Evaluation backfills the probed duration into `meta`, the first waveform draw backfills
 * `peaks`, thumbnails add a `poster`. Not one byte of the master changed; only "how to get the same
 * bytes more cheaply" did. Going by mtime, each backfill would count as a source change, and a
 * source change means **rebuilding the whole film and invalidating every cached thumbnail**. So each
 * of those steps meant to save downloads would first cost a full rebuild.
 *
 * Conversely, when the master really is replaced (the user re-uploaded the asset), `sha256` always
 * changes, and that's exactly what this keys on.
 */
async function pointerIdentity(abs: string): Promise<string> {
  const text = await readFile(abs, 'utf8').catch(() => '');
  const pointer = parsePointer(text);
  /* If it can't be parsed, fall back to a content hash: it isn't a pointer (or it's corrupt), and
     "did it change" can only be answered the old way. */
  if (!pointer) return createHash('sha1').update(text).digest('hex');
  return `${pointer.sha256}\u0000${pointer.size}`;
}

/**
 * Compute once. Returns a short hash; returns null when there are too many files, meaning "don't
 * trust the cache this time", and the caller rebuilds as usual.
 *
 * Better null than an approximate value: the whole point of the stamp is "same means definitely
 * the same source". Once it might lie, both things built on it (skipping rebuilds, reusing
 * thumbnails) would pass off stale results.
 *
 * Files in `skip` are left out; see `code` in sourceStamps.
 */
export async function sourceStamp(
  root: string,
  opts: { skip?: readonly string[]; /** Host-owned files or directory trees omitted from an authorship check. */ exclude?: readonly string[] } = {},
): Promise<string | null> {
  const out: Walked = { lines: [], count: 0, overflow: false };
  out.lines.push(`private-timings\u0000${assetWordBookStamp(root)}`);
  out.lines.push(`mg-builds\u0000${publishedMgProjectsStamp(root)}`);
  await walk(root, root, out, opts.exclude);
  if (out.overflow) return null;
  return hashLines(out.lines, opts.skip ?? []);
}

function hashLines(lines: readonly string[], skip: readonly string[]): string {
  const kept = skip.length
    ? lines.filter((line) => !skip.includes(line.slice(0, line.indexOf('\u0000'))))
    : lines;
  return createHash('sha1').update(kept.join('\n')).digest('hex').slice(0, 16);
}

/**
 * Two stamps in one walk.
 *
 *   · `all`: the whole workspace, including the film document. It answers "is this film the same
 *     as a moment ago": thumbnail keys, evaluation cache keys and telling the frontend whether the
 *     source changed all use it.
 *   · `code`: **excludes `film.json`**. It answers a different question: "did the things to
 *     compile change". Moving a block on the timeline changes only one number in the document, so
 *     `all` changes but `code` doesn't, and the module imported last time can be reused (see
 *     film-build's evaluate), saving one esbuild and one import.
 *
 * Two separate walks would read every file twice, and this path runs on every drag.
 */
export async function sourceStamps(
  root: string,
  skip: readonly string[] = [FILM_DOC_FILE],
): Promise<{ all: string | null; code: string | null }> {
  const out: Walked = { lines: [], count: 0, overflow: false };
  out.lines.push(`private-timings\u0000${assetWordBookStamp(root)}`);
  out.lines.push(`mg-builds\u0000${publishedMgProjectsStamp(root)}`);
  await walk(root, root, out);
  if (out.overflow) return { all: null, code: null };
  return { all: hashLines(out.lines, []), code: hashLines(out.lines, skip) };
}
