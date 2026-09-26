/**
 * animspark/stem - STEM visualization package.
 *
 * Packages are grouped by subject domain, not split by underlying technology:
 * - formula: standard LaTeX / term-by-term formula morphing.
 * - mpl: precise scientific plotting and numeric visualization.
 * - imgproc: pixel-level image processing.
 * - codeMorph / executionTrace: code structure changes and execution semantics.
 *
 * Effect handles general visual choreography; this package only adds STEM-specific
 * capabilities that plain TSX/SVG cannot reliably produce.
 */
import type { ScenePackage } from '@animspark/scene-engine';
import pkgJson from '../package.json';
import { FORMULA_BRIDGE_DEF } from './formula';
import { MPL_DEF } from './mpl';
import { IMGPROC_FUNCTION_DEF, imgproc } from './imgproc';
import { CODE_MORPH_DEF } from './code-morph';
import { EXECUTION_TRACE_DEF } from './execution-trace';

export { FORMULA_BRIDGE_DEF } from './formula';
export { MPL_DEF, MPL_DEFS } from './mpl';
export { mplRenderHref, mplEnsureInit, mplReadyFor } from './mpl-runtime';
export {
  lintMplPythonStatic,
  mplHeavyPackages,
  mplPythonHarnessSource,
  MPL_PYODIDE_INDEX_URL,
  MPL_VALIDATION_THEME,
} from './mpl-harness';
export { IMGPROC_FUNCTION_DEF } from './imgproc';
export { pilRenderHref, pilEnsureInit, pilReadyFor } from './pil-runtime';
export { CODE_MORPH_DEF } from './code-morph';
export { EXECUTION_TRACE_DEF } from './execution-trace';
export { Formula, Mpl, imgproc, CodeMorph, ExecutionTrace } from './author';
export type { PackHandle as StemHandle } from '@animspark/scene-engine/react';

const manifest = pkgJson.animspark;

export const stemPackage: ScenePackage = {
  name: manifest.packageName,
  doc: manifest.tagline,
  components: [FORMULA_BRIDGE_DEF, MPL_DEF, CODE_MORPH_DEF, EXECUTION_TRACE_DEF],
  functions: [IMGPROC_FUNCTION_DEF],
  functionImpls: {
    imgproc,
  },
};

export default stemPackage;
