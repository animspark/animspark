/**
 * Developer platform API: builds structured component docs from the registry.
 * Same source as generatePackageDoc (the same ComponentDef); used by the /dev page's function cards.
 */
import type { ComponentDef, FunctionDef, Params } from '../core/types';
import type { Registry, ScenePackage } from '../core/registry';
import { componentDoc, functionDoc, objectFactorySignature } from './docs';

function pascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export interface DevDocApiParam {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
  description?: string;
}

/** How an object model entry (object factory / verb / attachable component) is shown on a dev card */
export interface DevDocApiEntry {
  name: string;
  signature: string;
  description: string;
}

export interface DevDocApiMethod {
  id: string;
  name: string;
  kind: 'component' | 'function';
  summary: string;
  signature: string;
  params: DevDocApiParam[];
  /** Component details (how to use it, markdown); optional, simple components have none. */
  details?: string;
  /** The LLM doc text bound to this component (summary + details + API, no examples); the component carries its own docs. */
  llmText?: string;
  /** Only for container objects (that declare objectModel): the child object factories. */
  objects?: DevDocApiEntry[];
}

export interface DevDocApiPackage {
  id: string;
  title: string;
  description: string;
  importPath: string;
  builtin: boolean;
  methods: DevDocApiMethod[];
}

const TEXT_KEYS = new Set(['s', 'label', 'title', 'unit', 'centerText', 'caption']);

function demoString(key: string, componentName: string): string {
  if (key === 's') {
    if (componentName === 'title') return 'Chapter title';
    if (componentName === 'badge') return 'Key';
    if (componentName === 'callout') return 'Look here';
    return `${componentName} example`;
  }
  if (key === 'label') return 'Label';
  if (key === 'title') return 'Panel';
  if (key === 'unit') return '';
  if (key === 'centerText') return '62%';
  if (key === 'caption') return 'Caption';
  return 'Example';
}

/**
 * Fill defaults out into showcase params that make it obvious what the component does.
 *
 * The component's own `showcase` is applied first: copy that makes factual claims about data
 * (titles, units, data sources) is always left empty in defaults (see ComponentDef.defaults), and the
 * nice-looking copy lives only here. Text keys still empty after that fall back to demoString.
 */
function showcaseParams(c: ComponentDef): Params {
  const p: Params = JSON.parse(JSON.stringify({ ...c.defaults, ...c.showcase }));
  if (c.name === 'html' && !p.src) {
    p.src = '<div style="display:flex;flex-direction:column;gap:16px;color:var(--ink)"><div style="font-size:64px;font-weight:800;color:var(--primary)">HTML info card</div><div style="font-size:32px;color:var(--muted)">Headings, body text, tables and UI can all be expressed with inline CSS</div></div>';
  }
  if (c.name === 'svg' && !p.src) {
    p.src = '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" fill="var(--accent)"/><path d="M38 64l16 16 30-40" fill="none" stroke="white" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  if (c.name === 'formula' && !p.tex) {
    p.tex = 'x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}';
  }
  for (const [key, val] of Object.entries(p)) {
    if (TEXT_KEYS.has(key) && (val === '' || val === undefined)) {
      p[key] = demoString(key, c.name);
    }
  }
  if ('values' in p && Array.isArray(p.values)) {
    const nums = p.values as number[];
    if (!nums.length || nums.every(v => v === 0)) p.values = [3, 7, 5, 4];
  }
  if ('series' in p && Array.isArray(p.series) && !(p.series as unknown[]).length) {
    p.series = [[10, 14, 18, 22, 28], [10, 11, 12, 13, 14]];
  }
  if ('progress' in p && typeof p.progress === 'number' && p.progress >= 1) p.progress = 0;
  if ('filled' in p && typeof p.filled === 'number' && p.filled >= 1) p.filled = 0;
  if (c.name === 'formula' && Array.isArray(p.toks) && !(p.toks as unknown[]).length) {
    p.toks = [
      { s: 'a', italic: true },
      { sup: '2', tone: 'accent' },
      { s: ' + b' },
      { sup: '2', tone: 'primary' },
      { s: ' = c' },
      { sup: '2', tone: 'positive' },
    ];
  }
  return p;
}

function formatValue(v: unknown, indent: string): string {
  if (v === undefined) return 'undefined';
  const json = JSON.stringify(v, null, 2);
  if (!json.includes('\n')) return json;
  return json.split('\n').map((line, i) => (i === 0 ? line : indent + line)).join('\n');
}

/** A single component's JSX call shape (with inline comments, matching the package docs). */
export function renderComponentSnippet(c: ComponentDef, pkgPrefix?: string): string {
  void pkgPrefix;
  const jsxName = pascalCase(c.name);
  const params = showcaseParams(c);
  const keys = Object.keys(c.paramDocs);
  const [iw, ih] = c.intrinsic(params);
  const meta = [`${Math.round(iw)}×${Math.round(ih)}`, c.textual ? 'text' : ''].filter(Boolean).join(' · ');
  if (!keys.length) return `<${jsxName} id="demo" />  // ${meta}`;
  const entries = keys.map(key => {
    const val = formatValue(params[key] ?? c.defaults[key], '    ');
    return { code: `  ${key}={${val}}`, doc: c.paramDocs[key] ?? '' };
  });
  const pad = Math.min(36, Math.max(...entries.map(e => e.code.length)) + 1);
  const lines = [`<${jsxName}`, '  id="demo"'];
  for (const e of entries) lines.push(`${e.code.padEnd(pad)}// ${e.doc}`);
  lines.push(`/>  // ${meta}`);
  return lines.join('\n');
}

function paramsFromComponent(c: ComponentDef): DevDocApiParam[] {
  return Object.keys(c.paramDocs).map(name => ({
    name,
    type: inferParamType(c.defaults[name]),
    optional: c.defaults[name] === undefined,
    defaultValue: c.defaults[name] === undefined ? undefined : JSON.stringify(c.defaults[name]),
    description: c.paramDocs[name],
  }));
}

function inferParamType(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v;
}

function componentToMethod(
  registry: Registry,
  pkg: ScenePackage,
  c: ComponentDef,
): DevDocApiMethod {
  const needsPrefix = registry.needsPackagePrefix(c.name);
  const prefix = needsPrefix ? pkg.name : undefined;
  const snippet = renderComponentSnippet(c, prefix);
  const om = c.objectModel;
  return {
    id: c.name,
    name: c.name,
    kind: 'component',
    summary: c.doc,
    signature: snippet.split('\n')[0] ?? `${c.name}(...)`,
    params: paramsFromComponent(c),
    details: c.details,
    llmText: componentDoc(c),
    objects: om?.objects.map(o => ({ name: o.name, signature: objectFactorySignature(o), description: o.doc })),
  };
}

function functionToMethod(pkg: ScenePackage, fn: FunctionDef): DevDocApiMethod {
  const params = Object.entries(fn.paramDocs ?? {}).map(([name, description]) => ({
    name,
    type: 'unknown',
    optional: true,
    defaultValue: fn.defaults?.[name] === undefined ? undefined : JSON.stringify(fn.defaults[name]),
    description,
  }));
  const signature = params.length
    ? `${fn.name}({ ${params.map((p) => p.name).join(', ')} })`
    : `${fn.name}({})`;
  return {
    id: fn.name,
    name: fn.name,
    kind: 'function',
    summary: fn.doc,
    signature,
    params,
    details: fn.details,
    llmText: functionDoc(fn),
  };
}

/** Build the structured API package list for the dev page from the registry */
export function buildDevApiPackages(registry: Registry): DevDocApiPackage[] {
  return registry.allPackages().map(pkg => {
    const methods: DevDocApiMethod[] = [
      ...(pkg.components ?? []).map(c => componentToMethod(registry, pkg, c)),
      ...(pkg.functions ?? []).map(fn => functionToMethod(pkg, fn)),
    ];
    return {
      id: pkg.name,
      title: pkg.name,
      description: pkg.doc,
      importPath: pkg.name,
      builtin: false,
      methods,
    };
  });
}

