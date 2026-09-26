/**
 * `anim preview` — a timeline player for a film that is being written.
 *
 * Read-only by design: the film is code, edited in your editor or by your agent. This page
 * plays what the code plays and follows every save — picture refreshed in place, timeline
 * re-evaluated, errors shown verbatim with links back to the line.
 *
 *   viewer     the host iframe (the page the AnimSpark app plays), safe-area guides, fullscreen
 *   transport  frame stepping, edit-point jumps, in/out range and loop, speed, volume
 *   timeline   zoomable tracks with waveforms and filmstrips; click selects, drag scrubs
 *   inspector  where the selected clip lives in the source, opened in your editor
 */
import { useCodeFilmPlayback, type CodeFilm } from '@animspark/player';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { Inspector, type WorkspaceInfo } from './inspector';
import { Timeline, editPoints, lanesOf, type TClip, type TimelineHandle } from './timeline';
import { Btn, C, Divider, Icon, Kbd, MONO, editorHref, formatTime, frameFloor, usePref, type EditorId, type TimeFormat } from './ui';

const APP_URL = 'https://animspark.com/?ref=anim-preview';
const RATES = [0.25, 0.5, 1, 1.5, 2];

const fileUrl = (src: string): string => `/film/file/${src.split('/').map(encodeURIComponent).join('/')}`;

type RenderState = { state: 'idle' } | { state: 'running' } | { state: 'done'; path: string; took?: number } | { state: 'error'; message: string };

/* ── viewer ───────────────────────────────────────────────────────────── */

function Guides({ stage }: { stage: { w: number; h: number } }) {
  const line = 'rgba(255,255,255,.28)';
  const sw = Math.max(1, stage.w / 960);
  return (
    <svg viewBox={`0 0 ${stage.w} ${stage.h}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <rect x={stage.w * 0.05} y={stage.h * 0.05} width={stage.w * 0.9} height={stage.h * 0.9} fill="none" stroke={line} strokeWidth={sw} strokeDasharray="12 8" />
      <rect x={stage.w * 0.1} y={stage.h * 0.1} width={stage.w * 0.8} height={stage.h * 0.8} fill="none" stroke={line} strokeWidth={sw} />
      {[1, 2].map((i) => <line key={`v${i}`} x1={(stage.w * i) / 3} y1={0} x2={(stage.w * i) / 3} y2={stage.h} stroke="rgba(255,255,255,.12)" strokeWidth={sw / 2} />)}
      {[1, 2].map((i) => <line key={`h${i}`} x1={0} y1={(stage.h * i) / 3} x2={stage.w} y2={(stage.h * i) / 3} stroke="rgba(255,255,255,.12)" strokeWidth={sw / 2} />)}
      <path d={`M${stage.w / 2 - stage.w / 60} ${stage.h / 2}H${stage.w / 2 + stage.w / 60}M${stage.w / 2} ${stage.h / 2 - stage.w / 60}V${stage.h / 2 + stage.w / 60}`} stroke={line} strokeWidth={sw} />
    </svg>
  );
}

/** `mg/title.tsx:55` in an error → a link that opens that line. */
function Linkified({ text, info, editor }: { text: string; info: WorkspaceInfo | null; editor: EditorId }) {
  if (!info) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const re = /((?:mg|assets|film)[\w./-]*\.(?:tsx|ts|jsx|js|json|css))(?::(\d+))?(?::(\d+))?/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    parts.push(text.slice(last, m.index));
    const href = editorHref(editor, `${info.root}/${m[1]}`, m[2] ? Number(m[2]) : undefined);
    parts.push(href ? <a key={m.index} href={href} style={{ color: '#ffb1b1', textDecorationColor: 'rgba(255,177,177,.5)' }}>{m[0]}</a> : m[0]);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/* ── shortcuts ────────────────────────────────────────────────────────── */

const SHORTCUTS: [string[], string][] = [
  [['Space'], 'Play / pause'], [['K'], 'Pause'],
  [['←', '→'], 'Previous / next frame'], [['⇧ ←', '⇧ →'], 'Back / forward one second'],
  [['↑', '↓'], 'Previous / next edit point'], [['Home', 'End'], 'Start / end'],
  [['I', 'O'], 'Set in / out at the playhead'], [['⇧ I', '⇧ O'], 'Go to in / out'], [['X'], 'Clear in / out'],
  [['L'], 'Loop (range, or whole film)'], [['[', ']'], 'Slower / faster'],
  [['+', '−'], 'Zoom timeline'], [['\\'], 'Fit timeline'],
  [['G'], 'Safe-area guides'], [['F'], 'Fullscreen'], [['M'], 'Mute'],
  [['Tab'], 'Inspector'], [['T'], 'Cycle time display'], [['Esc'], 'Deselect'], [['?'], 'This list'],
];

function ShortcutSheet({ onClose }: { onClose(): void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(580px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)', overflow: 'auto', background: C.panel, border: `1px solid ${C.line2}`, borderRadius: 10, padding: '16px 20px', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Keyboard shortcuts</strong>
          <span style={{ flex: 1 }} />
          <Btn icon="close" title="Close" onClick={onClose} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '7px 24px' }}>
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.dim }}>
              <span style={{ display: 'inline-flex', gap: 4, minWidth: 96 }}>{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
              <span>{what}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, color: C.faint, fontSize: 11 }}>⌘/Ctrl + scroll zooms the timeline around the pointer. Double-click a clip to loop it.</div>
      </div>
    </div>
  );
}

/** The largest box of the stage's aspect that fits inside `ref` minus `pad` on each side. */
function useFit(ref: React.RefObject<HTMLElement | null>, stage: { w: number; h: number }, pad: number): { w: number; h: number } {
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref]);
  const availW = Math.max(0, size.w - pad * 2);
  const availH = Math.max(0, size.h - pad * 2);
  const scale = Math.min(availW / stage.w, availH / stage.h) || 0;
  return { w: Math.floor(stage.w * scale), h: Math.floor(stage.h * scale) };
}

function SavedNote({ at }: { at: number }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(id); }, []);
  const s = Math.round((Date.now() - at) / 1000);
  return <span style={{ color: C.faint, fontSize: 11, whiteSpace: 'nowrap' }}>Updated {s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`}</span>;
}

/* ── app ──────────────────────────────────────────────────────────────── */

function App() {
  const [film, setFilm] = React.useState<CodeFilm | null>(null);
  const [clientFilm, setClientFilm] = React.useState<CodeFilm | null>(null);
  const [info, setInfo] = React.useState<WorkspaceInfo | null>(null);
  const [compileError, setCompileError] = React.useState<string | null>(null);
  const [hostKey, setHostKey] = React.useState(0);
  const [connected, setConnected] = React.useState(true);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [selected, setSelected] = React.useState<TClip | null>(null);
  const [range, setRange] = React.useState<{ inMs: number; outMs: number } | null>(null);
  const [render, setRender] = React.useState<RenderState>({ state: 'idle' });
  const [sheet, setSheet] = React.useState(false);
  const [errorOpen, setErrorOpen] = React.useState(true);

  const [loop, setLoop] = usePref('loop', false);
  const [guides, setGuides] = usePref('guides', false);
  const [fmt, setFmt] = usePref<TimeFormat>('timeFormat', 'timecode');
  const [editor, setEditor] = usePref<EditorId>('editor', 'vscode');
  const [inspectorOpen, setInspectorOpen] = usePref('inspector', true);
  const [timelineH, setTimelineH] = usePref('timelineHeight', 290);

  const viewer = React.useRef<HTMLDivElement | null>(null);
  const timeline = React.useRef<TimelineHandle | null>(null);

  const loadFilm = React.useCallback(async () => {
    const [filmRes, infoRes] = await Promise.allSettled([fetch('/_anim/film', { cache: 'no-store' }), fetch('/_anim/info', { cache: 'no-store' })]);
    if (infoRes.status === 'fulfilled' && infoRes.value.ok) setInfo(await infoRes.value.json() as WorkspaceInfo);
    if (filmRes.status !== 'fulfilled') { setCompileError(String(filmRes.reason)); return; }
    const res = filmRes.value;
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) { setCompileError(String(body.error ?? `HTTP ${res.status}`)); setErrorOpen(true); return; }
    setCompileError(null);
    setFilm(body as CodeFilm);
  }, []);

  const shown = film ?? clientFilm;
  const pb = useCodeFilmPlayback({ film: shown, fileUrl, hostKey, onFilm: setClientFilm });
  const pbRef = React.useRef(pb);
  pbRef.current = pb;
  const fps = info?.fps ?? 30;
  const frameMs = 1000 / fps;
  const lanes = React.useMemo(() => (shown ? lanesOf(shown) : []), [shown]);
  const points = React.useMemo(() => editPoints(lanes, pb.totalMs), [lanes, pb.totalMs]);

  React.useEffect(() => { void loadFilm(); }, [loadFilm]);

  /* Every save: refresh the picture in place (no reload) and re-evaluate the timeline. A new
     font family needs its stylesheet in the page, so that one case reloads the frame. */
  React.useEffect(() => {
    const es = new EventSource('/_anim/events');
    es.addEventListener('hello', () => setConnected(true));
    es.addEventListener('change', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { fontsChanged?: boolean };
      if (data.fontsChanged) setHostKey((k) => k + 1);
      else pbRef.current.frameRef.current?.contentWindow?.postMessage({ source: 'anim-host', type: 'refresh' }, '*');
      setSavedAt(Date.now());
      void loadFilm();
    });
    es.addEventListener('render', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { state: string; path?: string; took?: number; message?: string };
      if (data.state === 'running') setRender({ state: 'running' });
      else if (data.state === 'done') setRender({ state: 'done', path: data.path ?? '.anim-out/film.mp4', took: data.took });
      else if (data.state === 'error') setRender({ state: 'error', message: data.message ?? 'Render failed' });
    });
    es.onerror = () => setConnected(false);
    es.onopen = () => setConnected(true);
    return () => es.close();
  }, [loadFilm]);

  /* Keep the selection across saves while the clip still exists. */
  React.useEffect(() => {
    setSelected((sel) => {
      if (!sel) return sel;
      return lanes.flatMap((l) => l.clips).find((c) => c.key === sel.key || (c.clipId && c.clipId === sel.clipId)) ?? null;
    });
  }, [lanes]);

  /* Loop: over the in/out range when there is one, else the whole film. */
  const wasPlaying = React.useRef(false);
  React.useEffect(() => {
    const p = pbRef.current;
    const from = range?.inMs ?? 0;
    const to = range?.outMs ?? p.totalMs;
    if (loop && p.playing && p.timeMs >= to - frameMs / 2 && to < p.totalMs) p.seek(from);
    else if (loop && wasPlaying.current && !p.playing && p.timeMs >= Math.min(to, p.totalMs) - frameMs * 2) {
      p.seek(from);
      requestAnimationFrame(() => { if (!pbRef.current.playing) pbRef.current.toggle(); });
    }
    wasPlaying.current = p.playing;
  }, [pb.timeMs, pb.playing, loop, range, frameMs]);

  const stepTo = React.useCallback((ms: number) => {
    const p = pbRef.current;
    p.pause();
    const at = Math.max(0, Math.min(p.totalMs, ms));
    p.seek(at);
    timeline.current?.reveal(at);
  }, []);

  const setIn = React.useCallback(() => {
    const now = frameFloor(pbRef.current.timeMs, fps);
    setRange((r) => ({ inMs: now, outMs: r && r.outMs > now ? r.outMs : pbRef.current.totalMs }));
  }, [fps]);
  const setOut = React.useCallback(() => {
    const now = Math.max(frameFloor(pbRef.current.timeMs, fps), 1000 / fps);
    setRange((r) => ({ inMs: r && r.inMs < now ? r.inMs : 0, outMs: now }));
  }, [fps]);

  const startRender = React.useCallback(async () => {
    setRender({ state: 'running' });
    const res = await fetch('/_anim/render', { method: 'POST' }).catch(() => null);
    if (!res) { setRender({ state: 'error', message: 'The preview server is not reachable.' }); return; }
    if (!res.ok) setRender({ state: 'error', message: (await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}` });
  }, []);

  const fullscreen = React.useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void viewer.current?.requestFullscreen();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = pbRef.current;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const now = frameFloor(p.timeMs, fps);
      const k = e.key;
      const take = () => e.preventDefault();
      if (k === ' ') { take(); p.toggle(); }
      else if (k === 'k' || k === 'K') { take(); p.pause(); }
      else if (k === 'ArrowLeft') { take(); stepTo(e.shiftKey ? now - 1000 : now - frameMs); }
      else if (k === 'ArrowRight') { take(); stepTo(e.shiftKey ? now + 1000 : now + frameMs); }
      else if (k === ',') { take(); stepTo(now - frameMs); }
      else if (k === '.') { take(); stepTo(now + frameMs); }
      else if (k === 'ArrowUp') { take(); stepTo([...points].reverse().find((t) => t < p.timeMs - 1) ?? 0); }
      else if (k === 'ArrowDown') { take(); stepTo(points.find((t) => t > p.timeMs + 1) ?? p.totalMs); }
      else if (k === 'Home') { take(); stepTo(0); }
      else if (k === 'End') { take(); stepTo(p.totalMs); }
      else if (k === 'i' || k === 'I') { take(); if (e.shiftKey) { if (range) stepTo(range.inMs); } else setIn(); }
      else if (k === 'o' || k === 'O') { take(); if (e.shiftKey) { if (range) stepTo(range.outMs); } else setOut(); }
      else if (k === 'x' || k === 'X') { take(); setRange(null); }
      else if (k === 'l' || k === 'L') { take(); setLoop((v) => !v); }
      else if (k === '[' || k === ']') {
        take();
        const i = RATES.indexOf(p.rate);
        const at = i < 0 ? RATES.indexOf(1) : i;
        p.setRate(RATES[Math.max(0, Math.min(RATES.length - 1, at + (k === ']' ? 1 : -1)))]!);
      }
      else if (k === '+' || k === '=') { take(); timeline.current?.zoomBy(1.5); }
      else if (k === '-' || k === '_') { take(); timeline.current?.zoomBy(1 / 1.5); }
      else if (k === '\\' || k === '0') { take(); timeline.current?.fit(); }
      else if (k === 'g' || k === 'G') { take(); setGuides((v) => !v); }
      else if (k === 'f' || k === 'F') { take(); fullscreen(); }
      else if (k === 'm' || k === 'M') { take(); p.setMuted(!p.muted); }
      else if (k === 't' || k === 'T') { take(); setFmt((f) => (f === 'timecode' ? 'seconds' : f === 'seconds' ? 'frames' : 'timecode')); }
      else if (k === 'Tab') { take(); setInspectorOpen((v) => !v); }
      else if (k === 'Escape') { setSelected(null); setSheet(false); }
      else if (k === '?') { take(); setSheet((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fps, frameMs, points, range, stepTo, setIn, setOut, fullscreen, setLoop, setGuides, setFmt, setInspectorOpen]);

  /* Timeline height: drag the bar above it. */
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = timelineH;
    const move = (ev: PointerEvent) => setTimelineH(Math.max(120, Math.min(window.innerHeight - 220, startH + (startY - ev.clientY))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const stage = shown?.stage ?? { w: 1920, h: 1080 };
  const error = compileError ?? pb.error;
  const status = error ? { text: 'Error', color: C.err } : !connected ? { text: 'Offline', color: C.warn } : pb.hostReady ? { text: 'Live', color: C.ok } : { text: 'Compiling', color: C.dim };
  const t = (ms: number) => formatTime(ms, fps, fmt);
  const title = info?.name ?? document.title.replace(/ · anim preview$/, '');
  const box = useFit(viewer, stage, 16);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: C.bg, color: C.text }}>
      {/* header */}
      <header style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 14px', borderBottom: `1px solid ${C.line}`, background: C.panel, minWidth: 0 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M12 2l2.6 6.9L22 12l-7.4 3.1L12 22l-2.6-6.9L2 12l7.4-3.1z" fill={C.accent} /></svg>
        <strong style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>{title}</strong>
        <span style={{ color: C.dim, fontSize: 12, whiteSpace: 'nowrap' }}>{shown ? `${stage.w}×${stage.h} · ${fps} fps · ${t(shown.durationMs)}` : 'Loading…'}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 9px', borderRadius: 999, fontSize: 11, color: status.color, background: `${status.color}1c`, flexShrink: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color }} />{status.text}
        </span>
        {savedAt && !error && <SavedNote at={savedAt} />}
        <span style={{ flex: 1 }} />
        <Btn icon="keyboard" title="Keyboard shortcuts (?)" onClick={() => setSheet(true)} />
        <Btn icon="render" title="Render the film into .anim-out/ (same as anim render)" onClick={() => void startRender()} disabled={render.state === 'running'}>
          {render.state === 'running' ? 'Rendering…' : 'Render'}
        </Btn>
        <a
          href={APP_URL} target="_blank" rel="noopener"
          title="Edit films visually in the AnimSpark app — timeline editing, direct manipulation on the canvas and an AI director"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 11px', borderRadius: 6, fontSize: 12, color: '#1a1206', background: C.accent, textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Edit in AnimSpark <Icon name="external" size={14} />
        </a>
      </header>

      {/* viewer + inspector */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <main
            ref={viewer}
            onClick={() => pb.toggle()}
            onDoubleClick={fullscreen}
            style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, position: 'relative', background: C.bg }}
          >
            <div style={{ width: box.w, height: box.h, background: '#000', position: 'relative', boxShadow: '0 0 0 1px #000, 0 16px 48px rgba(0,0,0,.55)', flexShrink: 0 }}>
              <iframe
                key={hostKey}
                ref={pb.frameRef}
                onLoad={pb.onFrameLoad}
                src={`/film/host?v=${hostKey}`}
                title="Film"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: 'none', background: '#000' }}
              />
              {guides && <Guides stage={stage} />}
            </div>
            {error && (
              <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 16, right: 16, bottom: 16, maxHeight: '48%', display: 'flex', flexDirection: 'column', background: '#1b0f11f2', border: `1px solid ${C.err}66`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 12px', color: C.err, fontSize: 12, fontWeight: 600, cursor: 'pointer' }} onClick={() => setErrorOpen((v) => !v)}>
                  {compileError ? 'The film does not compile' : 'The film threw while playing'}
                  <span style={{ color: '#d9a0a0', fontWeight: 400 }}>· showing the last frame that worked</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: C.dim, fontWeight: 400 }}>{errorOpen ? 'Hide' : 'Show'}</span>
                </div>
                {errorOpen && (
                  <pre style={{ margin: 0, padding: '0 12px 12px', overflow: 'auto', color: '#ffd6d6', font: `12px/1.55 ${MONO}`, whiteSpace: 'pre-wrap' }}>
                    <Linkified text={error} info={info} editor={editor} />
                  </pre>
                )}
              </div>
            )}
            {pb.unplayable.length > 0 && (
              <div style={{ position: 'absolute', top: 12, left: 16, right: 16, color: C.warn, fontSize: 11 }}>This browser can't decode: {pb.unplayable.join(', ')}</div>
            )}
            {(render.state === 'done' || render.state === 'error') && (
              <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 12, right: 16, maxWidth: 520, maxHeight: '45%', overflow: 'auto', padding: '8px 10px 8px 12px', borderRadius: 8, background: C.raised, border: `1px solid ${render.state === 'done' ? C.ok : C.err}55`, fontSize: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {render.state === 'done'
                  ? <span>Rendered <a href={`/_anim/out/${render.path.replace(/^\.anim-out\//, '')}`} target="_blank" rel="noopener" style={{ color: C.select, font: `12px ${MONO}` }}>{render.path}</a>{render.took ? <span style={{ color: C.dim }}> in {render.took.toFixed(1)}s</span> : null}</span>
                  : <span style={{ color: '#ffd6d6', whiteSpace: 'pre-wrap', font: `12px/1.5 ${MONO}` }}>{render.message}</span>}
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setRender({ state: 'idle' })} style={{ background: 'none', border: 0, color: C.dim, cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
              </div>
            )}
          </main>

          {/* transport */}
          <div style={{ flexShrink: 0, height: 44, display: 'flex', alignItems: 'center', gap: 2, padding: '0 10px', borderTop: `1px solid ${C.line}`, background: C.panel, overflowX: 'auto' }}>
            <Btn icon="start" title="Start (Home)" onClick={() => stepTo(0)} />
            <Btn icon="prevFrame" title="Previous frame (←)" onClick={() => stepTo(frameFloor(pb.timeMs, fps) - frameMs)} />
            <Btn icon={pb.playing ? 'pause' : 'play'} title={pb.playing ? 'Pause (Space)' : 'Play (Space)'} onClick={pb.toggle} size={22} />
            <Btn icon="nextFrame" title="Next frame (→)" onClick={() => stepTo(frameFloor(pb.timeMs, fps) + frameMs)} />
            <Btn icon="end" title="End (End)" onClick={() => stepTo(pb.totalMs)} />
            <Divider />
            <button
              type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setFmt((f) => (f === 'timecode' ? 'seconds' : f === 'seconds' ? 'frames' : 'timecode'))}
              title="Switch timecode / seconds / frames (T)"
              style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 5, color: C.accent, font: `13px ${MONO}`, padding: '3px 8px', cursor: 'pointer', minWidth: 112, textAlign: 'center', flexShrink: 0 }}
            >{t(pb.timeMs)}</button>
            <span style={{ color: C.faint, font: `12px ${MONO}`, padding: '0 6px', whiteSpace: 'nowrap' }}>/ {t(pb.totalMs)}</span>
            <Divider />
            <Btn icon="inPoint" title="Set in point (I)" onClick={setIn} active={Boolean(range)} />
            <Btn icon="outPoint" title="Set out point (O)" onClick={setOut} active={Boolean(range)} />
            {range && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.dim, font: `11px ${MONO}`, padding: '0 4px', whiteSpace: 'nowrap' }}>
                {t(range.inMs)} → {t(range.outMs)}
                <button type="button" title="Clear in/out (X)" onMouseDown={(e) => e.preventDefault()} onClick={() => setRange(null)} style={{ background: 'none', border: 0, color: C.faint, cursor: 'pointer', padding: 0 }}>×</button>
              </span>
            )}
            <Btn icon="loop" title={`Loop ${range ? 'the range' : 'the film'} (L)`} onClick={() => setLoop((v) => !v)} active={loop} />
            <span style={{ flex: 1 }} />
            <select
              value={pb.rate} onChange={(e) => pb.setRate(Number(e.target.value))} title="Playback speed ([ and ])"
              style={{ background: C.panel2, color: C.text, border: `1px solid ${C.line2}`, borderRadius: 5, font: `12px ${MONO}`, padding: '3px 4px' }}
            >
              {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
            <Btn icon={pb.muted ? 'mute' : 'volume'} title={pb.muted ? 'Unmute (M)' : 'Mute (M)'} onClick={() => pb.setMuted(!pb.muted)} />
            <input
              type="range" min={0} max={1} step={0.01} value={pb.muted ? 0 : pb.volume}
              onChange={(e) => pb.setVolume(Number(e.target.value))} title="Volume"
              style={{ width: 84, accentColor: C.accent }}
            />
            {pb.audioError && <span style={{ color: C.err, fontSize: 11, marginLeft: 6, whiteSpace: 'nowrap' }} title={pb.audioError}>Audio error</span>}
            <Divider />
            <Btn icon="guides" title="Safe-area guides (G)" onClick={() => setGuides((v) => !v)} active={guides} />
            <Btn icon="fullscreen" title="Fullscreen (F)" onClick={fullscreen} />
          </div>
        </div>
        {inspectorOpen && <Inspector film={shown} clip={selected} info={info} editor={editor} setEditor={setEditor} fmt={fmt} onClose={() => setInspectorOpen(false)} />}
      </div>

      {/* timeline */}
      <div onPointerDown={onResizeDown} title="Drag to resize" style={{ height: 5, flexShrink: 0, cursor: 'row-resize', background: C.line, borderTop: `1px solid ${C.bg}` }} />
      <div style={{ height: timelineH, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px 0 12px', background: C.panel2, borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 11, color: C.dim, letterSpacing: '.06em' }}>TIMELINE</span>
          <span style={{ color: C.faint, fontSize: 11, marginLeft: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Read-only · change film.json or ask your agent</span>
          <span style={{ flex: 1 }} />
          <Btn icon="zoomOut" title="Zoom out (−)" onClick={() => timeline.current?.zoomBy(1 / 1.5)} size={16} />
          <Btn icon="fit" title="Fit (\)" onClick={() => timeline.current?.fit()} size={16} />
          <Btn icon="zoomIn" title="Zoom in (+, or ⌘/Ctrl + scroll)" onClick={() => timeline.current?.zoomBy(1.5)} size={16} />
        </div>
        {shown ? (
          <Timeline
            ref={timeline}
            film={shown} lanes={lanes} fps={fps} timeMs={pb.timeMs} playing={pb.playing} range={range}
            selected={selected?.key ?? null} fileUrl={fileUrl}
            onScrub={pb.scrubPreview} onCommit={(ms) => pb.scrubCommit(ms)}
            onSelect={(clip) => { setSelected(clip); if (clip) setInspectorOpen(true); }}
            onRangeToClip={(clip) => { setRange({ inMs: clip.startMs, outMs: clip.startMs + clip.durMs }); setLoop(true); stepTo(clip.startMs); }}
          />
        ) : <div style={{ flex: 1, background: C.panel }} />}
      </div>

      {sheet && <ShortcutSheet onClose={() => setSheet(false)} />}
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
