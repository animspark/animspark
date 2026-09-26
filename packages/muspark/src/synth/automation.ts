import type { SynthEvent } from './event';

/** Same continuous channel gain/pan curve for both renderers, including sustained notes. */
export function eventMixAt(event: SynthEvent, timeSec: number): { gain: number; pan: number } {
  const points = event.automation;
  if (!points?.length) return { gain: event.gain, pan: event.pan };
  let left = points[0]!;
  if (timeSec <= left.timeSec) return { gain: 10 ** (left.gainDb / 20), pan: left.pan };
  for (let i = 1; i < points.length; i++) {
    const right = points[i]!;
    if (timeSec <= right.timeSec) {
      const t = (timeSec - left.timeSec) / (right.timeSec - left.timeSec);
      return {
        gain: 10 ** ((left.gainDb + (right.gainDb - left.gainDb) * t) / 20),
        pan: left.pan + (right.pan - left.pan) * t
      };
    }
    left = right;
  }
  return { gain: 10 ** (left.gainDb / 20), pan: left.pan };
}
