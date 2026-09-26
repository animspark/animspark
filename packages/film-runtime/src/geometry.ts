/**
 * `box` / `crop` / `fit` to concrete pixels and CSS.
 *
 * Together these fields answer two halves of one question: **which part of the asset to take**
 * (crop) and **where on the stage to put it** (box). "Cut the presenter out of a talking-head
 * video and put them in a small picture-in-picture at the bottom right" is both at once, which
 * is exactly why they must be computed separately: merged into one field, the presenter would
 * distort along with the frame whenever the aspect ratio changes.
 *
 * Both use 0-1 fractions: box is relative to the stage, crop to the asset itself. So when the
 * same doc switches from 16:9 to 9:16, the bottom-right inset stays at the bottom right
 * instead of drifting off-frame.
 *
 * This is pure arithmetic, with no React and no DOM, because "exactly which pixels does the
 * inset land on" is asked by both export and preview, and both must get the same answer. It
 * also lets tests pin it down directly.
 */

import type { FilmStage } from '@animspark/core/film';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pixel rect of the whole stage. Picture clips always fill it; composition is the module's job. */
export function stageRect(stage: FilmStage): Rect {
  return { left: 0, top: 0, width: stage.w, height: stage.h };
}

/**
 * How far the fade in/out pulls opacity down at this moment (0-1).
 *
 * When the two fades together exceed the clip length they are scaled down proportionally:
 * trimming a clip very short shouldn't make the fade-in and fade-out fight. (The same rule
 * lives on the audio side in core's `clipFadeMs`; this is the picture half.)
 */
export function fadeOpacity(
  clip: { durMs: number; fadeInMs?: number; fadeOutMs?: number },
  localMs: number,
): number {
  const dur = Math.max(0, clip.durMs);
  if (!dur) return 0;
  let wantIn = Math.max(0, clip.fadeInMs ?? 0);
  let wantOut = Math.max(0, clip.fadeOutMs ?? 0);
  if (!wantIn && !wantOut) return 1;
  const total = wantIn + wantOut;
  if (total > dur) {
    const k = dur / total;
    wantIn *= k;
    wantOut *= k;
  }
  const t = Math.min(Math.max(localMs, 0), dur);
  const rising = wantIn > 0 ? t / wantIn : 1;
  const falling = wantOut > 0 ? (dur - t) / wantOut : 1;
  return Math.min(1, Math.max(0, Math.min(rising, falling)));
}

/**
 * Stage scaling: fit stage.w x stage.h into the container, preserving aspect ratio, centered.
 *
 * The picture is always drawn in stage coordinates and scaled once as a whole, rather than
 * having each clip adapt to the container size itself. The cost of the latter would be the
 * same doc laying out differently in a small preview and in fullscreen, when the two pictures
 * the user sees should be exactly the same.
 */
export function stageFit(
  stage: FilmStage,
  container: { w: number; h: number },
): { scale: number; left: number; top: number } {
  if (!container.w || !container.h) return { scale: 1, left: 0, top: 0 };
  const scale = Math.min(container.w / stage.w, container.h / stage.h);
  return {
    scale,
    left: (container.w - stage.w * scale) / 2,
    top: (container.h - stage.h * scale) / 2,
  };
}
