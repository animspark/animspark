/**
 * @animspark/stem/bake - server-side bake entry for formula (legacy pipeline).
 *
 * Typesetting no longer lives here: it is in `formula-compile.ts`, isomorphic and synchronous.
 * This module now does just one thing: load MathJax, then hand the loaded renderer to that
 * typesetter.
 *
 * Why keep it: the bake contract (`BakerRegistry`) is a host interface defined by the engine,
 * and the discovery convention is "the bake module exports `bakers`". **Films on the new
 * architecture do not use this path**: `<Formula>` renders live in the browser
 * (see formula-runtime.ts) and needs no pre-render step.
 */
import type { BakerRegistry } from '@animspark/scene-engine';

import { compileFormula, formulaInk, renderFormulaWith } from './formula-compile';
import { loadMathjax } from './mathjax';

export type { PartSpec } from './formula-compile';

/** LaTeX → SVG. MathJax glyphs use currentColor, replaced with the given ink color. Also reusable by base/markdown etc. */
export async function renderFormula(tex: string, ink: string): Promise<string> {
  return renderFormulaWith(await loadMathjax(), tex, ink);
}

export const bakers: BakerRegistry = {
  formula: {
    specParam: 'tex',
    fit: 'slot',
    render: async (spec) => compileFormula(await loadMathjax(), spec, formulaInk()),
  },
};
