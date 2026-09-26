import type { ScenePackage } from '@animspark/scene-engine';
import { IMGPROC_FUNCTION_DEF, imgproc } from './imgproc';

/** Image-processing browser entry: loads Pillow/Pyodide only when imgproc is bound. */
const imgprocPlaybackPackage: ScenePackage = {
  name: 'animspark/stem',
  doc: 'STEM image processing playback',
  functions: [IMGPROC_FUNCTION_DEF],
  functionImpls: { imgproc },
};

export default imgprocPlaybackPackage;
