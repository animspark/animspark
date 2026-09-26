/**
 * Basic DSP for oscillator synthesis.
 *
 * Everything is a pure function or a closure whose state depends only on its own sample sequence; no randomness or clocks,
 * so the same input reproduces byte for byte. These primitives serve the built-in voices,
 * chiptune and custom voices.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function midiHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * polyBLEP anti-aliasing correction.
 *
 * When the frequency doesn't divide the sample rate evenly, the hard jumps of saw/square waves produce aliasing - the
 * "digital harshness" of cheap soft synths. Adding a polynomial residual within one sample around each jump cancels it.
 * Chiptune voices depend on this especially: an uncorrected square wave smears into metallic noise in the high register.
 */
export function polyBlep(phase: number, dt: number): number {
  if (phase < dt) {
    const x = phase / dt;
    return x + x - x * x - 1;
  }
  if (phase > 1 - dt) {
    const x = (phase - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** One-pole highpass, used to shape noise. Stateful; instantiate one per sound event. */
export function makeOnePoleHighpass(cutoffHz: number, sampleRate: number): (x: number) => number {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const a = rc / (rc + dt);
  let prevX = 0;
  let prevY = 0;
  return (x: number): number => {
    const y = a * (prevY + x - prevX);
    prevX = x;
    prevY = y;
    return y;
  };
}

/** One-pole lowpass, the basic tone-shaping tool of subtractive synthesis. */
export function makeOnePoleLowpass(cutoffHz: number, sampleRate: number): (x: number) => number {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const a = dt / (rc + dt);
  let prevY = 0;
  return (x: number): number => {
    prevY += a * (x - prevY);
    return prevY;
  };
}

/**
 * Two-pole resonant lowpass (Chamberlin state-variable filter).
 * A resonant sweep is the soul of acid bass and synth leads; a one-pole lowpass can't do it.
 */
export function makeResonantLowpass(
  cutoffHz: number,
  resonance: number,
  sampleRate: number,
): (x: number) => number {
  const f = 2 * Math.sin((Math.PI * clamp(cutoffHz, 20, sampleRate / 2.2)) / sampleRate);
  const q = 1 - clamp(resonance, 0, 0.95);
  let low = 0;
  let band = 0;
  return (x: number): number => {
    const high = x - low - q * band;
    band += f * high;
    low += f * band;
    return low;
  };
}

/** xorshift noise: deterministic output for a given seed, replacing Math.random. */
export function hashNoise(seed: number): number {
  let value = seed | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

/** Linear fade-out over release once the note's duration has elapsed. */
export function releaseEnvelope(t: number, duration: number, release: number): number {
  if (t < 0) return 0;
  if (t <= duration) return 1;
  return clamp(1 - (t - duration) / release, 0, 1);
}

/** Standard ADSR envelope. */
export interface Adsr {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export function adsrAt(env: Adsr, t: number, duration: number): number {
  if (t < 0) return 0;
  if (t < env.attack) return env.attack > 0 ? t / env.attack : 1;
  if (t < env.attack + env.decay) {
    const progress = env.decay > 0 ? (t - env.attack) / env.decay : 1;
    return 1 + (env.sustain - 1) * progress;
  }
  if (t <= duration) return env.sustain;
  const releaseProgress = env.release > 0 ? (t - duration) / env.release : 1;
  return clamp(env.sustain * (1 - releaseProgress), 0, 1);
}

// ── Waveforms ──

export type WaveName = 'sine' | 'triangle' | 'saw' | 'square' | 'pulse' | 'noise';

/**
 * Get a waveform's value at a given phase.
 *
 * phase is the normalized phase in 0-1; dt is the phase increment per sample (used by polyBLEP).
 * pulseWidth only matters for pulse: 0.5 equals a square wave, and the further from 0.5 the thinner and sharper the tone;
 * this is how the NES's three duty-cycle settings are made.
 */
export function waveAt(
  wave: WaveName,
  phase: number,
  dt: number,
  sampleIndex: number,
  pulseWidth = 0.5,
): number {
  switch (wave) {
    case 'sine':
      return Math.sin(Math.PI * 2 * phase);
    case 'triangle':
      // The triangle wave's harmonics fall off quickly; it's the voice of the NES bass part
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'saw':
      return 2 * phase - 1 - polyBlep(phase, dt);
    case 'square': {
      const shifted = (phase + 0.5) % 1;
      return (phase < 0.5 ? 1 : -1) + polyBlep(phase, dt) - polyBlep(shifted, dt);
    }
    case 'pulse': {
      const width = clamp(pulseWidth, 0.02, 0.98);
      const shifted = (phase + (1 - width)) % 1;
      return (phase < width ? 1 : -1) + polyBlep(phase, dt) - polyBlep(shifted, dt);
    }
    case 'noise':
      return hashNoise(sampleIndex * 2654435761);
    default:
      return 0;
  }
}
