---
name: map
description: "Draw world and country maps with real geography: projections, highlighted countries, great-circle routes and a turning globe."
---

Draw maps from real geographic data: d3-geo projections, world-atlas borders, topojson decoding.

Shapes and positions on the map come from the data, not from hand tracing; country names and numbers are laid out as page text at the positions the projection computes.

## Maps (geoPath)

| Item | Usage |
| --- | --- |
| Data | The package has no main entry; import files by subpath: `countries-110m.json` / `countries-50m.json` / `land-110m.json` / `land-50m.json`. 110m is enough for the whole world; switch to 50m only when a single country's coastline fills the frame. d3 comes as separate packages (`d3-geo` `d3-scale` `d3-shape`…); there is no whole `d3` package |
| Projection | A pure function; compute it once at module top level. Whole world: `geoNaturalEarth1` / `geoEqualEarth`; a single country: `projection.fitSize([w, h], feature)`; a globe: `geoOrthographic().rotate([-lon, -lat])`, where turning the longitude turns the globe (compute it from `t` every frame) |
| Countries | `countries.features[i].id` is the ISO 3166-1 numeric code as a **three-digit zero-padded string** (`'156'` China, `'840'` United States, `'008'` Albania; `#c-8` selects nothing and raises no error), and `properties.name` is the English name. One path per country; select it within the component's scope with `data-country={f.id}` |
| Other | Graticule `path(geoGraticule10())`; sphere `path({ type: 'Sphere' })`; a city `projection([lon, lat])` → `<circle>`; a line between two places `path({ type: 'LineString', coordinates: [[lon1, lat1], [lon2, lat2]] })` draws an arc along the great circle, drawn on stroke by stroke with DrawSVG; lay out country names and numbers in DOM at the pixel positions `projection` computes, instead of assembling small type from SVG `<text>` |

The `Example` below can go into the current MG scene as a child component.

```tsx
import world from 'world-atlas/countries-110m.json';
import * as topojson from 'topojson-client';
import { geoNaturalEarth1, geoEquirectangular, geoPath, geoGraticule10 } from 'd3-geo';
const countries = topojson.feature(world as any, (world as any).objects.countries) as any;
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
gsap.registerPlugin(DrawSVGPlugin);
const projection = geoNaturalEarth1().fitSize([1720, 880], countries);
const path = geoPath(projection);
const route = path({ type: 'LineString', coordinates: [[121.5, 31.2], [4.5, 51.9]] } as any) ?? '';   // Shanghai → Rotterdam, along the great circle
const [sx, sy] = projection([121.5, 31.2])!;
export function Example() {
  const ref = useRef<SVGSVGElement>(null);
  useGSAP(() => {
    gsap.timeline()
      .set('.route', { drawSVG: '0%' }, 0)
      .to('.route', { drawSVG: '100%', duration: 3, ease: 'none' }, 0);
  }, { scope: ref });
  return (
    <svg ref={ref} viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <g transform="translate(100 100)">
        <path d={path({ type: 'Sphere' } as any) ?? ''} fill="#141c30" />
        <path d={path(geoGraticule10()) ?? ''} fill="none" stroke="#2a3550" strokeWidth={0.5} />
        {countries.features.map((f: any, i: number) => <path key={`${f.id}-${i}`} data-country={f.id} d={path(f) ?? ''} fill={f.id === '156' ? '#4f7cff' : '#2a3550'} stroke="#7cd6ff" strokeWidth={0.7} />)}
        <path className="route" d={route} fill="none" stroke="#c6f24e" strokeWidth={4} />
        <circle cx={sx} cy={sy} r={8} fill="#c6f24e" />
      </g>
    </svg>
  );
}
```


Country borders come from the data version; they do not represent current disputed borders or historical borders. A historical map needs its era checked separately. A great circle is the shortest geographic line and must not pass for a real shipping route.

