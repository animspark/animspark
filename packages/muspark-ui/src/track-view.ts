/** The views and audio consume the same validated Score; only display data is derived here. */
import { midiOf, validateScore, type Score } from '@muspark/core';
import type { ParamValue } from './types';

export interface ViewNote { pitch: number; beat: number; duration: number; velocity: number; label: string; instrument: string }
export interface ViewChord { symbol: string; beat: number; duration: number; func: string; root: string; tension: number }
export interface ViewTabEvent { string: number; fret: number; beat: number; duration: number; finger: string }
export interface ViewDrumEvent { drum: string; beat: number; velocity: number }
export interface ViewChannel {
  id: string; label: string; instrument: string; gainDb: number; pan: number; mute: boolean; solo: boolean; color: string;
  notes: ViewNote[]; chords: ViewChord[]; tabEvents: ViewTabEvent[]; tuning: string[]; drums: ViewDrumEvent[];
  automation: Array<Record<string, ParamValue>>; effects: Record<string, ParamValue>;
}

const CHANNEL_COLORS = ['#76a9ff', '#6dd3b6', '#f2c45c', '#d28cff', '#ff7e79', '#73c8e5', '#a4d96c', '#ff9f70', '#9aa5ff', '#f79ac1'];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const DEFAULT_TUNING = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];

export function pitchNameOf(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Score is static author data; validation happens once per immutable object. */
const SCORES = new WeakMap<object, Score>();
function scoreOf(value: unknown): Score {
  if (value && typeof value === 'object') {
    const cached = SCORES.get(value);
    if (cached) return cached;
    const score = validateScore(value);
    SCORES.set(value, score);
    return score;
  }
  return validateScore(value);
}

export function musicChannelsOf(value: unknown): ViewChannel[] {
  return scoreOf(value).channels.map((channel, index) => {
    const drums = 'hits' in channel;
    const instrument = drums ? 'drums' : channel.instrument;
    const tablature = drums ? undefined : channel.tablature;
    return {
      id: channel.id,
      label: channel.label ?? channel.id,
      instrument,
      gainDb: channel.gainDb ?? 0,
      pan: channel.pan ?? 0,
      mute: channel.mute ?? false,
      solo: channel.solo ?? false,
      color: CHANNEL_COLORS[index % CHANNEL_COLORS.length]!,
      notes: drums ? [] : (channel.notes ?? []).map((note) => ({
        pitch: midiOf(note.pitch), beat: note.beat, duration: note.duration, velocity: note.velocity ?? 0.8,
        label: '', instrument: note.instrument ?? instrument,
      })),
      chords: drums ? [] : (channel.chords ?? []).map((chord) => ({
        symbol: chord.symbol, beat: chord.beat, duration: chord.duration, func: '',
        root: /^([A-G](?:#|♯|b|♭)?)/.exec(chord.symbol)?.[1]?.replace('#', '♯').replace('b', '♭') ?? '', tension: 0,
      })),
      tabEvents: (tablature?.events ?? []).map((event) => ({
        string: event.string, fret: event.fret, beat: event.beat, duration: event.duration, finger: '',
      })),
      tuning: (tablature?.tuning ?? DEFAULT_TUNING).map((pitch) => pitchNameOf(midiOf(pitch))),
      drums: drums ? (channel.hits ?? []).map((hit) => ({ drum: hit.drum, beat: hit.beat, velocity: hit.velocity ?? 0.8 })) : [],
      automation: (channel.automation ?? []).map((point) => ({ ...point })),
      effects: { ...channel.effects } as Record<string, ParamValue>,
    };
  });
}

type ChannelNeed = 'notes' | 'chords' | 'tablature' | 'drums' | 'any';
function channelHas(channel: ViewChannel, need: ChannelNeed): boolean {
  if (need === 'notes') return channel.notes.length > 0;
  if (need === 'chords') return channel.chords.length > 0;
  if (need === 'tablature') return channel.tabEvents.length > 0;
  if (need === 'drums') return channel.drums.length > 0;
  return channel.notes.length + channel.chords.length + channel.tabEvents.length + channel.drums.length > 0;
}

export function musicChannelOf(value: unknown, channelId: ParamValue | undefined, need: ChannelNeed = 'any'): ViewChannel | null {
  const channels = musicChannelsOf(value);
  const wanted = String(channelId ?? '');
  if (wanted) {
    const channel = channels.find((item) => item.id === wanted);
    if (!channel) throw new Error(`Score has no channel "${wanted}".`);
    return channel;
  }
  return channels.find((channel) => channelHas(channel, need)) ?? null;
}

export function musicBpmOf(value: unknown): number { return scoreOf(value).bpm; }
export function musicEndBeatOf(value: unknown): number { return scoreOf(value).durationBeats; }
export function musicBeatsViewportOf(value: unknown): number { return scoreOf(value).durationBeats; }
