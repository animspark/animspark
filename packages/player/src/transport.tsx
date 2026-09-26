/**
 * The two parts of the transport bar: the seek bar and the round icon button.
 *
 * Moved out of VideoPlayer unchanged. The reason for the move: they used to be
 * available only to that one player, so the export pages (whole film and single
 * block) each wrote their own simplified copy. The three looked alike but felt
 * different. The two copies had no hover time bubble, no thumb that appears on
 * hover, no fallback listener on `document` (if pointer capture is lost the
 * release event never comes back and the seek bar sticks to the pointer), and no
 * guard for Safari's `clientX===0`. The result was three seek bars with three
 * temperaments in one product: something everyone notices but nobody can pin down.
 *
 * This is the **only** copy. VideoPlayer and both export pages import it from here.
 */

import React from 'react';

/** Hook for advancing the seek bar during playback without going through React (a setState per frame would re-render the whole player). */
export type SeekBarApi = { setProgressMs(ms: number): void };

export function TransportSeekBar({
  apiRef,
  timeMs,
  totalMs,
  marks,
  disabled,
  onPreview,
  onCommit,
  color = '#f03',
}: {
  apiRef?: React.MutableRefObject<SeekBarApi | null>;
  timeMs: number;
  totalMs: number;
  marks: Array<{ tMs: number; title: string }>;
  /** The playhead may not be moved during export: frame capture owns it for that time. */
  disabled?: boolean;
  /** While dragging: only update the preview frame. */
  onPreview(ms: number): void;
  /** On release: commit the position (writes audio.currentTime). */
  onCommit(ms: number): void;
  /** Fill and thumb color. */
  color?: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const fillRef = React.useRef<HTMLDivElement | null>(null);
  const thumbRef = React.useRef<HTMLDivElement | null>(null);
  const dragging = React.useRef(false);
  const [hovering, setHovering] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const [hoverX, setHoverX] = React.useState<number | null>(null); // pixels from the seek bar's left edge
  const active = hovering || dragActive;
  // Last valid position during a drag: on release/cancel e.clientX can be 0 (Safari / capture release), so it can't be used to commit
  const lastValidMs = React.useRef(timeMs);
  const activePointerId = React.useRef<number | null>(null);
  const cleanupDragListeners = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    if (!dragging.current) lastValidMs.current = timeMs;
  }, [timeMs]);

  const applyProgress = React.useCallback((ms: number) => {
    const pct = totalMs ? (ms / totalMs) * 100 : 0;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
  }, [totalMs]);

  React.useEffect(() => {
    applyProgress(timeMs);
  }, [timeMs, applyProgress]);

  React.useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { setProgressMs: applyProgress };
    return () => { apiRef.current = null; };
  }, [apiRef, applyProgress]);

  const pos = React.useCallback((clientX: number): number | null => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Zero width (controls not laid out yet) or an invalid coordinate -> skip this one; never return NaN/0 and jump to the start by mistake
    if (!(r.width > 0) || !Number.isFinite(clientX)) return null;
    // Safari / capture release occasionally reports clientX=0; treat it as invalid when the seek bar isn't at the screen's left edge.
    if (clientX === 0 && r.left > 1) return null;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * totalMs;
  }, [totalMs]);

  const cleanupDocumentDrag = React.useCallback(() => {
    cleanupDragListeners.current?.();
    cleanupDragListeners.current = null;
    activePointerId.current = null;
  }, []);

  const previewAt = React.useCallback((clientX: number) => {
    const ms = pos(clientX);
    if (ms == null) return;
    lastValidMs.current = ms;
    onPreview(ms);
  }, [onPreview, pos]);

  const finishDrag = React.useCallback((releaseClientX?: number) => {
    if (!dragging.current) return;
    dragging.current = false;
    setDragActive(false);
    cleanupDocumentDrag();
    let ms = lastValidMs.current;
    if (releaseClientX != null) {
      const atRelease = pos(releaseClientX);
      if (atRelease != null) ms = atRelease;
    }
    if (!Number.isFinite(ms)) return;
    onCommit(ms);
  }, [cleanupDocumentDrag, onCommit, pos]);

  React.useEffect(() => cleanupDocumentDrag, [cleanupDocumentDrag]);

  // setPointerCapture is the main path; the document listeners are a fallback so the release event still reaches the seek bar if capture is lost.
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        height: 16,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        touchAction: 'none',
        ...(disabled ? { pointerEvents: 'none' as const, opacity: 0.5 } : {}),
      }}
      onPointerDown={e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return; // primary button only
        e.preventDefault();
        e.stopPropagation();
        const ms = pos(e.clientX);
        if (ms == null) return;
        dragging.current = true;
        setDragActive(true);
        lastValidMs.current = ms;
        cleanupDocumentDrag();
        activePointerId.current = e.pointerId;
        const doc = e.currentTarget.ownerDocument;
        const onDocMove = (ev: PointerEvent) => {
          if (ev.pointerId !== activePointerId.current) return;
          ev.preventDefault();
          previewAt(ev.clientX);
        };
        const onDocUp = (ev: PointerEvent) => {
          if (ev.pointerId !== activePointerId.current) return;
          ev.preventDefault();
          finishDrag(ev.clientX);
        };
        const onDocCancel = (ev: PointerEvent) => {
          if (ev.pointerId !== activePointerId.current) return;
          ev.preventDefault();
          finishDrag(ev.clientX);
        };
        doc.addEventListener('pointermove', onDocMove, true);
        doc.addEventListener('pointerup', onDocUp, true);
        doc.addEventListener('pointercancel', onDocCancel, true);
        cleanupDragListeners.current = () => {
          doc.removeEventListener('pointermove', onDocMove, true);
          doc.removeEventListener('pointerup', onDocUp, true);
          doc.removeEventListener('pointercancel', onDocCancel, true);
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the document listeners are the fallback */ }
        onPreview(ms);
      }}
      onPointerMove={e => {
        const r = ref.current?.getBoundingClientRect();
        if (r && r.width > 0) setHoverX(Math.max(0, Math.min(r.width, e.clientX - r.left)));
        if (!dragging.current) return;
        previewAt(e.clientX);
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); setHoverX(null); }}
      onPointerUp={e => {
        if (!dragging.current) return;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        finishDrag(e.clientX);
      }}
      onPointerCancel={(e) => {
        finishDrag(e.clientX);
      }}
      onLostPointerCapture={() => {
        // lostpointercapture can arrive before pointerup; the drag really ends in pointerup/cancel or the document fallback.
      }}
    >
      {/* hover time bubble */}
      {hovering && hoverX != null && (() => {
        const el = ref.current;
        const w = el?.getBoundingClientRect().width ?? 0;
        if (!(w > 0) || !Number.isFinite(totalMs)) return null;
        const hoverMs = (hoverX / w) * totalMs;
        return (
          <div
            style={{
              position: 'absolute',
              left: hoverX,
              bottom: 20,
              transform: 'translateX(-50%)',
              padding: '3px 8px',
              borderRadius: 4,
              background: 'rgba(0,0,0,.82)',
              color: '#fff',
              fontSize: 12,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
            }}
          >
            {transportTimeText(hoverMs)}
          </div>
        );
      })()}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: active ? 5 : 3,
          borderRadius: active ? 2.5 : 1.5,
          background: 'rgba(255,255,255,.25)',
          pointerEvents: 'none',
          transition: 'height .1s',
        }}
      >
        <div
          ref={fillRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '0%',
            background: color,
            pointerEvents: 'none',
          }}
        />
        {/* beat marks */}
        {marks.map((m, i) =>
          i === 0 ? null : (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${(m.tMs / totalMs) * 100}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: 'rgba(0,0,0,.6)',
                pointerEvents: 'none',
              }}
            />
          ),
        )}
        {/* round thumb: shown on hover/drag */}
        <div
          ref={thumbRef}
          style={{
            position: 'absolute',
            left: '0%',
            top: '50%',
            width: 13,
            height: 13,
            marginLeft: -6.5,
            marginTop: -6.5,
            borderRadius: '50%',
            background: color,
            transform: active ? 'scale(1)' : 'scale(0)',
            transition: 'transform .1s',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

export function TransportIconBtn({
  children,
  onClick,
  title,
  disabled,
  active,
}: {
  children: React.ReactNode;
  onClick(): void;
  title?: string;
  disabled?: boolean;
  /** For buttons that open a panel (chapters, settings): keep a background on the button while the panel is open. */
  active?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      /* Clicking doesn't leave focus on it. Otherwise the next Space press lands on
         this button, the browser treats it as keyboard navigation and draws a focus
         ring, when the user just wants to keep watching. Focus reached via Tab is
         unaffected; a ring belongs there. */
      onMouseDown={(e) => e.preventDefault()}
      style={{
        border: 0,
        background: active ? 'rgba(255,255,255,.2)' : 'transparent',
        color: '#fff',
        cursor: disabled ? 'default' : 'pointer',
        padding: '4px 6px',
        borderRadius: 6,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        opacity: disabled ? 0.4 : hover ? 1 : 0.9,
        transform: hover && !disabled ? 'scale(1.08)' : 'scale(1)',
        transition: 'opacity .1s, transform .1s',
      }}
    >
      {children}
    </button>
  );
}

/** `m:ss`. Shared by the transport bar readout and the hover bubble. */
export function transportTimeText(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
