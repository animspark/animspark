/**
 * `@animspark/film-build` — the server side of a film.
 *
 * Evaluate the tree, measure media, mix down audio, check the whole film. **The CLI and the web
 * app use the same code**: `anim check` passing while the UI can't render the film (or the other
 * way round) is the hardest kind of divergence to track down, and it usually comes from each side
 * having its own copy.
 *
 * This layer needs fs / esbuild / ffmpeg, so it only runs on the server. The browser half is
 * `@animspark/runtime`.
 */

export { declaredFamilies, declaredFaces, type DeclaredFaces } from './font-css';
export {
  columnsFor,
  contactSheet,
  sampleTimes,
  stampOf,
  writeSheetIndex,
} from './contact-sheet';
export {
  audibleSources,
  duckCurve,
  duckCurveGainAt,
  duckVolumeExpr,
  mixPlan,
  mixdownFilm,
  readLoudness,
  type DuckCurve,
  type MixPlan,
} from './mixdown';
export {
  DEPS_PARAM,
  LIB_PATHS,
  SHARED_DEPS,
  addLibRoot,
  resolveFromLibPaths,
  sharedDepsPlugin,
} from './shared-deps';
export {
  GSAP_PLUGIN_MODULES,
  GSAP_PLUGIN_SHARED_SPECS,
  gsapPluginSharedEntries,
} from './gsap-shared';
export {
  resolveAll,
  type KnownMediaFacts,
  type MediaFactsStore,
  type MediaResolver,
} from './media-resolver';
export { durationMs, ffmpeg, probe, type MediaFacts, type ProbeOptions } from './probe';
export { splitClauses, synthesize, tokenize, type TtsResult } from './tts';
export { FilmCliError } from './cli-error';
export { ASSET_TRANSCRIPTS_DIR, assetTranscriptInfo, assetTranscriptPath, transcriptVtt } from './code/asset-transcript';
export { findWorkspace, isFilmWorkspaceDir, userCwd } from './workspace';

export { compileFilmBrowser, FILM_GLOBAL, type FilmBundle } from './code/bundle';
export { projectRuntimeSource, PROJECT_RUNTIME_HOST } from './code/project-runtime';
export { checkFilm, formatCheck, spokenClips, type CodeIssue, type CutLevel } from './code/check';
export {
  filmDocEntrySource,
  filmDocErrorEntry,
  type FilmDocEntryOptions,
} from './code/doc-entry';
export {
  ASSET_CAST_KEY,
  ASSET_INDEX_PATH,
  ASSET_INDEX_JSONL_PATH,
  ASSET_LEDGER_PATHS,
  ASSET_WORDS_PATH,
  assetKindOf,
  dropAssetEntry,
  filmDocAssetFacts,
  assetWordBookPath,
  assetWordBookStamp,
  readAssetWordBook,
  readAssetPrivateBook,
  assetPrivateBookPath,
  filmRuntimeAssets,
  readLegacyAssetWordBook,
  writeAssetWordBook,
  restoreAssetWordBook,
  isolateAssetWords,
  isAssetEntryKey,
  isAssetIndexPath,
  mergeAssetIndexRows,
  putAssetEntry,
  readAssetIndex,
  refreshAssetIndexViews,
  readCast,
  updateAssetIndex,
  writeAssetIndex,
  writeCast,
  type AssetEntry,
  type AssetTranslationLine,
  type AssetIndex,
  type AssetWordBook,
  type AssetPrivateBook,
  type AssetKind,
  type AssetOrigin,
  type Cast,
  type CastMember,
} from './code/asset-index';
export { collectDocMediaSec } from './code/doc-media';
export {
  applyFilmDocEdits,
  insertFilmDocClip,
  removeFilmDocClip,
  splitFilmDocClip,
  type DocBake,
  type DocEditResult,
  type DocInsertEdit,
} from './code/doc-edit';
export {
  applyPropEdits,
  insertElement,
  overwritesExpression,
  parseLoc,
  patchStyleInTag,
  removeElement,
  type InsertEdit,
  type ParsedLoc,
  type PropEdit,
  type PropValue,
  type SplitEdit,
} from './code/edit-props';
export { applyTextEdit, type TextEdit } from './code/edit-text';
export { findTextLiterals, replaceTextLiteral, type TextLiteralHit } from './code/edit-text-value';
export { evaluateFilm, filmBuildSnapshot, type FilmEval, type FilmBuildSnapshot } from './code/evaluate';
export { readPublishedMgProjects, publishedMgProjectsStamp } from './code/published-mg';

export { syncScoreAudio } from './code/score-audio';
