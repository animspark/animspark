/**
 * The film layer: the entry point used by `@animspark/runtime`.
 *
 * The runtime bundles this into the iframe's host.js. Only the modules a film actually
 * needs are re-exported here, bypassing the root barrel, so the frontend bundle carries
 * just these.
 */

export * from './film-assets';
export * from './film-basics';
export * from './film-speech';
export * from './film-doc';
export * from './film-ref';
export * from './film-subtitle';
export * from './audio-tags';
