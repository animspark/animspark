// Token specs for "Type a word and let it drop": fake (plausible) token ids and the deadpan next-token
// distributions shown above each token, film-making jokes, the sampled winner first.
// Keyed by the lyric word as typed; a leading space is part of every token after the first.
export type Cand = [text: string, p: number];
export interface TokSpec { id: number; dist: Cand[] }

export const TOKS: Record<string, TokSpec> = {
  Type: { id: 6030, dist: [['Type', 0.41], ['Write', 0.22], ['Imagine', 0.09], ['Pitch', 0.04]] },
  a: { id: 257, dist: [['a', 0.58], ['one', 0.24], ['the', 0.06], ['no', 0.02]] },
  word: { id: 1573, dist: [['word', 0.52], ['line', 0.21], ['scene', 0.09], ['budget', 0.02]] },
  and: { id: 290, dist: [['and', 0.66], ['then', 0.15], ['cut', 0.06], ['wait', 0.03]] },
  let: { id: 1309, dist: [['let', 0.44], ['watch', 0.19], ['make', 0.12], ['pray', 0.05]] },
  it: { id: 340, dist: [['it', 0.81], ['them', 0.07], ['go', 0.04], ['the studio', 0.02]] },
  drop: { id: 4268, dist: [['drop', 0.47], ['render', 0.21], ['ship', 0.12], ['go viral', 0.03]] },
};

/** The model's layers the letters fall through (deadpan labels, one per plane). */
export const LAYERS = [
  'embed', 'attn', 'mlp', 'attn', 'mlp', 'norm', 'attn', 'mlp', 'attn', 'mlp', 'attn · cast', 'mlp · crew',
  'attn', 'mlp · catering', 'attn', 'mlp', 'attn · continuity', 'mlp', 'attn', 'mlp · VFX', 'attn', 'mlp', 'norm', 'unembed',
];
