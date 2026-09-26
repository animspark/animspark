/**
 * Asset pointers: `a.mp4.animptr` next to (or instead of) `assets/.../a.mp4`.
 *
 * A workspace that came from AnimSpark Cloud may hold large media as pointers: a few lines
 * of text naming the content hash, size and probed facts of the real file. The open-source
 * engine never fetches those bytes; it reads the facts (so `check` can still time the film)
 * and reports a pointer-only file clearly instead of rendering a black frame. Every file on
 * disk is used as-is.
 *
 * Format (git-diffable, in the spirit of Git LFS): a magic line, then `key value` lines.
 *
 *   animspark-pointer v2
 *   sha256 <64 hex>
 *   size <bytes>
 *   [audio|poster|peaks|preview <sha256> <bytes>]
 *   [meta {"durMs":…,"w":…,"h":…,"fps":…,"codec":…}]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { MediaMeta } from '@animspark/core';

/** Suffix after the real file name: `a.mp4` → `a.mp4.animptr`. */
export const POINTER_SUFFIX = '.animptr';

const POINTER_MAGIC = 'animspark-pointer v2';
/** Versions this reader understands. Only POINTER_MAGIC is written. */
const READABLE_POINTER_MAGIC = new Set([POINTER_MAGIC, 'animspark-pointer v1']);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Media facts probed when the asset was uploaded. */
export type PointerMediaMeta = MediaMeta;

/** A small derived file (audio track, poster, peaks, browser preview). */
export interface DerivedRef {
  sha256: string;
  size: number;
}

export interface AssetPointer {
  /** Content hash of the master file. */
  sha256: string;
  /** Master size in bytes. */
  size: number;
  audio?: DerivedRef;
  poster?: DerivedRef;
  peaks?: DerivedRef;
  preview?: DerivedRef;
  meta?: PointerMediaMeta;
}

export function isPointerPath(rel: string): boolean {
  return rel.endsWith(POINTER_SUFFIX);
}

/** Real file path → pointer path. */
export function pointerPathFor(rel: string): string {
  return `${rel}${POINTER_SUFFIX}`;
}

/** Pointer path → real file path; null when `rel` is not a pointer. */
export function realPathForPointer(rel: string): string | null {
  return isPointerPath(rel) ? rel.slice(0, -POINTER_SUFFIX.length) : null;
}

/** Whether the asset exists at all: on disk, or as a pointer. */
export function assetExists(abs: string): boolean {
  return existsSync(abs) || existsSync(pointerPathFor(abs));
}

export function formatPointer(pointer: AssetPointer): string {
  const lines = [POINTER_MAGIC, `sha256 ${pointer.sha256}`, `size ${pointer.size}`];
  if (pointer.audio) lines.push(`audio ${pointer.audio.sha256} ${pointer.audio.size}`);
  if (pointer.poster) lines.push(`poster ${pointer.poster.sha256} ${pointer.poster.size}`);
  if (pointer.peaks) lines.push(`peaks ${pointer.peaks.sha256} ${pointer.peaks.size}`);
  if (pointer.preview) lines.push(`preview ${pointer.preview.sha256} ${pointer.preview.size}`);
  const meta = pointer.meta && Object.keys(pointer.meta).length ? pointer.meta : null;
  if (meta) lines.push(`meta ${JSON.stringify(meta)}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Parse pointer text; null when it is not a pointer.
 *
 * The master lines (sha256/size) are required. A malformed derived line drops only that
 * entry, and unknown keys (older pointers carry `proxy` / `stem` lines) are ignored.
 */
export function parsePointer(text: string): AssetPointer | null {
  const lines = String(text ?? '').split('\n');
  if (!READABLE_POINTER_MAGIC.has(lines[0]?.trim() ?? '')) return null;

  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    const space = trimmed.indexOf(' ');
    if (space < 0) continue;
    fields.set(trimmed.slice(0, space), trimmed.slice(space + 1).trim());
  }

  const sha256 = fields.get('sha256') ?? '';
  const size = Number(fields.get('size') ?? -1);
  if (!SHA256_PATTERN.test(sha256)) return null;
  if (!Number.isSafeInteger(size) || size < 0) return null;

  const pointer: AssetPointer = { sha256, size };
  for (const key of ['audio', 'poster', 'peaks', 'preview'] as const) {
    const ref = parseDerivedRef(fields.get(key) ?? '');
    if (ref) pointer[key] = ref;
  }
  const meta = parseMediaMeta(fields.get('meta') ?? '');
  if (meta) pointer.meta = meta;
  return pointer;
}

/** `<sha256> <bytes>`; anything else drops the entry. */
function parseDerivedRef(raw: string): DerivedRef | null {
  const space = raw.indexOf(' ');
  if (space < 0) return null;
  const sha256 = raw.slice(0, space);
  if (!SHA256_PATTERN.test(sha256)) return null;
  const size = Number(raw.slice(space + 1).trim());
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  return { sha256, size };
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The `meta` line, filtered field by field (it feeds layout and timing). */
function parseMediaMeta(raw: string): PointerMediaMeta | null {
  if (!raw) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const source = decoded as Record<string, unknown>;
  const meta: PointerMediaMeta = {};
  for (const key of ['durMs', 'w', 'h', 'fps'] as const) {
    const value = positiveNumber(source[key]);
    if (value !== null) meta[key] = value;
  }
  const codec = typeof source.codec === 'string' ? source.codec.trim() : '';
  if (codec) meta.codec = codec;
  return Object.keys(meta).length ? meta : null;
}

/** Write a pointer into the workspace; returns its workspace-relative path. */
export function writePointerFile(worktreePath: string, realRel: string, pointer: AssetPointer): string {
  const pointerRel = pointerPathFor(realRel);
  const abs = join(worktreePath, ...pointerRel.split(sep).join('/').split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, formatPointer(pointer), 'utf8');
  return pointerRel;
}
