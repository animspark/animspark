/**
 * "What this asset on disk looks like right now": a short stamp.
 *
 * The index records measurements: how long an asset is, its peak, what it says. But bytes get
 * replaced (a narration line re-recorded, a source clip re-exported, a same-named file uploaded
 * from the panel), and afterwards those numbers are all silently invalid, with nothing visible in
 * the picture. `stamp` is how we detect that: a mismatch means the index values describe the
 * previous version.
 *
 * **There can be only one definition.** Transcription writes the stamp and reconciliation checks
 * it; if each side had its own formula, one `Math.round` of difference would be enough for
 * reconciliation to mark a fresh word list as stale, so every command would re-transcribe: costly,
 * slow, and it all looks fine.
 */

import { closeSync, fstatSync, openSync, readSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { parsePointer, POINTER_SUFFIX } from '../asset-pointer';
import type { AssetEntry } from '@animspark/film-build';

export function assetSourceMatches(workspace: string, entry: AssetEntry): boolean {
  const stat = assetStat(workspace, entry.src);
  if (stat && entry.stamp === stampOf(stat)) return true;
  if (entry.contentHash) return entry.contentHash === assetContentHash(workspace, entry.src);
  return !!stat && (!entry.stamp || entry.stamp === stampOf(stat));
}

export interface AssetStat {
  size: number;
  mtimeMs: number;
  ctimeMs?: number;
}

/**
 * What an asset looks like on disk. After a direct upload often only a `.animptr` remains, and
 * that pointer is the stamp of its bytes.
 *
 * **When only a pointer remains, `size` reports the asset's byte size, not the ~100-byte
 * pointer's.** The pointer records the real size, so reading it once is enough. Reporting the
 * pointer's own size would break "only one definition" above on the spot: reconciliation (the
 * pointer branch in asset-sync) has always used `pointer.size`, four orders of magnitude apart.
 *
 * The consequence of that gap was observed in practice, and it was invisible: `anim audio asr`
 * transcribed a directly uploaded voiceover and recorded 154 (the pointer file's size) as the
 * asset's bytes; the next command's reconciliation compared it to 4117411, concluded "the source
 * was replaced", and deleted all 115 freshly paid-for words. `text` wasn't in the invalidation
 * list, so it survived. **The symptom: "transcription succeeded, but `anim audio time` says this
 * asset was never transcribed"**. The model can't find the words, cut points are guesswork,
 * captions come out empty, and nothing reports an error anywhere.
 *
 * mtime still comes from the pointer file: the real bytes aren't in this tree, so they have no
 * local mtime, and the moment the pointer landed is exactly "when this asset in this tree became
 * what it is now".
 */
export function assetStat(workspace: string, src: string): AssetStat | null {
  const abs = join(workspace, src);
  try {
    const st = statSync(abs);
    return { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs };
  } catch { /* Real file missing; check the pointer. */ }
  const ptr = `${abs}${POINTER_SUFFIX}`;
  try {
    const st = statSync(ptr);
    const pointer = parsePointer(readFileSync(ptr, 'utf8'));
    return pointer ? { size: pointer.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs } : null;
  } catch {
    return null;
  }
}

export function stampOf(stat: AssetStat): string {
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs ?? ''}`;
}

/** Content identity survives touch, checkout and CAS hydration. Bounded memory for large media. */
export function assetContentHash(workspace: string, src: string): string | undefined {
  const abs = join(workspace, src);
  let fd: number;
  try { fd = openSync(abs, 'r'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try { return parsePointer(readFileSync(`${abs}${POINTER_SUFFIX}`, 'utf8'))?.sha256; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  try {
    /* Skip re-reading an untouched file (same size, mtime, ctime, inode). Previously every edit
       (checked-preview compares a pointer for every hydrated media file) synchronously re-hashed
       hundreds of MB of source clips from scratch, with every user in the process waiting. Any
       write changes ctime, so a real content change is always detected. */
    const st = fstatSync(fd);
    const key = `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`;
    const hit = CONTENT_HASHES.get(abs);
    if (hit && hit.key === key) {
      CONTENT_HASHES.delete(abs);
      CONTENT_HASHES.set(abs, hit);
      return hit.hash;
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const size = readSync(fd, buffer, 0, buffer.length, null);
      if (!size) {
        const digest = hash.digest('hex');
        CONTENT_HASHES.set(abs, { key, hash: digest });
        while (CONTENT_HASHES.size > CONTENT_HASH_MAX) CONTENT_HASHES.delete(CONTENT_HASHES.keys().next().value!);
        return digest;
      }
      hash.update(buffer.subarray(0, size));
    }
  } finally { closeSync(fd); }
}

/** Memo for assetContentHash: absolute path → (file identity, hash). LRU-capped. */
const CONTENT_HASHES = new Map<string, { key: string; hash: string }>();
const CONTENT_HASH_MAX = 4096;

/** One step: this asset's current stamp, or null if it isn't on disk. */
export function assetStampOf(workspace: string, src: string): string | null {
  const stat = assetStat(workspace, src);
  return stat ? stampOf(stat) : null;
}
