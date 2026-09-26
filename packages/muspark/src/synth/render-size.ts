/** Validate before allocating or silently changing the declared playback duration. */
export function renderFrames(durationSec: number, sampleRate: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 3600) throw new Error('render duration must be > 0 and ≤ 3600 seconds');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('sampleRate must be an integer between 8000 and 192000');
  return Math.ceil(durationSec * sampleRate);
}

/** Reject misspelled or obsolete render controls instead of silently ignoring them. */
export function validateRenderScoreOptions(options: unknown, bankKey: 'soundfont' | 'soundBank'): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('render options must be an object');
  for (const key of Object.keys(options)) {
    if (key !== 'sampleRate' && key !== bankKey) throw new Error(`render options.${key}: unknown field; playback duration belongs to Score`);
  }
  const values = options as Record<string, unknown>;
  if (values.sampleRate !== undefined) renderFrames(1, values.sampleRate as number);
  if (bankKey === 'soundfont' && values.soundfont !== undefined
    && (typeof values.soundfont !== 'string' || !values.soundfont.trim())) throw new Error('render options.soundfont must be a nonempty path');
}
