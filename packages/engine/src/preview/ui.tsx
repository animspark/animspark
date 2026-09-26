/**
 * Shared pieces of the preview player: palette, time formatting, icons, small controls,
 * editor links and per-viewer preferences.
 */
import * as React from 'react';

export const C = {
  bg: '#0d0d10', panel: '#141418', panel2: '#1a1a1f', raised: '#212127', line: '#26262d', line2: '#32323a',
  text: '#e9e9ec', dim: '#8e8e99', faint: '#5d5d67',
  accent: '#ffb547', err: '#ff6b6b', warn: '#f5c451', ok: '#5ad19a', select: '#7aa2ff',
  mg: '#7b83ff', video: '#35b5a3', image: '#4f9be0', voice: '#e0a94a', music: '#c46ae0', sfx: '#e46a6a', caption: '#8a93a3',
};

export const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/* ── time ─────────────────────────────────────────────────────────────── */

export type TimeFormat = 'timecode' | 'seconds' | 'frames';

export function formatTime(ms: number, fps: number, format: TimeFormat): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (format === 'seconds') return `${(safe / 1000).toFixed(3)}s`;
  const frame = Math.floor((safe / 1000) * fps + 1e-6);
  if (format === 'frames') return `${frame}f`;
  const secs = Math.floor(frame / fps);
  const ff = frame - secs * fps;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(secs / 3600))}:${p(Math.floor((secs % 3600) / 60))}:${p(secs % 60)}:${p(ff)}`;
}

/** Ruler labels: `m:ss` on whole seconds, `12f` between them. */
export function rulerLabel(ms: number, fps: number): string {
  const frame = Math.round((ms / 1000) * fps);
  const secs = Math.floor(frame / fps);
  const ff = frame - secs * fps;
  if (ff) return `${ff}f`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Snap a time to the frame grid (the frame that is showing at `ms`). */
export function frameFloor(ms: number, fps: number): number {
  return (Math.floor((ms / 1000) * fps + 1e-6) / fps) * 1000;
}

/* ── editor links ─────────────────────────────────────────────────────── */

export type EditorId = 'vscode' | 'cursor' | 'zed' | 'none';
export const EDITORS: { id: EditorId; label: string }[] = [
  { id: 'vscode', label: 'VS Code' }, { id: 'cursor', label: 'Cursor' }, { id: 'zed', label: 'Zed' }, { id: 'none', label: 'Copy path' },
];

export function editorHref(editor: EditorId, abs: string, line?: number): string | null {
  const at = line ? `:${line}` : '';
  if (editor === 'vscode') return `vscode://file${encodeURI(abs)}${at}`;
  if (editor === 'cursor') return `cursor://file${encodeURI(abs)}${at}`;
  if (editor === 'zed') return `zed://file${encodeURI(abs)}${at}`;
  return null;
}

/* ── preferences (per viewer; the page works without storage) ────────── */

export function usePref<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const full = `anim-preview:${key}`;
  const [value, setValue] = React.useState<T>(() => {
    try { const raw = localStorage.getItem(full); return raw == null ? initial : JSON.parse(raw) as T; } catch { return initial; }
  });
  const set = React.useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try { localStorage.setItem(full, JSON.stringify(next)); } catch { /* private window */ }
      return next;
    });
  }, [full]);
  return [value, set];
}

/* ── icons (24×24, currentColor) ─────────────────────────────────────── */

const PATHS = {
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  start: 'M6 5h2v14H6zM19 5.5v13L9.5 12z',
  end: 'M16 5h2v14h-2zM5 5.5v13L14.5 12z',
  prevFrame: 'M7 5h2v14H7zM18 6v12l-8-6z',
  nextFrame: 'M15 5h2v14h-2zM6 6v12l8-6z',
  loop: 'M7 7h9.2l-2-2L15.6 3.6 20 8l-4.4 4.4L14.2 11l2-2H7a2 2 0 0 0-2 2v1H3v-1a4 4 0 0 1 4-4zm10 10H7.8l2 2-1.4 1.4L4 16l4.4-4.4L9.8 13l-2 2H17a2 2 0 0 0 2-2v-1h2v1a4 4 0 0 1-4 4z',
  volume: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  mute: 'M4 9v6h4l5 4V5L8 9H4zm11.6.4 1.4-1.4 2 2 2-2 1.4 1.4-2 2 2 2-1.4 1.4-2-2-2 2-1.4-1.4 2-2z',
  guides: 'M3 3h7v2H5v5H3zm11 0h7v7h-2V5h-5zM3 14h2v5h5v2H3zm16 0h2v7h-7v-2h5zM11 8h2v3h3v2h-3v3h-2v-3H8v-2h3z',
  fullscreen: 'M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z',
  zoomIn: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-1 2h2v2h2v2h-2v2H9v-2H7V9h2z',
  zoomOut: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM7 9h6v2H7z',
  fit: 'M3 7V3h4v2H5v2zm14-4h4v4h-2V5h-2zM3 17h2v2h2v2H3zm16 0h2v4h-4v-2h2zM7 11h10v2H7z',
  render: 'M5 20h14v-2H5zm7-3 5.5-5.5-1.4-1.4-3.1 3.1V4h-2v9.2L7.9 10.1l-1.4 1.4z',
  eyeOff: 'M2.8 4.2 4.2 2.8l17 17-1.4 1.4-3.2-3.2A10.6 10.6 0 0 1 12 19C6.5 19 2.5 13.9 1.5 12c.5-1 1.9-3.1 4.1-4.8zm6.3 6.3a3 3 0 0 0 4.4 4.4zM12 5c5.5 0 9.5 5.1 10.5 7-.4.8-1.4 2.3-2.8 3.8l-3-3A5 5 0 0 0 11.2 7.1L8.9 4.8C9.9 5.2 10.9 5 12 5z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zm2 0h6V8a3 3 0 0 0-6 0z',
  external: 'M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h6v2H6v11h11v-5h2v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  keyboard: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1 2v8h16V8zm2 1h2v2H6zm3 0h2v2H9zm3 0h2v2h-2zm3 0h3v2h-3zM6 12h2v2H6zm3 0h6v2H9zm7 0h2v2h-2z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
  inPoint: 'M8 4h8v2h-6v12h6v2H8z',
  outPoint: 'M8 4h8v16H8v-2h6V6H8z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <path d={PATHS[name]} fillRule="evenodd" />
    </svg>
  );
}

/** An icon button that never keeps focus, so the next Space still reaches the player. */
export function Btn({ icon, title, onClick, active, disabled, children, size = 18 }: {
  icon?: IconName; title: string; onClick(): void; active?: boolean; disabled?: boolean; children?: React.ReactNode; size?: number;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, minWidth: 28, justifyContent: 'center',
        padding: children ? '0 10px' : 0, border: 0, borderRadius: 6, font: 'inherit', fontSize: 12,
        color: active ? C.accent : disabled ? C.faint : C.text,
        background: active ? 'rgba(255,181,71,.12)' : hover && !disabled ? C.raised : 'transparent',
        cursor: disabled ? 'default' : 'pointer', flexShrink: 0,
      }}
    >
      {icon && <Icon name={icon} size={size} />}
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: 'inline-block', minWidth: 18, padding: '1px 5px', borderRadius: 4, border: `1px solid ${C.line2}`,
      borderBottomWidth: 2, background: C.panel2, color: C.text, font: `11px/16px ${MONO}`, textAlign: 'center',
    }}>{children}</kbd>
  );
}

export function Divider() {
  return <div style={{ width: 1, height: 18, background: C.line2, margin: '0 4px', flexShrink: 0 }} />;
}
