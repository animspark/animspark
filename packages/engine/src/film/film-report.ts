/**
 * The timeline half of the `anim check` report.
 *
 * Reports only the numbers bash can't see: stage size, film length, and where each scene / video /
 * sound starts and ends. Captions (sentences split from the narration) and asset paths (already on
 * disk) are not here.
 *
 * Two kinds of numbers, kept apart: `start` / `end` / `duration` are the block's position in the
 * film (`start` is that block's `at` in film.json); `time` is which range of the asset's /
 * component's own timeline the block uses — same name and shape as the film.json field, so it can
 * be copied straight back. All in seconds.
 */

import type { FilmEval } from '@animspark/film-build';
import type { MediaEntry, SceneSpan, SoundEntry } from '@animspark/runtime';

function compact(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

function sec(ms: number): number | undefined {
  if (!Number.isFinite(ms)) return undefined;
  return Math.round(ms) / 1000;
}

function span(startMs: number, durMs: number): { start: number; end?: number; duration?: number } {
  const start = sec(startMs) ?? 0;
  const duration = sec(durMs);
  return {
    start,
    ...(duration != null ? { end: Math.round((start * 1000 + durMs)) / 1000, duration } : {}),
  };
}

/** The trim pair as film.json writes it: `[from, to]`, on the asset's / component's own timeline. */
function trim(start: number, duration: number): [number, number] {
  return [start, Math.round((start + duration) * 1000) / 1000];
}

/**
 * The name this block goes by on the timeline: its `id` from film.json (author-chosen, unique in
 * the film), falling back to the file name only when there is none.
 */
function nameOf(sc: { clipId?: string; label?: string }): string | undefined {
  return sc.clipId || sc.label || undefined;
}

/**
 * The picture block that contains this span. Narrowest first — a long block spanning cuts shouldn't
 * claim the whole range.
 */
function hostLabel(film: FilmEval, startMs: number, durMs: number): string | undefined {
  const endMs = startMs + (Number.isFinite(durMs) ? durMs : 0);
  const inside = film.scenes
    .filter((sc) => startMs >= sc.startMs && startMs < sc.startMs + sc.durMs)
    .sort((a, b) => a.durMs - b.durMs);
  const scene = inside.find((sc) => endMs <= sc.startMs + sc.durMs + 1) ?? inside[inside.length - 1];
  return scene ? nameOf(scene) : undefined;
}

/**
 * When film.json uses a reference, include the original text: `start` is the resolved number, `at`
 * is how it was derived (`"sc-02.end"`); likewise `durationRef` for a component `duration` given
 * as a reference. Blocks written with plain numbers have neither field.
 */
function refFields(x: { meta?: { atRef?: string; durRef?: string } }): Record<string, unknown> {
  return {
    ...(x.meta?.atRef ? { at: x.meta.atRef } : {}),
    ...(x.meta?.durRef ? { durationRef: x.meta.durRef } : {}),
  };
}

function sceneRow(film: FilmEval, sc: SceneSpan): Record<string, unknown> {
  const trimFrom = sc.anchor?.trimFrom;
  const duration = sec(sc.durMs);
  /* Report the `id`, not the file name. film.json requires ids to be unique; file names aren't —
     `mg/type/01` and `mg/plates/01` would both read "01", so "which block broke" points nowhere. */
  return compact({
    id: nameOf(sc),
    src: sc.src,
    ...span(sc.startMs, sc.durMs),
    ...refFields(sc),
    loc: sc.loc,
    ...(trimFrom != null && duration != null ? { time: trim(trimFrom, duration) } : {}),
  });
}

function videoRow(film: FilmEval, v: MediaEntry): Record<string, unknown> {
  const start = sec(v.inMs);
  const duration = sec(v.durMs);
  return compact({
    id: nameOf(v),
    src: v.src,
    ...span(v.startMs, v.durMs),
    ...refFields(v),
    ...(start && duration != null ? { time: trim(start, duration) } : {}),
    scene: hostLabel(film, v.startMs, v.durMs),
    loc: v.loc,
  });
}

function soundRow(film: FilmEval, x: SoundEntry): Record<string, unknown> {
  const trimStart = sec(x.inMs);
  const duration = sec(x.durMs);
  const attack = sec(x.attackMs ?? NaN);
  const start = sec(x.startMs) ?? 0;
  return compact({
    id: nameOf(x),
    kind: x.kind,
    src: x.src,
    cast: x.cast,
    text: x.text,
    ...span(x.startMs, x.durMs),
    ...refFields(x),
    ...(trimStart && duration != null ? { time: trim(trimStart, duration) } : {}),
    ...(attack != null ? { attack, hit: Math.round((start + attack) * 1000) / 1000 } : {}),
    fadeIn: sec(x.fadeInMs ?? NaN),
    fadeOut: sec(x.fadeOutMs ?? NaN),
    ...(x.gainDb ? { gainDb: x.gainDb } : {}),
    ...(x.duck ? { duck: true } : {}),
    source: sec(x.sourceDurMs ?? NaN),
    scene: hostLabel(film, x.startMs, x.durMs),
    loc: x.loc,
  });
}

/** Evaluated film → the report the agent reads. JSON.stringify drops `undefined`. */
export function filmReport(film: FilmEval): Record<string, unknown> {
  return {
    stage: film.stage,
    duration: sec(film.durationMs) ?? 0,
    visualEnd: sec(film.visualEndMs) ?? 0,
    ...(film.sourceFps != null ? { sourceFps: film.sourceFps } : {}),
    scenes: film.scenes.map((sc) => sceneRow(film, sc)),
    videos: film.videos.map((v) => videoRow(film, v)),
    sounds: film.sounds.map((x) => soundRow(film, x)),
  };
}

export function formatFilmJson(film: FilmEval): string {
  return `${JSON.stringify(filmReport(film), null, 2)}\n`;
}

/**
 * The `anim check` report: whether the film can ship, plus the timeline.
 *
 * **Validation comes first.** The scene and sound lists easily run to hundreds of lines, and agents
 * tend to read with `head` — an error buried at the end is as good as unreported. Pass / Fail and
 * the errors must be the first thing it sees.
 */
export function formatCheckJson(
  film: FilmEval,
  issues: readonly { level: 'error' | 'warn'; what: string }[],
  /** References in code and their resolved values (`mg/x.tsx: at('vo@[pours]') → 1.687`). */
  codeRefs: readonly string[] = [],
): string {
  const errors = issues.filter((x) => x.level === 'error').map((x) => x.what);
  const warnings = issues.filter((x) => x.level === 'warn').map((x) => x.what);
  return `${JSON.stringify({
    status: errors.length ? 'Fail' : 'Pass',
    errors,
    warnings,
    ...filmReport(film),
    ...(codeRefs.length ? { codeRefs } : {}),
  }, null, 2)}\n`;
}
