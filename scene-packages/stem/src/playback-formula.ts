import type { ScenePackage } from '@animspark/scene-engine';
import { FORMULA_BRIDGE_DEF } from './formula';
import { warmFormulaRuntime } from './formula-runtime';

/* Instant playback: start fetching MathJax as soon as the playback bundle loads, instead of
   waiting hundreds of ms when the first formula enters the frame.
   The warm-up lives here rather than as an import side effect of formula-runtime: the film
   host also imports that module, but ~90% of its films have no formulas and should not all
   pay for a 1.8 MB download. */
if (typeof document !== 'undefined') warmFormulaRuntime();

/**
 * Formula-only browser entry: keeps Python/Pyodide code out of formula playback bundles.
 *
 * MathJax comes in with `./formula` (it imports formula-runtime), so listing the declaration
 * is enough here. As with playback-mpl, the runtime travels with the component and is not
 * wired up a second time here.
 */
const formulaPlaybackPackage: ScenePackage = {
  name: 'animspark/stem',
  doc: 'STEM formula playback',
  components: [FORMULA_BRIDGE_DEF],
};

export default formulaPlaybackPackage;
