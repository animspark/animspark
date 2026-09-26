/** Probed facts of a media file (recorded with an asset so it need not be probed again). */
export interface MediaMeta {
  /** Duration, milliseconds. */
  durMs?: number;
  /** Width, pixels. */
  w?: number;
  /** Height, pixels. */
  h?: number;
  fps?: number;
  /** Codec id, e.g. 'h264'. */
  codec?: string;
}
