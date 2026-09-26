/**
 * Retro chiptune voice library.
 *
 * Old game consoles had a few fixed oscillators; timbre came from duty cycle, envelopes and
 * arpeggio tricks. These presets follow each machine's actual sound hardware:
 *
 * - NES (2A03): two pulse channels (duty 12.5 / 25 / 50 / 75%), one triangle, one noise
 * - Game Boy (DMG): two pulse + one wavetable + one noise, overall more muffled than the NES
 * - C64 (SID): three oscillators, each saw/triangle/pulse/noise, plus a resonant filter that can self-oscillate
 *
 * There are also 80s synth styles (synthwave): not chip sound sources, but still oscillator
 * synthesis, getting their thickness from detuned oscillator stacks and resonant filtering.
 */
import type { VoiceSpec } from './voice';

/** Pulse duty cycles: the further from 0.5, the thinner and sharper the sound. */
const DUTY = {
  eighth: 0.125,
  quarter: 0.25,
  half: 0.5,
} as const;

export const CHIPTUNE_VOICES = {
  // ── NES ──
  /** 12.5% duty, the thinnest and sharpest; common for lead melodies. */
  'nes-pulse-12': {
    oscillators: [{ wave: 'pulse', pulseWidth: DUTY.eighth }],
    // Chip sound sources have no analog envelope; attack and release are instant
    envelope: { attack: 0.001, decay: 0.02, sustain: 0.9, release: 0.04 },
    gain: 0.5,
  },
  /** 25% duty, the most common NES lead sound. */
  'nes-pulse-25': {
    oscillators: [{ wave: 'pulse', pulseWidth: DUTY.quarter }],
    envelope: { attack: 0.001, decay: 0.02, sustain: 0.9, release: 0.04 },
    gain: 0.5,
  },
  /** 50% square, the fullest; common for counter-melodies or bass. */
  'nes-pulse-50': {
    oscillators: [{ wave: 'square' }],
    envelope: { attack: 0.001, decay: 0.02, sustain: 0.9, release: 0.04 },
    gain: 0.45,
  },
  /** Triangle channel, which carries all NES bass; its fixed volume is a hardware limit. */
  'nes-triangle': {
    oscillators: [{ wave: 'triangle' }],
    envelope: { attack: 0.001, decay: 0.01, sustain: 1, release: 0.02 },
    // 4-bit quantization: the NES triangle has only 16 steps, and that stepped edge is its signature
    bitCrush: 4,
    gain: 0.7,
  },
  /** Noise channel, for percussion and sound effects. */
  'nes-noise': {
    oscillators: [{ wave: 'noise' }],
    envelope: { attack: 0.001, decay: 0.06, sustain: 0.2, release: 0.05 },
    gain: 0.35,
  },
  /** A decaying pulse, imitating the hardware envelope sweeping down. */
  'nes-pluck': {
    oscillators: [{ wave: 'pulse', pulseWidth: DUTY.quarter }],
    envelope: { attack: 0.001, decay: 0.14, sustain: 0.15, release: 0.08 },
    gain: 0.5,
  },
  /** Two detuned pulses stacked: the chiptune trick of thickening a sound with two channels. */
  'nes-fat-lead': {
    oscillators: [
      { wave: 'pulse', pulseWidth: DUTY.quarter },
      { wave: 'pulse', pulseWidth: DUTY.eighth, detuneCents: 12 },
    ],
    envelope: { attack: 0.002, decay: 0.05, sustain: 0.85, release: 0.06 },
    gain: 0.42,
  },

  // ── Game Boy ──
  /** DMG lead, slightly duller than the NES, with a touch of low-pass. */
  'gb-lead': {
    oscillators: [{ wave: 'pulse', pulseWidth: DUTY.quarter }],
    envelope: { attack: 0.001, decay: 0.04, sustain: 0.8, release: 0.05 },
    filter: { type: 'lowpass', cutoff: 6000, resonance: 0.1 },
    bitCrush: 4,
    gain: 0.5,
  },
  /** DMG bass, a square wave with a falling envelope. */
  'gb-bass': {
    oscillators: [{ wave: 'square' }, { wave: 'triangle', ratio: 0.5, gain: 0.6 }],
    envelope: { attack: 0.001, decay: 0.08, sustain: 0.7, release: 0.05 },
    filter: { type: 'lowpass', cutoff: 1800 },
    bitCrush: 4,
    gain: 0.55,
  },
  /** Wavetable channel approximation: stacked harmonics, then requantized. */
  'gb-wave': {
    oscillators: [
      { wave: 'triangle' },
      { wave: 'square', ratio: 2, gain: 0.3 },
      { wave: 'sine', ratio: 3, gain: 0.15 },
    ],
    envelope: { attack: 0.002, decay: 0.05, sustain: 0.85, release: 0.06 },
    bitCrush: 4,
    sampleReduce: 2,
    gain: 0.45,
  },

  // ── C64 SID ──
  /** SID lead: a saw through a resonant low-pass, its most recognizable sound. */
  'sid-lead': {
    oscillators: [{ wave: 'saw' }, { wave: 'pulse', pulseWidth: 0.3, detuneCents: 7, gain: 0.7 }],
    envelope: { attack: 0.002, decay: 0.12, sustain: 0.7, release: 0.1 },
    filter: { type: 'lowpass', cutoff: 1400, resonance: 0.72, envAmount: 3200 },
    gain: 0.42,
  },
  /** SID bass: a pulse wave with deep filtering. */
  'sid-bass': {
    oscillators: [{ wave: 'pulse', pulseWidth: 0.42 }, { wave: 'saw', ratio: 0.5, gain: 0.5 }],
    envelope: { attack: 0.001, decay: 0.1, sustain: 0.65, release: 0.08 },
    filter: { type: 'lowpass', cutoff: 700, resonance: 0.55, envAmount: 900 },
    gain: 0.55,
  },

  // ── 80s synths ──
  /** synthwave bass: saw plus a sub-octave sine, with resonant filtering for a round low end. */
  'synthwave-bass': {
    oscillators: [
      { wave: 'saw' },
      { wave: 'saw', detuneCents: -8, gain: 0.8 },
      { wave: 'sine', ratio: 0.5, gain: 0.9 },
    ],
    envelope: { attack: 0.004, decay: 0.18, sustain: 0.72, release: 0.12 },
    filter: { type: 'lowpass', cutoff: 900, resonance: 0.35, envAmount: 1600 },
    drive: 0.22,
    gain: 0.5,
  },
  /** synthwave lead: three detuned saws, the classic supersaw recipe. */
  'synthwave-lead': {
    oscillators: [
      { wave: 'saw', detuneCents: -14 },
      { wave: 'saw' },
      { wave: 'saw', detuneCents: 14 },
      { wave: 'square', ratio: 2, gain: 0.25 },
    ],
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.75, release: 0.28 },
    filter: { type: 'lowpass', cutoff: 2600, resonance: 0.3, envAmount: 2400 },
    vibrato: { rate: 5.2, depthCents: 9, delaySec: 0.25 },
    // Three detuned saws partially cancel, so gain is boosted to hold up against the bass
    gain: 0.95,
  },
  /** Pad: a wide wall of saws with slow attack and release. */
  'synthwave-pad': {
    oscillators: [
      { wave: 'saw', detuneCents: -10 },
      { wave: 'saw', detuneCents: 10 },
      { wave: 'triangle', ratio: 2, gain: 0.4 },
    ],
    envelope: { attack: 0.5, decay: 0.6, sustain: 0.7, release: 1.2 },
    filter: { type: 'lowpass', cutoff: 1700, resonance: 0.2 },
    gain: 0.55,
  },
  /** Acid style: a high-resonance filter sweep; best with fast sequences. */
  'acid-bass': {
    oscillators: [{ wave: 'saw' }],
    envelope: { attack: 0.001, decay: 0.16, sustain: 0.25, release: 0.06 },
    filter: { type: 'lowpass', cutoff: 350, resonance: 0.92, envAmount: 3600 },
    drive: 0.42,
    gain: 0.5,
  },
  /** lo-fi: heavy quantization and downsampling for the texture of tape and old samplers. */
  'lofi-keys': {
    oscillators: [{ wave: 'triangle' }, { wave: 'sine', ratio: 2, gain: 0.35 }],
    envelope: { attack: 0.008, decay: 0.4, sustain: 0.35, release: 0.5 },
    filter: { type: 'lowpass', cutoff: 3200 },
    bitCrush: 6,
    sampleReduce: 3,
    gain: 0.5,
  },
} as const satisfies Record<string, VoiceSpec>;

export type ChiptuneVoiceName = keyof typeof CHIPTUNE_VOICES;

export const CHIPTUNE_VOICE_NAMES = Object.keys(CHIPTUNE_VOICES) as ChiptuneVoiceName[];

/** A built-in chiptune voice name, or a full custom voice spec. */
export type VoiceRef = ChiptuneVoiceName | VoiceSpec;

/** Voice name → voice spec; a spec is returned as is. A misspelled name throws right away instead of silently falling back to a plain oscillator. */
export function resolveVoice(ref: VoiceRef): VoiceSpec {
  if (typeof ref !== 'string') return ref;
  const preset = CHIPTUNE_VOICES[ref as ChiptuneVoiceName];
  if (!preset) {
    throw new Error(
      `Unknown built-in voice: ${ref}. Available: ${CHIPTUNE_VOICE_NAMES.join(', ')}, or pass a VoiceSpec directly.`,
    );
  }
  return preset as VoiceSpec;
}

/**
 * Chiptune percussion: old machines had no samples, so drums were made from the noise channel plus
 * envelopes. These are render functions that can be used directly on the drums channel.
 */
export const CHIPTUNE_DRUMS = {
  /** A fast-decaying burst gives the kick its thump; the low end is a quickly falling sine. */
  'chip-kick': {
    lengthSec: 0.3,
    render: (t: number, _i: number, velocity: number): number => {
      const frequency = 60 + 180 * Math.exp(-32 * t);
      return Math.sin(Math.PI * 2 * frequency * t) * Math.exp(-16 * t) * velocity;
    },
  },
  'chip-snare': {
    lengthSec: 0.24,
    render: (t: number, i: number, velocity: number): number => {
      let v = i | 0;
      v ^= v << 13; v ^= v >>> 17; v ^= v << 5;
      const noise = ((v >>> 0) / 0xffffffff) * 2 - 1;
      // Quantize to 3 bits for the coarse grain of chip noise
      const crushed = Math.round(noise * 8) / 8;
      return crushed * Math.exp(-26 * t) * velocity * 0.6;
    },
  },
  'chip-hat': {
    lengthSec: 0.1,
    render: (t: number, i: number, velocity: number): number => {
      let v = (i * 7919) | 0;
      v ^= v << 13; v ^= v >>> 17; v ^= v << 5;
      const noise = ((v >>> 0) / 0xffffffff) * 2 - 1;
      return Math.round(noise * 4) / 4 * Math.exp(-90 * t) * velocity * 0.35;
    },
  },
} as const;

export type ChiptuneDrumName = keyof typeof CHIPTUNE_DRUMS;
