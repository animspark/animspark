/**
 * Find the workspace.
 *
 * A workspace is, by definition, **the directory that has a film.json**, searched upwards.
 * We don't look at `.anim/task.json` or ask the platform, because this CLI has to work as a skill
 * handed to other coding agents, and those environments have no platform. Recognising a single file
 * is the lowest bar, and the only one that holds in every host.
 */

import { FILM_DOC_FILE } from '@animspark/core';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export { FilmCliError } from './cli-error';
import { FilmCliError } from './cli-error';

/** Is this directory currently a film? */
export function isFilmWorkspaceDir(dir: string): boolean {
  return existsSync(join(dir, FILM_DOC_FILE));
}

/**
 * The directory the user ran the command in. `anim` runs in-process, so this is the process
 * cwd; `anim new --dir demo` and the workspace search both start here.
 */
export function userCwd(): string {
  return process.cwd();
}

/** Look upwards from `start` for a workspace, and say what to do when there is none. */
export function findWorkspace(start: string = userCwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 24; i += 1) {
    if (isFilmWorkspaceDir(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new FilmCliError(
    `Looked upwards from ${resolve(start)} and found no film.json.`
    + '\nThis directory is not a workspace — cd into one, or open a new film with anim new.',
  );
}
