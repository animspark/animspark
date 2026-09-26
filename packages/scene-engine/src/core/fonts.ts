/**
 * Font library: registry of self-hosted OFL open-source webfonts.
 *
 * Design:
 *   - Latin "character" fonts are webfonts (they carry a template's look and render pixel-identically
 *     on all three targets); files live in packages/scene-engine/fonts/
 *   - Chinese falls back to the system stack (PingFang/Hiragino; CJK fonts are ~20MB, too big to
 *     embed, and the macOS/iOS system Chinese fonts are good enough)
 *   - A preset's typography.family can reference `@id` (e.g. '@playfair'), resolved at render time
 *     to "webfont family + CJK fallback stack"
 *
 * Delivery on the three targets:
 *   - server-side resvg frame capture: fontFiles is fed the ttf directly (getFontFiles)
 *   - browser player (video/slide): the page injects @font-face (buildFontFaceCss, src pointing at /fonts/<file>)
 *   - single-file web HTML: used fonts are embedded as base64 (makeEmbeddedFontCss)
 */

export interface FontAsset {
  /** Reference id (written as '@id' in a preset) */
  id: string;
  /** CSS font-family name (used when injecting @font-face) */
  family: string;
  /** File name (under packages/scene-engine/fonts/; variable-weight ttf) */
  file: string;
  /** Character tag (a reference for choosing a font when recreating a look) */
  vibe: string;
  /** CJK fallback stack (webfonts only cover Latin; Chinese falls through to system fonts) */
  cjkFallback: string;
}

export const FONT_LIBRARY: FontAsset[] = [
  {
    id: 'playfair',
    family: 'Playfair Display',
    file: 'PlayfairDisplay-Bold.ttf',
    vibe: 'Didone serif for display headlines (open-source stand-in for Didot/Bodoni; magazines, luxury, editorial)',
    cjkFallback: "'Songti SC',STSong,serif",
  },
  {
    id: 'fraunces',
    family: 'Fraunces',
    file: 'Fraunces.ttf',
    vibe: 'Retro soft serif (old-style print, coffee, handmade; Soft+Wonk axes)',
    cjkFallback: "'Songti SC',STSong,serif",
  },
  {
    id: 'grotesk',
    family: 'Space Grotesk',
    file: 'SpaceGrotesk.ttf',
    vibe: 'Geometric grotesque (tech, crypto, young studios)',
    cjkFallback: "'PingFang SC','Hiragino Sans GB',sans-serif",
  },
  {
    id: 'inter',
    family: 'Inter',
    file: 'Inter.ttf',
    vibe: 'Neutral UI sans-serif (product, interface, general body text)',
    cjkFallback: "'PingFang SC','Hiragino Sans GB',sans-serif",
  },
  {
    id: 'jbmono',
    family: 'JetBrains Mono',
    file: 'JetBrainsMono.ttf',
    vibe: 'Programming monospace (code, data, terminals)',
    cjkFallback: "'PingFang SC',monospace",
  },
];

const BY_ID = new Map(FONT_LIBRARY.map(f => [f.id, f]));

/** '@playfair' → "'Playfair Display','Songti SC',STSong,serif"; non-@ references are returned as is */
export function resolveFontFamily(ref: string): string {
  if (!ref.startsWith('@')) return ref;
  const f = BY_ID.get(ref.slice(1));
  if (!f) return ref;
  return `'${f.family}',${f.cjkFallback}`;
}

/** Webfont assets referenced in a family stack (detected by family name) */
export function fontsInStack(stack: string): FontAsset[] {
  return FONT_LIBRARY.filter(f => stack.includes(f.family));
}

/** Browser @font-face CSS (urlPrefix is the font file URL prefix, e.g. '/fonts') */
export function buildFontFaceCss(assets: FontAsset[], urlPrefix: string): string {
  return assets
    .map(f => `@font-face{font-family:'${f.family}';src:url('${urlPrefix}/${f.file}') format('truetype');font-weight:100 900;font-display:swap;}`)
    .join('\n');
}

/** Embedded @font-face for single-file HTML (base64; only the fonts actually used) */
export function buildEmbeddedFontCss(assets: Array<FontAsset & { dataBase64: string }>): string {
  return assets
    .map(f => `@font-face{font-family:'${f.family}';src:url(data:font/ttf;base64,${f.dataBase64}) format('truetype');font-weight:100 900;font-display:swap;}`)
    .join('\n');
}
