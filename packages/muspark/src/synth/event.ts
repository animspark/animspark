/**
 * Sound events - the contract between "compiling the score" and "rendering audio".
 *
 * They live in their own file so the browser side can import these types too: score compilation is pure computation,
 * and both renderers share the event stream.
 */
import type { VoiceSpec } from './voice';

export interface SynthDelay {
  /** Delay time, in beats. */
  timeBeats?: number;
  /** Feedback amount, 0-0.85. */
  feedback?: number;
  /** Wet signal ratio, 0-1. */
  mix?: number;
}

export interface SynthEffects {
  /** Soft-clipping drive, 0-1. */
  drive?: number;
  delay?: SynthDelay;
  /** Reverb send, 0-1. */
  reverb?: number;
}

/** The voice reference the render loop needs: the VoiceSpec declared in the score plus its release tail length. */
export interface VoiceRenderer {
  spec: VoiceSpec;
  releaseSec: number;
}

/**
 * Sound backend.
 *
 * synth is oscillator synthesis with waveforms computed on the fly, keeping the sharp edges of square and saw waves intact; electronic music and chiptune rely on it.
 * sampled plays real recordings from the GM sound bank; acoustic instruments like piano, strings and brass rely on it.
 * Low-level events default to synth; score compilation always marks the actual backend.
 */
export type SynthBank = 'synth' | 'sampled';

/** Complete channel mixer state at an absolute time in the score, interpolated in dB and pan. */
export interface SynthAutomationPoint {
  timeSec: number;
  gainDb: number;
  pan: number;
}

/** A sound event; gain is the precomputed linear gain. */
export interface SynthToneEvent {
  kind: 'tone';
  startSec: number;
  /** Channel the event belongs to, so the visual side can highlight by channel. */
  channelId?: string;
  /** Beat position of the event in the score, so the visual side can align to the beat grid. */
  beat?: number;
  durationSec: number;
  midi: number;
  velocity: number;
  gain: number;
  pan: number;
  bpm: number;
  effects?: SynthEffects;
  automation?: SynthAutomationPoint[];
  /** Instrument name; the synth backend looks it up among the 19 built-in voices, the sampled backend in the GM table. */
  instrument: string;
  /** Sound backend; defaults to synth. */
  bank?: SynthBank;
  /** Custom voice; if given it is used, otherwise instrument is looked up in the built-in voice table. Synth backend only. */
  voice?: VoiceRenderer;
}

export interface SynthDrumEvent {
  kind: 'drum';
  startSec: number;
  channelId?: string;
  beat?: number;
  drum: string;
  velocity: number;
  gain: number;
  pan: number;
  bpm: number;
  effects?: SynthEffects;
  automation?: SynthAutomationPoint[];
  /** Sound backend; defaults to synth. */
  bank?: SynthBank;
  /** Custom percussion render function. Synth backend only. */
  voice?: (t: number, sampleIndex: number, velocity: number) => number;
  /** Render length (seconds) of the custom percussion. */
  lengthSec?: number;
}

export type SynthEvent = SynthToneEvent | SynthDrumEvent;
