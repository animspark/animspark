/**
 * Dual-backend mixing: renders oscillator voices and sampled voices together.
 *
 * With no sampled voices it calls renderSynthEvents directly and needs no sound bank.
 * A mixed score renders each side separately, sums them, then applies one peak limit.
 *
 * Platform-neutral: the caller supplies the sound bank, so this module (and the two
 * renderers downstream of it) runs unchanged in the browser.
 */
import type { BasicSoundBank } from 'spessasynth_core';
import { renderSynthEvents, SYNTH_SAMPLE_RATE, type SynthRenderResult } from './synth/render';
import { renderSampledEvents } from './sampled/render';
import type { SynthEvent } from './synth/event';

/** Peak limiter ceiling, same as the oscillator backend. */
const CEILING = 0.92;

/** Whether the event stream contains any sampled voices. */
export function hasSampledEvents(events: SynthEvent[]): boolean {
  return events.some((event) => event.bank === 'sampled');
}

export interface RenderEventsOptions {
  sampleRate?: number;
  /** A loaded GM sound bank. Required only when the event stream actually has sampled voices. */
  soundBank?: BasicSoundBank;
}

/**
 * Render an event stream; supports both backends.
 *
 * With no sampled voices the result is byte-identical to renderSynthEvents and no sound bank is needed.
 */
export async function renderEventsAsync(
  events: SynthEvent[],
  totalSec: number,
  options: RenderEventsOptions = {},
): Promise<SynthRenderResult> {
  const sampleRate = options.sampleRate ?? SYNTH_SAMPLE_RATE;
  if (!hasSampledEvents(events)) {
    return renderSynthEvents(events, totalSec, sampleRate);
  }
  if (!options.soundBank) {
    throw new Error(
      'The event stream has sampled voices, but no sound bank was provided.\n'
      + 'Node: await ensureSoundFont(), then use the muspark/server entry point; it loads the bank from disk itself.\n'
      + 'Browser: first await fetchSoundBank() or loadSoundBankBytes(), then pass the result in as soundBank.',
    );
  }

  const synthEvents = events.filter((event) => event.bank !== 'sampled');
  const sampledEvents = events.filter((event) => event.bank === 'sampled');

  const synth = renderSynthEvents(synthEvents, totalSec, sampleRate, { limit: false });
  const sampled = await renderSampledEvents(sampledEvents, totalSec, {
    soundBank: options.soundBank,
    sampleRate,
  });

  const { left, right } = synth;
  const frames = left.length;
  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    const l = left[i]! + (sampled.left[i] ?? 0);
    const r = right[i]! + (sampled.right[i] ?? 0);
    left[i] = l;
    right[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }

  const limited = peak > CEILING;
  if (limited) {
    const scale = CEILING / peak;
    for (let i = 0; i < frames; i += 1) {
      left[i] = left[i]! * scale;
      right[i] = right[i]! * scale;
    }
    peak = CEILING;
  }

  return {
    left,
    right,
    sampleRate,
    durationSec: synth.durationSec,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    eventCount: events.length,
    limited,
  };
}
