/**
 * Published MG projects (`assets/mg/<id>` clips) are prepared and versioned by AnimSpark Cloud;
 * their immutable builds never exist in a local workspace. The engine therefore knows none:
 * a film that places one fails with a clear message instead of rendering a hole.
 *
 * The signatures stay so the build, the runtime and the stamps keep one code path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePublishedMgSource } from '@animspark/core';
import type { FilmPreparedMgProject } from '@animspark/runtime';

export function readPublishedMgProjects(workspace: string): Record<string, FilmPreparedMgProject> {
  let doc: { tracks?: Array<{ clips?: Array<{ src?: string }> }> } = {};
  try { doc = JSON.parse(readFileSync(join(workspace, 'film.json'), 'utf8')); } catch { /* The document parser owns its errors. */ }
  for (const track of doc.tracks ?? []) for (const clip of track.clips ?? []) {
    const src = clip.src;
    if (src && parsePublishedMgSource(src) && existsSync(join(workspace, src, 'project.json'))) {
      throw new Error(`${src} is a published MG project from AnimSpark Cloud; its build is not in this workspace. Replace the clip with the MG's source under mg/.`);
    }
  }
  return {};
}

/** Cache-key component for published MG builds: always empty locally. */
export function publishedMgProjectsStamp(_workspace: string): string {
  return '';
}
