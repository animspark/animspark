/** An opaque prepared MG remains one clip while its isolated page supplies pixels. */
import * as React from 'react';
import type { FilmDoc, FilmWord } from '@animspark/core/film';
import { useCollecting, useFilmPlaying, useLocalMs } from './stage';

export interface FilmPreparedMgProject {
  buildId: string; dur: number; w: number; h: number; hasAudio: boolean; transparent: boolean;
  surfaceUrl: string; audioSrc?: string; words?: readonly FilmWord[]; text?: string;
  /** Host-generated internal scene view, never author JavaScript. */
  doc?: FilmDoc;
}
type Pending = { promise: Promise<void>; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
type HostWindow = Window & { __filmPending?: Set<Promise<unknown>>; __FILM_ERRORS__?: string[] };

export function PreparedMgSurface({ project }: { project: FilmPreparedMgProject }): React.ReactElement | null {
  const collecting = useCollecting();
  const localMs = useLocalMs();
  const playing = useFilmPlaying();
  const ref = React.useRef<HTMLIFrameElement>(null);
  const ready = React.useRef(false);
  const latest = React.useRef(localMs);
  latest.current = localMs;
  const latestPlaying = React.useRef(playing);
  latestPlaying.current = playing;
  const sequence = React.useRef(0);
  const requestedFrame = React.useRef<string | null>(null);
  const pending = React.useRef(new Map<number, Pending>());
  const send = React.useCallback(() => {
    const frame = ref.current;
    if (!frame?.contentWindow || !ready.current || (!latestPlaying.current && pending.current.size)) return;
    const host = window as HostWindow;
    const seq = ++sequence.current;
    const timeMs = Math.max(0, Math.min(latest.current, project.dur * 1000 - 0.001));
    const key = `${latestPlaying.current}:${timeMs}`;
    if (requestedFrame.current === key) return;
    const doc = requestedFrame.current === null ? project.doc : undefined;
    requestedFrame.current = key;
    if (latestPlaying.current) {
      // Continuous playback is a latest-frame stream, never a capture barrier.
      for (const item of pending.current.values()) item.resolve();
      pending.current.clear();
      frame.contentWindow.postMessage({ source: 'animspark-mg-host', type: 'seek', seq, timeMs, playing: true, doc }, '*');
      return;
    }
    let resolve!: () => void; let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const finish = () => { pending.current.delete(seq); host.__filmPending?.delete(promise); };
    // Keep errors observable without creating unhandled promise rejections.
    promise.catch(error => { (host.__FILM_ERRORS__ ??= []).push(String(error)); }).finally(finish);
    const timer = setTimeout(() => reject(new Error('MG surface did not acknowledge its frame.')), 120000);
    pending.current.set(seq, { promise, resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); }, timer });
    (host.__filmPending ??= new Set()).add(promise);
    frame.contentWindow.postMessage({ source: 'animspark-mg-host', type: 'seek', seq, timeMs, playing: false, doc }, '*');
  }, [project.dur, project.doc]);

  React.useLayoutEffect(() => {
    if (collecting) return;
    const host = window as HostWindow;
    ready.current = false;
    requestedFrame.current = null;
    let resolveReady!: () => void;
    const pageReady = new Promise<void>(done => { resolveReady = done; });
    (host.__filmPending ??= new Set()).add(pageReady);
    const timer = setTimeout(() => { (host.__FILM_ERRORS__ ??= []).push('MG surface failed to load.'); resolveReady(); }, 30000);
    const receive = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow || event.data?.source !== 'animspark-mg-surface') return;
      if (event.data.type === 'ready') { ready.current = true; clearTimeout(timer); resolveReady(); send(); }
      if (event.data.type === 'error') { (host.__FILM_ERRORS__ ??= []).push(String(event.data.error)); clearTimeout(timer); resolveReady(); }
      if (event.data.type === 'seeked') {
        const item = pending.current.get(event.data.seq);
        if (item) {
          pending.current.delete(event.data.seq);
          event.data.error ? item.reject(new Error(String(event.data.error))) : item.resolve();
          send();
        } else if (event.data.error) (host.__FILM_ERRORS__ ??= []).push(String(event.data.error));
      }
    };
    addEventListener('message', receive);
    pageReady.finally(() => host.__filmPending?.delete(pageReady));
    return () => {
      clearTimeout(timer); resolveReady(); removeEventListener('message', receive); ready.current = false;
      for (const item of pending.current.values()) item.resolve();
      pending.current.clear();
    };
  }, [collecting, project.buildId, project.surfaceUrl, send]);
  React.useLayoutEffect(() => { if (!collecting) send(); }, [collecting, localMs, playing, send]);
  if (collecting) return null;
  if (!project.surfaceUrl) throw new Error('Prepared MG has no authorized rendering surface.');
  return <iframe ref={ref} src={project.surfaceUrl} sandbox="allow-scripts" title="MG project" data-mg-surface=""
    style={{ position: 'absolute', inset: 0, width: project.w, height: project.h, border: 0, background: 'transparent', pointerEvents: 'none' }} />;
}
