/**
 * Built-in oscillator voices and synthesized drums.
 *
 * Waveforms, envelopes and deterministic noise together make up this set of basic voices that need no sound bank.
 * Chiptune presets are in chiptune.ts; the custom synth declaration is in voice.ts.
 */
import { clamp, hashNoise, makeOnePoleHighpass, polyBlep, releaseEnvelope } from './dsp';

/** The 19 built-in instruments. */
export const BUILTIN_INSTRUMENTS = [
  'piano', 'electric-piano', 'organ', 'guitar', 'bass', 'violin', 'cello',
  'strings', 'brass', 'saxophone', 'clarinet', 'marimba', 'synth-pad',
  'synth-lead', 'synth-bass', 'pluck', 'bell', 'flute', 'choir',
] as const;

export type BuiltinInstrument = typeof BUILTIN_INSTRUMENTS[number];

/** The 9 built-in percussion pieces. */
export const BUILTIN_DRUMS = [
  'kick', 'snare', 'closed-hat', 'open-hat', 'clap', 'tom', 'ride', 'crash', 'shaker',
] as const;

export type BuiltinDrum = typeof BUILTIN_DRUMS[number];

const BUILTIN_INSTRUMENT_SET = new Set<string>(BUILTIN_INSTRUMENTS);
const BUILTIN_DRUM_SET = new Set<string>(BUILTIN_DRUMS);

export function isBuiltinInstrument(name: string): name is BuiltinInstrument {
  return BUILTIN_INSTRUMENT_SET.has(name);
}

export function isBuiltinDrum(name: string): name is BuiltinDrum {
  return BUILTIN_DRUM_SET.has(name);
}

/**
 * The voice's value at a single sample.
 *
 * t is seconds since note on, duration is the note length (seconds), sampleIndex seeds the noise.
 * The return value is not yet multiplied by velocity or gain; the caller handles that.
 */
export function builtinToneSample(
  instrument: BuiltinInstrument,
  frequency: number,
  t: number,
  duration: number,
  sampleIndex: number,
  sampleRate: number,
): number {
  const phase = Math.PI * 2 * frequency * t;
  switch (instrument) {
    case 'piano': {
      const attack = Math.min(1, t / 0.008);
      const decay = 0.42 * Math.exp(-2.8 * t) + 0.18 * Math.exp(-0.55 * t);
      const tone = Math.sin(phase) + 0.42 * Math.sin(phase * 2.002) + 0.2 * Math.sin(phase * 3.01);
      const hammer = hashNoise(sampleIndex + Math.round(frequency * 17)) * Math.exp(-55 * t) * 0.12;
      return attack * decay * tone * releaseEnvelope(t, duration, 0.45) + hammer;
    }
    case 'electric-piano': {
      const attack = Math.min(1, t / 0.012);
      const tremolo = 0.9 + 0.1 * Math.sin(Math.PI * 2 * 4.8 * t);
      const tone = Math.sin(phase + 0.35 * Math.sin(phase * 2)) + 0.28 * Math.sin(phase * 2);
      return attack * tremolo * Math.exp(-0.72 * t) * tone * releaseEnvelope(t, duration, 0.65);
    }
    case 'organ': {
      const key = Math.min(1, t / 0.018);
      const drawbars = Math.sin(phase) + 0.55 * Math.sin(phase * 2) + 0.28 * Math.sin(phase * 3)
        + 0.16 * Math.sin(phase * 4) + 0.08 * Math.sin(phase * 6);
      const rotary = 0.88 + 0.12 * Math.sin(Math.PI * 2 * 5.7 * t);
      return key * rotary * drawbars * 0.42 * releaseEnvelope(t, duration, 0.32);
    }
    case 'guitar': {
      const attack = Math.min(1, t / 0.004);
      const body = Math.sin(phase) + 0.36 * Math.sin(phase * 2) + 0.18 * Math.sin(phase * 3);
      const pick = hashNoise(sampleIndex * 31 + Math.round(frequency)) * Math.exp(-45 * t) * 0.18;
      return attack * Math.exp(-3.1 * t) * body * releaseEnvelope(t, duration, 0.28) + pick;
    }
    case 'bass': {
      const attack = Math.min(1, t / 0.015);
      const body = Math.sin(phase) + 0.28 * Math.sin(phase * 2) + 0.08 * Math.sin(phase * 3);
      return attack * Math.exp(-1.18 * t) * body * releaseEnvelope(t, duration, 0.35);
    }
    case 'violin': {
      const attack = Math.min(1, t / 0.11);
      const vibrato = phase * (1 + 0.0035 * Math.sin(Math.PI * 2 * 5.6 * t));
      const bow = Math.sin(vibrato) + 0.48 * Math.sin(vibrato * 2) + 0.31 * Math.sin(vibrato * 3)
        + 0.18 * Math.sin(vibrato * 4);
      return attack * bow * 0.42 * releaseEnvelope(t, duration, 0.72);
    }
    case 'cello': {
      const attack = Math.min(1, t / 0.16);
      const vibrato = phase * (1 + 0.0028 * Math.sin(Math.PI * 2 * 4.9 * t));
      const body = Math.sin(vibrato) + 0.4 * Math.sin(vibrato * 2) + 0.24 * Math.sin(vibrato * 3);
      return attack * body * 0.5 * releaseEnvelope(t, duration, 0.9);
    }
    case 'strings': {
      const attack = Math.min(1, t / 0.18);
      const vibratoPhase = Math.PI * 2 * frequency * t * (1 + 0.0025 * Math.sin(Math.PI * 2 * 5.2 * t));
      const body = Math.sin(vibratoPhase) + 0.34 * Math.sin(vibratoPhase * 2) + 0.14 * Math.sin(vibratoPhase * 3);
      return attack * 0.52 * body * releaseEnvelope(t, duration, 0.85);
    }
    case 'brass': {
      const attack = Math.min(1, t / 0.07);
      const pressure = 1 + Math.min(1, t / 0.22) * 0.7;
      const body = Math.tanh(
        pressure * (Math.sin(phase) + 0.62 * Math.sin(phase * 2) + 0.35 * Math.sin(phase * 3)),
      );
      return attack * body * 0.58 * releaseEnvelope(t, duration, 0.48);
    }
    case 'saxophone': {
      const attack = Math.min(1, t / 0.055);
      const reed = Math.sin(phase + 0.18 * Math.sin(phase * 2))
        + 0.46 * Math.sin(phase * 2) + 0.22 * Math.sin(phase * 3);
      return attack * reed * 0.5 * releaseEnvelope(t, duration, 0.42);
    }
    case 'clarinet': {
      const attack = Math.min(1, t / 0.065);
      const odd = Math.sin(phase) + 0.42 * Math.sin(phase * 3) + 0.18 * Math.sin(phase * 5);
      return attack * odd * 0.55 * releaseEnvelope(t, duration, 0.48);
    }
    case 'marimba':
      return Math.min(1, t / 0.004) * Math.exp(-3.4 * t)
        * (Math.sin(phase) + 0.38 * Math.sin(phase * 3.96) + 0.14 * Math.sin(phase * 9.1))
        * releaseEnvelope(t, duration, 0.3);
    case 'synth-pad': {
      const attack = Math.min(1, t / 0.3);
      const body = Math.sin(phase) + 0.34 * Math.sin(phase * 2) + 0.2 * Math.sin(phase * 3)
        + 0.1 * Math.sin(phase * 4);
      return attack * 0.5 * body * releaseEnvelope(t, duration, 1.1);
    }
    case 'synth-lead': {
      const attack = Math.min(1, t / 0.008);
      const dt = Math.min(0.45, frequency / sampleRate);
      const ph = (frequency * t) % 1;
      const saw = 2 * ph - 1 - polyBlep(ph, dt);
      const ph2 = (ph + 0.5) % 1;
      const pulse = (ph < 0.5 ? 1 : -1) + polyBlep(ph, dt) - polyBlep(ph2, dt);
      return attack * (saw * 0.5 + pulse * 0.18 + Math.sin(phase) * 0.32)
        * 0.55 * releaseEnvelope(t, duration, 0.3);
    }
    case 'synth-bass': {
      const attack = Math.min(1, t / 0.01);
      const sub = Math.sin(phase) + 0.36 * Math.sin(phase * 0.5);
      return attack * Math.tanh(sub * 1.8) * 0.62 * releaseEnvelope(t, duration, 0.28);
    }
    case 'pluck':
      return Math.min(1, t / 0.003) * Math.exp(-5.2 * t)
        * (Math.sin(phase) + 0.38 * Math.sin(phase * 2.01) + 0.12 * Math.sin(phase * 4.02))
        * releaseEnvelope(t, duration, 0.2);
    case 'bell':
      return Math.min(1, t / 0.003) * Math.exp(-1.45 * t)
        * (Math.sin(phase) + 0.52 * Math.sin(phase * 2.71) + 0.24 * Math.sin(phase * 4.08))
        * releaseEnvelope(t, duration, 0.8);
    case 'flute': {
      const attack = Math.min(1, t / 0.08);
      const vibrato = Math.sin(Math.PI * 2 * frequency * t + 0.03 * Math.sin(Math.PI * 2 * 5.5 * t));
      return attack * (vibrato + 0.08 * Math.sin(phase * 2)) * 0.72 * releaseEnvelope(t, duration, 0.45);
    }
    case 'choir': {
      const attack = Math.min(1, t / 0.24);
      const drift = 0.012 * Math.sin(Math.PI * 2 * 0.7 * t);
      const formants = Math.sin(phase + drift) + 0.34 * Math.sin(phase * 2.03)
        + 0.22 * Math.sin(phase * 3.98) + 0.12 * Math.sin(phase * 6.1);
      return attack * formants * 0.38 * releaseEnvelope(t, duration, 1.15);
    }
    default:
      return 0;
  }
}

/**
 * Percussion renderer factory.
 *
 * Noisy voices go through a highpass before shaping, avoiding the sandpaper feel of full-band white noise. Filters are stateful,
 * so every hit creates a new instance - the state depends only on this hit's sample sequence, so determinism is unaffected.
 */
export function makeBuiltinDrumRenderer(
  drum: BuiltinDrum,
  sampleRate: number,
): (t: number, sampleIndex: number, velocity: number) => number {
  const hp = drum === 'closed-hat' || drum === 'open-hat'
    ? makeOnePoleHighpass(6000, sampleRate)
    : drum === 'shaker'
      ? makeOnePoleHighpass(4000, sampleRate)
      : drum === 'crash'
        ? makeOnePoleHighpass(3000, sampleRate)
        : drum === 'ride'
          ? makeOnePoleHighpass(5000, sampleRate)
          : drum === 'snare' || drum === 'clap'
            ? makeOnePoleHighpass(1400, sampleRate)
            : null;

  return (t: number, sampleIndex: number, velocity: number): number => {
    const raw = hashNoise(sampleIndex * 101 + drum.length * 997);
    const noise = hp ? hp(raw) : raw;
    switch (drum) {
      case 'kick': {
        const frequency = 46 + 92 * Math.exp(-18 * t);
        return Math.sin(Math.PI * 2 * frequency * t) * Math.exp(-9 * t) * velocity;
      }
      case 'snare':
        return (noise * 0.95 + Math.sin(Math.PI * 2 * 185 * t) * 0.22) * Math.exp(-17 * t) * velocity;
      case 'closed-hat':
        return noise * Math.exp(-48 * t) * velocity * 0.72;
      case 'open-hat':
        return noise * Math.exp(-13 * t) * velocity * 0.62;
      case 'clap': {
        const bursts = Math.exp(-70 * t)
          + (t > 0.026 ? Math.exp(-70 * (t - 0.026)) : 0)
          + (t > 0.052 ? Math.exp(-60 * (t - 0.052)) : 0);
        return noise * bursts * velocity * 0.58;
      }
      case 'tom': {
        const frequency = 92 + 48 * Math.exp(-12 * t);
        return (Math.sin(Math.PI * 2 * frequency * t) * 0.8 + raw * 0.12)
          * Math.exp(-7 * t) * velocity;
      }
      case 'ride':
        return (
          Math.sin(Math.PI * 2 * 640 * t)
          + 0.55 * Math.sin(Math.PI * 2 * 931 * t)
          + noise * 0.5
        ) * Math.exp(-4.2 * t) * velocity * 0.28;
      case 'crash':
        return noise * (0.7 + 0.3 * Math.sin(Math.PI * 2 * 370 * t))
          * Math.exp(-3.2 * t) * velocity * 0.46;
      case 'shaker':
        return noise * Math.exp(-28 * t) * velocity * 0.5;
      default:
        return 0;
    }
  };
}

/** Render length (seconds) of each percussion piece; beyond it the waveform has decayed to inaudible. */
export function builtinDrumLengthSec(drum: BuiltinDrum): number {
  if (drum === 'crash' || drum === 'ride') return 1.8;
  if (drum === 'open-hat') return 0.7;
  if (drum === 'kick' || drum === 'tom') return 0.65;
  return 0.42;
}

/** Extra release tail length (seconds) of a note, by instrument family. */
export function builtinReleaseSec(instrument: BuiltinInstrument): number {
  if (instrument === 'synth-pad' || instrument === 'choir') return 1.15;
  if (instrument === 'strings' || instrument === 'violin' || instrument === 'cello') return 0.9;
  return 0.55;
}

export { clamp };
