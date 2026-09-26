/**
 * What a film gets from `import { Three } from '@animspark/three'`: a real React component, built on the fly by
 * `packComponent` from `THREE_DEF` (see scene-engine's react/pack).
 *
 * This used to be `createAnimSparkJsxComponent('three')`: a placeholder that threw when called as a function and
 * relied on the old compiler rewriting the whole statement at build time. film.tsx is real React with no such
 * rewrite step, so the placeholder would be called directly and throw on the spot.
 *
 * **This package is retired and kept for reference.** In the new architecture, build the scene yourself with
 * `import * as THREE from 'three'` and get the shared context via `useSharedRenderer` / `useSharedPaint`
 * (@animspark/runtime): a film with a dozen 3D shots each creating its own renderer hits the browser's context
 * limit, and the failure mode is that earlier beats silently go black.
 */
import { packComponent } from '@animspark/scene-engine/react';

import { THREE_DEF } from './three';

export const Three = packComponent(THREE_DEF);
