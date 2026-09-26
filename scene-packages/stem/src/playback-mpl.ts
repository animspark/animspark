import type { ScenePackage } from '@animspark/scene-engine';
import { MPL_DEF } from './mpl';
import { warmMplRuntime } from './mpl-runtime';

/* Instant playback: start fetching Pyodide as soon as the playback package loads, instead of waiting for the first mpl frame to begin downloading a dozen-plus MB of wasm.
   The warmup lives here rather than as an import side effect of mpl-runtime - the film host imports that module too,
   and films without any mpl figure should not all pay for the download (same rule as playback-formula warming MathJax). */
if (typeof document !== 'undefined') warmMplRuntime();

/** Scientific-plot browser entry: owns matplotlib/Pyodide warmup only when Mpl is used. */
const mplPlaybackPackage: ScenePackage = {
  name: 'animspark/stem',
  doc: 'STEM scientific plot playback',
  components: [MPL_DEF],
};

export default mplPlaybackPackage;
