/**
 * Turn a component declaration into a real React component.
 *
 * Same job as `packComponent` in `@animspark/scene-engine/react`, deliberately duplicated: muspark
 * is a standalone third-party package and should not pull AnimSpark into its dependency tree for a ~100-line React wrapper.
 *
 * This layer does only three things: compute the size, call `render`, and mount the returned SVG string into the DOM.
 * Score components are **pure functions** (a given score always draws the same way), so no canvas and no async
 * readiness gate are needed - those belong to raster backends such as p5 / three.
 */

import * as React from 'react';

import type { ComponentDef, Params } from './types';

/** Keys this layer consumes itself and does not pass through as params. */
const RESERVED = new Set(['id', 'style', 'className', 'children', '__loc']);

/**
 * Measure our own box once (fill components only).
 *
 * The size lives in outer CSS (`position:absolute; width; height`), which React cannot see - it can only be
 * measured after mounting. Until then, render one frame at the intrinsic size; `useLayoutEffect` corrects it, so the user never sees that frame.
 */
function useBoxSize(enabled: boolean): [React.RefObject<SVGSVGElement | null>, [number, number] | null] {
  const ref = React.useRef<SVGSVGElement | null>(null);
  const [box, setBox] = React.useState<[number, number] | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return undefined;
    const read = (): void => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setBox((old) => (old && old[0] === w && old[1] === h ? old : [w, h]));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return [ref, box];
}

export interface NotationProps {
  score: import('@muspark/core').Score;
  track?: never;
  /** Current source beat. The caller owns the playback clock. */
  progress?: number;
  id?: string;
  style?: React.CSSProperties;
  className?: string;
  [key: string]: unknown;
}

export type NotationComponent = React.FC<NotationProps> & { def: ComponentDef };

export function notationComponent(def: ComponentDef): NotationComponent {
  const Notation: React.FC<NotationProps> = (props) => {
    const { id, style, className } = props;
    if ('track' in props) throw new Error('Use score={score}; track is not a supported prop.');
    const parameters: Params = { ...def.defaults };
    for (const [key, value] of Object.entries(props)) {
      if (!RESERVED.has(key)) parameters[key] = value as Params[string];
    }

    const sw = typeof style?.width === 'number' ? style.width : null;
    const sh = typeof style?.height === 'number' ? style.height : null;
    /* Size follows the outer box (same contract as the @animspark packages): numeric values in style win; otherwise
       the measured outer box; only if neither exists, the intrinsic size. Without measuring, a 1680×430 slot would draw a
       1280×720 score that overflows onto the cell below - the manual's examples are written to "fill the outer container", and that is exactly what happened in testing. */
    const [hostRef, measured] = useBoxSize(Boolean(def.fill) && (sw == null || sh == null));
    const [iw, ih] = def.intrinsic(parameters);
    const w = sw ?? measured?.[0] ?? iw;
    const h = sh ?? measured?.[1] ?? ih;
    const boxStyle: React.CSSProperties = def.fill
      ? { display: 'block', width: '100%', height: '100%', ...style }
      : { display: 'block', ...style };

    return (
      <svg
        id={id}
        ref={hostRef}
        className={className}
        style={boxStyle}
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        xmlns="http://www.w3.org/2000/svg"
        dangerouslySetInnerHTML={{ __html: def.render(parameters, w, h) }}
      />
    );
  };

  Notation.displayName = `Notation(${def.name})`;
  return Object.assign(Notation, { def });
}
