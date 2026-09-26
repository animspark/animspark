/** Which frames an MG preview (look) shoots: explicit times, an interval at an fps, or the scene starts. */
import type { MgPreviewRequest } from '../llm/mg-preview-contract';

export interface MgPreviewTiming {
  /** Length of the MG, seconds. */
  dur: number;
  /** Scene start times, seconds (the default sample). */
  sceneTimes: number[];
}

export function mgPreviewTimes(metadata: MgPreviewTiming, request: MgPreviewRequest = {}): number[] {
  let times: number[];
  if (request.at !== undefined) times = [request.at];
  else if (request.times !== undefined) times = [...request.times];
  else if (request.time || request.from !== undefined || request.to !== undefined || request.fps !== undefined) {
    const from = request.time?.[0] ?? request.from ?? 0;
    const to = request.time?.[1] ?? request.to ?? metadata.dur;
    const fps = request.fps ?? Math.min(1, 40 / (to - from));
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(fps) || from < 0 || to <= from || to > metadata.dur || fps <= 0 || fps > 30) throw new Error('Preview interval is outside this MG or has an invalid fps.');
    const count = Math.ceil((to - from) * fps - 1e-10);
    if (count > 40) throw new Error('Preview would exceed 40 frames. Narrow the interval or lower fps.');
    times = Array.from({ length: count }, (_, i) => from + i / fps);
  } else times = metadata.sceneTimes.length ? [...metadata.sceneTimes] : [metadata.dur / 2];
  if (!times.length || times.length > 40) throw new Error('Preview needs 1–40 frames. Select a narrower range or explicit times.');
  if (times.some((time) => !Number.isFinite(time) || time < 0 || time >= metadata.dur)) throw new Error('Preview time is outside the prepared MG.');
  return times;
}
