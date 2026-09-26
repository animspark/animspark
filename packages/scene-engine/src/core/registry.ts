/**
 * Package registry: runtime registration of components and package docs.
 * Domain packages plug in through registerPackage(); the engine itself depends on no concrete component.
 *
 * ─── Package naming convention (see PACKAGE_NAMING.md) ──────────────────────
 *   Official top-level packages use <scope>/<name>, e.g. animspark/stem, animspark/music, animspark/document.
 *   The older <scope>/<category>-<name> form is still accepted for third-party or niche packages.
 *
 *   Every package must be picked in the matching phase to be injected; there are no always-on exceptions.
 *
 * Component names are one flat global namespace, but same-named variants across packages are allowed:
 *   1. at call time the variant whose params keys match best is picked automatically
 *   2. if that still cannot tell them apart, write packageName.ComponentName(...) (only that component needs the prefix)
 */
import type { ComponentDef, FunctionDef, Params } from './types';
import { registerStepParams, registerInterpolator } from '../compile/interpolate';

/* ───────────────────── Package name parsing ───────────────────── */

export interface PackageNameParts {
  scope: string;
  category: string;
  /** The part after category (may contain -, e.g. 'ds-tree-graph') */
  name: string;
  /** Full name, equal to the input string */
  full: string;
}

// Two valid forms:
//   1. top-level package <scope>/<name>            e.g. animspark/stem, animspark/music, animspark/document
//   2. domain package    <scope>/<category>-<name> subject/misc packages, e.g. animspark/misc-character
// It is a domain package only if the first segment is a known domain category (math/ai/cs/misc) followed by -;
// otherwise the whole segment is a flat name (so vega-lite counts as flat too).
const PKG_NAME_RE = /^([a-z][a-z0-9]*)\/([a-z][a-z0-9]*)(?:-([a-z0-9][a-z0-9-]*))?$/;

/** Parse a package name; flat names get category '' (empty = uncategorized, shown under "General"). Returns null if invalid. */
export function parsePackageName(full: string): PackageNameParts | null {
  const m = PKG_NAME_RE.exec(full);
  if (!m) return null;
  const scope = m[1]!;
  const head = m[2]!;
  const rest = m[3];
  if (rest !== undefined && (DOMAIN_CATEGORIES as readonly string[]).includes(head)) {
    return { scope, category: head, name: rest, full };
  }
  return { scope, category: '', name: rest !== undefined ? `${head}-${rest}` : head, full };
}

/** Domain category enum (used only to detect the <category>- prefix of domain packages and to group them). */
export const DOMAIN_CATEGORIES = ['math', 'ai', 'cs', 'misc'] as const;
/** Section keys for the package index/grouping: 'general' = flat base packages (no - category), the rest are domain categories. */
export const PACKAGE_CATEGORIES = ['general', ...DOMAIN_CATEGORIES] as const;
export type PackageCategory = (typeof PACKAGE_CATEGORIES)[number];

export const CATEGORY_LABEL_ZH: Record<PackageCategory, string> = {
  general: 'General',
  math: 'Math',
  ai: 'AI',
  cs: 'Computer Science',
  misc: 'Miscellaneous',
};

/** One variant of a same-named component (from some package) */
export interface ComponentsVariant {
  def: ComponentDef;
  packageName: string;
  paramKeys: Set<string>;
}

export interface FunctionsVariant {
  def: FunctionDef;
  packageName: string;
  paramKeys: Set<string>;
}

export class AmbiguousComponentError extends Error {
  constructor(
    readonly componentName: string,
    readonly packages: string[],
  ) {
    super(`Component "${componentName}" has ${packages.length} variants (${packages.join(', ')}); disambiguate with params or write ${packages[0]}.${componentName}(...)`);
    this.name = 'AmbiguousComponentError';
  }
}

export interface ScenePackage {
  /** Full package name, <scope>/<name> or <scope>/<category>-<name>; see PACKAGE_NAMING.md. */
  name: string;
  /**
   * Package description: one sentence on "what domain/capability this package covers", with no API or function shapes.
   * Packages only group things; the basic unit is the component. This sentence feeds the first round of package
   * matching, i.e. it is the package's own "LLM text".
   */
  doc: string;
  /** Full names of other required packages (injected along with this one by the runtime). */
  dependsOn?: string[];
  /** Derived field: filled in from parsePackageName(name); a manual value is overwritten. */
  scope?: string;
  /** Derived field: filled in from parsePackageName(name). */
  category?: PackageCategory | string;
  components?: ComponentDef[];
  /** Plain functions callable from TSX (they do not render on-screen elements directly), e.g. imgproc() */
  functions?: FunctionDef[];
  /** Function implementations injected for browser playback; keys match functions[].name. */
  functionImpls?: Record<string, unknown>;
  /** Tool names this package contributes to the agent (metadata only; the executors are injected by the server/runtime). */
  agentTools?: string[];
}

function paramKeysOf(c: ComponentDef): Set<string> {
  return new Set([
    ...Object.keys(c.paramDocs ?? {}),
    ...Object.keys(c.defaults ?? {}),
  ]);
}

function functionParamKeysOf(fn: FunctionDef): Set<string> {
  return new Set([
    ...Object.keys(fn.paramDocs ?? {}),
    ...Object.keys(fn.defaults ?? {}),
  ]);
}

/** Score a variant against the given params (+3 per known key, -5 per unknown key; no params = 0) */
export function scoreComponentParams(v: ComponentsVariant, params: Params): number {
  const keys = Object.keys(params).filter(k => params[k] !== undefined);
  if (!keys.length) return 0;
  let score = 0;
  for (const k of keys) {
    if (v.paramKeys.has(k)) score += 3;
    else score -= 5;
  }
  return score;
}

/** Variants with identical paramKeys cannot be told apart by params statically */
function variantsNeedPrefix(list: ComponentsVariant[]): boolean {
  if (list.length <= 1) return false;
  const sigs = new Set(list.map(v => [...v.paramKeys].sort().join('\0')));
  return sigs.size === 1;
}

export class Registry {
  private variants = new Map<string, ComponentsVariant[]>();
  private functionVariants = new Map<string, FunctionsVariant[]>();
  private packages = new Map<string, ScenePackage>();
  /** Component names that can only be called with a package prefix */
  private needsPrefix = new Set<string>();

  /** Build a subset registry from a package list (the packages that were read via read_doc, plus core packages) */
  static fromPackages(all: ScenePackage[], packageNames: Iterable<string>): Registry {
    const r = new Registry();
    const wanted = new Set(packageNames);
    for (const pkg of all) {
      if (wanted.has(pkg.name)) r.registerPackage(pkg);
    }
    return r;
  }

  registerPackage(pkg: ScenePackage): void {
    if (this.packages.has(pkg.name)) throw new Error(`Package registered twice: ${pkg.name}`);
    // Derive scope/category; an invalid name only warns, it does not throw (old names are allowed during the transition)
    const parts = parsePackageName(pkg.name);
    if (parts) {
      pkg.scope = parts.scope;
      pkg.category = parts.category;
    } else if (
      typeof globalThis !== 'undefined' &&
      (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV !== 'production'
    ) {
      console.warn(`[scene-engine] Package name "${pkg.name}" does not match <scope>/<name> or <scope>/<category>-<name>; see PACKAGE_NAMING.md`);
    }
    this.packages.set(pkg.name, pkg);
    for (const c of pkg.components ?? []) this.registerComponent(c, { packageName: pkg.name, allowVariant: true });
    for (const fn of pkg.functions ?? []) this.registerFunction(fn, { packageName: pkg.name, allowVariant: true });
  }

  registerComponent(c: ComponentDef, opts?: { packageName?: string; allowVariant?: boolean; overwrite?: boolean }): void {
    const list = this.variants.get(c.name) ?? [];
    if (list.length && !opts?.allowVariant && !opts?.overwrite) throw new Error(`Duplicate component name: ${c.name}`);
    if (opts?.overwrite) {
      const idx = list.findIndex(v => v.packageName === (opts.packageName ?? '_builtin'));
      if (idx >= 0) list.splice(idx, 1);
    }
    list.push({
      def: c,
      packageName: opts?.packageName ?? '_builtin',
      paramKeys: paramKeysOf(c),
    });
    this.variants.set(c.name, list);
    this.recomputePrefix(c.name);
    registerStepParams(c.name, c.stepParams);
    registerInterpolator(c.name, c.interpolate as never);
  }

  registerFunction(fn: FunctionDef, opts?: { packageName?: string; allowVariant?: boolean; overwrite?: boolean }): void {
    const list = this.functionVariants.get(fn.name) ?? [];
    if (list.length && !opts?.allowVariant && !opts?.overwrite) throw new Error(`Duplicate function name: ${fn.name}`);
    if (opts?.overwrite) {
      const idx = list.findIndex(v => v.packageName === (opts.packageName ?? '_builtin'));
      if (idx >= 0) list.splice(idx, 1);
    }
    list.push({
      def: fn,
      packageName: opts?.packageName ?? '_builtin',
      paramKeys: functionParamKeysOf(fn),
    });
    this.functionVariants.set(fn.name, list);
  }

  private recomputePrefix(name: string): void {
    const list = this.variants.get(name)!;
    if (variantsNeedPrefix(list)) this.needsPrefix.add(name);
    else this.needsPrefix.delete(name);
  }

  /** Resolve a variant by params; throws AmbiguousComponentError when they cannot be told apart */
  resolveComponent(name: string, params: Params = {}): ComponentsVariant {
    const list = this.variants.get(name);
    if (!list?.length) throw new Error(`Unknown component: ${name}`);
    if (list.length === 1) return list[0]!;
    if (this.needsPrefix.has(name)) throw new AmbiguousComponentError(name, list.map(v => v.packageName));

    const scored = list.map(v => ({ v, score: scoreComponentParams(v, params) }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    const second = scored[1];
    if (best.score <= 0 || (second && second.score === best.score)) {
      throw new AmbiguousComponentError(name, list.map(v => v.packageName));
    }
    return best.v;
  }

  resolveExplicit(name: string, packageName: string): ComponentsVariant {
    const v = this.variants.get(name)?.find(x => x.packageName === packageName);
    if (!v) throw new Error(`Unknown component: ${packageName}.${name} (the package is not loaded or has no such variant)`);
    return v;
  }

  /** Non-throwing resolveExplicit: exact variant lookup by package name + component name (full-path addressing); undefined if missing. */
  findVariant(name: string, packageName: string): ComponentsVariant | undefined {
    return this.variants.get(name)?.find(x => x.packageName === packageName);
  }

  /** Exact function variant lookup by package name + function name (full-path addressing); undefined if missing. */
  findFunctionVariant(name: string, packageName: string): FunctionsVariant | undefined {
    return this.functionVariants.get(name)?.find(x => x.packageName === packageName);
  }

  function(name: string, sourcePackage?: string): FunctionDef | undefined {
    if (sourcePackage) return this.findFunctionVariant(name, sourcePackage)?.def;
    const list = this.functionVariants.get(name);
    if (!list?.length) return undefined;
    return list.length === 1 ? list[0]!.def : list[0]!.def;
  }

  component(name: string, sourcePackage?: string): ComponentDef | undefined {
    if (sourcePackage) return this.resolveExplicit(name, sourcePackage).def;
    const list = this.variants.get(name);
    if (!list?.length) return undefined;
    return list.length === 1 ? list[0]!.def : list[0]!.def;
  }

  mustComponent(name: string, sourcePackage?: string): ComponentDef {
    const c = sourcePackage
      ? this.resolveExplicit(name, sourcePackage).def
      : this.component(name);
    if (!c) throw new Error(`Unknown component: ${name}`);
    return c;
  }

  hasComponent(name: string): boolean {
    return (this.variants.get(name)?.length ?? 0) > 0;
  }

  hasFunction(name: string): boolean {
    return (this.functionVariants.get(name)?.length ?? 0) > 0;
  }

  getVariants(name: string): readonly ComponentsVariant[] {
    return this.variants.get(name) ?? [];
  }

  isMultiVariant(name: string): boolean {
    return (this.variants.get(name)?.length ?? 0) > 1;
  }

  needsPackagePrefix(name: string): boolean {
    return this.needsPrefix.has(name);
  }

  packageForComponent(name: string, sourcePackage?: string): string | undefined {
    if (sourcePackage) return sourcePackage;
    const list = this.variants.get(name);
    return list?.length === 1 ? list[0]!.packageName : undefined;
  }

  packageForFunction(name: string, sourcePackage?: string): string | undefined {
    if (sourcePackage) return sourcePackage;
    const list = this.functionVariants.get(name);
    return list?.length === 1 ? list[0]!.packageName : undefined;
  }

  allPackages(): ScenePackage[] {
    return [...this.packages.values()];
  }

  allComponents(): ComponentDef[] {
    return [...this.variants.values()].map(list => list[0]!.def);
  }

  allFunctions(): FunctionDef[] {
    return [...this.functionVariants.values()].map(list => list[0]!.def);
  }

  allComponentVariants(): ComponentsVariant[] {
    return [...this.variants.values()].flat();
  }

  allFunctionVariants(): FunctionsVariant[] {
    return [...this.functionVariants.values()].flat();
  }

  fork(): Registry {
    const r = new Registry();
    r.variants = new Map([...this.variants.entries()].map(([k, v]) => [k, [...v]]));
    r.functionVariants = new Map([...this.functionVariants.entries()].map(([k, v]) => [k, [...v]]));
    r.packages = new Map(this.packages);
    r.needsPrefix = new Set(this.needsPrefix);
    return r;
  }

  paramsWithDefaults(componentName: string, params: Params, sourcePackage?: string): Params {
    const def = this.mustComponent(componentName, sourcePackage);
    return { ...def.defaults, ...params };
  }
}
