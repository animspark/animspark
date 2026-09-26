/**
 * All of a film's source, delivered in one go.
 *
 * Why this exists: client-side compilation has esbuild discover imports as it parses, so **network
 * round trips are serialized**. Measured on a five-scene film: first `film.tsx`, which reveals
 * `assets/index.json`, which reveals `scenes/*`, and only after compiling the scenes do we learn it
 * needs `three`. Five levels, nine requests, 44 KB total. At tens of ms per hop locally it barely
 * shows; on a real network with 50-100 ms RTT it is half a second to a second of pure latency.
 *
 * This route collapses the five levels into one: every code file in the workspace is sent at once
 * and esbuild's resolve/load runs entirely in memory. **Compilation still happens in the browser**;
 * this only changes how the source is shipped, not a single byte of bundling moves to the server.
 *
 * Two extras:
 *   - `srcHash` is included. It is both the ETag (unchanged source means 304, no body at all) and
 *     the key for the browser's build cache.
 *   - `packages` is included. The 2 MB of `three` used to be discovered only at level four, the
 *     worst possible place. Announcing it up front lets the browser fetch it in parallel with the
 *     source.
 */
import { FILM_DOC_FILE, filmAudioRoleOf, filmDocMgSrcs, filmDocScoreSrcs, isPrivateAssetWordsPath, parseFilmDoc, parseFilmMgPreview } from '@animspark/core';
import {
  collectDocMediaSec,
  filmRuntimeAssets,
  filmDocEntrySource,
  filmDocErrorEntry,
  projectRuntimeSource,
  readAssetIndex,
  readAssetWordBook,
  readPublishedMgProjects,
  publishedMgProjectsStamp,
  syncScoreAudio,
} from '@animspark/film-build';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { filmScoreAssets, type FilmAssetIndex } from '@animspark/runtime';
import type { Score } from '@muspark/core';
import { HOST_SHARED_SPECS } from './host-shared';
import { filmSourceAnchors } from './source-anchors';
import { sourceStamp } from './source-stamp';
import { workspaceMediaFacts } from '../workspace-media';
import { rolePathAvailable } from '../llm/role-workspace-tools';
import { readMgSoundDeclarations, readScoreModule } from '../mg/source';
import { fontLinksFor, type FontLink } from '../scene/font-library';

/** Directories left out of the bundle. Keep in sync with the stamp, or the stamp changes while the
 * bundle doesn't. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.anim', 'dist', 'out', '.next', 'renders']);

/**
 * Extensions that can be imported.
 *
 * `.svg` is excluded: the client treats it as an image, fetching bytes via `<base>` into a data URL,
 * never reading it as text. `.md` / `.txt` are excluded too: no loader handles them, so they would
 * only bloat the bundle.
 */
const BUNDLE_EXT = new Set(['.tsx', '.ts', '.mts', '.cts', '.jsx', '.js', '.mjs', '.cjs', '.css', '.json']);

/** Per-file cap. A multi-MB json is left for `/film/code` to fetch on its own rather than bloat the
 * bundle. */
const MAX_FILE_BYTES = 512 * 1024;
/** Total cap. Past it, send a partial bundle and the client fetches the rest one by one the old way:
 * slow, but it always renders. */
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 400;
/** Changing the transport contract must invalidate browser builds of unchanged films. */
const BUNDLE_FORMAT = 'transport-v4';

/** Modules the host script already ships; no need to tell the browser to preload them. */
const SHARED_SPECS = new Set<string>([
  ...HOST_SHARED_SPECS,
  'react-dom/client',
  'react-dom/server',
]);

export type CodeBundle = {
  srcHash: string | null;
  files: Record<string, string>;
  /** Public packages this version uses (bare specifiers, minus those the host ships). */
  packages: string[];
  /** The file where each package first appears. */
  importedBy: Record<string, string>;
  /** Files too large for the bundle. The client fetches these individually. */
  omitted: string[];
  bytes: number;
  /** Only runtime-safe facts; also used when previewing one MG outside the film. */
  assets?: FilmAssetIndex;
  /** Host-provided word timings used by standalone MG sounds and captions. */
  words?: ReturnType<typeof readAssetWordBook>;
  /**
   * Compile entry for the doc form (film.json): server-generated glue (see film-build's doc-entry).
   * Absent means code form, and the client enters from `./film.tsx` as before. If the doc itself is
   * invalid, this is a module that throws the validation error as soon as it runs, so the error
   * travels the iframe's existing error channel instead of needing one of its own.
   */
  entry: string | null;
  /** Project-bound runtime facade; private timing data is never a workspace source file. */
  runtimeSource?: string;
  projects?: ReturnType<typeof readPublishedMgProjects>;
  /**
   * Font-library families this version uses (stylesheet URLs). Naming a family in source loads it.
   * The shoot page and playback bundle insert the <link> server-side (see code-shoot /
   * pack-playback); the preview is compiled live in the browser, so only the bundle can carry them.
   */
  fonts?: FontLink[];
};

/**
 * Which font stylesheets the preview links. Same corpus as the shoot page: the source in this film's
 * graph plus the doc (caption families live in the doc). Families whose license forbids this don't
 * throw here: the preview still renders, and look / export blocks it with a clear message.
 */
function previewFontLinks(files: Record<string, string>, doc: string | undefined): FontLink[] {
  try {
    return fontLinksFor([...Object.values(files), doc ?? ''].join('\n'));
  } catch (e) {
    console.warn(`[code-bundle] ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    return [];
  }
}

/*
 * `from 'x'` / `import 'x'` / `require('x')`.
 *
 * The leading `(^|[^"'\w.])` is not decoration: without it, JSON like `"from": 1.02, "to": ...` reads
 * as an import, because right after `from` comes that key's closing quote, making the "package name"
 * `: 1.02, `. The error travels all the way to `anim check` as "preview is missing an npm package"
 * for a film with nothing wrong: the check blocks a shippable film and sends people hunting through
 * tsx imports.
 */
/* No whitespace allowed in specifiers: JSX text like `...come from" sub="...` would otherwise read as
   an import, when it is just English. */
const IMPORT_RE = /(?:^|[^"'\w.$])(?:from\s*|import\s*|require\s*\(\s*)["']([^"'\s]+)["']/g;

export function bareSpecsIn(source: string): string[] {
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m = IMPORT_RE.exec(source);
  while (m) {
    const spec = m[1] ?? '';
    if (spec && spec[0] !== '.' && spec[0] !== '/' && !spec.startsWith('http') && !spec.startsWith('data:')) {
      out.push(spec);
    }
    m = IMPORT_RE.exec(source);
  }
  return out;
}

/** Runtime imports only: preprocessing scripts elsewhere in the workspace are
 * kept as author files, but do not become dependencies of the browser film. */
function runtimeSpecsIn(source: string, path: string): string[] {
  if (path.endsWith('.css')) {
    return [...source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)].map(match => match[1]!);
  }
  if (!/\.[cm]?[jt]sx?$/i.test(path)) return [];
  const kind = /\.[cm]?ts$/i.test(path) ? ts.ScriptKind.TS
    : /\.[cm]?js$/i.test(path) ? ts.ScriptKind.JS
      : path.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const specs = new Set<string>();
  const add = (node: ts.Expression | undefined) => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) specs.add(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (!clause?.isTypeOnly && (!bindings || !ts.isNamedImports(bindings)
        || clause?.name || !bindings.elements.length || bindings.elements.some(item => !item.isTypeOnly))) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      const clause = node.exportClause;
      if (!clause || !ts.isNamedExports(clause) || !clause.elements.length || clause.elements.some(item => !item.isTypeOnly)) add(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...specs];
}

/** The dependency graph used by preview audits, independently of transport
 * bundle limits. An imported tools/ file is included; an unrelated script is not. */
export async function collectPreviewCode(
  workspace: string,
  transported: Readonly<Record<string, string>> = {},
  previewSrc?: string,
): Promise<Pick<CodeBundle, 'files' | 'packages' | 'importedBy'>> {
  const root = await realpath(workspace);
  const files: Record<string, string> = {};
  const packages = new Map<string, string>();
  const extensions = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.css', '.json'];
  const resolveLocal = async (from: string, spec: string): Promise<string | null> => {
    if (!spec.startsWith('.')) return null;
    const base = resolve(root, dirname(from), spec);
    const candidates = [base, ...extensions.map(ext => base + ext), ...extensions.map(ext => join(base, 'index' + ext))];
    if (/\.[cm]?js$/.test(base)) candidates.push(base.replace(/\.[cm]?js$/, '.ts'), base.replace(/\.[cm]?js$/, '.tsx'));
    for (const path of candidates) {
      if (!(await stat(path).catch(() => null))?.isFile()) continue;
      const rel = relative(root, await realpath(path)).replace(/\\/g, '/');
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`${from}: import ${JSON.stringify(spec)} leaves the workspace.`);
      return rel;
    }
    return null; // The actual compiler owns missing-import diagnostics.
  };
  const visited = new Set<string>();
  const visit = async (from: string, spec: string): Promise<void> => {
    if (!spec.startsWith('.')) {
      if (spec && !spec.startsWith('/') && !spec.startsWith('http') && !spec.startsWith('data:')
        && !SHARED_SPECS.has(spec) && !packages.has(spec)) packages.set(spec, from);
      return;
    }
    const path = await resolveLocal(from, spec);
    if (!path || visited.has(path)) return;
    visited.add(path);
    if (!/\.(?:[cm]?[jt]sx?|css|json)$/i.test(path)) return;
    const source = transported[path] ?? await readFile(join(root, path), 'utf8');
    files[path] = source;
    for (const dependency of runtimeSpecsIn(source, path)) await visit(path, dependency);
  };
  const docText = await readFile(join(root, FILM_DOC_FILE), 'utf8').catch(() => null);
  if (previewSrc) await visit(FILM_DOC_FILE, `./${previewSrc}`);
  else if (docText != null) {
    const doc = parseFilmDoc(docText);
    for (const src of [...filmDocMgSrcs(doc), ...filmDocScoreSrcs(doc)]) await visit(FILM_DOC_FILE, `./${src}`);
  } else await visit('film.tsx', './film.tsx');
  return { files, packages: [...packages.keys()].sort(), importedBy: Object.fromEntries(packages) };
}

async function walk(
  root: string,
  dir: string,
  out: { files: Record<string, string>; omitted: string[]; bytes: number; count: number },
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.count >= MAX_FILES || out.bytes >= MAX_TOTAL_BYTES) return;
    if (entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (!rolePathAvailable('mg', rel)) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(root, abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!BUNDLE_EXT.has(ext)) continue;
    /* Type declarations are for the editor only; esbuild never imports them. */
    if (/\.d\.[cm]?ts$/.test(entry.name)) continue;
    if (isPrivateAssetWordsPath(rel)) continue;
    const info = await stat(abs).catch(() => null);
    if (!info) continue;
    if (info.size > MAX_FILE_BYTES || out.bytes + info.size > MAX_TOTAL_BYTES) {
      out.omitted.push(rel);
      continue;
    }
    let text = await readFile(abs, 'utf8').catch(() => null);
    if (text == null) continue;
    /* Same pass as /film/code: text editing relies on these anchors to find source line/column. */
    if (ext === '.tsx' || ext === '.jsx') text = filmSourceAnchors(text, rel);
    out.files[rel] = text;
    out.bytes += text.length;
    out.count += 1;
  }
}

/** Collect once per stamp: opening a project, thumbnails and in-place rebuilds ask several times in
 * a row. */
const bundles = new Map<string, { stamp: string; bundle: CodeBundle }>();
const MAX_CACHED = 24;

/** Browser previews receive runtime facts, never provider metadata or prompts. */
/**
 * Entry for the doc form. Returns null when film.json is absent (code form; the client enters from
 * `./film.tsx`).
 *
 * Read from disk rather than the bundle: if the doc is too large and left out (see MAX_FILE_BYTES),
 * the entry must still be generated, and the client fetches film.json separately the old way.
 */
async function docEntryFor(root: string, projects: ReturnType<typeof readPublishedMgProjects>, assets: FilmAssetIndex, words: ReturnType<typeof readAssetWordBook>): Promise<string | null> {
  const text = await readFile(join(root, FILM_DOC_FILE), 'utf8').catch(() => null);
  if (text == null) return null;
  try {
    const doc = parseFilmDoc(text);
    /* `known` carries pointer metadata: streaming assets' masters live in CAS with no local bytes,
       but their durations were probed at upload and sit in the pointer. The browser has only this
       glue to go on: without it, a missing ledger row leaves the clip unmeasurable and the whole
       film throws in preview, while server-side evaluation (evaluate.ts, same args) stays green. */
    const media = await collectDocMediaSec(doc, {
      workspace: root,
      known: workspaceMediaFacts(root),
    });
    return filmDocEntrySource(doc, {
      resolvePath: (rel) => `./${rel}`,
      assets,
      words,
      media,
      projects,
      /* The preview page reads the doc from a global instead of compiling it into the output, so
         moving a clip on the timeline only needs a new doc sent over for a re-render (see applyDoc
         in client-compile), not a rebuild of the whole film. That page seeds the doc from the
         bundle before eval (see seedDoc). */
      mode: 'runtime',
    });
  } catch (e) {
    return filmDocErrorEntry(e instanceof Error ? e.message : String(e));
  }
}

export async function collectCodeBundle(root: string, options: { preview?: string | null } = {}): Promise<CodeBundle> {
  const previewSrc = parseFilmMgPreview(options.preview) ?? undefined;
  const cacheKey = `${root}\0${previewSrc ?? ""}`;
  const rawStamp = await sourceStamp(root);
  // Capabilities are refreshed on a bounded interval while immutable code stays
  // cached. A restored registry must also invalidate an old WebM-only entry.
  const projectStamp = publishedMgProjectsStamp(root);
  const stamp = rawStamp ? `${BUNDLE_FORMAT}:${previewSrc ?? ""}:${rawStamp}:${projectStamp}:${projectStamp ? Math.floor(Date.now() / 3_600_000) : ''}` : null;
  if (stamp) {
    const hit = bundles.get(cacheKey);
    if (hit?.stamp === stamp) return hit.bundle;
  }

  const out = { files: {} as Record<string, string>, omitted: [] as string[], bytes: 0, count: 0 };
  await walk(root, root, out);

  // Only actual film dependencies request browser packages. Data preparation code
  // under assets/data remains available to the author without loading Node packages.
  const preview = await collectPreviewCode(root, out.files, previewSrc).catch(() => null);
  // Prepare only the active graph: an unfinished, unrelated draft must not break playback.
  // A resource preview has its own graph, even before placement in film.json.
  const soundModules: Record<string, unknown> = {};
  const timing = readAssetIndex(root);
  const scores: Record<string, Score> = {};
  // A standalone scene owns only its sounds. Full-film beds are prepared on the film graph.
  const doc = !previewSrc ? await readFile(join(root, FILM_DOC_FILE), 'utf8').then(parseFilmDoc).catch(() => null) : null;
  for (const file of doc ? filmDocScoreSrcs(doc) : []) {
    scores[file] = await readScoreModule(root, file, timing);
    soundModules[`score:${file}`] = [{ id: 'score', kind: filmAudioRoleOf(file), score: scores[file] }];
  }
  const scoreAssets = filmScoreAssets(scores);
  for (const [file, source] of Object.entries(preview?.files ?? {})) {
    if (file.startsWith('mg/') && /\.[cm]?[jt]sx?$/.test(file) && /\bsounds\b/.test(source)) {
      soundModules[file] = await readMgSoundDeclarations(root, file, timing);
    }
  }
  await syncScoreAudio(root, soundModules);
  const projects = readPublishedMgProjects(root);
  const assets = { ...filmRuntimeAssets(root), ...scoreAssets };
  const words = readAssetWordBook(root);
  const bundle: CodeBundle = {
    srcHash: stamp,
    files: out.files,
    packages: preview?.packages ?? [],
    /* Who imported it. Reporting "preview can't build this package" must name the file: a film has
       dozens of modules, and a bare package name just makes people grep for it. */
    importedBy: preview?.importedBy ?? {},
    omitted: out.omitted,
    bytes: out.bytes,
    assets,
    words,
    entry: await docEntryFor(root, projects, assets, words),
    runtimeSource: projectRuntimeSource(readAssetIndex(root)),
    projects,
    fonts: previewFontLinks(preview?.files ?? {}, previewSrc ? undefined : out.files[FILM_DOC_FILE]),
  };

  if (stamp) {
    bundles.delete(cacheKey);
    bundles.set(cacheKey, { stamp, bundle });
    while (bundles.size > MAX_CACHED) bundles.delete(bundles.keys().next().value!);
  }
  return bundle;
}

/** Invalidate after source edits; the next request recomputes the stamp. */
export function dropCodeBundle(root: string): void {
  for (const key of bundles.keys()) if (key.startsWith(`${root}\0`)) bundles.delete(key);
}

/**
 * The bundle's ETag.
 *
 * Using the stamp as ETag is sound: the same stamp always means the same source (see source-stamp).
 * When no stamp can be computed (an absurdly large workspace) there is no ETag: we can't be sure,
 * and an unsure cache is worse than none.
 */
export function bundleEtag(bundle: CodeBundle): string | null {
  if (!bundle.srcHash) return null;
  return `"cb-${bundle.srcHash}"`;
}

/** The bundle response body. A separate function so the hash and body use the same content. */
export function bundleBody(bundle: CodeBundle): string {
  return JSON.stringify({
    srcHash: bundle.srcHash,
    files: bundle.files,
    packages: bundle.packages,
    omitted: bundle.omitted,
    ...(bundle.assets != null ? { assets: bundle.assets } : {}),
    ...(bundle.words != null ? { words: bundle.words } : {}),
    ...(bundle.entry != null ? { entry: bundle.entry } : {}),
    ...(bundle.runtimeSource != null ? { runtimeSource: bundle.runtimeSource } : {}),
    ...(bundle.projects != null ? { projects: bundle.projects } : {}),
    ...(bundle.fonts?.length ? { fonts: bundle.fonts } : {}),
  });
}

export function bundleDigest(body: string): string {
  return createHash('sha1').update(body).digest('hex').slice(0, 16);
}
