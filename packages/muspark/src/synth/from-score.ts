/** One score compiler shared by the host, browser and Node renderers. */
import { resolveDrumBank, resolveInstrumentBank } from '../bank';
import { midiOf, voiceChord } from '../score/theory';
import { DEFAULT_SCORE_TAIL_SEC, validateScore } from '../score/validate';
import type { Channel, MelodyChannel, Score } from '../score/types';
import { CHIPTUNE_DRUMS, resolveVoice, type ChiptuneDrumName } from './chiptune';
import type { SynthEvent, SynthAutomationPoint } from './event';
import { toVoiceRenderer } from './voice';

export interface ScoreRenderPlan {
  events: SynthEvent[];
  musicalDurationSec: number;
  tailSec: number;
  durationSec: number;
}

function automation(channel: Channel, secondsPerBeat: number): SynthAutomationPoint[] | undefined {
  if (!channel.automation?.length) return undefined;
  let gainDb = channel.gainDb ?? 0;
  let pan = channel.pan ?? 0;
  const points: SynthAutomationPoint[] = [];
  if (channel.automation[0]!.beat > 0) points.push({ timeSec: 0, gainDb, pan });
  for (const point of channel.automation) {
    gainDb = point.gainDb ?? gainDb;
    pan = point.pan ?? pan;
    points.push({ timeSec: point.beat * secondsPerBeat, gainDb, pan });
  }
  return points;
}

/** Compile the declared window and all channels. No inferred duration or host/global time. */
export function compileScore(input: Score): ScoreRenderPlan {
  const score = validateScore(input);
  const secondsPerBeat = 60 / score.bpm;
  const out: SynthEvent[] = [];
  const hasSolo = score.channels.some(channel => channel.solo && !channel.mute);
  for (const channel of score.channels) {
    if (channel.mute || (hasSolo && !channel.solo)) continue;
    const common = {
      channelId: channel.id,
      gain: Math.pow(10, (channel.gainDb ?? 0) / 20),
      pan: channel.pan ?? 0,
      effects: channel.effects,
      bpm: score.bpm,
      automation: automation(channel, secondsPerBeat),
    };
    if (channel.hits !== undefined) {
      for (const hit of channel.hits) {
        if (hit.velocity === 0) continue;
        const chip = channel.kit === 'chip' ? CHIPTUNE_DRUMS[hit.drum as ChiptuneDrumName] : undefined;
        out.push({
          ...common, kind: 'drum', drum: hit.drum, beat: hit.beat,
          startSec: hit.beat * secondsPerBeat, velocity: hit.velocity ?? 0.82,
          bank: resolveDrumBank(hit.drum, channel.bank, Boolean(chip)),
          voice: chip?.render, lengthSec: chip?.lengthSec
        });
      }
      continue;
    }
    const melody = channel as MelodyChannel;
    const voice = melody.voice ? toVoiceRenderer(resolveVoice(melody.voice)) : undefined;
    const addTone = (pitch: number, beat: number, duration: number, velocity: number, instrument: string) => {
      if (velocity === 0) return;
      out.push({
        ...common, kind: 'tone', midi: pitch, beat, startSec: beat * secondsPerBeat,
        durationSec: duration * secondsPerBeat, velocity, instrument, voice,
        bank: resolveInstrumentBank(instrument, melody.bank, Boolean(voice))
      });
    };
    for (const note of melody.notes ?? []) {
      addTone(midiOf(note.pitch), note.beat, note.duration, note.velocity ?? 0.78, note.instrument ?? melody.instrument);
    }
    for (const chord of melody.chords ?? []) {
      for (const pitch of voiceChord(chord.symbol, chord)) {
        addTone(pitch, chord.beat, chord.duration, chord.velocity ?? 0.64, chord.instrument ?? melody.instrument);
      }
    }
    const tab = melody.tablature;
    if (tab) {
      const tuning = tab.tuning ?? ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];
      for (const note of tab.events) {
        addTone(midiOf(tuning[note.string - 1]!) + note.fret, note.beat, note.duration,
          note.velocity ?? 0.82, tab.instrument ?? melody.instrument);
      }
    }
  }
  const musicalDurationSec = score.durationBeats * secondsPerBeat;
  const tailSec = score.tailSec ?? DEFAULT_SCORE_TAIL_SEC;
  return {
    events: out.sort((a, b) => a.startSec - b.startSec),
    musicalDurationSec, tailSec, durationSec: musicalDurationSec + tailSec
  };
}

/** The same plan's event projection, useful for visual note highlighting. */
export function scoreToSynthEvents(score: Score): SynthEvent[] {
  return compileScore(score).events;
}
