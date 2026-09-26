import type { FilmWord } from '@animspark/core/film';
import type { MediaTimeIndex } from './media-at';
import type { SoundEntry } from './stage';
import { scoreDuration, type Score } from '@muspark/core';
import { mgScoreSrc } from './mg-score';

/** A sound owned by an MG. All authoring times are seconds in that MG. */
interface MgSoundBase {
  id: string;
  kind: 'voice' | 'sfx' | 'music';
  at?: number;
  time?: readonly [number, number];
  volume?: number;
}

export type MgSound = MgSoundBase & ({ src: string; score?: never } | { score: Score; src?: never });

export interface PlannedMgSound extends SoundEntry {
  words?: readonly FilmWord[];
}

export interface MgSoundPlacement {
  /** Stable identity of this particular MG instance. */
  id: string;
  at?: number;
  time?: readonly [number, number];
  loc?: string;
  clipId?: string;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const ms = (sec: number) => Math.round(sec * 1e6) / 1000;

/** Validate the complete declaration before applying an outer clip's trim. */
export function planMgSoundClips(
  declaration: unknown,
  durationSec: number,
  assets: MediaTimeIndex,
  placement: MgSoundPlacement,
): PlannedMgSound[] {
  if (declaration === undefined) return [];
  if (!Array.isArray(declaration)) throw new Error('MG sounds must be an array of {id, kind, src or score, at?, time?, volume?}.');
  if (!finite(durationSec) || durationSec <= 0) throw new Error('An MG with sounds needs a positive durationSec.');
  const [parentIn, parentOut] = placement.time ?? [0, durationSec];
  // The outer MG may hold its final frame beyond durationSec. Its sounds retain
  // their authored lengths; extending the picture must not extend/repeat audio.
  if (!finite(parentIn) || !finite(parentOut) || parentOut <= parentIn) {
    throw new Error(`${placement.id}: MG time must be a nonempty, nonnegative range.`);
  }
  const at = placement.at ?? 0;
  if (!finite(at)) throw new Error(`${placement.id}: MG at must be a nonnegative number.`);
  const ids = new Set<string>();
  return declaration.flatMap((sound: MgSound, index): PlannedMgSound[] => {
    const where = `${placement.id}: sounds[${index}]`;
    if (!sound || typeof sound !== 'object' || Array.isArray(sound)) throw new Error(`${where} must be a sound declaration.`);
    for (const key of Object.keys(sound)) if (!['id', 'kind', 'src', 'score', 'at', 'time', 'volume'].includes(key)) throw new Error(`${where}: unknown parameter ${key}.`);
    if (typeof sound.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sound.id)) throw new Error(`${where}: id must contain letters, numbers, hyphens or underscores.`);
    if (ids.has(sound.id)) throw new Error(`${where}: duplicate sound id ${sound.id}.`);
    ids.add(sound.id);
    if (!['voice', 'sfx', 'music'].includes(sound.kind)) throw new Error(`${where}: kind must be voice, sfx or music.`);
    if ((sound.score !== undefined) === (sound.src !== undefined)) throw new Error(`${where}: provide exactly one of src or score.`);
    if (sound.score === undefined && (typeof sound.src !== 'string' || !sound.src)) throw new Error(`${where}: src must be a media path.`);
    if (sound.score !== undefined && sound.kind === 'voice') throw new Error(`${where}: a score is music or sfx; voice requires recorded speech.`);
    const src = sound.score !== undefined ? mgScoreSrc(sound.score) : sound.src!;
    const source: MediaTimeIndex[string] = sound.score !== undefined ? { dur: scoreDuration(sound.score) } : assets[src];
    const full = source?.dur;
    if (!finite(full) || full <= 0) throw new Error(`${where}: no measured duration for ${src}. Generate or inspect the audio first.`);
    if (sound.time !== undefined && (!Array.isArray(sound.time) || sound.time.length !== 2)) throw new Error(`${where}: time must be [sourceStart, sourceEnd].`);
    const [from, until] = sound.time ?? [0, full];
    const start = sound.at ?? 0, volume = sound.volume ?? 1;
    if (!finite(start) || !finite(volume)) throw new Error(`${where}: at and volume must be nonnegative numbers.`);
    if (!finite(from) || !finite(until) || until <= from || until > full + 1e-6) throw new Error(`${where}: time exceeds or empties its ${full}s source.`);
    const end = start + until - from;
    if (end > durationSec + 1e-6) throw new Error(`${where} (${sound.id}) ends at ${end}s, beyond durationSec ${durationSec}. Extend the MG or explicitly trim this sound.`);
    const lo = Math.max(start, parentIn), hi = Math.min(end, parentOut);
    if (hi <= lo) return [];
    return [{
      key: `${placement.id}/${sound.id}`,
      kind: sound.kind,
      src,
      startMs: ms(at + lo - parentIn),
      durMs: ms(hi - lo),
      inMs: ms(from + lo - start),
      sourceDurMs: ms(full),
      ...(volume === 0 ? { off: true } : { gainDb: 20 * Math.log10(volume) }),
      ...(sound.kind === 'music' ? { duck: true } : {}),
      ...(source?.text ? { text: source.text } : {}),
      ...(source?.words ? { words: source.words } : {}),
      ...(placement.loc ? { loc: placement.loc } : {}),
      ...(placement.clipId ? { clipId: placement.clipId } : {}),
    }];
  });
}
