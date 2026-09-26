/**
 * <P5 /> component contract (2D generative art / artistic illustration).
 *
 * Authors write a p5.js instance-mode draw(p, P) (optionally setup(p)); the system handles the canvas, per-frame
 * determinism (reseeding every frame) and synchronous frame output. Like every Scene package component: import
 * explicitly with `import { P5 } from '@animspark/p5'`; the p5 library is bundled only with this package, only when used (zero cost otherwise).
 */
import type { ComponentDef, Params } from '@animspark/scene-engine';
import { p5EnsureInit, p5LibReady, p5RenderHref } from './p5-runtime';

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

export const P5_DEF: ComponentDef = {
  name: 'p5',
  doc: '2D generative art: <P5 /> runs a p5.js instance-mode draw(p, P) artistic illustration layer. Good for noise flow fields, particle painting, organic forms, watercolor/grain textures, procedural textures and background atmosphere. Typography/charts/UI still use DOM/SVG; for 3D use three.',
  details: [
    "- After `import { P5 } from '@animspark/p5';`, use <P5 /> in an mg scene (mg/*.tsx).",
    '- Write the code string in p5 instance mode (every API goes through the `p.` prefix). THEME / WIDTH / HEIGHT are injected by the runtime; no import is needed inside code.',
    '',
    '- Define two functions:',
    '  ① function draw(p, P) { … } (required)',
    '     Redraws "the whole frame at moment P" from scratch: a pure function; never accumulate state across frames.',
    '  ② function setup(p) { … } (optional)',
    '     One-time precomputation (palette / p.createGraphics offscreen layers). The canvas (960×540) is created by the system with noLoop;',
    '     never call createCanvas / frameRate / loop.',
    '',
    '- Determinism (the prerequisite for per-frame seeking): every frame the system calls randomSeed+noiseSeed before draw, so',
    '  p.random() replays the same sequence each frame, good for static scatter; for structure that evolves over time, feed a P scalar into noise coordinates:',
    '  p.noise(x * 0.01, y * 0.01, P.t). Never use frameCount / millis() / deltaTime / mouseX/Y / Math.random().',
    '',
    '- P is a param dictionary that GSAP can tween. The component id exposes a handle of the same name:',
    '  <P5 id="art" P={{ t: 0 }} code={artCode} />',
    '  tl.to(art.P, { t: 1, ease: "none", onUpdate: art.render }, 0).',
    '- P.seed (a numeric scalar) swaps in a whole new random layout; if omitted, the layout is fixed by the code content.',
    '- Use the injected THEME dictionary for colors. The background is transparent by default; for a full-frame atmosphere call p.background(THEME.bg) yourself.',
  ].join('\n'),
  example: [
    "import { P5 } from '@animspark/p5';",
    'const artCode = `',
    'function draw(p, P) {',
    '  p.background(THEME.bg);',
    '  p.noStroke();',
    '  for (let i = 0; i < 900; i++) {',
    '    const u = i / 900;',
    '    // time P.t goes into noise coordinates → organic motion that is deterministic per frame and seekable anywhere',
    '    const x = p.noise(u * 3.1, P.t * 0.6) * WIDTH;',
    '    const y = p.noise(u * 3.1 + 9.7, P.t * 0.6 + 4.2) * HEIGHT;',
    '    const r = 2 + 24 * p.noise(u * 8.0, 2.7);',
    '    p.fill(u < 0.62 ? THEME.primary : THEME.accent);',
    '    p.circle(x, y, r);',
    '  }',
    '}',
    '`;',
    'export const narration = "A swarm of dots drifts along an invisible wind field, like a slow migration";',
    'export default function Shot() {',
    '  useGSAP(() => {',
    '    const tl = gsap.timeline();',
    '    tl.to(art.P, { t: 1, duration: 6, ease: "none", onUpdate: art.render }, 0);',
    '    return tl;',
    '  });',
    '  return <P5 id="art" P={{ t: 0 }} code={artCode} style={{ position: "absolute", inset: 0 }} />;',
    '}',
  ].join('\n'),
  paramDocs: {
    code: 'p5 source string: defines draw(p, P) (required; redraws the whole frame for the current moment) and an optional setup(p). THEME/WIDTH/HEIGHT are injected by the runtime; never call createCanvas.',
    P: 'Initial param dictionary; scalar keys are driven by GSAP tweens, calling the component handle\'s render in onUpdate. A numeric P.seed swaps the random layout.',
  },
  defaults: { code: '', P: {} },
  stepParams: ['code'],
  fill: true,
  intrinsic() {
    return [1280, 720];
  },
  /** Playback gate: ready is not broadcast until the p5 library finishes loading dynamically, so the user never sees a placeholder box on the first frame. */
  ready(): boolean {
    if (!isBrowser) return true;
    if (!p5LibReady()) {
      p5EnsureInit();
      return false;
    }
    return true;
  },
  render(params: Params, width: number, height: number): string {
    const code = str(params.code);
    if (!code) return placeholder(width, height, 'p5: missing draw()');
    if (!isBrowser) return placeholder(width, height, 'p5.js');
    const href = p5RenderHref(code, params.P ?? {});
    if (!href) {
      p5EnsureInit();
      return placeholder(width, height, 'Initializing p5…');
    }
    return `<image href="${href}" x="0" y="0" width="${width.toFixed(1)}" height="${height.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`;
  },
};
