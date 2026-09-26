import { z } from 'zod';

// ──────────────────────────────────────────────────────────────
//  Aspect presets: single source of truth (HTML stage size / player scaling base / prompt canvas size)
// ──────────────────────────────────────────────────────────────

/** Supported aspect ratios (width:height). */
export const VIDEO_ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type StageAspect = (typeof VIDEO_ASPECTS)[number];
export const DEFAULT_ASPECT: StageAspect = '16:9';

/** Aspect → stage pixel size. Landscape anchors the height at 1080 and portrait anchors the width at 1080, so sharpness is consistent. */
export const STAGE_PRESETS: Record<StageAspect, { w: number; h: number }> = {
  '21:9': { w: 2520, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
  '4:3': { w: 1440, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
  '3:4': { w: 1080, h: 1440 },
  '9:16': { w: 1080, h: 1920 },
};

export function isVideoAspect(v: unknown): v is StageAspect {
  return typeof v === 'string' && (VIDEO_ASPECTS as readonly string[]).includes(v);
}

/** Resolves an aspect → stage size; unknown or missing falls back to 16:9. */
export function resolveStagePreset(aspect?: string): { w: number; h: number } {
  return isVideoAspect(aspect) ? STAGE_PRESETS[aspect] : STAGE_PRESETS['16:9'];
}

/** Aspect ratio value (width/height); unknown or missing falls back to 16/9. */
export function aspectRatioValue(aspect?: string): number {
  const p = resolveStagePreset(aspect);
  return p.w / p.h;
}

/**
 * Which aspect a w×h image is closest to; this is how `ratio: "adaptive"` is resolved.
 *
 * Compares **log distance**, not the difference: ratio space is multiplicative. 21:9 (2.33) and
 * 16:9 (1.78) differ by 0.55, while 3:4 (0.75) and 9:16 (0.5625) differ by only 0.19. Compared by
 * difference, portrait images would all be assigned to 3:4, yet those are the two most common portrait
 * sizes. Taking the log makes the scale symmetric on both sides.
 */
export function closestVideoAspect(width: number, height: number): StageAspect {
  if (!(width > 0) || !(height > 0)) return DEFAULT_ASPECT;
  const target = Math.log(width / height);
  let best: StageAspect = DEFAULT_ASPECT;
  let bestGap = Infinity;
  for (const aspect of VIDEO_ASPECTS) {
    const gap = Math.abs(Math.log(aspectRatioValue(aspect)) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = aspect;
    }
  }
  return best;
}

/**
 * Narrows a candidate aspect: use it if recognized, otherwise fall back to the default.
 *
 * Since the aspect button was retired on 2026-07-31, a new film's aspect is decided by the
 * preprocessing model (see scene/preflight-brief.ts in engine). This is the final gate on that path:
 * whatever upstream returns cannot go beyond these six presets. Stage sizes must land on even pixel
 * counts for H.264, and the player letterbox, posters and showcase wall layouts are all sized for
 * these six.
 */
export function coerceVideoAspect(v: unknown): StageAspect {
  return isVideoAspect(v) ? v : DEFAULT_ASPECT;
}

// ──────────────────────────────────────────────────────────────
//  Clean MP4: the picture source for showcase card hover previews
// ──────────────────────────────────────────────────────────────

/**
 * Films whose main content is shorter than this get an extra clean MP4 baked at publish time
 * (main content only, silent), which autoplays when a showcase card is hovered.
 *
 * The detail page does not use it: opening a film always renders playback live, for vector
 * sharpness.
 *
 * Why cut by duration: a hover preview is only worthwhile if it can play to the end, and the fixed
 * startup cost of the playback bundle (fetch the manifest, start the iframe, wait for fonts and
 * resources, sync the clock to <audio>) means that on a clip of a dozen seconds you wait longer than
 * you watch; with dozens of cards in the viewport it is worse. Conversely, a long film's MP4 grows
 * linearly per minute, and a few seconds of hover never gets through it, so it is not worth it.
 *
 * The 30s figure is based on the current catalog: all 166 capability shorts have main content of
 * 10–29.5s, while full films are almost all over 30s. The threshold sits in the gap between the two
 * groups, so no film needs a case-by-case "is this a short or a full film?" decision.
 */
export const CLEAN_MP4_MAX_CONTENT_SEC = 30;

/** Whether this film should get a clean MP4. The sole criterion on the publish/bake side; the frontend only checks whether the file exists. */
export function qualifiesForCleanMp4(contentSec: number): boolean {
  return Number.isFinite(contentSec) && contentSec > 0 && contentSec < CLEAN_MP4_MAX_CONTENT_SEC;
}

/** animspark-playback/1 —— legacy keyframe/canvas playback manifest. */
export const keyframePlaybackManifestSchema = z.object({
  format: z.literal('animspark-playback/1'),
  runtimeVersion: z.string(),
  title: z.string(),
  preset: z.string().optional(),
  totalMs: z.number(),
  scene: z.string(),
  audio: z.string(),
  runtime: z.string(),
  packages: z.array(z.object({
    name: z.string(),
    version: z.string(),
  })),
});
export type KeyframePlaybackManifest = z.infer<typeof keyframePlaybackManifestSchema>;

/** animspark-web-playback/1 —— fixed viewport HTML/CSS/SVG + native GSAP runtime manifest. */
export const webPlaybackManifestSchema = z.object({
  format: z.literal('animspark-web-playback/1'),
  runtimeVersion: z.string(),
  title: z.string(),
  totalMs: z.number(),
  entry: z.string(),
  /** Optional muxed video for pre-rendered films. One native media clock owns picture and sound. */
  video: z.string().optional(),
  audio: z.string(),
  /**
   * Stem manifest URL (relative to the manifest). When present, the browser assembles per-line
   * voice + music + sound effects live instead of playing the premixed `audio` track; this is what
   * lets editing avoid remixing the whole film for a one-word change. Packaged output omits this
   * field: shares, published films and examples always play `audio`.
   */
  stems: z.string().optional(),
  /**
   * Change-stream URL (relative to the manifest). While editing, whenever the source or sound
   * changes, the server pushes an event and the player updates in place. Packaged output omits this
   * field: once written to disk, a finished film never changes.
   */
  events: z.string().optional(),
  narration: z.string(),
  shotNarrations: z.array(z.string()).optional(),
  /** Subtitle segments per shot (about 15 characters, broken at punctuation), with absolute start/end ms in the film; the player shows only the current segment. */
  shotNarrationSegments: z.array(z.object({
    text: z.string(),
    startMs: z.number(),
    endMs: z.number(),
    /** Absolute start ms of each character in the segment; when present, characters light up progressively by TTS timestamps. */
    charOffsetsMs: z.array(z.number()).optional(),
    /** Speaker (cast key); multi-speaker films label each turn. */
    speaker: z.string().optional(),
  })).optional(),
  /** Speaker display names (cast key → label); when present, the player shows a name tag on subtitle segments that have a speaker. */
  cast: z.record(z.string(), z.object({ label: z.string() })).optional(),
  /**
   * The film draws its own subtitles (the source model's `<Captions/>` burns them into the picture).
   * When set, the player does not add its own subtitle layer, which would draw the same line twice.
   * The narration field remains; the share page uses it for a text preview.
   */
  captionsBurnedIn: z.boolean().optional(),
  aspect: z.string().default('16:9'),
  /** Stage pixel size (fixed HTML viewport); the player scales proportionally from it. Derived from aspect when absent. */
  stageWidth: z.number().optional(),
  stageHeight: z.number().optional(),
  shotMarks: z.array(z.object({
    tMs: z.number(),
    title: z.string(),
  })).optional(),
  /**
   * Workspace file names of the main-content scenes, in playback order.
   * The canvas/editor uses them to map "scene N" back to its source file (for the editScope of a
   * scoped re-shoot).
   */
  shotFiles: z.array(z.string()).optional(),
  /** Build/mix revision; incremented whenever audio.wav is rebuilt, and used by the player to bust caches. */
  buildRev: z.number().optional(),
});
export type WebPlaybackManifest = z.infer<typeof webPlaybackManifestSchema>;

export const playbackManifestSchema = z.discriminatedUnion('format', [
  keyframePlaybackManifestSchema,
  webPlaybackManifestSchema,
]);
export type PlaybackManifest = z.infer<typeof playbackManifestSchema>;
