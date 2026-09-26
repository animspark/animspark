/**
 * Official plugin entry points that share the host's GSAP instance.
 *
 * Keep this file free of Node and GSAP imports: both compiler dependency lists and
 * host source generation use this same map. The first export is also the module's
 * default export, matching the installed GSAP ESM and dist entry points.
 */
const PLUGIN_EXPORTS = {
  DrawSVGPlugin: ['DrawSVGPlugin'],
  SplitText: ['SplitText'],
  MorphSVGPlugin: ['MorphSVGPlugin'],
  MotionPathPlugin: ['MotionPathPlugin'],
  Physics2DPlugin: ['Physics2DPlugin'],
  PhysicsPropsPlugin: ['PhysicsPropsPlugin'],
  ScrambleTextPlugin: ['ScrambleTextPlugin'],
  Flip: ['Flip'],
  TextPlugin: ['TextPlugin'],
  CustomEase: ['CustomEase'],
  CustomBounce: ['CustomBounce'],
  CustomWiggle: ['CustomWiggle'],
  EasePack: ['EasePack', 'SlowMo', 'RoughEase', 'ExpoScaleEase'],
} as const;

export const GSAP_PLUGIN_MODULES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(PLUGIN_EXPORTS).flatMap(([name, exports]) => [
    [`gsap/${name}`, exports],
    [`gsap/${name}.js`, exports],
    [`gsap/dist/${name}`, exports],
    [`gsap/dist/${name}.js`, exports],
  ]),
);

export const GSAP_PLUGIN_SHARED_SPECS = Object.keys(GSAP_PLUGIN_MODULES);

/**
 * Object entries for the host's injected dependency table. No plugin is imported
 * or bundled again: named and default imports point to the exact gsap/all object.
 * __esModule preserves default-import semantics through esbuild's CJS shared shim.
 */
export function gsapPluginSharedEntries(namespace: string): string {
  return Object.entries(GSAP_PLUGIN_MODULES).map(([spec, names]) =>
    `${JSON.stringify(spec)}: { __esModule: true, default: ${namespace}.${names[0]}, `
      + names.map((name) => `${name}: ${namespace}.${name}`).join(', ') + ' },',
  ).join('\n');
}
