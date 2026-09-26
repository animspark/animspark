/**
 * Modality: the form of a single asset. Currently only video (a narrated animated film rendered by scene-engine).
 */
export const MODALITIES = ['video'] as const;

export type Modality = (typeof MODALITIES)[number];

export function isModality(x: unknown): x is Modality {
  return typeof x === 'string' && (MODALITIES as readonly string[]).includes(x);
}

export const MODALITY_LABEL: Record<Modality, string> = {
  video: 'Video',
};
