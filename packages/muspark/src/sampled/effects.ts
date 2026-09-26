/** Per-channel post-processing: soft clipping and tempo-synced delay. Reverb is handled centrally in render.ts. */
import type { ChannelEffects, DelaySpec } from '../score/types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

/**
 * tanh soft clipping. The normalizing divisor keeps the overall level steady as drive changes,
 * so only the curvature of the waveform changes.
 */
export function applyDrive(buffers: Float32Array[], drive: number): void {
  const amount = clamp(drive, 0, 1);
  if (amount <= 0) return;
  const gain = 1 + amount * 8;
  const norm = Math.tanh(gain);
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i += 1) {
      buffer[i] = Math.tanh(buffer[i]! * gain) / norm;
    }
  }
}

/**
 * Tempo-synced ping-pong delay: four repeats, swapping left and right on odd repeats.
 * The dry signal backs off slightly as mix rises, so the sum doesn't overload.
 */
export function applyDelay(
  left: Float32Array,
  right: Float32Array,
  spec: DelaySpec,
  bpm: number,
  sampleRate: number,
): void {
  const mix = clamp(spec.mix ?? 0, 0, 1);
  if (mix <= 0) return;

  const timeBeats = clamp(spec.timeBeats ?? 0.5, 0.0625, 8);
  const feedback = clamp(spec.feedback ?? 0.28, 0, 0.85);
  const delaySamples = Math.max(1, Math.round((timeBeats * 60) / bpm * sampleRate));

  const dryL = Float32Array.from(left);
  const dryR = Float32Array.from(right);
  const dryGain = 1 - mix * 0.18;
  for (let i = 0; i < left.length; i += 1) {
    left[i] = dryL[i]! * dryGain;
    right[i] = dryR[i]! * dryGain;
  }

  const REPEATS = 4;
  for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
    const amount = mix * Math.pow(feedback, repeat - 1);
    if (amount < 1e-4) break;
    const offset = delaySamples * repeat;
    if (offset >= left.length) break;
    const swap = repeat % 2 === 1;
    for (let i = 0; i + offset < left.length; i += 1) {
      const l = dryL[i]! * amount;
      const r = dryR[i]! * amount;
      left[i + offset] = left[i + offset]! + (swap ? r : l);
      right[i + offset] = right[i + offset]! + (swap ? l : r);
    }
  }
}

/** Effects signature of a channel. Channels with the same signature can be rendered as one batch. */
export function effectsKey(effects: ChannelEffects | undefined): string {
  if (!effects) return 'none';
  const drive = clamp(effects.drive ?? 0, 0, 1);
  const delay = effects.delay;
  const hasDelay = delay && clamp(delay.mix ?? 0, 0, 1) > 0;
  if (drive <= 0 && !hasDelay) return 'none';
  return [
    `d${drive.toFixed(3)}`,
    hasDelay
      ? `t${clamp(delay!.timeBeats ?? 0.5, 0.0625, 8).toFixed(4)}`
      + `f${clamp(delay!.feedback ?? 0.28, 0, 0.85).toFixed(3)}`
      + `m${clamp(delay!.mix ?? 0, 0, 1).toFixed(3)}`
      : 'nodelay',
  ].join('|');
}

/** Whether the channel needs to go through the post-processing path. */
export function needsPostProcessing(effects: ChannelEffects | undefined): boolean {
  return effectsKey(effects) !== 'none';
}
