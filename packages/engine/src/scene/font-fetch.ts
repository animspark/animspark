/**
 * The font library, materialized on demand.
 *
 * The library is built lazily in the local cache, one family at a time:
 *
 *   <cache>/font/css/<slug>.css              one stylesheet per family name, src → ../files/
 *   <cache>/font/files/<pkg>/<file>.woff2    the slices, fetched the first time a page asks
 *   <cache>/font/files/<pkg>/.src.json       where each slice came from
 *
 * Sources, in order: the four vendored Latin families (in this package), an installed
 * @fontsource / @chinese-fonts package, then the same package at its pinned version on jsDelivr.
 * After the first render of a family, everything is on disk and rendering works offline.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_LIBRARY, VENDOR_LATIN, fontCssSlug, fontLibraryDir, type FontSpec } from './font-library';
import PINS from './font-versions.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vendor', 'fonts');
const CDN = process.env.ANIMSPARK_FONT_CDN?.trim().replace(/\/+$/, '') || 'https://cdn.jsdelivr.net/npm';

type Entry = { name: string; pkgKey: string; sources: () => Array<{ css: string; weight?: number }> };

function specSources(spec: FontSpec): Array<{ css: string; weight?: number }> {
  const scope = spec.source === 'fontsource' ? '@fontsource' : '@chinese-fonts';
  const id = `${scope}/${spec.pkg}`;
  const ver = (PINS as Record<string, string>)[id];
  const at = (sub: string): string => {
    try { return require.resolve(`${id}/${sub}`); } catch { return ver ? `${CDN}/${id}@${ver}/${sub}` : ''; }
  };
  if (spec.source === 'fontsource') return (spec.weights ?? []).map((w) => ({ css: at(`${w}.css`) })).filter((s) => s.css);
  return (spec.variants ?? []).map((v) => ({ css: at(`dist/${v.dir}/result.css`), weight: v.weight })).filter((s) => s.css);
}

let bySlug: Map<string, Entry> | null = null;
function entries(): Map<string, Entry> {
  if (bySlug) return bySlug;
  bySlug = new Map();
  for (const face of VENDOR_LATIN) {
    bySlug.set(fontCssSlug(face.family, face.pkg, 0), { name: face.family, pkgKey: 'vendor', sources: () => [{ css: join(VENDOR_DIR, 'fonts.css') }] });
  }
  for (const spec of FONT_LIBRARY) {
    [spec.family, ...(spec.aliases ?? [])].forEach((name, i) => {
      bySlug!.set(fontCssSlug(name, spec.pkg, i), { name, pkgKey: spec.pkg, sources: () => specSources(spec) });
    });
  }
  return bySlug;
}

const isUrl = (s: string): boolean => /^https?:\/\//.test(s);

async function readSource(src: string): Promise<Buffer> {
  if (!isUrl(src)) return readFileSync(src);
  const res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
  return Buffer.from(await res.arrayBuffer());
}

function resolveRel(base: string, rel: string): string {
  if (isUrl(base)) return new URL(rel, base).href;
  // The vendored stylesheet is written for its packaged layout (fonts/X); in the source tree it is files/X.
  if (base.startsWith(VENDOR_DIR)) return join(VENDOR_DIR, 'files', basename(rel));
  return join(dirname(base), rel);
}

function writeAtomic(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

function sourceMapPath(pkgKey: string): string { return join(fontLibraryDir(), 'files', pkgKey, '.src.json'); }

async function buildCss(slug: string): Promise<string | null> {
  const entry = entries().get(slug);
  if (!entry) return null;
  const parts: string[] = [];
  const srcMap: Record<string, string> = existsSync(sourceMapPath(entry.pkgKey))
    ? JSON.parse(readFileSync(sourceMapPath(entry.pkgKey), 'utf8')) : {};
  for (const { css, weight } of entry.sources()) {
    let text: string;
    try { text = (await readSource(css)).toString('utf8'); } catch (e) {
      console.warn(`[fonts] ${entry.name}: could not load ${css} (${(e as Error).message}); the page falls back to system fonts.`);
      continue;
    }
    for (const raw of text.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      if (entry.pkgKey === 'vendor' && !new RegExp(`font-family:\\s*['"]${entry.name}['"]`, 'i').test(raw)) continue;
      const url = /url\(\s*['"]?([^)'"]+?\.woff2)['"]?\s*\)/.exec(raw)?.[1];
      if (!url) continue;
      const file = basename(url);
      srcMap[file] = resolveRel(css, url);
      let out = raw
        .replace(/src:\s*[^;]+;/, `src: url(../files/${entry.pkgKey}/${file}) format('woff2');`)
        .replace(/font-family\s*:\s*("[^"]*"|'[^']*')/, `font-family: '${entry.name}'`);
      if (weight !== undefined) out = out.replace(/font-weight\s*:\s*[0-9]+/, `font-weight: ${weight}`);
      parts.push(out);
    }
  }
  if (!parts.length) return null;
  writeAtomic(sourceMapPath(entry.pkgKey), JSON.stringify(srcMap));
  const dest = join(fontLibraryDir(), 'css', `${slug}.css`);
  writeAtomic(dest, `${parts.join('\n')}\n`);
  return dest;
}

async function fetchSlice(pkgKey: string, file: string): Promise<string | null> {
  const map = sourceMapPath(pkgKey);
  if (!existsSync(map)) return null;
  const src = (JSON.parse(readFileSync(map, 'utf8')) as Record<string, string>)[file];
  if (!src) return null;
  const dest = join(fontLibraryDir(), 'files', pkgKey, file);
  try { writeAtomic(dest, await readSource(src)); } catch (e) {
    console.warn(`[fonts] could not fetch ${src} (${(e as Error).message})`);
    return null;
  }
  return dest;
}

const pending = new Map<string, Promise<string | null>>();

/**
 * A path under the font library (`css/inter.css`, `files/inter/x.woff2`) → a file on disk,
 * fetching it first if needed. null = not a library font, or unreachable.
 */
export function ensureFontLibraryFile(rel: string): Promise<string | null> {
  const clean = rel.replace(/^\/+/, '');
  if (clean.includes('..') || clean.includes('\\')) return Promise.resolve(null);
  const onDisk = join(fontLibraryDir(), clean);
  if (existsSync(onDisk)) return Promise.resolve(onDisk);
  let job = pending.get(clean);
  if (!job) {
    const css = /^css\/([a-z0-9-]+)\.css$/.exec(clean);
    const slice = /^files\/([a-z0-9-]+)\/([^/]+\.woff2)$/.exec(clean);
    job = css ? buildCss(css[1]!) : slice ? fetchSlice(slice[1]!, slice[2]!) : Promise.resolve(null);
    job = job.finally(() => pending.delete(clean));
    pending.set(clean, job);
  }
  return job;
}
