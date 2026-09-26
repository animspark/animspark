/**
 * Landing a provider's result in the workspace: the files, then the asset index.
 *
 * Every provider (AnimSpark Cloud or your own adapter) goes through here, so the rules are
 * the same whoever produced the bytes:
 *
 *   · a path is workspace-relative, forward slashes, under `assets/`; absolute paths, `..`,
 *     backslashes, NUL and empty segments are rejected;
 *   · no directory on the way and not the file itself may be a symlink — a link could point
 *     outside the workspace, and writing through it would escape it;
 *   · files are written to a temp name and renamed into place, so a crash never leaves half
 *     a file under the real name.
 *
 * Then the index: rows from the provider are merged into the ledger (they carry facts only
 * the producer knows — word timings, voice rows, where it came from), and the regular
 * reconciliation (`syncAssetIndex`) stamps and probes whatever else is new.
 */
import { mergeAssetIndexRows } from '@animspark/film-build';
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';

import type { MediaResult } from './provider';

export class UnsafePathError extends Error {
  constructor(path: string, why: string) {
    super(`Refusing path ${JSON.stringify(path)}: ${why}.`);
    this.name = 'UnsafePathError';
  }
}

/** The lexical rules. Returns the normalized relative path. */
export function checkRelativePath(path: string, { under = 'assets/' }: { under?: string } = {}): string {
  if (typeof path !== 'string' || !path) throw new UnsafePathError(String(path), 'empty path');
  if (path.includes('\0')) throw new UnsafePathError(path, 'contains NUL');
  if (path.includes('\\')) throw new UnsafePathError(path, 'backslashes are not allowed');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) throw new UnsafePathError(path, 'absolute paths are not allowed');
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new UnsafePathError(path, 'empty, "." and ".." segments are not allowed');
  if (under && !path.startsWith(under)) throw new UnsafePathError(path, `files must land under ${under}`);
  if (parts.some((p) => p.startsWith('.'))) throw new UnsafePathError(path, 'hidden files are not allowed');
  return path;
}

/**
 * The filesystem rules: resolve inside the (real) workspace and refuse any symlink on the
 * way. Creates missing directories one at a time so a link cannot be slipped in between.
 * Returns the absolute destination.
 */
export function safeDestination(workspace: string, rel: string, { create = true }: { create?: boolean } = {}): string {
  checkRelativePath(rel, { under: '' });
  const root = realpathSync(workspace);
  const dest = resolve(root, ...rel.split('/'));
  if (!dest.startsWith(root + sep)) throw new UnsafePathError(rel, 'it resolves outside the workspace');
  const parts = rel.split('/');
  let at = root;
  for (let i = 0; i < parts.length; i += 1) {
    at = join(at, parts[i]!);
    const last = i === parts.length - 1;
    let stat;
    try { stat = lstatSync(at); } catch {
      if (!last && create) { mkdirSync(at); continue; }
      if (!last) throw new UnsafePathError(rel, `${parts.slice(0, i + 1).join('/')} does not exist`);
      break;
    }
    if (stat.isSymbolicLink()) throw new UnsafePathError(rel, `${parts.slice(0, i + 1).join('/')} is a symbolic link`);
    if (!last && !stat.isDirectory()) throw new UnsafePathError(rel, `${parts.slice(0, i + 1).join('/')} is not a directory`);
    if (last && !stat.isFile()) throw new UnsafePathError(rel, 'something that is not a regular file is already there');
  }
  return dest;
}

/** Read a workspace file the request must upload (e.g. the audio to transcribe). */
export function readWorkspaceInput(workspace: string, rel: string, maxBytes: number): Buffer {
  checkRelativePath(rel);
  const abs = safeDestination(workspace, rel, { create: false });
  let bytes: Buffer;
  try { bytes = readFileSync(abs); } catch { throw new Error(`${rel} is not in this workspace.`); }
  if (bytes.length > maxBytes) {
    throw new Error(`${rel} is ${(bytes.length / 1e6).toFixed(1)} MB; the limit is ${Math.round(maxBytes / 1e6)} MB. Extract the audio first (ffmpeg -i in.mp4 -vn -c:a aac out.m4a).`);
  }
  return bytes;
}

export interface Landed {
  written: Array<{ path: string; bytes: number }>;
  indexed: string[];
  indexError?: string;
}

/** Write the files (all paths are checked before the first byte is written), then update the index. */
export async function landResult(workspace: string, result: Pick<MediaResult, 'files' | 'index'>): Promise<Landed> {
  const plan = result.files.map((f) => ({ ...f, path: checkRelativePath(f.path) }));
  const seen = new Set<string>();
  for (const f of plan) {
    if (seen.has(f.path)) throw new UnsafePathError(f.path, 'the same path appears twice');
    seen.add(f.path);
  }
  const targets = plan.map((f) => ({ ...f, abs: safeDestination(workspace, f.path) }));
  const written: Landed['written'] = [];
  for (const f of targets) {
    mkdirSync(dirname(f.abs), { recursive: true });
    const tmp = join(dirname(f.abs), `.${randomUUID()}.anim-tmp`);
    try {
      writeFileSync(tmp, f.bytes, { flag: 'wx' });
      renameSync(tmp, f.abs);
    } finally {
      rmSync(tmp, { force: true });
    }
    written.push({ path: f.path, bytes: f.bytes.length });
  }

  const landed: Landed = { written, indexed: [] };
  const sizes = new Map(written.map((w) => [w.path, w.bytes]));
  /* A row describes one asset. It may only name a file we just wrote, a file already in the
     workspace, or a voice card; and its byte count is what actually landed. */
  const describes = (src: string): boolean => {
    if (src.startsWith('voice:') || sizes.has(src)) return true;
    try { checkRelativePath(src, { under: '' }); return existsSync(join(workspace, src)); } catch { return false; }
  };
  const rows = (result.index ?? []).filter((row) => typeof row?.src === 'string' && row.src && describes(row.src))
    .map((row) => (sizes.has(row.src as string) && row.bytes === undefined ? { ...row, bytes: sizes.get(row.src as string) } : row));
  try {
    if (rows.length) landed.indexed = mergeAssetIndexRows(workspace, rows);
  } catch (error) {
    /* The files are on disk and paid for; a row the ledger will not take must not turn the call into a failure. */
    landed.indexError = error instanceof Error ? error.message : String(error);
  }
  try {
    const { syncAssetIndex } = await import('../film/asset-sync');
    await syncAssetIndex(workspace);
  } catch (error) {
    landed.indexError ??= error instanceof Error ? error.message : String(error);
  }
  return landed;
}
