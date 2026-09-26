/**
 * Browser-only playback entry: contains only interpolation + rendering + Registry, no compile/authoring/mathjs.
 * At build time esbuild bundles playback/runtime.js from this entry + the film's package list.
 */
export type { CompiledScene } from '../core/types';
export type { FrameState } from '../compile/interpolate';
export { Registry } from '../core/registry';
export { applyThemeDesign, DEFAULT_THEME_PALETTE } from '../core/theme';
export { frameAt, propsAt, cameraAt } from '../compile/interpolate';
export { renderFrameToCanvas, drawSvgToCanvas, onImageReady, requestPlaybackRedraw, setSyncImageResolver, addSyncImageResolver, getSyncImageSource, getCachedImageSource, markSyncDraw, getSyncDrawTick, setSeekExact, seekExact, setForcePaint, forcePaint, type CanvasRenderOptions } from '../render/canvas';
export { pyodideReady, isHarnessWarm, preloadPyodide, ensurePyodide, getPyodideLoadStatus, subscribePyodideStatus, type PyodideLoadPhase, type PyodideLoadStatus } from '../pyodide';
export { currentTheme, type ThemePalette } from '../core/tokens';
export { renderFrameSvg, type RenderOptions } from '../render/svg';
export { meetRectInBox, resolveContentDebugRect } from '../render/content-rect';
export { collectImageUrls, preloadImages, aliasImageCache } from '../render/image-preload';
export { RHYTHM } from '../compile/rhythm';

/** Kept in sync with the scene-engine package.json version; manifest.runtimeVersion uses this value. */
export const RUNTIME_VERSION = '0.0.1';
