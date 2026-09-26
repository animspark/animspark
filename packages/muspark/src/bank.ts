/**
 * Backend selection: whether a voice name goes to the oscillators or to samples.
 *
 * The two voice tables share many names - every one of the 19 oscillator voice names also exists in the GM table.
 * So the name alone can't decide, and the rule is:
 *
 *   1. If the channel explicitly sets bank, use it
 *   2. If the channel gives a voice (chiptune or custom), only the oscillators can synthesize it, so use synth
 *   3. If the name is one of the 19 oscillator voices -> synth
 *   4. Otherwise the name can only come from the GM table -> sampled
 *
 * Without a bank, built-in voices work directly with no sound bank download. For sampled piano, set bank: 'sampled' explicitly.
 * validateScore checks that the chosen backend actually provides the voice; unknown names are never silently substituted.
 */
import { SAMPLED_DRUM_NOTES, SAMPLED_PATCHES } from './sampled/instruments';
import { isBuiltinDrum, isBuiltinInstrument } from './synth/voices';
import type { SynthBank } from './synth/event';

/** Whether the name is a GM sampled instrument. */
export function isSampledInstrument(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SAMPLED_PATCHES, name);
}

/** Whether the name is a GM sampled percussion piece. */
export function isSampledDrum(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SAMPLED_DRUM_NOTES, name);
}

/** Resolve which backend a melodic channel should use. */
export function resolveInstrumentBank(
  instrument: string,
  explicit: SynthBank | undefined,
  hasVoice: boolean,
): SynthBank {
  if (hasVoice) return 'synth';
  if (explicit) return explicit;
  if (isBuiltinInstrument(instrument)) return 'synth';
  return isSampledInstrument(instrument) ? 'sampled' : 'synth';
}

/** Resolve which backend a drum channel should use. */
export function resolveDrumBank(
  drum: string,
  explicit: SynthBank | undefined,
  hasVoice: boolean,
): SynthBank {
  if (hasVoice) return 'synth';
  if (explicit) return explicit;
  if (isBuiltinDrum(drum)) return 'synth';
  return isSampledDrum(drum) ? 'sampled' : 'synth';
}

/** Whether an instrument name is available on the given backend. */
export function instrumentAvailable(name: string, bank: SynthBank): boolean {
  return bank === 'sampled' ? isSampledInstrument(name) : isBuiltinInstrument(name);
}

/** Whether a drum piece name is available on the given backend. */
export function drumAvailable(name: string, bank: SynthBank): boolean {
  return bank === 'sampled' ? isSampledDrum(name) : isBuiltinDrum(name);
}
