// Ported from mexicat/pdoom-video (MIT, see LICENSE-pdoom-video.txt) and adapted for One Prompt.
// Typography: font registry (Canvas2D via FontFace + outlines via opentype.js),
import { loadBytes } from './load';
// glyph layout, text outlines as Path2D, and point sampling of text for particle effects.


/**
 * Font keys. Archivo comes in static width instances (w = wdth*10) x weights so we can
 * animate width in discrete steps: 620, 750, 875, 1000, 1125, 1250 and weights 300/500/700/900.
 */
export const ARCHIVO_WIDTHS = [620, 750, 875, 1000, 1125, 1250] as const;
export const ARCHIVO_WEIGHTS = [300, 500, 700, 900] as const;

/**
 * One variable file per family; each (width, weight) instance is registered as its own family name with
 * single-value descriptors, so the browser clamps the variation axes to that instance.
 */
type FontDef = { family: string; file: string; stretch?: string; weight?: string; features?: string };
const DEFS: FontDef[] = [];
for (const w of ARCHIVO_WIDTHS) for (const wt of ARCHIVO_WEIGHTS) DEFS.push({ family: `Archivo-${w}-${wt}`, file: 'Archivo-VF.ttf', stretch: `${w / 10}%`, weight: `${wt}` });
for (const w of [750, 1000]) for (const wt of [400, 800]) DEFS.push({ family: `ArchivoItalic-${w}-${wt}`, file: 'ArchivoItalic-VF.ttf', stretch: `${w / 10}%`, weight: `${wt}` });
for (const wt of [400, 600]) {
  DEFS.push({ family: `Cormorant-${wt}`, file: 'CormorantGaramond-Italic[wght].ttf', weight: `${wt}`, features: '"lnum" 1' });
  DEFS.push({ family: `CormorantItalic-${wt}`, file: 'CormorantGaramond-Italic[wght].ttf', weight: `${wt}`, features: '"lnum" 1' });
}
for (const [n, f] of [['300', 'Regular'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'SemiBold'], ['700', 'SemiBold']] as const)
  DEFS.push({ family: `Plex-${n}`, file: `IBMPlexMono-${f}.ttf` });
DEFS.push({ family: 'PlexItalic-400', file: 'IBMPlexMono-Regular.ttf' });

/** Convenience family names. */
export const F = {
  /** Archivo at nearest available width/weight. width in [62..125] (percent), weight 300..900 */
  archivo(width = 100, weight = 700): string {
    const w = nearest(ARCHIVO_WIDTHS as unknown as number[], width * 10);
    const wt = nearest(ARCHIVO_WEIGHTS as unknown as number[], weight);
    return `Archivo-${w}-${wt}`;
  },
  archivoItalic(width = 100, weight = 800): string {
    return `ArchivoItalic-${width < 88 ? 750 : 1000}-${weight < 600 ? 400 : 800}`;
  },
  serif(weight = 400, italic = false): string {
    return `${italic ? 'CormorantItalic' : 'Cormorant'}-${weight < 500 ? 400 : 600}`;
  },
  mono(weight = 400, italic = false): string {
    if (italic) return 'PlexItalic-400';
    return `Plex-${nearest([300, 400, 500, 600, 700], weight)}`;
  },
};

function nearest(list: number[], v: number) {
  let best = list[0]!;
  for (const x of list) if (Math.abs(x - v) < Math.abs(best - v)) best = x;
  return best;
}

/** CSS font string for Canvas2D. */
export const font = (family: string, sizePx: number) => `${sizePx}px "${family}"`;

const bufCache = new Map<string, Promise<ArrayBuffer>>();

export async function loadFonts(): Promise<void> {
  const get = (file: string) => { let p = bufCache.get(file); if (!p) { p = loadBytes(`assets/fonts/${file}`); bufCache.set(file, p); } return p; };
  await Promise.all(
    DEFS.map(async (d) => {
      const buf = await get(d.file);
      const desc: FontFaceDescriptors = {};
      if (d.stretch) desc.stretch = d.stretch;
      if (d.weight) desc.weight = d.weight;
      if (d.features) desc.featureSettings = d.features;
      const ff = new FontFace(d.family, buf, desc);
      await ff.load();
      document.fonts.add(ff);
    }),
  );
  await document.fonts.ready;
}

export interface Glyph {
  ch: string;
  i: number; // char index in string
  x: number; // left edge (px), relative to the text origin
  w: number; // advance width (px)
}
export interface TextLayout {
  text: string;
  family: string;
  size: number;
  width: number; // total advance width
  ascent: number;
  descent: number;
  glyphs: Glyph[];
}

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

/**
 * Per-glyph horizontal layout with the font's kerning, for drawing glyphs one by one.
 * Glyph i sits at the width of text[0..i] minus its own advance, so the kerning between it and the
 * previous glyph moves *it* (the width of text[0..i) alone leaves that pair out: every kern would land
 * one glyph late, e.g. the Y–o kern of "Your" pushing the u into the o). `w` is the glyph's own advance.
 * `tracking` is extra letter spacing in px.
 */
export function layout(text: string, family: string, size: number, tracking = 0): TextLayout {
  const c = mctx();
  c.font = font(family, size);
  const glyphs: Glyph[] = [];
  const chars = Array.from(text);
  let prefix = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    prefix += ch;
    const w = c.measureText(ch).width;
    glyphs.push({ ch, i, x: c.measureText(prefix).width - w + i * tracking, w });
  }
  const m = c.measureText(text || 'M');
  return {
    text, family, size,
    width: (text ? m.width : 0) + Math.max(0, chars.length - 1) * tracking,
    ascent: m.fontBoundingBoxAscent ?? size * 0.8,
    descent: m.fontBoundingBoxDescent ?? size * 0.2,
    glyphs,
  };
}

/**
 * x (px) of glyph `index` in `text` set as one kerned run — where to start drawing text[index..] when a
 * word is split into separately drawn pieces (sung/unsung colours, a clipped wipe). Measuring
 * text[0..index) instead would drop the kern between the two pieces. Past the end: the run's width.
 */
export function glyphX(text: string, index: number, family: string, size: number, tracking = 0): number {
  const chars = Array.from(text);
  if (index <= 0) return 0;
  if (index >= chars.length) return measure(text, family, size, tracking);
  const c = mctx();
  c.font = font(family, size);
  return c.measureText(chars.slice(0, index + 1).join('')).width - c.measureText(chars[index]!).width + index * tracking;
}

/**
 * Typographic punctuation for display text: curly apostrophes and quotes, the ellipsis character.
 * Leading elisions (’cause, ’til, ’em, ’90s) get an apostrophe, not an opening quote.
 */
export function smart(s: string): string {
  return s
    .replace(/\.\.\./g, '…')
    .replace(/(^|[\s([{—–-])'(?=(?:cause|cos|til|em|round|n|tis|twas|\d0s)\b)/gi, '$1’')
    .replace(/(^|[\s([{—–-])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s([{—–-])"/g, '$1“')
    .replace(/"/g, '”');
}

/** Typewriter quotes back (mono UI text that shows a lyric as typed input or code). */
export const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');

export function measure(text: string, family: string, size: number, tracking = 0) {
  const c = mctx();
  c.font = font(family, size);
  return c.measureText(text).width + Math.max(0, Array.from(text).length - 1) * tracking;
}

/** Largest font size (<= max) at which text fits in maxWidth. */
export function fitSize(text: string, family: string, maxWidth: number, max = 400, tracking = 0) {
  const w = measure(text, family, 100, tracking * 100 / max);
  return Math.min(max, (100 * maxWidth) / Math.max(1, w));
}

export function textPoints(text: string, family: string, size: number, step = 6, seed = 1): { x: number; y: number }[] {
  const lay = layout(text, family, size);
  const pad = Math.ceil(size * 0.3);
  const W = Math.ceil(lay.width + pad * 2), H = Math.ceil(size * 1.6);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = font(family, size);
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  const base = Math.round(size * 1.15);
  c.fillText(text, pad, base);
  const data = c.getImageData(0, 0, W, H).data;
  const out: { x: number; y: number }[] = [];
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const jx = x + (rnd() - 0.5) * step * 0.8, jy = y + (rnd() - 0.5) * step * 0.8;
      const ix = Math.max(0, Math.min(W - 1, Math.round(jx))), iy = Math.max(0, Math.min(H - 1, Math.round(jy)));
      if (data[(iy * W + ix) * 4 + 3]! > 128) out.push({ x: jx - pad, y: jy - base });
    }
  }
  return out;
}
