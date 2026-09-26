/**
 * @animspark/scene-engine: the scene runtime and component contract.
 *
 * The authoring layer is TSX + GSAP (see authoring/); compiling and bundling belong to engine. This package
 * provides the component contract (ComponentDef/Registry), package manifests, themes and fonts, plus
 * interpolation and rendering for existing films in keyframe playback (animspark-playback/1).
 * The engine itself ships zero concrete components: capabilities like real-time 3D (Three) and generative
 * art (P5) are all registered by Scene packages.
 */

// Core types and constants
export * from './core/types';
export * from './core/tokens';
export * from './core/fonts';
export {
  applyThemeDesign,
  DEFAULT_THEME_PALETTE,
} from './core/theme';
export { Registry, AmbiguousComponentError, scoreComponentParams, parsePackageName, PACKAGE_CATEGORIES, type ScenePackage, type ComponentsVariant, type FunctionsVariant, type PackageNameParts, type PackageCategory } from './core/registry';
// Package manifest (the animspark field in package.json) + detection/enablement contract
export {
  isAnimSparkPackage,
  type AnimSparkDeveloperManifest,
  type AnimSparkExtensionManifest,
  type AnimSparkPackageManifest,
  type AnimSparkAwarePackageJson,
  type DiscoveredPackage,
} from './core/manifest';
// Server-side bake rendering contract (implemented by each package, orchestrated by the host)
export type { BakeContext, BakedResult, ComponentBaker, BakerRegistry } from './core/bake';
// Scene tool contract (implemented by each package, mounted by the host)
export type { SceneToolContext, SceneToolResult, SceneTool, ToolRegistry } from './core/tools';

// Subtitle segmentation and interpolation (keyframe playback pipeline)
export {
  segmentNarration,
  segmentNarrationCuts,
  segmentNarrationWithTurns,
  type SpeakerTurnSpan,
  type SubtitleSegment,
} from './compile/subtitle';
export { RHYTHM } from './compile/rhythm';
export { frameAt, propsAt, cameraAt, lerpValue, lerpProps, type FrameState } from './compile/interpolate';

// Rendering
export { renderFrameSvg, renderDecorSvg, renderChromeSvg, type RenderOptions } from './render/svg';
export { meetRectInBox, resolveContentDebugRect } from './render/content-rect';
export { renderFrameToCanvas, drawSvgToCanvas, onImageReady, requestPlaybackRedraw, setSyncImageResolver, getSyncImageSource, getCachedImageSource, cacheSvgDocument, isSvgImageHref, type CanvasRenderOptions } from './render/canvas';
export { collectImageUrls, preloadImages, aliasImageCache } from './render/image-preload';
