import type { ScenePackage } from '@animspark/scene-engine';
import { CODE_MORPH_DEF } from './code-morph';

const codeMorphPlayback: ScenePackage = {
  name: 'animspark/stem',
  doc: 'STEM Code Extension: token-preserving code transformation playback.',
  components: [CODE_MORPH_DEF],
};

export default codeMorphPlayback;
