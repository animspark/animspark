/**
 * Main render loop for oscillator synthesis.
 *
 * Waveforms are computed on the fly, not looked up from sample tables: for electronic music, chiptune and any voice that needs a "synth" character,
 * sample playback rounds off the sharp edges; only computed waveforms get it right.
 *
 * Mix chain:
 * each sample gets channel gain and drive, is split left/right by continuous pan, and written into the delay taps and reverb send;
 * once all events are summed, the reverb tail is rendered in one pass, and finally the peak is limited.
 *
 * This module is pure computation, shared by the browser and Node - WAV encoding deliberately lives in wav.ts,
 * so each platform can choose Buffer or Uint8Array output.
 */
import { clamp, midiHz } from './dsp';
import {
  builtinDrumLengthSec,
  builtinReleaseSec,
  builtinToneSample,
  makeBuiltinDrumRenderer,
  type BuiltinDrum,
  type BuiltinInstrument,
} from './voices';
import { instantiateVoice } from './voice';
import type { SynthEvent, VoiceRenderer } from './event';
import { eventMixAt } from './automation';
import { renderFrames } from './render-size';

export const SYNTH_SAMPLE_RATE = 44_100;

export type {
  SynthDelay,
  SynthDrumEvent,
  SynthEffects,
  SynthEvent,
  SynthToneEvent,
  VoiceRenderer,
} from './event';

/**
 * Write one sample into the output bus.
 *
 * Drive is applied before panning because it is nonlinear: clipping then splitting channels
 * gives a different result from splitting channels and clipping each one.
 */
function addStereoSample(
  left: Float32Array,
  right: Float32Array,
  sendL: Float32Array,
  sendR: Float32Array,
  index: number,
  rawSample: number,
  event: SynthEvent,
  sampleRate: number,
): void {
  const effects = event.effects;
  const mix = eventMixAt(event, index / sampleRate);
  rawSample *= mix.gain;
  const drive = clamp(Number(effects?.drive) || 0, 0, 1);
  const sample = drive > 0
    ? Math.tanh(rawSample * (1 + drive * 8)) / Math.tanh(1 + drive * 8)
    : rawSample;
  const pan = clamp(mix.pan, -1, 1);
  const angle = (pan + 1) * Math.PI / 4;
  const leftGain = Math.cos(angle);
  const rightGain = Math.sin(angle);
  const add = (at: number, amount: number, swap = false): void => {
    if (at < 0 || at >= left.length) return;
    left[at] = left[at]! + sample * amount * (swap ? rightGain : leftGain);
    right[at] = right[at]! + sample * amount * (swap ? leftGain : rightGain);
  };

  const delayMix = clamp(Number(effects?.delay?.mix) || 0, 0, 1);
  add(index, 1 - delayMix * 0.18);
  if (delayMix > 0) {
    const delayBeats = clamp(Number(effects?.delay?.timeBeats) || 0.5, 0.0625, 8);
    const feedback = clamp(effects?.delay?.feedback ?? 0.28, 0, 0.85);
    const delaySamples = Math.max(1, Math.round(delayBeats * 60 / event.bpm * sampleRate));
    // Swap left and right on odd repeats for a ping-pong effect
    for (let repeat = 1; repeat <= 4; repeat += 1) {
      add(index + delaySamples * repeat, delayMix * Math.pow(feedback, repeat - 1), repeat % 2 === 1);
    }
  }

  const reverb = clamp(Number(effects?.reverb) || 0, 0, 1);
  if (reverb > 0 && index >= 0 && index < sendL.length) {
    sendL[index] = sendL[index]! + sample * reverb * 0.55 * leftGain;
    sendR[index] = sendR[index]! + sample * reverb * 0.55 * rightGain;
  }
}

/**
 * Schroeder reverb: 4 parallel damped comb filters feeding 2 series all-pass stages.
 * The left and right comb buffer lengths are offset by 23 samples to create stereo width.
 *
 * The sampled backend reuses the same coefficients. Reverb is linear time-invariant, so rendering each backend's tail and summing
 * is equivalent to mixing the sends and running reverb once; a mixed-backend piece therefore sounds like it's in one room.
 */
export function renderReverbTail(
  sendL: Float32Array,
  sendR: Float32Array,
  outL: Float32Array,
  outR: Float32Array,
  sampleRate: number,
): void {
  const scale = sampleRate / 44_100;
  const combBase = [1116, 1188, 1277, 1356].map((n) => Math.max(8, Math.round(n * scale)));
  const allpassBase = [556, 441].map((n) => Math.max(4, Math.round(n * scale)));
  const FEEDBACK = 0.77;
  const DAMP = 0.28;
  const WET = 0.6;

  const channel = (send: Float32Array, out: Float32Array, offset: number): void => {
    const combs = combBase.map((len) => ({ buf: new Float32Array(len + offset), pos: 0, lp: 0 }));
    const allpasses = allpassBase.map((len) => ({ buf: new Float32Array(len), pos: 0 }));
    for (let i = 0; i < send.length; i += 1) {
      const input = send[i]!;
      let acc = 0;
      for (const c of combs) {
        const y = c.buf[c.pos]!;
        c.lp = y * (1 - DAMP) + c.lp * DAMP;
        c.buf[c.pos] = input + c.lp * FEEDBACK;
        c.pos = (c.pos + 1) % c.buf.length;
        acc += y;
      }
      let x = acc * 0.25;
      for (const a of allpasses) {
        const buffered = a.buf[a.pos]!;
        const y = -x + buffered;
        a.buf[a.pos] = x + buffered * 0.5;
        a.pos = (a.pos + 1) % a.buf.length;
        x = y;
      }
      out[i] = out[i]! + x * WET;
    }
  };
  channel(sendL, outL, 0);
  channel(sendR, outR, 23);
}

export interface SynthRenderResult {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  durationSec: number;
  peakDb: number;
  eventCount: number;
  /** Whether the 0.92 peak limiter kicked in. */
  limited: boolean;
}

/** Custom voice object -> stable string id, used as a cache key. */
const voiceIds = new WeakMap<object, string>();
let voiceIdSeq = 0;
function voiceIdOf(voice: VoiceRenderer): string {
  let id = voiceIds.get(voice.spec);
  if (!id) {
    voiceIdSeq += 1;
    id = `v${voiceIdSeq}`;
    voiceIds.set(voice.spec, id);
  }
  return id;
}

/**
 * Memory cap for the note waveform cache; past it, caching stops - things just get slower, never wrong.
 *
 * The cache uses Float64Array rather than Float32Array: synthesis produces double-precision values,
 * and the original path only truncates to single precision when writing the output buffer. If the cache truncated early,
 * the later multiplications by velocity and gain would differ in the lowest bits, breaking byte-for-byte consistency.
 */
const CACHE_BUDGET_BYTES = 192 * 1024 * 1024;

/**
 * Render an event stream.
 *
 * Events must already be sorted by startSec - summing is commutative, but the delay taps write into shared buffers,
 * so a different order changes the floating-point accumulation order and thus the lowest bits.
 *
 * Waveforms are cached and reused by (voice, pitch, duration): synthesis is deterministic, so the same combination always yields the same waveform,
 * and one note often repeats dozens of times in a piece. The cache holds the raw waveform before velocity and gain are applied,
 * and the multiplications afterwards happen in exactly the same order as per-sample computation, so the result is still byte-identical.
 */
export function renderSynthEvents(
  events: SynthEvent[],
  totalSec: number,
  sampleRate = SYNTH_SAMPLE_RATE,
  options: { limit?: boolean } = {},
): SynthRenderResult {
  const frames = renderFrames(totalSec, sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const sendL = new Float32Array(frames);
  const sendR = new Float32Array(frames);

  const cache = new Map<string, Float64Array>();
  let cacheBytes = 0;

  for (const event of events) {
    const start = Math.max(0, Math.round(event.startSec * sampleRate));
    if (start >= frames) continue;

    if (event.kind === 'drum') {
      const lengthSec = event.lengthSec ?? builtinDrumLengthSec(event.drum as BuiltinDrum);
      const total = Math.ceil(lengthSec * sampleRate);
      const end = Math.min(frames, start + total);
      // Velocity is multiplied inside the drum renderer, so it must be part of the key to keep the multiplication order unchanged
      const key = `d|${event.drum}|${event.velocity}|${total}`;
      let wave = cache.get(key);
      if (!wave) {
        const renderDrum = event.voice ?? makeBuiltinDrumRenderer(event.drum as BuiltinDrum, sampleRate);
        wave = new Float64Array(total);
        for (let j = 0; j < total; j += 1) {
          wave[j] = renderDrum(j / sampleRate, j, event.velocity);
        }
        if (cacheBytes + wave.byteLength <= CACHE_BUDGET_BYTES) {
          cache.set(key, wave);
          cacheBytes += wave.byteLength;
        }
      }
      for (let i = start; i < end; i += 1) {
        addStereoSample(
          left, right, sendL, sendR, i,
          wave[i - start]!,
          event, sampleRate,
        );
      }
      continue;
    }

    const release = event.voice
      ? event.voice.releaseSec
      : builtinReleaseSec(event.instrument as BuiltinInstrument);
    const total = Math.ceil((event.durationSec + release) * sampleRate);
    const end = Math.min(frames, start + total);
    const voiceKey = event.voice ? voiceIdOf(event.voice) : event.instrument;
    const key = `t|${voiceKey}|${event.midi}|${event.durationSec}|${total}`;
    let wave = cache.get(key);
    if (!wave) {
      const frequency = midiHz(event.midi);
      // Custom voices contain stateful filters; compute the whole note in one go so the state stays continuous
      const voice = event.voice ? instantiateVoice(event.voice.spec, sampleRate) : null;
      wave = new Float64Array(total);
      for (let j = 0; j < total; j += 1) {
        wave[j] = voice
          ? voice.sample(frequency, j / sampleRate, event.durationSec, j, sampleRate)
          : builtinToneSample(
            event.instrument as BuiltinInstrument,
            frequency, j / sampleRate, event.durationSec, j, sampleRate,
          );
      }
      if (cacheBytes + wave.byteLength <= CACHE_BUDGET_BYTES) {
        cache.set(key, wave);
        cacheBytes += wave.byteLength;
      }
    }
    for (let i = start; i < end; i += 1) {
      addStereoSample(
        left, right, sendL, sendR, i,
        wave[i - start]! * event.velocity * 0.3,
        event, sampleRate,
      );
    }
  }

  renderReverbTail(sendL, sendR, left, right, sampleRate);

  let peak = 0;
  for (let i = 0; i < frames; i += 1) {
    peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  }
  // When mixing with the sampled backend, limit only after both are summed, otherwise the oscillator parts get compressed first
  const limited = peak > 0.92 && options.limit !== false;
  if (limited) {
    const scale = 0.92 / peak;
    for (let i = 0; i < frames; i += 1) {
      left[i] = left[i]! * scale;
      right[i] = right[i]! * scale;
    }
    peak = 0.92;
  }

  return {
    left,
    right,
    sampleRate,
    durationSec: totalSec,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    eventCount: events.length,
    limited,
  };
}
