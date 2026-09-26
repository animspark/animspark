/**
 * Scene package detection (stage "1. Installed" of the three-stage lifecycle): scans node_modules
 * and builds the catalog from the `animspark` field of each package.json, never importing package
 * code. A thousand installed packages cost a thousand small JSON reads.
 *
 * The engine only defines the contract (isAnimSparkPackage / AnimSparkPackageManifest /
 * DiscoveredPackage); scanning is the host's job.
 *
 * Default scan: the node_modules directories this package's own dependencies resolve from
 * (scene packages are direct dependencies of the CLI). They are found by package resolution,
 * so this works in the repository (pnpm links them into packages/engine/node_modules) and in
 * an npm install (where they are hoisted next to the CLI package).
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isAnimSparkPackage, type DiscoveredPackage, type AnimSparkAwarePackageJson } from '@animspark/scene-engine';
import { ENGINE_ROOT, engineRequire } from '../package-root';

/** The node_modules directories that hold this package's dependencies (scope dirs stripped). */
function hostNodeModules(): string[] {
  const dirs = new Set<string>();
  let deps: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(ENGINE_ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    deps = Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith('@animspark/'));
  } catch { /* no manifest: nothing to scan */ }
  for (const name of deps) {
    try {
      /* <nm>/@animspark/<pkg>/package.json → <nm>. Not realpath'd: pnpm's link sits in the
         directory we want; its target is a store path. */
      const pj = engineRequire.resolve(`${name}/package.json`);
      const linked = join(ENGINE_ROOT, 'node_modules', name, 'package.json');
      const at = existsSync(linked) ? linked : pj;
      dirs.add(dirname(dirname(dirname(at))));
    } catch { /* not installed */ }
  }
  return [...dirs];
}

function readDiscovered(pkgDir: string, npmName: string): DiscoveredPackage | null {
  const pj = join(pkgDir, 'package.json');
  if (!existsSync(pj)) return null;
  let json: AnimSparkAwarePackageJson;
  try {
    json = JSON.parse(readFileSync(pj, 'utf8')) as AnimSparkAwarePackageJson;
  } catch {
    return null;
  }
  if (!isAnimSparkPackage(json)) return null;
  let dir = pkgDir;
  try { dir = realpathSync(pkgDir); } catch { /* if the symlink can't be resolved, keep the original path */ }
  return { name: json.animspark.packageName, npmName, dir, manifest: json.animspark };
}

/**
 * Scans the given node_modules directories and returns every package marked with
 * animspark.scenePackage (deduplicated by name). Order is deterministic: sorted by name, so
 * registration order is stable.
 */
export function discoverScenePackages(
  nodeModulesDirs: readonly string[] = hostNodeModules(),
): DiscoveredPackage[] {
  const found = new Map<string, DiscoveredPackage>();
  const tryAdd = (pkgDir: string, npmName: string): void => {
    const d = readDiscovered(pkgDir, npmName);
    if (d && !found.has(d.name)) found.set(d.name, d);
  };
  for (const nm of nodeModulesDirs) {
    if (!existsSync(nm)) continue;
    for (const entry of readdirSync(nm)) {
      if (entry.startsWith('.')) continue;
      const entryPath = join(nm, entry);
      if (entry.startsWith('@')) {
        // scope directory: the packages are one level further down
        let subs: string[] = [];
        try { subs = readdirSync(entryPath); } catch { continue; }
        for (const sub of subs) {
          if (sub.startsWith('.')) continue;
          tryAdd(join(entryPath, sub), `${entry}/${sub}`);
        }
      } else {
        try { if (!statSync(entryPath).isDirectory()) continue; } catch { continue; }
        tryAdd(entryPath, entry);
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
