/**
 * muspark - declare the structure of a piece of music in code.
 *
 * This entry point is pure computation only: score types, music-theory conversions, pattern generators, voice definitions.
 * It never touches the file system or produces audio, so it can be bundled into the browser alongside scene code
 * and called directly while writing a score. To render audio, use `muspark/server`.
 *
 * Three ways of producing sound share one score format:
 * - instrument is one of the 19 oscillator voices, with waveforms computed on the fly, keeping the sharp edges of square and saw waves intact
 * - instrument is a name from the GM sample bank, playing real instrument recordings (piano, strings, brass...)
 * - voice is a chiptune voice name or a VoiceSpec, rendered by the built-in synthesizer
 *
 * The first two share many names, so the channel's bank tells them apart; without a bank, those 19 names use the oscillators.
 */

// ── Score DSL ──
export type {
  AutomationPoint,
  Channel,
  ChannelBase,
  MelodyChannel,
  ChannelEffects,
  Chord,
  DelaySpec,
  DrumChannel,
  DrumHit,
  DrumName,
  InstrumentName,
  Note,
  Pitch,
  Score,
  SynthBank,
  SynthInstrumentName,
  TabEvent,
  Tablature,
  VoiceRef,
  VoiceSpec,
} from './score/types';

// ── Music theory ──
export {
  PROGRESSIONS,
  chordRoot,
  diatonicChords,
  hzOf,
  midiOf,
  nameOf,
  namedProgression,
  parseChord,
  parseKey,
  pitchClassOf,
  progression,
  scaleNotes,
  transposeOctave,
  voiceChord,
  type ParsedChord,
  type ProgressionName,
  type VoicingOptions,
} from './score/theory';

// ── Pattern generators ──
export {
  DRUM_TEMPLATES,
  arpeggio,
  bassLine,
  blockChord,
  drumPattern,
  layChords,
  line,
  repeat,
  seq,
  shift,
  stack,
  transpose,
  type ChordSpan,
} from './score/patterns';

// ── Voices ──
export {
  CHIPTUNE_DRUMS,
  CHIPTUNE_VOICES,
  CHIPTUNE_VOICE_NAMES,
  type ChiptuneDrumName,
  type ChiptuneVoiceName,
} from './synth/chiptune';

export {
  BUILTIN_DRUMS as INSTRUMENT_DRUMS,
  BUILTIN_INSTRUMENTS as INSTRUMENTS,
  isBuiltinDrum,
  isBuiltinInstrument,
} from './synth/voices';

// ── Sampled voice tables (pure data; only rendering needs the sound bank file) ──
export {
  SAMPLED_DRUMS,
  SAMPLED_FAMILIES,
  SAMPLED_INSTRUMENTS,
  type SampledDrum,
  type SampledInstrument,
} from './sampled/instruments';

export {
  drumAvailable,
  instrumentAvailable,
  isSampledDrum,
  isSampledInstrument,
  resolveDrumBank,
  resolveInstrumentBank,
} from './bank';

export type { Adsr, WaveName } from './synth/dsp';
export type { FilterSpec, OscillatorSpec, VibratoSpec } from './synth/voice';

// ── WAV encoding (pure computation: just lays out Float32Array as 16-bit PCM bytes, no platform APIs) ──
export { encodeWavStereo } from './wav';

// ── Score -> sound events (pure computation, intermediate output before rendering) ──
export { compileScore, scoreToSynthEvents, type ScoreRenderPlan } from './synth/from-score';
export { validateScore, scoreDuration, scoreTime, DEFAULT_SCORE_TAIL_SEC } from './score/validate';
export const SCORE_RENDERER_VERSION = 'muspark-score-1';
export type { SynthDrumEvent, SynthEvent, SynthToneEvent, SynthAutomationPoint } from './synth/event';
