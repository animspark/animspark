/**
 * Where the engine keeps bytes that are not part of a film.
 *
 *   <cache>/cache/   content-addressed media and build caches — safe to delete at any time
 *   <cache>/run/     per-machine runtime state: Chromium locks, indexes
 *
 * <cache> is $ANIMSPARK_HOME, else $XDG_CACHE_HOME/animspark, else ~/.cache/animspark.
 * A film's own files never leave its workspace folder. Files that ship with the engine are
 * found through package resolution (see package-root.ts), never relative to a checkout.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function varRoot(): string {
  const home = process.env.ANIMSPARK_HOME?.trim();
  if (home) return resolve(home);
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  return join(xdg ? resolve(xdg) : join(homedir(), '.cache'), 'animspark');
}
export function resolveCacheDir(): string { return join(varRoot(), 'cache'); }
export function runtimeRoot(): string { return join(varRoot(), 'run'); }
