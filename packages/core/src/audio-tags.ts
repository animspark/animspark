/**
 * Inline performance markers in narration (audio tags): ElevenLabs v3's bracketed delivery
 * directions such as [laughs], [whispers], [short pause]. Convention: lowercase English letter words
 * (spaces, ' and - allowed), at least 2 letters, which keeps them distinct from ranges and indices in
 * the prose ([0,1], [i], [Note]).
 *
 * How each consumer treats them (single source of truth; speech synthesis and display both read
 * from here):
 *  - TTS models that understand audio tags: tags go into the synthesis text verbatim, and tag
 *    characters are removed from the timestamp alignment;
 *  - other TTS: tags are stripped before synthesis (not spoken);
 *  - display (subtitles / at() anchor words / duration estimates): always the stripped plain text.
 *
 * It lives in core so speech synthesis and subtitles (line-broken in packages/film-runtime) share
 * one copy.
 */

/** The tag plus one trailing space (after stripping, "hello [laughs] world" → "hello world"). */
const AUDIO_TAG_SOURCE = /\[[a-z][a-z '-]{1,30}\] ?/;

function audioTagRe(): RegExp {
  return new RegExp(AUDIO_TAG_SOURCE.source, 'g');
}

export function textHasAudioTags(text: string): boolean {
  return AUDIO_TAG_SOURCE.test(text);
}

/** Strips all audio tags and collapses the runs of spaces they leave behind (for display and non-v3 synthesis). */
export function stripAudioTags(text: string): string {
  if (!textHasAudioTags(text)) return text;
  return text.replace(audioTagRe(), '').replace(/ {2,}/g, ' ').trim();
}

/**
 * Removes the characters that belong to audio tags from per-character alignment points (ElevenLabs
 * v3's alignment includes tag characters, while subtitles and at() align against the stripped text).
 * The point texts are concatenated in order and run through the same regex; every point inside a
 * match is dropped. The audio timeline is unchanged (points are only removed, never shifted). If
 * upstream already removed the tags, this is naturally a no-op.
 */
export function stripAudioTagAlignmentPoints<T extends { text: string }>(points: T[]): T[] {
  const joined = points.map((p) => p.text).join('');
  if (!textHasAudioTags(joined)) return points;
  // Index in the joined string → point index (a point's text may be more than one character).
  const pointOfChar = new Array<number>(joined.length);
  let cursor = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = 0; j < points[i]!.text.length; j += 1) pointOfChar[cursor++] = i;
  }
  const drop = new Set<number>();
  const re = audioTagRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined))) {
    for (let k = m.index; k < m.index + m[0].length; k += 1) {
      const idx = pointOfChar[k];
      if (idx != null) drop.add(idx);
    }
  }
  if (!drop.size) return points;
  return points.filter((_, i) => !drop.has(i));
}
