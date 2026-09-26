/**
 * The timeline: every clip on every track, drawn at any zoom, with the playhead, an in/out
 * range, waveforms for sound and frames for video. It never edits anything — clicking selects
 * (the inspector shows where the clip lives in the source), clicking empty space or the ruler
 * moves the playhead, dragging scrubs.
 *
 * One scroll container holds everything; the track headers stick to the left edge and the
 * ruler to the top, so headers, ruler and lanes can never drift apart.
 */
import type { CodeFilm } from '@animspark/player';
import * as React from 'react';

import { drawPeaks, loadPeaks, videoFrame } from './media';
import { C, Icon, MONO, rulerLabel } from './ui';

export type LaneKind = 'mg' | 'video' | 'voice' | 'music' | 'sfx' | 'caption';

export interface TClip {
  key: string;
  label: string;
  kind: LaneKind;
  startMs: number;
  durMs: number;
  src?: string;
  inMs?: number;
  rate?: number;
  gain?: number;
  loc?: string;
  clipId?: string;
  off?: boolean;
  /** The evaluated entry, for the inspector. */
  raw: Record<string, unknown>;
}

export interface Lane {
  key: string;
  label: string;
  sub: string;
  kind: LaneKind;
  hidden?: boolean;
  muted?: boolean;
  locked?: boolean;
  clips: TClip[];
}

const HEADER_W = 164;
const RULER_H = 28;
const TAIL_PX = 48;
const LANE_H: Record<LaneKind, number> = { mg: 40, video: 50, voice: 46, music: 46, sfx: 40, caption: 28 };
export const KIND_COLOR: Record<LaneKind, string> = { mg: C.mg, video: C.video, voice: C.voice, music: C.music, sfx: C.sfx, caption: C.caption };

const LOC_RE = /^film\.json#(\d+)\.(\d+)$/;

/** Tracks in film.json order, then sounds owned by scenes grouped by kind, then captions. */
export function lanesOf(film: CodeFilm): Lane[] {
  const tracks = new Map<number, Lane>();
  const track = (index: number, kind: LaneKind, name?: string, flags?: { hidden?: boolean; muted?: boolean; locked?: boolean }) => {
    let lane = tracks.get(index);
    if (!lane) {
      tracks.set(index, lane = {
        key: `t${index}`, label: `${index + 1}  ${name && name !== kind ? name : kind === 'mg' ? 'MG' : kind[0]!.toUpperCase() + kind.slice(1)}`,
        sub: `film.json · tracks[${index}]`, kind, clips: [], ...flags,
      });
    }
    return lane;
  };
  for (const s of film.scenes) {
    const index = s.track?.index ?? 0;
    const kind: LaneKind = s.track?.kind === 'video' || (!s.track && s.src && !s.src.startsWith('mg/')) ? 'video' : 'mg';
    const lane = track(index, kind, s.track?.name, { hidden: s.track?.hidden, muted: s.track?.muted, locked: s.track?.locked });
    /* A video clip's file and in-point live on its `videos` entry (same loc). */
    const video = lane.kind === 'video' ? film.videos.find((v) => (s.loc && v.loc === s.loc) || (s.clipId && v.clipId === s.clipId)) : undefined;
    lane.clips.push({
      key: s.key, label: s.clipId && s.clipId !== s.label ? `${s.clipId} · ${s.label}` : s.label, kind: lane.kind,
      startMs: s.startMs, durMs: s.durMs, src: video?.src ?? s.src, inMs: video?.inMs ?? s.inMs, loc: s.loc, clipId: s.clipId,
      raw: { ...(video ?? {}), ...(s as unknown as Record<string, unknown>), ...(video ? { src: video.src } : {}) },
    });
  }
  const sceneSounds = new Map<LaneKind, Lane>();
  for (const s of film.sounds) {
    if (!(s.durMs > 0)) continue;
    const kind = s.kind as LaneKind;
    const m = LOC_RE.exec(s.loc ?? '');
    const lane = m && !film.scenes.some((sc) => sc.track?.index === Number(m[1]))
      ? track(Number(m[1]), kind, 'Audio')
      : (sceneSounds.get(kind) ?? (() => {
        const l: Lane = { key: `scene-${kind}`, label: `${kind === 'sfx' ? 'SFX' : kind[0]!.toUpperCase() + kind.slice(1)}`, sub: 'declared by scenes', kind, clips: [] };
        sceneSounds.set(kind, l);
        return l;
      })());
    lane.clips.push({
      key: s.key, label: (s as { label?: string }).label ?? s.src.split('/').pop() ?? s.src, kind,
      startMs: s.startMs, durMs: s.durMs, src: s.src, inMs: s.inMs, rate: s.rate ?? 1,
      gain: ((s as { volume?: number }).volume ?? 1) * (s.gainDb ? 10 ** (s.gainDb / 20) : 1), loc: s.loc, off: s.off,
      raw: s as unknown as Record<string, unknown>,
    });
  }
  const lanes = [...tracks.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
  for (const kind of ['voice', 'music', 'sfx'] as const) { const l = sceneSounds.get(kind); if (l) lanes.push(l); }
  if (film.captions?.length) {
    lanes.push({
      key: 'captions', label: 'Captions', sub: 'subtitles', kind: 'caption',
      clips: film.captions.map((c) => ({ key: c.key, label: c.speaker ? `${c.speaker}: ${c.text}` : c.text, kind: 'caption' as const, startMs: c.startMs, durMs: c.durMs, raw: c as unknown as Record<string, unknown> })),
    });
  }
  return lanes;
}

/** Every clip boundary, sorted: ↑/↓ jump between these. */
export function editPoints(lanes: Lane[], totalMs: number): number[] {
  const set = new Set<number>([0, totalMs]);
  for (const l of lanes) for (const c of l.clips) { set.add(Math.round(c.startMs)); set.add(Math.round(c.startMs + c.durMs)); }
  return [...set].filter((t) => t >= 0 && t <= totalMs).sort((a, b) => a - b);
}

/* ── ruler ────────────────────────────────────────────────────────────── */

function tickSteps(pxPerMs: number, fps: number): { major: number; minor: number } {
  const f = 1000 / fps;
  const majors = [f, 2 * f, 5 * f, 10 * f, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000];
  const major = majors.find((m) => m * pxPerMs >= 84) ?? majors[majors.length - 1]!;
  const minor = [10, 5, 4, 2].map((d) => major / d).find((m) => m * pxPerMs >= 7 && (m >= f - 1e-6)) ?? major;
  return { major, minor };
}

const Ruler = React.memo(function Ruler({ totalMs, pxPerMs, fps, viewFrom, viewTo }: {
  totalMs: number; pxPerMs: number; fps: number; viewFrom: number; viewTo: number;
}) {
  const { major, minor } = tickSteps(pxPerMs, fps);
  const out: React.ReactNode[] = [];
  const first = Math.max(0, Math.floor(viewFrom / minor) * minor);
  const last = Math.min(totalMs, viewTo);
  for (let t = first, i = 0; t <= last + 1e-6 && i < 2000; t += minor, i += 1) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    out.push(
      <div key={t.toFixed(3)} style={{
        position: 'absolute', left: t * pxPerMs, bottom: 0, height: isMajor ? 10 : 5, width: 1,
        background: isMajor ? C.line2 : C.line,
      }}>
        {isMajor && <span style={{ position: 'absolute', left: 4, bottom: 8, color: C.dim, font: `10px ${MONO}`, whiteSpace: 'nowrap' }}>{rulerLabel(t, fps)}</span>}
      </div>,
    );
  }
  return <>{out}</>;
});

/* ── clip bodies ──────────────────────────────────────────────────────── */

const MAX_CANVAS = 12_000;

function Waveform({ clip, url, widthPx, height, color }: { clip: TClip; url: string; widthPx: number; height: number; color: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const revision = String((clip.raw.sourceDurMs as number | undefined) ?? '');
  React.useEffect(() => {
    let live = true;
    void loadPeaks(url, revision).then((peaks) => {
      const canvas = ref.current;
      if (!live || !canvas || !peaks) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.min(MAX_CANVAS, Math.round(widthPx * dpr)));
      canvas.height = Math.round(height * dpr);
      drawPeaks(canvas, peaks, { inMs: clip.inMs ?? 0, durMs: clip.durMs, rate: clip.rate, gain: clip.gain, color });
    });
    return () => { live = false; };
  }, [url, revision, widthPx, height, clip.inMs, clip.durMs, clip.rate, clip.gain, color]);
  return <canvas ref={ref} style={{ position: 'absolute', left: 0, top: 16, width: '100%', height, opacity: clip.off ? 0.35 : 0.85 }} />;
}

function Filmstrip({ clip, url, widthPx, height }: { clip: TClip; url: string; widthPx: number; height: number }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    let live = true;
    const canvas = ref.current;
    if (!canvas) return undefined;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.min(MAX_CANVAS, Math.round(widthPx * dpr)));
    const h = Math.round(height * dpr);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const timer = setTimeout(async () => {
      const first = await videoFrame(url, clip.inMs ?? 0, h);
      if (!live || !first) return;
      const step = first.width;
      const count = Math.min(120, Math.ceil(w / step));
      for (let i = 0; i < count && live; i += 1) {
        const x = i * step;
        const ms = (clip.inMs ?? 0) + (x / w) * clip.durMs * (clip.rate ?? 1);
        const frame = i === 0 ? first : await videoFrame(url, ms, h);
        if (frame && live) ctx.drawImage(frame, x, 0);
      }
    }, 120);
    return () => { live = false; clearTimeout(timer); };
  }, [url, widthPx, height, clip.inMs, clip.durMs, clip.rate]);
  return <canvas ref={ref} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height, opacity: 0.55 }} />;
}

const ClipBox = React.memo(function ClipBox({ clip, lane, pxPerMs, selected, fileUrl, onSelect, onDouble }: {
  clip: TClip; lane: Lane; pxPerMs: number; selected: boolean; fileUrl(src: string): string;
  onSelect(clip: TClip): void; onDouble(clip: TClip): void;
}) {
  const color = KIND_COLOR[clip.kind];
  const left = clip.startMs * pxPerMs;
  const width = Math.max(2, clip.durMs * pxPerMs - 1);
  const h = LANE_H[lane.kind] - 6;
  const dim = lane.hidden || lane.muted || clip.off;
  const sound = clip.kind === 'voice' || clip.kind === 'music' || clip.kind === 'sfx';
  return (
    <div
      data-clip={clip.key}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(clip); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDouble(clip); }}
      title={`${clip.label}\n${(clip.startMs / 1000).toFixed(3)}s → ${((clip.startMs + clip.durMs) / 1000).toFixed(3)}s  (${(clip.durMs / 1000).toFixed(3)}s)${clip.loc ? `\n${clip.loc}` : ''}`}
      style={{
        position: 'absolute', left, top: 3, width, height: h, borderRadius: 4, overflow: 'hidden', cursor: 'default',
        background: `linear-gradient(${color}38, ${color}24)`,
        boxShadow: selected ? `0 0 0 1.5px ${C.select}, 0 0 0 3px ${C.select}33` : `inset 0 0 0 1px ${color}88`,
        opacity: dim ? 0.45 : 1,
        backgroundImage: lane.hidden ? `repeating-linear-gradient(135deg, ${color}22 0 6px, transparent 6px 12px)` : undefined,
      }}
    >
      {clip.kind === 'video' && clip.src && width > 24 && <Filmstrip clip={clip} url={fileUrl(clip.src)} widthPx={width} height={h} />}
      {sound && clip.src && width > 8 && <Waveform clip={clip} url={fileUrl(clip.src)} widthPx={width} height={h - 18} color={color} />}
      <div style={{
        position: 'relative', padding: '2px 7px', fontSize: 11, lineHeight: '14px', color: C.text, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', textShadow: '0 1px 2px rgba(0,0,0,.6)',
        borderLeft: `2px solid ${color}`, height: '100%', boxSizing: 'border-box',
      }}>{width > 18 ? clip.label : ''}</div>
    </div>
  );
});

/* ── timeline ─────────────────────────────────────────────────────────── */

export interface TimelineHandle { fit(): void; zoomBy(factor: number): void; reveal(ms: number): void }

export const Timeline = React.forwardRef<TimelineHandle, {
  film: CodeFilm;
  lanes: Lane[];
  fps: number;
  timeMs: number;
  playing: boolean;
  range: { inMs: number; outMs: number } | null;
  selected: string | null;
  fileUrl(src: string): string;
  onScrub(ms: number): void;
  onCommit(ms: number): void;
  onSelect(clip: TClip | null): void;
  onRangeToClip(clip: TClip): void;
}>(function Timeline(props, ref) {
  const { film, lanes, fps, timeMs, playing, range, selected } = props;
  const totalMs = Math.max(1, film.durationMs);
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const [viewW, setViewW] = React.useState(800);
  const [pxPerMs, setPxPerMs] = React.useState<number | null>(null);
  const [scrollLeft, setScrollLeft] = React.useState(0);
  const [hoverMs, setHoverMs] = React.useState<number | null>(null);

  const fitPx = Math.max(1e-4, (viewW - HEADER_W - TAIL_PX) / totalMs);
  const maxPx = 60 / (1000 / fps);
  const px = Math.min(maxPx, Math.max(fitPx, pxPerMs ?? fitPx));
  const contentW = HEADER_W + totalMs * px + TAIL_PX;

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  /* Zoom keeping the time under `anchorX` (viewport px) where it is. */
  const zoomAt = React.useCallback((next: number, anchorX?: number) => {
    const el = scroller.current;
    if (!el) return;
    const clamped = Math.min(maxPx, Math.max(fitPx, next));
    const ax = anchorX ?? (el.clientWidth - HEADER_W) / 2 + HEADER_W;
    const anchorMs = (el.scrollLeft + ax - HEADER_W) / px;
    setPxPerMs(clamped <= fitPx * 1.0001 ? null : clamped);
    requestAnimationFrame(() => { el.scrollLeft = Math.max(0, anchorMs * clamped - (ax - HEADER_W)); });
  }, [fitPx, maxPx, px]);

  React.useImperativeHandle(ref, () => ({
    fit: () => { setPxPerMs(null); if (scroller.current) scroller.current.scrollLeft = 0; },
    zoomBy: (factor: number) => zoomAt(px * factor, HEADER_W + (timeMs * px - (scroller.current?.scrollLeft ?? 0))),
    reveal: (ms: number) => {
      const el = scroller.current;
      if (!el) return;
      const x = ms * px;
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEADER_W - 24) el.scrollLeft = Math.max(0, x - (el.clientWidth - HEADER_W) * 0.3);
    },
  }), [zoomAt, px, timeMs]);

  /* Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer; plain wheel scrolls. */
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(px * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, px]);

  /* Follow the playhead while playing: page forward when it leaves the view. */
  React.useEffect(() => {
    const el = scroller.current;
    if (!el || !playing || pxPerMs === null) return;
    const x = timeMs * px;
    const visible = el.clientWidth - HEADER_W;
    if (x > el.scrollLeft + visible - 24 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 24);
  }, [timeMs, playing, px, pxPerMs]);

  const msAt = (clientX: number): number => {
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    return Math.min(totalMs, Math.max(0, (clientX - rect.left + el.scrollLeft - HEADER_W) / px));
  };

  const drag = React.useRef<{ id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = scroller.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (e.clientX - rect.left < HEADER_W) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId };
    props.onSelect(null);
    props.onScrub(msAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = scroller.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const inside = e.clientX - rect.left >= HEADER_W;
    setHoverMs(inside ? msAt(e.clientX) : null);
    if (drag.current?.id === e.pointerId) props.onScrub(msAt(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    props.onCommit(msAt(e.clientX));
  };

  const viewFrom = scrollLeft / px;
  const viewTo = (scrollLeft + viewW) / px;
  const lanesH = lanes.reduce((h, l) => h + LANE_H[l.kind], 0);

  return (
    <div
      ref={scroller}
      onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHoverMs(null)}
      style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'auto', background: C.panel, userSelect: 'none', overscrollBehavior: 'contain' }}
    >
      <div style={{ position: 'relative', width: contentW, minHeight: '100%' }}>
        {/* ruler */}
        <div style={{ position: 'sticky', top: 0, zIndex: 3, height: RULER_H, display: 'flex', background: C.panel2, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ position: 'sticky', left: 0, zIndex: 4, width: HEADER_W, flexShrink: 0, background: C.panel2, borderRight: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', padding: '0 10px', color: C.faint, fontSize: 10, letterSpacing: '.06em', boxSizing: 'border-box' }}>
            {lanes.length} TRACKS
          </div>
          <div style={{ position: 'relative', flex: 1, cursor: 'ew-resize' }}>
            {range && <div style={{ position: 'absolute', top: 0, bottom: 0, left: range.inMs * px, width: Math.max(1, (range.outMs - range.inMs) * px), background: 'rgba(255,181,71,.18)', borderLeft: `1px solid ${C.accent}`, borderRight: `1px solid ${C.accent}` }} />}
            <Ruler totalMs={totalMs} pxPerMs={px} fps={fps} viewFrom={viewFrom} viewTo={viewTo} />
            <div style={{ position: 'absolute', left: totalMs * px, top: 0, bottom: 0, borderLeft: `1px dashed ${C.line2}` }} />
            <div style={{ position: 'absolute', left: timeMs * px - 6, bottom: 0, width: 13, height: 14, background: C.accent, clipPath: 'polygon(0 0,100% 0,100% 55%,50% 100%,0 55%)', pointerEvents: 'none' }} />
            {hoverMs !== null && (
              <div style={{ position: 'absolute', left: hoverMs * px, top: 2, transform: 'translateX(-50%)', padding: '0 5px', borderRadius: 3, background: C.raised, color: C.text, font: `10px/16px ${MONO}`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                {rulerLabel(Math.round((hoverMs / 1000) * fps) * (1000 / fps), fps)}
              </div>
            )}
          </div>
        </div>

        {/* lanes */}
        {lanes.map((lane) => (
          <div key={lane.key} style={{ display: 'flex', height: LANE_H[lane.kind], borderBottom: `1px solid ${C.line}` }}>
            <div style={{
              position: 'sticky', left: 0, zIndex: 2, width: HEADER_W, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px 0 10px',
              display: 'flex', alignItems: 'center', gap: 8, background: C.panel2, borderRight: `1px solid ${C.line}`,
            }}>
              <span style={{ width: 3, alignSelf: 'stretch', margin: '6px 0', borderRadius: 2, background: KIND_COLOR[lane.kind] }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.5, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lane.label}</div>
                <div style={{ fontSize: 10, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lane.sub}</div>
              </div>
              {lane.hidden && <span title="Hidden in film.json" style={{ color: C.dim }}><Icon name="eyeOff" size={14} /></span>}
              {lane.muted && <span title="Muted in film.json" style={{ color: C.dim }}><Icon name="mute" size={14} /></span>}
              {lane.locked && <span title="Locked in film.json" style={{ color: C.dim }}><Icon name="lock" size={13} /></span>}
            </div>
            <div style={{ position: 'relative', flex: 1 }}>
              {lane.clips.map((clip) => (
                <ClipBox
                  key={clip.key} clip={clip} lane={lane} pxPerMs={px} selected={selected === clip.key}
                  fileUrl={props.fileUrl} onSelect={props.onSelect} onDouble={props.onRangeToClip}
                />
              ))}
            </div>
          </div>
        ))}
        {lanes.length === 0 && (
          <div style={{ padding: '18px 0 0', marginLeft: HEADER_W + 16, color: C.faint }}>No clips yet — add one to film.json.</div>
        )}

        {/* range, film end, hover and playhead over the lanes */}
        <div style={{ position: 'absolute', left: HEADER_W, top: RULER_H, height: Math.max(lanesH, 0), right: 0, pointerEvents: 'none' }}>
          {range && <div style={{ position: 'absolute', top: 0, bottom: 0, left: range.inMs * px, width: Math.max(1, (range.outMs - range.inMs) * px), background: 'rgba(255,181,71,.06)' }} />}
          <div style={{ position: 'absolute', left: totalMs * px, top: 0, bottom: 0, width: TAIL_PX, background: 'rgba(0,0,0,.25)' }} />
          {hoverMs !== null && <div style={{ position: 'absolute', left: hoverMs * px, top: 0, bottom: 0, borderLeft: `1px solid ${C.line2}` }} />}
          <div style={{ position: 'absolute', left: timeMs * px, top: 0, bottom: 0, borderLeft: `1.5px solid ${C.accent}`, boxShadow: '0 0 8px rgba(255,181,71,.35)' }} />
        </div>
      </div>
    </div>
  );
});
