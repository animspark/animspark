/**
 * Rendering, shooting and bundled playback also need to resolve which element an override targets.
 *
 * Overrides find elements by source anchor (`data-animspark-source`; see filmOverrideSchema in core
 * and element-overrides in film-runtime). Anchors used to be injected only in the live preview — a
 * finished film shouldn't carry debug attributes. But once a film has overrides, without anchors the
 * export falls back to the unadjusted version: a line of text moved in the editor is still in its
 * old place in the delivered film.
 *
 * So anchors are injected only when film.json actually has overrides, and only into the files the
 * overrides name. For a film without overrides, the output is byte-for-byte what it was before.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { filmSourceAnchors } from './source-anchors';

/** Source files named by overrides in film.json (`mg/hook.tsx`). */
export function overrideFiles(doc: unknown): Set<string> {
  const files = new Set<string>();
  const tracks = (doc as { tracks?: unknown })?.tracks;
  if (!Array.isArray(tracks)) return files;
  for (const track of tracks) {
    const clips = (track as { clips?: unknown })?.clips;
    if (!Array.isArray(clips)) continue;
    for (const clip of clips) {
      const overrides = (clip as { overrides?: unknown })?.overrides;
      if (!Array.isArray(overrides)) continue;
      for (const o of overrides) {
        const at = (o as { at?: unknown })?.at;
        const m = typeof at === 'string' ? /^(.+):\d+:\d+$/.exec(at) : null;
        if (m) files.add(m[1]!);
      }
    }
  }
  return files;
}

/** The `rewrite` for compileFilmBrowser: undefined when there are no overrides (output unchanged). */
export function overrideAnchorRewrite(doc: unknown): ((source: string, path: string) => string) | undefined {
  const files = overrideFiles(doc);
  if (!files.size) return undefined;
  return (source, path) => (files.has(path) ? filmSourceAnchors(source, path) : source);
}

/** Read film.json from the workspace and build the rewrite. Unreadable means no overrides. */
export function overrideAnchorRewriteFor(workspace: string, doc?: unknown): ((source: string, path: string) => string) | undefined {
  if (doc !== undefined) return overrideAnchorRewrite(doc);
  const path = join(workspace, 'film.json');
  if (!existsSync(path)) return undefined;
  try {
    return overrideAnchorRewrite(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}
