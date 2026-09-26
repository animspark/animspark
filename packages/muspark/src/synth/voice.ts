/**
 * Custom voices: a declarative subtractive synthesizer.
 *
 * A voice = several summed oscillators -> filter -> envelope. This is the classic hardware synth architecture,
 * and it is also the ceiling of customization: authors no longer pick from a fixed voice table, they describe how the sound is built.
 *
 * Filters have internal state, so every note gets its own instance from instantiateVoice;
 * the state depends only on this note's sample sequence, so determinism is unaffected.
 */
import {
  adsrAt,
  clamp,
  makeOnePoleHighpass,
  makeResonantLowpass,
  waveAt,
  type Adsr,
  type WaveName,
} from './dsp';
import type { VoiceRenderer } from './event';

export interface OscillatorSpec {
  wave: WaveName;
  /** Share of the sum this oscillator contributes; defaults to 1. */
  gain?: number;
  /** Multiple of the fundamental frequency; 2 is an octave up. Defaults to 1. */
  ratio?: number;
  /** Detune in cents (100 cents = 1 semitone). Two slightly detuned oscillators beat against each other and thicken the sound. */
  detuneCents?: number;
  /** Only applies to the pulse wave; 0.5 equals a square wave. */
  pulseWidth?: number;
  /** Phase offset 0-1, used to stagger oscillator start points. */
  phase?: number;
}

export interface FilterSpec {
  type: 'lowpass' | 'highpass';
  /** Cutoff frequency (Hz). */
  cutoff: number;
  /** Resonance 0-0.95; higher is sharper. Lowpass only. */
  resonance?: number;
  /**
   * How much the envelope modulates the cutoff (Hz).
   * A positive value opens the filter at the attack and closes it as the envelope falls - the source of the synth "wah".
   */
  envAmount?: number;
}

export interface VibratoSpec {
  /** Vibrato rate (Hz). */
  rate: number;
  /** Vibrato depth (cents). */
  depthCents: number;
  /** Vibrato onset delay (seconds), mimicking a player easing into vibrato. */
  delaySec?: number;
}

export interface VoiceSpec {
  oscillators: OscillatorSpec[];
  envelope?: Partial<Adsr>;
  filter?: FilterSpec;
  vibrato?: VibratoSpec;
  /** Overall volume scale; defaults to 1. */
  gain?: number;
  /** Waveshaping drive 0-1: soft clipping at the voice level. */
  drive?: number;
  /**
   * Bit crushing: quantizes sample values to 2^bits steps.
   * Below 8, quantization noise becomes obvious - the source of the lo-fi and chiptune flavor.
   */
  bitCrush?: number;
  /** Sample-rate reduction: update the output only every n samples, for the grit of a vintage sampler. */
  sampleReduce?: number;
}

const DEFAULT_ENVELOPE: Adsr = { attack: 0.005, decay: 0.1, sustain: 0.8, release: 0.3 };

export interface VoiceInstance {
  releaseSec: number;
  sample(
    frequency: number,
    t: number,
    duration: number,
    sampleIndex: number,
    sampleRate: number,
  ): number;
}

function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

/** Create an independent voice instance for one note (with its own filter state). */
export function instantiateVoice(spec: VoiceSpec, sampleRate: number): VoiceInstance {
  const env: Adsr = { ...DEFAULT_ENVELOPE, ...spec.envelope };
  const oscillators = spec.oscillators.length ? spec.oscillators : [{ wave: 'sine' as const }];
  const totalGain = oscillators.reduce((sum, osc) => sum + (osc.gain ?? 1), 0) || 1;
  const masterGain = spec.gain ?? 1;

  // Stateful parts are created per instance
  const filter = spec.filter
    ? spec.filter.type === 'lowpass'
      ? makeResonantLowpass(spec.filter.cutoff, spec.filter.resonance ?? 0, sampleRate)
      : makeOnePoleHighpass(spec.filter.cutoff, sampleRate)
    : null;
  // The resonant lowpass cutoff can't change per sample (it would break state continuity),
  // so envelope modulation avoids rebuilding the filter: a second lowpass is used as an approximation
  const envFilter = spec.filter?.envAmount
    ? makeResonantLowpass(
        clamp(spec.filter.cutoff + spec.filter.envAmount, 20, sampleRate / 2.2),
        spec.filter.resonance ?? 0,
        sampleRate,
      )
    : null;

  const bitLevels = spec.bitCrush ? Math.pow(2, clamp(spec.bitCrush, 1, 16)) : 0;
  const reduce = spec.sampleReduce && spec.sampleReduce > 1 ? Math.round(spec.sampleReduce) : 0;
  let heldSample = 0;

  return {
    releaseSec: env.release,
    sample(frequency, t, duration, sampleIndex, rate) {
      if (reduce && sampleIndex % reduce !== 0) return heldSample;

      let vibratoRatio = 1;
      if (spec.vibrato) {
        const delay = spec.vibrato.delaySec ?? 0;
        const active = t > delay ? Math.min(1, (t - delay) / 0.3) : 0;
        vibratoRatio = centsToRatio(
          spec.vibrato.depthCents * active * Math.sin(Math.PI * 2 * spec.vibrato.rate * t),
        );
      }

      let sum = 0;
      for (const osc of oscillators) {
        const oscFreq = frequency * (osc.ratio ?? 1) * centsToRatio(osc.detuneCents ?? 0) * vibratoRatio;
        const dt = Math.min(0.45, oscFreq / rate);
        const phase = ((oscFreq * t + (osc.phase ?? 0)) % 1 + 1) % 1;
        sum += waveAt(osc.wave, phase, dt, sampleIndex, osc.pulseWidth) * (osc.gain ?? 1);
      }
      let value = sum / totalGain;

      const amplitude = adsrAt(env, t, duration);

      if (filter) {
        // The stronger the envelope at this instant, the more we lean toward the more-open filter, approximating cutoff following the envelope
        const filtered = filter(value);
        value = envFilter ? filtered * (1 - amplitude) + envFilter(value) * amplitude : filtered;
      }

      value *= amplitude * masterGain;

      if (spec.drive) {
        const gain = 1 + clamp(spec.drive, 0, 1) * 8;
        value = Math.tanh(value * gain) / Math.tanh(gain);
      }
      if (bitLevels) {
        value = Math.round(value * bitLevels) / bitLevels;
      }

      heldSample = value;
      return value;
    },
  };
}

export function toVoiceRenderer(spec: VoiceSpec): VoiceRenderer {
  return {
    spec,
    releaseSec: spec.envelope?.release ?? DEFAULT_ENVELOPE.release,
  };
}
