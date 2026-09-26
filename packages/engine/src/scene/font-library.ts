/**
 * Self-hosted font library: open-source families served as unicode-range slices, picked by the
 * characters a film uses (no font service online, no dependence on system fonts).
 *
 * Background (2026-07-24): a film is rendered in headless Chromium (frame probes, posters) and
 * played in a browser. Relying on host system fonts makes the same film look different on
 * different hosts. The fix: the engine brings its own open-source font library, detects the
 * family names that appear in the HTML, collects every code point the film uses, and loads only
 * the unicode-range slices those code points hit.
 *
 * Two constraints are recorded in the catalog (added 2026-08-01):
 *   role    — what the face is for. Handwriting faces are for margin notes only; as body text they blur.
 *   license — slicing means modifying the font file and redistributing it, so "free for commercial
 *             use" is not enough: the license must allow modification.
 * Frame probes, posters and the final render all take fonts from the same list;
 * at runtime a document.fonts.ready gate keeps the first frame from flashing a fallback font.
 *
 * Two slice sources (same unicode-range mechanism):
 *   fontsource         — a mirror of all of Google Fonts (@fontsource/<pkg>/<weight>.css);
 *   cn (chinese-fonts) — community OFL Chinese fonts outside Google Fonts
 *                        (@chinese-fonts/<pkg>/dist/<variant>/result.css, sliced by cn-font-split).
 *
 * Usage: write the family name in the source; preview, `anim look` and `anim render` load it by
 * name. The available families are listed in the mg handbook, references/fonts.md (generated from
 * this library by scripts/gen-font-reference.mts).
 * Size: slices are picked by the characters used; one family in a Chinese film is usually 0.5-3 MB.
 * Family names outside the library are not injected (they fall back to the system stack).
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

import { fileURLToPath } from 'node:url';

import type { Page } from 'playwright';

import { resolveCacheDir } from '../storage-root';
import { composeFontPrompt } from './font-prompt';

const require = createRequire(import.meta.url);

/**
 * What the face is for. Pick fonts by role; never use a handwriting face for body text.
 *
 * accent is why this field exists: in 2026-08 an English film used Caveat (a handwritten
 * annotation face) as body text in 148 places, and every technical term and number blurred
 * together. The catalog then had only free text such as vibe/tags, so nothing machine-readable
 * said "this face is for margin notes only", and the gate could not catch it.
 */
export type FontRole =
  /** Display: short lines at large sizes. */
  | 'display'
  /** Body: long sentences, subtitles, data, technical terms. Legibility first. */
  | 'body'
  /** Monospace: code, tables, aligned numbers. */
  | 'mono'
  /** Accent: handwriting, script, pixel, typewriter. Short labels only; as body text it blurs. */
  | 'accent';

export type LicenseId = 'OFL-1.1' | 'Apache-2.0' | 'Oradano';

export interface FontSpec {
  /** Canonical family name (shown in the docs; writing it or any alias in CSS matches). */
  family: string;
  /** Aliases (English and Chinese names for each other; detection and the @font-face output both use the name the author actually wrote). */
  aliases?: string[];
  source: 'fontsource' | 'cn';
  /** fontsource:@fontsource/<pkg>;cn:@chinese-fonts/<pkg>。 */
  pkg: string;
  /** fontsource weights (the css file names; missing ones are skipped). */
  weights?: number[];
  /** cn variant directory → weight (the font-weight in result.css is rewritten to this). */
  variants?: Array<{ dir: string; weight: number }>;
  role: FontRole;
  license: LicenseId;
  locale: 'latin' | 'zh-CN' | 'ja-JP' | 'ko-KR';
  /** One-line character of the face (for people; search uses prompt). */
  vibe: string;
  /** Search tags. */
  tags: string[];
  /** English-only search sentence. Vector search runs after the hard filters. */
  prompt?: string;
}

export interface LicenseTerms {
  /** Full license name (shown to readers in the bundled THIRD-PARTY-FONTS.md). */
  name: string;
  /** Where the license text comes from. */
  url: string;
  /**
   * Allows "modify the font file + redistribute the modified file".
   *
   * This is a hard requirement of the slicing pipeline and is stricter than "free for commercial
   * use": we cut fonts into unicode-range slices (= derived font files) and ship them with every
   * film. A font that allows commercial use but forbids modification does not pass.
   */
  subsettable: boolean;
}

/**
 * Where the bundled license texts come from.
 *
 * The LICENSE in a fontsource package is the font's own license (with the correct copyright
 * line), so it ships as is. @chinese-fonts/* is different: the LICENSE in all five packages is the
 * packager KonghaYao's MIT license, and shipping it would mislabel every Chinese font. So the cn
 * source always uses the upstream statements kept in this repo.
 */
export const VENDORED_LICENSE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vendor', 'font-licenses');

export const LICENSES: Record<LicenseId, LicenseTerms> = {
  'OFL-1.1': {
    name: 'SIL Open Font License 1.1',
    url: 'https://openfontlicense.org/',
    subsettable: true,
  },
  'Apache-2.0': {
    name: 'Apache License 2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    subsettable: true,
  },
  Oradano: {
    // Huiwen Mincho carries over the Oradano Mincho terms: printing/embedding, free redistribution
    // and building new fonts from it are allowed; only selling the font file itself as a product is
    // forbidden. Slicing and shipping slices with a film are both allowed.
    name: 'Huiwen Mincho license (derived from Oradano Mincho)',
    url: 'https://zhuanlan.zhihu.com/p/344103391',
    subsettable: true,
  },
};

/* ─────────────────── Library catalog (each license checked against its upstream statement) ─────────────────── */

const LATIN: FontSpec[] = [
  // ── Serif: display and body ──
  { family: 'Playfair Display', source: 'fontsource', pkg: 'playfair-display', weights: [400, 700, 900], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Didone headline — magazine, luxury, editorial', tags: ['serif', 'display', 'headline', 'magazine', 'elegant', 'fashion'] },
  { family: 'DM Serif Display', source: 'fontsource', pkg: 'dm-serif-display', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'High-contrast, elegant display serif', tags: ['serif', 'display', 'headline', 'elegant'] },
  { family: 'Abril Fatface', source: 'fontsource', pkg: 'abril-fatface', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Ultra-bold poster serif — vintage billboard', tags: ['serif', 'display', 'poster', 'vintage', 'punchy'] },
  { family: 'Bodoni Moda', source: 'fontsource', pkg: 'bodoni-moda', weights: [400, 700, 900], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Modern Bodoni — fashion, luxury', tags: ['serif', 'display', 'fashion', 'elegant'] },
  { family: 'Cormorant Garamond', source: 'fontsource', pkg: 'cormorant-garamond', weights: [400, 600, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Delicate classical serif — poetic, literary', tags: ['serif', 'classical', 'elegant', 'literary'] },
  { family: 'Instrument Serif', source: 'fontsource', pkg: 'instrument-serif', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Small, fresh display serif — design-studio feel', tags: ['serif', 'display', 'contemporary'] },
  { family: 'Young Serif', source: 'fontsource', pkg: 'young-serif', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Chunky vintage serif — warm, handmade feel', tags: ['serif', 'vintage', 'warm'] },
  { family: 'Libre Baskerville', source: 'fontsource', pkg: 'libre-baskerville', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Bookish body serif — print publications', tags: ['serif', 'body', 'bookish'] },
  { family: 'Lora', source: 'fontsource', pkg: 'lora', weights: [400, 600, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Modern body serif — blogs, long reads', tags: ['serif', 'body'] },
  { family: 'EB Garamond', source: 'fontsource', pkg: 'eb-garamond', weights: [400, 600, 800], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Old-style Garamond — history, academia', tags: ['serif', 'classical', 'academic', 'historical'] },
  // ── Sans-serif: modern and characterful ──
  { family: 'Manrope', source: 'fontsource', pkg: 'manrope', weights: [400, 600, 800], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Modern rounded geometric sans — product, brand', tags: ['sans-serif', 'modern', 'brand', 'rounded'] },
  { family: 'Sora', source: 'fontsource', pkg: 'sora', weights: [400, 600, 800], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Geometric tech sans — Web3, cutting edge', tags: ['sans-serif', 'tech', 'geometric'] },
  { family: 'Outfit', source: 'fontsource', pkg: 'outfit', weights: [400, 600, 900], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Clean geometric sans — brand, posters', tags: ['sans-serif', 'geometric', 'brand'] },
  { family: 'DM Sans', source: 'fontsource', pkg: 'dm-sans', weights: [400, 700, 900], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Neutral low-contrast sans — UI, body text', tags: ['sans-serif', 'body', 'interface'] },
  { family: 'Plus Jakarta Sans', source: 'fontsource', pkg: 'plus-jakarta-sans', weights: [400, 600, 800], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Brand-minded humanist sans', tags: ['sans-serif', 'brand', 'modern'] },
  { family: 'Work Sans', source: 'fontsource', pkg: 'work-sans', weights: [400, 600, 900], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'General-purpose grotesque sans — works for posters and body text', tags: ['sans-serif', 'general'] },
  { family: 'Archivo', source: 'fontsource', pkg: 'archivo', weights: [400, 600, 900], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'News grotesque — strong headlines', tags: ['sans-serif', 'news', 'headline'] },
  { family: 'Bricolage Grotesque', source: 'fontsource', pkg: 'bricolage-grotesque', weights: [400, 600, 800], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Characterful editorial face — magazines, culture', tags: ['sans-serif', 'distinctive', 'magazine', 'contemporary'] },
  { family: 'Syne', source: 'fontsource', pkg: 'syne', weights: [400, 700, 800], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Artsy avant-garde sans — gallery, experimental', tags: ['sans-serif', 'art', 'avant-garde'] },
  { family: 'Unbounded', source: 'fontsource', pkg: 'unbounded', weights: [400, 700, 900], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Expanded futuristic face — crypto, space', tags: ['sans-serif', 'futuristic', 'tech', 'display'] },
  { family: 'Lexend', source: 'fontsource', pkg: 'lexend', weights: [400, 600], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Highly legible sans — education, accessibility', tags: ['sans-serif', 'readable', 'education'] },
  // ── Impact display ──
  { family: 'Bebas Neue', source: 'fontsource', pkg: 'bebas-neue', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Tall, narrow all-caps impact headline', tags: ['display', 'punchy', 'headline', 'banner'] },
  { family: 'Anton', source: 'fontsource', pkg: 'anton', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Heavy, compact impact headline', tags: ['display', 'punchy', 'headline'] },
  { family: 'Archivo Black', source: 'fontsource', pkg: 'archivo-black', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Extra-black headline — street posters', tags: ['display', 'punchy', 'poster'] },
  { family: 'Alfa Slab One', source: 'fontsource', pkg: 'alfa-slab-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Ultra-bold slab — circus, vintage signage', tags: ['display', 'slab', 'vintage', 'punchy'] },
  { family: 'Righteous', source: 'fontsource', pkg: 'righteous', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Rounded display face — trendy, entertainment', tags: ['display', 'rounded', 'trendy'] },
  { family: 'Bungee', source: 'fontsource', pkg: 'bungee', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Street signage face — works set vertically', tags: ['display', 'street', 'signage'] },
  { family: 'Monoton', source: 'fontsource', pkg: 'monoton', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Neon line display — disco, retro electric', tags: ['display', 'neon', 'vintage'] },
  // ── Tech / futuristic ──
  { family: 'Orbitron', source: 'fontsource', pkg: 'orbitron', weights: [400, 700, 900], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Sci-fi geometric face — spaceship instruments', tags: ['tech', 'sci-fi', 'futuristic', 'display'] },
  { family: 'Audiowide', source: 'fontsource', pkg: 'audiowide', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Wide cyber face — esports, in-car UI', tags: ['tech', 'cyber', 'esports'] },
  { family: 'Michroma', source: 'fontsource', pkg: 'michroma', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Space-age wide face — aerospace, industrial', tags: ['tech', 'space', 'industrial'] },
  { family: 'Russo One', source: 'fontsource', pkg: 'russo-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Mecha sport face — racing, military', tags: ['tech', 'mecha', 'sport'] },
  { family: 'Chakra Petch', source: 'fontsource', pkg: 'chakra-petch', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Chamfered HUD face — instrument UI, Thai tech', tags: ['tech', 'HUD', 'interface'] },
  // ── Retro / pixel / typewriter ──
  { family: 'Press Start 2P', source: 'fontsource', pkg: 'press-start-2p', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: '8-bit arcade pixel', tags: ['pixel', 'vintage', 'game'] },
  { family: 'Silkscreen', source: 'fontsource', pkg: 'silkscreen', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Small-size pixel face — low-resolution UI', tags: ['pixel', 'vintage', 'interface'] },
  { family: 'VT323', source: 'fontsource', pkg: 'vt323', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'CRT terminal monospace — hacker, DOS', tags: ['pixel', 'terminal', 'vintage', 'monospace'] },
  { family: 'Special Elite', source: 'fontsource', pkg: 'special-elite', weights: [400], role: 'accent', license: 'Apache-2.0', locale: 'latin', vibe: 'Old typewriter — archives, detective', tags: ['typewriter', 'vintage', 'archival'] },
  { family: 'Courier Prime', source: 'fontsource', pkg: 'courier-prime', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Screenplay typewriter monospace — Hollywood scripts', tags: ['typewriter', 'monospace', 'screenplay'] },
  // ── Handwriting / script ──
  { family: 'Caveat', source: 'fontsource', pkg: 'caveat', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Casual handwritten annotations', tags: ['handwritten', 'annotation', 'casual'] },
  { family: 'Pacifico', source: 'fontsource', pkg: 'pacifico', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Retro surf brush script', tags: ['handwritten', 'vintage', 'leisure'] },
  { family: 'Dancing Script', source: 'fontsource', pkg: 'dancing-script', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Flowing connected script — invitations, romance', tags: ['handwritten', 'script', 'romantic'] },
  { family: 'Kalam', source: 'fontsource', pkg: 'kalam', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Marker handwriting — whiteboard explainers', tags: ['handwritten', 'whiteboard', 'explainer'] },
  { family: 'Permanent Marker', source: 'fontsource', pkg: 'permanent-marker', weights: [400], role: 'accent', license: 'Apache-2.0', locale: 'latin', vibe: 'Thick permanent marker — graffiti, slogans', tags: ['handwritten', 'graffiti', 'slogan'] },
  { family: 'Shadows Into Light', source: 'fontsource', pkg: 'shadows-into-light', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Delicate handwriting — notes, diary', tags: ['handwritten', 'note', 'delicate'] },
  { family: 'Homemade Apple', source: 'fontsource', pkg: 'homemade-apple', weights: [400], role: 'accent', license: 'Apache-2.0', locale: 'latin', vibe: 'Fountain-pen hand — letters, signatures', tags: ['handwritten', 'fountain-pen', 'letter'] },
  { family: 'Great Vibes', source: 'fontsource', pkg: 'great-vibes', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Elegant English script — weddings, certificates', tags: ['handwritten', 'script', 'elegant'] },
  { family: 'Rock Salt', source: 'fontsource', pkg: 'rock-salt', weights: [400], role: 'accent', license: 'Apache-2.0', locale: 'latin', vibe: 'Rough chalk handwriting — street, handmade', tags: ['handwritten', 'chalk', 'street'] },
  // ── Monospace ──
  { family: 'IBM Plex Mono', source: 'fontsource', pkg: 'ibm-plex-mono', weights: [400, 600], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Engineering monospace — industrial blueprint feel', tags: ['monospace', 'code', 'engineering'] },
  { family: 'Space Mono', source: 'fontsource', pkg: 'space-mono', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Grotesque monospace — magazine-style code and data', tags: ['monospace', 'distinctive', 'data'] },
  { family: 'Fira Code', source: 'fontsource', pkg: 'fira-code', weights: [400, 600], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Code monospace with ligatures', tags: ['monospace', 'code', 'ligature'] },
  { family: 'DM Mono', source: 'fontsource', pkg: 'dm-mono', weights: [400, 500], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Light, clean monospace', tags: ['monospace', 'code', 'clean'] },
  // ── Condensed / slab ──
  { family: 'Oswald', source: 'fontsource', pkg: 'oswald', weights: [400, 600], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Condensed news headline', tags: ['banner', 'news', 'headline'] },
  { family: 'Barlow Condensed', source: 'fontsource', pkg: 'barlow-condensed', weights: [400, 600], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Condensed sport face — athletics, sense of speed', tags: ['banner', 'sport', 'speed'] },
  { family: 'Bitter', source: 'fontsource', pkg: 'bitter', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Slab for body text — solid, dependable', tags: ['slab', 'body'] },
  { family: 'Zilla Slab', source: 'fontsource', pkg: 'zilla-slab', weights: [400, 600], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Modern slab — tech with a humanist touch', tags: ['slab', 'tech', 'headline'] },
  // ── 2026-08 expansion: filling role gaps from Google Fonts ──
  { family: 'Source Serif 4', source: 'fontsource', pkg: 'source-serif-4', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'General-purpose body serif — solid and neutral, first choice for long text', tags: ['serif', 'body', 'general'] },
  { family: 'Crimson Pro', source: 'fontsource', pkg: 'crimson-pro', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Classical book serif — literature, essays', tags: ['serif', 'body', 'book', 'literature'] },
  { family: 'Literata', source: 'fontsource', pkg: 'literata', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'E-book serif — optimized for screen reading', tags: ['serif', 'body', 'reading', 'ebook'] },
  { family: 'Spectral', source: 'fontsource', pkg: 'spectral', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Screen serif — calm and restrained; reportage, long reads', tags: ['serif', 'body', 'reportage'] },
  { family: 'Newsreader', source: 'fontsource', pkg: 'newsreader', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'News serif — newsroom character', tags: ['serif', 'body', 'news', 'editorial'] },
  { family: 'Alegreya', source: 'fontsource', pkg: 'alegreya', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Humanist serif — bookish warmth', tags: ['serif', 'body', 'humanist'] },
  { family: 'Vollkorn', source: 'fontsource', pkg: 'vollkorn', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Sturdy German-style serif — textbooks, manuals', tags: ['serif', 'body', 'textbook'] },
  { family: 'Domine', source: 'fontsource', pkg: 'domine', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Body serif — optimized for web reading', tags: ['serif', 'body', 'web'] },
  { family: 'Frank Ruhl Libre', source: 'fontsource', pkg: 'frank-ruhl-libre', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Modern Hebrew-style serif — clear, works for headlines and body text', tags: ['serif', 'body', 'modern'] },
  { family: 'Petrona', source: 'fontsource', pkg: 'petrona', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Fine-necked serif — magazine body text', tags: ['serif', 'body', 'magazine'] },
  { family: 'Public Sans', source: 'fontsource', pkg: 'public-sans', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Neutral government sans — public data, explanations', tags: ['sans-serif', 'body', 'neutral', 'government'] },
  { family: 'Figtree', source: 'fontsource', pkg: 'figtree', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Friendly geometric sans — product and brand body text', tags: ['sans-serif', 'body', 'friendly', 'brand'] },
  { family: 'Source Sans 3', source: 'fontsource', pkg: 'source-sans-3', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'General-purpose UI sans — docs, dashboards', tags: ['sans-serif', 'body', 'interface', 'documentation'] },
  { family: 'IBM Plex Sans', source: 'fontsource', pkg: 'ibm-plex-sans', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'IBM engineering sans — technical documentation', tags: ['sans-serif', 'body', 'technical', 'engineering'] },
  { family: 'Rubik', source: 'fontsource', pkg: 'rubik', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Rounded geometric sans — youthful, friendly', tags: ['sans-serif', 'body', 'rounded', 'friendly'] },
  { family: 'Karla', source: 'fontsource', pkg: 'karla', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Grotesque sans — indie magazine flavor', tags: ['sans-serif', 'body', 'grotesque', 'indie'] },
  { family: 'Mulish', source: 'fontsource', pkg: 'mulish', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Minimal rounded sans — clean UI', tags: ['sans-serif', 'body', 'minimal'] },
  { family: 'Epilogue', source: 'fontsource', pkg: 'epilogue', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Neutral variable sans — modern brand', tags: ['sans-serif', 'body', 'modern', 'brand'] },
  { family: 'Hanken Grotesk', source: 'fontsource', pkg: 'hanken-grotesk', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Neutral grotesk — general body text', tags: ['sans-serif', 'body', 'general'] },
  { family: 'Be Vietnam Pro', source: 'fontsource', pkg: 'be-vietnam-pro', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Modern sans — multilingual body text', tags: ['sans-serif', 'body', 'multilingual'] },
  { family: 'Schibsted Grotesk', source: 'fontsource', pkg: 'schibsted-grotesk', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Nordic news sans — reportage, charts', tags: ['sans-serif', 'body', 'news', 'chart'] },
  { family: 'Onest', source: 'fontsource', pkg: 'onest', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Contemporary geometric sans — tech brand', tags: ['sans-serif', 'body', 'tech', 'brand'] },
  { family: 'Prata', source: 'fontsource', pkg: 'prata', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'High-contrast Didone — fashion and beauty headlines', tags: ['serif', 'display', 'fashion', 'high-contrast'] },
  { family: 'Cinzel', source: 'fontsource', pkg: 'cinzel', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Roman inscription face — epic, memorial, wine labels', tags: ['serif', 'display', 'inscription', 'epic'] },
  { family: 'Marcellus', source: 'fontsource', pkg: 'marcellus', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Classical Roman face — museums, refined', tags: ['serif', 'display', 'classical', 'refined'] },
  { family: 'Italiana', source: 'fontsource', pkg: 'italiana', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Thin, tall serif — haute couture, gallery', tags: ['serif', 'display', 'thin', 'haute-couture'] },
  { family: 'Gilda Display', source: 'fontsource', pkg: 'gilda-display', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Elegant fine serif — boutique, invitations', tags: ['serif', 'display', 'elegant'] },
  { family: 'Yeseva One', source: 'fontsource', pkg: 'yeseva-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Heavy decorative serif — vintage posters', tags: ['serif', 'display', 'vintage', 'poster'] },
  { family: 'Rozha One', source: 'fontsource', pkg: 'rozha-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Very high-contrast serif — impact headlines', tags: ['serif', 'display', 'high-contrast', 'punchy'] },
  { family: 'Bevan', source: 'fontsource', pkg: 'bevan', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Bold slab display — old-fashioned billboards', tags: ['slab', 'display', 'vintage', 'advertising'] },
  { family: 'Ultra', source: 'fontsource', pkg: 'ultra', weights: [400], role: 'display', license: 'Apache-2.0', locale: 'latin', vibe: 'Ultra-bold slab — Wild West, circus', tags: ['slab', 'display', 'western', 'punchy'] },
  { family: 'Cinzel Decorative', source: 'fontsource', pkg: 'cinzel-decorative', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Ornamented Roman face — fantasy, heraldry', tags: ['serif', 'display', 'fantasy', 'decorative'] },
  { family: 'Staatliches', source: 'fontsource', pkg: 'staatliches', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Tall, narrow all caps — exhibition posters', tags: ['display', 'punchy', 'poster', 'banner'] },
  { family: 'Passion One', source: 'fontsource', pkg: 'passion-one', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Heavy round-terminal headline — promos, sports', tags: ['display', 'punchy', 'promo'] },
  { family: 'Titan One', source: 'fontsource', pkg: 'titan-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Cartoon bold — kids, games', tags: ['display', 'cartoon', 'children', 'game'] },
  { family: 'Lilita One', source: 'fontsource', pkg: 'lilita-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Rounded bold headline — light entertainment', tags: ['display', 'rounded', 'entertainment'] },
  { family: 'Luckiest Guy', source: 'fontsource', pkg: 'luckiest-guy', weights: [400], role: 'display', license: 'Apache-2.0', locale: 'latin', vibe: 'Comic-book bold — humor, stickers', tags: ['display', 'comics', 'comic'] },
  { family: 'Bowlby One', source: 'fontsource', pkg: 'bowlby-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Heavy square-shouldered face — designer toys, posters', tags: ['display', 'heavy', 'designer-toy'] },
  { family: 'Shrikhand', source: 'fontsource', pkg: 'shrikhand', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Indian signage bold italic — festive, spices', tags: ['display', 'signage', 'festive'] },
  { family: 'Modak', source: 'fontsource', pkg: 'modak', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Balloon-fat face — desserts, playful', tags: ['display', 'chubby', 'playful'] },
  { family: 'Sigmar One', source: 'fontsource', pkg: 'sigmar-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Bold with a 3D feel — retro games', tags: ['display', 'vintage', 'game'] },
  { family: 'Kanit', source: 'fontsource', pkg: 'kanit', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Thai-style sans — sport, street', tags: ['display', 'sport', 'street'] },
  { family: 'Teko', source: 'fontsource', pkg: 'teko', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Compressed tall face — scoreboards, gauges', tags: ['display', 'banner', 'sports', 'data'] },
  { family: 'Fugaz One', source: 'fontsource', pkg: 'fugaz-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Bold italic headline — speed, promos', tags: ['display', 'italic', 'speed'] },
  { family: 'Exo 2', source: 'fontsource', pkg: 'exo-2', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Modern tech sans — aerospace, product', tags: ['tech', 'futuristic', 'aerospace'] },
  { family: 'Rajdhani', source: 'fontsource', pkg: 'rajdhani', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Hard-edged HUD face — instruments, defense industry', tags: ['tech', 'HUD', 'dashboard'] },
  { family: 'Saira', source: 'fontsource', pkg: 'saira', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Wide tech sans — industrial, racing', tags: ['tech', 'industrial', 'racing'] },
  { family: 'Electrolize', source: 'fontsource', pkg: 'electrolize', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Digital-watch face — data, terminals', tags: ['tech', 'data', 'terminal'] },
  { family: 'Syncopate', source: 'fontsource', pkg: 'syncopate', weights: [400, 700], role: 'display', license: 'Apache-2.0', locale: 'latin', vibe: 'Extra-wide tracking display — fashion tech', tags: ['tech', 'fashion', 'wide-tracking'] },
  { family: 'Tomorrow', source: 'fontsource', pkg: 'tomorrow', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Near-future sans — concept products', tags: ['tech', 'futuristic', 'concept'] },
  { family: 'Quantico', source: 'fontsource', pkg: 'quantico', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Military-spec square face — tactical, military', tags: ['tech', 'military', 'tactical'] },
  { family: 'Nova Square', source: 'fontsource', pkg: 'nova-square', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Blocky pixel-like display — retro sci-fi', tags: ['tech', 'sci-fi', 'vintage'] },
  { family: 'Source Code Pro', source: 'fontsource', pkg: 'source-code-pro', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'General-purpose code monospace — reliably readable', tags: ['monospace', 'code', 'general'] },
  { family: 'Roboto Mono', source: 'fontsource', pkg: 'roboto-mono', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Neutral code monospace — terminals, logs', tags: ['monospace', 'code', 'terminal'] },
  { family: 'Inconsolata', source: 'fontsource', pkg: 'inconsolata', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Compact code monospace — dense code', tags: ['monospace', 'code', 'compact'] },
  { family: 'Martian Mono', source: 'fontsource', pkg: 'martian-mono', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Wide monospace — data tables, dashboards', tags: ['monospace', 'data', 'table'] },
  { family: 'Azeret Mono', source: 'fontsource', pkg: 'azeret-mono', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Hard-edged monospace — design-minded data', tags: ['monospace', 'data', 'design'] },
  { family: 'Geist Mono', source: 'fontsource', pkg: 'geist-mono', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Contemporary product monospace — developer tools', tags: ['monospace', 'code', 'product'] },
  { family: 'Red Hat Mono', source: 'fontsource', pkg: 'red-hat-mono', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Open-source engineering monospace — config, terminals', tags: ['monospace', 'code', 'engineering'] },
  { family: 'Spline Sans Mono', source: 'fontsource', pkg: 'spline-sans-mono', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Light monospace — comments, metadata', tags: ['monospace', 'code', 'light'] },
  { family: 'Overpass Mono', source: 'fontsource', pkg: 'overpass-mono', weights: [400, 700], role: 'mono', license: 'OFL-1.1', locale: 'latin', vibe: 'Monospace derived from highway signage — labels, numbering', tags: ['monospace', 'label', 'numbering'] },
  { family: 'Major Mono Display', source: 'fontsource', pkg: 'major-mono-display', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Lowercase monoline mono display — geek posters', tags: ['monospace', 'display', 'geek'] },
  { family: 'Fjalla One', source: 'fontsource', pkg: 'fjalla-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Condensed headline — news headlines', tags: ['banner', 'news', 'headline'] },
  { family: 'Archivo Narrow', source: 'fontsource', pkg: 'archivo-narrow', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Condensed face for body text and headlines — reports, annual reports', tags: ['banner', 'report'] },
  { family: 'Roboto Condensed', source: 'fontsource', pkg: 'roboto-condensed', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Neutral condensed — dense information, captions', tags: ['banner', 'body', 'caption'] },
  { family: 'Yanone Kaffeesatz', source: 'fontsource', pkg: 'yanone-kaffeesatz', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Hand-drawn condensed — cafe menus', tags: ['banner', 'hand-drawn', 'menu'] },
  { family: 'Abel', source: 'fontsource', pkg: 'abel', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Light condensed — minimal headlines', tags: ['banner', 'minimal'] },
  { family: 'Saira Condensed', source: 'fontsource', pkg: 'saira-condensed', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Condensed tech — sports events, leaderboards', tags: ['banner', 'tech', 'sports'] },
  { family: 'Arvo', source: 'fontsource', pkg: 'arvo', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Geometric slab — chart labels, body text', tags: ['slab', 'body', 'chart'] },
  { family: 'Roboto Slab', source: 'fontsource', pkg: 'roboto-slab', weights: [400, 700], role: 'body', license: 'Apache-2.0', locale: 'latin', vibe: 'Neutral slab — document headings and body text', tags: ['slab', 'body', 'documentation'] },
  { family: 'Rokkitt', source: 'fontsource', pkg: 'rokkitt', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Slender slab — crisp labels', tags: ['slab', 'body', 'crisp'] },
  { family: 'Aleo', source: 'fontsource', pkg: 'aleo', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Contemporary slab — brand body text', tags: ['slab', 'body', 'brand'] },
  { family: 'Crete Round', source: 'fontsource', pkg: 'crete-round', weights: [400], role: 'body', license: 'OFL-1.1', locale: 'latin', vibe: 'Rounded slab — gentle explanations', tags: ['slab', 'body', 'gentle'] },
  { family: 'Josefin Slab', source: 'fontsource', pkg: 'josefin-slab', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'latin', vibe: 'Art Deco slab — 1920s retro', tags: ['slab', 'display', 'vintage', 'art-deco'] },
  { family: 'Architects Daughter', source: 'fontsource', pkg: 'architects-daughter', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Architect handwriting — blueprint annotations', tags: ['handwritten', 'annotation', 'blueprint'] },
  { family: 'Indie Flower', source: 'fontsource', pkg: 'indie-flower', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Rounded handwriting — casual notes', tags: ['handwritten', 'note', 'casual'] },
  { family: 'Patrick Hand', source: 'fontsource', pkg: 'patrick-hand', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Neat handwriting — class notes', tags: ['handwritten', 'notes', 'neat'] },
  { family: 'Gloria Hallelujah', source: 'fontsource', pkg: 'gloria-hallelujah', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Childlike handwriting — playful annotations', tags: ['handwritten', 'playful'] },
  { family: 'Amatic SC', source: 'fontsource', pkg: 'amatic-sc', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Tall, thin handwritten all caps — arty posters', tags: ['handwritten', 'tall', 'literary'] },
  { family: 'Reenie Beanie', source: 'fontsource', pkg: 'reenie-beanie', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Thin-pen handwriting — quick scribbles', tags: ['handwritten', 'casual'] },
  { family: 'Just Another Hand', source: 'fontsource', pkg: 'just-another-hand', weights: [400], role: 'accent', license: 'Apache-2.0', locale: 'latin', vibe: 'Slender handwriting — labels, next to arrows', tags: ['handwritten', 'label', 'slender'] },
  { family: 'Covered By Your Grace', source: 'fontsource', pkg: 'covered-by-your-grace', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Slanted handwriting — personal notes', tags: ['handwritten', 'notes'] },
  { family: 'Caveat Brush', source: 'fontsource', pkg: 'caveat-brush', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Brush handwriting — short emphatic phrases', tags: ['handwritten', 'brush', 'emphasis'] },
  { family: 'Sacramento', source: 'fontsource', pkg: 'sacramento', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Thin connected script — invitations, sign-offs', tags: ['handwritten', 'script', 'invitation'] },
  { family: 'Parisienne', source: 'fontsource', pkg: 'parisienne', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'French script — fragrance, boutique', tags: ['handwritten', 'script', 'french'] },
  { family: 'Allura', source: 'fontsource', pkg: 'allura', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Elegant connected script — certificates, weddings', tags: ['handwritten', 'script', 'elegant'] },
  { family: 'Yellowtail', source: 'fontsource', pkg: 'yellowtail', weights: [400], role: 'accent', license: 'Apache-2.0', locale: 'latin', vibe: 'Retro brush italic — signage, food and drink', tags: ['handwritten', 'brush', 'vintage', 'signage'] },
  { family: 'Lobster', source: 'fontsource', pkg: 'lobster', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Classic brush headline — restaurants, markets', tags: ['handwritten', 'brush', 'signage'] },
  { family: 'Satisfy', source: 'fontsource', pkg: 'satisfy', weights: [400], role: 'accent', license: 'Apache-2.0', locale: 'latin', vibe: 'Lively brush — desserts, handmade', tags: ['handwritten', 'brush', 'handmade'] },
  { family: 'Courgette', source: 'fontsource', pkg: 'courgette', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Rounded brush — warm headlines', tags: ['handwritten', 'brush', 'warm'] },
  { family: 'Nothing You Could Do', source: 'fontsource', pkg: 'nothing-you-could-do', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Dense handwriting — diary, letters', tags: ['handwritten', 'diary', 'letter'] },
  { family: 'Marck Script', source: 'fontsource', pkg: 'marck-script', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Thin connected handwriting — signature feel', tags: ['handwritten', 'signature'] },
  { family: 'Pixelify Sans', source: 'fontsource', pkg: 'pixelify-sans', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Modern pixel face — indie game UI', tags: ['pixel', 'game', 'interface'] },
  { family: 'Handjet', source: 'fontsource', pkg: 'handjet', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Variable dot-matrix face — LED, industrial printing', tags: ['pixel', 'bitmap', 'industrial'] },
  { family: 'Jersey 10', source: 'fontsource', pkg: 'jersey-10', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Jersey dot-matrix face — scoreboards', tags: ['pixel', 'bitmap', 'sports'] },
  { family: 'Rye', source: 'fontsource', pkg: 'rye', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Western wanted-poster face — Old West', tags: ['vintage', 'western', 'decorative'] },
  { family: 'Bungee Shade', source: 'fontsource', pkg: 'bungee-shade', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: '3D shadow signage face — neon posters', tags: ['display', 'signage', 'dimensional'] },
  { family: 'Faster One', source: 'fontsource', pkg: 'faster-one', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Speed-line decorative face — racing', tags: ['display', 'speed', 'decorative'] },
  { family: 'Creepster', source: 'fontsource', pkg: 'creepster', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Dripping horror face — Halloween, thrillers', tags: ['decorative', 'horror', 'halloween'] },
  { family: 'Pirata One', source: 'fontsource', pkg: 'pirata-one', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Gothic blackletter — medieval, metal', tags: ['decorative', 'gothic', 'medieval'] },
  { family: 'UnifrakturMaguntia', source: 'fontsource', pkg: 'unifrakturmaguntia', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'latin', vibe: 'Pointed German Gothic — old books, beer', tags: ['decorative', 'gothic', 'antique'] },
];

const ZH: FontSpec[] = [
  // ── Google Fonts(fontsource) ──
  { family: 'Noto Sans SC', source: 'fontsource', pkg: 'noto-sans-sc', weights: [400, 500, 700, 900], role: 'body', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'Source Han Sans — modern and neutral; body text, UI, general headlines', tags: ['gothic', 'sans-serif', 'body', 'headline', 'general'] },
  { family: 'Noto Serif SC', source: 'fontsource', pkg: 'noto-serif-sc', weights: [400, 600, 900], role: 'body', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'Source Han Serif — bookish serif; documentaries, culture, large headlines', tags: ['song', 'serif', 'bookish', 'documentary', 'headline'] },
  // Upstream only ships 300/500/700 (no 400). It used to list 400 by habit; packaging could not
  // resolve it and skipped it silently, so regular-weight body text fell back to 700 and every
  // kai line in the film came out too heavy.
  { family: 'LXGW WenKai', source: 'fontsource', pkg: 'lxgw-wenkai', weights: [300, 500, 700], role: 'body', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'LXGW WenKai — warm handwritten kai; humanist, essays, subtitles', tags: ['kai', 'handwritten', 'humanist', 'mellow'] },
  { family: 'Ma Shan Zheng', source: 'fontsource', pkg: 'ma-shan-zheng', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'Ma Shan Zheng brush kai — calligraphic inscriptions, Chinese traditional style', tags: ['brush', 'kai', 'chinese-traditional', 'inscription'] },
  { family: 'ZCOOL KuaiLe', source: 'fontsource', pkg: 'zcool-kuaile', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'ZCOOL KuaiLe — lively and rounded; fun and kids headlines', tags: ['lively', 'rounded', 'children', 'headline'] },
  { family: 'ZCOOL XiaoWei', source: 'fontsource', pkg: 'zcool-xiaowei', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'ZCOOL XiaoWei — thin, literary headlines', tags: ['literary', 'thin', 'headline'] },
  { family: 'ZCOOL QingKe HuangYou', source: 'fontsource', pkg: 'zcool-qingke-huangyou', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'ZCOOL QingKe HuangYou — chunky rounded poster face', tags: ['poster', 'rounded', 'chunky', 'headline'] },
  { family: 'Zhi Mang Xing', source: 'fontsource', pkg: 'zhi-mang-xing', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'Zhi Mang Xing — flowing running-script handwriting', tags: ['running-script', 'handwritten', 'chinese-traditional'] },
  { family: 'Liu Jian Mao Cao', source: 'fontsource', pkg: 'liu-jian-mao-cao', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'Liu Jian Mao Cao — wild cursive strokes; emotional outbursts', tags: ['cursive', 'brush', 'wild', 'chinese-traditional'] },
  { family: 'Long Cang', source: 'fontsource', pkg: 'long-cang', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'Long Cang — thin pen handwriting; notebook feel', tags: ['pen', 'handwritten', 'notes'] },
  // ── Well-known community OFL fonts (sliced by the Chinese Web Font Project) ──
  {
    family: '得意黑', aliases: ['Smiley Sans', 'Smiley Sans Oblique'], source: 'cn', pkg: 'dyh',
    variants: [{ dir: 'SmileySans-Oblique', weight: 400 }], role: 'display', license: 'OFL-1.1', locale: 'zh-CN',
    vibe: 'Smiley Sans — narrow, slanted modern gothic; the go-to for variety-show captions and sports headlines', tags: ['gothic', 'italic', 'variety-show', 'sport', 'headline', 'trendy'],
  },
  {
    family: '汇文明朝体', aliases: ['Huiwen-mincho', 'Huiwen Mincho'], source: 'cn', pkg: 'hwmct',
    variants: [{ dir: '汇文明朝体', weight: 400 }], role: 'body', license: 'Oradano', locale: 'zh-CN',
    vibe: 'Huiwen Mincho — letterpress mincho style; vintage print, literary titles', tags: ['mincho', 'song', 'vintage', 'print', 'literature'],
  },
  {
    family: '悠哉字体', aliases: ['Yozai', '悠哉'], source: 'cn', pkg: 'yozai',
    variants: [{ dir: 'Yozai-Regular', weight: 400 }, { dir: 'Yozai-Bold', weight: 700 }], role: 'accent', license: 'OFL-1.1', locale: 'zh-CN',
    vibe: 'Yozai — rounded, playful handwriting; comforting, everyday jottings', tags: ['handwritten', 'playful', 'healing', 'rounded'],
  },
  {
    family: '寒蝉全圆体', aliases: ['ChillRound', 'Chill Round'], source: 'cn', pkg: 'hcqyt',
    variants: [{ dir: 'ChillRoundFRegular', weight: 400 }, { dir: 'ChillRoundFBold', weight: 700 }], role: 'body', license: 'OFL-1.1', locale: 'zh-CN',
    vibe: 'ChillRound — soft rounded face; cute, soft tech, friendly UI', tags: ['rounded', 'soft', 'cute', 'interface'],
  },
  // ── 2026-08: three gaps filled: CJK monospace, fangsong, POP headlines ──
  {
    // Before this the library had no Chinese monospace: code blocks and number tables in Chinese
    // films had to use a Latin monospace, the Hanzi fell to the fallback stack, and a line's
    // character widths no longer lined up.
    family: 'Maple Mono CN', aliases: ['MapleMono CN', '等距更纱', 'Maple Mono'], source: 'cn', pkg: 'maple-mono-cn',
    variants: [{ dir: 'MapleMono-CN-Regular', weight: 400 }, { dir: 'MapleMono-CN-Bold', weight: 700 }], role: 'mono', license: 'OFL-1.1', locale: 'zh-CN',
    vibe: 'Chinese-Latin monospace — code, tables and aligned numbers in Chinese films', tags: ['monospace', 'code', 'data', 'table', 'cjk-latin'],
  },
  {
    family: '朱雀仿宋', aliases: ['Zhuque Fangsong'], source: 'cn', pkg: 'zqfs',
    variants: [{ dir: 'ZhuqueFangsong-Regular', weight: 400 }], role: 'body', license: 'OFL-1.1', locale: 'zh-CN',
    vibe: 'Zhuque Fangsong — refined fangsong; official documents, quotations, classical annotations', tags: ['fangsong', 'official-document', 'quotation', 'antique', 'refined'],
  },
  {
    family: '霞鹜漫黑', aliases: ['LXGW Marker Gothic'], source: 'cn', pkg: 'lxgwmanhei',
    variants: [{ dir: 'LXGWMarkerGothic', weight: 400 }], role: 'display', license: 'OFL-1.1', locale: 'zh-CN',
    vibe: 'LXGW Marker Gothic — marker POP face; variety-show lettering, handmade signage', tags: ['pop', 'marker', 'variety-show', 'display-lettering', 'headline'],
  },
  {
    family: '小赖字体', aliases: ['Xiaolai SC', 'Xiaolai', '小濑字体', 'Kose'], source: 'cn', pkg: 'xiaolai',
    variants: [{ dir: 'Xiaolai', weight: 400 }], role: 'body', license: 'OFL-1.1', locale: 'zh-CN',
    vibe: 'Xiaolai — neat handwriting that works as body text (unlike the playfulness of Yozai)', tags: ['handwritten', 'body', 'neat', 'notes'],
  },
  // ── 2026-08 expansion: Traditional Chinese ──
  { family: 'LXGW WenKai TC', source: 'fontsource', pkg: 'lxgw-wenkai-tc', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'LXGW WenKai TC — Traditional Chinese humanist kai, subtitles', tags: ['kai', 'body', 'traditional-chinese', 'humanist'] },
  { family: 'Chocolate Classical Sans', source: 'fontsource', pkg: 'chocolate-classical-sans', weights: [400], role: 'body', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'Chocolate Classical Sans — Traditional Chinese screen gothic', tags: ['gothic', 'body', 'traditional-chinese', 'screen'] },
  { family: 'Cactus Classical Serif', source: 'fontsource', pkg: 'cactus-classical-serif', weights: [400], role: 'body', license: 'OFL-1.1', locale: 'zh-CN', vibe: 'Cactus Classical Serif — Traditional Chinese classical ming', tags: ['mincho', 'body', 'traditional-chinese', 'classical'] },
];

const JP: FontSpec[] = [
  { family: 'Noto Sans JP', source: 'fontsource', pkg: 'noto-sans-jp', weights: [400, 500, 700, 900], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Modern gothic — neutral sans', tags: ['gothic', 'body', 'general'] },
  { family: 'Noto Serif JP', source: 'fontsource', pkg: 'noto-serif-jp', weights: [400, 600, 900], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Mincho — serif with a literary, documentary character', tags: ['mincho', 'serif', 'literature'] },
  { family: 'M PLUS Rounded 1c', source: 'fontsource', pkg: 'm-plus-rounded-1c', weights: [400, 500, 800], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Maru gothic — friendly rounded headlines', tags: ['rounded', 'friendly', 'headline'] },
  { family: 'Zen Maru Gothic', source: 'fontsource', pkg: 'zen-maru-gothic', weights: [400, 500, 700], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Warm rounded face — soft body text and headlines', tags: ['rounded', 'soft', 'body'] },
  { family: 'DotGothic16', source: 'fontsource', pkg: 'dotgothic16', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Pixel dot matrix — retro games, terminals', tags: ['pixel', 'vintage', 'game'] },
  { family: 'Yuji Syuku', source: 'fontsource', pkg: 'yuji-syuku', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Brush kai — Japanese-style inscriptions', tags: ['brush', 'japanese', 'inscription'] },
  // ── 2026-08 expansion: Japanese ──
  { family: 'Shippori Mincho', source: 'fontsource', pkg: 'shippori-mincho', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Traditional mincho — Japanese body text, vertical literature', tags: ['mincho', 'body', 'literature', 'japanese'] },
  { family: 'Zen Old Mincho', source: 'fontsource', pkg: 'zen-old-mincho', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Classical mincho — history, documentary', tags: ['mincho', 'body', 'classical'] },
  { family: 'Zen Kaku Gothic New', source: 'fontsource', pkg: 'zen-kaku-gothic-new', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Modern kaku gothic — UI, explanations', tags: ['gothic', 'body', 'interface'] },
  { family: 'BIZ UDGothic', source: 'fontsource', pkg: 'biz-udgothic', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Universal Design gothic — textbooks, accessibility', tags: ['gothic', 'body', 'textbook', 'accessible'] },
  { family: 'BIZ UDMincho', source: 'fontsource', pkg: 'biz-udmincho', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Universal Design mincho — official documents, textbooks', tags: ['mincho', 'body', 'official-document'] },
  { family: 'Dela Gothic One', source: 'fontsource', pkg: 'dela-gothic-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Ultra-bold gothic — impact headlines, magazine covers', tags: ['gothic', 'display', 'punchy', 'magazine'] },
  { family: 'Rampart One', source: 'fontsource', pkg: 'rampart-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: '3D embossed face — posters, game titles', tags: ['display', 'dimensional', 'poster'] },
  { family: 'Reggae One', source: 'fontsource', pkg: 'reggae-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Reggae bold — music, parties', tags: ['display', 'bold', 'music'] },
  { family: 'Train One', source: 'fontsource', pkg: 'train-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Railway signage face — transport, retro Showa', tags: ['display', 'transport', 'showa'] },
  { family: 'Potta One', source: 'fontsource', pkg: 'potta-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Rounded bold — food, family', tags: ['display', 'rounded', 'food'] },
  { family: 'Kiwi Maru', source: 'fontsource', pkg: 'kiwi-maru', weights: [400], role: 'body', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Gentle rounded face — picture books, comforting', tags: ['rounded', 'body', 'healing', 'picture-book'] },
  { family: 'Hina Mincho', source: 'fontsource', pkg: 'hina-mincho', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Thin mincho — Japanese-style white space, premium feel', tags: ['mincho', 'display', 'thin', 'japanese'] },
  { family: 'Kaisei Decol', source: 'fontsource', pkg: 'kaisei-decol', weights: [400, 700], role: 'display', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Decorative mincho — vintage trademarks', tags: ['mincho', 'display', 'vintage', 'decorative'] },
  { family: 'Hachi Maru Pop', source: 'fontsource', pkg: 'hachi-maru-pop', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Rounded girly POP — journals, stickers', tags: ['handwritten', 'pop', 'journal'] },
  { family: 'Yusei Magic', source: 'fontsource', pkg: 'yusei-magic', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Marker handwriting — chalkboard, doodles', tags: ['handwritten', 'marker', 'chalkboard'] },
  { family: 'Stick', source: 'fontsource', pkg: 'stick', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'ja-JP', vibe: 'Minimal thin-line face — icon labels', tags: ['display', 'minimal', 'label'] },
];

const KR: FontSpec[] = [
  { family: 'Noto Sans KR', source: 'fontsource', pkg: 'noto-sans-kr', weights: [400, 500, 700, 900], role: 'body', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Modern gothic — neutral body text and headlines', tags: ['gothic', 'body', 'general'] },
  { family: 'Noto Serif KR', source: 'fontsource', pkg: 'noto-serif-kr', weights: [400, 600, 900], role: 'body', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Serif myeongjo — bookish', tags: ['serif', 'bookish'] },
  { family: 'Black Han Sans', source: 'fontsource', pkg: 'black-han-sans', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Ultra-bold impact headline — posters, variety shows', tags: ['punchy', 'headline', 'variety-show'] },
  { family: 'Do Hyeon', source: 'fontsource', pkg: 'do-hyeon', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Geometric headline face — crisp and decisive', tags: ['geometric', 'headline'] },
  { family: 'Gowun Dodum', source: 'fontsource', pkg: 'gowun-dodum', weights: [400], role: 'body', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Gentle and rounded — soft storytelling', tags: ['rounded', 'soft', 'body'] },
  { family: 'Nanum Pen Script', source: 'fontsource', pkg: 'nanum-pen-script', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Pen handwriting — diary, notes', tags: ['handwritten', 'diary', 'note'] },
  // ── 2026-08 expansion: Korean ──
  { family: 'Nanum Gothic', source: 'fontsource', pkg: 'nanum-gothic', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Nanum Gothic — general-purpose Korean gothic for body text', tags: ['gothic', 'body', 'general'] },
  { family: 'Nanum Myeongjo', source: 'fontsource', pkg: 'nanum-myeongjo', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Nanum Myeongjo — Korean myeongjo for body text, literature', tags: ['mincho', 'body', 'literature'] },
  { family: 'Gowun Batang', source: 'fontsource', pkg: 'gowun-batang', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Gowun Batang — soft serif for body text', tags: ['serif', 'body', 'soft'] },
  { family: '42dot Sans', source: 'fontsource', pkg: '42dot-sans', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Modern geometric gothic — tech brand', tags: ['gothic', 'body', 'tech', 'brand'] },
  { family: 'Hahmlet', source: 'fontsource', pkg: 'hahmlet', weights: [400, 700], role: 'body', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Modern serif — editorial design', tags: ['serif', 'body', 'editorial'] },
  { family: 'Song Myung', source: 'fontsource', pkg: 'song-myung', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Classical myeongjo — history, tradition', tags: ['mincho', 'display', 'classical'] },
  { family: 'Jua', source: 'fontsource', pkg: 'jua', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Rounded cute face — kids, snacks', tags: ['display', 'rounded', 'children'] },
  { family: 'Bagel Fat One', source: 'fontsource', pkg: 'bagel-fat-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Fat rounded display — trendy, desserts', tags: ['display', 'chubby', 'trendy'] },
  { family: 'Gasoek One', source: 'fontsource', pkg: 'gasoek-one', weights: [400], role: 'display', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Ultra-bold impact face — promos, banners', tags: ['display', 'punchy', 'promo'] },
  { family: 'Gaegu', source: 'fontsource', pkg: 'gaegu', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Pencil handwriting — classroom, notes', tags: ['handwritten', 'pencil', 'note'] },
  { family: 'Dongle', source: 'fontsource', pkg: 'dongle', weights: [400, 700], role: 'accent', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Thin rounded handwriting — casual labels', tags: ['handwritten', 'thin-rounded', 'label'] },
  { family: 'Gamja Flower', source: 'fontsource', pkg: 'gamja-flower', weights: [400], role: 'accent', license: 'OFL-1.1', locale: 'ko-KR', vibe: 'Playful handwriting — doodles, diary', tags: ['handwritten', 'playful', 'diary'] },
];

export const FONT_LIBRARY: readonly FontSpec[] = [...LATIN, ...ZH, ...JP, ...KR].map((spec) => ({
  ...spec,
  prompt: composeFontPrompt(spec),
}));

export interface VendorFace {
  family: string;
  /** License text file name (vendor/font-licenses/<pkg>.txt). */
  pkg: string;
  weights: number[];
  role: FontRole;
  license: LicenseId;
  vibe: string;
}

/**
 * The four self-hosted Latin families: always shipped from vendor/fonts, outside the subsetting
 * pipeline (the whole files ship, unmodified).
 * They carry a role too: the gate must know "this film's body face is Inter" to judge whether a
 * handwriting face is being used out of place.
 */
export const VENDOR_LATIN: readonly VendorFace[] = [
  { family: 'Fraunces', pkg: 'fraunces', weights: [600, 900], role: 'display', license: 'OFL-1.1', vibe: 'Vintage soft-serif display; old-style print, coffee, handmade' },
  { family: 'Space Grotesk', pkg: 'space-grotesk', weights: [500, 700], role: 'display', license: 'OFL-1.1', vibe: 'Geometric sans display; tech, contemporary' },
  { family: 'Inter', pkg: 'inter', weights: [400, 600], role: 'body', license: 'OFL-1.1', vibe: 'Neutral body text and UI' },
  { family: 'JetBrains Mono', pkg: 'jetbrains-mono', weights: [500, 700], role: 'mono', license: 'OFL-1.1', vibe: 'Monospace; code, data, terminals' },
];

/* ─────────────────────────── Detection and subsetting ─────────────────────────── */

interface FontFaceBlock {
  /** woff2 path relative to the css. */
  url: string;
  /** Parsed code point ranges (no unicode-range = the full font, always a hit). */
  ranges: Array<[number, number]> | null;
  /** Raw @font-face block text (src/font-family/font-weight are rewritten before output). */
  raw: string;
}

const cssCache = new Map<string, FontFaceBlock[]>();

function parseUnicodeRanges(value: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const token of value.split(',')) {
    const t = token.trim().toUpperCase();
    if (!t.startsWith('U+')) continue;
    const body = t.slice(2);
    if (body.includes('?')) {
      const lo = parseInt(body.replace(/\?/g, '0'), 16);
      const hi = parseInt(body.replace(/\?/g, 'F'), 16);
      if (Number.isFinite(lo) && Number.isFinite(hi)) ranges.push([lo, hi]);
      continue;
    }
    const [loRaw, hiRaw] = body.split('-');
    const lo = parseInt(loRaw!, 16);
    const hi = hiRaw ? parseInt(hiRaw, 16) : lo;
    if (Number.isFinite(lo) && Number.isFinite(hi)) ranges.push([lo, hi]);
  }
  return ranges;
}

/** Parse a sliced css file (handles both the fontsource and the cn-font-split layout; cached per process). */
function parseSlicedCss(cssPath: string): FontFaceBlock[] {
  const cached = cssCache.get(cssPath);
  if (cached) return cached;
  const css = readFileSync(cssPath, 'utf8');
  const blocks: FontFaceBlock[] = [];
  const faceRe = /@font-face\s*\{[^}]*\}/g;
  for (const m of css.match(faceRe) ?? []) {
    const urlMatch = /url\(\s*['"]?([^)'"]+?\.woff2)['"]?\s*\)/.exec(m);
    if (!urlMatch) continue;
    const rangeMatch = /unicode-range:\s*([^;}]+)/.exec(m);
    blocks.push({
      url: urlMatch[1]!,
      ranges: rangeMatch ? parseUnicodeRanges(rangeMatch[1]!) : null,
      raw: m,
    });
  }
  cssCache.set(cssPath, blocks);
  return blocks;
}

/** Collect code points for subsetting (>= U+0080 is covered by the library; ASCII is backed by the vendored Latin families and the system stack, but latin slices are tiny, so they are collected too). */
function collectCodepoints(text: string): number[] {
  const set = new Set<number>();
  for (const ch of text) set.add(ch.codePointAt(0)!);
  return [...set].sort((a, b) => a - b);
}

function rangesHit(ranges: Array<[number, number]>, sorted: number[]): boolean {
  for (const [lo, hi] of ranges) {
    let left = 0;
    let right = sorted.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (sorted[mid]! < lo) left = mid + 1;
      else right = mid;
    }
    if (left < sorted.length && sorted[left]! <= hi) return true;
  }
  return false;
}

function escapeRe(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Family-name detection: a quoted family name (the most common form), or a bare name inside a
 * font-family/fontFamily declaration (short Latin names such as Sora/Anton must be limited to that
 * context so body text does not match by accident).
 */
function namePattern(name: string): RegExp {
  const esc = escapeRe(name);
  const bounded = /^[\x00-\x7F]+$/.test(name) ? `\\b${esc}\\b` : esc;
  return new RegExp(`['"\`]${esc}['"\`]|font-?[Ff]amily[^;\\n}]{0,160}${bounded}`);
}

/** Library fonts found in the text: the spec plus the names the author actually wrote (the @font-face output uses those). */
export function detectFonts(text: string): Array<{ spec: FontSpec; names: string[] }> {
  const out: Array<{ spec: FontSpec; names: string[] }> = [];
  for (const spec of FONT_LIBRARY) {
    const names = [spec.family, ...(spec.aliases ?? [])].filter((name) => namePattern(name).test(text));
    if (names.length) out.push({ spec, names });
  }
  return out;
}

/**
 * The font library's URL root. Nothing is ever fetched from it: every request under it is
 * answered from the local cache by `serveFontLibrary` (see font-fetch.ts). `.localhost`
 * never leaves the machine even if a request slipped past the route.
 */
export function fontLibraryBase(): string {
  const base = process.env.ANIMSPARK_FONT_BASE?.trim() || 'http://fonts.animspark.localhost';
  return `${base.replace(/\/+$/, '')}/font`;
}

/** The materialized font library on disk. */
export function fontLibraryDir(): string {
  return join(resolveCacheDir(), 'font');
}

/**
 * Give a render page its fonts without it going online: requests under `fontLibraryBase()`
 * are answered from the cache, which is filled on first use (font-fetch.ts).
 */
export async function serveFontLibrary(page: Page): Promise<void> {
  const base = fontLibraryBase();
  const { ensureFontLibraryFile } = await import('./font-fetch');
  await page.route(`${base}/**`, async (route) => {
    const rel = decodeURIComponent(route.request().url().slice(base.length + 1).split(/[?#]/)[0] ?? '');
    const file = await ensureFontLibraryFile(rel);
    if (!file) { await route.fulfill({ status: 404 }); return; }
    await route.fulfill({
      body: readFileSync(file),
      contentType: file.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2',
    });
  });
}

export interface FontLink {
  /** The family name as the author wrote it. */
  family: string;
  /** Stylesheet URL (absolute URL or same-origin path). */
  href: string;
}

/**
 * Which font stylesheets this corpus needs.
 *
 * The old `materializeFonts` did the same job a different way; the difference is **whether slices
 * are picked by the characters used**:
 *
 *   Pick slices and ship them   change one character that is not in a slice already copied in →
 *                               silent fallback to a system font, fixed only by repackaging; the
 *                               same slice is stored once per film (measured on published bundles:
 *                               8631 slices, 301MB; 2037 slices after dedup).
 *   Serve the full set          the slices are cut upstream by unicode-range and do not change with
 *                               the text; the browser fetches the ones it needs. Editing text needs
 *                               no repackaging, and every film shares one cache.
 *
 * So this only answers "which families are used" and never touches bytes. Family names come out as
 * the author wrote them: every alias has its own CSS file.
 */
export function fontLinksFor(corpusText: string): FontLink[] {
  // Compiled scenes are ASCII-escaped by esbuild: '得意黑' arrives as '\u5F97\u610F\u9ED1'.
  corpusText = corpusText.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g,
    (_, cp: string | undefined, u: string | undefined) => cp ? String.fromCodePoint(parseInt(cp, 16)) : String.fromCharCode(parseInt(u!, 16)));
  const base = fontLibraryBase();
  const out: FontLink[] = [];
  const seen = new Set<string>();
  for (const face of VENDOR_LATIN) {
    if (!namePattern(face.family).test(corpusText)) continue;
    seen.add(face.family);
    out.push({ family: face.family, href: `${base}/css/${fontCssSlug(face.family, face.pkg, 0)}.css` });
  }
  for (const { spec, names } of detectFonts(corpusText)) {
    const terms = LICENSES[spec.license];
    if (!terms.subsettable) {
      // Skipping silently would make the film look different on different hosts and leave the
      // violation in the film; fail at packaging time instead.
      throw new Error(
        `The license of font "${spec.family}" (${terms.name}) does not allow redistributing a modified font file,`
        + ` and the library serves fonts as unicode-range slices. Pick another font; `
        + `see skills/animspark/mg/references/fonts.md\n  License source: ${terms.url}`,
      );
    }
    const all = [spec.family, ...(spec.aliases ?? [])];
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      const i = all.indexOf(name);
      out.push({ family: name, href: `${base}/css/${fontCssSlug(name, spec.pkg, i < 0 ? 0 : i)}.css` });
    }
  }
  return out;
}

/** Family name → file name of its CSS. Must compute the same value as sync-font-library.mts. */
export function fontCssSlug(name: string, pkg: string, i: number): string {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return ascii || `${pkg}-${i}`;
}

/* ─────────────────────────── Catalog and preview (admin) ─────────────────────────── */

/** Font files of the four vendored Latin families (shipped whole with every film, outside the slicing pipeline). */
const VENDORED_FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'vendor', 'fonts');

export interface FontCatalogEntry {
  family: string;
  aliases: string[];
  role: FontRole;
  license: LicenseId;
  licenseName: string;
  locale: 'latin' | 'zh-CN' | 'ja-JP' | 'ko-KR';
  vibe: string;
  /** English-only search sentence. The admin side and the film use the same one. */
  prompt: string;
  tags: string[];
  /** vendored = always shipped whole (present even if not declared); sliced = slices shipped by the characters used. */
  shipping: 'vendored' | 'sliced';
  /**
   * Whether the font package is on this machine.
   *
   * The library is a list and the packages are npm dependencies, so the two can drift (a package
   * missing, a version changed). When they drift, film writing only logs one warning and silently
   * falls back to the system stack: the film looks wrong and nobody knows. List it.
   */
  installed: boolean;
}

/** Where this family's sliced css lives; empty if the package is not installed or the weight is missing. */
function cssSourcesFor(spec: FontSpec): Array<{ path: string; weight?: number; prefix: string }> {
  const out: Array<{ path: string; weight?: number; prefix: string }> = [];
  if (spec.source === 'fontsource') {
    for (const weight of spec.weights ?? []) {
      try {
        out.push({ path: require.resolve(`@fontsource/${spec.pkg}/${weight}.css`), prefix: '' });
      } catch {
        /* weight does not exist or package not installed */
      }
    }
    return out;
  }
  let pkgDir: string;
  try {
    pkgDir = dirname(require.resolve(`@chinese-fonts/${spec.pkg}/package.json`));
  } catch {
    return out;
  }
  for (const variant of spec.variants ?? []) {
    const cssPath = join(pkgDir, 'dist', variant.dir, 'result.css');
    if (existsSync(cssPath)) out.push({ path: cssPath, weight: variant.weight, prefix: `${spec.pkg}-` });
  }
  return out;
}

/** Catalog of the whole font library (the hosted admin font browser renders it directly). */
export function fontCatalog(): FontCatalogEntry[] {
  const vendorCss = join(VENDORED_FONT_DIR, 'fonts.css');
  const vendorInstalled = existsSync(vendorCss);
  const vendored: FontCatalogEntry[] = VENDOR_LATIN.map((face) => ({
    family: face.family,
    aliases: [],
    role: face.role,
    license: face.license,
    licenseName: LICENSES[face.license].name,
    locale: 'latin' as const,
    vibe: face.vibe,
    prompt: composeFontPrompt({
      family: face.family,
      role: face.role,
      locale: 'latin',
      tags: [],
      vibe: face.vibe,
    }),
    tags: ['built-in'],
    shipping: 'vendored' as const,
    installed: vendorInstalled,
  }));
  const sliced: FontCatalogEntry[] = FONT_LIBRARY.map((spec) => ({
    family: spec.family,
    aliases: [...(spec.aliases ?? [])],
    role: spec.role,
    license: spec.license,
    licenseName: LICENSES[spec.license].name,
    locale: spec.locale,
    vibe: spec.vibe,
    prompt: spec.prompt ?? composeFontPrompt(spec),
    tags: [...spec.tags],
    shipping: 'sliced' as const,
    installed: cssSourcesFor(spec).length > 0,
  }));
  return [...vendored, ...sliced];
}

/** Default preview sample, per locale: a Latin sample means nothing for a Chinese font (it all falls to fallback glyphs). */
export function defaultSampleText(locale: FontCatalogEntry['locale']): string {
  if (locale === 'zh-CN') return '天空为什么是蓝的 · 一支片子 0123';
  if (locale === 'ja-JP') return '空はなぜ青いのか 一本の映像 0123';
  if (locale === 'ko-KR') return '하늘은 왜 파란가 한 편의 영상 0123';
  return 'The quick brown fox jumps · 0123';
}

/** Slices a preview uses: file name → absolute path. CSS generation and slice serving share it, so they cannot diverge. */
function previewSlices(family: string): { blocks: Array<{ block: FontFaceBlock; file: string; weight?: number }>; files: Map<string, string> } | null {
  const vendorFace = VENDOR_LATIN.find((f) => f.family === family);
  const spec = FONT_LIBRARY.find((s) => s.family === family);
  if (!vendorFace && !spec) return null;

  const blocks: Array<{ block: FontFaceBlock; file: string; weight?: number }> = [];
  const files = new Map<string, string>();
  const take = (block: FontFaceBlock, source: string, weight?: number): void => {
    if (!existsSync(source)) return;
    /* File names must be unique: same-named slices under different weights would overwrite each other, so prefix the weight. */
    const name = `${weight ?? 'v'}-${basename(block.url)}`;
    files.set(name, source);
    blocks.push({ block, file: name, weight });
  };

  if (vendorFace) {
    const cssPath = join(VENDORED_FONT_DIR, 'fonts.css');
    if (!existsSync(cssPath)) return null;
    /* The vendored css mixes all four families; keep only this family's blocks. */
    const wanted = new RegExp(`font-family:\\s*['"]${escapeRe(vendorFace.family)}['"]`, 'i');
    const own = parseSlicedCss(cssPath).filter((b) => wanted.test(b.raw));
    /* The css says `fonts/X.woff2`: that is the **packaged** layout (packaging copies vendor/fonts/files
       to <playback>/fonts, see pack-web-playback). In the source tree that directory is called files. */
    for (const block of own.slice(0, 1)) {
      take(block, join(VENDORED_FONT_DIR, block.url.replace(/^fonts\//, 'files/')));
    }
  } else {
    /*
     * Take only the first weight.
     *
     * The sample is one line; it does not need light/regular/bold. For Chinese fonts this is not
     * about saving a little traffic: each weight of an @fontsource CJK package is **one 7-8MB woff2**
     * (with no unicode-range, so it cannot be cut by the characters used); three weights are 22MB.
     */
    const [first] = cssSourcesFor(spec!);
    if (!first) return null;
    const cssDir = dirname(first.path);
    for (const block of parseSlicedCss(first.path)) {
      take(block, join(cssDir, block.url), first.weight);
    }
  }
  return blocks.length ? { blocks, files } : null;
}

/**
 * @font-face for the preview.
 *
 * woff2 is **served by URL**, not inlined as a data URL. Inlining looks like it saves a round trip,
 * but it defeats fontsource's on-demand slicing: families with unicode-range have two hundred-plus
 * slices, and inlining stuffs every hit into one CSS; a CJK family without unicode-range is one 7MB
 * slice, 9MB after base64. The browser has to download it all before parsing, so the preview
 * seems to hang after a click (hit on 2026-08-13, 31MB).
 *
 * Handed to the browser, it fetches only the slices whose unicode-range covers the sample and
 * never requests the rest.
 *
 * `sliceBase` is the URL prefix for fetching bytes (the caller supplies it, since only the caller
 * knows what its proxy route is called).
 * Returns null if the family is not found or its package is not installed (the caller answers 404).
 */
export function renderFontPreviewCss(
  family: string,
  sampleText?: string,
  sliceBase = '/v1/fonts/slice',
): string | null {
  const found = previewSlices(family);
  if (!found) return null;

  const spec = FONT_LIBRARY.find((s) => s.family === family);
  const canonical = VENDOR_LATIN.find((f) => f.family === family)?.family ?? spec?.family ?? family;
  const codepoints = collectCodepoints(sampleText?.trim() || defaultSampleText(spec?.locale ?? 'latin'));

  const parts: string[] = [];
  for (const { block, file, weight } of found.blocks) {
    // Coarse server-side unicode-range filter first: slices that cannot reach the sample get no @font-face at all.
    if (block.ranges && !rangesHit(block.ranges, codepoints)) continue;
    const url = `${sliceBase}?family=${encodeURIComponent(canonical)}&file=${encodeURIComponent(file)}`;
    let raw = block.raw
      .replace(/src:\s*[^;]+;/, `src: url("${url}") format('woff2');`)
      .replace(/font-family\s*:\s*("[^"]*"|'[^']*')/, `font-family: '${canonical}'`);
    if (weight !== undefined) raw = raw.replace(/font-weight\s*:\s*[0-9]+/, `font-weight: ${weight}`);
    parts.push(raw);
  }
  return parts.length ? `${parts.join('\n')}\n` : null;
}

/**
 * Read the bytes of one preview slice.
 *
 * The file name is looked up only in the table previewSlices builds; no path is accepted, so it
 * cannot escape.
 */
export function readFontPreviewSlice(family: string, file: string): Buffer | null {
  const path = previewSlices(family)?.files.get(file);
  return path && existsSync(path) ? readFileSync(path) : null;
}
