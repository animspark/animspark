import type { ParamValue } from './types';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function recordOf(value: ParamValue | undefined): Record<string, ParamValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, ParamValue>
    : {};
}

const PITCH_CLASS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function midiOf(pitch: unknown, fallback = 60): number {
  if (typeof pitch === 'number' && Number.isFinite(pitch)) return pitch;
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(pitch ?? ''));
  if (!match) return fallback;
  const letter = match[1]!.toUpperCase();
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return (Number(match[3]) + 1) * 12 + PITCH_CLASS[letter]! + accidental;
}

export function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

/**
 * Layout scale for the views: all coordinates are written against a 1280×720 design, then multiplied by this.
 * Text is additionally multiplied by 1.3 (see each view's font-size): a 13–14px label from the design is only 20px
 * on a 1080p stage and under 12px in a half-screen cell - unreadable in video. Only the text is enlarged, not the
 * positions, so the layout does not overflow when the box is short.
 */
export function videoScale(w: number, h: number): number {
  return Math.min(w / 1280, h / 720);
}
