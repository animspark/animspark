/**
 * Rewrites the font table in the mg handbook (`prompts/skills/mg/references/fonts.md`) from the
 * font library. A hand-written table drifts from the library sooner or later, and every row that
 * drifts is a font that silently falls back in some film. After changing
 * `src/scene/font-library.ts`, run from `packages/engine`:
 *
 *   node --import tsx scripts/gen-font-reference.mts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_LIBRARY, VENDOR_LATIN, type FontRole, type FontSpec } from '../src/scene/font-library';

const LOCALES: ReadonlyArray<{ id: FontSpec['locale']; title: string }> = [
  { id: 'zh-CN', title: 'Chinese' },
  { id: 'latin', title: 'Latin' },
  { id: 'ja-JP', title: 'Japanese' },
  { id: 'ko-KR', title: 'Korean' },
];

const ROLES: ReadonlyArray<{ id: FontRole; title: string }> = [
  { id: 'display', title: 'Display' },
  { id: 'body', title: 'Body' },
  { id: 'mono', title: 'Monospace' },
  { id: 'accent', title: 'Accent (short labels only; as body text it blurs)' },
];

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function weightsOf(spec: FontSpec): string {
  const weights = spec.weights ?? spec.variants?.map((variant) => variant.weight) ?? [];
  return [...new Set(weights)].sort((a, b) => a - b).join(' ');
}

export function renderFontReference(): string {
  const lines = [
    '# Fonts',
    '',
    'Families in the font library load by family name, with no import. Preview, `anim look` and `anim render` load every library family named in the source automatically (the engine downloads it on first use), so every machine renders the same fonts.',
    '',
    '```tsx',
    `<h1 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900 }}>Conservation of Energy</h1>`,
    '```',
    '',
    '- Quote the family name and end the list with a generic family (`serif` / `sans-serif` / `monospace`). An unquoted family name that contains a digit (`Exo 2`) invalidates the whole declaration.',
    '- Use only the weights listed in the table. For a weight that is not there, the browser substitutes the nearest one or synthesizes a fake bold.',
    '- Family names outside the table (system fonts, names from memory) resolve to different fonts on different machines; `anim check` warns about them.',
    '- Most Chinese, Japanese and Korean families include Latin glyphs. In mixed text, list the Latin family first and the CJK family after it; Latin characters then use the Latin family.',
    '',
  ];
  for (const locale of LOCALES) {
    const specs = FONT_LIBRARY.filter((spec) => spec.locale === locale.id);
    const vendor = locale.id === 'latin' ? VENDOR_LATIN : [];
    if (!specs.length && !vendor.length) continue;
    lines.push(`## ${locale.title}`, '');
    for (const role of ROLES) {
      const rows = [
        ...specs.filter((spec) => spec.role === role.id).map((spec) => ({
          family: spec.family, aliases: spec.aliases ?? [], weights: weightsOf(spec), vibe: spec.vibe,
        })),
        ...vendor.filter((face) => face.role === role.id).map((face) => ({
          family: face.family, aliases: [] as string[], weights: face.weights.join(' '), vibe: face.vibe,
        })),
      ].sort((a, b) => a.family.localeCompare(b.family));
      if (!rows.length) continue;
      lines.push(`### ${role.title}`, '', '| Family | Weights | Style |', '| --- | --- | --- |');
      for (const row of rows) {
        const name = [row.family, ...row.aliases].map((n) => `\`${cell(n)}\``).join(' / ');
        lines.push(`| ${name} | ${row.weights} | ${cell(row.vibe)} |`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

const out = join(dirname(fileURLToPath(import.meta.url)), '../prompts/skills/mg/references/fonts.md');
writeFileSync(out, renderFontReference());
console.log(`wrote ${out}`);
