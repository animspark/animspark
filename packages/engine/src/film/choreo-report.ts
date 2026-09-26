/**
 * Frozen-frame check: where the choreography ends vs how long the block runs.
 *
 * The "slideshow" failure — all tweens crammed into the first second or two while `duration` is set
 * to 18s to match the narration — is the most common and most visible flaw in agent-made films, and
 * `check` passes it: length, paths and sound are all fine, and check doesn't look at whether the
 * picture moves. Only the built timeline knows when motion ends. film-runtime records it per block
 * in a page global while building the timeline (`__filmChoreoEnds`, see reportChoreoEnd in
 * timeline), the shoot reads it when done (see shoot), and here it is compared against film.json
 * into warnings in the `look` report — look is how the agent inspects the picture, so the problem is
 * reported right where it shows.
 *
 * Only blocks that registered are reported: ones driven by useLocal, or by hand-written
 * interpolators with no duration, are absent because they can't be measured, not because they're
 * dead.
 */

interface ChoreoSpan {
  label: string;
  clipId?: string;
  /** Only mg blocks have it — a video block's picture comes from its source, not from choreography. */
  src?: string;
  startMs: number;
  durMs: number;
  /** Where on the module's own timeline playback starts, in ms (the `time: [start]` trim). */
  inMs?: number;
}

/**
 * Don't flag a frozen tail shorter than this — settling and holding a beat is normal film language;
 * ten-plus seconds without motion is the problem.
 */
const FROZEN_TAIL_SEC = 3;

/**
 * Registered choreography ends + film.json → a frozen-frame warning per block. A registered value of
 * 1e9 means "loops forever" (Infinity doesn't survive JSON).
 */
export function frozenTailWarnings(
  scenes: readonly ChoreoSpan[],
  choreoEnds: Readonly<Record<string, number>>,
): string[] {
  const out: string[] = [];
  for (const scene of scenes) {
    if (!scene.src || !scene.clipId) continue;
    const end = choreoEnds[scene.clipId];
    if (end == null || end >= 1e9) continue;
    /* The block shows the window [inMs, inMs+durMs) of the module's own clock; the choreography end
       is on that same clock. */
    const shownToSec = ((scene.inMs ?? 0) + scene.durMs) / 1000;
    const frozenSec = shownToSec - end;
    if (frozenSec <= FROZEN_TAIL_SEC) continue;
    const filmFrom = (scene.startMs / 1000).toFixed(1);
    const filmTo = ((scene.startMs + scene.durMs) / 1000).toFixed(1);
    out.push(
      `mg "${scene.label}": its timeline stops at ${end.toFixed(1)}s but the block plays to ${shownToSec.toFixed(1)}s `
      + `— the last ${frozenSec.toFixed(1)}s hold a frozen frame (on screen ${filmFrom}s–${filmTo}s). `
      + 'Choreograph across the whole duration: reveal things when the narration mentions them, keep an ambient layer moving between beats.',
    );
  }
  return out;
}
