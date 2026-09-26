import { instrumentAvailable, drumAvailable, resolveDrumBank, resolveInstrumentBank } from '../bank';
import { CHIPTUNE_DRUMS, CHIPTUNE_VOICE_NAMES } from '../synth/chiptune';
import { midiOf, parseKey, voiceChord } from './theory';
import type { Score } from './types';

export const DEFAULT_SCORE_TAIL_SEC = 0.4;
type ObjectValue = Record<string, unknown>;
function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function object(value: unknown, path: string, keys: readonly string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown field');
  return value as ObjectValue;
}
function number(value: unknown, path: string, min: number, max: number, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (positive && value <= 0)) {
    fail(path, `expected a finite number ${positive ? '>' : '≥'} ${min} and ≤ ${max}`);
  }
  return value;
}
function optionalNumber(obj: ObjectValue, key: string, path: string, min: number, max: number, positive = false) {
  if (obj[key] !== undefined) number(obj[key], `${path}.${key}`, min, max, positive);
}
function integer(value: unknown, path: string, min: number, max: number): number {
  const result = number(value, path, min, max);
  if (!Number.isInteger(result)) fail(path, 'expected an integer');
  return result;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length > 100_000) fail(path, 'too many entries (maximum 100000)');
  return value;
}
function pitch(value: unknown, path: string) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[A-Ga-g][#b♯♭]*-?\d+$/.test(value))) {
    fail(path, 'expected a note name such as C4 or an integer MIDI pitch');
  }
  integer(midiOf(value as string | number), path, 0, 127);
}
function effects(value: unknown, path: string) {
  const obj = object(value, path, ['drive', 'delay', 'reverb']);
  optionalNumber(obj, 'drive', path, 0, 1);
  optionalNumber(obj, 'reverb', path, 0, 1);
  if (obj.delay !== undefined) {
    const delay = object(obj.delay, `${path}.delay`, ['timeBeats', 'feedback', 'mix']);
    optionalNumber(delay, 'timeBeats', `${path}.delay`, 0.0625, 8);
    optionalNumber(delay, 'feedback', `${path}.delay`, 0, 0.85);
    optionalNumber(delay, 'mix', `${path}.delay`, 0, 1);
  }
}
function voice(value: unknown, path: string) {
  if (typeof value === 'string') {
    if (!(CHIPTUNE_VOICE_NAMES as readonly string[]).includes(value)) fail(path, `unknown voice ${value}`);
    return;
  }
  const obj = object(value, path, ['oscillators', 'envelope', 'filter', 'vibrato', 'gain', 'drive', 'bitCrush', 'sampleReduce']);
  const oscillators = list(obj.oscillators, `${path}.oscillators`);
  if (!oscillators.length || oscillators.length > 32) fail(`${path}.oscillators`, 'requires 1–32 oscillators');
  oscillators.forEach((entry, i) => {
    const at = `${path}.oscillators[${i}]`;
    const osc = object(entry, at, ['wave', 'gain', 'ratio', 'detuneCents', 'pulseWidth', 'phase']);
    if (!['sine', 'triangle', 'saw', 'square', 'pulse', 'noise'].includes(String(osc.wave))) fail(`${at}.wave`, 'unknown wave');
    optionalNumber(osc, 'gain', at, 0, 16);
    optionalNumber(osc, 'ratio', at, 0, 64, true);
    optionalNumber(osc, 'detuneCents', at, -4800, 4800);
    optionalNumber(osc, 'pulseWidth', at, 0.02, 0.98);
    optionalNumber(osc, 'phase', at, 0, 1);
  });
  optionalNumber(obj, 'gain', path, 0, 16);
  optionalNumber(obj, 'drive', path, 0, 1);
  if (obj.bitCrush !== undefined) integer(obj.bitCrush, `${path}.bitCrush`, 1, 16);
  if (obj.sampleReduce !== undefined) integer(obj.sampleReduce, `${path}.sampleReduce`, 1, 1024);
  if (obj.envelope !== undefined) {
    const env = object(obj.envelope, `${path}.envelope`, ['attack', 'decay', 'sustain', 'release']);
    for (const key of ['attack', 'decay', 'release']) optionalNumber(env, key, `${path}.envelope`, 0, 60);
    optionalNumber(env, 'sustain', `${path}.envelope`, 0, 1);
  }
  if (obj.filter !== undefined) {
    const filter = object(obj.filter, `${path}.filter`, ['type', 'cutoff', 'resonance', 'envAmount']);
    if (!['lowpass', 'highpass'].includes(String(filter.type))) fail(`${path}.filter.type`, 'unknown filter');
    number(filter.cutoff, `${path}.filter.cutoff`, 20, 20_000);
    optionalNumber(filter, 'resonance', `${path}.filter`, 0, 0.95);
    optionalNumber(filter, 'envAmount', `${path}.filter`, -20_000, 20_000);
  }
  if (obj.vibrato !== undefined) {
    const vibrato = object(obj.vibrato, `${path}.vibrato`, ['rate', 'depthCents', 'delaySec']);
    number(vibrato.rate, `${path}.vibrato.rate`, 0, 100);
    number(vibrato.depthCents, `${path}.vibrato.depthCents`, 0, 2400);
    optionalNumber(vibrato, 'delaySec', `${path}.vibrato`, 0, 3600);
  }
}

/** Validate author data without coercing, clamping or changing it. Safe at module scope. */
export function validateScore(value: unknown): Score {
  const score = object(value, 'score', ['bpm', 'durationBeats', 'tailSec', 'channels', 'key', 'timeSignature']);
  const bpm = number(score.bpm, 'score.bpm', 20, 400);
  const duration = number(score.durationBeats, 'score.durationBeats', 0, 24_000, true);
  const tail = score.tailSec === undefined ? DEFAULT_SCORE_TAIL_SEC : number(score.tailSec, 'score.tailSec', 0, 60);
  if (duration * 60 / bpm + tail > 3600) fail('score.durationBeats', 'score including tail must not exceed one hour');
  if (score.key !== undefined) {
    if (typeof score.key !== 'string') fail('score.key', 'expected a key name');
    parseKey(score.key);
  }
  if (score.timeSignature !== undefined) {
    const signature = list(score.timeSignature, 'score.timeSignature');
    if (signature.length !== 2) fail('score.timeSignature', 'expected [numerator, denominator]');
    integer(signature[0], 'score.timeSignature[0]', 1, 32);
    if (![1, 2, 4, 8, 16, 32].includes(signature[1] as number)) fail('score.timeSignature[1]', 'expected a power-of-two denominator');
  }
  const ids = new Set<string>();
  list(score.channels, 'score.channels').forEach((entry, i) => {
    const path = `score.channels[${i}]`;
    const common = ['id', 'label', 'gainDb', 'pan', 'mute', 'solo', 'automation', 'effects', 'bank'];
    const channel = object(entry, path, [...common, 'instrument', 'voice', 'notes', 'chords', 'tablature', 'hits', 'kit']);
    if (typeof channel.id !== 'string' || !channel.id.trim()) fail(`${path}.id`, 'expected a nonempty unique id');
    if (ids.has(channel.id)) fail(`${path}.id`, `duplicate id ${channel.id}`);
    ids.add(channel.id);
    if (channel.label !== undefined && typeof channel.label !== 'string') fail(`${path}.label`, 'expected a string');
    for (const key of ['mute', 'solo']) if (channel[key] !== undefined && typeof channel[key] !== 'boolean') fail(`${path}.${key}`, 'expected a boolean');
    if (channel.bank !== undefined && channel.bank !== 'synth' && channel.bank !== 'sampled') fail(`${path}.bank`, 'expected synth or sampled');
    const bank = channel.bank as 'synth' | 'sampled' | undefined;
    optionalNumber(channel, 'gainDb', path, -60, 12);
    optionalNumber(channel, 'pan', path, -1, 1);
    if (channel.effects !== undefined) effects(channel.effects, `${path}.effects`);
    if (channel.automation !== undefined) {
      let previous = -1;
      list(channel.automation, `${path}.automation`).forEach((entry, index) => {
        const at = `${path}.automation[${index}]`;
        const point = object(entry, at, ['beat', 'gainDb', 'pan']);
        const beat = number(point.beat, `${at}.beat`, 0, duration);
        if (beat <= previous) fail(`${at}.beat`, 'automation beats must be strictly increasing');
        previous = beat;
        if (point.gainDb === undefined && point.pan === undefined) fail(at, 'requires gainDb or pan');
        optionalNumber(point, 'gainDb', at, -60, 12);
        optionalNumber(point, 'pan', at, -1, 1);
      });
    }
    const timing = (event: ObjectValue, at: string, hasDuration = true) => {
      const beat = number(event.beat, `${at}.beat`, 0, duration);
      if (beat >= duration) fail(`${at}.beat`, 'must begin before durationBeats');
      if (hasDuration) {
        const length = number(event.duration, `${at}.duration`, 0, duration, true);
        if (beat + length > duration + 1e-9) fail(`${at}.duration`, 'event extends past durationBeats');
      }
      optionalNumber(event, 'velocity', at, 0, 1);
    };
    if (channel.hits !== undefined) {
      for (const field of ['instrument', 'voice', 'notes', 'chords', 'tablature']) if (channel[field] !== undefined) fail(`${path}.${field}`, 'a drum channel only contains hits');
      if (channel.kit !== undefined && channel.kit !== 'chip') fail(`${path}.kit`, 'expected chip');
      list(channel.hits, `${path}.hits`).forEach((entry, index) => {
        const at = `${path}.hits[${index}]`;
        const hit = object(entry, at, ['drum', 'beat', 'velocity']);
        timing(hit, at, false);
        if (typeof hit.drum !== 'string') fail(`${at}.drum`, 'expected a drum name');
        const chip = Object.hasOwn(CHIPTUNE_DRUMS, hit.drum);
        if (chip ? channel.kit !== 'chip' || bank === 'sampled' : !drumAvailable(hit.drum, resolveDrumBank(hit.drum, bank, false))) {
          fail(`${at}.drum`, `unavailable drum ${hit.drum}; chip drums require kit: 'chip' and synth bank`);
        }
      });
      return;
    }
    if (channel.kit !== undefined) fail(`${path}.kit`, 'kit requires a drum channel with hits');
    const checkInstrument = (name: unknown, at: string) => {
      if (typeof name !== 'string' || !instrumentAvailable(name, resolveInstrumentBank(name, bank, false))) fail(at, `unavailable instrument ${String(name)}`);
    };
    checkInstrument(channel.instrument, `${path}.instrument`);
    if (channel.voice !== undefined) {
      if (bank === 'sampled') fail(`${path}.voice`, 'custom voices require synth bank');
      voice(channel.voice, `${path}.voice`);
    }
    for (const kind of ['notes', 'chords'] as const) {
      if (channel[kind] === undefined) continue;
      list(channel[kind], `${path}.${kind}`).forEach((entry, index) => {
        const at = `${path}.${kind}[${index}]`;
        const event = object(entry, at, kind === 'notes'
          ? ['pitch', 'beat', 'duration', 'velocity', 'instrument']
          : ['symbol', 'beat', 'duration', 'velocity', 'instrument', 'octave', 'inversion', 'voices']);
        timing(event, at);
        if (event.instrument !== undefined) checkInstrument(event.instrument, `${at}.instrument`);
        if (kind === 'notes') pitch(event.pitch, `${at}.pitch`);
        else {
          if (typeof event.symbol !== 'string') fail(`${at}.symbol`, 'expected a chord symbol');
          if (event.octave !== undefined) integer(event.octave, `${at}.octave`, -1, 9);
          if (event.inversion !== undefined) integer(event.inversion, `${at}.inversion`, -32, 32);
          if (event.voices !== undefined) integer(event.voices, `${at}.voices`, 1, 16);
          for (const midi of voiceChord(event.symbol, event as never)) integer(midi, `${at}.symbol`, 0, 127);
        }
      });
    }
    if (channel.tablature !== undefined) {
      const tab = object(channel.tablature, `${path}.tablature`, ['events', 'tuning', 'instrument']);
      const tuning = tab.tuning === undefined ? ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'] : list(tab.tuning, `${path}.tablature.tuning`);
      if (tuning.length !== 6) fail(`${path}.tablature.tuning`, 'expected six open-string pitches');
      tuning.forEach((note, index) => pitch(note, `${path}.tablature.tuning[${index}]`));
      if (tab.instrument !== undefined) checkInstrument(tab.instrument, `${path}.tablature.instrument`);
      list(tab.events, `${path}.tablature.events`).forEach((entry, index) => {
        const at = `${path}.tablature.events[${index}]`;
        const event = object(entry, at, ['string', 'fret', 'beat', 'duration', 'velocity']);
        timing(event, at);
        const string = integer(event.string, `${at}.string`, 1, 6);
        const fret = integer(event.fret, `${at}.fret`, 0, 36);
        integer(midiOf(tuning[string - 1] as string | number) + fret, `${at}.fret`, 0, 127);
      });
    }
  });
  return value as Score;
}

/** Beat position in seconds, relative to the score's own origin. */
export function scoreTime(score: Score, beat: number): number {
  validateScore(score);
  return number(beat, 'beat', 0, score.durationBeats) * 60 / score.bpm;
}

/** Complete declared playback duration, including intentional rests and release tail. */
export function scoreDuration(score: Score): number {
  validateScore(score);
  return score.durationBeats * 60 / score.bpm + (score.tailSec ?? DEFAULT_SCORE_TAIL_SEC);
}
