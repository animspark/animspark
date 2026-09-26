import type { ScenePackage } from '@animspark/scene-engine';
import pkgJson from '../package.json';
import { THREE_DEF } from './three';

export { THREE_DEF } from './three';
export { threeEnsureInit, threeRenderHref, threeRegisterAddons } from './three-runtime';
export { Three } from './author';

export const threePackage: ScenePackage = {
  name: pkgJson.animspark.packageName,
  doc: pkgJson.animspark.tagline,
  components: [THREE_DEF],
};

export default threePackage;
