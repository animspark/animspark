/**
 * Runtime palette: used by keyframe playback / bake.
 * Web TSX films define their colors in shots/_shared.tsx; there are no longer multiple Design Systems.
 */
import type { ThemePalette } from './tokens';
import { setThemePalette } from './tokens';

/** Default palette for keyframe rendering (formerly the 3b1b-math preset). */
export const DEFAULT_THEME_PALETTE: ThemePalette = {
  ink: '#f4f7fb',
  primary: '#4ea1ff',
  secondary: '#45d0c1',
  accent: '#f4c542',
  muted: '#8fa3b8',
  faint: '#28415f',
  positive: '#69d58c',
  negative: '#ff6b5f',
  bg: '#07111f',
  bgGradient: ['#050914', '#0b1b2c'],
  bgByPage: {
    cover: ['#030712', '#101d31'],
    section: ['#061225', '#0b2438'],
  },
  accentBg: '#2b2411',
  magenta: '#b78cff',
  surface: '#0d1c2e',
  surfaceStroke: '#24405f',
  fontSans: "'Inter','Avenir Next','PingFang SC','Noto Sans CJK SC',sans-serif",
  fontLabel: "'Inter','Avenir Next','PingFang SC',sans-serif",
  fontMono: "'SFMono-Regular','Menlo','Consolas',monospace",
  fontScale: 1.02,
  radius: { sm: 6, md: 12, lg: 20 },
  strokeScale: 1.08,
  chrome: { kicker: false, pageNo: false, footer: false },
  decor: [
    { kind: 'grid', color: '#4ea1ff', opacity: 0.055, gap: 54 },
    { kind: 'dots', color: '#45d0c1', opacity: 0.045, gap: 36 },
    { kind: 'glow', at: [0.24, 0.24], r: 0.36, color: '#1e63ff', opacity: 0.16 },
    { kind: 'glow', at: [0.78, 0.68], r: 0.30, color: '#f4c542', opacity: 0.09 },
    { kind: 'vignette', opacity: 0.36 },
  ],
  decorByPage: {
    cover: [
      { kind: 'grid', color: '#4ea1ff', opacity: 0.05, gap: 60 },
      { kind: 'arc', at: [0.78, 0.42], r: 0.42, color: '#4ea1ff', opacity: 0.20, width: 2 },
      { kind: 'arc', at: [0.78, 0.42], r: 0.30, color: '#f4c542', opacity: 0.14, width: 3 },
      { kind: 'glow', at: [0.78, 0.42], r: 0.42, color: '#4ea1ff', opacity: 0.14 },
      { kind: 'vignette', opacity: 0.40 },
    ],
    section: [
      { kind: 'grid', color: '#45d0c1', opacity: 0.05, gap: 56 },
      { kind: 'rays', at: [0.50, 0.52], color: '#f4c542', n: 28, opacity: 0.08, r: 0.76, width: 2 },
      { kind: 'vignette', opacity: 0.40 },
    ],
    content: [
      { kind: 'grid', color: '#4ea1ff', opacity: 0.055, gap: 54 },
      { kind: 'dots', color: '#45d0c1', opacity: 0.040, gap: 36 },
      { kind: 'glow', at: [0.18, 0.18], r: 0.34, color: '#1e63ff', opacity: 0.12 },
      { kind: 'glow', at: [0.82, 0.72], r: 0.32, color: '#f4c542', opacity: 0.08 },
      { kind: 'vignette', opacity: 0.36 },
    ],
  },
};

/** Load the runtime palette; legacy manifest.preset can still call this, but there is no longer a multi-theme table. */
export function applyThemeDesign(_id?: string): void {
  setThemePalette(DEFAULT_THEME_PALETTE);
}
