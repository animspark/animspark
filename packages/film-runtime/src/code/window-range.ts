/**
 * Whether the window `[start, start + dur)` is drawn at this moment.
 *
 * The interval is half-open: at a seam the next window takes over, so two windows never
 * overlap by a frame. The end of the film is the exception. With the playhead parked on the
 * film duration, a half-open check would unmount the block that exactly fills the film and
 * the picture would suddenly go black, when a finished `Hello.duration = 1` should hold its
 * last frame. So at the film duration we still draw the block that runs to the end; a black
 * tail where audio outlasts the picture is unaffected.
 */
export function windowShowsAt(
  timeMs: number,
  startMs: number,
  durMs: number,
  durationMs: number,
): boolean {
  if (durMs <= 0) return false;
  const endMs = startMs + durMs;
  if (timeMs >= startMs && timeMs < endMs) return true;
  return durationMs > 0 && timeMs >= durationMs && endMs >= durationMs && timeMs >= startMs;
}
