# useSharedRenderer

`import * as THREE from 'three'`; addons come from `three/addons/...` (for example `three/addons/postprocessing/EffectComposer.js`). Do not import `@animspark/three`.

| Item | Usage |
| --- | --- |
| Rendering | `const draw = useSharedRenderer(canvasRef, () => new THREE.WebGLRenderer({ antialias: true, alpha: true }))`, then `draw(scene, camera)` every frame. A film has only one WebGL context, shared by all 3D blocks; do not `new WebGLRenderer` yourself to draw on screen, do not use rAF, and do not touch `canvas.width` / `setSize` |
| factory | Every 3D block writes the same factory; the context is created from the first block that mounts, and options such as `alpha` cannot be changed afterwards. A block with a mismatched factory gets a black background where it expected a transparent one |
| Background | Without `scene.background` the background is transparent and the tracks below show through; for a background color, set `scene.background = new THREE.Color(...)` |
| Time | `const t = useLocal()` (`@animspark/runtime`); in `useLayoutEffect`, pose by `t` and then call `draw`, with `[t]` as the dependency list. Do not accumulate state between frames (`+=`): scrubbing and rendering both sample frames out of order |
| Camera | Set `aspect` to this canvas's actual aspect ratio |
| Easing | `gsap.parseEase('power2.inOut')(u)`, where `u` is the 0–1 progress within the segment |
| Post-processing chain | `useSharedPaint(canvasRef, factory)`: the renderer is only available inside the callback `(r, w, h)`; create the composer lazily on the first frame and keep it the same size as the shared buffer with `composer.setSize(w, h)` (physical pixels). `{ minPixelRatio: 2 }` enables 2× density, which increases GPU cost; enable it only when you really need it |
| HTML texture | `new THREE.CanvasTexture(tex.raster)`; set `needsUpdate` whenever `tex.version` changes (HTML in Canvas is only installed on the desktop host) |

The `Example` below can go into the current MG scene as a child component.

```tsx
import * as THREE from 'three';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { gsap } from 'gsap';
import { useLocal, useSharedRenderer } from '@animspark/runtime';


const factory = () => new THREE.WebGLRenderer({ antialias: true, alpha: true });
const world = () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.32, 220, 36), new THREE.MeshStandardMaterial({ color: 0x4f7cff, roughness: 0.25, metalness: 0.7 }));
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.position.set(3, 4, 5);
  scene.add(knot, key, new THREE.AmbientLight(0xffffff, 0.5));
  return { scene, camera, knot };
};
const pose = (w: ReturnType<typeof world>, t: number) => {
  const u = gsap.parseEase('power2.inOut')(Math.min(1, t / 4));
  w.knot.rotation.set(t * 0.7, u * Math.PI * 2, 0);
  w.camera.position.set(Math.sin(t * 0.35) * 6, 1.2, Math.cos(t * 0.35) * 6);
  w.camera.lookAt(0, 0, 0);
};

/* Direct render: useSharedRenderer */
export function Example() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = useSharedRenderer(canvas, factory);
  const w = useMemo(world, []);
  const t = useLocal();
  useEffect(() => () => { w.knot.geometry.dispose(); w.knot.material.dispose(); }, [w]);
  useLayoutEffect(() => { pose(w, t); draw(w.scene, w.camera); }, [w, t, draw]);
  return <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
```

For the post-processing chain, see [useSharedPaint](useSharedPaint.md).
