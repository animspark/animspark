import type { ScenePackage } from '@animspark/scene-engine';
import { EXECUTION_TRACE_DEF } from './execution-trace';

const executionTracePlayback: ScenePackage = {
  name: 'animspark/stem',
  doc: 'STEM Code Extension: deterministic source execution trace playback.',
  components: [EXECUTION_TRACE_DEF],
};

export default executionTracePlayback;
