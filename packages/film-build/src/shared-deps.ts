/**
 * How the foundation gets into a film's bundle — what stays outside and is injected by the host,
 * and what each bundle packs itself.
 *
 * **Foundation** libraries (react / all of gsap / runtime) must be **singletons**: two copies of
 * React make hooks throw immediately, and with two copies of gsap, plugins register on the wrong
 * instance and silently stop working. So they stay out of the bundle; the host hangs a table on
 * the page and the bundle takes them from it.
 *
 * **Extensions** (drawing libraries such as three / matter-js / roughjs / p5 / d3) don't need to
 * be singletons. They are imported normally and esbuild bundles them in. The cost is that two
 * places using three get two copies — which doesn't matter at the scale of one film.
 */

import { type Plugin } from 'esbuild';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GSAP_PLUGIN_SHARED_SPECS } from './gsap-shared';

/** packages/film-build/src → this package's root (the same in the monorepo and in node_modules). */
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ownRequire = createRequire(import.meta.url);

/**
 * Where bare imports in a film resolve from (three / matter-js / roughjs / p5 / d3-* /
 * world-atlas / @muspark/core / @animspark/data …).
 *
 * A film's workspace sits outside every node_modules tree, so esbuild and Node are told
 * where to look (`nodePaths`). Those libraries are dependencies of the CLI package
 * (`animspark`), not of this one, so the list is the node_modules lookup chain of the CLI
 * package first, then this package's own chain. It is found by package resolution, never by
 * a monorepo layout:
 *   - the CLI registers itself at start-up (`addLibRoot`, see packages/engine/bin/anim.mjs);
 *   - otherwise `animspark` is resolved from here (npm / global installs, where it is hoisted
 *     next to this package), or found as the workspace sibling in this repository.
 *
 * The array is shared and mutated in place: callers read it when they build.
 */
export const LIB_PATHS: string[] = [];

function nodeModulesChain(pkgDir: string): string[] {
  let dir = pkgDir;
  try { dir = realpathSync(pkgDir); } catch { /* keep the given path */ }
  const chain = (Module as unknown as { _nodeModulePaths(from: string): string[] })._nodeModulePaths(dir);
  return chain.filter((p) => existsSync(p));
}

/** Put a package's node_modules lookup chain in front of LIB_PATHS (idempotent). */
export function addLibRoot(pkgDir: string): void {
  const chain = nodeModulesChain(pkgDir).filter((p) => !LIB_PATHS.includes(p));
  LIB_PATHS.unshift(...chain);
}

/** Resolve a bare specifier the way a film's imports resolve (first LIB_PATHS hit wins). */
export function resolveFromLibPaths(spec: string): string {
  for (const dir of LIB_PATHS) {
    try { return createRequire(join(dir, '..', '__anim_lib__.js')).resolve(spec); } catch { /* next */ }
  }
  return ownRequire.resolve(spec);
}

function findCliPackage(): string | null {
  try { return dirname(ownRequire.resolve('animspark/package.json')); } catch { /* not hoisted next to us */ }
  const sibling = join(PKG_DIR, '..', 'engine');
  try {
    const pkg = JSON.parse(readFileSync(join(sibling, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name === 'animspark') return sibling;
  } catch { /* not in the monorepo */ }
  return null;
}

addLibRoot(PKG_DIR);
const cli = findCliPackage();
if (cli) addLibRoot(cli);

/** Dependencies injected by the host and kept out of the bundle. */
export const SHARED_DEPS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'gsap',
  /* Both the main entry and the official plugin subpaths use the host singleton, so importing plugins one by one as the official docs show doesn't bundle a second core. */
  'gsap/all',
  ...GSAP_PLUGIN_SHARED_SPECS,
  /* The official React hook shares the host GSAP; the host wires its context into the film clock. */
  '@gsap/react',
  '@animspark/runtime',
] as const;

/** The variable name in the bundle through which the host injects dependencies. */
export const DEPS_PARAM = '__ANIM_MG_DEPS__';

/**
 * '@animspark/stem' inside a film always resolves to its film entry (see stem's src/film.ts).
 *
 * The `.` entry has the shape of the scene architecture: Mpl emits render tokens for the old
 * canvas compositor (which the film's DOM `<svg>` can't consume; it needs the direct-paint version
 * in the film entry), imgproc belongs to @animspark/image and doesn't travel with films, and the
 * defs carry thousands of words of authoring-time docs. This substitution must apply on **every**
 * compile path — node evaluation (check), frame export, and the product preview (code-host imports
 * the film entry directly). Missing one causes a split: check and preview giving two answers for
 * the same film is worse than either being wrong.
 *
 * esbuild's alias option isn't used: it matches by prefix, and '@animspark/stem/film' itself has
 * that prefix, so it would be rewritten to '@animspark/stem/film/film'. This only matches the bare
 * name **exactly**.
 */
export function stemFilmAliasPlugin(): Plugin {
  return {
    name: 'anim-stem-film-entry',
    setup(b) {
      b.onResolve({ filter: /^@animspark\/stem$/ }, (args) => b.resolve('@animspark/stem/film', {
        kind: args.kind,
        resolveDir: args.resolveDir,
        importer: args.importer,
      }));
    },
  };
}

/**
 * Replace react / gsap / runtime with "take it from the injected table".
 *
 * It is written as `module.exports = ...` so esbuild uses CJS interop: `import { useState } from
 * 'react'` in a film compiles to a property access, and React's export names don't have to be
 * listed here one by one — such a list would eventually miss one, and the missing name would only
 * blow up at runtime.
 */
export function sharedDepsPlugin(): Plugin {
  const escaped = SHARED_DEPS.map((d) => d.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&'));
  const filter = new RegExp(`^(${escaped.join('|')})$`);
  return {
    name: 'anim-shared-deps',
    setup(b) {
      b.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'anim-shared' }));
      b.onLoad({ filter: /.*/, namespace: 'anim-shared' }, (args) => ({
        contents: `module.exports = ${DEPS_PARAM}[${JSON.stringify(args.path)}];`,
        loader: 'js',
      }));
    },
  };
}
