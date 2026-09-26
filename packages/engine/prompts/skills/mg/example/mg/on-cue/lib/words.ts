import { cue } from '@animspark/runtime';
import type { Chip } from '../components/Waveform';
import type { Sound } from '../sound';

/**
 * Place every word of a narration line at its measured second.
 *
 * `cue()` matches a phrase inside the flattened transcript (lower-case, punctuation and spaces
 * removed), so a short word can also match inside another: "the" is found first inside "Then".
 * Looking each word up together with its neighbour, and counting which occurrence of that pair
 * starts where the word starts, gives every word its own time without guessing.
 */
const bare = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

export function chipsFor(vo: Sound, words: readonly string[], hot?: string): Chip[] {
  const pieces = words.map(bare);
  const flat = pieces.join('');
  const offsets: number[] = [];
  let o = 0;
  for (const p of pieces) { offsets.push(o); o += p.length; }
  return words.map((word, i) => {
    const phrase = pieces[i]! + (pieces[i + 1] ?? '');
    const hits: number[] = [];
    for (let at = flat.indexOf(phrase); at >= 0; at = flat.indexOf(phrase, at + 1)) hits.push(at);
    const occurrence = hits.indexOf(offsets[i]!) + 1;
    const shown = words[i + 1] ? `${word} ${words[i + 1]}` : word;
    const c = cue(vo, shown, { occurrence: Math.max(1, occurrence) });
    const own = cue(vo, word, { occurrence: countBefore(flat, pieces[i]!, offsets[i]!) });
    return { word, at: c.start - (vo.at ?? 0), end: own.end - (vo.at ?? 0), hot: hot !== undefined && bare(word) === bare(hot) };
  });
}

/** Which occurrence of `piece` (1-based) starts at `offset` in `flat`. */
function countBefore(flat: string, piece: string, offset: number): number {
  let n = 0;
  for (let at = flat.indexOf(piece); at >= 0; at = flat.indexOf(piece, at + 1)) {
    n += 1;
    if (at === offset) return n;
  }
  return Math.max(1, n);
}
