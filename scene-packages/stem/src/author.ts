/**
 * This is what `import { Formula } from '@animspark/stem'` resolves to inside a film.
 *
 * These are **real React components**, built on the fly by `packComponent` from their
 * declarations. The package only declares "what this set of params looks like when drawn"
 * (`render(params, w, h) → string`); sizing, mounting the string into the DOM, and exposing
 * handles for gsap all live in the shared runtime (see scene-engine's react/pack).
 *
 * This used to be `createAnimSparkJsxComponent('formula')`, a placeholder that throws when
 * called as a function. That was a leftover from the previous generation: shots were not React
 * back then, the JSX factory produced HTML strings, and the factory intercepted the placeholder
 * and swapped in an imperative instance. film.tsx is real React, so the placeholder would be
 * called directly as a component and throw on the spot.
 *
 * The old compiler is unaffected: it rewrites the whole `import { Formula } from '@animspark/stem'`
 * statement into markers it generates itself (see web-shot's rewrite) and never loads this file.
 */
import { packComponent } from '@animspark/scene-engine/react';

import { CODE_MORPH_DEF } from './code-morph';
import { EXECUTION_TRACE_DEF } from './execution-trace';
import { FORMULA_BRIDGE_DEF } from './formula';
import { imgproc as imgprocImpl } from './imgproc';
import { MPL_DEF } from './mpl';

export const Formula = packComponent(FORMULA_BRIDGE_DEF);
export const Mpl = packComponent(MPL_DEF);
export const CodeMorph = packComponent(CODE_MORPH_DEF);
export const ExecutionTrace = packComponent(EXECUTION_TRACE_DEF);

/** Functions produce no pixels, so export as-is; it is just a plain function. */
export const imgproc = imgprocImpl;
