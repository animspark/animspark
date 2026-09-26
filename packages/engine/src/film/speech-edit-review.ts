import type { FilmSoundEntry, FilmWord } from '@animspark/core';

const seconds = (n: number) => Math.round(n * 1000) / 1000;
const text = (words: readonly FilmWord[]) => words.reduce((out, word) =>
  out + (/[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(word.token) ? ' ' : '') + word.token, '');

/** A readable paper edit, not a quality score. Regenerated from the current film and ledger. */
export function speechEditReview(sounds: readonly FilmSoundEntry[], book: Readonly<Record<string, readonly FilmWord[]>>) {
  const clips = sounds.filter(s => !s.off && s.durMs > 0 && book[s.src]?.length).map(s => {
    const words = book[s.src]!;
    const rate = s.rate ?? 1;
    const sourceIn = s.inMs / 1000, sourceOut = sourceIn + s.durMs * rate / 1000;
    const kept = words.filter(w => w.startSec < sourceOut && (w.endSec ?? w.startSec) > sourceIn);
    const first = kept[0], last = kept.at(-1);
    return {
      clipId: s.clipId ?? s.key, src: s.src, at: seconds(s.startMs / 1000), end: seconds((s.startMs + s.durMs) / 1000),
      sourceIn: seconds(sourceIn), sourceOut: seconds(sourceOut), text: text(kept),
      before: text(words.filter(w => (w.endSec ?? w.startSec) <= sourceIn && w.startSec >= sourceIn - 4)),
      after: text(words.filter(w => w.startSec >= sourceOut && w.startSec < sourceOut + 4)),
      headRoomSec: first ? seconds((first.startSec - sourceIn) / rate) : null,
      tailRoomSec: last?.endSec !== undefined ? seconds((sourceOut - last.endSec) / rate) : null,
      trimmed: sourceIn > 0.001 || words.some(w => w.startSec >= sourceOut),
    };
  }).sort((a, b) => a.at - b.at);
  if (!clips.some(c => c.trimmed)) return null;
  const joins = clips.slice(1).map((next, i) => {
    const prev = clips[i]!;
    return {
      from: prev.clipId, to: next.clipId, at: next.at,
      review: { from: seconds(Math.max(0, Math.min(prev.end, next.at) - 3)), to: seconds(Math.min(next.end, Math.max(prev.end, next.at) + 3)) },
      estimatedSpeechGapSec: prev.tailRoomSec !== null && next.headRoomSec !== null
        ? seconds(next.at - prev.end + prev.tailRoomSec + next.headRoomSec) : null,
    };
  });
  return {
    note: 'Unreviewed paper edit from source ASR. Read retained text in film order with before/after context. Head/tail room and speech gaps are estimates, not measured silence or proof of natural pacing; negative room may indicate a clipped token. Missing timings remain null. Inspect actual joined audio and picture at every new cut, including the first and last edge.',
    clips, joins,
  };
}
