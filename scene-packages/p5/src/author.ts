/**
 * What a film gets from `import { P5 } from '@animspark/p5'`: a real React component, built on the fly by
 * `packComponent` from `P5_DEF` (see scene-engine's react/pack).
 *
 * This used to be `createAnimSparkJsxComponent('p5')`: a placeholder that threw when called as a function and
 * relied on the old compiler rewriting the whole statement at build time. film.tsx is real React with no such
 * rewrite step, so the placeholder would be called directly and throw on the spot.
 *
 * **This package is retired and kept for reference.** In the new architecture, create the instance yourself with
 * `import p5 from 'p5'` (as a dynamic import: p5 touches window at import time, and the film-duration pass runs in
 * node), reseeding before each frame's draw so per-frame seeks line up. In testing this was faster than going
 * through this package.
 */
import { packComponent } from '@animspark/scene-engine/react';

import { P5_DEF } from './p5';

export const P5 = packComponent(P5_DEF);
