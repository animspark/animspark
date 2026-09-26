/**
 * Media in the film doc whose duration lives in the file: source clips, and direct-link audio
 * that has no duration in the ledger.
 *
 * When a resolve has no `to`, the element's own duration is used, so these seconds are collected
 * before evaluating / bundling and injected into the generated entry.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { filmDocMediaSrcs, filmSrcIsStill, type FilmDoc } from '@animspark/core';

import { resolveAll, type MediaFactsStore, type MediaResolver } from '../media-resolver';
import { probe } from '../probe';
import { readPublishedMgProjects } from './published-mg';

export async function collectDocMediaSec(
  doc: FilmDoc,
  opts: {
    workspace: string;
    resolve?: MediaResolver;
    known?: MediaFactsStore;
  },
): Promise<Record<string, number>> {
  /* A still image has no duration to probe, yet ffprobe makes one up ("one frame, 0.04 s") and
     that number would be carried along as the file's length. See the note on filmDocMediaSrcs. */
  const projects = readPublishedMgProjects(opts.workspace);
  const projectMedia = new Set(Object.keys(projects).map((src) => src + '/media.webm'));
  const srcs = filmDocMediaSrcs(doc).filter((src) => !filmSrcIsStill(src) && !projectMedia.has(src));
  if (!srcs.length) return {};

  const resolve: MediaResolver = opts.resolve ?? (async (rel) => {
    const abs = join(opts.workspace, rel);
    return existsSync(abs) ? abs : null;
  });

  const out: Record<string, number> = {};
  const missing: string[] = [];
  for (const src of srcs) {
    const durMs = (await opts.known?.get(src))?.durMs;
    if (durMs != null && durMs > 0) out[src] = durMs / 1000;
    else missing.push(src);
  }
  if (!missing.length) return out;

  const found = await resolveAll(missing, resolve);
  for (const src of missing) {
    const abs = found.get(src);
    if (!abs) continue;
    const facts = await probe(abs).catch(() => null);
    if (facts?.durMs == null || facts.durMs <= 0) continue;
    out[src] = facts.durMs / 1000;
    await opts.known?.put?.(src, facts).catch(() => undefined);
  }
  return out;
}
