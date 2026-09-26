/**
 * 16-bit PCM stereo WAV encoding.
 *
 * Pure computation using only Uint8Array and DataView, no Buffer - the browser and Node run the same function,
 * so both produce identical bytes and the sound can never change just because the platform did.
 *
 * If Node needs a Buffer, use the thin wrapper in wav-node.ts, which is zero-copy.
 */
import { clamp } from './synth/dsp';

/** WAV header length: the fixed parts of the RIFF, fmt and data chunks. */
const HEADER_BYTES = 44;

function writeAscii(out: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) out[offset + i] = text.charCodeAt(i);
}

/**
 * Encode two Float32 channels into 16-bit PCM WAV bytes (44.1kHz-class sample rates).
 *
 * Uses the shorter of the two channel lengths and drops the rest - upstream always passes equal lengths, this is just defensive.
 * Samples are clamped to [-1, 1], then multiplied by 32767 and rounded. The clamp is the same one the render path uses,
 * so NaN is handled the same way too (it falls to the lower bound); byte-for-byte consistency doesn't rely on callers sanitizing first.
 */
export function encodeWavStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Uint8Array {
  const frames = Math.min(left.length, right.length);
  const dataBytes = frames * 4;
  const out = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);

  writeAscii(out, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(out, 8, 'WAVE');
  writeAscii(out, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);      // PCM
  view.setUint16(22, 2, true);      // channel count
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);  // byte rate
  view.setUint16(32, 4, true);      // bytes per frame
  view.setUint16(34, 16, true);     // bit depth
  writeAscii(out, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < frames; i += 1) {
    view.setInt16(44 + i * 4, Math.round(clamp(left[i]!, -1, 1) * 32767), true);
    view.setInt16(46 + i * 4, Math.round(clamp(right[i]!, -1, 1) * 32767), true);
  }
  return out;
}
