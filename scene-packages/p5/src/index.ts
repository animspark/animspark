/**
 * Main entry (safe to import in Node): the p5 library itself is loaded dynamically by the runtime, in the browser
 * only; there is no top-level p5 import here (a top-level import of the p5 UMD crashes in Node).
 */
import type { ScenePackage } from '@animspark/scene-engine';
import pkgJson from '../package.json';
import { P5_DEF } from './p5';

export { P5_DEF } from './p5';
export { p5EnsureInit, p5LibReady, p5RenderHref } from './p5-runtime';
export { P5 } from './author';

export const p5Package: ScenePackage = {
  name: pkgJson.animspark.packageName,
  doc: pkgJson.animspark.tagline,
  components: [P5_DEF],
};

export default p5Package;
