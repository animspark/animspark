/**
 * Check — the things a machine can find for you.
 *
 * The list follows one rule: **only check for "compiles, runs, looks fine on screen, but the final
 * film is broken".** Anything the eye catches at a glance (ugly type, bad colors) isn't here; that
 * is `anim look`'s job. What follows is exactly what you can't see — a black gap happens in the
 * one second nobody sampled, a black tail sits at the very end, and narration running past its
 * scene is only found by comparing two timestamps.
 *
 * Pass = the film can be exported (export won't be blocked by any of these). Picture and sound
 * quality aren't judged here; that is look / hear's job.
 */

import { filmSrcIsStill, type FilmWord } from '@animspark/core';

import { assetTranscriptPath } from './asset-transcript';
import type { FilmEval } from './evaluate';

export interface CodeIssue {
  level: 'error' | 'warn';
  what: string;
}

const s = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

/** Silent films shorter than this aren't flagged: intros, cards and stickers are often silent anyway. */
const SILENT_FILM_MS = 8_000;

/**
 * How a sound is named in messages.
 *
 * By default only the file name is available, and file names are content hashes
 * (`2aa8bcd90fc42d.mp3`) — the reader has to look it up in the ledger to find which line of code to
 * change. Given the ledger name (`telemetry hum`), that step disappears; `anim check` reports the
 * same name, and one toolset shouldn't have two ways of pointing at things.
 */
export type NameOf = (src: string) => string | undefined;

const called = (src: string, nameOf?: NameOf): string => nameOf?.(src) ?? src.split('/').pop() ?? src;

/**
 * Holes in the picture.
 *
 * A gap between scenes is a black screen. `<Series>` can't produce holes (it places scenes end to
 * end), so this mainly checks hand-placed `<Seq from>` — exactly where the math tends to go wrong.
 */
function holes(film: FilmEval): { fromMs: number; toMs: number }[] {
  const spans = film.scenes
    .filter((x) => x.durMs > 0)
    .map((x) => [x.startMs, x.startMs + x.durMs] as const)
    .sort((a, b) => a[0] - b[0]);
  const out: { fromMs: number; toMs: number }[] = [];
  let covered = 0;
  for (const [from, to] of spans) {
    if (from > covered + 1) out.push({ fromMs: covered, toMs: from });
    covered = Math.max(covered, to);
  }
  return out;
}

/**
 * Which scene a sound belongs to.
 *
 * Pick among the picture blocks its start falls in, **shortest first**: a 1.5-second bridging
 * element straddling a cut shouldn't steal a 6.5-second narration line from its real scene and then
 * report "5 seconds longer than the scene it sits in" — a false alarm whose only fix is to move the
 * bridge, forcing someone to take apart something that was done right.
 *
 * So: **the first one that fits is its owner**. Only if none fits has it really run over, and then
 * the **longest** block is reported — the reader needs to change that block's duration, not the
 * 1.5 seconds straddling the cut.
 */
function owningScene(film: FilmEval, sound: { startMs: number; durMs: number }) {
  const inside = film.scenes
    .filter((x) => sound.startMs >= x.startMs && sound.startMs < x.startMs + x.durMs)
    .sort((a, b) => a.durMs - b.durMs);
  const endMs = sound.startMs + sound.durMs;
  return inside.find((x) => endMs <= x.startMs + x.durMs + 1) ?? inside[inside.length - 1];
}

/**
 * Two picture blocks overlapping on the same track.
 *
 * A track in the doc is "a flat row of clips", and after one wrong `at` two clips play on top of
 * each other — the later one fully covers the earlier one, without a word: the check is all green,
 * the receipt's scene table plainly prints `0.00 → 6.30` and `5.00 → 10.50`, and nobody subtracts
 * them pairwise. In testing, two cold readers each hit this once and both thought they had
 * miscalculated a duration. Stacking means using another track (that is what gives layer order),
 * so overlaps on the same track are almost always mistakes.
 *
 * Picture only. Sounds are meant to be mixed on top of each other.
 */
function overlaps(film: FilmEval): { track: number; a: PictureSpan; b: PictureSpan }[] {
  const byTrack = new Map<number, PictureSpan[]>();
  const pictures: (PictureSpan & { loc?: string })[] = [
    ...film.scenes.map((x) => ({ name: x.clipId || x.label, startMs: x.startMs, durMs: x.durMs, track: x.track, loc: x.loc })),
    ...film.videos.map((v) => ({ name: v.clipId || v.label || v.src, startMs: v.startMs, durMs: v.durMs, track: v.track, loc: v.loc })),
  ];
  /* A video clip has one entry in each of two tables: in the scene table it is the window, in the
     video table it is the footage inside the window — the same clip. Without dedup it pairs with
     itself, and **every video clip reports a false overlap**: three clips, three warnings, drowning
     the real ones. `loc` is the doc coordinate (film.json#i.j), the one thing guaranteed to be the
     same for both records of one clip. This has happened. */
  const seen = new Set<string>();
  for (const one of pictures) {
    if (one.loc) {
      if (seen.has(one.loc)) continue;
      seen.add(one.loc);
    }
    if (one.track?.index == null || one.durMs <= 0) continue;
    const row = byTrack.get(one.track.index) ?? [];
    row.push(one);
    byTrack.set(one.track.index, row);
  }
  const out: { track: number; a: PictureSpan; b: PictureSpan }[] = [];
  for (const [track, row] of byTrack) {
    const sorted = [...row].sort((x, y) => x.startMs - y.startMs);
    for (let i = 1; i < sorted.length; i += 1) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      /* One millisecond doesn't count — clips placed end to end are often off by that much after rounding. */
      if (b.startMs < a.startMs + a.durMs - 1) out.push({ track, a, b });
    }
  }
  return out;
}

interface PictureSpan {
  name?: string;
  startMs: number;
  durMs: number;
  track?: { index: number };
}

/**
 * A block that spans the whole film yet sits **above** other picture blocks.
 *
 * The criterion is "≥ 90% of the picture end" rather than exactly full length: a bg is often given
 * an oversized duration for the target length and then trimmed, and being a few seconds off
 * shouldn't let it slip through. Conversely, genuine small upper-layer blocks (PIP, badges) are
 * short and never reach 90%, so they aren't flagged by mistake.
 * The denominator is visualEnd, not the film duration — a black tail left by music counts toward
 * the duration, and including it keeps the bg's share below the threshold (observed: 91.7 s bg ÷
 * 110 s film = 83%, and the warning silently didn't fire).
 * On the covered side only blocks that **overlap in time** count — if a top-track block and another
 * block are never on screen together, neither covers the other.
 */
function coveredAllFilm(film: FilmEval): { coverTrack: number; coverName: string; beneath: number }[] {
  const pictures: (PictureSpan & { loc?: string })[] = [
    ...film.scenes.map((x) => ({ name: x.clipId || x.label, startMs: x.startMs, durMs: x.durMs, track: x.track, loc: x.loc })),
    ...film.videos.map((v) => ({ name: v.clipId || v.label || v.src, startMs: v.startMs, durMs: v.durMs, track: v.track, loc: v.loc })),
  ];
  const seen = new Set<string>();
  const spans = pictures.filter((p) => {
    if (p.loc) {
      if (seen.has(p.loc)) return false;
      seen.add(p.loc);
    }
    return p.track?.index != null && p.durMs > 0;
  });
  const out: { coverTrack: number; coverName: string; beneath: number }[] = [];
  for (const cover of spans) {
    if (film.visualEndMs <= 0 || cover.durMs < film.visualEndMs * 0.9) continue;
    const beneath = spans.filter((p) =>
      p.track!.index > cover.track!.index
      && p.startMs < cover.startMs + cover.durMs
      && cover.startMs < p.startMs + p.durMs).length;
    if (beneath > 0) {
      out.push({ coverTrack: cover.track!.index, coverName: cover.name ?? '?', beneath });
    }
  }
  return out;
}

/** An asset's word-level timings — its ledger entry (written by `anim audio`). */
interface SourceWords {
  words?: readonly FilmWord[];
  /** Length of the file itself (seconds). An end that plays from the file's start or to its end isn't a cut. */
  dur?: number;
}

interface DirtyCut {
  src: string; atMs: number; where: 'in' | 'out'; text: string; certain: boolean;
  /** The cut is between two words but still sounds clipped (see tightCut); absent means it cuts into a word. */
  reason?: 'no-pause' | 'no-tail' | 'no-lead' | 'sounding';
  suggestMs?: number;
  db?: number;
}

/** Check known word interiors. Grouping words into speech runs would turn short pauses
 * into false cut errors; semantic continuity and breathing still require listening. */
function dirtyCuts(
  film: FilmEval,
  readWords: (src: string) => SourceWords | null,
  levelAt?: (src: string, atMs: number) => CutLevel | null,
): DirtyCut[] {
  const out: DirtyCut[] = [];
  const cache = new Map<string, readonly FilmWord[]>();
  /* Check both source footage and standalone voice; media without transcript timings can't be judged out of thin air. */
  for (const clip of spokenClips(film)) {
    if (!cache.has(clip.src)) cache.set(clip.src, readWords(clip.src)?.words ?? []);
    const words = cache.get(clip.src)!;
    if (!words.length) continue;
    const fileMs = (readWords(clip.src)?.dur ?? Infinity) * 1000;
    for (const [where, atMs] of [
      ['in', clip.inMs],
      ['out', clip.inMs + clip.durMs],
    ] as const) {
      /* The file's start and end aren't cuts: a whole TTS clip played from 0 naturally has its
         first word right at 0 (C1/C3 baseline: "starts mid-sound at 0.00s", which the agent could
         only leave as a synthesis quirk). */
      if (where === 'in' ? atMs <= 5 : atMs >= fileMs - 5) continue;
      /* When we can hear it, trust the ears: transcribed word boundaries drift both ways (one
         word's tail still sounded after the ASR word end, another's word end came 0.3 s after
         the sound). If both sides of the cut are already silent, don't report whatever the word
         table says; if it is still sounding, always report. */
      const level = levelAt?.(clip.src, atMs);
      if (level?.quiet) continue;
      // ASR uncertainty lowers severity; it must not turn trimming into the first/
      // last phoneme into a clean bill of health. Preserve actual gaps between tokens.
      const hit = words.find(word => word.endSec !== undefined
        && atMs > word.startSec * 1000 + 1 && atMs < word.endSec * 1000 - 1);
      if (hit) {
        out.push({ src: clip.src, atMs, where, text: hit.token,
          certain: atMs > hit.startSec * 1000 + 60 && atMs < hit.endSec! * 1000 - 60 });
        continue;
      }
      const tight = tightCut(words, atMs, where);
      if (tight) out.push({ src: clip.src, atMs, where, certain: false, ...tight });
      else if (level) {
        const suggestMs = where === 'in' ? level.quietBeforeMs : level.quietAfterMs;
        out.push({ src: clip.src, atMs, where, certain: false, reason: 'sounding', text: '', db: level.db, ...(suggestMs !== undefined ? { suggestMs } : {}) });
      }
    }
  }
  return out;
}

/** Audible speech clips: source footage (not muted) and voice. The cut checks look at both ends of these. */
export function spokenClips(film: FilmEval): Array<{ src: string; inMs: number; durMs: number }> {
  /* Inaudible clips aren't checked. Once a clip is held down (`volume: 0`, track muted), "the cut
     lands mid-speech" means nothing. For footage, its own sound entry has to be checked too: muted
     footage is `off` in the sound table. */
  const muted = new Set(film.sounds.filter((s) => s.off).map((s) => s.src));
  return [
    ...film.videos.filter((v) => !v.silent && !v.track?.muted && !muted.has(v.src)),
    ...film.sounds.filter((s) => s.kind === 'voice' && !s.off),
  ];
}

/** Whether the audio is actually sounding at the cut (energy measured by the host; see cut-levels in gen-video). */
export interface CutLevel {
  /** Both sides of the cut are far below this speech's talking level — it is a pause. */
  quiet: boolean;
  /** Level at the cut (a few tens of milliseconds either side), in dBFS. */
  db: number;
  /** While still sounding, the nearest pause before / after (source time, ms). In points use the earlier, out points the later. */
  quietBeforeMs?: number;
  quietAfterMs?: number;
}

/** A pause shorter than this between two words isn't a place to cut: it is spacing within one breath, or speakers talking over each other at a handover. */
const MIN_PAUSE_MS = 120;
/** ASR word ends come before the sound actually stops; out points need at least this much so the tail isn't cut off. */
const TAIL_MS = 150;
/** In points leave a little before the first word, so the onset (consonants, breath) isn't swallowed. */
const LEAD_MS = 80;

/**
 * The cut lands between two words, but there is no pause there, or it sits right on a word end
 * with no room for the tail.
 *
 * Cuts inside words are reported above; this handles the two cases that don't cut into a word but
 * still sound clipped:
 *   · almost no gap between the two words (e.g. a cue breaking at a speaker change, 40 ms apart) —
 *     cutting here chops a single breath of speech in half;
 *   · the out point is right on the ASR word end — transcribed word ends are generally early, so
 *     part of the last word's tail gets cut off (observed in practice).
 * Gives a cut point that can be used directly: if the pause is long enough, move into it; if not,
 * say this isn't a place to cut.
 */
function tightCut(words: readonly FilmWord[], atMs: number, where: 'in' | 'out'): { text: string; suggestMs?: number; reason: 'no-pause' | 'no-tail' | 'no-lead' } | null {
  const before = [...words].reverse().find((w) => (w.endSec ?? w.startSec) * 1000 <= atMs + 1);
  const after = words.find((w) => w.startSec * 1000 >= atMs - 1);
  if (!before || !after) return null;
  const endMs = (before.endSec ?? before.startSec) * 1000;
  const startMs = after.startSec * 1000;
  const gap = startMs - endMs;
  const text = where === 'out' ? before.token : after.token;
  if (gap < MIN_PAUSE_MS) return { text, reason: 'no-pause' };
  if (where === 'out' && atMs - endMs < TAIL_MS - 1) {
    return { text, reason: 'no-tail', suggestMs: Math.round(Math.min(endMs + TAIL_MS + 50, startMs - LEAD_MS)) };
  }
  if (where === 'in' && startMs - atMs < LEAD_MS - 1) {
    return { text, reason: 'no-lead', suggestMs: Math.round(Math.max(startMs - LEAD_MS - 40, endMs + TAIL_MS)) };
  }
  return null;
}

/** The picture covers only this much of the canvas; the rest is black bars. */
const MIN_FILL = 0.9;

/**
 * When landscape footage goes onto a portrait canvas (or vice versa), by default the whole frame
 * is fitted in (contain), leaving two big black bars.
 *
 * Filling it means computing the transform yourself — the scale is relative to the contained
 * frame and the offset to that frame's top-left corner, and in practice this is where agents go
 * wrong most: computing 2.25× from the source pixels and cropping the person out of frame, or only
 * scaling to 1.9× and still leaving black bars top and bottom on portrait. So the numbers needed to
 * fill are computed here and handed over; the agent only has to shift t[0] onto the subject.
 * Not reported when an MG is on screen at the same time: that may be a background, title card or
 * split screen, where the picture isn't meant to fill.
 */
function letterboxIssues(film: FilmEval, sizeOf: (src: string) => { w: number; h: number } | null, nameOf?: NameOf): CodeIssue[] {
  const out: CodeIssue[] = [];
  const W = film.stage.w, H = film.stage.h;
  for (const v of film.videos) {
    if (v.track?.hidden || v.track?.kind === 'mg') continue;
    const size = sizeOf(v.src);
    if (!size || !(size.w > 0 && size.h > 0)) continue;
    /* Video clips also count as scenes (track.kind is video); only look at the MG ones. */
    const mgAlongside = film.scenes.some((scene) => scene.track?.kind !== 'video'
      && scene.startMs < v.startMs + v.durMs && v.startMs < scene.startMs + scene.durMs);
    if (mgAlongside) continue;
    const k0 = Math.min(W / size.w, H / size.h);
    const w = size.w * k0, h = size.h * k0, x0 = (W - w) / 2, y0 = (H - h) / 2;
    const t = v.transform?.t ?? [0, 0];
    const sc = v.transform?.s ?? [1, 1];
    const left = x0 + t[0]!, top = y0 + t[1]!, right = left + w * sc[0]!, bottom = top + h * sc[1]!;
    const fill = (Math.max(0, Math.min(W, right) - Math.max(0, left)) * Math.max(0, Math.min(H, bottom) - Math.max(0, top))) / (W * H);
    if (fill >= MIN_FILL) continue;
    const k = Math.max(W / w, H / h);
    const round = (n: number) => Math.round(n * 100) / 100;
    const tx = Math.round((W - w * k) / 2 - x0), ty = Math.round((H - h * k) / 2 - y0);
    const txMin = Math.round(W - w * k - x0), txMax = Math.round(-x0);
    out.push({
      level: 'warn',
      what: `${called(v.src, nameOf)}${v.clipId ? ` (clip "${v.clipId}")` : ''} at ${s(v.startMs)} fills only ${Math.round(fill * 100)}% of the ${W}×${H} stage; the rest is black.`
        + ` To fill it: "transform": { "s": [${round(k)}, ${round(k)}], "t": [${tx}, ${ty}] } — then move t[0] between ${txMin} and ${txMax} to keep the subject in frame (look at the result).`
        + ' If cropping would cut off information at the sides (charts, screens, several people), keep the full picture in a band and fill the space above and below with MG titles or key points instead of leaving it black.',
    });
  }
  return out;
}

export function checkFilm(
  film: FilmEval,
  nameOf?: NameOf,
  /** Look up an asset's word timings. Cuts are only checked when given — without a transcript there's no telling where the speech is. */
  readWords?: (src: string) => SourceWords | null,
  /** Whether the audio is actually sounding at a cut. When given it wins; the word table is only used to name the word. */
  levelAt?: (src: string, atMs: number) => CutLevel | null,
  /** The asset's own dimensions (w/h in the ledger). Only when given is "picture doesn't fill the canvas" checked. */
  sizeOf?: (src: string) => { w: number; h: number } | null,
): CodeIssue[] {
  const issues: CodeIssue[] = [];
  if (sizeOf) issues.push(...letterboxIssues(film, sizeOf, nameOf));

  if (film.durationMs <= 0) {
    issues.push({ level: 'error', what: 'The film is empty: film.json has no clips yet. Write a scene under mg/ and place it on a track in film.json (see CLAUDE.md).' });
    return issues;
  }

  if (readWords) {
    /* Report each cut only once. Footage has a picture entry and its own sound entry; when both
       hit the same out point the message would print twice, word for word — and the reader would
       think there were two problems. */
    const said = new Set<string>();
    for (const cut of dirtyCuts(film, readWords, levelAt)) {
      const once = `${cut.src}@${Math.round(cut.atMs)}#${cut.where}`;
      if (said.has(once)) continue;
      said.add(once);
      const excerpt = cut.text.length > 20 ? `${cut.text.slice(0, 20)}…` : cut.text;
      const transcript = assetTranscriptPath(cut.src);
      if (cut.reason) {
        const point = `${called(cut.src, nameOf)}: the ${cut.where} point at ${s(cut.atMs)}`;
        issues.push({
          level: 'warn',
          what: cut.reason === 'sounding'
            ? `${point} lands while the recording is still sounding (${Math.round(cut.db!)} dB) — the transcript puts a word boundary here, but transcribed times drift and the audio says a sound is cut off.`
              + (cut.suggestMs !== undefined ? ` The nearest pause is at ${s(cut.suggestMs)}; put the ${cut.where} point there.` : ' There is no pause within 0.6s; choose a different place to cut.')
            : cut.reason === 'no-pause'
            ? `${point} sits between two words with no pause (next to "${excerpt}") — the speech runs straight through here, so the cut will sound clipped. Move it to a pause of at least ${MIN_PAUSE_MS / 1000}s, or keep the phrase whole.`
            : cut.reason === 'no-tail'
              ? `${point} is right on the end of "${excerpt}" as the transcript times it; transcribed word ends are early, so the last sound gets cut off. Put the out point at ${s(cut.suggestMs!)}, inside the pause.`
              : `${point} is right on the start of "${excerpt}"; the onset gets cut off. Put the in point at ${s(cut.suggestMs!)}, inside the pause.`,
        });
        continue;
      }
      issues.push({
        level: cut.certain ? 'error' : 'warn',
        what: `${called(cut.src, nameOf)}: the ${cut.where === 'in' ? 'in' : 'out'} point at ${s(cut.atMs)}`
          + (cut.certain ? ` cuts into speech — mid-word on "${excerpt}".`
            : ` is inside the ASR token "${excerpt}" near its boundary; the timestamp may be imprecise.`)
          + ' Select the complete intended phrase, then place the in point before its first sound and the out point after its last sound, in an available pause.'
          + (transcript ? ` Word timings are in ${transcript}; a gap of ${MIN_PAUSE_MS / 1000}s or more between cues is such a pause.` : '')
          + ' Do not nudge into tokens to clear this check or add a fixed offset across all clips. Listen to both sides together, including the breathing space.',
      });
    }
  }

  for (const { track, a, b } of overlaps(film)) {
    const by = Math.round((a.startMs + a.durMs - b.startMs)) / 1000;
    issues.push({
      level: 'warn',
      what: `tracks[${track}]: "${a.name ?? '?'}" (${s(a.startMs)}–${s(a.startMs + a.durMs)}) and `
        + `"${b.name ?? '?'}" (${s(b.startMs)}–${s(b.startMs + b.durMs)}) overlap by ${by}s on the same track — `
        + 'the later one covers the earlier one. Put it on its own track if you meant to stack them',
    });
  }

  // Direct footage with the same source clock and default framing contributes
  // the same pixels twice. MG can mask/crop its children in arbitrary CSS, so
  // its media declarations alone cannot establish visual duplication.
  const plainVideos = film.videos.filter(v => v.track?.kind === 'video'
    && !v.track.hidden && !v.transform && !filmSrcIsStill(v.src));
  for (let i = 0; i < plainVideos.length; i += 1) {
    for (let j = i + 1; j < plainVideos.length; j += 1) {
      const a = plainVideos[i]!, b = plainVideos[j]!;
      if (a.track!.index === b.track!.index || a.src !== b.src) continue;
      if (Math.abs((a.inMs - a.startMs) - (b.inMs - b.startMs)) > 0.001) continue;
      const from = Math.max(a.startMs, b.startMs);
      const to = Math.min(a.startMs + a.durMs, b.startMs + b.durMs);
      if (to - from <= 1) continue;
      const [upper, lower] = a.track!.index < b.track!.index ? [a, b] : [b, a];
      issues.push({
        level: 'warn',
        what: `tracks[${upper.track!.index}] "${upper.clipId ?? upper.src}" duplicates the same source frames as `
          + `tracks[${lower.track!.index}] "${lower.clipId ?? lower.src}" from ${s(from)} to ${s(to)}, with the same default framing.`
          + ' The stacked copy adds no distinct picture or B-roll. Review the upper picture layer; preserve the intended audio when simplifying.',
      });
    }
  }

  /* The background was placed on the top track. Layer order is "smaller index on top", and models'
     intuition often runs the other way: a full-length bg written as tracks[0] covers every content
     block below — the final film is background from start to finish, and check used to say
     nothing (the clips are all there and all playing, just invisible). The flash-tier model hit
     this in testing: a contact sheet of solid dark blue, and it delivered the film anyway. This
     doesn't apply when a transparent overlay (vignette, frame) is clearly intended, hence warn. */
  for (const hidden of coveredAllFilm(film)) {
    issues.push({
      level: 'warn',
      what: `tracks[${hidden.coverTrack}] "${hidden.coverName}" runs the whole film on a HIGHER layer than `
        + `${hidden.beneath} other picture block(s) — smaller track index sits on top, so if it paints a background`
        + ' it hides everything beneath it. Backgrounds belong on the last track (the bottom layer).'
        + ' A transparent overlay on top is fine — then ignore this',
    });
  }

  for (const hole of holes(film)) {
    issues.push({
      level: 'error',
      what: `Nothing on screen from ${s(hole.fromMs)} to ${s(hole.toMs)} — ${s(hole.toMs - hole.fromMs)} of black`,
    });
  }

  /* Sound running past the last picture = a black tail. This and the check above are two ends of
     the same problem, so the message has to say which side to change — cold-read testing showed
     that saying only "no picture" leaves the reader unsure whether to add picture or cut sound.
     Tolerance is one frame (25 ms), not 1 ms: on the agent side durations are all seconds with two
     decimals, so a music `time` computed against the picture end is naturally off in 10 ms steps
     — in testing, the flash model aligned the tail to 94.12 s per the receipt, the music ended at
     94.13 s, and it was blocked with "the last 0.01s is black", though 0.01 s is less than a
     frame and invisible to the eye. */
  const FRAME_MS = 25;
  if (film.durationMs > film.visualEndMs + FRAME_MS) {
    const tail = film.durationMs - film.visualEndMs;
    const over = film.sounds.filter((x) => x.startMs + x.durMs > film.visualEndMs + FRAME_MS);
    /* Music without a duration **fills the film's length**, so it always shows up in the tail — but
       it is following, not what stretches the film. Naming it too would send the reader to trim
       the music, after which the duration is unchanged and the tail is still there. */
    const cause = over.filter((x) => x.kind !== 'music');
    const who = (cause.length ? cause : over).map((x) => called(x.src, nameOf)).join(' · ');
    issues.push({
      level: 'error',
      what: `Sound runs to ${s(film.durationMs)} but the last picture ends at ${s(film.visualEndMs)}`
        + ` — the final ${s(tail)} is black. What holds the film open is ${who}.`
        + ' Either give it picture (give the last clip a longer `time`, or a longer MG `duration`) or shorten it'
        + (cause.length ? ' (music stretches to fit the duration, so trimming that changes nothing)' : ''),
    });
  }

  /* Narration running past its scene. The runtime deliberately doesn't cut speech off (that would
     make the user hear half a sentence), so this can only be flagged here — it may be deliberate
     (sound carrying over a cut is a standard technique), hence warn. */
  for (const sound of film.sounds) {
    if (sound.kind !== 'voice') continue;
    const scene = owningScene(film, sound);
    if (!scene) continue;
    const over = sound.startMs + sound.durMs - (scene.startMs + scene.durMs);
    if (over > 1) {
      issues.push({
        level: 'warn',
        what: `${called(sound.src, nameOf)} runs ${s(over)} past "${scene.label || 'this scene'}", the scene it sits in`
          + ' — it keeps talking into the next one. Fine if that is deliberate;'
          + ' otherwise give that clip a longer `time`, or its MG a longer `duration`',
      });
    }
  }

  /* Two narration clips overlapping = two people talking at once. The timeline doesn't block it
     (a clip lands where you drop it); this only flags it. A warning that doesn't block export —
     deliberate overlap (interrupting, back-and-forth) is a legitimate technique.

     "Talking" needs evidence: footage audio is treated as voice in the mix, but a stretch of
     traffic ambience isn't speech — the criterion is the word table; only transcribed or
     synthesized audio counts as someone talking. Without readWords (the code form) there's no
     evidence to check, so everything counts as before. This happened: generated b-roll ambience
     × narration always reported a false "two people talking", with not a single word in that
     video. */
  const spoken = (src: string): boolean => !readWords || !!readWords(src)?.words?.length;
  const voices = film.sounds.filter((x) => x.kind === 'voice' && !x.off && spoken(x.src));
  for (let i = 0; i < voices.length; i += 1) {
    for (let j = i + 1; j < voices.length; j += 1) {
      const a = voices[i]!;
      const b = voices[j]!;
      if (Math.min(a.startMs + a.durMs, b.startMs + b.durMs) - Math.max(a.startMs, b.startMs) > 1) {
        issues.push({
          level: 'warn',
          what: `${called(a.src, nameOf)} (${s(a.startMs)}–${s(a.startMs + a.durMs)}) overlaps `
            + `${called(b.src, nameOf)} (${s(b.startMs)}–${s(b.startMs + b.durMs)})`
            + ' — two people talking at once. Fine if that is deliberate; otherwise move one of them',
        });
      }
    }
  }

  /* A sound overlapping itself: placing it twice is normal, but if the two overlap in time it is
     an echo — completely invisible on a contact sheet, only audible. Narration is handled above
     (as an error); this only looks at sound effects and music. */
  const bySrc = new Map<string, { startMs: number; durMs: number }[]>();
  for (const sound of film.sounds) {
    if (sound.kind === 'voice') continue;
    const list = bySrc.get(sound.src) ?? [];
    for (const prev of list) {
      if (sound.startMs < prev.startMs + prev.durMs && prev.startMs < sound.startMs + sound.durMs) {
        issues.push({
          level: 'warn',
          what: `${called(sound.src, nameOf)} overlaps itself, placed at both ${s(prev.startMs)} and ${s(sound.startMs)}`
            + ` — the same sound on top of itself reads as an echo (it is ${s(sound.durMs)} long;`
            + ' library sfx often trail on long after the hit). Move one, or trim it with `durMs`',
        });
      }
    }
    list.push({ startMs: sound.startMs, durMs: sound.durMs });
    bySrc.set(sound.src, list);
  }

  /* Footage is used, yet there isn't a single sound — a mute film.

     Footage audio plays by default, so reaching this point has only one explanation: every clip
     was held down with `volume: 0`, and there is no sound elsewhere. Missing it looks like
     "picture is fine, check is all green, export succeeded", and only actually listening reveals
     the whole film is mute — which is why it is on this list. Holding down is written by hand, so
     this is a warn, not an error: a deliberately mute film can still be exported.

     Only real footage counts. Still images sit on the same picture track, and stills never had
     audio — a slideshow of images without sound isn't "someone held it down", it is simply what
     it is. Including them would make this message point at seven jpgs and say "you set volume to 0
     on every clip", sending the reader to look for a key that doesn't exist. They belong to the
     general check below. */
  const footage = film.videos.filter((v) => !filmSrcIsStill(v.src));
  if (footage.length && !film.sounds.length) {
    issues.push({
      level: 'warn',
      what: `This film uses ${footage.length} video clips and has no sound at all — the export is mute. `
        + 'Source audio plays by itself; something set `volume: 0` on every clip. '
        + 'Drop that to keep it, or put an audio clip on. '
        + 'Ignore this if you really do want a silent film',
    });
  } else if (!film.sounds.length && film.durationMs >= SILENT_FILM_MS) {
    /* Not a single sound in the whole film. Pure MG films get flagged too — a silent film makes no
       step fail, and "forgot the audio" and "meant to be silent" look identical on disk. Only
       flagged once it is too long to be a card: a three-second intro is often silent, and then
       this message would be noise. */
    issues.push({
      level: 'warn',
      what: `${s(film.durationMs)} of picture and not one sound — the export is silent. `
        + 'Put an audio clip on, or ignore this if you really do want a silent film',
    });
  }

  /* Music doesn't reach the end. This fits this list's criterion exactly: it compiles, runs, the
     picture is fine, and the last few seconds of the final film suddenly lose their bed — only
     found by listening, and no step in this chain listens. */
  const music = film.sounds.filter((x) => x.kind === 'music');
  if (music.length) {
    const musicEnd = Math.max(...music.map((x) => x.startMs + x.durMs));
    if (musicEnd < film.visualEndMs - 400) {
      issues.push({
        level: 'warn',
        what: `Music stops at ${s(musicEnd)} but the picture runs to ${s(film.visualEndMs)}`
          + ` — the last ${s(film.visualEndMs - musicEnd)} has no bed under it.`
          + ' Use a longer piece, loop it, or place another one to carry on',
      });
    }
  }

  return issues;
}

function counted(n: number, word: string): string {
  return n === 0 || n === 1 ? `${n} ${word}` : `${n} ${word}s`;
}

/** Pass = the film can be exported. Any error means Fail (exit code 1); warnings don't block export. */
export function formatCheck(film: FilmEval, issues: CodeIssue[]): string {
  const head = `${s(film.durationMs)} · `
    + `${counted(film.scenes.length, 'scene')} · ${counted(film.sounds.length, 'sound')}`;
  const errors = issues.filter((x) => x.level === 'error');
  const warns = issues.filter((x) => x.level === 'warn');
  const status = `${errors.length ? 'Fail' : 'Pass'} · ${counted(errors.length, 'error')} · ${counted(warns.length, 'warning')}`;
  if (!issues.length) return `${head}\n${status}`;
  return [
    head,
    `${status}:`,
    ...errors.map((x) => `✗ ${x.what}`),
    ...warns.map((x) => `⚠ ${x.what}`),
  ].join('\n');
}
