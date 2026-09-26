/**
 * Infer the required domain packages from shot sources, so a film still assembles when the model used
 * fingerCounter but forgot to call read_doc.
 * Only domain package components (non-CORE) are scanned; CORE is always injected by sessionRegistry in standard mode.
 */
import type { Registry } from '../core/registry';

/** Escape a component name for use in a regex */
function escRe(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Whether the sources use a component's JSX, e.g. <Mpl ... />. */
export function shotSourcesUseComponent(sources: string[], componentName: string): boolean {
  const jsxName = pascalCase(componentName);
  const re = new RegExp(`<${escRe(jsxName)}(?:\\s|/|>)`, 'm');
  return sources.some((s) => re.test(s));
}

/**
 * Scan shot sources and return the full names of domain packages to inject (e.g. animspark/stem-arith-anim).
 * @param corePackageNames packages already injected as CORE; not inferred again
 */
export function inferDomainPackagesFromShotSources(
  sources: string[],
  fullRegistry: Registry,
  corePackageNames: Iterable<string> = [],
): string[] {
  const core = new Set(corePackageNames);
  const joined = sources.join('\n');
  const needed = new Set<string>();
  for (const pkg of fullRegistry.allPackages()) {
    if (core.has(pkg.name)) continue;
    for (const c of pkg.components ?? []) {
      const jsxName = pascalCase(c.name);
      if (new RegExp(`<${escRe(jsxName)}(?:\\s|/|>)`, 'm').test(joined)) {
        needed.add(pkg.name);
        break;
      }
    }
    if (needed.has(pkg.name)) continue;
    for (const fn of pkg.functions ?? []) {
      if (new RegExp(`\\b${escRe(fn.name)}\\s*\\(`, 'm').test(joined)) {
        needed.add(pkg.name);
        break;
      }
    }
  }
  return [...needed];
}

/** Merge explicit read_doc records + source inference (deduplicated) */
export function mergeLoadedPackages(
  explicit: Iterable<string>,
  inferred: Iterable<string>,
): string[] {
  return [...new Set([...explicit, ...inferred])];
}
