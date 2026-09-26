/**
 * Sounds collected from a render tree → stem manifest.
 *
 * The picture runs in an iframe while sound is scheduled by Web Audio in the outer page. This is
 * deliberate, not a legacy accident: a clock can have only one owner, and audio glitches are
 * instantly audible, so audio owns the master clock. Every <video> in the picture is therefore
 * muted, and its own sound is translated into a clip in the stems, on the same timeline as
 * narration and music. A talking-head inset and the background music can never drift apart.
 *
 * This manifest is **shared** by editing and export: the browser feeds it to Web Audio, and ffmpeg
 * builds its filtergraph from it (see film-build/mixdown). Neither side computes its own, so "the
 * preview sounds different from the export" is structurally impossible.
 */

import {
  STEM_AUDIO_FORMAT,
  type StemAudioManifest,
  type StemClip,
  type StemTrack,
} from './stem-audio';

/**
 * One registered sound: the shape produced by collecting a React tree.
 *
 * Redeclared here rather than imported from the runtime: core is the bottom layer, and depending on
 * the runtime would create a cycle. It is structurally identical to `SoundEntry`; if they diverge,
 * the call site fails to compile.
 */
export interface FilmSoundEntry {
  key: string;
  /** Location of the owning MG in the arrangement; different instances of the same module must not share sound. */
  loc?: string;
  /** Host-owned MG scene binding; onset may precede or outlast that scene. */
  sceneId?: string;
  kind: 'voice' | 'music' | 'sfx';
  src: string;
  startMs: number;
  durMs: number;
  inMs: number;
  /** Playback speed applied to the source (the number in `<FilmVideo rate>`). Defaults to 1. */
  rate?: number | undefined;
  /**
   * Total length of the source asset (ms), measured by ffprobe during evaluation, not written in
   * the film.
   *
   * The manifest does not use it (that is about scheduling), but it is the **only** value in this
   * chain that reveals "the file itself changed": same path, re-recorded voiceover, and this is what
   * differs. The player uses it to decide whether to decode again.
   */
  sourceDurMs?: number | undefined;
  gainDb?: number | undefined;
  duck?: boolean | undefined;
  fadeInMs?: number | undefined;
  fadeOutMs?: number | undefined;
  /** This sound is switched off (track muted / hidden). The manifest skips it; the block stays on the timeline. */
  off?: boolean | undefined;
  /** The track in the arrangement. Absent = code-only form. */
  track?: {
    index: number;
    name: string;
    kind: string;
    hidden?: boolean | undefined;
    muted?: boolean | undefined;
    locked?: boolean | undefined;
  } | undefined;
  /** This block's id in the arrangement. Tracks use it to map back to rows in the arrangement (see the timeline-layout alignment in web). */
  clipId?: string | undefined;
}

export interface FilmSoundOwner {
  key: string;
  clipId?: string;
  loc?: string;
  startMs: number;
  durMs: number;
  silent?: boolean;
  track?: { hidden?: boolean; muted?: boolean };
}

/**
 * Sounds for a single-block export: only explicitly owned sounds, clipped to the block's window, then
 * shifted so the exported film starts at zero. `renderFilm.fromMs` offsets only the picture, so the
 * mixdown must already receive this local schedule.
 */
export function clipOwnedSounds(
  sounds: readonly FilmSoundEntry[],
  owner: FilmSoundOwner,
): FilmSoundEntry[] {
  if (owner.silent || owner.track?.hidden || owner.track?.muted) return [];
  const owned = sounds.filter(sound => {
    if (sound.clipId && owner.clipId && sound.clipId !== owner.clipId) return false;
    if (sound.loc && owner.loc && sound.loc !== owner.loc) return false;
    return (owner.clipId && sound.clipId === owner.clipId)
      || (owner.loc && sound.loc === owner.loc)
      || (sound.sceneId && (sound.sceneId === owner.key || sound.sceneId === owner.clipId));
  });
  return windowFilmSounds(owned, owner.startMs, owner.durMs);
}

/** Rebase a film audio interval to zero, retaining source offsets and playback rates. */
export function windowFilmSounds(sounds: readonly FilmSoundEntry[], startMs: number, durMs: number): FilmSoundEntry[] {
  const endMs = startMs + durMs;
  return sounds.flatMap(sound => {
    if (sound.off || sound.track?.hidden || sound.track?.muted || !Number.isFinite(sound.durMs)) return [];
    const from = Math.max(startMs, sound.startMs), to = Math.min(endMs, sound.startMs + sound.durMs);
    if (to <= from) return [];
    const head = from - sound.startMs, tail = sound.startMs + sound.durMs - to;
    return [{ ...sound, startMs: from - startMs, durMs: to - from, inMs: sound.inMs + head * (sound.rate ?? 1),
      ...(sound.fadeInMs != null ? { fadeInMs: Math.max(0, sound.fadeInMs - head) } : {}),
      ...(sound.fadeOutMs != null ? { fadeOutMs: Math.max(0, sound.fadeOutMs - tail) } : {}),
    }];
  });
}

/**
 * Every audible sound in a tree.
 *
 * Stems are split by kind into three (voice/music/sfx): exactly the granularity the "music ducks
 * under voice" rule needs. Anything finer would have to be stated by the film itself, and the tree
 * has no notion of tracks.
 */
export function soundsStemManifest(
  sounds: readonly FilmSoundEntry[],
  opts: { totalMs?: number; mapUrl?: (src: string) => string } = {},
): StemAudioManifest {
  const map = opts.mapUrl ?? ((src: string) => src);
  const kinds = new Set<FilmSoundEntry['kind']>();
  const clips: StemClip[] = [];
  let end = 0;
  for (const s of sounds) {
    /* Entries not yet probed during collection have durMs = Infinity. Letting one into the manifest
       would make the whole track Infinity long and the player could schedule nothing. Evaluation fills
       in measured values; anything still unfilled is skipped. */
    if (!Number.isFinite(s.durMs) || s.durMs <= 0) continue;
    const url = map(s.src);
    if (!url) continue;
    kinds.add(s.kind);
    clips.push({
      id: s.key,
      url,
      track: s.kind,
      startMs: s.startMs,
      durationMs: s.durMs,
      inMs: s.inMs,
      /* Switched-off clips stay in the manifest with a flag instead of being removed: keeping the
         set of urls unchanged lets mute/unmute take the cheap retime path instead of a full rebuild
         (details in stemClipSchema.muted). */
      ...(s.off ? { muted: true } : {}),
      ...(s.rate != null && s.rate !== 1 ? { rate: s.rate } : {}),
      ...(s.gainDb != null && s.gainDb !== 0 ? { gainDb: s.gainDb } : {}),
      ...(s.fadeInMs ? { fadeInMs: s.fadeInMs } : {}),
      ...(s.fadeOutMs ? { fadeOutMs: s.fadeOutMs } : {}),
    });
    end = Math.max(end, s.startMs + s.durMs);
  }
  const tracks: StemTrack[] = [...kinds].map((kind) => ({
    id: kind,
    kind,
    gainDb: 0,
    // Music ducks under voice: the same rule as the final mixdown, so what you hear while editing is what gets exported.
    ...(kind === 'music' ? { duckDb: -9 } : {}),
  }));
  return {
    format: STEM_AUDIO_FORMAT,
    totalMs: Math.round(opts.totalMs ?? end),
    tracks,
    clips: clips.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id)),
  };
}
