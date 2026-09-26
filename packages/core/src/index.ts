/**
 * @animspark/core — the film contract shared by the runtime, the build and the engine.
 *
 * Only the film format lives here: the film.json document, its media, subtitles, speech and audio
 * vocabulary, the playback manifest and the MG preview security policy.
 */
export * from './modality';
export * from './media-meta';
export * from './playback';
export * from './stem-audio';
export * from './film-assets';
export * from './film-basics';
export * from './film-speech';
export * from './film-doc';
export * from './film-ref';
export * from './film-frame';
export * from './film-subtitle';
export * from './film-audio';
export * from './film-export';
export * from './audio-tags';
export * from './edit-region';
export * from './subtitle-overlay';
export * from './time-stretch';
export * from './mg-preview-security';
export * from './shell-output';
