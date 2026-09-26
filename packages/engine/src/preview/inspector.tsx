/**
 * The inspector: facts about the selected clip — where it sits, what it plays, and where it
 * is written — with a link that opens that line in your editor. Nothing here edits the film;
 * the source is the place to change it.
 */
import type { CodeFilm } from '@animspark/player';
import * as React from 'react';

import type { TClip } from './timeline';
import { KIND_COLOR } from './timeline';
import { C, EDITORS, MONO, editorHref, formatTime, type EditorId, type TimeFormat } from './ui';

export interface WorkspaceInfo {
  name: string;
  root: string;
  fps: number;
  /** `film.json#t.c` → 1-based line of that clip in film.json. */
  lines?: Record<string, number>;
  /** Paths the film asks for that are not on disk. */
  missing?: string[];
  /** MG `src` → the scene file on disk (`mg/title` → `mg/title.tsx`). */
  sceneFiles?: Record<string, string>;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: 8, padding: '3px 0', alignItems: 'baseline' }}>
      <div style={{ color: C.faint, fontSize: 11 }}>{k}</div>
      <div style={{ color: C.text, fontSize: 12, font: `12px ${MONO}`, wordBreak: 'break-all' }}>{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.line}` }}>
      <div style={{ color: C.faint, fontSize: 10, letterSpacing: '.08em', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

export function SourceLink({ info, editor, rel, line }: { info: WorkspaceInfo; editor: EditorId; rel: string; line?: number }) {
  const abs = `${info.root.replace(/\/$/, '')}/${rel}`;
  const href = editorHref(editor, abs, line);
  const [copied, setCopied] = React.useState(false);
  const text = `${rel}${line ? `:${line}` : ''}`;
  const style: React.CSSProperties = { color: C.select, textDecoration: 'none', font: `12px ${MONO}`, cursor: 'pointer', background: 'none', border: 0, padding: 0 };
  if (href) return <a href={href} style={style} title={`Open ${abs}${line ? `:${line}` : ''}`}>{text}</a>;
  return (
    <button type="button" style={style} onMouseDown={(e) => e.preventDefault()} onClick={() => {
      void navigator.clipboard?.writeText(`${abs}${line ? `:${line}` : ''}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
    }} title="Copy the absolute path">{copied ? 'copied' : text}</button>
  );
}

/** Where a clip is written: its film.json entry, and for an MG clip its scene file. */
function sources(clip: TClip, info: WorkspaceInfo): { rel: string; locKey?: string }[] {
  const out: { rel: string; locKey?: string }[] = [];
  if (clip.loc && /^film\.json#/.test(clip.loc)) out.push({ rel: 'film.json', locKey: clip.loc });
  else if (clip.loc) { const [file] = clip.loc.split(/[#:]/); if (file) out.push({ rel: file }); }
  if (clip.kind === 'mg' && clip.src?.startsWith('mg/')) out.push({ rel: info.sceneFiles?.[clip.src] ?? (/\.[jt]sx?$/.test(clip.src) ? clip.src : `${clip.src}.tsx`) });
  if (clip.src && !clip.src.startsWith('mg/')) out.push({ rel: clip.src });
  return out;
}

export function Inspector({ film, clip, info, editor, setEditor, fmt, onClose }: {
  film: CodeFilm | null; clip: TClip | null; info: WorkspaceInfo | null; editor: EditorId;
  setEditor(e: EditorId): void; fmt: TimeFormat; onClose(): void;
}) {
  const fps = info?.fps ?? 30;
  const t = (ms: number) => formatTime(ms, fps, fmt);
  return (
    <aside style={{ width: 300, flexShrink: 0, borderLeft: `1px solid ${C.line}`, background: C.panel, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 34, display: 'flex', alignItems: 'center', padding: '0 8px 0 14px', borderBottom: `1px solid ${C.line}`, gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{clip ? 'Clip' : 'Film'}</span>
        {clip && <span style={{ width: 8, height: 8, borderRadius: 2, background: KIND_COLOR[clip.kind] }} />}
        <span style={{ flex: 1 }} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClose} title="Hide inspector (Tab)" style={{ background: 'none', border: 0, color: C.dim, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
      </div>

      {clip && info && (
        <>
          <Section title="TIMING">
            <Row k="Start">{t(clip.startMs)}</Row>
            <Row k="End">{t(clip.startMs + clip.durMs)}</Row>
            <Row k="Duration">{t(clip.durMs)}</Row>
            {clip.inMs ? <Row k="Source in">{t(clip.inMs)}</Row> : null}
            {clip.rate && clip.rate !== 1 ? <Row k="Rate">{clip.rate}×</Row> : null}
          </Section>
          <Section title="CLIP">
            <Row k="Kind">{clip.kind}</Row>
            {clip.clipId && <Row k="id">{clip.clipId}</Row>}
            {clip.src && <Row k="src">{clip.src}</Row>}
            {clip.gain !== undefined && clip.gain !== 1 && <Row k="Gain">{(20 * Math.log10(Math.max(1e-6, clip.gain))).toFixed(1)} dB</Row>}
            {clip.off && <Row k="State">off (track muted or hidden)</Row>}
            {typeof clip.raw.z === 'number' && <Row k="z">{String(clip.raw.z)}</Row>}
            {clip.raw.transform ? <Row k="transform">{JSON.stringify(clip.raw.transform)}</Row> : null}
            {clip.kind === 'caption' && <Row k="Text">{String(clip.raw.text ?? '')}</Row>}
          </Section>
          <Section title="SOURCE">
            {sources(clip, info).map((s) => (
              <div key={s.rel} style={{ padding: '3px 0' }}>
                <SourceLink info={info} editor={editor} rel={s.rel} line={s.locKey ? info.lines?.[s.locKey] : undefined} />
              </div>
            ))}
            {!sources(clip, info).length && <div style={{ color: C.faint, fontSize: 12 }}>Declared inside a scene.</div>}
          </Section>
        </>
      )}

      {!clip && film && info && (
        <>
          <Section title="FILM">
            <Row k="Stage">{film.stage.w} × {film.stage.h}</Row>
            <Row k="Duration">{t(film.durationMs)}</Row>
            {film.visualEndMs !== film.durationMs && <Row k="Picture ends">{t(film.visualEndMs)}</Row>}
            <Row k="Clips">{film.scenes.length}</Row>
            <Row k="Sounds">{film.sounds.length}</Row>
            {film.captions?.length ? <Row k="Captions">{film.captions.length}</Row> : null}
            <Row k="Folder"><SourceLink info={info} editor={editor} rel="film.json" /></Row>
          </Section>
          {info.missing && info.missing.length > 0 && (
            <Section title="MISSING FILES">
              {info.missing.map((m) => <div key={m} style={{ color: C.warn, font: `12px ${MONO}`, padding: '2px 0', wordBreak: 'break-all' }}>{m}</div>)}
            </Section>
          )}
          <Section title="SCENES">
            {[...new Set(film.scenes.filter((s) => s.src?.startsWith('mg/')).map((s) => s.src!))].map((src) => (
              <div key={src} style={{ padding: '2px 0' }}><SourceLink info={info} editor={editor} rel={info.sceneFiles?.[src] ?? `${src}.tsx`} /></div>
            ))}
          </Section>
          <div style={{ padding: '10px 14px', color: C.faint, fontSize: 11, lineHeight: 1.5 }}>
            Select a clip on the timeline to see where it is written. Double-click a clip to loop it.
          </div>
        </>
      )}

      <div style={{ marginTop: 'auto', padding: '10px 14px', borderTop: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: C.faint, fontSize: 11 }}>Open files in</span>
        <select
          value={editor}
          onChange={(e) => setEditor(e.target.value as EditorId)}
          style={{ background: C.panel2, color: C.text, border: `1px solid ${C.line2}`, borderRadius: 5, font: 'inherit', fontSize: 12, padding: '3px 6px' }}
        >
          {EDITORS.map((ed) => <option key={ed.id} value={ed.id}>{ed.label}</option>)}
        </select>
      </div>
    </aside>
  );
}
