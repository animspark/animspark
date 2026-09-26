/**
 * Doc generator: builds package docs (markdown cards) from the registry.
 * Docs come from the same source as the implementation, so prompts can never drift to an old syntax.
 */
import { CATEGORY_LABEL_ZH, PACKAGE_CATEGORIES, type Registry, type ScenePackage } from '../core/registry';

/** Package index (for package matching: grouped by section, one line per package = package description + a one-line description of each component) */
export function generateIndex(registry: Registry): string {
  return renderIndex(registry.allPackages());
}

/**
 * Capability menu (for a matching step): lists every Component / Function by section,
 * one line each = "full path + one-line summary", with **no API or usage**.
 * The API is left out on purpose: matching only picks capabilities; the full API for the picked ones
 * is supplied afterwards. Capability names that were not picked are not in the shot scope and throw a
 * ReferenceError, which stops "using it without matching it" at the source.
 */
export function generateComponentMenu(registry: Registry): string {
  const packages = registry.allPackages();
  const lines: string[] = [];
  const known = PACKAGE_CATEGORIES as readonly string[];
  const extra = Array.from(new Set(packages.map(packageCategory))).filter(c => !known.includes(c));
  const cats = [...known, ...extra];
  for (const cat of cats) {
    const pkgs = packages.filter(p => packageCategory(p) === cat);
    if (!pkgs.length) continue;
    for (const pkg of pkgs) {
      const comps = pkg.components ?? [];
      const fns = pkg.functions ?? [];
      // Matching only needs each pickable capability's full path + one line; no package titles, package docs or tool notes, which would distract from the choice.
      for (const c of comps) lines.push(`- \`${pkg.name}/${c.name}\` — ${c.doc}`);
      for (const fn of fns) lines.push(`- \`${pkg.name}/${fn.name}\` — ${fn.doc}`);
    }
  }
  return lines.join('\n').trimEnd();
}

/**
 * Parse a full component path `<scope>/<...>/<componentName>` → { packageName, componentName }.
 * Package names contain one `/` (e.g. animspark/stem) and component names contain none, so split at the last `/`.
 * Paths with no `/`, a trailing `/`, or no package segment return null.
 */
export function splitComponentPath(path: string): { packageName: string; componentName: string } | null {
  const trimmed = path.trim();
  const i = trimmed.lastIndexOf('/');
  if (i <= 0 || i === trimmed.length - 1) return null;
  const packageName = trimmed.slice(0, i);
  const componentName = trimmed.slice(i + 1);
  // The package name must contain at least one `/` (<scope>/<name>); otherwise it is not a valid full path.
  if (!packageName.includes('/')) return null;
  return { packageName, componentName };
}

/** Isolation-mode index: lists only allow-listed packages, with an isolation notice on top, so the model never sees package names it must not use. */
export function generateIsolatedIndex(registry: Registry, allowed: Set<string>): string {
  const all = registry.allPackages().filter(p => allowed.has(p.name));
  return [
    '# Available package index (isolation mode)',
    '',
    `**This task is a package-level isolation test**: you may use only the ${all.length} package(s) below (all other packages are unavailable; do not write them even if a component name looks familiar).`,
    'Isolation checks whether the target packages can carry the visuals on their own. Each package stands alone with no cross-package dependencies; if a capability is missing, the fix belongs in the package itself.',
    '',
    renderIndex(all),
  ].join('\n');
}

/** The package index is grouped by category; flat base packages (no - category, e.g. animspark/stem) go under "general". */
function packageCategory(pkg: ScenePackage): string {
  return pkg.category ? String(pkg.category) : 'general';
}

/** A package's index entry: (1) package description (first round: match packages) + (2) a one-line description per capability (second round: pick capabilities) + tools. */
function renderPackageEntry(pkg: ScenePackage, lines: string[]): void {
  const comps = pkg.components ?? [];
  const fns = pkg.functions ?? [];
  lines.push(`- **${pkg.name}** — ${pkg.doc}`);
  // One line per component: matching uses it to pick components for this film (skip what is not needed, e.g. plane geometry wants figure, not matrix).
  for (const c of comps) lines.push(`    - component \`${c.name}\` — ${c.doc}`);
  for (const fn of fns) lines.push(`    - function \`${fn.name}\` — ${fn.doc}`);
  if (pkg.agentTools?.length) lines.push(`    - tools: ${pkg.agentTools.join(', ')}`);
}

function renderIndex(packages: ScenePackage[]): string {
  const lines: string[] = [];
  // Every package follows the same rule: listed in section order (general → math → ai → cs → misc → others); no core special case, base packages are matched like any other.
  const known = PACKAGE_CATEGORIES as readonly string[];
  const extra = Array.from(new Set(packages.map(packageCategory))).filter(c => !known.includes(c));
  const cats = [...known, ...extra];
  for (const cat of cats) {
    const pkgs = packages.filter(p => packageCategory(p) === cat);
    if (!pkgs.length) continue;
    const title = CATEGORY_LABEL_ZH[cat as keyof typeof CATEGORY_LABEL_ZH] ?? cat;
    lines.push(`## ${title}`);
    for (const pkg of pkgs) renderPackageEntry(pkg, lines);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function docExampleValue(defaultValue: unknown): string {
  if (defaultValue !== undefined) return JSON.stringify(defaultValue) ?? 'undefined';
  return 'undefined';
}

/**
 * Render one component's LLM doc section.
 * The order follows conventional API docs: summary → API/Usage → Details → object model.
 */
function renderComponentDoc(
  c: NonNullable<ScenePackage['components']>[number],
  lines: string[],
  callName: string = c.name,
): void {
  const [iw, ih] = c.intrinsic(c.defaults);
  const meta = [`${Math.round(iw)}×${Math.round(ih)}`, c.textual ? 'text' : ''].filter(Boolean).join(' · ');
  // Component = summary (heading line) + API (call shape + inline param notes) + details (how to use it, optional) + object model.
  // Examples stay out of the LLM text so long examples do not bloat the main prompt.
  // callName defaults to the component name; when an import is aliased to avoid a name clash, the call shape uses the bound name (the model copies it verbatim).
  const jsxName = callName
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  lines.push(`### ${callName} — ${c.doc}`);
  lines.push('');
  lines.push('**API**');
  lines.push('```js');
  // Params whose doc starts with ▸ are "style params": the template already injects defaults, so they are hidden from
  // the LLM docs to keep the model from restyling away from the template's look. The full API (style params included)
  // is still shown to people on the dev page, and a special page can override them by passing them explicitly.
  const keys = Object.keys(c.paramDocs).filter(k => !String(c.paramDocs[k] ?? '').startsWith('▸'));
  if (!keys.length) {
    lines.push(`<${jsxName} id="obj" />  // ${meta}`);
  } else {
    const entries = keys.map(key => {
      const dflt = c.defaults[key];
      const code = dflt === undefined ? `  ${key}={...}` : `  ${key}={${docExampleValue(dflt)}}`;
      return { code, doc: c.paramDocs[key] ?? '' };
    });
    const pad = Math.min(34, Math.max(...entries.map(e => e.code.length)) + 1);
    lines.push(`<${jsxName}`);
    lines.push('  id="obj"');
    for (const e of entries) lines.push(`${e.code.padEnd(pad)}// ${e.doc}`);
    lines.push(`/>  // ${meta}`);
  }
  lines.push('```');
  lines.push('');

  if (c.details && c.details.trim()) {
    lines.push('**Details**');
    lines.push(c.details.trim());
    lines.push('');
  }

  if (c.objectModel) renderObjectModelDoc(c.objectModel, lines);
}

/** A component's full LLM doc (summary + details + API, no examples); bound to the component, so the dev page and the agent share one source.
 *  callName: when an import is aliased to avoid a name clash, render the call shape with the bound name. */
export function componentDoc(
  c: NonNullable<ScenePackage['components']>[number],
  callName?: string,
): string {
  const lines: string[] = [];
  renderComponentDoc(c, lines, callName);
  return lines.join('\n').trimEnd();
}

function renderFunctionDoc(
  fn: NonNullable<ScenePackage['functions']>[number],
  lines: string[],
  callName: string = fn.name,
): void {
  lines.push(`### ${callName} — ${fn.doc}`);
  lines.push('');
  lines.push('**API**');
  lines.push('```tsx');
  const keys = Object.keys(fn.paramDocs ?? {}).filter(k => !String(fn.paramDocs[k] ?? '').startsWith('▸'));
  if (!keys.length) {
    lines.push(`const value = ${callName}({});`);
  } else {
    lines.push(`const value = ${callName}({`);
    for (const key of keys) {
      const dflt = fn.defaults?.[key];
      const expr = dflt === undefined ? '...' : docExampleValue(dflt);
      lines.push(`  ${key}: ${expr},  // ${fn.paramDocs[key] ?? ''}`);
    }
    lines.push('});');
  }
  if (fn.returns) lines.push(`// returns: ${fn.returns}`);
  lines.push('```');
  lines.push('');
  lines.push('**Web Runtime usage**');
  lines.push('A Function does not render on-screen elements itself; it returns data, a resource or a control object for native HTML/CSS/GSAP or a Component to use.');
  lines.push('');
  if (fn.details && fn.details.trim()) {
    lines.push('**Details**');
    lines.push(fn.details.trim());
    lines.push('');
  }
}

export function functionDoc(
  fn: NonNullable<ScenePackage['functions']>[number],
  callName?: string,
): string {
  const lines: string[] = [];
  renderFunctionDoc(fn, lines, callName);
  return lines.join('\n').trimEnd();
}

/** Render "param name → type — description" as an aligned, copyable param block (each line: `  name,  // type — description`). */
function objectParamExampleValue(key: string, defaultValue: unknown): string {
  if (defaultValue !== undefined) return docExampleValue(defaultValue);
  if (key === 'at') return '7';
  if (key === 'from') return '0';
  if (key === 'to') return '3';
  if (key === 'label') return '"Label"';
  if (key === 'tone') return '"accent"';
  if (key === 'r') return '9';
  if (key === 'opacity') return '0';
  return '...';
}

function paramDocLines(paramDocs: Record<string, string>, defaults: Record<string, unknown> = {}): string[] {
  const keys = Object.keys(paramDocs).filter(k => !String(paramDocs[k] ?? '').startsWith('▸'));
  if (!keys.length) return [];
  const entries = keys.map(k => {
    const code = `${k}: ${objectParamExampleValue(k, defaults[k])},`;
    return { code, doc: paramDocs[k] ?? '' };
  });
  const pad = Math.min(28, Math.max(...entries.map(e => e.code.length)) + 1);
  return entries.map(e => `  ${e.code.padEnd(pad)}// ${e.doc}`);
}

/** Copyable call shape for one object factory (one param per line + inline notes); shared by the dev card and the LLM doc, so it never collapses into one long line. */
export function objectFactorySignature(o: { name: string; paramDocs: Record<string, string>; defaults?: Record<string, unknown> }): string {
  const pls = paramDocLines(o.paramDocs, o.defaults);
  if (!pls.length) return `obj.${o.name}({})`;
  return [`obj.${o.name}({`, ...pls, '})'].join('\n');
}

/** Object model listing: exposes only the object factories; child changes go through set/morph, or gsap on the container's params.children. */
function renderObjectModelDoc(model: NonNullable<ScenePackage['components']>[number]['objectModel'], lines: string[]): void {
  if (!model) return;
  if (model.objects.length) {
    lines.push('**Child objects / object factories**');
    lines.push('');
    lines.push('- First place the parent component in JSX, e.g. `<Xxx id="obj" ... />`; the runtime exposes a handle with the same name, `obj`.');
    lines.push('- Then call an object factory (e.g. `obj.point(...)`) inside `useGSAP()` to create child objects; they do not appear in JSX on their own.');
    lines.push('- A factory returns a child handle whose params are in `child.P`; after changing child params, call the parent\'s `obj.render` to redraw.');
    lines.push('');
    lines.push('```js');
    lines.push('// Full form:');
    lines.push('const child = obj.xxx({ ... });');
    lines.push('tl.to(child.P, { glow: 1, duration: 0.6, onUpdate: obj.render }, cue(vo, "phrase").start);');
    lines.push('```');
    lines.push('');
    lines.push('**Child objects you can create**:');
    lines.push('```js');
    model.objects.forEach((o, i) => {
      if (i) lines.push('');
      lines.push(`// ${o.doc}`);
      lines.push(objectFactorySignature(o));
    });
    lines.push('```');
    lines.push('');
  }
}

/**
 * Single-package doc: package = package description + the docs of all its components.
 * Packages only group things and have no LLM text of their own, so this just concatenates their component docs.
 * only: prune to the allow-list of components picked during matching (e.g. keep figure from plane geometry, drop matrix).
 */
export function generatePackageDoc(pkg: ScenePackage, only?: readonly string[]): string {
  const onlySet = only && only.length ? new Set(only) : null;
  const comps = (pkg.components ?? []).filter((c) => !onlySet || onlySet.has(c.name));
  const fns = (pkg.functions ?? []).filter((fn) => !onlySet || onlySet.has(fn.name));
  const lines = [`# Package ${pkg.name}`, '', pkg.doc, ''];
  if (comps.length) {
    lines.push('## Components');
    for (const c of comps) renderComponentDoc(c, lines);
  }
  if (fns.length) {
    lines.push('## Functions');
    for (const fn of fns) renderFunctionDoc(fn, lines);
  }
  return lines.join('\n');
}

/**
 * "Components available for this film": gathers every component picked during matching (flat across packages).
 * No package descriptions are needed here: only each component's summary + details + API.
 * Components that were not picked (e.g. matrix from plane geometry) do not appear.
 */
export function generateMatchedPackagesDoc(
  registry: Registry,
  matched: ReadonlyArray<{ name: string; components?: readonly string[] }>,
): string {
  const byName = new Map(registry.allPackages().map((p) => [p.name, p]));
  const blocks: string[] = [];
  for (const m of matched) {
    const pkg = byName.get(m.name);
    if (!pkg) continue;
    const onlySet = m.components && m.components.length ? new Set(m.components) : null;
    const comps = (pkg.components ?? []).filter((c) => !onlySet || onlySet.has(c.name));
    const fns = (pkg.functions ?? []).filter((fn) => !onlySet || onlySet.has(fn.name));
    for (const c of comps) blocks.push(componentDoc(c));
    for (const fn of fns) blocks.push(functionDoc(fn));
  }
  return blocks.join('\n\n──────────────────────────────────────────\n\n');
}

/**
 * Single-component doc: the full description of just one API.
 * One line locating the package + the component's full doc, and nothing about other components.
 */
export function generateComponentDoc(pkg: ScenePackage, componentName: string): string {
  // Per-API testing: strictly this one API's description.
  // No pkg.doc / pkg.usage: they list the package's other components and would break single-API isolation
  // (testing text() should show only text(), not even the other APIs of the same package).
  const c = (pkg.components ?? []).find((x) => x.name === componentName);
  if (c) {
    const lines = [`# Component ${c.name} — from ${pkg.name}`, '', '## Component reference'];
    renderComponentDoc(c, lines);
    return lines.join('\n');
  }
  const fn = (pkg.functions ?? []).find((x) => x.name === componentName);
  if (!fn) return `(package ${pkg.name} has no Component/Function named ${componentName})`;
  const lines = [`# Function ${fn.name} — from ${pkg.name}`, '', '## Function reference'];
  renderFunctionDoc(fn, lines);
  return lines.join('\n');
}

export function generateAllDocs(registry: Registry): Map<string, string> {
  const docs = new Map<string, string>();
  docs.set('INDEX.md', generateIndex(registry));
  for (const pkg of registry.allPackages()) {
    docs.set(`${pkg.name}.md`, generatePackageDoc(pkg));
  }
  return docs;
}
