/**
 * Delivery frame: fitting a film into a frame of a different aspect ratio.
 *
 * **The film stays put; the frame goes around it.** To post a 16:9 film to a vertical feed, the
 * right move is to give it a 9:16 frame with the film centered inside and black bars above and
 * below, **not** to change `stage` to 1080×1920. Every coordinate in the film is hard-coded px for
 * the native stage; changing the stage invalidates all of them and the layout must be redone. That
 * is work for whoever writes the film (or the agent), not something a button can do.
 *
 * There are two ways to fit, chosen by `fill`:
 *
 * - `contain` (default): scale proportionally, center, add black bars. **Not a single pixel is
 *   cropped.** Anything cropped would be something the author placed there, and most people pressing
 *   this button mean "post it somewhere else", not "reframe it".
 * - `cover`: scale up to fill the frame and crop the overflow on two sides. No black bars, at the
 *   cost that **the edges are really gone**: 16:9 in 9:16 crops 42% off each side, which is usually
 *   where the text sits. So it is an explicit choice, not the default.
 *
 * Both touch **only the outer frame** and no coordinate in `film.tsx`. Truly re-laying out for
 * vertical (bigger text, recomposed shots, no bars) is the film author's job.
 *
 * Same reasoning as subtitles: the film is the source, framing is a delivery-time preference. So it
 * is not stored in `film.tsx` either; it is kept locally and sent along with the export request.
 */

/** A delivery frame. `native` = no frame; the output is the film's own size. */
export type FilmFrameId = 'native' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '21:9';

export const FILM_FRAME_IDS: FilmFrameId[] = [
  'native', '16:9', '9:16', '1:1', '4:5', '4:3', '21:9',
];

/** Each frame's ratio (width ÷ height). `native` has no fixed ratio; it follows the film. */
const FRAME_RATIO: Record<Exclude<FilmFrameId, 'native'>, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
};

export function filmFrameRatio(frame: FilmFrameId, stage: { w: number; h: number }): number {
  return frame === 'native' ? stage.w / Math.max(1, stage.h) : FRAME_RATIO[frame];
}

/** Round sizes to even numbers: H.264 subsamples chroma 2×2, and encoders reject odd dimensions outright. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * How the film fits inside the frame.
 *
 * `contain` adds black bars and crops nothing; `cover` fills the frame and crops the overflow. The
 * default is contain: losing picture must be something the user explicitly chose, not a default they
 * did not notice.
 */
export type FilmFrameFill = 'contain' | 'cover';

export const FILM_FRAME_FILLS: FilmFrameFill[] = ['contain', 'cover'];

export function parseFilmFrameFill(raw: unknown): FilmFrameFill {
  return raw === 'cover' ? 'cover' : 'contain';
}

export interface FilmFrameBox {
  /** Pixel size of the frame; the exported film has exactly this size. */
  w: number;
  h: number;
  /**
   * Position and size of the film inside the frame (after proportional scaling).
   *
   * With `cover`, `left` / `top` are negative: the film is larger than the frame, overflows on two
   * sides, and is clipped by the frame's overflow.
   */
  inner: { w: number; h: number; left: number; top: number; scale: number };
}

/**
 * Fits `stage` into `frame`, computing the frame size and the film's position inside it.
 *
 * The frame's **long side follows the film's long side** rather than a fixed set of resolutions: a
 * 4K film in a 9:16 frame should not drop to 1080 wide, and a 720p film should not be blown up to 4K
 * (upscaling adds no detail, only file size). The film's own resolution is the ceiling; the frame
 * only decides the shape.
 */
export function filmFrameBox(
  stage: { w: number; h: number },
  frame: FilmFrameId,
  fill: FilmFrameFill = 'contain',
): FilmFrameBox {
  const sw = Math.max(1, stage.w);
  const sh = Math.max(1, stage.h);
  if (frame === 'native') {
    return { w: even(sw), h: even(sh), inner: { w: sw, h: sh, left: 0, top: 0, scale: 1 } };
  }
  const ratio = FRAME_RATIO[frame];
  /* The frame must at least contain the film: compute it both ways and take the larger. */
  const byWidth = { w: sw, h: sw / ratio };
  const byHeight = { w: sh * ratio, h: sh };
  const box = byWidth.h >= sh ? byWidth : byHeight;
  const w = even(box.w);
  const h = even(box.h);
  /* contain takes the smaller scale (fits both ways, spare room gets bars); cover takes the larger
     (fills, the overflow is cropped). Both share the centering formula; under cover it naturally
     yields negative left/top, which is exactly "crop half the excess from each side". */
  const scale = fill === 'cover'
    ? Math.max(w / sw, h / sh)
    : Math.min(w / sw, h / sh);
  const iw = sw * scale;
  const ih = sh * scale;
  return {
    w,
    h,
    inner: { w: iw, h: ih, left: (w - iw) / 2, top: (h - ih) / 2, scale },
  };
}

/** Whether this frame has the same shape as the film's native stage (if so, framing changes nothing and no bars are needed). */
export function filmFrameIsNative(stage: { w: number; h: number }, frame: FilmFrameId): boolean {
  if (frame === 'native') return true;
  return Math.abs(stage.w / Math.max(1, stage.h) - FRAME_RATIO[frame]) < 0.01;
}

/**
 * This changes **the canvas itself**: the film simply becomes this aspect, with no frame and no
 * bars.
 *
 * The approach above (`filmFrameBox`) wraps a frame around the film, because changing `stage`
 * invalidates every hard-coded px coordinate in it. But while the workspace still holds only the
 * platform's starter template, there are no coordinates to invalidate: a user clicking 9:16 at that
 * moment means "this film is vertical", and the right thing to change is the `export const stage`
 * line in `film.tsx` (see /film/stage in engine). Once the film has content, this path closes and
 * framing takes over again.
 *
 * **1080p family: the short side is pinned at 1080.** Landscape height is 1080 (16:9 = 1920×1080,
 * 21:9 = 2520×1080) and portrait width is 1080 (9:16 = 1080×1920). Pinning the long side would make
 * 21:9 into 1920×822, squeezing ultrawide into a shorter strip instead of widening the canvas, which
 * looks wrong.
 */
const HD = 1080;

export function filmFrameStage(
  stage: { w: number; h: number },
  frame: FilmFrameId,
): { w: number; h: number } {
  if (frame === 'native') return { w: even(stage.w), h: even(stage.h) };
  const ratio = FRAME_RATIO[frame];
  return ratio >= 1
    ? { w: even(HD * ratio), h: even(HD) }
    : { w: even(HD), h: even(HD / ratio) };
}

/**
 * Which aspect this canvas has (`native` if none match).
 *
 * The change-canvas path uses it to check the right menu item: there is no frame then, so the
 * current value is the canvas's own shape.
 */
export function filmFrameOf(stage: { w: number; h: number }): FilmFrameId {
  return FILM_FRAME_IDS.find((id) => id !== 'native' && filmFrameIsNative(stage, id)) ?? 'native';
}

export function parseFilmFrame(raw: unknown): FilmFrameId {
  return typeof raw === 'string' && (FILM_FRAME_IDS as string[]).includes(raw)
    ? raw as FilmFrameId
    : 'native';
}
