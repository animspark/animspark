/**
 * The muspark score DSL.
 *
 * Musical events use beats. durationBeats declares the musical window;
 * tailSec declares the additional audible release window. One shape serves sound and visuals.
 */
import type { VoiceRef } from '../synth/chiptune';
import type { SampledDrum, SampledInstrument } from '../sampled/instruments';
import type { SynthBank } from '../synth/event';
import type { BuiltinDrum, BuiltinInstrument } from '../synth/voices';

export type { VoiceSpec } from '../synth/voice';
export type { SynthBank } from '../synth/event';

/** The 19 basic oscillator-synthesized voices. */
export type SynthInstrumentName = BuiltinInstrument;
/**
 * Instrument name: one of the 19 oscillator voices, or one of the 149 in the GM sample bank.
 *
 * The two tables share many names. Without a bank, the 19 oscillator voices use the oscillators and everything else uses samples;
 * to make a shared name like piano use the sampled recording instead, set bank: 'sampled' on the channel explicitly.
 */
export type InstrumentName = BuiltinInstrument | SampledInstrument;
/** Percussion name: the 9 basic drums + the chiptune kit + the GM sampled kit. */
export type DrumName = BuiltinDrum | 'chip-kick' | 'chip-snare' | 'chip-hat' | SampledDrum;

export type { VoiceRef } from '../synth/chiptune';

/** A note name such as 'C4' / 'F#5' / 'Bb3', or a MIDI pitch number directly. */
export type Pitch = string | number;

export interface Note {
  pitch: Pitch;
  /** Start beat. */
  beat: number;
  /** Duration, in beats. */
  duration: number;
  /** 0-1. */
  velocity?: number;
  /** Overrides the channel's instrument, for switching instruments within one channel. */
  instrument?: InstrumentName;
}

export interface Chord {
  /** Chord symbol: 'Cmaj7' / 'F#m7b5' / 'Dsus4'. */
  symbol: string;
  beat: number;
  duration: number;
  velocity?: number;
  /** Octave of the root; defaults to 4. */
  octave?: number;
  /** Inversion: 0 is root position, 1 is first inversion, and so on. */
  inversion?: number;
  /** Take only the first n chord tones, e.g. to reduce a seventh chord to a triad. */
  voices?: number;
  instrument?: InstrumentName;
}

export interface DrumHit {
  drum: DrumName;
  beat: number;
  velocity?: number;
}

/** A tablature event: string 1 to string 6, with a fret. */
export interface TabEvent {
  /** String number; 1 is the thinnest string. */
  string: number;
  fret: number;
  beat: number;
  duration: number;
  velocity?: number;
}

export interface Tablature {
  events: TabEvent[];
  /** Open-string pitches for strings 1 to 6; defaults to standard tuning E4 B3 G3 D3 A2 E2. */
  tuning?: Pitch[];
  instrument?: InstrumentName;
}

/** Channel-level automation of continuous parameters, linearly interpolated by beat. */
export interface AutomationPoint {
  beat: number;
  gainDb?: number;
  /** -1 hard left, 0 center, 1 hard right. */
  pan?: number;
}

export interface DelaySpec {
  /** Delay time, in beats (synced to bpm). */
  timeBeats?: number;
  /** Feedback amount, 0-0.85. */
  feedback?: number;
  /** Wet signal ratio, 0-1. */
  mix?: number;
}

export interface ChannelEffects {
  /** Soft-clipping drive, 0-1. */
  drive?: number;
  delay?: DelaySpec;
  /** Reverb send, 0-1. */
  reverb?: number;
}

export interface ChannelBase {
  id: string;
  label?: string;
  gainDb?: number;
  pan?: number;
  mute?: boolean;
  solo?: boolean;
  automation?: AutomationPoint[];
  effects?: ChannelEffects;
}

export interface MelodyChannel extends ChannelBase {
  instrument: InstrumentName;
  /**
   * Sound backend. By default it is inferred from the instrument name: the 19 oscillator voices use synth, everything else uses sampled.
   *
   * Only an explicit 'sampled' gets the sampled recordings of shared names like piano / strings / guitar;
   * with an explicit 'synth', the instrument name must belong to the oscillator voice table.
   */
  bank?: SynthBank;
  /**
   * Use the given synth voice instead of the built-in voice for instrument.
   *
   * This can be a chiptune voice name ('nes-pulse-25', 'synthwave-bass'...)
   * or a custom VoiceSpec. Once this field is set, instrument is only a semantic label,
   * and the oscillator backend is forced - sample playback can't produce custom voices.
   */
  voice?: VoiceRef;
  notes?: Note[];
  chords?: Chord[];
  tablature?: Tablature;
  hits?: never;
  kit?: never;
}

export interface DrumChannel extends ChannelBase {
  /** Chiptune drums synthesized on the noise channel. Omit for ordinary drums; bank then picks the backend. */
  kit?: 'chip';
  /**
   * Sound backend. By default it is inferred from the drum name: the 9 basic drums use synth, everything else uses sampled.
   * Set 'sampled' to get the 47 real recordings of the GM kit (including conga, timbale, cowbell, etc.).
   */
  bank?: SynthBank;
  hits: DrumHit[];
  instrument?: never;
  voice?: never;
  notes?: never;
  chords?: never;
  tablature?: never;
}

export type Channel = MelodyChannel | DrumChannel;

export interface Score {
  bpm: number;
  /** Positive musical length in beats, including intended rests. */
  durationBeats: number;
  /** Extra release/effect tail in seconds. Defaults to 0.4; 0 cuts exactly at the musical end. */
  tailSec?: number;
  /** Key, e.g. 'C major' / 'D minor', used to derive Roman-numeral chord degrees. */
  key?: string;
  /** Time signature; only used by the bar-conversion helpers, doesn't affect rendering. */
  timeSignature?: [number, number];
  channels: Channel[];
}
