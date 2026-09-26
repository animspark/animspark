/**
 * Pitch-preserving time stretch: lengthens or shortens decoded audio by a speed factor without
 * changing pitch.
 *
 * Web Audio's `AudioBufferSourceNode.playbackRate` behaves like tape: double speed is an octave
 * higher, so narration sounds like a different voice as soon as it is sped up. The `<audio>` element
 * has `preservesPitch`; buffer sources do not. So this implements WSOLA (waveform-similarity
 * overlap-add): for each output hop, take a frame from the source, searching near the nominal
 * position for the point that joins most smoothly with the previous frame, then window and overlap
 * it. Across 0.5×–2×, speech sounds like the same person talking faster or slower.
 *
 * Computed once per speed change (the caller caches the result), not in real time: stretching a
 * film's narration takes a few hundred milliseconds, which JS can afford; doing it every frame could
 * not.
 */

/** Analysis/synthesis frame length (samples). 2048 @ 48k ≈ 43ms: long enough to cover a pitch period without smearing syllable boundaries. */
const FRAME = 2048;
/** Synthesis hop: 50% overlap. A periodic Hann window at this hop sums to exactly 1 at every sample, so no renormalization is needed. */
const HOP = FRAME >> 1;
/** How far to search either side of the nominal position (samples). Too narrow finds no phase-aligned point; too wide scrambles syllable order. */
const SEARCH = 640;
/** Step between search candidates, and the sample step of the correlation, both chosen to keep this pass down to tens of milliseconds. */
const CAND_STEP = 4;
const CORR_STEP = 4;

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

/**
 * Stretches `input` to `rate`× speed (rate 2 = half as long). When `rate` is 1 the same object is
 * returned unchanged. Multichannel audio finds alignment points on a mono mixdown and samples every
 * channel at the same offset: searching left and right separately would find two different
 * positions and smear the stereo image.
 */
export function timeStretchBuffer(ctx: BaseAudioContext, input: AudioBuffer, rate: number): AudioBuffer {
  if (!(rate > 0) || Math.abs(rate - 1) < 1e-3) return input;
  const channels = input.numberOfChannels;
  const inLen = input.length;
  if (inLen < FRAME * 2) return input;

  const outLen = Math.max(1, Math.ceil(inLen / rate));
  const out = ctx.createBuffer(channels, outLen, input.sampleRate);
  const inCh: Float32Array[] = [];
  const outCh: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    inCh.push(input.getChannelData(c));
    outCh.push(out.getChannelData(c));
  }
  let ref = inCh[0]!;
  if (channels > 1) {
    ref = new Float32Array(inLen);
    for (let c = 0; c < channels; c++) {
      const d = inCh[c]!;
      for (let i = 0; i < inLen; i++) ref[i] = ref[i]! + d[i]! / channels;
    }
  }

  const win = hann(FRAME);
  const analysisHop = HOP * rate;
  const lastStart = inLen - FRAME;
  let prev = 0;

  for (let k = 0; ; k++) {
    const outPos = k * HOP;
    if (outPos >= outLen) break;
    const natural = Math.min(lastStart, Math.round(k * analysisHop));
    let best = natural;

    if (k > 0) {
      /* The natural continuation of the previous frame: the HOP samples after it are the waveform
         the ear expects next. The more a candidate resembles it, the less phase cancellation (that
         "underwater" sound) the overlap produces. */
      const target = prev + HOP;
      if (target + HOP <= inLen) {
        const lo = Math.max(0, natural - SEARCH);
        const hi = Math.min(lastStart, natural + SEARCH);
        let bestScore = -Infinity;
        for (let cand = lo; cand <= hi; cand += CAND_STEP) {
          let s = 0;
          for (let i = 0; i < HOP; i += CORR_STEP) s += ref[target + i]! * ref[cand + i]!;
          if (s > bestScore) { bestScore = s; best = cand; }
        }
        /* After the coarse search, refine sample by sample around the best point: a step of 4 can leave the true peak between two candidates. */
        const fineLo = Math.max(lo, best - CAND_STEP + 1);
        const fineHi = Math.min(hi, best + CAND_STEP - 1);
        for (let cand = fineLo; cand <= fineHi; cand++) {
          if (cand === best) continue;
          let s = 0;
          for (let i = 0; i < HOP; i += CORR_STEP) s += ref[target + i]! * ref[cand + i]!;
          if (s > bestScore) { bestScore = s; best = cand; }
        }
      }
    }
    prev = best;

    const n = Math.min(FRAME, outLen - outPos);
    for (let c = 0; c < channels; c++) {
      const src = inCh[c]!;
      const dst = outCh[c]!;
      for (let i = 0; i < n; i++) {
        const o = outPos + i;
        dst[o] = dst[o]! + src[best + i]! * win[i]!;
      }
    }
  }
  return out;
}
