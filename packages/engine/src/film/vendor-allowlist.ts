/**
 * Which bare import specifiers /film-vendor lets through: a dependency-free piece split out of
 * vendor.ts.
 *
 * Two consumers: the vendor route uses it to decide whether to serve a file; the skill catalog uses
 * it to decide whether a package-level manual should be shown to the director (a manual whose imports
 * don't compile is a trap; see skill-catalog). Split out because vendor.ts pulls in code-host
 * (esbuild, host bundling), which the catalog has no reason to carry.
 */

const WASM_NAME = 'esbuild.wasm';
const WASM_JS = 'esbuild-wasm.js';

export function pkgName(spec: string): string {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0] ?? spec;
}

export function allowedVendorSpec(spec: string): boolean {
  if (spec === WASM_NAME || spec === WASM_JS || spec === 'host.js') return true;
  if (spec === 'three' || spec.startsWith('three/')) return true;
  if (spec === 'three.core.js' || spec === 'three.module.js') return true;
  const name = pkgName(spec);
  if (name === 'p5' || name === 'matter-js' || name === 'roughjs' || name === 'simplex-noise') return true;
  if (name === 'highlight.js') return true;
  if (name === 'world-atlas' || name === 'topojson-client') return true;
  /* Only the individual d3-* packages (d3-geo / d3-scale / …) are on disk. The bare 'd3' bundle
     isn't installed; allowing it would make preview-resolve say it compiles, then the browser 404s
     and the picture stays on the previous version, exactly what this allowlist exists to prevent. */
  if (name.startsWith('d3-')) return true;
  if (name.startsWith('@fontsource/') || name.startsWith('@chinese-fonts/')) return true;
  return false;
}
