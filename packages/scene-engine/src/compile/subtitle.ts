/**
 * Subtitle segmentation: split a whole narration line into sentence-sized subtitle segments (about 15 characters / break at
 * punctuation), so the player shows only the current sentence or two instead of dumping a whole beat's 100 characters on screen.
 *
 * Key point: segmentation rules must be identical in the keyframe (compile.ts) and web (engine) pipelines, so they live here in
 * one place. With per-character timestamps (charOffsets) segments align per character; without them, time is spread
 * proportionally by character count.
 */

const CAP_PUNCT = /[，。！？；、,.!?;…—\n]/;

export interface SubtitleSegment {
  text: string;
  startMs: number;
  endMs: number;
  /**
   * Absolute start ms of each character in this segment (same length as text, optionally with 1 extra end stamp).
   * If present, the player lights characters up progressively by TTS timestamps; otherwise time is spread linearly within the segment.
   */
  charOffsetsMs?: number[];
  /** Speaker (cast key); set per turn in multi-speaker films, omitted in single-speaker films. */
  speaker?: string;
}

/** A speaker turn span within a beat's plain narration text ([from, to) character indices). */
export interface SpeakerTurnSpan {
  speaker: string;
  from: number;
  to: number;
}

/** When text is mostly Latin letters (English) the character limits need to be larger: 22 English characters is only three or four words. */
function isMostlyLatin(text: string): boolean {
  let latin = 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
    else if (/[A-Za-z]/.test(ch)) latin += 1;
  }
  return latin > cjk;
}

/** Plain-text segmentation: returns each segment's end character index in the original text (too-short trailing segments already merged). */
export function segmentNarrationCuts(text: string): number[] {
  const n = text.length;
  if (n === 0) return [];
  const latin = isMostlyLatin(text);
  const CAP_MIN = latin ? 24 : 8;
  const CAP_MAX = latin ? 56 : 22;
  const cuts: number[] = [];
  let i = 0;
  while (i < n) {
    const hardEnd = Math.min(i + CAP_MAX, n);
    let cut = -1;
    // Find the last punctuation mark in [i+CAP_MIN, hardEnd) and cut right after it (so a segment ends on punctuation such as "。" or ",").
    for (let j = i + CAP_MIN; j < hardEnd; j += 1) {
      if (CAP_PUNCT.test(text[j]!)) cut = j + 1;
    }
    // No punctuation: fall back to the last whitespace, never splitting a word in half.
    if (cut < 0 && hardEnd < n) {
      for (let j = hardEnd - 1; j > i + Math.max(1, Math.floor(CAP_MIN / 2)); j -= 1) {
        if (/\s/.test(text[j]!)) { cut = j + 1; break; }
      }
    }
    if (cut < 0) cut = hardEnd;
    // If what remains at the end is too short, merge it into the current segment so no lone one or two characters are left.
    if (n - cut > 0 && n - cut < CAP_MIN) cut = n;
    cuts.push(cut);
    i = cut;
  }
  return cuts;
}

/**
 * Split one narration line (starting at startMs, spoken over speakMs) into subtitle segments and compute each segment's absolute start/end ms.
 * charOffsets: character index -> relative ms when that character starts (optional; with it segments align per character, without it time is spread by character count).
 */
/** ElevenLabs audio tags ([whispers]/[laughs]/[sighs]...): voice-acting directions for TTS only, kept out of subtitles. */
const AUDIO_TAG_RE = /\[[a-z][a-z '-]{0,24}\]\s*/gi;

/**
 * Strip audio tags from subtitle text, and strip the charOffsets at the same indices (keeping per-character highlighting aligned).
 * Returns the input unchanged when there are no tags (zero-cost path).
 */
function stripAudioTags(
  text: string,
  charOffsets?: number[],
): { text: string; charOffsets?: number[] } {
  AUDIO_TAG_RE.lastIndex = 0;
  if (!AUDIO_TAG_RE.test(text)) return { text, charOffsets };
  const keep: boolean[] = new Array(text.length).fill(true);
  AUDIO_TAG_RE.lastIndex = 0;
  for (let m = AUDIO_TAG_RE.exec(text); m; m = AUDIO_TAG_RE.exec(text)) {
    for (let i = m.index; i < m.index + m[0].length; i += 1) keep[i] = false;
  }
  let stripped = '';
  const keptOffsets: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (!keep[i]) continue;
    stripped += text[i]!;
    if (charOffsets?.length) keptOffsets.push(charOffsets[Math.min(i, charOffsets.length - 1)] ?? 0);
  }
  if (charOffsets?.length) keptOffsets.push(charOffsets[Math.min(text.length, charOffsets.length - 1)] ?? 0);
  return { text: stripped, ...(charOffsets?.length ? { charOffsets: keptOffsets } : {}) };
}

export function segmentNarration(
  text: string,
  startMs: number,
  speakMs: number,
  charOffsets?: number[],
): SubtitleSegment[] {
  const cleaned = stripAudioTags(text, charOffsets);
  text = cleaned.text;
  charOffsets = cleaned.charOffsets;
  const n = text.length;
  if (n === 0) return [];
  const charStartMs = (i: number): number => {
    if (charOffsets && charOffsets.length) {
      return startMs + (charOffsets[Math.min(i, charOffsets.length - 1)] ?? (i / n) * speakMs);
    }
    return startMs + (i / n) * speakMs;
  };
  const cuts = segmentNarrationCuts(text);
  const segs: SubtitleSegment[] = [];
  let from = 0;
  for (const c of cuts) {
    const segText = text.slice(from, c).trim();
    if (segText) {
      // trim may have eaten whitespace at the from side: align timestamps to segText's real start in the original text.
      const trimmedFrom = text.indexOf(segText, from);
      const base = trimmedFrom >= 0 ? trimmedFrom : from;
      const absOffsets = charOffsets?.length
        ? Array.from({ length: segText.length + 1 }, (_, k) => charStartMs(Math.min(base + k, n)))
        : undefined;
      segs.push({
        text: segText,
        startMs: charStartMs(base),
        endMs: charStartMs(Math.min(base + segText.length, c)),
        ...(absOffsets ? { charOffsetsMs: absOffsets } : {}),
      });
    }
    from = c;
  }
  // End the last segment at "actual end of speech + 400ms buffer": speakMs may include trailing silence in the beat (>= 0.8s on showcase beats),
  // and always stretching to startMs+speakMs would leave the subtitle up after TTS finishes -> subtitles feel like they lag behind.
  if (segs.length) {
    const last = segs[segs.length - 1]!;
    const speechEndMs = charOffsets && charOffsets.length
      ? charStartMs(n)
      : startMs + speakMs;
    last.endMs = Math.min(startMs + speakMs, Math.max(last.startMs + 300, speechEndMs + 400));
  }
  return segs;
}

/**
 * Multi-speaker segmentation: cut the text by turn spans (SpeakerTurnSpan, plain-text indices) and segment each turn,
 * labeling every segment with its speaker; a segment never spans turns (one subtitle belongs to one person).
 * charOffsets are beat-wide (relative to the beat start) and stay relative to the beat start after slicing, so the timeline matches the single-speaker version.
 * With no turns / a single host turn this falls back to segmentNarration (byte-identical output).
 */
export function segmentNarrationWithTurns(
  text: string,
  startMs: number,
  speakMs: number,
  charOffsets?: number[],
  turns?: SpeakerTurnSpan[],
): SubtitleSegment[] {
  if (!turns?.length || (turns.length === 1 && turns[0]!.speaker === 'host')) {
    return segmentNarration(text, startMs, speakMs, charOffsets);
  }
  const n = text.length;
  if (n === 0) return [];
  const segs: SubtitleSegment[] = [];
  for (const turn of turns) {
    const from = Math.max(0, Math.min(turn.from, n));
    const to = Math.max(from, Math.min(turn.to, n));
    const sub = text.slice(from, to);
    if (!sub.trim()) continue;
    // With beat-wide offsets -> slice them directly (still relative to the beat start); without -> spread linearly over this turn's window by character share.
    const subOffsets = charOffsets?.length
      ? Array.from(
          { length: sub.length + 1 },
          (_, k) => charOffsets[Math.min(from + k, charOffsets.length - 1)] ?? 0,
        )
      : undefined;
    const subStartMs = subOffsets ? startMs : startMs + (from / n) * speakMs;
    const subSpeakMs = subOffsets ? speakMs : ((to - from) / n) * speakMs;
    for (const seg of segmentNarration(sub, subStartMs, subSpeakMs, subOffsets)) {
      segs.push({ ...seg, speaker: turn.speaker });
    }
  }
  // The +400ms tail buffer of a turn must not overlap the next turn's start (only one person's line on screen at a time).
  for (let i = 0; i + 1 < segs.length; i += 1) {
    if (segs[i]!.endMs > segs[i + 1]!.startMs) segs[i]!.endMs = segs[i + 1]!.startMs;
  }
  return segs;
}
