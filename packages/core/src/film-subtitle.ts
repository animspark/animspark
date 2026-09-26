/**
 * Subtitle styling for the film.tsx path: **one table, one function, three renderers**.
 *
 * The three are: the preview layer while editing (`SubtitleOverlay`), the capture page during
 * export (`code-shoot`), and the burn-in layer of the browser export (`export/film-stage`). Each used
 * to build its own CSS from the style table, and they slowly drifted apart: line height was 1.35 in
 * one place and `leading-snug` (1.375) in another. Nothing reports that kind of drift; it only shows
 * when the user puts the export next to the preview.
 *
 * So both the style table and **the step that builds the CSS** live here: `filmSubtitleCss()` is the
 * only way out, and the three renderers just apply the declarations it produces to their own
 * elements. The only legitimate difference is the font-size coordinate system (the preview follows
 * the window and uses the container unit `cqmin`; the capture page's stage is fixed native pixels),
 * which is passed in as a parameter.
 *
 * Quantities that follow the frame, like position and font size, are always stored as percentages or
 * em, never px: the same parameters serve both a small preview window and a 4K export, and the moment
 * they are stored in px they are only right for one of those sizes.
 */

/* ── Style ───────────────────────────────────────────────────────────────── */

/** Font. `sizePct` is a percentage of the frame's **short side**; everything else follows the font size (em), so changing resolution needs no retuning. */
export interface FilmSubtitleFont {
  /** The full CSS font-family stack. */
  family: string;
  /**
   * Percentage of the frame's short side.
   *
   * Measured against height, vertical frames would blow subtitles up into titles (the same setting
   * is 50px in 1080p landscape and 88px in portrait), leaving five or six Chinese characters per line
   * and pushing punctuation to the start of lines. The short side is the same physical size across
   * landscape, portrait and square frames.
   */
  sizePct: number;
  weight: number;
  italic: boolean;
  letterSpacingEm: number;
  lineHeight: number;
  /** All caps. Has no effect on CJK, but is common for short, title-style English subtitles. */
  upper: boolean;
}

/**
 * Stroke (outline).
 *
 * A real stroke via `-webkit-text-stroke` + `paint-order: stroke fill`, not an eight-way
 * text-shadow approximation: the latter shows eight jagged lobes on thick strokes and also uses up
 * text-shadow, which must stay free for the drop shadow, or the "stroke" and "shadow" controls would
 * fight each other. All three render targets are Chromium (preview, capture page, export page),
 * where `paint-order` is reliable; without it the stroke would sit inside the glyph and thin the
 * strokes.
 */
export interface FilmSubtitleStroke {
  widthEm: number;
  color: string;
}

/** Drop shadow. Offset and blur both scale with the font size. */
export interface FilmSubtitleShadow {
  dxEm: number;
  dyEm: number;
  blurEm: number;
  color: string;
}

/**
 * Background box.
 *
 * Color and opacity are stored separately because they are two controls in the UI: dragging the
 * opacity slider should not change the hex value in the color field.
 */
export interface FilmSubtitleBox {
  /** `#rrggbb`. */
  color: string;
  opacity: number;
  radiusEm: number;
  padXEm: number;
  padYEm: number;
}

export type FilmSubtitleAlign = 'left' | 'center' | 'right';

/**
 * Word-by-word highlighting (karaoke / short-video style: each word lights up as it is spoken).
 *
 *   color  the word being spoken changes color
 *   box    the word being spoken gets a background box (the most common style on Douyin and Reels)
 *   pop    the word being spoken changes color and grows slightly
 *
 * Word timing: if the cue carries per-word times (`FilmSubtitleCue.words`), they are used; otherwise
 * the cue's duration is split across words by character count. Voiceover is read at an even pace, so
 * this estimate stays in sync with the speech.
 */
export type FilmSubtitleKaraokeMode = 'color' | 'box' | 'pop';
export interface FilmSubtitleKaraoke {
  mode: FilmSubtitleKaraokeMode;
  /** Highlight color: the text color for color / pop, the background for box. */
  color: string;
}
export const FILM_SUBTITLE_KARAOKE_MODES: readonly FilmSubtitleKaraokeMode[] = ['color', 'box', 'pop'];
export const FILM_SUBTITLE_KARAOKE_DEFAULT: FilmSubtitleKaraoke = { mode: 'box', color: '#ffd400' };

/**
 * What this project's subtitles look like and where they sit.
 *
 * **Stored per project (on the server), not as a local viewer preference in the browser.** It used
 * to live in localStorage and follow the person, so films published to the showcase could not see
 * it: bundling could only use hard-coded defaults, and the style the user tuned in the editor was
 * lost as soon as the film left. Subtitle style is the author's decision for this film and must
 * travel with it.
 *
 * It still **stays out of the agent's code root**, though: making subtitles look good is a human
 * call, the agent should not change it in passing while editing the film, nor run a generation pass
 * just to change a color.
 */
export interface FilmSubtitleStyle {
  on: boolean;
  /**
   * Where on the picture, as a fraction of the frame (0–1), for the **center** of the subtitle box.
   *
   * Not a top/bottom switch: what subtitles must avoid differs for every film (data labels along
   * the bottom in one, a badge in the top-right corner in another), so two positions are never
   * enough. Drag it directly on the picture to wherever it should go.
   */
  pos: { x: number; y: number };
  /** Maximum width of the subtitle box, as a percentage of the frame. 100 = edge to edge. */
  maxWidthPct: number;
  align: FilmSubtitleAlign;
  font: FilmSubtitleFont;
  /** Text fill color. */
  fill: string;
  stroke: FilmSubtitleStroke | null;
  shadow: FilmSubtitleShadow | null;
  box: FilmSubtitleBox | null;
  /** Word-by-word highlighting; null = the whole line looks the same (default). */
  karaoke: FilmSubtitleKaraoke | null;
}

/**
 * The font used when none is specified.
 *
 * A system stack rather than one specific font: subtitles must handle Chinese, English, Japanese
 * and Korean, and this stack resolves to the best sans-serif on every platform. Users pick other
 * fonts themselves (see the font catalog).
 */
export const FILM_SUBTITLE_FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB",'
  + ' "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

/** Default maximum width of the subtitle box, as a percentage of the frame. 100 = may span the full width. */
export const FILM_SUBTITLE_MAX_W_PCT = 100;

/**
 * Font size: a percentage of the frame's short side.
 *
 * A ratio rather than pixels: in a small window, full screen and a 4K export, subtitles must be the
 * same size relative to the picture. In pixels, they could cover half a small preview and be too thin
 * to read in 4K. The short side rather than height, because in portrait the height is the long side,
 * and sizing by it would effectively treat subtitles as titles.
 *
 * These three steps are now just **ticks on the slider** (and the decoding table for the `size`
 * field when reading old data); the size itself is continuous.
 */
export type FilmSubtitleSize = 'sm' | 'md' | 'lg';

/* 2026-09-05: everything went down one size (md 4.6 → 4.0). The old step was 50px at 1080p, and two
   lines of subtitles took up nearly 15% of the bottom of the picture, looking like titles rather
   than subtitles. */
export const FILM_SUBTITLE_SIZE_PCT: Record<FilmSubtitleSize, number> = {
  sm: 3.2,
  md: 4.0,
  lg: 5.2,
};

/** Ends of the font-size slider. Too small is unreadable in feed thumbnails; too large leaves only a few characters per line. */
export const FILM_SUBTITLE_SIZE_PCT_MIN = 2;
export const FILM_SUBTITLE_SIZE_PCT_MAX = 10;

/* ── Presets ─────────────────────────────────────────────────────────────── */

/**
 * A ready-made look, like a character style in Photoshop: picking one applies a whole set.
 *
 * Presets used to be the **only** choice (one of five, no further tweaks); now they are a
 * **starting point**: one click fills in the whole set, and every parameter can still be adjusted
 * afterwards. They remain because only a handful of combinations keep subtitles truly readable, and
 * building one from scratch usually ends with the text buried in the picture.
 */
export type FilmSubtitleLookId = 'outline' | 'bar' | 'bold' | 'yellow' | 'clean';

export const FILM_SUBTITLE_LOOK_IDS: readonly FilmSubtitleLookId[] =
  ['outline', 'bar', 'bold', 'yellow', 'clean'];

function font(over: Partial<FilmSubtitleFont> = {}): FilmSubtitleFont {
  return {
    family: FILM_SUBTITLE_FONT_STACK,
    sizePct: FILM_SUBTITLE_SIZE_PCT.md,
    weight: 500,
    italic: false,
    /* Tightly set Chinese subtitles look like UI labels; slightly wider tracking and looser line height make them read as a line printed on the picture. */
    letterSpacingEm: 0.04,
    lineHeight: 1.45,
    upper: false,
    ...over,
  };
}

/**
 * Preset → a full set of parameters.
 *
 * Covers only appearance, not position or on/off: switching looks should not override the position
 * the user dragged into place.
 */
export type FilmSubtitleLook = Pick<FilmSubtitleStyle, 'font' | 'fill' | 'stroke' | 'shadow' | 'box'>;

export const FILM_SUBTITLE_LOOKS: Record<FilmSubtitleLookId, FilmSubtitleLook> = {
  /* A stroke rather than a background box is the default: a box covers the picture, and subtitles
     usually sit in the lower third, where there is often something. A stroke reads on any
     background and hides almost nothing. */
  outline: {
    font: font(),
    fill: '#ffffff',
    /* The stroke only preserves glyph shapes on light or busy backgrounds; the glow is the layer of
       air that lifts the text off the picture. The previous 0.045em stroke plus a barely visible
       shadow amounted to no outline on night scenes, as if the text were pasted onto the pixels. */
    stroke: { widthEm: 0.055, color: 'rgba(0,0,0,0.84)' },
    shadow: { dxEm: 0, dyEm: 0.05, blurEm: 0.22, color: 'rgba(0,0,0,0.72)' },
    box: null,
  },
  bar: {
    font: font(),
    fill: '#ffffff',
    stroke: null,
    shadow: null,
    box: { color: '#000000', opacity: 0.62, radiusEm: 0.08, padXEm: 0.4, padYEm: 0.12 },
  },
  /* Heavy social-media stroke: in a muted feed, text must stay legible at thumbnail size. */
  bold: {
    font: font({ weight: 800, letterSpacingEm: 0.01 }),
    fill: '#ffffff',
    stroke: { widthEm: 0.08, color: '#000000' },
    shadow: { dxEm: 0, dyEm: 0.03, blurEm: 0.08, color: 'rgba(0,0,0,0.6)' },
    box: null,
  },
  yellow: {
    font: font({ weight: 700 }),
    fill: '#ffe14d',
    stroke: { widthEm: 0.075, color: '#000000' },
    shadow: { dxEm: 0, dyEm: 0.03, blurEm: 0.08, color: 'rgba(0,0,0,0.6)' },
    box: null,
  },
  clean: {
    font: font(),
    fill: '#ffffff',
    stroke: null,
    shadow: { dxEm: 0, dyEm: 0.04, blurEm: 0.2, color: 'rgba(0,0,0,0.62)' },
    box: null,
  },
};

/**
 * Vertical coordinate of the default position (center of the subtitle box).
 *
 * 0.94 (earlier 0.88, then 0.92): any higher and the text baseline sits almost a hundred pixels
 * above the bottom edge, looking like it floats in the lower middle of the picture rather than
 * being a subtitle along the bottom. At 0.94, a single line (default size) sits about 3% above the
 * bottom edge, matching where mainstream players put subtitles, and two lines still fit in the
 * picture. The preview layer's snap line is computed from this (see SubtitleOverlay); don't copy the
 * number.
 */
export const FILM_SUBTITLE_HOME_Y = 0.94;

export const FILM_SUBTITLE_DEFAULT: FilmSubtitleStyle = {
  on: true,
  /* Bottom center: the default subtitle position, and the strip of the safe area least likely to cover content. */
  pos: { x: 0.5, y: FILM_SUBTITLE_HOME_Y },
  maxWidthPct: FILM_SUBTITLE_MAX_W_PCT,
  align: 'center',
  ...FILM_SUBTITLE_LOOKS.outline,
  karaoke: null,
};

/**
 * Default position for portrait. When a 9:16 film goes to Shorts / Reels / Douyin, the bottom 20% is
 * the platform's own caption, avatar and buttons, which cover exactly the landscape baseline of 0.94
 * (observed in practice: agents had to remind users to "move the subtitles up" when delivering).
 */
export const FILM_SUBTITLE_PORTRAIT_Y = 0.72;

/**
 * The style this film actually uses in this frame: if the user never moved the subtitles (still at
 * the default point) and the frame is portrait, switch to the portrait default. A position the user
 * chose is respected. All three renderers (preview, capture, export) go through this first, so what
 * you see is what you get.
 */
export function filmSubtitleStyleFor(style: FilmSubtitleStyle, frame: { w: number; h: number }): FilmSubtitleStyle {
  const home = style.pos.x === 0.5 && style.pos.y === FILM_SUBTITLE_HOME_Y;
  return home && frame.h > frame.w ? { ...style, pos: { x: 0.5, y: FILM_SUBTITLE_PORTRAIT_Y } } : style;
}

/** Whether this style is an untouched preset; the UI uses this to mark that preset as selected. */
export function matchFilmSubtitleLook(style: FilmSubtitleStyle): FilmSubtitleLookId | null {
  for (const id of FILM_SUBTITLE_LOOK_IDS) {
    const look = FILM_SUBTITLE_LOOKS[id];
    if (JSON.stringify({ ...look, font: { ...look.font, sizePct: style.font.sizePct } })
      === JSON.stringify({
        font: style.font, fill: style.fill, stroke: style.stroke, shadow: style.shadow, box: style.box,
      })) return id;
  }
  return null;
}

/* ── Building CSS ────────────────────────────────────────────────────────── */

/** `#rrggbb` + opacity → `rgba(...)`. Unrecognized colors are returned as is (their opacity is then carried by the color itself). */
function rgba(color: string, opacity: number): string {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!digits) return color;
  const hex = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
  const n = parseInt(hex, 16);
  const a = Math.min(1, Math.max(0, opacity));
  // eslint-disable-next-line no-bitwise
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Number(a.toFixed(3))})`;
}

/**
 * Family name → a valid `font-family` value.
 *
 * The font catalog provides **bare family names** (`Press Start 2P`, `Noto Serif SC`, `得意黑`
 * (Smiley Sans)), and putting them straight into CSS is invalid: multi-word names with spaces need
 * quotes, and an identifier starting with a digit like `2P` is never valid. The CSSOM **silently
 * drops the entire invalid declaration**: every other style applies, only the font does not change,
 * and nothing reports an error (found on 2026-08-13: Press Start 2P was selected, yet the picture
 * still showed the app's own Inter).
 *
 * Values that are already a font stack (containing commas) pass through unchanged; the default
 * system stack is one. A single family name is always quoted and followed by the system stack as a
 * fallback, so if the font fails to load there is still a proper sans-serif rather than the
 * browser's default serif.
 */
export function cssFontFamily(family: string): string {
  const name = family.trim();
  if (!name) return FILM_SUBTITLE_FONT_STACK;
  if (name.includes(',')) return name;
  return `"${name.replace(/"/g, '')}", ${FILM_SUBTITLE_FONT_STACK}`;
}

const JUSTIFY: Record<FilmSubtitleAlign, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

export interface FilmSubtitleCss {
  /** Positioning box: absolutely positioned at pos, width-limited, aligned per align. */
  box: Record<string, string>;
  /** Text box: font, color, stroke, shadow, background. */
  text: Record<string, string>;
}

/**
 * A style → two sets of CSS declarations. **The single output shared by all three renderers.**
 *
 * `fontSize` comes from the caller, because only it knows its coordinate system: the preview follows
 * the window (container units), while the capture and export pages have a fixed stage in native
 * pixels. Everything else is computed here; nobody should build it again themselves, which is
 * exactly how line heights once ended up 0.025 apart.
 */
export function filmSubtitleCss(
  style: FilmSubtitleStyle,
  opts: { fontSize: string },
): FilmSubtitleCss {
  const { font: f } = style;

  const box: Record<string, string> = {
    position: 'absolute',
    left: `${style.pos.x * 100}%`,
    top: `${style.pos.y * 100}%`,
    transform: 'translate(-50%, -50%)',
    /* `width: max-content` is required. With only `left` set on an absolutely positioned box, CSS
       2.1 makes the available width "from left to the containing block's right edge", which is half
       the screen when centered. Setting max-width:100% alone does not help; the line wraps at 50%.
       max-content sizes the width by content and then max-width caps it against the **full** frame,
       so the slider at 100 really reaches both edges. */
    width: 'max-content',
    maxWidth: `${style.maxWidthPct}%`,
    display: 'flex',
    justifyContent: JUSTIFY[style.align],
    zIndex: '5',
  };

  const text: Record<string, string> = {
    whiteSpace: 'pre-wrap',
    /* When Chinese breaks between characters, commas and periods can land at the start of the next
       line, the ugly kind of break shown in 「月亮从不说 / 话，」. `strict` keeps punctuation attached
       to the preceding character; long words can still wrap, just never right before punctuation. */
    lineBreak: 'strict',
    overflowWrap: 'break-word',
    /* When max-width constrains the box, a flex child's default min-width:auto can push the text out. */
    minWidth: '0',
    maxWidth: '100%',
    textAlign: style.align,
    lineHeight: String(f.lineHeight),
    fontSize: opts.fontSize,
    fontFamily: cssFontFamily(f.family),
    fontWeight: String(f.weight),
    color: style.fill,
  };
  if (f.italic) text.fontStyle = 'italic';
  if (f.letterSpacingEm) text.letterSpacing = `${f.letterSpacingEm}em`;
  if (f.upper) text.textTransform = 'uppercase';

  if (style.stroke && style.stroke.widthEm > 0) {
    text.WebkitTextStrokeWidth = `${style.stroke.widthEm}em`;
    text.WebkitTextStrokeColor = style.stroke.color;
    /* Without this, the stroke is drawn half inside and half outside the glyph outline and thins the strokes, most visibly at light weights. */
    text.paintOrder = 'stroke fill';
  }
  if (style.shadow) {
    const s = style.shadow;
    text.textShadow = `${s.dxEm}em ${s.dyEm}em ${s.blurEm}em ${s.color}`;
  }
  if (style.box) {
    const b = style.box;
    text.background = rgba(b.color, b.opacity);
    text.padding = `${b.padYEm}em ${b.padXEm}em`;
    text.borderRadius = `${b.radiusEm}em`;
  }
  return { box, text };
}

/** The same declarations joined into a `style="..."` string (the capture and export pages set cssText directly). */
export function filmSubtitleCssText(decls: Record<string, string>): string {
  return Object.entries(decls)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').replace(/^webkit/i, '-webkit').toLowerCase()}:${v}`)
    .join(';');
}

/** Font size in native pixels, for the capture and export pages. Based on the short side; see `sizePct` for why. */
export function filmSubtitleFontSizePx(
  style: FilmSubtitleStyle,
  frame: { w: number; h: number },
): number {
  return Math.round((Math.min(frame.w, frame.h) * style.font.sizePct) / 100);
}

/* ── Data ────────────────────────────────────────────────────────────────── */

export interface FilmSubtitleCue {
  startMs: number;
  durMs: number;
  text: string;
  speaker?: string;
  /** Per-word times (absolute ms). When present, word highlighting follows them; otherwise it is estimated from character counts (see filmSubtitleWords). */
  words?: readonly { text: string; startMs: number; durMs: number }[];
}

/** A piece of a subtitle line: either a word (which gets its turn to light up) or whitespace, punctuation or a speaker prefix. */
export interface FilmSubtitleWord {
  text: string;
  /** It is being spoken at this moment. */
  active: boolean;
}

/**
 * How a subtitle line is split and colored at this moment. All three renderers build from this, so
 * word highlighting lands on the same word in preview, capture and export.
 *
 * Without per-word times: split into words (Chinese and Japanese via Intl.Segmenter, falling back to
 * characters), punctuation and whitespace take no time, and each word's share of the duration is
 * proportional to its character count.
 */
export function filmSubtitleWords(cue: FilmSubtitleCue, timeMs: number): FilmSubtitleWord[] {
  const out: FilmSubtitleWord[] = [];
  if (cue.speaker) out.push({ text: `${cue.speaker}：`, active: false });
  if (cue.words?.length) {
    cue.words.forEach((w, i) => {
      if (i > 0 && !/^[\s，。、！？,.!?;:；：]/.test(w.text) && /[A-Za-z0-9]$/.test(cue.words![i - 1]!.text)) {
        out.push({ text: ' ', active: false });
      }
      out.push({ text: w.text, active: timeMs >= w.startMs && timeMs < w.startMs + w.durMs });
    });
    return out;
  }
  const segs = segmentWords(cue.text);
  const weight = segs.reduce((n, s) => n + (s.word ? [...s.text].length : 0), 0);
  if (!weight) {
    out.push({ text: cue.text, active: false });
    return out;
  }
  const at = Math.min(Math.max(0, timeMs - cue.startMs), Math.max(0, cue.durMs - 1));
  let t = 0;
  for (const seg of segs) {
    if (!seg.word) {
      out.push({ text: seg.text, active: false });
      continue;
    }
    const len = ([...seg.text].length / weight) * cue.durMs;
    out.push({ text: seg.text, active: at >= t && at < t + len });
    t += len;
  }
  return out;
}

function segmentWords(text: string): { text: string; word: boolean }[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (Seg) {
    return [...new Seg(undefined, { granularity: 'word' }).segment(text)]
      .map((s) => ({ text: s.segment, word: Boolean(s.isWordLike) }));
  }
  return text.split(/(\s+|[，。、！？,.!?;:；：]+)/).filter(Boolean)
    .map((part) => ({ text: part, word: !/^(\s+|[，。、！？,.!?;:；：]+)$/.test(part) }));
}

/**
 * Extra style layered on the word being spoken. Only color / background / size change, never font or
 * line height: a word getting wider would make the whole line jump. Enlarging uses `inline-block` +
 * `transform`, which takes no layout space.
 */
export function filmSubtitleWordCss(style: FilmSubtitleStyle): Record<string, string> {
  const k = style.karaoke;
  if (!k) return {};
  if (k.mode === 'box') {
    return {
      backgroundColor: k.color,
      color: readableOn(k.color),
      borderRadius: '0.18em',
      padding: '0 0.14em',
      margin: '0 -0.14em',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
      WebkitTextStroke: '0',
    };
  }
  if (k.mode === 'pop') {
    return { color: k.color, display: 'inline-block', transform: 'scale(1.14)', transformOrigin: '50% 60%' };
  }
  return { color: k.color };
}

/** Which text color goes on a background: black or white, chosen by luminance. */
function readableOn(bg: string): string {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim())?.[1];
  if (!digits) return '#000000';
  const hex = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
  const n = parseInt(hex, 16);
  // eslint-disable-next-line no-bitwise
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff';
}

/**
 * Which line to show at this moment.
 *
 * Intervals are half-open [start, end). On overlap, the line that **starts later** wins: overlapping
 * lines usually mean the previous one's tail has not ended while the next has begun, and the viewer
 * needs to read the one being spoken now.
 */
export function filmSubtitleAt(
  cues: readonly FilmSubtitleCue[],
  timeMs: number,
): FilmSubtitleCue | null {
  let best: FilmSubtitleCue | null = null;
  for (const cue of cues) {
    if (timeMs < cue.startMs || timeMs >= cue.startMs + cue.durMs) continue;
    if (!best || cue.startMs > best.startMs) best = cue;
  }
  return best;
}

/** How a subtitle line is printed (speaker first). All three renderers use this so that none shows the name while another omits it. */
export function filmSubtitleText(cue: FilmSubtitleCue): string {
  return cue.speaker ? `${cue.speaker}：${cue.text}` : cue.text;
}

/* ── Reading external data ───────────────────────────────────────────────── */

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** `null` means "explicitly no such layer", while `undefined` means "not specified". They must not be conflated, or the stroke could never be turned off. */
function layer<T>(v: unknown, fallback: T | null, read: (o: Record<string, unknown>) => T): T | null {
  if (v === null) return null;
  if (v && typeof v === 'object') return read(v as Record<string, unknown>);
  return fallback;
}

/**
 * Reads a style from outside (database, query parameters, meta.json).
 *
 * Field by field, never trusted wholesale: stored or transmitted data may have a previous version's
 * shape, and fields change. An unrecognized field gets its default, which beats resetting the whole
 * setting and beats rendering with a half-formed object.
 *
 * **Recognizes the old shape.** The previous version was `{on, size:'md', look:'outline', pos}`, and
 * it still sits in users' localStorage and in export links already sent out. `look` is expanded into
 * a full set first, and `size` then overrides the font size. The order must not be reversed, or the
 * "large text" in an old link would be swallowed by the preset's default size.
 */
export function parseFilmSubtitleStyle(raw: unknown): FilmSubtitleStyle {
  const v = (raw ?? {}) as Record<string, unknown>;

  // The old shape's two fields set a baseline first; new fields (if any) then override it one by one.
  const lookId = typeof v.look === 'string' && v.look in FILM_SUBTITLE_LOOKS
    ? (v.look as FilmSubtitleLookId)
    : null;
  const base: FilmSubtitleStyle = lookId
    ? { ...FILM_SUBTITLE_DEFAULT, ...FILM_SUBTITLE_LOOKS[lookId] }
    : FILM_SUBTITLE_DEFAULT;
  const legacySizePct = typeof v.size === 'string' && v.size in FILM_SUBTITLE_SIZE_PCT
    ? FILM_SUBTITLE_SIZE_PCT[v.size as FilmSubtitleSize]
    : null;

  const rf = (v.font ?? {}) as Record<string, unknown>;
  const pos = v.pos as { x?: unknown; y?: unknown } | undefined;

  return {
    on: bool(v.on, base.on),
    pos: typeof pos?.x === 'number' && typeof pos?.y === 'number'
      ? { x: clamp01(pos.x), y: clamp01(pos.y) }
      : base.pos,
    maxWidthPct: num(v.maxWidthPct, base.maxWidthPct, 10, 100),
    align: v.align === 'left' || v.align === 'right' || v.align === 'center' ? v.align : base.align,
    font: {
      family: str(rf.family, base.font.family),
      sizePct: num(
        rf.sizePct,
        legacySizePct ?? base.font.sizePct,
        FILM_SUBTITLE_SIZE_PCT_MIN,
        FILM_SUBTITLE_SIZE_PCT_MAX,
      ),
      weight: num(rf.weight, base.font.weight, 100, 900),
      italic: bool(rf.italic, base.font.italic),
      letterSpacingEm: num(rf.letterSpacingEm, base.font.letterSpacingEm, -0.1, 0.5),
      lineHeight: num(rf.lineHeight, base.font.lineHeight, 0.8, 3),
      upper: bool(rf.upper, base.font.upper),
    },
    fill: str(v.fill, base.fill),
    stroke: layer(v.stroke, base.stroke, (o) => ({
      widthEm: num(o.widthEm, base.stroke?.widthEm ?? 0.055, 0, 0.3),
      color: str(o.color, base.stroke?.color ?? '#000000'),
    })),
    shadow: layer(v.shadow, base.shadow, (o) => ({
      dxEm: num(o.dxEm, base.shadow?.dxEm ?? 0, -0.5, 0.5),
      dyEm: num(o.dyEm, base.shadow?.dyEm ?? 0, -0.5, 0.5),
      blurEm: num(o.blurEm, base.shadow?.blurEm ?? 0.22, 0, 1),
      color: str(o.color, base.shadow?.color ?? 'rgba(0,0,0,0.72)'),
    })),
    box: layer(v.box, base.box, (o) => ({
      color: str(o.color, base.box?.color ?? '#000000'),
      opacity: num(o.opacity, base.box?.opacity ?? 0.62, 0, 1),
      radiusEm: num(o.radiusEm, base.box?.radiusEm ?? 0.08, 0, 1),
      padXEm: num(o.padXEm, base.box?.padXEm ?? 0.4, 0, 2),
      padYEm: num(o.padYEm, base.box?.padYEm ?? 0.12, 0, 2),
    })),
    karaoke: layer(v.karaoke, base.karaoke ?? null, (o) => ({
      mode: FILM_SUBTITLE_KARAOKE_MODES.includes(o.mode as FilmSubtitleKaraokeMode)
        ? (o.mode as FilmSubtitleKaraokeMode)
        : FILM_SUBTITLE_KARAOKE_DEFAULT.mode,
      color: str(o.color, FILM_SUBTITLE_KARAOKE_DEFAULT.color),
    })),
  };
}

/* ── Deliverables ────────────────────────────────────────────────────────── */

/** `00:01:23,456`: SRT's timestamp format, with a comma, not a period. */
function srtStamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor((total % 3_600_000) / 60_000))}`
    + `:${pad(Math.floor((total % 60_000) / 1000))},${pad(total % 1000, 3)}`;
}

/**
 * An SRT file.
 *
 * When two lines overlap, the earlier one gives way: SRT has no notion of showing two cues at once,
 * and overlaps make players behave inconsistently (some let the later cover the earlier, some drop
 * one entirely). Giving way rather than dropping, because a dropped line is something that was
 * actually said.
 *
 * Speakers use an ASCII colon, unlike the on-screen version (`filmSubtitleText`, fullwidth colon):
 * this file is read by players and translation tools, and some of them do not understand fullwidth
 * punctuation.
 *
 * It lives in core rather than film-build because two places deliver this file: the server writes it
 * into the bundle, and the browser export downloads it directly. film-build pulls in esbuild and
 * cannot run in the browser.
 */
export function filmSubtitleSrt(cues: readonly FilmSubtitleCue[]): string {
  const blocks = sequencedCues(cues).map(({ cue, end }, i) => {
    const line = cue.speaker ? `${cue.speaker}:${cue.text}` : cue.text;
    return `${i + 1}\n${srtStamp(cue.startMs)} --> ${srtStamp(end)}\n${line.trim()}`;
  });
  return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}

/** Sorted, empty lines removed, earlier line giving way on overlap; shared by SRT and WebVTT. */
function sequencedCues(cues: readonly FilmSubtitleCue[]): { cue: FilmSubtitleCue; end: number }[] {
  const sorted = [...cues]
    .filter((c) => c.text.trim() && c.durMs > 0)
    .sort((a, b) => a.startMs - b.startMs);
  const out: { cue: FilmSubtitleCue; end: number }[] = [];
  for (const [i, cue] of sorted.entries()) {
    const next = sorted[i + 1];
    let end = cue.startMs + cue.durMs;
    if (next && end > next.startMs) end = next.startMs;
    if (end > cue.startMs) out.push({ cue, end });
  }
  return out;
}

function vttStamp(ms: number): string {
  return srtStamp(ms).replace(',', '.');
}

/**
 * A WebVTT file: what web players (`<track>`), YouTube, Vimeo and most LMSs accept.
 *
 * Speakers are written as `<v Name>`, VTT's own semantic markup, so players can color by speaker
 * instead of reading the name out as part of the text.
 */
export function filmSubtitleVtt(cues: readonly FilmSubtitleCue[]): string {
  const blocks = sequencedCues(cues).map(({ cue, end }) => {
    const text = cue.text.trim().replace(/-->/g, '→');
    const line = cue.speaker ? `<v ${cue.speaker.replace(/[<>]/g, '')}>${text}` : text;
    return `${vttStamp(cue.startMs)} --> ${vttStamp(end)}\n${line}`;
  });
  return blocks.length ? `WEBVTT\n\n${blocks.join('\n\n')}\n` : '';
}

/**
 * Plain-text transcript, for people producing transcripts, blog posts or translation drafts. One
 * line per cue, with a blank line when the speaker changes.
 */
export function filmSubtitleTranscript(cues: readonly FilmSubtitleCue[]): string {
  const lines: string[] = [];
  let lastSpeaker: string | undefined;
  for (const { cue } of sequencedCues(cues)) {
    if (lines.length && cue.speaker !== lastSpeaker) lines.push('');
    lines.push(cue.speaker && cue.speaker !== lastSpeaker ? `${cue.speaker}:${cue.text.trim()}` : cue.text.trim());
    lastSpeaker = cue.speaker;
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * When exporting only part of the film (in/out points), subtitles must be trimmed too: cues outside
 * the range are dropped, cues crossing an edge are cut, and all times shift so the range starts at
 * 0. Without the shift, the exported SRT's first cue would be at 00:01:30 in a 20-second video.
 */
export function filmSubtitleCuesInRange<T extends FilmSubtitleCue>(
  cues: readonly T[],
  fromMs: number,
  toMs: number,
): T[] {
  const out: T[] = [];
  for (const cue of cues) {
    const start = Math.max(cue.startMs, fromMs);
    const end = Math.min(cue.startMs + cue.durMs, toMs);
    if (end <= start) continue;
    out.push({ ...cue, startMs: start - fromMs, durMs: end - start });
  }
  return out;
}

/**
 * How subtitles are delivered on export.
 *
 * Two separate choices, because they serve two destinations: **burning in** is for muted feeds
 * (Douyin / Reels / Shorts do not accept SRT at all, and viewers would not turn it on anyway), and
 * **SRT** is for players that accept subtitle tracks and for people translating. Most people post
 * the download directly, so the default is to burn in and not produce the file; whoever wants the
 * file ticks the box.
 */
export interface FilmSubtitleExport {
  /** Burn into the picture. */
  burn: boolean;
  /** Also deliver an SRT file. */
  srt: boolean;
  /** The style saved for this project, carried over as is. */
  style: FilmSubtitleStyle;
}

export const FILM_SUBTITLE_EXPORT_DEFAULT: FilmSubtitleExport = {
  burn: true,
  srt: false,
  style: FILM_SUBTITLE_DEFAULT,
};

/** Reads subtitle export settings from outside. Field by field, like the style, since it comes from the address bar. */
export function parseFilmSubtitleExport(raw: unknown): FilmSubtitleExport {
  const v = (raw ?? {}) as Partial<FilmSubtitleExport>;
  return {
    burn: typeof v.burn === 'boolean' ? v.burn : FILM_SUBTITLE_EXPORT_DEFAULT.burn,
    srt: typeof v.srt === 'boolean' ? v.srt : FILM_SUBTITLE_EXPORT_DEFAULT.srt,
    style: parseFilmSubtitleStyle(v.style),
  };
}

/**
 * Subtitle settings ⇄ a string that fits in the address bar.
 *
 * Passed via the URL rather than a separate API: the export page is **another tab**, and this URL is
 * the only link between it and the editor. With two hops, each tab would carry its own settings and
 * whichever arrived last would win.
 *
 * base64url rather than raw JSON: the JSON contains quotes and braces, and on the legacy path the
 * value is decoded once more on the server (see the playback route, which reads it with
 * `Buffer.from(raw, 'base64url')`).
 */
export function packFilmSubtitleExport(choice: FilmSubtitleExport): string {
  const bytes = new TextEncoder().encode(JSON.stringify(choice));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The reverse. Returns null when unreadable; the caller decides whether that means "not provided" or "use the default". */
export function unpackFilmSubtitleExport(
  packed: string | null | undefined,
): FilmSubtitleExport | null {
  if (!packed) return null;
  try {
    const binary = atob(packed.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return parseFilmSubtitleExport(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
