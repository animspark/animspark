# useSharedPaint

Use it when you need post-processing. The component disposes of its local composer and render targets; the shared renderer is managed by the host. The factory's `alpha` and other options must match the other 3D scenes.

```tsx
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { gsap } from 'gsap';
import { useLocal, useSharedPaint } from '@animspark/runtime';


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

/* Post-processing chain: useSharedPaint; the composer is created lazily on the first frame and kept the same size as the shared buffer */
export function Example() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const paint = useSharedPaint(canvas, factory);
  const w = useMemo(world, []);
  const t = useLocal();
  const held = useRef<{ r: THREE.WebGLRenderer; composer: EffectComposer; w: number; h: number } | null>(null);
  useEffect(() => () => { held.current?.composer.dispose(); held.current = null; }, []);
  useLayoutEffect(() => {
    paint((r, pw, ph) => {
      if (held.current?.r !== r) {
        const composer = new EffectComposer(r);
        composer.addPass(new RenderPass(w.scene, w.camera));
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(pw, ph), 0.9, 0.4, 0.2));
        held.current = { r, composer, w: 0, h: 0 };
      }
      const c = held.current;
      if (c.w !== pw || c.h !== ph) { c.composer.setSize(pw, ph); c.w = pw; c.h = ph; }
      pose(w, t);
      c.composer.render();
    });
  }, [paint, w, t]);
  return <canvas ref={canvas} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
```
