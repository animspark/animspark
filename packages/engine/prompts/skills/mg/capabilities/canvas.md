# Canvas (2D canvas)

Per-pixel imagery: particles, flow fields, waveforms, heat maps, large numbers of repeated shapes, or effects that read and write pixels. For things with layout, such as text, cards and charts, use DOM or SVG: they can be animated directly with GSAP. For WebGL, use the shared renderer from [three](three/README.md); do not call `getContext('webgl')` yourself. For generative-art libraries, use [p5](p5/README.md).

## Default pattern

A canvas has no time of its own: in `useLayoutEffect`, draw one complete frame from scratch for the `t` returned by `useLocal()`, with `[t]` as the dependency list. The `Example` below can go into a scene as a child component:

```tsx
import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { useLocal } from '@animspark/runtime';

const grow = gsap.parseEase('power2.out');
export function Example() {
  const ref = useRef<HTMLCanvasElement>(null);
  const t = useLocal();
  useLayoutEffect(() => {
    const el = ref.current!, ctx = el.getContext('2d')!, w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const box = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const pw = Math.round(box.width * dpr), ph = Math.round(box.height * dpr);
    if (el.width !== pw || el.height !== ph) { el.width = pw; el.height = ph; }
    ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const u = grow(gsap.utils.clamp(0, 1, t / 1.5));
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + t * 0.8, r = 40 + u * 170;
      ctx.fillStyle = `hsl(${190 + i * 4}, 85%, 60%)`;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 4 + u * 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [t]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
```

## Rules

- **Redraw the whole frame.** Every time, `clearRect` and then compute all content from `t`. Do not accumulate between frames (`x += v`): when scrubbing and rendering, frames arrive out of order. Effects that need history (trails, integration) must be written as a function of `t`, or precompute a table at module top level and look it up by `t`.
- **Size the bitmap in actual pixels.** Bitmap = the size from `getBoundingClientRect()` (which already includes the stage scale) × `devicePixelRatio`; for a 4K render that is 2×. Reset `width` / `height` only when the size has changed, then use `setTransform` to map back to CSS-pixel coordinates. A bitmap hard-coded to 1920×1080 is blurry in a scaled preview and twice as blurry in a 4K render.
- **Seed all randomness.** Initial particle positions and noise both use a fixed seed (mulberry32, `createNoise3D(mulberry32(7))`); otherwise the preview, `anim look` and the render each get a different result.
- **Put expensive computation at module top level or in `useMemo`.** A frame only positions and draws; compute the initial state of tens of thousands of particles, and any lookup tables, once outside the component.
- **State driven by the timeline** (a GSAP tween on a plain object that the canvas reads) is redrawn in the timeline's own `onUpdate`; see the Time section of [SKILL.md](../SKILL.md).

## Images and text

Images and fonts used in a canvas must finish loading first; otherwise `anim look` and the render capture a blank or a fallback font. Register the load with `registerFilmPending`, and when it completes, draw again at the current `t`:

```tsx
import { registerFilmPending } from '@animspark/runtime';

const photo = new Image();
photo.src = 'assets/image/hero.png';
const ready = registerFilmPending(Promise.all([
  photo.decode(),
  document.fonts.load("700 64px 'Noto Sans SC'"),
]));
// In useLayoutEffect: ctx.drawImage(photo, …); ctx.font = "700 64px 'Noto Sans SC'"
```

- The snippet above accesses `document`, so run it inside an effect or after mount: module top level is first evaluated once in an environment without a DOM.
- In `ctx.font`, write the font library's family name (quoted); the preview and the render load that family by name. For family names, see [Fonts](../references/fonts.md).
- Do not hand-lay long text, or type that needs wrapping and alignment, inside the canvas; lay it out in DOM on top of the canvas.
- To turn laid-out HTML into a bitmap and then slice it or turn it into particles, use [HTML in Canvas](html-in-canvas/README.md).<!-- hosts: desktop -->
