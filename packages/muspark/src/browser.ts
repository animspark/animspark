/**
 * muspark's browser entry point: renders a score to audio with no server.
 *
 * It shares the same render pipeline as `@muspark/core/server`: score compilation, oscillator
 * synthesis, SoundFont sampling, reverb, limiting and WAV encoding all use the same code, so both
 * sides produce byte-identical audio. The only difference is how the sound bank is obtained:
 * Node reads it from disk, this entry fetches it over the network and caches it.
 *
 * The sound bank is 32MB, too big to download on every page load. fetchSoundBank() goes through
 * the Cache API by default and sends no request on a hit; the caller should keep the parsed
 * BasicSoundBank in memory and reuse it (parsing takes ~28ms, it holds ~32MB) rather than
 * re-parsing on every render.
 *
 * Typical usage:
 *
 * ```ts
 * import { fetchSoundBank, renderScoreWavAsync, progression, layChords, arpeggio } from '@muspark/core/browser';
 *
 * const soundBank = await fetchSoundBank();          // 32MB the first time, cache hits after that
 * const wav = await renderScoreWavAsync(score, { soundBank });
 * const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
 * ```
 *
 * To play directly without writing a file, use renderScoreAsync() to get the left/right
 * Float32Arrays and copy them into the two channels of AudioContext.createBuffer(); this skips a
 * WAV encode/decode round trip.
 */
import { SoundBankLoader, type BasicSoundBank } from 'spessasynth_core';

import { hasSampledEvents, renderEventsAsync } from './mix';
import { compileScore } from './synth/from-score';
import { renderSynthEvents, SYNTH_SAMPLE_RATE } from './synth/render';
import { validateRenderScoreOptions } from './synth/render-size';
import { encodeWavStereo } from './wav';
import type { Score } from './score/types';
import type { SynthEvent } from './synth/event';
import type { SynthRenderResult } from './synth/render';

export { renderSynthEvents, renderReverbTail, SYNTH_SAMPLE_RATE } from './synth/render';
export type { SynthRenderResult } from './synth/render';

export { encodeWavStereo } from './wav';

export { hasSampledEvents, renderEventsAsync } from './mix';
export type { RenderEventsOptions } from './mix';

export {
  drumAvailable,
  instrumentAvailable,
  isSampledDrum,
  isSampledInstrument,
  resolveDrumBank,
  resolveInstrumentBank,
} from './bank';

export {
  DRUM_CHANNEL,
  SAMPLED_DRUMS,
  SAMPLED_FAMILIES,
  SAMPLED_INSTRUMENTS,
  patchOf,
  drumNoteOf,
} from './sampled/instruments';
export type { SampledDrum, SampledInstrument } from './sampled/instruments';

export { renderSampledEvents } from './sampled/render';
export type { SampledRenderOptions, SampledRenderResult } from './sampled/render';

export * from './index';

export type { BasicSoundBank };

/**
 * Default download URL for GeneralUser GS v2.
 *
 * Points at the author's own GitHub repository: his license explicitly asks people not to
 * hotlink the download on his personal site. In production, prefer your own CDN so you can set
 * CORS and long cache lifetimes without adding load upstream.
 */
export const DEFAULT_SOUNDFONT_URL =
  'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/684543d5e5efaef08d02be50dcda8d552478fa60/GeneralUser-GS.sf2';

/** Cache name used to store the sound bank in the Cache API. */
export const SOUNDFONT_CACHE_NAME = 'muspark-soundfont-v1';

/** Bounds for spotting corrupt or truncated downloads; not exact values. */
const MIN_BYTES = 20 * 1024 * 1024;
const MAX_BYTES = 64 * 1024 * 1024;

/** sf2 is a RIFF container whose header looks like "RIFF....sfbk". */
function looksLikeSoundFont(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MIN_BYTES || bytes.byteLength > MAX_BYTES) return false;
  const ascii = (start: number, end: number): string =>
    String.fromCharCode(...bytes.subarray(start, end));
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'sfbk';
}

/**
 * Parse a sound bank from bytes.
 *
 * Parsing takes ~28ms and the result holds ~32MB, so keep it and reuse it. Checks the RIFF/sfbk
 * magic so an HTML error page is not mistaken for a sound bank and then blows up inside
 * spessasynth with a cryptic error.
 */
export function loadSoundBankBytes(bytes: ArrayBuffer | Uint8Array): BasicSoundBank {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!looksLikeSoundFont(view)) {
    throw new Error(
      `These bytes are not a usable SoundFont: ${view.byteLength} bytes, RIFF/sfbk magic does not match.\n`
      + 'Check whether the download URL returned an error page or redirect HTML.',
    );
  }
  // Slice out a dedicated ArrayBuffer: spessasynth keeps hold of it, so it must not be a view into a larger buffer
  const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  return SoundBankLoader.fromArrayBuffer(buffer);
}

export interface FetchSoundBankOptions {
  /** Download URL; defaults to GeneralUser GS. */
  url?: string;
  /**
   * Cache the download with the Cache API; on by default.
   *
   * Turn it off when you manage caching yourself with IndexedDB, or when running somewhere without
   * `caches` (insecure contexts, some Workers). If `caches` is missing it silently falls back to a
   * plain download.
   */
  cache?: boolean;
  /** Cache name; defaults to SOUNDFONT_CACHE_NAME. */
  cacheName?: string;
  /** Download progress. Not called on a cache hit. */
  onProgress?: (info: { receivedBytes: number; totalBytes: number | null }) => void;
}

/**
 * Read all bytes of a Response, reporting progress along the way.
 *
 * The returned view owns its ArrayBuffer (offset 0, full length), so it can be written back to
 * the cache directly as a Response body without copying another 32MB.
 */
async function readAllBytes(
  response: Response,
  onProgress: FetchSoundBankOptions['onProgress'],
): Promise<Uint8Array<ArrayBuffer>> {
  const totalBytes = Number(response.headers.get('content-length')) || null;
  const reader = response.body?.getReader();
  if (!reader) {
    // No readable stream (e.g. some cache implementations): fall back to a single read
    return new Uint8Array(await response.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_BYTES) {
      throw new Error(`Failed to download the GM sound bank: exceeded the ${MAX_BYTES}-byte limit`);
    }
    onProgress?.({ receivedBytes, totalBytes });
  }

  const out = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetch and parse the GM sound bank.
 *
 * Checks the Cache API first and sends no network request on a hit; on a miss it downloads,
 * checks the magic and writes the result back to the cache. A failed check is not cached,
 * otherwise one bad download would be reused until the user cleared their cache.
 *
 * The 32MB size is a deployment trap: many static hosts (Cloudflare Pages and others) have a
 * per-file limit, so it will not fit in your own build output. That is why the default is an
 * external URL plus client-side caching rather than shipping it in the bundle.
 */
export async function fetchSoundBank(options: FetchSoundBankOptions = {}): Promise<BasicSoundBank> {
  const url = options.url?.trim() || DEFAULT_SOUNDFONT_URL;
  const wantCache = options.cache !== false && typeof caches !== 'undefined';
  const cacheName = options.cacheName || SOUNDFONT_CACHE_NAME;

  if (wantCache) {
    try {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(url);
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer());
        if (looksLikeSoundFont(bytes)) return loadSoundBankBytes(bytes);
        // The cached copy is bad: delete it and download again
        await cache.delete(url);
      }
    } catch {
      // An unavailable cache is not an error; carry on with the download
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download the GM sound bank: HTTP ${response.status} ${url}`);
  }
  const bytes = await readAllBytes(response, options.onProgress);
  const bank = loadSoundBankBytes(bytes);

  if (wantCache) {
    try {
      const cache = await caches.open(cacheName);
      await cache.put(url, new Response(bytes, {
        headers: { 'content-type': 'audio/x-soundfont', 'content-length': String(bytes.byteLength) },
      }));
    } catch {
      // A failed cache write (quota exceeded, etc.) does not affect this render
    }
  }
  return bank;
}

export interface RenderScoreOptions {
  sampleRate?: number;
  /** A parsed GM sound bank. Required only when the score actually has sampled voices. */
  soundBank?: BasicSoundBank;
}

export interface RenderScoreResult extends SynthRenderResult {
  wav: Uint8Array;
}

/** Guidance from the sync entry points when a score uses sampled instruments. */
function sampledNeedsAsync(): Error {
  return new Error(
    'This score uses sampled instruments (bank: \'sampled\' or a GM-only instrument name), which the sync entry points cannot render.\n'
    + 'Use renderScoreWavAsync() instead, and first await fetchSoundBank() to get the GM sound bank ready.',
  );
}

/**
 * Render a score. Supports oscillator voices only; throws if there are sampled voices.
 *
 * The oscillator-only path needs no sound bank, and so none of those 32MB: the page can make
 * sound on first paint. That is key to the "open it and hear it" experience; the sampled bank can
 * download in the background.
 */
export function renderScore(score: Score, options: RenderScoreOptions = {}): RenderScoreResult {
  validateRenderScoreOptions(options, 'soundBank');
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE;
  const { events, durationSec } = compileScore(score);
  if (hasSampledEvents(events)) throw sampledNeedsAsync();
  const result = renderSynthEvents(events, durationSec, sampleRate);
  return { ...result, wav: encodeWavStereo(result.left, result.right, sampleRate) };
}

/** Render a score and return WAV bytes. Supports oscillator voices only. */
export function renderScoreWav(score: Score, options: RenderScoreOptions = {}): Uint8Array {
  return renderScore(score, options).wav;
}

/**
 * Render a score; supports both oscillator and sampled voices.
 *
 * With no sampled voices the result is byte-identical to the sync version, since it goes through
 * the same render call.
 */
export async function renderScoreAsync(
  score: Score,
  options: RenderScoreOptions = {},
): Promise<RenderScoreResult> {
  validateRenderScoreOptions(options, 'soundBank');
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE;
  const { events, durationSec } = compileScore(score);
  const result = await renderEventsAsync(events, durationSec, {
    sampleRate,
    soundBank: options.soundBank,
  });
  return { ...result, wav: encodeWavStereo(result.left, result.right, sampleRate) };
}

/** Render a score and return WAV bytes; supports both backends. */
export async function renderScoreWavAsync(
  score: Score,
  options: RenderScoreOptions = {},
): Promise<Uint8Array> {
  return (await renderScoreAsync(score, options)).wav;
}
