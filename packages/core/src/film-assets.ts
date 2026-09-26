/**
 * The file names the asset ledger uses on disk, plus "is this path the ledger itself?".
 *
 * Reading and writing the ledger lives in film-build (it needs `node:fs`), but the **predicate** is
 * needed on both sides: the server when listing the file tree and deciding which files to import at
 * bundle time, and the frontend's asset cabinet and task file list, which must hide them too. The
 * frontend cannot import film-build, so these live here: just names and a pure function, no
 * filesystem access.
 *
 * Each place used to hard-code its own literal, so the same ledger was hidden in the asset cabinet
 * but visible in the file tree. Since the per-word timings were split out, such a leak costs more:
 * miss one check and the user sees a file in the cabinet that opens to two thousand tokens.
 */

/** The workspace's asset ledger, one per film: one asset per line (see asset-index in film-build). */
export const ASSET_INDEX_JSONL_PATH = 'assets/index.jsonl';

/** The full ledger of older projects. Now read only once, during migration, then deleted (see asset-index in film-build). */
export const ASSET_INDEX_PATH = 'assets/index.json';

/**
 * Legacy checkout path and change marker. New timings live in private storage and Git notes.
 * Keys are asset paths; values are that asset's `words`.
 *
 * Why it is split from the ledger above: the ledger is meant to be browsed by people, and a
 * ten-minute interview has two to three thousand words. Inlined, that is ten thousand lines burying
 * the twenty that matter. In memory it is still the `words` field on an asset.
 */
export const ASSET_WORDS_PATH = 'assets/index.words.json';

/** Every file the ledger writes to disk. Anything reporting "which files changed" must report the whole set: one write can change more than one of them. */
export const ASSET_LEDGER_PATHS: readonly string[] = [ASSET_INDEX_JSONL_PATH, ASSET_INDEX_PATH, ASSET_WORDS_PATH];

/**
 * True when this path is the bookkeeping itself, not an asset.
 *
 * Every place that lists the workspace's assets must filter it out, and they must all use **this
 * same** predicate.
 */
export function isAssetIndexPath(rel: string): boolean {
  const clean = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  return clean === ASSET_INDEX_PATH || isPrivateAssetWordsPath(clean);
}

/** Reserved timing metadata names never appear in author-facing file surfaces. */
export function isPrivateAssetWordsPath(rel: string): boolean {
  return rel.replace(/\\/g, '/').split('/').some((part) =>
    ['index.words.json', 'word.index.json', 'words.index.json', 'asset-words.json'].includes(part)
    || part.startsWith('asset-words.json.'));
}
