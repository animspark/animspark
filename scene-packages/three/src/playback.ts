/**
 * Player bundle entry (playbackByCapability.three).
 * The bundler also takes threeRegisterAddons from here: it passes the official addons this film imports
 * into the isolated scope of <Three /> code (authors write ADDONS.Xxx).
 */
import type { ScenePackage } from '@animspark/scene-engine';
import { THREE_DEF } from './three';

export { threeRegisterAddons } from './three-runtime';

const threePlayback: ScenePackage = {
  name: 'animspark/three',
  doc: 'Three real-time 3D playback.',
  components: [THREE_DEF],
};

export default threePlayback;
