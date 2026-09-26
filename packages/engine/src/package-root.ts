/**
 * Where this package's own files and dependencies are, found by package resolution.
 *
 * The engine ships as TypeScript sources (run through tsx), so `src/` sits at the same place
 * relative to the package root in this repository and in `node_modules/animspark`. Other
 * packages are always resolved through Node's resolver from here, never by walking a
 * monorepo layout, so the same code works from a checkout and from an npm install.
 */
import { addLibRoot } from '@animspark/film-build';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** packages/engine (or node_modules/animspark). */
export const ENGINE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `require` as seen from this package: resolves its dependencies wherever the installer put them. */
export const engineRequire = createRequire(join(ENGINE_ROOT, 'package.json'));

/** Root directory of a dependency (every @animspark / @muspark package exports ./package.json). */
export function packageDir(name: string): string {
  return dirname(engineRequire.resolve(`${name}/package.json`));
}

/* Films import the libraries this package depends on (three, d3-*, @muspark/core …): make its
   node_modules chain the first place their bare imports resolve from. */
addLibRoot(ENGINE_ROOT);
