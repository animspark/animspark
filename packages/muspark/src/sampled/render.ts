/**
 * Sampled backend: SynthEvent stream -> MIDI messages -> SoundFont synthesis -> audio.
 *
 * This deliberately consumes the same event stream as the oscillator backend instead of adding a separate Score->MIDI compile path:
 * that way score compilation lives in one place, a Score supports both backends,
 * and channel mute/solo, gain, pan and automation only need to be implemented once.
 *
 * Events fire with sample-level accuracy - audio is first advanced to the event's sample, then the message is sent,
 * so beat positions aren't snapped to process() block boundaries.
 *
 * The caller loads the sound bank and passes it in; this module never touches the file system. Node reads it from disk,
 * the browser reads it from a fetched ArrayBuffer, and both share the same render code.
 */
import type { BasicSoundBank } from 'spessasynth_core';
import { renderReverbTail } from '../synth/render';
import type { SynthEffects, SynthEvent } from '../synth/event';
import { applyDelay, applyDrive, effectsKey, needsPostProcessing } from './effects';
import { DRUM_CHANNEL, drumNoteOf, patchOf, type SampledDrum, type SampledInstrument } from './instruments';
import { eventMixAt } from '../synth/automation';
import { renderFrames } from '../synth/render-size';

/** Block size of a single spessasynth process() call. */
const BLOCK = 128;
/** GM reserves channel 9 for percussion; the other 15 go to melodic parts. */
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
/** Amount sent to the reverb, matching the oscillator backend. */
const REVERB_SEND = 0.55;

const CC = { volume: 7, pan: 10 } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

/** 0-1 velocity -> MIDI velocity byte. */
function velocityByte(velocity: number): number {
  return Math.round(clamp(velocity, 0.01, 1) * 126) + 1;
}

interface MidiMessage {
  sample: number;
  /** Ordering within the same sample: configuration first, then release old notes, then note on. */
  order: 0 | 1 | 2;
  apply: (synth: SpessaLike) => void;
}

interface SpessaLike {
  noteOn: (channel: number, midiNote: number, velocity: number) => void;
  noteOff: (channel: number, midiNote: number) => void;
  controllerChange: (channel: number, controller: number, value: number) => void;
  programChange: (channel: number, programNumber: number) => void;
}

/** The GM table key for a validated event instrument. */
function instrumentKey(name: string): SampledInstrument {
  return name as SampledInstrument;
}

/**
 * A batch of voices that can share one synthesizer instance.
 *
 * A MIDI program is a property of the whole channel, while a logical channel can override the instrument per note,
 * so we expand by (channel, instrument); past 15, open another batch, and sum the batches after rendering.
 */
interface Batch {
  /** JSON [channelId, instrument] -> MIDI channel number. */
  voices: Map<string, number>;
  tones: SynthEvent[];
  drums: SynthEvent[];
}

function planBatches(events: SynthEvent[]): Batch[] {
  const keyOf = (event: SynthEvent): string =>
    JSON.stringify([event.channelId ?? '', event.kind === 'tone' ? event.instrument : 'drum']);

  const toneKeys: string[] = [];
  for (const event of events) {
    if (event.kind !== 'tone') continue;
    const key = keyOf(event);
    if (!toneKeys.includes(key)) toneKeys.push(key);
  }

  const batches: Batch[] = [];
  for (let i = 0; i < Math.max(1, Math.ceil(toneKeys.length / MELODIC_CHANNELS.length)); i += 1) {
    const slice = toneKeys.slice(i * MELODIC_CHANNELS.length, (i + 1) * MELODIC_CHANNELS.length);
    batches.push({
      voices: new Map(slice.map((key, index) => [key, MELODIC_CHANNELS[index]!])),
      tones: [],
      drums: [],
    });
  }

  for (const event of events) {
    if (event.kind === 'drum') {
      batches[0]!.drums.push(event);
      continue;
    }
    const key = keyOf(event);
    const batch = batches.find((b) => b.voices.has(key));
    if (batch) batch.tones.push(event);
  }
  return batches;
}

/** A batch of events -> time-sorted MIDI messages. */
function compileBatch(batch: Batch, sampleRate: number): MidiMessage[] {
  const messages: MidiMessage[] = [];
  const push = (sample: number, order: 0 | 1 | 2, apply: MidiMessage['apply']): void => {
    messages.push({ sample: Math.max(0, sample), order, apply });
  };

  // Select the program at the start of each MIDI channel
  for (const [key, midiChannel] of batch.voices) {
    const [, instrument] = JSON.parse(key) as [string, string];
    const patch = patchOf(instrumentKey(instrument));
    push(0, 0, (s) => {
      // Variation programs need bank select before program change; in the reverse order it falls back to standard GM
      s.controllerChange(midiChannel, 0, patch.bank ?? 0);
      s.programChange(midiChannel, patch.program);
      // Render a neutral stem; continuous gain/pan belongs to the shared PCM mixer.
      s.controllerChange(midiChannel, CC.volume, 127);
      s.controllerChange(midiChannel, CC.pan, 64);
    });
  }

  for (const event of batch.tones) {
    if (event.kind !== 'tone') continue;
    const midiChannel = batch.voices.get(JSON.stringify([event.channelId ?? '', event.instrument]));
    if (midiChannel === undefined) continue;
    const pitch = Math.round(clamp(event.midi, 0, 127));
    const start = Math.round(event.startSec * sampleRate);
    const end = Math.max(start + 1, Math.round((event.startSec + event.durationSec) * sampleRate));
    const velocity = velocityByte(event.velocity);
    push(start, 1, (s) => s.noteOff(midiChannel, pitch));
    push(start, 2, (s) => s.noteOn(midiChannel, pitch, velocity));
    push(end, 1, (s) => s.noteOff(midiChannel, pitch));
  }

  for (const event of batch.drums) {
    if (event.kind !== 'drum') continue;
    const note = drumNoteOf(event.drum as SampledDrum) ?? 38;
    const start = Math.round(event.startSec * sampleRate);
    const velocity = velocityByte(event.velocity);
    push(start, 0, (s) => {
      s.controllerChange(DRUM_CHANNEL, CC.volume, 127);
      s.controllerChange(DRUM_CHANNEL, CC.pan, 64);
    });
    push(start, 2, (s) => s.noteOn(DRUM_CHANNEL, note, velocity));
    // Percussion is one-shot; the short note off only frees the voice
    push(start + Math.round(0.12 * sampleRate), 1, (s) => s.noteOff(DRUM_CHANNEL, note));
  }

  messages.sort((a, b) => a.sample - b.sample || a.order - b.order);
  return messages;
}

async function renderBatch(
  batch: Batch,
  frames: number,
  sampleRate: number,
  soundBank: BasicSoundBank,
): Promise<{ left: Float32Array; right: Float32Array }> {
  const { SpessaSynthProcessor } = await import('spessasynth_core');
  const messages = compileBatch(batch, sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  if (!messages.length) return { left, right };

  // Disable built-in effects: reverb goes through muspark's own Schroeder, so both backends sit in the same room
  const synth = new SpessaSynthProcessor(sampleRate, {
    enableEventSystem: false,
    effectsEnabled: false,
  } as never);
  synth.soundBankManager.addSoundBank(soundBank, 'main');
  await synth.processorInitialized;

  // Don't call destroySynthProcessor(): it also destroys the sound bank in soundBankManager,
  // and that bank is a cache shared across renders; once destroyed, every later render fails to find its presets.
  // The processor itself is garbage once the function returns; leave it to the GC.
  let cursor = 0;
  const advanceTo = (target: number): void => {
    const end = Math.min(target, frames);
    while (cursor < end) {
      const chunk = Math.min(BLOCK, end - cursor);
      synth.process(left, right, cursor, chunk);
      cursor += chunk;
    }
  };
  for (const message of messages) {
    advanceTo(message.sample);
    message.apply(synth as unknown as SpessaLike);
  }
  advanceTo(frames);
  return { left, right };
}

export interface SampledRenderOptions {
  /**
   * The loaded GM sound bank.
   *
   * Resolved by the entry layer: Node reads it from disk with loadSoundBank(), the browser reads fetched
   * bytes with loadSoundBankBytes(). One load stays resident at about 32MB,
   * so the caller should cache and reuse it rather than re-parse it on every render.
   */
  soundBank: BasicSoundBank;
  sampleRate?: number;
}

export interface SampledRenderResult {
  left: Float32Array;
  right: Float32Array;
  eventCount: number;
}

/**
 * Render sampled events.
 *
 * Grouped by effects signature: drive/delay are time-domain and nonlinear processing applied after mixing,
 * which MIDI CC can't express, so each group is rendered separately and summed. Reverb uses each group's send amount
 * through muspark's Schroeder, with the same coefficients as the oscillator backend.
 */
export async function renderSampledEvents(
  events: SynthEvent[],
  totalSec: number,
  options: SampledRenderOptions,
): Promise<SampledRenderResult> {
  const sampleRate = options.sampleRate ?? 44_100;
  const frames = renderFrames(totalSec, sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  if (!events.length) return { left, right, eventCount: 0 };

  const groups = new Map<string, { effects: SynthEffects | undefined; events: SynthEvent[] }>();
  for (const event of events) {
    // Different channels must not share nonlinear effects or MIDI mixer state.
    // Include BPM so beat-synced delay never borrows another score's tempo.
    const key = JSON.stringify([event.channelId, event.gain, event.pan, event.automation,
    event.bpm, effectsKey(event.effects), event.effects?.reverb ?? 0]);
    let group = groups.get(key);
    if (!group) {
      group = { effects: event.effects, events: [] };
      groups.set(key, group);
    }
    group.events.push(event);
  }

  const sendL = new Float32Array(frames);
  const sendR = new Float32Array(frames);
  let usedReverb = false;

  for (const group of groups.values()) {
    const groupL = new Float32Array(frames);
    const groupR = new Float32Array(frames);
    for (const batch of planBatches(group.events)) {
      const stem = await renderBatch(batch, frames, sampleRate, options.soundBank);
      for (let i = 0; i < frames; i += 1) {
        groupL[i] = groupL[i]! + stem.left[i]!;
        groupR[i] = groupR[i]! + stem.right[i]!;
      }
    }

    const representative = group.events[0]!;
    for (let i = 0; i < frames; i++) {
      const mix = eventMixAt(representative, i / sampleRate);
      const angle = (mix.pan + 1) * Math.PI / 4;
      // Neutral pan preserves the SoundFont's stereo image and unity gain.
      groupL[i] = groupL[i]! * mix.gain * Math.SQRT2 * Math.cos(angle);
      groupR[i] = groupR[i]! * mix.gain * Math.SQRT2 * Math.sin(angle);
    }

    if (needsPostProcessing(group.effects)) {
      applyDrive([groupL, groupR], group.effects?.drive ?? 0);
      const delay = group.effects?.delay;
      if (delay && (delay.mix ?? 0) > 0) {
        const bpm = clamp(group.events[0]?.bpm ?? 120, 20, 400);
        applyDelay(groupL, groupR, delay, bpm, sampleRate);
      }
    }

    const reverb = clamp(Number(group.effects?.reverb) || 0, 0, 1);
    for (let i = 0; i < frames; i += 1) {
      left[i] = left[i]! + groupL[i]!;
      right[i] = right[i]! + groupR[i]!;
      if (reverb > 0) {
        sendL[i] = sendL[i]! + groupL[i]! * reverb * REVERB_SEND;
        sendR[i] = sendR[i]! + groupR[i]! * reverb * REVERB_SEND;
      }
    }
    if (reverb > 0) usedReverb = true;
  }

  if (usedReverb) renderReverbTail(sendL, sendR, left, right, sampleRate);

  return { left, right, eventCount: events.length };
}
