/**
 * Design tokens: the single source of truth for aesthetics.
 * Components may only reference tokens, never raw hex or arbitrary px; the model's choice space contains no ugly options.
 *
 * Hard rule: every ThemePalette field must actually affect rendering (have a consumer) and have a visual swatch in the dev tools.
 * Config fields that have no effect / no visible result are not allowed.
 */
import { resolveFontFamily } from './fonts';

/* ───────────────────── Theme palette (default parameters for Theme Design) ─────────────────────
 * Every field has a real render consumer (see each field's comment) and a visual swatch in the dev tools.
 * Components only reference semantic roles (COLOR.ink/primary/...); Web TSX films define their own colors in _shared.tsx.
 */

/**
 * Background decor layer vocabulary (composable; position/intensity parameterized), all deterministic SVG with zero asset dependencies. Rendered by renderDecor.
 *   glow     - radial glow (ambient light on dark backgrounds)
 *   dots     - fine dot grid
 *   grid     - fine grid (print / blueprint / chalkboard graph paper)
 *   frame    - inset thin border
 *   corners  - short corner accent lines (top-left + bottom-right)
 *   band     - edge-hugging color band / thin line
 *   vignette - darkened edges to focus the center
 */
export type DecorLayer =
  | { kind: 'glow'; at: [number, number]; color: string; opacity?: number; r?: number }
  | { kind: 'dots'; color: string; opacity?: number; gap?: number }
  | { kind: 'grid'; color: string; opacity?: number; gap?: number }
  | { kind: 'frame'; color: string; opacity?: number; width?: number }
  | { kind: 'corners'; color: string; width?: number; len?: number }
  | { kind: 'band'; edge: 'top' | 'bottom' | 'left' | 'right'; color: string; size?: number; opacity?: number }
  | { kind: 'vignette'; opacity?: number }
  /* ── Large-shape decor (the workhorse of the designed look; big edge-hugging color shapes with presence that stay out of the safe area) ── */
  /** Organic blob: large circle or ellipse hugging a corner/edge (filled or stroked) */
  | { kind: 'blob'; at: [number, number]; r: number; color: string; opacity?: number; stroke?: boolean; squish?: number }
  /** Large arc: thin ring spanning the frame (illustrative line work) */
  | { kind: 'arc'; at: [number, number]; r: number; color: string; opacity?: number; width?: number }
  /** Right-edge navigation dot column (vertical small dots, a signature PPT template element) */
  | { kind: 'dotcol'; color: string; n?: number; activeColor?: string; opacity?: number }
  /** Slanted color wedge: a block cutting in diagonally from one edge (angle in degrees, positive = clockwise) */
  | { kind: 'wedge'; edge: 'left' | 'right' | 'top' | 'bottom'; depth: number; skew?: number; color: string; opacity?: number }
  /** Concentric half-circle pattern (evenly spaced arc group hugging a corner, Japanese pattern feel) */
  | { kind: 'ripple-corner'; at: [number, number]; color: string; n?: number; gap?: number; opacity?: number; width?: number }
  /** Plus/cross array (small mark array hugging a corner) */
  | { kind: 'plus'; at: [number, number]; color: string; n?: number; gap?: number; size?: number; opacity?: number }
  /* ── Illustration vocabulary (hand-drawn-feel decor, deterministic with zero randomness) ── */
  /** Wave band: edge-hugging sine-wave color band (ocean / fluid / relaxed feel) */
  | { kind: 'wave'; edge: 'top' | 'bottom'; color: string; amp?: number; freq?: number; opacity?: number; offset?: number }
  /** Rays: sunburst radiating out from a point (propaganda poster / energetic feel) */
  | { kind: 'rays'; at: [number, number]; color: string; n?: number; opacity?: number; r?: number; width?: number }
  /** Layered mountains: polyline ridges along the bottom edge (geography / outdoors / exploration feel) */
  | { kind: 'mountains'; color: string; peaks?: number; height?: number; opacity?: number }
  /** Stars: deterministically scattered four-point stars / twinkling dots (night sky / dreamy feel) */
  | { kind: 'stars'; color: string; n?: number; opacity?: number; seed?: number }
  /** Scallop edge: row of half-circles along an edge (Japanese pattern / decorative border) */
  | { kind: 'scallop'; edge: 'top' | 'bottom'; color: string; r?: number; opacity?: number }
  /** Diagonal stripes: diagonal-stripe fill block (corner triangle or full surface) */
  | { kind: 'stripes'; color: string; gap?: number; width?: number; opacity?: number; angle?: number; corner?: 'tl' | 'tr' | 'bl' | 'br'; size?: number }
  /** Hand-drawn wavy line: a single free squiggle curve (notebook / journal feel) */
  | { kind: 'squiggle'; at: [number, number]; color: string; len?: number; amp?: number; n?: number; width?: number; opacity?: number }
  /** Confetti: deterministically scattered small shapes (circle/square/triangle; celebratory / lively feel) */
  | { kind: 'confetti'; colors: string[]; n?: number; opacity?: number; seed?: number }
  /** Ribbon arc: thick, strongly curved line across a corner (editorial PPT signature; from/to/ctrl are all [x,y] fractional coordinates) */
  | { kind: 'ribbon'; from: [number, number]; to: [number, number]; ctrl?: [number, number]; ctrl2?: [number, number]; color: string; width?: number; opacity?: number }
  /** Segmented color bar: edge-hugging multicolor band split into equal parts (dark-interface PPT signature; colors fill the edge evenly, in order) */
  | { kind: 'segments'; edge: 'top' | 'bottom'; colors: string[]; size?: number; opacity?: number }
  /**
   * Vector illustration (any SVG as a fill element):
   *   svg     - raw SVG markup (a single <svg>...</svg> with a viewBox; any internal coordinate system)
   *   at      - top-left placement point (stage fraction [x, y], default [0, 0])
   *   size    - rendered size (stage fraction [w, h], default [1, 1], i.e. fills the stage)
   *   opacity - overall opacity (default 1)
   *   align   - aspect-ratio scaling alignment (SVG preserveAspectRatio, default 'xMidYMid meet'; 'none' stretches non-uniformly)
   * Like other decor, drawn above the background color and below content; reuse the same svg string for the same illustration to hit the cache.
   */
  | {
      kind: 'illustration';
      svg: string;
      at?: [number, number];
      size?: [number, number];
      opacity?: number;
      align?: string;
    };

export interface ThemePalette {
  /** Main ink color (text / primary lines) -> COLOR.ink / TONE_COLOR.default / resolveTone */
  ink: string;
  /** Primary graphic color -> COLOR.primary / TONE_COLOR.primary */
  primary: string;
  /** Secondary graphic color (second data series / supporting structure; falls back to primary) -> COLOR.secondary / TONE_COLOR.secondary */
  secondary?: string;
  /** Accent (highlight / resonance / emphasis) -> COLOR.accent / chrome kicker dash */
  accent: string;
  /** De-emphasized (reference objects / exiting / secondary) -> COLOR.muted / chrome page number and footer */
  muted: string;
  /** Guide lines / borders -> COLOR.faint / default box stroke / surfaceStroke fallback */
  faint: string;
  /** Success / positive -> COLOR.positive / TONE_COLOR.positive */
  positive: string;
  /** Warning / error -> COLOR.negative / TONE_COLOR.negative */
  negative: string;
  /** Stage background color -> render-layer background rect / COLOR.bg */
  bg: string;
  /** Stage background gradient (overrides flat bg when set; [start, end], diagonal) -> render-layer linearGradient */
  bgGradient?: [string, string];
  /**
   * Background decor layers (PPT template feel): an ordered layer array drawn above the background color and below content.
   * Default = plain-color stage. See DecorLayer for the vocabulary; all deterministic SVG, zero asset dependencies. -> renderDecor
   */
  decor?: DecorLayer[];
  /**
   * Per-page-type decor overrides (a real PPT template's "cover / section / content master backgrounds"):
   *   cover   - beat 1 (cover)
   *   section - beats whose layout template is title (section pages)
   *   content - all other content pages (falls back to decor)
   * Unconfigured page types fall back to decor; bg/bgGradient can likewise be overridden per page type. -> renderDecor picks the layers
   */
  decorByPage?: {
    cover?: DecorLayer[];
    section?: DecorLayer[];
    content?: DecorLayer[];
  };
  /** Per-page-type background override (optional; e.g. an inverted full background on the cover) -> render-layer background rect/gradient */
  bgByPage?: {
    cover?: string | [string, string];
    section?: string | [string, string];
  };
  /** Accent background (highlight fill) -> COLOR.accentBg / ROLE_COLOR.accentBg / markdown code block background */
  accentBg: string;
  /** Third accent (optional; multi-series charts / component colors; falls back to accent) -> TONE_COLOR.magenta / paletteHex */
  magenta?: string;
  /** Card background -> COLOR.surface / ROLE_COLOR.surface / box fill */
  surface: string;
  /** Card stroke (optional; falls back to faint) -> COLOR.surfaceStroke / box stroke */
  surfaceStroke?: string;
  /** Body font family (sans-serif; default family for component text) -> FAMILY.sans */
  fontSans?: string;
  /** Small label font (badge / tick / kicker) -> FAMILY.label / chrome */
  fontLabel?: string;
  /** Monospace font (code / data; default Menlo) -> FAMILY.mono */
  fontMono?: string;
  /** Overall font-size multiplier (default 1; big-poster style 1.1) -> the seven live FONT.* steps */
  fontScale?: number;
  /** Corner radius overrides (partial; e.g. candy fully rounded, ink-grid square) -> RADIUS.sm/md/lg */
  radius?: Partial<Record<'sm' | 'md' | 'lg', number>>;
  /** Stroke width multiplier (default 1; print style 0.8, heavy-stroke style 1.4) -> STROKE.hairline/normal/bold/heavy */
  strokeScale?: number;
  /**
   * Slide chrome (drawn automatically by the render layer, invisible to the model) -> renderChrome
   *   kicker - current beat title in the top-left (small caps, wide letter spacing)
   *   pageNo - "03 / 11" in the bottom-right
   *   footer - film title in the bottom-left
   */
  chrome?: { kicker?: boolean; pageNo?: boolean; footer?: boolean };
}

/**
 * Default palette placeholder: the initial value at module load.
 * Before real rendering, applyThemeDesign() loads DEFAULT_THEME_PALETTE;
 * this object is only a type-safe placeholder for the window "after module load, before the first applyThemeDesign".
 */
const DEFAULT_PALETTE: ThemePalette = {
  ink: '#eef2fb',
  primary: '#5eb0ff',
  accent: '#ffb45e',
  muted: '#8b93ad',
  faint: '#2e3550',
  positive: '#52d499',
  negative: '#ff7a7a',
  bg: '#141a2e',
  bgGradient: ['#10162b', '#1f2a4d'],
  accentBg: '#33250f',
  magenta: '#c77dff',
  surface: '#1d2440',
  surfaceStroke: '#39426a',
};

let activeTheme: ThemePalette = DEFAULT_PALETTE;

/** Load a complete palette directly (used by applyThemeDesign) */
export function setThemePalette(p: ThemePalette): void {
  activeTheme = p;
}
/** Current theme object (renderers read gradient / card surface / chrome from it) */
export function currentTheme(): ThemePalette {
  return activeTheme;
}

/* Palette: live view of semantic roles (follows the current theme) */
export const COLOR = {
  get ink() { return activeTheme.ink; },
  get primary() { return activeTheme.primary; },
  get secondary() { return activeTheme.secondary ?? activeTheme.primary; },
  get accent() { return activeTheme.accent; },
  get muted() { return activeTheme.muted; },
  get faint() { return activeTheme.faint; },
  get positive() { return activeTheme.positive; },
  get negative() { return activeTheme.negative; },
  get bg() { return activeTheme.bg; },
  get accentBg() { return activeTheme.accentBg; },
  get surface() { return activeTheme.surface; },
  get surfaceStroke() { return activeTheme.surfaceStroke ?? activeTheme.faint; },
};

export type ColorToken = keyof typeof COLOR;

/** Semantic tone: component params take a tone rather than a color */
export type Tone = 'default' | 'primary' | 'secondary' | 'accent' | 'muted' | 'positive' | 'negative' | 'magenta';

/** Physical hue names: for real-world colors (rainbow / spectrum / traffic lights...); theme-independent, lightness tuned to read on both dark and light backgrounds */
export const HUE_COLOR: Record<string, string> = {
  red: '#e5484d', orange: '#f76b15', yellow: '#f5d90a', green: '#46a758',
  cyan: '#00a2c7', blue: '#3e63dd', purple: '#8e4ec6', pink: '#d6409f',
  brown: '#ad7f58', white: '#f4f4f2', black: '#1b1b1b', gray: '#8d8d86',
};

/** Palette role name (kebab/camel/all-lowercase all accepted) -> current template hex */
function paletteHex(name: string): string | null {
  const t = activeTheme;
  switch (name) {
    case 'ink': return t.ink;
    case 'primary': return t.primary;
    case 'secondary': return t.secondary ?? t.primary;
    case 'accent': return t.accent;
    case 'muted': return t.muted;
    case 'faint': return t.faint;
    case 'positive': return t.positive;
    case 'negative': return t.negative;
    case 'magenta': return t.magenta ?? t.accent;
    case 'bg': return Array.isArray(t.bgGradient) ? t.bgGradient[0]! : t.bg;
    case 'surface': return t.surface;
    // Secondary card surface / texture: the model often writes surface2/surfaceAlt for a second-level background; map it sensibly so it doesn't resolve to nothing.
    case 'surface2':
    case 'surface-2':
    case 'surfacealt':
    case 'surface-alt': return t.accentBg ?? t.surface;
    case 'surface-stroke':
    case 'surfacestroke': return t.surfaceStroke ?? t.faint;
    case 'accent-bg':
    case 'accentbg': return t.accentBg;
    default: return null;
  }
}

/**
 * Resolve CSS variables the model writes in native svg/html to the current template colors.
 * The engine itself has no CSS variable layer (plain strings + resvg/satori rendering; none of the three targets resolve var()),
 * so var(--token) must be replaced before embedding/baking:
 *   var(--primary) / var(--ink) / var(--accent) ...  -> current template semantic hex (re-renders on reskin; same source as component colors)
 *   var(--red) / var(--blue) ...                      -> physical hue (theme-independent)
 *   var(--unknown, #fallback)                        -> use the fallback
 *   var(--unknown) (no fallback)                     -> drop the whole declaration (browsers resolve such a var() to initial;
 *                                                      satori doesn't accept initial, fails the whole render and falls back to a placeholder -> blank frame)
 */
export function resolveCssVars(src: string): string {
  if (!src || !src.includes('var(')) return src;
  let out = src.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^)]*?))?\s*\)/gi, (whole, rawName: string, fallback?: string) => {
    const name = String(rawName).toLowerCase();
    const hex = paletteHex(name) ?? HUE_COLOR[name] ?? null;
    if (hex) return hex;
    const fb = (fallback ?? '').trim();
    return fb || whole;
  });
  // Safety net: any var() still unresolved (unknown token and no fallback) -> drop its declaration.
  // Left in place it parses as `prop: initial`, and satori throws "Failed to parse declaration",
  // so the whole html bake falls back to a placeholder box (what users saw as "html throughout, nothing rendered").
  if (out.includes('var(')) {
    out = out.replace(/[^;:"'{}]+:\s*[^;"'{}]*var\([^)]*\)[^;"'{}]*;?/gi, '');
  }
  return out;
}

/**
 * tone value -> color, resolved in order:
 * 1. semantic tone (primary/accent/...) -> current theme (preferred; follows template reskin);
 * 2. physical hue name (red/blue/...) -> HUE_COLOR (for real-world colors; theme-independent);
 * 3. custom color passthrough: #hex / rgb() / rgba() / hsl() (escape hatch when neither semantic colors nor hue names fit);
 * 4. none recognized -> fall back to the default semantic tone.
 */
export function resolveTone(v: unknown, dflt: Tone): string {
  const s = String(v ?? '');
  if (s.startsWith('#') || s.startsWith('rgb') || s.startsWith('hsl')) return s;
  return TONE_COLOR[s as Tone] ?? ROLE_COLOR[s] ?? HUE_COLOR[s] ?? TONE_COLOR[dflt];
}

/**
 * Structural theme role names (not tone semantic colors, but part of the palette): background / card surface / stroke / texture.
 * Lets the director use ink/faint/surface/accentBg/surfaceStroke as color values instead of memorizing hex.
 * Like TONE_COLOR, follows the current theme on reskin.
 */
export const ROLE_COLOR: Record<string, string> = {
  get ink() { return activeTheme.ink; },
  get faint() { return activeTheme.faint; },
  get surface() { return activeTheme.surface; },
  get surfaceStroke() { return activeTheme.surfaceStroke ?? activeTheme.faint; },
  get accentBg() { return activeTheme.accentBg; },
};

/** Add alpha to a color: #rgb/#rrggbb get a hex alpha appended; rgb()/hsl() can't be concatenated for SVG, so they degrade to the original color */
export function withAlpha(color: string, hexAlpha: string): string {
  if (color.startsWith('#')) {
    const c = color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color;
    return c.length === 7 ? `${c}${hexAlpha}` : c;
  }
  return color;
}

export const TONE_COLOR: Record<Tone, string> = {
  get default() { return activeTheme.ink; },
  get primary() { return activeTheme.primary; },
  get secondary() { return activeTheme.secondary ?? activeTheme.primary; },
  get accent() { return activeTheme.accent; },
  get muted() { return activeTheme.muted; },
  get positive() { return activeTheme.positive; },
  get negative() { return activeTheme.negative; },
  get magenta() { return activeTheme.magenta ?? activeTheme.accent; },
};

/* Font families: components may only reference tokens, never a raw font-family; the theme can override sans/label/mono */
export const FAMILY = {
  /** Body / labels (sans-serif) */
  get sans(): string { return activeTheme.fontSans ?? '-apple-system,PingFang SC,Helvetica Neue,sans-serif'; },
  /** Math / formulas (LaTeX Computer Modern style; STIX Two is designed in the same tradition as CM and ships with macOS) */
  math: "'STIX Two Text','STIX Two Math','Latin Modern Roman',Georgia,'Times New Roman',serif",
  /** Small label font (badge / tick / kicker; theme-overridable) */
  get label(): string { return activeTheme.fontLabel ?? FAMILY.sans; },
  /** Monospace (code / data; theme-overridable) */
  get mono(): string { return activeTheme.fontMono ?? "Menlo,'SF Mono',Consolas,monospace"; },
};

/* Type scale (px): components may only pick from these steps (live view: theme fontScale multiplier) */
export const FONT = {
  get xs(): number { return 24 * (activeTheme.fontScale ?? 1); },
  get sm(): number { return 30 * (activeTheme.fontScale ?? 1); },
  get md(): number { return 36 * (activeTheme.fontScale ?? 1); },
  get lg(): number { return 44 * (activeTheme.fontScale ?? 1); },
  get xl(): number { return 56 * (activeTheme.fontScale ?? 1); },
  get display(): number { return 72 * (activeTheme.fontScale ?? 1); },
  /** Giant type (cover headline / big-number page; PPT scale) */
  get hero(): number { return 132 * (activeTheme.fontScale ?? 1); },
};

export type FontToken = keyof typeof FONT;

/** Tailwind-style aliases -> engine type scale (the model often writes 2xl/3xl; these must map to real steps) */
const FONT_SIZE_ALIASES: Record<string, FontToken> = {
  '2xl': 'xl',
  '3xl': 'display',
  '4xl': 'display',
  '5xl': 'hero',
  '6xl': 'hero',
};

/** Resolve a text size param to a pixel size; unknown steps return md and can be reported in validate */
export function resolveFontPx(sizeKey: unknown, fallback: FontToken = 'md'): number {
  const raw = String(sizeKey ?? fallback).trim() as FontToken;
  const key = (FONT_SIZE_ALIASES[raw] ?? raw) as FontToken;
  const px = FONT[key];
  return typeof px === 'number' && Number.isFinite(px) ? px : FONT[fallback];
}

export function isKnownFontToken(sizeKey: unknown): boolean {
  const raw = String(sizeKey ?? '').trim();
  if (!raw) return true;
  if (raw in FONT_SIZE_ALIASES) return true;
  return raw in FONT;
}

/* Spacing scale (px) */
export const SPACE = {
  xs: 12,
  sm: 24,
  md: 44,
  lg: 72,
  xl: 110,
  xxl: 160,
} as const;

export type SpaceToken = keyof typeof SPACE;

/** Buff (named or pixels) -> pixels; unknown named steps fall back to the default (lenient; declaration-time checks report it separately) */
export function buffPx(b: SpaceToken | number | undefined, dflt: SpaceToken = 'md'): number {
  if (typeof b === 'number') return b;
  return SPACE[b ?? dflt] ?? SPACE[dflt];
}

/* Stroke width steps (live view: theme strokeScale multiplier) */
export const STROKE = {
  get hairline(): number { return 1.5 * (activeTheme.strokeScale ?? 1); },
  get normal(): number { return 2.5 * (activeTheme.strokeScale ?? 1); },
  get bold(): number { return 4 * (activeTheme.strokeScale ?? 1); },
  get heavy(): number { return 6 * (activeTheme.strokeScale ?? 1); },
};

/* Corner radius steps (live view: theme-overridable; candy fully rounded / ink-grid square) */
export const RADIUS = {
  get sm(): number { return activeTheme.radius?.sm ?? 8; },
  get md(): number { return activeTheme.radius?.md ?? 14; },
  get lg(): number { return activeTheme.radius?.lg ?? 20; },
};

/* Easing steps (animations may only pick from these) */
export const EASE = {
  /** Default: smooth in and out */
  smooth: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** Entrance: decelerate */
  out: (t: number): number => 1 - Math.pow(1 - t, 3),
  /** Exit: accelerate */
  in: (t: number): number => t * t * t,
  /** Linear (sweeps / counters) */
  linear: (t: number): number => t,
  /** Back overshoot: passes the end and springs back (pop / stamp-in entrance) */
  backOut: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  /** Landing bounce: bounces twice at the end (drop / settle into place) */
  bounceOut: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
    if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
  },
  /** Spring oscillation: decaying oscillation around the end (playful / elastic emphasis) */
  elasticOut: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
} as const;

export type EaseToken = keyof typeof EASE;

/* Duration steps (ms): used by engine actions */
export const DUR = {
  quick: 350,
  normal: 700,
  slow: 1400,
  long: 2200,
} as const;

export type DurToken = keyof typeof DUR;

export function durMs(d: DurToken | number | undefined, dflt: DurToken = 'normal'): number {
  if (typeof d === 'number') return d;
  return DUR[d ?? dflt];
}

/* ───────────────────── Text measurement (the single implementation for the whole engine) ─────────────────────
 * Deterministic width estimate without a DOM: empirical width factors (relative to 1 em) per character class.
 * Much more accurate than the old "all Latin = 0.55": narrow letters / punctuation / digits are bucketed, CJK punctuation is full width.
 */
const CH_NARROW = /[iljftI.,:;'"`!|()\[\]{} ]/;
const CH_WIDE = /[mwMW@]/;
const CH_DIGIT = /[0-9]/;
const CH_UPPER = /[A-Z]/;

/** Estimated single-line text width (px). CJK = 1 em; Latin 0.3-0.95 em by character class. */
export function measureText(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x2e7f) w += 1; // CJK characters and full-width punctuation
    else if (CH_NARROW.test(ch)) w += 0.3;
    else if (CH_WIDE.test(ch)) w += 0.95;
    else if (CH_DIGIT.test(ch)) w += 0.58;
    else if (CH_UPPER.test(ch)) w += 0.72;
    else w += 0.52;
  }
  return Math.max(w * size, size);
}

/**
 * Strip decorative emoji (Misc Symbols / Dingbats / Emoticons / Transport / Symbols / Pictographs / supplementary planes).
 * Server-side resvg has no emoji font, so any emoji renders as tofu; real browsers do show them, but in a serious
 * explainer style emoji decoration often cheapens the design (and fonts differ across the three targets). Strip once at textual component entry, collapsing surrounding spaces/separators too.
 */
export function stripEmoji(s: string): string {
  return s
    // Pictographic symbols in the BMP: Misc Symbols (☀ ☁ ★ ☑ ☓ ☢ ♻ etc.) + Dingbats (✂ ✈ ✉ ✓ ✔ ✗ ✘ ★ ✦ etc.)
    // + Misc Technical (⌛ ⌚ ⏰ ⏳ etc.) + Geometric Shapes (■ ● ▲ ◆ etc.) + Misc Symbols and Arrows (⬆ ⬇ ⭐ ⭕ etc.)
    // Note: the arrows block U+2190-21FF (← → ↑ ↓ ⇒ ⇔ etc.) is not stripped; → is a basic tool in narration
    .replace(/[☀-➿⌀-⏿■-◿⬀-⯿]/g, '')
    // Supplementary-plane emoji (😀 🌌 🪐 etc., U+1F000-1FFFF)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    // Emoji variation selector + ZWJ sequence joiner (so no orphans are left behind)
    .replace(/[\u{FE0F}\u{200D}]/gu, '')
    .replace(/^[\s·•\-—]+|[\s·•\-—]+$/g, '')
    .replace(/\s{2,}/g, ' ');
}

/**
 * Multi-line wrapping: greedy line breaks by estimated width (CJK breaks anywhere; Latin breaks at spaces, overlong words are force-split).
 * Returns each line's text; with lineHeight = size * 1.5 this gives the multi-line block height.
 * The user's hard line breaks (\n) are honored first; each hard line is then soft-wrapped by width.
 */
export function wrapText(s: string, size: number, maxWidth: number): string[] {
  if (s.includes('\n')) {
    return s.split(/\r?\n/).flatMap(seg => (seg === '' ? [''] : wrapText(seg, size, maxWidth)));
  }
  if (measureText(s, size) <= maxWidth) return [s];
  const lines: string[] = [];
  let line = '';
  let lineW = 0;
  // Split units: a run of Latin characters (a word) is one unit; CJK is one unit per character
  const units = s.match(/[⺀-﫿＀-￯]|[^\s⺀-﫿＀-￯]+\s?|\s/g) ?? [s];
  for (const u of units) {
    const uw = measureText(u, size);
    if (lineW + uw > maxWidth && line.trim()) {
      lines.push(line.trimEnd());
      line = u.trimStart();
      lineW = measureText(line, size);
    } else {
      line += u;
      lineW += uw;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [s];
}
