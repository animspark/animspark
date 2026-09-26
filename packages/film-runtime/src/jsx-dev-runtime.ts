/**
 * Custom JSX runtime, for one purpose only: letting each clip know which source line it was
 * written on.
 *
 * Clips on the doc already carry their origin (`film.json#track.clip`) and don't need this
 * layer. What needs it are the timeline components rendered directly **inside picture code**:
 * which line of the MG code a video or a line of narration is written on is known only at
 * compile time.
 *
 * Why a custom runtime rather than something else:
 *   - React's dev transform already passes `{fileName, lineNumber, columnNumber}` to
 *     `jsxDEV`. The location is always there, but it goes into `element._source`, which the
 *     component itself can't read.
 *   - Asking film authors to hand-write `<Video loc="...">` is a non-starter.
 *   - Guessing after the fact with regexes which line is which clip is bound to get it wrong
 *     with nesting and multiple instances.
 *
 * So here the source is turned into an ordinary prop and passed down. This is done only for
 * the components that **register on the timeline** (they carry an `__animTracked` marker).
 * Every other component is forwarded untouched; otherwise React would pass an unknown `__loc`
 * all the way down to the DOM, producing a stray attribute and a warning.
 */

import { Fragment, jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime';

export { Fragment };

interface JsxSource {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

/** `file:line:column`. The collecting side converts it to a workspace-relative path; here it is esbuild's absolute path. */
export type SourceLoc = string;

export function formatLoc(source: JsxSource | undefined): SourceLoc | undefined {
  if (!source?.fileName || !source.lineNumber) return undefined;
  return `${source.fileName}:${source.lineNumber}:${source.columnNumber ?? 0}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function jsxDEV(
  type: any,
  props: any,
  key: any,
  isStaticChildren: boolean,
  source: JsxSource | undefined,
  self: any,
): any {
  const loc = formatLoc(source);
  if (loc && type?.__animTracked && props && props.__loc === undefined) {
    props = { ...props, __loc: loc };
  }
  return reactJsxDEV(type, props, key, isStaticChildren, source, self);
}

/* The production transform (`jsx` / `jsxs`) carries no source, so there is nothing to inject;
   but the entry points must exist, or esbuild under `jsxDev: false` can't find this package's exports. */
export { jsx, jsxs } from 'react/jsx-runtime';
