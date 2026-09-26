/**
 * Single source of truth for burned-in subtitle styling, shared by the player and the browser export.
 * Design coordinates are the stage's native resolution (e.g. 1920×1080); the player scales with a CSS
 * transform, and the export scales proportionally by outW/stageW.
 */

export const SUBTITLE_BOTTOM_PX = 20;
export const SUBTITLE_FONT_PX = 36;
export const SUBTITLE_PAD_X_PX = 16;
export const SUBTITLE_COLOR = '#ffffff';
export const SUBTITLE_FONT_WEIGHT = 700;
export const SUBTITLE_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
export const SUBTITLE_LETTER_SPACING = 0.2;
export const SUBTITLE_LINE_HEIGHT = 1.45;
export const SUBTITLE_MAX_WIDTH = '90%';

export interface SubtitleSay {
  text: string;
}

export function subtitleTextShadow(strokePx = 1): string {
  const s = strokePx;
  return `${-s}px ${-s}px 0 rgba(0,0,0,.45), ${s}px ${-s}px 0 rgba(0,0,0,.45), `
    + `${-s}px ${s}px 0 rgba(0,0,0,.45), ${s}px ${s}px 0 rgba(0,0,0,.45), `
    + `0 0 ${Math.max(2, s * 3)}px rgba(0,0,0,.35)`;
}

export function scaledSubtitleMetrics(stageScale: number) {
  const scale = stageScale > 0 ? stageScale : 1;
  return {
    fontSize: Math.round(SUBTITLE_FONT_PX * scale),
    bottom: Math.round(SUBTITLE_BOTTOM_PX * scale),
    padX: Math.round(SUBTITLE_PAD_X_PX * scale),
    strokePx: Math.max(1, Math.round(scale)),
  };
}

/** Absolutely positioned in stage coordinates (native px); VideoPlayer and the browser capture overlay it inside the stage. */
export function subtitleStageOverlayCssText(): string {
  return `position:absolute;left:0;right:0;bottom:${SUBTITLE_BOTTOM_PX}px;display:flex;justify-content:center;pointer-events:none;z-index:5`;
}

/** cssText for the subtitle text box. stageScale=1 is stage-native; >1 scales up proportionally to the export resolution. */
export function subtitleTextCssText(stageScale = 1): string {
  const m = scaledSubtitleMetrics(stageScale);
  return [
    `max-width:${SUBTITLE_MAX_WIDTH}`,
    `padding:0 ${m.padX}px`,
    `color:${SUBTITLE_COLOR}`,
    `font-size:${m.fontSize}px`,
    `font-weight:${SUBTITLE_FONT_WEIGHT}`,
    `font-family:${SUBTITLE_FONT_FAMILY}`,
    `letter-spacing:${SUBTITLE_LETTER_SPACING}px`,
    `line-height:${SUBTITLE_LINE_HEIGHT}`,
    'text-align:center',
    `text-shadow:${subtitleTextShadow(m.strokePx)}`,
  ].join(';');
}

/** Inline style for React / DOM (stage-native coordinates; an outer transform scale does the scaling). */
export function subtitleNativeTextStyle(): Record<string, string | number> {
  return {
    maxWidth: SUBTITLE_MAX_WIDTH,
    padding: `0 ${SUBTITLE_PAD_X_PX}px`,
    color: SUBTITLE_COLOR,
    fontWeight: SUBTITLE_FONT_WEIGHT,
    fontFamily: SUBTITLE_FONT_FAMILY,
    fontSize: SUBTITLE_FONT_PX,
    letterSpacing: SUBTITLE_LETTER_SPACING,
    lineHeight: SUBTITLE_LINE_HEIGHT,
    textAlign: 'center',
    textShadow: subtitleTextShadow(1),
  };
}

/* ── Speaker name tag (multi-speaker films: a small chip above the subtitle; not rendered for single-speaker films) ── */

export const SUBTITLE_SPEAKER_FONT_PX = 19;

/** Name-tag cssText (used by the export capture); stageScale means the same as in subtitleTextCssText. */
export function subtitleSpeakerChipCssText(stageScale = 1): string {
  const scale = stageScale > 0 ? stageScale : 1;
  return [
    `font-size:${Math.round(SUBTITLE_SPEAKER_FONT_PX * scale)}px`,
    'font-weight:600',
    `font-family:${SUBTITLE_FONT_FAMILY}`,
    'letter-spacing:1.5px',
    'text-transform:uppercase',
    'color:rgba(255,255,255,.92)',
    'background:rgba(0,0,0,.55)',
    `padding:${Math.round(2 * scale)}px ${Math.round(10 * scale)}px`,
    'border-radius:999px',
    `margin-bottom:${Math.round(6 * scale)}px`,
    'line-height:1.5',
  ].join(';');
}

/** Name-tag inline style for React (stage-native coordinates). */
export function subtitleSpeakerChipStyle(): Record<string, string | number> {
  return {
    fontSize: SUBTITLE_SPEAKER_FONT_PX,
    fontWeight: 600,
    fontFamily: SUBTITLE_FONT_FAMILY,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,.92)',
    background: 'rgba(0,0,0,.55)',
    padding: '2px 10px',
    borderRadius: 999,
    marginBottom: 6,
    lineHeight: 1.5,
  };
}
