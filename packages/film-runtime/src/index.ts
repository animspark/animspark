/**
 * `@animspark/runtime`: the layer between a film and its picture.
 *
 * A film's root is `film.json`. This package defines how "time" is expressed on the React
 * tree the film renders into:
 *
 * - **The doc** (`code/doc`): the doc's tracks and clips laid out as a component tree. The
 *   kind of a clip belongs to its track; a clip only says which asset it points at, which
 *   second it starts at (`at`), and which span of its own timeline it trims to (`time`).
 * - **The clock** (`code/stage`): the current time is a single number in context. Playing,
 *   scrubbing and frame extraction all set that number to N and render once, so "the preview
 *   looks like this but the export doesn't" is structurally impossible.
 * - **Animation** (`code/timeline`): a gsap timeline is built once and handed to the host,
 *   which seeks it to each moment.
 * - **Visual assets** (`code/media`): `Video` / `Still`. A video carries a decoder and needs
 *   runtime help to stay aligned with the host clock; a still needs no alignment, so this
 *   layer only registers it (the timeline's picture track draws from that). Illustrations
 *   inside MG components are still plain `<img>`: they are the component's own picture, not
 *   a clip on the doc.
 * - **Audio** (`code/sound`): audio clips render as `Vo` / `Sfx` / `Music`. They emit no
 *   pixels; they only register "what sounds when" on the tree, and the mix follows that list.
 * - **3D** (`code/gl`): `useSharedRenderer`. A film has exactly one WebGL context, and a
 *   dozen 3D shots take turns using it.
 *
 * Pack components (`<Formula>` / `<Chart>` and the like) don't live here: each pack exports
 * its own and becomes a React component itself. `@animspark/data` works this way; by not
 * going through `@animspark/scene-engine/react`, the preview host can bundle it as a clean,
 * self-contained unit. Handles come from the pack itself: `packHandle(id)`.
 *
 * "How long is this film, and what sounds when" must be answerable without a browser. That
 * is `collectFilm`'s job, and the exported audio track, checks and timeline are all built on
 * top of it.
 */

export {
  fadeOpacity,
  stageFit,
  stageRect,
  type Rect,
} from './geometry';

/* When the host page takes a thumbnail it crops to the module's own region, and the host
   lives in another package (the engine's code-host), so it can only use the public exports.
   The geometry is computed in one place: an MG clip with no transform is full-frame, so the
   crop is the component's own box; once the clip has been shrunk into a block, trust the
   clip's layout box. If the two disagree nothing throws; the crop is just slightly off from
   what's on stage. */
export {
  filmClipEnvelopeOnStage,
  filmClipPaintBox,
  filmClipPaintOnStage,
  filmPaintCrop,
  filmPaintedBox,
  filmRenderedBox,
} from './code/layer';

export { collectFilm, type FilmSummary } from './code/collect';
export {
  FilmDocClips,
  filmAssetsWithWords,
  filmFromDoc,
  filmFromLiveDoc,
  resolveFilmDoc,
  resolveFilmDocWithRefs,
  type FilmAssetEntry,
  type FilmAssetIndex,
  type FilmDocResolveOpts,
  type FilmMediaIndex,
  type FilmMgModule,
  type FilmMgModules,
  type PlacedFilmClip,
} from './code/doc';
export { type FilmRefTable } from './code/refs';
export { PreparedMgSurface, type FilmPreparedMgProject } from './code/mg-project';
export { Seq } from './code/seq';
export {
  at,
  duration,
  cue,
  createMediaCue,
  mediaCue,
  type MediaCue,
  type MediaCueSound,
  type MediaCueOptions,
  type MediaCueSelector,
  type MusicCueEvent,
  type MediaDurationSource,
  createMediaAt,
  createMediaDuration,
  mediaAt,
  mediaDuration,
  type MediaTimeEntry,
  type MediaTimeIndex,
} from './code/media-at';
export { planMgSoundClips, type MgSound, type PlannedMgSound, type MgSoundPlacement } from './code/mg-sounds';
export { mgScoreSrc, mgScoreJson, filmScoreAssets } from './code/mg-score';
/* Look up a word in an asset with at(src, phrase) and its total length with duration(src);
   both return seconds in the asset's own time. The host binds metadata per project; legacy
   single-argument clip references keep their original scoping semantics. */
export {
  useSharedPaint,
  useSharedRenderer,
  type DrawFrame,
  type PaintFrame,
  type SharedPaintOptions,
  type SharedRenderer,
} from './code/gl';
export {
  Still,
  Video,
  useVideoSync,
  type StillProps,
  type VideoProps,
  type VisualAsset,
} from './code/media';
export { spokenLines, type SpokenLine, type SpokenWord } from './code/spoken';
export { useTimeline, type Seekable } from './code/timeline';
export { createUseGSAPBridge } from './code/gsap-react';
export { registerFilmPending } from './code/pending';
export {
  HtmlTexture,
  fontEmbedCssFor,
  htmlTextureMode,
  useHtmlTexture,
  type HtmlTexture as HtmlTextureHandle,
  type HtmlTextureMode,
  type HtmlTextureProps,
} from './code/html-texture';
export {
  ClipMetaInfo,
  ClipSoundInfo,
  FilmRoot,
  TrackInfo,
  useStage,
  useCollecting,
  useFilmPlaying,
  useFilmTimeMs,
  useLocal,
  useLocalMs,
  useSpanMs,
  useSpanStartMs,
  type CaptionEntry,
  type ClipMeta,
  type FilmClipCue,
  type FilmTrackRef,
  type MediaEntry,
  type SceneSpan,
  type Sink,
  type SoundEntry,
  type SoundKind,
} from './code/stage';
