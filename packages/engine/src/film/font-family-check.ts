/**
 * Whether CSS actually accepts the family names written in source.
 *
 * An unquoted family name must be a sequence of identifiers, and an identifier can't start with a
 * digit, so `font-family: Exo 2` is an **invalid declaration** and the browser drops all of it.
 * `style={{ fontFamily: 'Exo 2' }}` therefore compiles, passes every check, and renders that line in
 * Times in the frames, and when "the type looks a bit off" in a film, nobody suspects a CSS syntax
 * problem.
 *
 * Library family names with digits aren't rare (Exo 2 · Source Sans 3 · M PLUS 1p · Oxanium …); this
 * check catches the ones written from memory, copied from elsewhere, or with the quotes dropped.
 *
 * The other check (libraryFamilyIssues): the family isn't in the platform font library. Library
 * families only need their name; preview and export load them by name automatically. A name outside
 * the library lands on a different system font on each machine, so frames and the final film differ,
 * with no error at all.
 */
import { FONT_LIBRARY, VENDOR_LATIN } from '../scene/font-library';

/** An identifier that can appear unquoted in `font-family`. */
const IDENT = /^-?[A-Za-z_\u00A0-\uFFFF][A-Za-z0-9_\u00A0-\uFFFF-]*$/;

/** Literals written in JSX / style objects. Values built from variables aren't visible here; don't guess. */
const WRITTEN = /fontFamily\s*:\s*(['"`])([^'"`\n]+)\1/g;

/** Whether the browser drops this whole CSS declaration. */
export function cssDropsFamily(value: string): boolean {
  return value.split(',').some((one) => {
    const family = one.trim();
    if (!family) return true;
    // A quoted name is always valid; this is exactly how it should be written.
    if (/^["'].*["']$/.test(family)) return false;
    return family.split(/\s+/).some((token) => !IDENT.test(token));
  });
}

export function fontFamilyIssues(
  files: Readonly<Record<string, string>>,
): Array<{ level: 'error'; what: string }> {
  const out: Array<{ level: 'error'; what: string }> = [];
  const seen = new Set<string>();
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    for (const [, , value] of source.matchAll(WRITTEN)) {
      if (!value || !cssDropsFamily(value)) continue;
      const key = `${path}\u0000${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        level: 'error',
        what: `${path}: fontFamily: '${value}' is not valid CSS unquoted — a family name whose word starts`
          + ' with a digit has to be quoted, or the browser drops the whole declaration and the type'
          + ` silently falls back to Times. Write fontFamily: '"${value.split(',')[0]!.trim()}"'.`,
      });
    }
  }
  return out;
}

/** CSS generic families and keywords: they are the fallback, not a font to load. */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'emoji', 'math', 'fangsong',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

const KNOWN = new Set([
  ...FONT_LIBRARY.flatMap((spec) => [spec.family, ...(spec.aliases ?? [])]),
  ...VENDOR_LATIN.map((face) => face.family),
].map((name) => name.toLowerCase()));

/**
 * What a font stack looks like: a value given to fontFamily, or a string ending in a generic family
 * (a theme constant like `display: "'X', sans-serif"`).
 */
const STACK_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g;
const ENDS_GENERIC = new RegExp(`,\\s*(?:${[...GENERIC].join('|')})\\s*$`);

function familiesOf(stack: string): string[] {
  return stack.split(',').map((one) => one.trim().replace(/^["']|["']$/g, '').trim()).filter((name) => name && !GENERIC.has(name.toLowerCase()));
}

export function libraryFamilyIssues(
  files: Readonly<Record<string, string>>,
): Array<{ level: 'warn'; what: string }> {
  const missing = new Map<string, string>();
  const note = (path: string, stack: string) => {
    for (const family of familiesOf(stack)) {
      if (!KNOWN.has(family.toLowerCase()) && !missing.has(family)) missing.set(family, path);
    }
  };
  for (const [path, source] of Object.entries(files)) {
    if (/\.(tsx?|jsx?)$/.test(path)) {
      for (const [, , value] of source.matchAll(WRITTEN)) if (value) note(path, value);
      for (const [, double, single, template] of source.matchAll(STACK_LITERAL)) {
        const value = double ?? single ?? template;
        if (value && ENDS_GENERIC.test(value)) note(path, value);
      }
    } else if (path.endsWith('.css')) {
      for (const [, value] of source.matchAll(/font-family\s*:\s*([^;}\n]+)/g)) if (value) note(path, value);
    }
  }
  return [...missing].map(([family, path]) => ({
    level: 'warn' as const,
    what: `${path}: font family '${family}' is not in the platform font library, so preview and export fall back`
      + ' to a system font that differs between machines. Use a family listed in skills/animspark/mg/references/fonts.md;'
      + ' library families load by name, no import needed.',
  }));
}
