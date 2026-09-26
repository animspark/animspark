/**
 * <Three /> component contract.
 *
 * Authors write the standard three.js setup()/update() lifecycle; the system handles synchronous WebGL frame output.
 * Like every Scene package component: import explicitly with `import { Three } from '@animspark/three'`; it enters the player bundle only when used.
 */
import type { ComponentDef, Params } from '@animspark/scene-engine';
import { threeEnsureInit, threeRenderHref } from './three-runtime';

const isBrowser = typeof document !== 'undefined';

function str(value: unknown): string {
  return typeof value === 'string'
    ? value
    : value == null
      ? ''
      : String(value);
}

function placeholder(width: number, height: number, label: string): string {
  return (
    `<rect x="1" y="1" width="${(width - 2).toFixed(1)}" height="${(height - 2).toFixed(1)}" rx="12" `
    + 'fill="#11141c" stroke="#2a3142" stroke-dasharray="9 7"/>'
    + `<text x="${(width / 2).toFixed(1)}" y="${(height / 2).toFixed(1)}" text-anchor="middle" `
    + `dominant-baseline="central" font-family="sans-serif" font-size="${Math.round(Math.min(width, height) / 18)}" `
    + `fill="#5b657a">${label}</text>`
  );
}

export const THREE_DEF: ComponentDef = {
  name: 'three',
  doc: 'Real-time 3D: <Three /> runs a standard three.js (WebGL) setup()/update() scene. Good for rotating polyhedra, parametric surfaces, torus knots, point clouds, mesh models, camera orbits and deformation. For scientific 3D with axis ticks and exact coordinates, use animspark/stem/mpl.',
  details: [
    "- After `import { Three } from '@animspark/three';`, use <Three /> in an mg scene (mg/*.tsx).",
    '- Write standard three.js inside the code string. THREE / THEME / WIDTH / HEIGHT are injected by the runtime; no import is needed inside code.',
    '',
    '- Define two functions:',
    '  ① function setup(ctx) { … return { scene, camera, /* other objects update needs */ } }',
    '     Builds the scene once. The system reuses one WebGLRenderer; never create your own renderer or call requestAnimationFrame.',
    '     ctx = { renderer, addons, width, height, THREE }; renderer is that shared instance.',
    '  ② function update(s, P) { … }',
    '     Each frame, mutates the objects returned by setup() according to params P; may be omitted when there is no animation.',
    '',
    '- All official addons are available (Sky / Reflector / EffectComposer / OrbitControls / the Loaders ...):',
    '  import them at the top of the scene file using the exact paths from the official three docs; only the submodules you import are bundled:',
    '    import { Sky } from "three/addons/objects/Sky.js";',
    '  the code string runs in an isolated scope and cannot see these bindings, so inside it use the injected ADDONS instead:',
    '    var Sky = ADDONS.Sky;   // the name is the module\'s export name',
    '  A misspelled path fails at compile time instead of showing a black screen at runtime.',
    '',
    '- To take over frame output (post-processing chain, multiple passes), setup can also return optional hooks:',
    '  render(renderer, scene, camera): if returned, the engine no longer calls renderer.render and you produce the frame',
    '    (typically: composer.render()).',
    '  resize(w, h): called when the render size changes. Must be implemented if you hold a composer / your own RenderTarget,',
    '    otherwise on 4K export the post chain stays at 1080p and only the top-left part of the frame shows.',
    '  dispose(): called when the scene is swapped out. Self-created GPU resources such as composer / RenderTarget / Reflector',
    '    are not in the scene graph, so the engine cannot find them; dispose of them here.',
    '',
    '- P is a param dictionary that GSAP can tween. The component id exposes a handle of the same name:',
    '  <Three id="solid" P={{ spin: 0 }} code={code} />',
    '  tl.to(solid.P, { spin: 1, onUpdate: solid.render }, vo("spin it once")).',
    '',
    '- Use the injected THEME dictionary for colors. The background is transparent by default; MeshStandardMaterial scenes must add their own lights.',
  ].join('\n'),
  example: [
    "import { Three } from '@animspark/three';",
    'const solidCode = `',
    'function setup() {',
    '  const scene = new THREE.Scene();',
    '  const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 100);',
    '  camera.position.set(0, 0, 6);',
    '  const geo = new THREE.IcosahedronGeometry(2, 0);',
    '  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(THEME.primary), flatShading: true, roughness: 0.45 });',
    '  const mesh = new THREE.Mesh(geo, mat);',
    '  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(THEME.accent) })));',
    '  scene.add(mesh);',
    '  scene.add(new THREE.AmbientLight(0xffffff, 0.6));',
    '  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(5, 6, 8); scene.add(key);',
    '  return { scene, camera, mesh };',
    '}',
    'function update(s, P) {',
    '  s.mesh.rotation.y = P.spin * Math.PI * 2;',
    '  s.mesh.rotation.x = P.spin * Math.PI * 0.5;',
    '}',
    '`;',
    'export const narration = "An icosahedron is made of 20 congruent triangular faces; spin it once to see every face";',
    'export default function Shot() {',
    '  useGSAP(() => {',
    '    const tl = gsap.timeline();',
    '    tl.to(solid.P, { spin: 1, duration: 4, ease: "none", onUpdate: solid.render }, vo("spin it once"));',
    '    return tl;',
    '  });',
    '  return <Three id="solid" P={{ spin: 0 }} code={solidCode} style={{ position: "absolute", left: 320, top: 180, width: 1280, height: 720 }} />;',
    '}',
  ].join('\n'),
  paramDocs: {
    code: 'three.js source string: defines setup() (returning { scene, camera, … }) and an optional update(s, P). THREE/THEME/WIDTH/HEIGHT are injected by the runtime.',
    P: 'Initial param dictionary; scalar keys are driven by GSAP tweens, calling the component handle\'s render in onUpdate.',
  },
  defaults: { code: '', P: {} },
  stepParams: ['code'],
  fill: true,
  intrinsic() {
    return [1280, 720];
  },
  render(params: Params, width: number, height: number): string {
    const code = str(params.code);
    if (!code) return placeholder(width, height, 'three: missing setup()');
    if (!isBrowser) return placeholder(width, height, 'three.js');
    const href = threeRenderHref(code, params.P ?? {});
    if (!href) {
      threeEnsureInit();
      return placeholder(width, height, 'Initializing WebGL…');
    }
    return `<image href="${href}" x="0" y="0" width="${width.toFixed(1)}" height="${height.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`;
  },
};
