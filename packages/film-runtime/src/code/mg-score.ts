import { scoreDuration, validateScore, type Score } from '@muspark/core';
import { sha256 } from '@noble/hashes/sha256';
import type { FilmAssetIndex } from './doc';

/** Stable identity shared by metadata evaluation, the host and browser playback. */
export function mgScoreJson(score: Score): string {
  return JSON.stringify(validateScore(score), (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

export function mgScoreSrc(score: Score): string {
  // ASCII JSON also works in the metadata VM, which deliberately has no host TextEncoder.
  const json = mgScoreJson(score).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const bytes = Uint8Array.from(json, char => char.charCodeAt(0));
  const hash = Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  return `assets/audio/music/score-${hash}.wav`;
}

/** Resolve authored score module paths to the same audio bytes used by MG sounds. */
export function filmScoreAssets(scores: Readonly<Record<string, Score>>): FilmAssetIndex {
  return Object.fromEntries(Object.entries(scores).map(([module, score]) => {
    try {
      return [module, { src: mgScoreSrc(score), dur: scoreDuration(score), kind: 'audio',
        title: module.split('/').at(-1)?.replace(/\.[^.]+$/, '') }];
    } catch (cause) {
      throw new Error(`${module}: default export must be a valid Muspark Score. ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }));
}
