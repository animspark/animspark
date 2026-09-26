# HtmlTexture

`import { HtmlTexture, useHtmlTexture } from '@animspark/runtime'`

```tsx
const tex = useHtmlTexture();                 // { raster, width, height, dpr, version, ready, draw(), update() }
<HtmlTexture tex={tex} width={640}>           // content is laid out at this width, height follows the content; it is not shown on screen itself
  <div style={{ width: 640, padding: 30, boxSizing: 'border-box' }}>…any HTML…</div>
</HtmlTexture>
```

| Item | Usage |
| --- | --- |
| Bitmap | `tex.raster` is a canvas (pixels = CSS size × `dpr`, default 2); change it with `useHtmlTexture({ dpr: 1 })` |
| 2D | `tex.draw(ctx, sx, sy, sw, sh, dx, dy, dw, dh)`: cuts a region, given in CSS px, and draws it into a 2D context; the dpr multiplication happens inside |
| three | `new THREE.CanvasTexture(tex.raster)`, `colorSpace = SRGBColorSpace`; whenever `tex.version` changes, set `map.image = tex.raster; map.needsUpdate = true`. In a shader, `uniforms.map = { value }`; in the fragment shader, `texture2D(map, uv + offset)` gives ripples / glitches |
| Particles | Sample `tex.raster.getContext('2d').getImageData(...)` at a fixed step and keep pixels with non-zero alpha as colored particles; sample only once per `tex.version` change (`useMemo`), and each frame only position by `t` |
| Timing | The bitmap is static; write all motion on the consuming side: `const t = useLocal()`, draw by `t` in `useLayoutEffect`, with dependencies `t`, `tex.version` (incremented once per content relayout) and `tex.ready`; do not draw before it is ready. Size the output canvas's bitmap as screen pixels × `devicePixelRatio`. Content may change at specific moments (numbers, captions): when the DOM changes, the bitmap is regenerated automatically. But do not change content every frame: the serialization path takes tens of milliseconds per run |
| Content | Load fonts and images from workspace paths (`import '../assets/fonts/…/font.css'`); `<video>` and other canvases cannot be included; `backdrop-filter` and `mix-blend-mode` do not make it into the bitmap, while shadows, rounded corners, gradients and `background-clip: text` all do; use integer sizes + `box-sizing: border-box` so the bitmap and the computed coordinates line up |

The `Example` below can go into the current MG scene as a child component.

```tsx
// A laid-out card: the top half is torn into horizontal strips by the wind (tex.draw), the bottom half is sampled into particles and blown away (getImageData)
import { useLayoutEffect, useMemo, useRef } from 'react';
import { HtmlTexture, useHtmlTexture, useLocal } from '@animspark/runtime';


export function Example() {
  const out = useRef<HTMLCanvasElement>(null);
  const tex = useHtmlTexture();
  const t = useLocal();
  const dots = useMemo(() => {
    if (!tex.raster) return [] as Array<{ x: number; y: number; c: string }>;
    const { width: rw, height: rh } = tex.raster;
    const px = tex.raster.getContext('2d')!.getImageData(0, 0, rw, rh).data;
    const list: Array<{ x: number; y: number; c: string }> = [];
    for (let y = tex.height / 2; y < tex.height; y += 6) for (let x = 0; x < tex.width; x += 6) {
      const i = (Math.round(y * tex.dpr) * rw + Math.round(x * tex.dpr)) * 4;
      if (px[i + 3]! > 40) list.push({ x, y, c: `rgb(${px[i]},${px[i + 1]},${px[i + 2]})` });
    }
    return list;
  }, [tex.raster, tex.version, tex.width, tex.height, tex.dpr]);
  useLayoutEffect(() => {
    const el = out.current;
    const ctx = el?.getContext('2d');
    const cw = el?.clientWidth ?? 0;
    const ch = el?.clientHeight ?? 0;
    if (!el || !ctx || !cw || !ch) return;
    const box = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(box.width * dpr));
    const ph = Math.max(1, Math.round(box.height * dpr));
    if (el.width !== pw || el.height !== ph) { el.width = pw; el.height = ph; }
    ctx.reset();
    ctx.setTransform(pw / cw, 0, 0, ph / ch, 0, 0);
    if (!tex.ready) return;
    const { width: w, height: h } = tex;
    const ox = (cw - w) / 2, oy = (ch - h) / 2, band = h / 2 / 10;
    for (let r = 0; r < 10; r++) {
      const drift = Math.sin(t * 2.6 + r * 0.8) * 30 * Math.min(1, t / 0.7);
      tex.draw(ctx, 0, r * band, w, band, ox + drift, oy + r * band, w, band);
    }
    const blow = Math.max(0, (t - 1.4) / 1.8);
    for (const d of dots) {
      ctx.fillStyle = d.c;
      ctx.globalAlpha = Math.max(0, 1 - blow);
      ctx.fillRect(ox + d.x + blow * (300 + d.x), oy + d.y - blow * 200, 6, 6);
    }
  }, [t, tex, tex.version, tex.ready, dots]);
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#101012' }}>
      <HtmlTexture tex={tex} width={640}>
        <div style={{ width: 640, padding: '30px 40px', boxSizing: 'border-box', borderRadius: 22, background: '#f6f2e8', color: '#141210', font: '500 36px/1.5 sans-serif' }}>
          A whole block of type crumpled by the wind: line breaks, <b>bold</b> and emoji 🍃 are all laid out by the browser.
        </div>
      </HtmlTexture>
      <canvas ref={out} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}
```
