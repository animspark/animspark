/**
 * Node-side WAV output.
 *
 * The encoder itself lives in wav.ts (the browser uses the same code); this only wraps the result in a Buffer.
 * The wrap is zero-copy: encodeWavStereo allocates a fresh, exclusively owned ArrayBuffer each call,
 * so we can create a view directly instead of copying several MB.
 */
import { encodeWavStereo } from './wav';

/** 16-bit PCM stereo WAV. */
export function wavBufferStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Buffer {
  const bytes = encodeWavStereo(left, right, sampleRate);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
