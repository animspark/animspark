/**
 * Timecode: `00:00:47:29`, i.e. hours:minutes:seconds:frames. This is the shape
 * editing software uses to report a moment in time.
 *
 * The last two digits are frames. The key point: **the document has no frames**.
 * Time is in milliseconds and the picture is composited live in the browser, so
 * there is no frame grid (see packages/core/src/film.ts). Those two digits are a
 * **readout scale**, not a unit of the document. Editors report positions in
 * frames ("second 47, frame 29"), while a decimal tenth of a second lines up with
 * nothing on the timeline. So we print 30 frames per second, matching CapCut's
 * default project frame rate.
 *
 * Because it is only a readout scale, there is no drop-frame timecode here (the
 * 29.97 semicolon syntax). There is no real frame rate to align to, and that
 * arithmetic would only make a number like "47:29" unpredictable.
 *
 * The width is fixed (`00:` is printed even under an hour): timecode is something
 * you watch closely, and if its width changes the whole line of text jitters.
 */

/** How many frames one second counts as when printing timecode. */
export const DISPLAY_FPS = 30;

const MS_PER_FRAME = 1000 / DISPLAY_FPS;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatTimecode(ms: number, opts?: { hours?: boolean }): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const secs = Math.floor(safe / 1000);
  /* Floor, don't round: at 0.9 frames it should read `:00` (that frame hasn't
     finished yet). Reading `:01` would advance the timecode a frame while the
     playhead is still sitting on the first frame. */
  const frames = Math.min(DISPLAY_FPS - 1, Math.floor((safe % 1000) / MS_PER_FRAME));
  const tail = `${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}:${pad(frames)}`;
  /* `hours: false`: when the whole film is under an hour, that field is always
     `00:` and only takes up space. The width is still fixed: the caller decides
     once based on film duration, so it never changes length within one film. By
     default the full form is printed. */
  if (opts?.hours === false && secs < 3600) return tail;
  return `${pad(Math.floor(secs / 3600))}:${tail}`;
}

/**
 * Short label for the timeline ruler.
 *
 * Whole seconds print as `mm:ss` (with an hours field past one hour); positions
 * between seconds print as `12f`, following OpenCut/CapCut. Writing full timecode
 * everywhere would turn the ruler into a row of `00:00:47:29` crammed into a wall,
 * when the point of a ruler is to tell you where you are at a glance.
 */
export function formatRulerLabel(ms: number): string {
  const safe = Math.max(0, ms);
  const frames = Math.round(safe / MS_PER_FRAME) % DISPLAY_FPS;
  if (frames !== 0) return `${frames}f`;
  const secs = Math.round(safe / 1000);
  const h = Math.floor(secs / 3600);
  const clock = `${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
  return h > 0 ? `${h}:${clock}` : clock;
}
