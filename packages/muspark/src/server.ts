/**
 * muspark's Node entry point: renders a score to audio.
 *
 * The sync and async entry points differ only in the sampled backend:
 * - the sync ones render oscillator voices only and throw a clear error on sampled voices
 * - the async ones render both backends; the extra async comes from initializing the SoundFont synth
 *
 * Both are deterministic: the same input produces the same bytes, with no dependence on the
 * network, the clock or random numbers. The sampled backend needs the sound bank in place, so
 * await ensureSoundFont() first.
 */
import { hasSampledEvents, renderEventsAsync as renderEventsWithBank } from './mix';
import { loadSoundBank, loadSoundBankIf } from './sampled/soundfont';
import { renderSampledEvents as renderSampledWithBank } from './sampled/render';
import { compileScore } from './synth/from-score';
import { renderSynthEvents, SYNTH_SAMPLE_RATE } from './synth/render';
import { validateRenderScoreOptions } from './synth/render-size';
import { wavBufferStereo } from './wav-node';
import type { Score } from './score/types';
import type { SynthEvent } from './synth/event';
import type { SynthRenderResult } from './synth/render';
import type { RenderEventsOptions } from './mix';
import type { SampledRenderResult } from './sampled/render';

export { renderSynthEvents, renderReverbTail, SYNTH_SAMPLE_RATE } from './synth/render';
export type { SynthRenderResult } from './synth/render';

export { wavBufferStereo } from './wav-node';
export { encodeWavStereo } from './wav';

export { hasSampledEvents } from './mix';
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
  DEFAULT_SOUNDFONT,
  ensureSoundFont,
  loadSoundBank,
  loadSoundBankIf,
  soundfontDigest,
  soundfontPath,
  soundfontReady,
} from './sampled/soundfont';
export type { EnsureSoundFontOptions } from './sampled/soundfont';

export {
  DRUM_CHANNEL,
  SAMPLED_DRUMS,
  SAMPLED_FAMILIES,
  SAMPLED_INSTRUMENTS,
  patchOf,
  drumNoteOf,
} from './sampled/instruments';
export type { SampledDrum, SampledInstrument } from './sampled/instruments';

export type { SampledRenderOptions, SampledRenderResult } from './sampled/render';


export * from './index';

/** Node options for the event-level entry point: also accepts an sf2 path, saving the caller a manual load. */
export interface RenderEventsNodeOptions extends RenderEventsOptions {
  /** Path to the GM sound bank; defaults to soundfontPath()'s lookup order. Only used by sampled voices. */
  soundfont?: string;
}

/**
 * Render an event stream; supports both backends.
 *
 * The only difference from the platform-neutral version in mix.ts: this one accepts an sf2 path
 * and loads the sound bank from disk before passing it down. An explicit soundBank wins and the
 * path is ignored.
 */
export async function renderEventsAsync(
  events: SynthEvent[],
  totalSec: number,
  options: RenderEventsNodeOptions = {},
): Promise<SynthRenderResult> {
  return renderEventsWithBank(events, totalSec, {
    sampleRate: options.sampleRate,
    soundBank: options.soundBank ?? loadSoundBankIf(hasSampledEvents(events), options.soundfont),
  });
}

/** Render sampled voices only. As above, accepts an sf2 path. */
export async function renderSampledEvents(
  events: SynthEvent[],
  totalSec: number,
  options: RenderEventsNodeOptions = {},
): Promise<SampledRenderResult> {
  return renderSampledWithBank(events, totalSec, {
    sampleRate: options.sampleRate,
    soundBank: options.soundBank ?? loadSoundBank(options.soundfont),
  });
}

export interface RenderScoreOptions {
  sampleRate?: number;
  /** Path to the GM sound bank; defaults to soundfontPath()'s lookup order. Only used by sampled voices. */
  soundfont?: string;
}

export interface RenderScoreResult extends SynthRenderResult {
  wav: Buffer;
}

/** Guidance from the sync entry points when a score uses sampled instruments. */
function sampledNeedsAsync(): Error {
  return new Error(
    'This score uses sampled instruments (bank: \'sampled\' or a GM-only instrument name), which the sync entry points cannot render.\n'
    + 'Use renderScoreWavAsync() instead, '
    + 'and await ensureSoundFont() before rendering to get the GM sound bank ready.',
  );
}

/** Render a muspark score. Supports oscillator voices only; throws if there are sampled voices. */
export function renderScore(score: Score, options: RenderScoreOptions = {}): RenderScoreResult {
  validateRenderScoreOptions(options, 'soundfont');
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE;
  const { events, durationSec } = compileScore(score);
  if (hasSampledEvents(events)) throw sampledNeedsAsync();
  const result = renderSynthEvents(events, durationSec, sampleRate);
  return { ...result, wav: wavBufferStereo(result.left, result.right, sampleRate) };
}

/** Render a muspark score and return WAV bytes. Supports oscillator voices only. */
export function renderScoreWav(score: Score, options: RenderScoreOptions = {}): Buffer {
  return renderScore(score, options).wav;
}

/**
 * Render a muspark score; supports both oscillator and sampled voices.
 *
 * With no sampled voices the result is byte-identical to the sync version.
 */
export async function renderScoreAsync(
  score: Score,
  options: RenderScoreOptions = {},
): Promise<RenderScoreResult> {
  validateRenderScoreOptions(options, 'soundfont');
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE;
  const { events, durationSec } = compileScore(score);
  const result = await renderEventsAsync(events, durationSec, {
    sampleRate,
    soundfont: options.soundfont,
  });
  return { ...result, wav: wavBufferStereo(result.left, result.right, sampleRate) };
}

/** Render a muspark score and return WAV bytes; supports both backends. */
export async function renderScoreWavAsync(
  score: Score,
  options: RenderScoreOptions = {},
): Promise<Buffer> {
  return (await renderScoreAsync(score, options)).wav;
}
