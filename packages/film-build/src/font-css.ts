/**
 * Which font families, weights and styles an @font-face CSS actually declares.
 *
 * This needs its own function because **a mismatch between the family name in the ledger and the
 * one in the CSS fails silently**: the runtime uses the ledger string as `font-family`, and if it
 * isn't found it falls back to a system font. The command reports success and there is text on
 * screen, but every title in the film is in a family you didn't pick. The font-picking step uses
 * this to decide what to write to the ledger, and `anim check` uses it to catch wrong names.
 *
 * Same for weights/styles: if the library doesn't ship 700 and you write `fontWeight: 700`, the
 * browser fakes the bold. It looks plausible, and nobody can tell it was synthesized.
 */

export interface DeclaredFaces {
  families: string[];
  /** Weights that appear. A single `font-weight: 100 900` is recorded as its two ends. */
  weights: number[];
  /** `normal` / `italic` / `oblique`. A block without font-style counts as normal. */
  styles: string[];
  stretches: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function facesOf(css: string): string[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/gi)].map((m) => m[1] ?? '');
}

function decl(block: string, prop: string): string | null {
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'));
  return m?.[1]?.trim() ?? null;
}

export function declaredFaces(css: string): DeclaredFaces {
  const families: string[] = [];
  const weights = new Set<number>();
  const styles: string[] = [];
  const stretches: string[] = [];

  for (const block of facesOf(css)) {
    const familyRaw = decl(block, 'font-family');
    if (familyRaw) {
      const name = familyRaw.replace(/^["']|["']$/g, '').trim();
      if (name) families.push(name);
    }
    const weightRaw = decl(block, 'font-weight');
    if (weightRaw) {
      for (const n of weightRaw.match(/\d+/g) ?? []) weights.add(Number(n));
    }
    const styleRaw = decl(block, 'font-style');
    styles.push((styleRaw ?? 'normal').split(/\s+/)[0]!.toLowerCase());
    const stretchRaw = decl(block, 'font-stretch');
    if (stretchRaw) stretches.push(stretchRaw.toLowerCase());
  }

  return {
    families: unique(families),
    weights: [...weights].sort((a, b) => a - b),
    styles: unique(styles),
    stretches: unique(stretches),
  };
}

export function declaredFamilies(css: string): string[] {
  const fromFaces = declaredFaces(css).families;
  if (fromFaces.length) return fromFaces;
  const out = new Set<string>();
  for (const m of css.matchAll(/font-family\s*:\s*(["']?)([^"';}]+)\1\s*[;}]/g)) {
    const name = m[2]!.trim().replace(/^["']|["']$/g, '');
    if (name) out.add(name);
  }
  return [...out];
}
