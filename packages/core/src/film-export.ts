/**
 * What a packaged (exported) film looks like.
 *
 * This does not exist while editing: then the picture is live and the browser compiles and runs
 * film.tsx on the fly. The manifest is produced only when the film is handed off (share link,
 * download, publishing), and the recipient gets an mp4 that plays anywhere rather than a page that
 * needs our runtime.
 *
 * The snapshot directory must describe itself, because the path that fetches files (the share
 * proxy) only serves bytes by key and cannot tell which file is the entry point. The name stays
 * `manifest.json`: the share page has always fetched that first, and the legacy layout (the scenes
 * playback bundle) keeps its own manifest at the same location, so both generations of snapshot share
 * the "read the manifest first" step and differ only in `format`.
 */

import { z } from 'zod';

export const FILM_EXPORT_FORMAT = 'animspark-film-export/1' as const;

export const filmExportManifestSchema = z.object({
  format: z.literal(FILM_EXPORT_FORMAT),
  /** Rendered video file name (a path relative to the snapshot directory). */
  video: z.string().min(1),
  poster: z.string().min(1),
  /**
   * Sidecar captions (SRT). Absent when the film has no subtitles.
   *
   * Sidecar rather than burned in: size, position and on/off are the viewer's preference. Burning them
   * in makes that decision for everyone, and changing the style would mean re-rendering the whole film.
   */
  captions: z.string().min(1).optional(),
  durationMs: z.number().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  title: z.string().optional(),
});
export type FilmExportManifest = z.infer<typeof filmExportManifestSchema>;

/** Whether this manifest describes a film produced by the new pipeline. The legacy manifest has a different `format`, which is how the two are told apart. */
export function isFilmExportManifest(input: unknown): input is FilmExportManifest {
  return filmExportManifestSchema.safeParse(input).success;
}
