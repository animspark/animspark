/**
 * `assets/index.jsonl` — the workspace's asset ledger; there is exactly one per film. One row per
 * asset (registered voices also get one row each).
 *
 * The values are **measured facts**: how long, how large, what is said, the peak level, which
 * second the loudest hit lands on, where it came from. Agents query it with rg / jq; the film's
 * code gets these facts from the runtime (the host hands them to `filmFromDoc` in the bundle
 * entry) and never imports this file.
 *
 * Why these can't be written into code: they aren't decisions, they are measurements. In code they
 * become magic numbers nobody can verify — swap a clip or re-record a narration line and every one
 * of them silently goes stale, with nothing visible on screen.
 *
 * Rows hold only public fields. Everything else lives in private storage outside the code tree
 * (versioned in git notes): word timings, full transcripts and translations (an hour-long
 * interview runs to tens of thousands of words; stuffed into one row, an rg hit on one word fills
 * the screen), and anything that shouldn't sync or publish with the code tree (request signatures,
 * content hashes, internal provenance fields). The full transcript, split at pauses, is
 * materialized in `assets/transcripts/` (see asset-transcript).
 *
 * This used to be two books: `assets/index.json` read and written by machines, and this jsonl view
 * for agents — the same thing recorded twice. An old project's `index.json` is migrated on first
 * read/write, then deleted.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';

import { ASSET_INDEX_JSONL_PATH, ASSET_INDEX_PATH, ASSET_WORDS_PATH, isAssetIndexPath } from '@animspark/core';
import type { FilmDoc, FilmWord } from '@animspark/core';
import { ASSET_TRANSCRIPTS_DIR, assetTranscriptInfo, assetTranscriptPath, transcriptVtt } from './asset-transcript';

/*
 * The paths and the "is this bookkeeping" check live in core (see `film-assets`) — the frontend
 * needs to guard these files too, and this module pulls in `node:fs`, which can't go into a browser
 * bundle. They are re-exported here unchanged, so readers of the ledger needn't know about the
 * split.
 *
 * cue() gets alignment data at runtime; the bundle entry merges asset facts and the full word book
 * back into one (see doc-entry).
 */
export { ASSET_INDEX_JSONL_PATH, ASSET_INDEX_PATH, ASSET_WORDS_PATH, ASSET_LEDGER_PATHS, isAssetIndexPath } from '@animspark/core';

export const ASSET_CAST_KEY = 'cast';
const LEGACY_ASSET_WORDS_PATHS = [
  'word.index.json', 'words.index.json', 'assets/word.index.json', 'assets/words.index.json', ASSET_WORDS_PATH,
] as const;

/**
 * What this entry is. Readers shouldn't have to guess from the extension — extensions come from
 * vendors, and the same kind of thing can be spelled five ways.
 *
 * `mg` is code and doesn't live under `assets/`, but it is just as much an asset of the film: how
 * long an MG block runs on the timeline is set by the component's `duration`, the same kind of fact
 * as an mp3's length. With separate books for "assets" and "code", "how long is this block" would
 * have to be asked in two places, in two different ways.
 */
export type AssetKind = 'audio' | 'video' | 'image' | 'font' | 'mg' | 'file';

const KIND_BY_EXT: Record<string, AssetKind> = {
  m4a: 'audio', mp3: 'audio', wav: 'audio', aac: 'audio', flac: 'audio', ogg: 'audio', opus: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', avif: 'image',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font',
};

/** MG code is recognised by directory; other code files are `file`. */
const KIND_BY_DIR: Record<string, AssetKind> = { mg: 'mg' };

/**
 * The kind according to the extension.
 *
 * Five or six places write to the ledger (synthesis, generation, transcription, image search,
 * font install); relying on each to remember `kind`, one always forgets — then half the entries
 * have it and half don't, readers fall back to guessing from the extension, and `kind` is
 * pointless. So it is filled in **at the entrance**: if the writer omits it, judge by the path; if
 * they give one, it wins (what some bytes are used as isn't always what the extension says — an
 * mp4 used only for its audio is, for this film, a sound).
 */
export function assetKindOf(src: string): AssetKind {
  const dir = KIND_BY_DIR[src.split('/')[0] ?? ''];
  if (dir && src.toLowerCase().endsWith('.tsx')) return dir;
  return KIND_BY_EXT[src.split('.').pop()?.toLowerCase() ?? ''] ?? 'file';
}

/** Provenance. How this asset came about — the text and voice for synthesis, the prompt for generation, the source page for search. */
export interface AssetOrigin {
  /** How it was obtained. */
  mode?: 'synth' | 'generate' | 'search' | 'upload' | 'transcribe' | 'fetch' | 'extract';
  /** The text used for synthesis (the version with performance tags; not necessarily the same as `text`). */
  text?: string;
  /** The prompt used for generation. */
  prompt?: string;
  /** The voice used for synthesis. */
  voice?: string;
  /** Requested duration (seconds); the actual length is the asset's dur. */
  sec?: number;
  /** One line for humans: what this is and why it is needed. */
  description?: string;
  /** For search results: which provider and which page. */
  provider?: string;
  sourceUrl?: string;
  title?: string;
  /** For generated assets: which model and size tier. */
  model?: string;
  [extra: string]: unknown;
}

/** One asset. The shape varies with `kind`; only `src` and `kind` are shared. */
export interface AssetTranslationLine {
  startSec: number;
  endSec: number;
  text: string;
}

export interface AssetEntry {
  src: string;
  kind?: AssetKind;
  /** Size in bytes. */
  bytes?: number;
  /** When it was written to the ledger. */
  savedAt?: number;

  /* ── With a duration (audio / video / mg) ── */
  /**
   * The asset's own length, in **seconds**. For MG it is the component's `duration`; for footage,
   * the file's length.
   *
   * The ledger always uses seconds — every other number an agent handles is in seconds
   * (`film.json`'s `at` / `time`, a component's `duration`, gsap tweens, every receipt). Putting
   * milliseconds in this table would make people do a division, and forgetting it once means being
   * off by a factor of a thousand, invisibly on screen.
   */
  dur?: number;

  /* ── With dimensions (image / video) ── */
  w?: number;
  h?: number;

  /* ── With speech (narration, transcribed footage) ── */
  text?: string;
  /** Who is speaking — the registered name in the `cast` book (called `role` in materialized rows). */
  cast?: string;
  /**
   * Word timings. Reads and writes are automatically wired to the platform's private storage —
   * users can treat it as if it were on this entry.
   *
   * Sentence breaks aren't stored: sentences are derived from this table on the fly (`speechRuns`
   * splits at silences for editing, `spokenLines` at punctuation for captions). Storing them would
   * be a copy of this table, and after a re-transcription the copy would still point at the old
   * timings.
   */
  words?: readonly FilmWord[];
  /** Diarized source intervals; IDs are scoped to each transcription chunk. */
  speakerTurns?: readonly { speaker: string; start: number; end: number }[];
  /**
   * Caption lines translated by the host (`audio translate`): language code → lines. Each line's
   * timing is that of the corresponding original caption line (source seconds), so captions in
   * another language still follow the cuts.
   */
  translations?: Readonly<Record<string, readonly AssetTranslationLine[]>>;

  /* ── Audible ── */
  peakDb?: number;
  /** The second in the file where "the hit" lands. Used to align the hit to `at` when placing a sound effect. */
  attack?: number;

  /* ── Fonts ── */
  family?: string;

  /** Where it came from. */
  from?: AssetOrigin;
  /**
   * Proof that money was spent. When the same target comes round again, it tells us "this entry is
   * already the one we want" — without it, every rerun of a batch would pay again.
   */
  sig?: string;
  /** The source file's state at the time. Transcription uses it to tell whether the source was replaced. */
  stamp?: string;
  /** SHA-256 of the source bytes, independent of path and filesystem timestamps. */
  contentHash?: string;
  [extra: string]: unknown;
}

export interface CastMember {
  /** The vendor's voice id — called `voiceId` in receipts and materialized rows. */
  voice?: string;
  /** The voice card's display name — for the UI; not part of the CLI vocabulary. */
  name?: string;
  language?: string;
  gender?: 'm' | 'f';
  /** The official English description. Used for vector search after hard filtering. */
  prompt?: string;
  /** The voice card's own description — lets index.jsonl tell what kind of voice this is. */
  description?: string;
  /** The voice card's original text. Private: only in the private book outside the code tree, never in public rows. */
  card?: string;
  /** @deprecated Same as prompt. Fallback when reading old ledgers. */
  vibe?: string;
}

export type Cast = Record<string, CastMember>;
export type AssetIndex = Record<string, AssetEntry>;
export type AssetWordBook = Record<string, readonly FilmWord[]>;

/** Whether this key is an asset or the cast book. */
export function isAssetEntryKey(key: string): boolean {
  return key !== ASSET_CAST_KEY;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Old ledgers used `atSec`. It is folded into `startSec` on read, so only one name is written back. */
function normalizeWords(raw: unknown): AssetEntry['words'] {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((item) => {
    if (!isRecord(item) || typeof item.token !== 'string') return [];
    const start = typeof item.startSec === 'number' ? item.startSec
      : typeof item.atSec === 'number' ? item.atSec
      : null;
    if (start == null) return [];
    return [{
      token: item.token,
      startSec: start,
      ...(typeof item.endSec === 'number' ? { endSec: item.endSec } : {}),
    }];
  });
}

/**
 * Old ledgers wrote times in milliseconds (`durMs` / `attackMs`). They are converted to seconds on
 * read, so no second unit is ever written back.
 *
 * Two units in one table is among the hardest errors to track down: `durMs: 2400` and `dur: 2.4`
 * both look like normal numbers, either one compiles and renders — and being off by a thousand is
 * only noticed when watching the film. So there is no transition period: units are unified the
 * moment they are read, and the copy on disk is replaced on the next write.
 */
function withSeconds(entry: Record<string, unknown>): AssetEntry {
  const { durMs, attackMs, ...rest } = entry as AssetEntry & { durMs?: unknown; attackMs?: unknown };
  const secOf = (ms: unknown, had: unknown): number | undefined => {
    if (typeof had === 'number') return had;
    return typeof ms === 'number' && Number.isFinite(ms) ? Number((ms / 1000).toFixed(3)) : undefined;
  };
  const dur = secOf(durMs, rest.dur);
  const attack = secOf(attackMs, rest.attack);
  return {
    ...rest,
    ...(dur != null ? { dur } : {}),
    ...(attack != null ? { attack } : {}),
  };
}

function asCast(raw: unknown): Cast {
  if (!isRecord(raw)) return {};
  const out: Cast = {};
  for (const [id, one] of Object.entries(raw)) {
    if (!isRecord(one)) continue;
    out[id] = {
      ...(typeof one.voice === 'string' ? { voice: one.voice } : {}),
      ...(typeof one.name === 'string' ? { name: one.name } : {}),
      ...(typeof one.language === 'string' ? { language: one.language } : {}),
      ...(one.gender === 'm' || one.gender === 'f' ? { gender: one.gender } : {}),
      ...(typeof one.prompt === 'string' ? { prompt: one.prompt } : {}),
      ...(typeof one.card === 'string' ? { card: one.card } : {}),
      ...(typeof one.description === 'string' ? { description: one.description } : {}),
      ...(typeof one.vibe === 'string' && typeof one.prompt !== 'string' ? { prompt: one.vibe } : {}),
      ...(typeof one.vibe === 'string' ? { vibe: one.vibe } : {}),
    };
  }
  return out;
}

/** Serialize host metadata writers. Contention fails explicitly; it never steals a live lock. */
function withIndexLock<T>(workspace: string, run: () => T, migrate = true): T {
  const lock = join(dirname(assetWordBookPath(workspace)), 'asset-index.lock');
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + 4000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A slow live writer must never lose its lock to another process.
      if (Date.now() > deadline) throw new Error('Asset index is busy. Retry after the current writer finishes.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    if (migrate) migrateLegacyLedger(workspace);
    return run();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function readJson(workspace: string, rel: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(join(workspace, rel), 'utf8')) as unknown;
    if (!isRecord(raw)) throw new Error('Expected an object');
    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Unable to read asset metadata (${rel}).`, { cause: error });
  }
}

/** Private metadata lives outside the code root, so shell tools cannot discover it. */
export function assetWordBookPath(workspace: string): string {
  const root = realpathSync(workspace);
  const id = createHash('sha256').update(root).digest('hex').slice(0, 24);
  return join(dirname(root), 'runtime', 'workspace-internals', id, 'asset-words.json');
}

/**
 * The private ledger: each asset's full record (fields not in the public row, full transcript,
 * translations) and each voice's full record.
 *
 * `row` is the stamp of the public row at the time of writing. After a version rollback the private
 * book may belong to another version — entries that don't match aren't used; better to have only
 * the public facts than attach another version's transcript to this version's asset.
 */
export interface AssetPrivateBook {
  entries: Record<string, { row: string; entry: Record<string, unknown> }>;
  cast: Record<string, Record<string, unknown>>;
}

export function assetPrivateBookPath(workspace: string): string {
  return join(dirname(assetWordBookPath(workspace)), 'asset-ledger.json');
}

function normalizePrivateBook(raw: unknown): AssetPrivateBook {
  const out: AssetPrivateBook = { entries: {}, cast: {} };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.entries)) {
    for (const src of Object.keys(raw.entries).sort()) {
      const one = raw.entries[src];
      if (isRecord(one) && typeof one.row === 'string' && isRecord(one.entry)) out.entries[src] = { row: one.row, entry: one.entry };
    }
  }
  if (isRecord(raw.cast)) for (const [key, one] of Object.entries(raw.cast)) if (isRecord(one)) out.cast[key] = one;
  return out;
}

function privateBook(workspace: string): AssetPrivateBook | null {
  const path = assetPrivateBookPath(workspace);
  if (!existsSync(path)) return null;
  try {
    return normalizePrivateBook(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    throw new Error('Unable to read private asset metadata.');
  }
}

function savePrivateBook(workspace: string, book: AssetPrivateBook): void {
  const path = assetPrivateBookPath(workspace);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(normalizePrivateBook(book), null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function readAssetPrivateBook(workspace: string): AssetPrivateBook {
  isolateAssetWords(workspace);
  return privateBook(workspace) ?? { entries: {}, cast: {} };
}

const rowStamp = (line: string): string => createHash('sha256').update(line).digest('hex').slice(0, 16);

function normalizeWordBook(raw: unknown): AssetWordBook {
  if (!isRecord(raw)) return {};
  const out: AssetWordBook = {};
  for (const src of Object.keys(raw).sort()) {
    const words = normalizeWords(raw[src]);
    if (words?.length) out[src] = words;
  }
  return out;
}

function privateWordBook(workspace: string): AssetWordBook | null {
  const path = assetWordBookPath(workspace);
  if (!existsSync(path)) return null;
  // An empty book is a tombstone; corrupt or unreadable data must not become one.
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(raw)) throw new Error('Invalid timing metadata');
    return normalizeWordBook(raw);
  } catch {
    throw new Error('Unable to read media timing metadata.');
  }
}

/** Read only the metadata represented by a legacy checkout, ignoring runtime state. */
export function readLegacyAssetWordBook(workspace: string): AssetWordBook {
  const raw = readJson(workspace, ASSET_INDEX_PATH) ?? {};
  const inline: AssetWordBook = {};
  for (const [src, entry] of Object.entries(raw)) {
    if (!isAssetEntryKey(src) || !isRecord(entry)) continue;
    const words = normalizeWords(entry.words);
    if (words?.length) inline[src] = words;
  }
  return normalizeWordBook(Object.assign(inline, ...LEGACY_ASSET_WORDS_PATHS.map((path) => readJson(workspace, path) ?? {})));
}

function rowsCarryWords(workspace: string): boolean {
  const path = join(workspace, ASSET_INDEX_JSONL_PATH);
  return !existsSync(assetWordBookPath(workspace)) && existsSync(path) && readFileSync(path, 'utf8').includes('"words":');
}

function hasLegacyWords(workspace: string): boolean {
  if (LEGACY_ASSET_WORDS_PATHS.some((path) => existsSync(join(workspace, path)))) return true;
  return Object.entries(readJson(workspace, ASSET_INDEX_PATH) ?? {})
    .some(([src, entry]) => isAssetEntryKey(src) && isRecord(entry) && 'words' in entry);
}

function scrubLegacyWords(workspace: string): void {
  const raw = readJson(workspace, ASSET_INDEX_PATH);
  let changed = false;
  for (const [src, entry] of Object.entries(raw ?? {})) {
    if (!isAssetEntryKey(src) || !isRecord(entry) || !('words' in entry)) continue;
    delete entry.words;
    changed = true;
  }
  if (changed) writeOrDrop(workspace, ASSET_INDEX_PATH, raw, true);
  for (const path of LEGACY_ASSET_WORDS_PATHS) rmSync(join(workspace, path), { force: true });
}

function saveWordBook(workspace: string, book: AssetWordBook): void {
  const path = assetWordBookPath(workspace);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(normalizeWordBook(book), null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
  // Write privately first: a failed write must never destroy the legacy copy.
  scrubLegacyWords(workspace);
}

/** Move old public metadata before exposing a resumed workspace to file tools. */
export function isolateAssetWords(workspace: string): void {
  if (rowsCarryWords(workspace)) {
    /* Old portable ledgers kept word timings on the rows: move them into the private book and drop them from the rows. */
    withIndexLock(workspace, () => {
      const { cast, entries } = loadFile(workspace);
      saveFile(workspace, cast, entries);
    });
    return;
  }
  if (!hasLegacyWords(workspace) && !existsSync(join(workspace, ASSET_INDEX_PATH))) return;
  withIndexLock(workspace, () => {
    if (!hasLegacyWords(workspace)) return;
    saveWordBook(workspace, privateWordBook(workspace) ?? readLegacyAssetWordBook(workspace));
    materializeCurrentAssetViews(workspace);
  });
}

export function readAssetWordBook(workspace: string): AssetWordBook {
  isolateAssetWords(workspace);
  return privateWordBook(workspace) ?? {};
}

export function writeAssetWordBook(workspace: string, book: AssetWordBook): void {
  withIndexLock(workspace, () => {
    saveWordBook(workspace, book);
    materializeCurrentAssetViews(workspace);
  });
}

/** Hydrate a commit's note, or migrate the selected legacy checkout when no note exists. */
export function restoreAssetWordBook(workspace: string, book?: AssetWordBook, ledger?: AssetPrivateBook): void {
  withIndexLock(workspace, () => {
    /* Without a note, trust this checkout's own old ledger — it has to be read before migration removes index.json and the sidecar word book. */
    const words = book ?? readLegacyAssetWordBook(workspace);
    migrateLegacyLedger(workspace);
    saveWordBook(workspace, words);
    if (ledger) savePrivateBook(workspace, ledger);
    materializeCurrentAssetViews(workspace);
  }, false);
}

/** Cache identity includes private timings and records even when no source file changed. */
export function assetWordBookStamp(workspace: string): string {
  return createHash('sha256').update(JSON.stringify([readAssetWordBook(workspace), readAssetPrivateBook(workspace)])).digest('hex');
}

/**
 * Ledger + private word table + private text book → one in-memory table.
 *
 * `legacy` = the disk still has the old `index.json` (or millisecond units): the caller has to write
 * once for the new shape to appear.
 */
function loadFile(workspace: string): { cast: Cast; entries: AssetIndex; legacy: boolean } {
  const raw = readJson(workspace, ASSET_INDEX_PATH);
  if (raw) return loadLegacyFile(workspace, raw);
  const hadWords = privateWordBook(workspace);
  const words = hadWords ?? {};
  const book = privateBook(workspace) ?? { entries: {}, cast: {} };
  const cast: Cast = {};
  const entries: AssetIndex = {};
  let legacy = false;
  for (const { row, index } of readLedgerRows(workspace)) {
    const fail = (message: string): never => {
      throw new Error(`Unable to read the asset ledger (${ASSET_INDEX_JSONL_PATH}, line ${index + 1}): ${message}`);
    };
    const kept = row.kind === 'voice' ? undefined : book.entries[row.src];
    const { alignment: _a, transcript: _t, ...base } = row;
    if (kept && kept.row === rowStamp(JSON.stringify(base))) {
      const entry = withSeconds({ ...kept.entry, src: row.src }) as AssetEntry;
      const said = normalizeWords(words[row.src]);
      if (said?.length) entry.words = said;
      entries[row.src] = entry;
      continue;
    }
    /* The private book has no entry for this (or one from another version): only the public facts remain. */
    const parsed = parsePublicAssetRow(row, fail, true);
    if (parsed.kind === 'voice') {
      cast[parsed.role] = asCast({ one: { ...book.cast[parsed.role], ...parsed.voice } }).one!;
      continue;
    }
    /* If the private word table exists, trust it (including an explicit "none"); words on rows only come from old, unmigrated ledgers. */
    const said = normalizeWords(hadWords ? words[row.src] : parsed.entry.words);
    const { words: _rowWords, ...facts } = parsed.entry;
    entries[row.src] = { ...facts, ...(said?.length ? { words: said } : {}) };
    if ('durMs' in row || 'attackMs' in row) legacy = true;
  }
  return { cast, entries, legacy };
}

/** Old projects: `assets/index.json` is the full ledger. Read it; the caller writes it in the new shape (see migrateLegacyLedger). */
function loadLegacyFile(workspace: string, raw: Record<string, unknown>): { cast: Cast; entries: AssetIndex; legacy: boolean } {
  const sidecar = privateWordBook(workspace) ?? readLegacyAssetWordBook(workspace);
  const cast = asCast(raw[ASSET_CAST_KEY]);
  const entries: AssetIndex = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isAssetEntryKey(key) || !isRecord(value)) continue;
    const words = normalizeWords(sidecar[key]);
    const { words: _stale, ...rest } = withSeconds(value);
    entries[key] = { ...rest, ...(words?.length ? { words } : {}) };
  }
  return { cast, entries, legacy: true };
}

/** Every row of the ledger. The host writes this file, so a broken row means it is broken — say which row, don't silently drop an asset. */
function readLedgerRows(workspace: string): Array<{ row: Record<string, unknown> & { src: string }; index: number }> {
  const path = join(workspace, ASSET_INDEX_JSONL_PATH);
  if (!existsSync(path)) return [];
  const rows: Array<{ row: Record<string, unknown> & { src: string }; index: number }> = [];
  const seen = new Set<string>();
  for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { row = null; }
    if (!isRecord(row) || typeof row.src !== 'string' || !row.src
      || ['__proto__', 'constructor', 'prototype', ASSET_CAST_KEY].includes(row.src)) {
      throw new Error(`Unable to read the asset ledger (${ASSET_INDEX_JSONL_PATH}, line ${index + 1}).`);
    }
    if (seen.has(row.src)) throw new Error(`Unable to read the asset ledger (${ASSET_INDEX_JSONL_PATH}, line ${index + 1}): ${row.src} appears twice.`);
    seen.add(row.src);
    rows.push({ row: row as Record<string, unknown> & { src: string }, index });
  }
  return rows;
}

/** Migrate the old `index.json` into jsonl + private book, then delete it. The caller holds the lock. */
function migrateLegacyLedger(workspace: string): void {
  const raw = readJson(workspace, ASSET_INDEX_PATH);
  if (!raw) return;
  const { cast, entries } = loadLegacyFile(workspace, raw);
  saveFile(workspace, cast, entries);
}

function writeOrDrop(workspace: string, rel: string, body: unknown, keep: boolean): void {
  const path = join(workspace, rel);
  if (!keep) {
    rmSync(path, { force: true });
    return;
  }
  writeTextOrDrop(workspace, rel, `${JSON.stringify(body, null, 2)}\n`);
}

function saveFile(workspace: string, cast: Cast, entries: AssetIndex): void {
  /* Sort by path before writing. People browse this table, and "who was written first" isn't a
     meaningful order — sorted by path, things in the same directory sit together, and diffs show
     only the rows that really changed.
     Also fill in missing `kind`s along the way: see `assetKindOf`. */
  const sorted: AssetIndex = {};
  const words: Record<string, readonly FilmWord[]> = {};
  for (const key of Object.keys(entries).sort()) {
    const { src, kind, words: said, ...rest } = entries[key]!;
    sorted[key] = { src: src || key, kind: kind ?? assetKindOf(src || key), ...rest };
    if (said?.length) words[key] = said;
  }
  // Private books first: a failed write must never leave a ledger that points at data we lost.
  saveWordBook(workspace, words);
  const lines = publicLedgerLines(sorted, cast, words);
  const book: AssetPrivateBook = { entries: {}, cast: {} };
  for (const [key, entry] of Object.entries(sorted)) {
    const { words: _w, ...record } = entry;
    book.entries[key] = { row: lines.stamps.get(key)!, entry: record };
  }
  for (const [key, member] of Object.entries(cast)) book.cast[key] = { ...member };
  savePrivateBook(workspace, book);
  writePublicViews(workspace, sorted, words, lines);
  rmSync(join(workspace, ASSET_INDEX_PATH), { force: true });
}

/* ── On disk ───────────────────────────────────────────────────────────────
 *
 *   assets/index.jsonl      The ledger: one row per asset (one per voice); text fields keep only a preview.
 *   assets/transcripts/     One WebVTT per transcribed asset: the full text split at pauses, with source seconds.
 *   (outside the code tree) Word timings, full transcripts and translations — used on the host side by cue(),
 *                           captions, cut-point checks and translation.
 *
 * Rewritten on asset/word-book updates and version restores; a cache hit also repairs missing or
 * stale transcript views.
 */

/* Rows handed back from elsewhere (a throwaway server-side workspace) only accept these fields.
   `cast` / `voice_uid` are called `role` / `voiceId` on rows — externally only the name role is used. */
const PUBLIC_ASSET_FIELDS = ['kind', 'bytes', 'savedAt', 'dur', 'w', 'h', 'fps', 'vcodec', 'pixFmt',
  'text', 'speakerTurns', 'transcribed', 'attack', 'peakDb', 'hasAudio', 'hasVideo', 'transparent', 'preview', 'lastFrame', 'title', 'family'] as const;
const PUBLIC_ORIGIN_FIELDS = ['mode', 'prompt', 'description', 'provider', 'source', 'sourceUrl',
  'title', 'model', 'sec', 'size', 'quality', 'resolution', 'firstFrame', 'lastFrame', 'src', 'at'] as const;
const PUBLIC_VOICE_FIELDS = ['language', 'gender', 'name', 'prompt', 'description'] as const;

/**
 * Merge rows produced elsewhere (in the `assets/index.jsonl` shape) into this workspace's ledger.
 *
 * The desktop app's acquisition commands run in a throwaway server-side workspace and hand back
 * rows from that ledger; they are merged one by one with the same validation. An existing entry with
 * the same src is replaced wholesale — the server's row is the complete set of facts for that asset.
 * Returns the list of merged srcs.
 */
export function mergeAssetIndexRows(workspace: string, rows: readonly Record<string, unknown>[]): string[] {
  if (!rows.length) return [];
  return withIndexLock(workspace, () => {
    const { cast, entries } = loadFile(workspace);
    const merged: string[] = [];
    rows.forEach((row, index) => {
      const fail = (message: string): never => {
        throw new Error(`Unable to merge asset metadata (row ${index + 1}): ${message}`);
      };
      if (!isRecord(row) || typeof row.src !== 'string' || !row.src) fail('src must be nonempty.');
      const parsed = parsePublicAssetRow(row, fail);
      if (parsed.kind === 'voice') cast[parsed.role] = parsed.voice;
      else entries[parsed.entry.src] = parsed.entry;
      merged.push(row.src as string);
    });
    saveFile(workspace, cast, entries);
    return merged;
  });
}

type ParsedPublicRow = { kind: 'voice'; role: string; voice: NonNullable<Cast[string]> } | { kind: 'entry'; entry: AssetEntry };

/** One public-shape row → an internal entry (or a member of the cast book). `fail` is bound to a row number by the caller. */
function parsePublicAssetRow(row: Record<string, unknown>, fail: (message: string) => never, preview = false): ParsedPublicRow {
  const src = row.src as string;
  if (row.kind === 'voice') {
    /* Our own ledger may have roles that don't have a voice yet (only a name was kept, or none was
       picked this time) — that row has no voiceId and is still a member of the book. Rows handed
       back from elsewhere must carry the voice. */
    const voiceless = preview && row.voiceId === undefined;
    if (!/^voice:[^\s/\\]+$/.test(src) || (!voiceless && (typeof row.voiceId !== 'string' || !row.voiceId))) {
      fail('voice rows require a voice: source and voiceId.');
    }
    if (row.role !== undefined && (typeof row.role !== 'string' || !row.role || src !== `voice:${row.role}`)) {
      fail('voice role must match its source.');
    }
    if (['__proto__', 'constructor', 'prototype'].includes(row.role as string)) fail('unsupported voice role.');
    const voice: Record<string, unknown> = voiceless ? {} : { voice: row.voiceId };
    for (const field of PUBLIC_VOICE_FIELDS) {
      if (row[field] === undefined) continue;
      if (typeof row[field] !== 'string') fail(`${field} must be a string.`);
      voice[field] = row[field];
    }
    return { kind: 'voice', role: (row.role ?? src) as string, voice: asCast({ voice }).voice! };
  }
  // Ledger keys are workspace-relative paths, never URLs, traversal or bookkeeping.
  if (/[\\\u0000-\u001f:]/.test(src)
    || src.split('/').some(part => !part || part === '.' || part === '..')
    || [ASSET_CAST_KEY, '__proto__', 'constructor', 'prototype', ASSET_INDEX_JSONL_PATH].includes(src)
    || isAssetIndexPath(src)) {
    fail('src must be a workspace-relative asset path.');
  }
  const entry: AssetEntry = { src };
  // A discovery view cannot restore a transcript. Legacy full rows and host transfers can.
  if (!preview && ((typeof row.textOmitted === 'number' && row.textOmitted > 0)
    || (row.alignment === 'ready' && !Array.isArray(row.words)))) {
    fail('this is a transcript preview, not a complete asset record. Restore the project metadata and private alignment, or transfer the complete host record.');
  }
  const facts: Record<string, unknown> = entry;
  for (const field of PUBLIC_ASSET_FIELDS) {
    const value = row[field];
    if (value === undefined) continue;
    if (field === 'speakerTurns') {
      if (!Array.isArray(value) || value.some(turn => !isRecord(turn) || typeof turn.speaker !== 'string'
        || typeof turn.start !== 'number' || !Number.isFinite(turn.start) || turn.start < 0
        || typeof turn.end !== 'number' || !Number.isFinite(turn.end) || turn.end < turn.start)) {
        fail('speakerTurns must contain speaker, start and end.');
      }
      entry.speakerTurns = (value as Array<{ speaker: string; start: number; end: number }>).map(({ speaker, start, end }) => ({ speaker, start, end }));
    } else if (['bytes', 'savedAt', 'dur', 'w', 'h', 'fps', 'attack', 'peakDb'].includes(field)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || (field !== 'peakDb' && value < 0)) fail(`${field} must be a finite ${field === 'peakDb' ? '' : 'nonnegative '}number.`);
      facts[field] = value;
    } else if (['transcribed', 'hasAudio', 'hasVideo', 'transparent'].includes(field)) {
      if (typeof value !== 'boolean') fail(`${field} must be a boolean.`);
      facts[field] = value;
    } else {
      if (typeof value !== 'string') fail(`${field} must be a string.`);
      if (field === 'kind' && !['audio', 'video', 'image', 'font', 'mg', 'file'].includes(value as string)) fail(`unsupported asset kind: ${JSON.stringify(value).slice(0, 80)}.`);
      facts[field] = value;
    }
  }
  for (const field of ['fontWeight', 'frames'] as const) {
    const value = row[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' && !(field === 'fontWeight' && typeof item === 'number' && Number.isFinite(item)))) fail(`${field} must be an array of supported values.`);
    entry[field] = value;
  }
  if (row.from !== undefined) {
    if (!isRecord(row.from)) fail('from must be an object.');
    const origin = row.from as Record<string, unknown>;
    const from: Record<string, unknown> = {};
    for (const field of PUBLIC_ORIGIN_FIELDS) {
      const value = origin[field];
      if (value === undefined) continue;
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) fail(`from.${field} must be a string or finite number.`);
      from[field] = value;
    }
    if (origin.refs !== undefined) {
      if (!Array.isArray(origin.refs) || origin.refs.some(value => typeof value !== 'string')) fail('from.refs must be an array of strings.');
      from.refs = origin.refs;
    }
    entry.from = from;
  }
  for (const [field, internal] of [['role', 'cast'], ['voiceId', 'voice_uid']] as const) {
    if (row[field] === undefined) continue;
    if (typeof row[field] !== 'string') fail(`${field} must be a string.`);
    entry[internal] = row[field] as string;
  }
  if (row.words !== undefined) {
    if (!Array.isArray(row.words)) fail('words must be an array.');
    entry.words = (row.words as unknown[]).map((word) => {
      if (!isRecord(word) || typeof word.token !== 'string' || typeof word.start !== 'number'
        || !Number.isFinite(word.start) || word.start < 0
        || (word.end !== undefined && (typeof word.end !== 'number' || !Number.isFinite(word.end) || word.end < word.start))) {
        fail('words must contain token, finite start and optional end.');
      }
      const value = word as { token: string; start: number; end?: number };
      return { token: value.token, startSec: value.start, ...(value.end !== undefined ? { endSec: value.end } : {}) };
    });
  }
  return { kind: 'entry', entry };
}

function writeTextOrDrop(workspace: string, rel: string, body: string | null): void {
  const path = join(workspace, rel);
  if (body == null) { rmSync(path, { force: true }); return; }
  if (existsSync(path) && readFileSync(path, 'utf8') === body) return;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** The caller holds the index lock, so a restored word book and its view agree. */
function materializeCurrentAssetViews(workspace: string): void {
  const { entries, cast } = loadFile(workspace);
  const words: AssetWordBook = {};
  for (const [src, entry] of Object.entries(entries)) if (entry.words?.length) words[src] = entry.words;
  materializeAssetViews(workspace, entries, cast, words);
}

/** Repair the queryable ledger on cache hits without rewriting private facts. */
export function refreshAssetIndexViews(workspace: string): void {
  withIndexLock(workspace, () => materializeCurrentAssetViews(workspace));
}

interface PublicLedgerLines {
  /** In output order: voices first, then assets by path. */
  all: string[];
  /** Stamp of each asset's row (excluding alignment / transcript, which are derived from the word table; see `rowStamp`). */
  stamps: Map<string, string>;
}

function publicLedgerLines(entries: AssetIndex, cast: Cast, words: Record<string, readonly FilmWord[]>): PublicLedgerLines {
  const all: string[] = [];
  const stamps = new Map<string, string>();
  /* One row per registered voice: kind 'voice', src is voice:<role> — `grep '"kind":"voice"'`
     lists all voices at once; `grep '"src":"voice:host"'` looks up one. It can't collide with an
     asset src: asset srcs are file paths, and the voice: prefix isn't a path. On the row, role is
     the registered name and voiceId is the vendor's voice id — receipts, rows and the --voice
     flag all use these two words. */
  for (const [key, m] of Object.entries(cast).sort(([a], [b]) => a.localeCompare(b))) {
    /* Keys of the form `voice:<voiceId>` are voice cards saved from search; their src is the key
       itself, with no role. Other keys are registered roles. Both produce `kind:"voice"` rows. */
    const catalog = key.startsWith('voice:');
    const line: Record<string, unknown> = catalog
      ? { src: key, kind: 'voice' }
      : { src: `voice:${key}`, kind: 'voice', role: key };
    if (typeof m.voice === 'string') line.voiceId = m.voice;
    for (const field of PUBLIC_VOICE_FIELDS) {
      if (typeof m[field] === 'string') line[field] = m[field];
    }
    all.push(JSON.stringify(line));
  }
  for (const [key, entry] of Object.entries(entries)) {
    const line: Record<string, unknown> = { src: entry.src };
    for (const field of PUBLIC_ASSET_FIELDS) {
      const value = entry[field];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') line[field] = value;
    }
    if (Array.isArray(entry.speakerTurns)) line.speakerTurns = entry.speakerTurns;
    for (const field of ['fontWeight', 'frames'] as const) {
      const value = entry[field];
      if (Array.isArray(value)) line[field] = value.filter(item => typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)));
    }
    if (entry.from) {
      const from: Record<string, unknown> = {};
      for (const field of PUBLIC_ORIGIN_FIELDS) {
        const value = entry.from[field];
        if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) from[field] = value;
      }
      if (Array.isArray(entry.from.refs)) from.refs = entry.from.refs.filter(value => typeof value === 'string');
      /* In generated images' provenance, description is often just the prompt copied verbatim;
         with hundreds of images in the table, that duplication alone takes up most of it. The
         full version is in the private book. */
      if (from.description !== undefined && from.description === from.prompt) delete from.description;
      if (Object.keys(from).length) line.from = from;
    }
    /* Who speaks and with which voice — in materialized rows these two names are the role / voiceId pinned by `audio voice`. */
    if (typeof entry.cast === 'string') line.role = entry.cast;
    if (typeof entry.voice_uid === 'string') line.voiceId = entry.voice_uid;
    if (typeof line.text === 'string' && line.text.length > 400) {
      line.textOmitted = line.text.length - 400;
      line.text = line.text.slice(0, 400);
    }
    stamps.set(key, rowStamp(JSON.stringify(line)));
    Object.assign(line, assetTranscriptInfo({ ...entry, words: words[key] }));
    all.push(JSON.stringify(line));
  }
  return { all, stamps };
}

function writePublicViews(workspace: string, entries: AssetIndex, words: Record<string, readonly FilmWord[]>, lines: PublicLedgerLines): void {
  const transcripts = new Map<string, string>();
  for (const [key, entry] of Object.entries(entries)) {
    const vtt = transcriptVtt({ ...entry, words: words[key] });
    const path = assetTranscriptPath(entry.src);
    if (vtt && path) transcripts.set(path, vtt);
  }
  /* Keep an empty file even with no assets. Both setup and refresh go through here; if it were
     deleted, grep would report "no such file", indistinguishable from "no assets yet". */
  writeTextOrDrop(workspace, ASSET_INDEX_JSONL_PATH, lines.all.length ? `${lines.all.join('\n')}\n` : '');
  for (const [path, body] of transcripts) writeTextOrDrop(workspace, path, body);
  const transcriptsDir = join(workspace, ASSET_TRANSCRIPTS_DIR);
  if (sweepTranscripts(workspace, transcriptsDir, transcripts)) rmSync(transcriptsDir, { recursive: true, force: true });

  // Remove obsolete public timing sidecars; private storage remains authoritative.
  const assetsDir = join(workspace, 'assets');
  if (!existsSync(assetsDir)) return;
  const sweep = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, item.name);
      if (item.isDirectory()) { sweep(abs); continue; }
      if (item.name.endsWith('.words.jsonl')) rmSync(abs, { force: true });
    }
  };
  sweep(assetsDir);
}

function materializeAssetViews(workspace: string, entries: AssetIndex, cast: Cast, words: Record<string, readonly FilmWord[]>): void {
  writePublicViews(workspace, entries, words, publicLedgerLines(entries, cast, words));
}

/** Keep only transcript views for assets that still exist: when an asset is deleted or moved, the old view mustn't linger for rg to find. */
function sweepTranscripts(workspace: string, dir: string, keep: ReadonlyMap<string, string>): boolean {
  if (!existsSync(dir)) return true;
  let empty = true;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, item.name);
    const rel = relative(workspace, abs).split('\\').join('/');
    if (item.isDirectory() && sweepTranscripts(workspace, abs, keep)) rmSync(abs, { recursive: true, force: true });
    else if (!item.isDirectory() && !keep.has(rel)) rmSync(abs, { force: true });
    else empty = false;
  }
  return empty;
}

/** Asset entries. The `cast` key never appears here. */
export function readAssetIndex(workspace: string): AssetIndex {
  isolateAssetWords(workspace);
  return loadFile(workspace).entries;
}

/** Write assets, leaving the cast as is. The file is only deleted when both are empty. */
export function writeAssetIndex(workspace: string, index: AssetIndex): void {
  withIndexLock(workspace, () => saveFile(workspace, loadFile(workspace).cast, index));
}

/** Change one entry, leaving the rest. Merged rather than replaced wholesale — each writer only knows its own few fields. */
export function putAssetEntry(workspace: string, src: string, patch: Partial<AssetEntry>): AssetEntry {
  return withIndexLock(workspace, () => {
    const { cast, entries } = loadFile(workspace);
    const merged: AssetEntry = { ...entries[src], ...patch, src };
    entries[src] = merged;
    saveFile(workspace, cast, entries);
    return merged;
  });
}

/**
 * Change many entries under one lock — the path used by reconciliation.
 *
 * Calling `putAssetEntry` per entry would get there too, but that is N rounds of "lock, read the
 * whole table, write the whole table, unlock", and reconciliation may touch dozens of entries each
 * time. More importantly it isn't atomic: if another process writes between any two entries, the
 * two sides see two different tables.
 *
 * `mutate` receives **the copy just read under the lock**, not the one the caller read a few hundred
 * milliseconds earlier — probing runs ffprobe and can't hold the lock, so the plan is computed
 * outside the lock and merged in under it. Returning `null` = nothing to change, and not one byte is
 * written (the table goes into git; no change should mean no diff).
 *
 * There is one exception: the copy on disk still uses the old unit (milliseconds). Then it must be
 * written once even if nothing else changes in this pass, because **the film reads the raw file on
 * disk** — the bundle entry and MG code import this json directly, bypassing the read path here.
 * Converting to seconds only in memory would leave the picture reading the previous unit.
 */
export function updateAssetIndex(
  workspace: string,
  mutate: (entries: AssetIndex) => AssetIndex | null,
): boolean {
  return withIndexLock(workspace, () => {
    const { cast, entries, legacy } = loadFile(workspace);
    const known = new Set(Object.keys(entries));
    const next = mutate(entries);
    if (!next && !legacy) return false;
    const out = next ?? entries;
    /* The ledger rows are gone but the private word table remains (a checkout that lost its
       ledger): reconciliation registers the assets again as if new. Newly registered entries take
       their words back from the private table — otherwise saveFile rewrites the private table from
       the entries and all the word timings are wiped. */
    const book = privateWordBook(workspace) ?? {};
    for (const [src, entry] of Object.entries(out)) {
      const kept = book[src];
      if (!known.has(src) && !entry.words?.length && kept?.length) out[src] = { ...entry, words: kept };
    }
    saveFile(workspace, cast, out);
    return next != null;
  });
}

/** Delete one entry. Returns whether it existed. */
export function dropAssetEntry(workspace: string, src: string): boolean {
  return withIndexLock(workspace, () => {
    const { cast, entries } = loadFile(workspace);
    if (!(src in entries)) return false;
    delete entries[src];
    saveFile(workspace, cast, entries);
    return true;
  });
}

/** The cast ledger. */
export function readCast(workspace: string): Cast {
  isolateAssetWords(workspace);
  return loadFile(workspace).cast;
}

export function writeCast(workspace: string, cast: Cast): void {
  withIndexLock(workspace, () => saveFile(workspace, cast, loadFile(workspace).entries));
}

/**
 * The "does the ledger exist" part of the cache shape. Films no longer import the ledger file —
 * the host hands the facts to the entry (see `filmRuntimeAssets`); this only makes "the first asset
 * just arrived" change the shape.
 */
export function filmDocAssetFacts(_doc: FilmDoc, workspace: string): string[] {
  isolateAssetWords(workspace);
  return [ASSET_INDEX_JSONL_PATH].filter((rel) => existsSync(join(workspace, rel)));
}

/**
 * Asset facts the film gets at runtime: path → kind, duration, dimensions, text, role, hit point,
 * translations.
 *
 * All three bundles (server-side evaluation, browser preview, capture page) use this one — back
 * when each computed its own, the browser's copy missed the translations and captions in another
 * language didn't show up in the preview. Word timings are provided separately
 * (`readAssetWordBook`).
 */
export function filmRuntimeAssets(workspace: string): Record<string, {
  src: string; kind?: AssetKind; title?: string; text?: string; cast?: string;
  dur?: number; w?: number; h?: number; attack?: number; translations?: AssetEntry['translations'];
}> {
  return Object.fromEntries(Object.entries(readAssetIndex(workspace)).map(([src, entry]) => {
    const asset: ReturnType<typeof filmRuntimeAssets>[string] = { src };
    if (entry.kind && ['audio', 'video', 'image', 'font', 'mg', 'file'].includes(entry.kind)) asset.kind = entry.kind;
    for (const key of ['title', 'text', 'cast'] as const) {
      if (typeof entry[key] === 'string') asset[key] = entry[key] as string;
    }
    for (const key of ['dur', 'w', 'h', 'attack'] as const) {
      if (typeof entry[key] === 'number' && Number.isFinite(entry[key])) asset[key] = entry[key] as number;
    }
    if (entry.translations) asset.translations = entry.translations;
    return [src, asset];
  }));
}
