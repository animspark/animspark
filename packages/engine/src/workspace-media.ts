/**
 * How a workspace file is read.
 *
 * Every asset the engine can use is a real file in the workspace. A workspace that came
 * from AnimSpark Cloud may also hold pointers (`a.mp4.animptr`, see asset-pointer.ts) whose
 * bytes live in the cloud; the engine does not fetch them. For those it still answers
 * "how long / how big" from the pointer's probed facts, and reports the file as unavailable
 * instead of rendering it black.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { MediaFactsStore, MediaResolver } from '@animspark/film-build';
import { POINTER_SUFFIX, parsePointer, pointerPathFor, writePointerFile, type PointerMediaMeta } from './asset-pointer';

export type MediaServePlan =
  /** The real file is on disk. */
  | { kind: 'disk' }
  /** Only a pointer is here: the bytes live in AnimSpark Cloud, not on this machine. */
  | { kind: 'pointer'; size: number }
  /** Neither a file nor a pointer. */
  | { kind: 'missing' };

/** Message for a pointer-only asset (shown by look/render and the preview). */
export function pointerOnlyMessage(rel: string): string {
  return `${rel} is only a pointer (${rel}${POINTER_SUFFIX}): its bytes are in AnimSpark Cloud, not in this workspace. Put the real file at ${rel}.`;
}

/** `abs` is the real file's absolute path; the caller has already checked it is inside the workspace. */
export function planWorkspaceMedia(abs: string): MediaServePlan {
  try {
    if (statSync(abs).isFile()) return { kind: 'disk' };
  } catch {
    // not on disk — look for a pointer
  }
  const pointer = readPointerBeside(abs);
  return pointer ? { kind: 'pointer', size: pointer.size } : { kind: 'missing' };
}

function readPointerBeside(abs: string) {
  const pointerPath = abs + POINTER_SUFFIX;
  if (!existsSync(pointerPath)) return null;
  try {
    return parsePointer(readFileSync(pointerPath, 'utf8'));
  } catch {
    return null;
  }
}

/** A workspace's asset reader: workspace-relative path → local readable path. */
export interface WorkspaceMedia {
  /** null when the file is not on disk (missing, or pointer-only). */
  localPath(rel: string): Promise<string | null>;
}

export function openWorkspaceMedia(worktree: string): WorkspaceMedia {
  return {
    async localPath(rel) {
      const abs = join(worktree, rel);
      return planWorkspaceMedia(abs).kind === 'disk' ? abs : null;
    },
  };
}

/** A resolver film-build can use for evaluation, mixing and waveforms. */
export function workspaceMediaResolver(worktree: string): MediaResolver {
  const media = openWorkspaceMedia(worktree);
  return (rel) => media.localPath(rel);
}

/**
 * Media facts from a pointer, when the bytes are not on disk.
 *
 * A real file always wins (the caller probes it). `put` writes probed facts back into an
 * existing pointer so they do not have to be probed again.
 */
export function workspaceMediaFacts(worktree: string): MediaFactsStore {
  return {
    async get(rel) {
      if (existsSync(join(worktree, rel))) return null;
      try {
        return parsePointer(readFileSync(join(worktree, pointerPathFor(rel)), 'utf8'))?.meta ?? null;
      } catch {
        return null;
      }
    },
    async put(rel, facts) {
      let pointer;
      try {
        pointer = parsePointer(readFileSync(join(worktree, pointerPathFor(rel)), 'utf8'));
      } catch {
        return;
      }
      if (!pointer) return;
      const meta: PointerMediaMeta = { ...pointer.meta };
      for (const key of ['durMs', 'w', 'h', 'fps'] as const) {
        const value = facts[key];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) meta[key] = value;
      }
      writePointerFile(worktree, rel, { ...pointer, meta });
    },
  };
}
