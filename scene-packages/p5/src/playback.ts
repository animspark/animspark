/**
 * Player bundle entry (playbackByCapability.p5).
 * The p5 library itself is dynamically imported by the runtime, and esbuild bundles it as a dependency of this entry:
 * only films bound to this capability carry the ~1MB; zero cost when unused.
 */
import type { ScenePackage } from '@animspark/scene-engine';
import { P5_DEF } from './p5';

const p5Playback: ScenePackage = {
  name: 'animspark/p5',
  doc: 'P5 generative art playback.',
  components: [P5_DEF],
};

export default p5Playback;
