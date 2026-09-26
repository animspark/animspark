/**
 * mpl component - live client-side matplotlib (Pyodide/WASM), modeled on matplotlib's official animation API (FuncAnimation).
 *
 * Authors write standard matplotlib (pyplot), split into two functions the way the official animation API does:
 *   def init(ax, P) -> list of artists to animate   draws the static background once (axes/title/grid/static elements) + creates the artists that will move.
 *   def update(P, artists)                           each frame only changes those artists' data (set_data / set_offsets / set_text ...).
 * This is exactly FuncAnimation's init_func / func, except the frame number is replaced by named params P, so different narration words can drive different variables.
 *
 * Performance (measured, matching the official API): the author picks one of two paths via the blit param -
 *   blit:true (fixed axes/view, the vast majority): official blitting; the background is baked once, each frame is just update + draw_artist + blit. ~1.2ms/frame.
 *   blit:false (animated axis ranges / autoscale / 3D view rotation): full redraw every frame (axis decorators follow along). ~22ms/frame.
 *   Identical to the official FuncAnimation(..., blit=True/False): pass true whenever you can blit (30x faster); pass false to animate axes/3D.
 *
 * Rendering: Pyodide runs synchronously in the browser -> RGBA -> offscreen canvas -> engine draws it synchronously (see mpl-runtime.ts).
 *   Node (validation time) has no Pyodide: render returns a placeholder box, which does not affect assemble/compile/lint.
 */
import type { ComponentDef, Params } from '@animspark/scene-engine';
import { meetRectInBox } from '@animspark/scene-engine';
import { mplRenderHref, mplEnsureInit, mplLastRasterForCode, mplReadyFor } from './mpl-runtime';

const isBrowser = typeof document !== 'undefined';

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function placeholder(w: number, h: number, label: string): string {
  return (
    `<rect x="1" y="1" width="${(w - 2).toFixed(1)}" height="${(h - 2).toFixed(1)}" rx="12" ` +
    `fill="#11141c" stroke="#2a3142" stroke-dasharray="9 7"/>` +
    `<text x="${(w / 2).toFixed(1)}" y="${(h / 2).toFixed(1)}" text-anchor="middle" ` +
    `dominant-baseline="central" font-family="sans-serif" font-size="${Math.round(Math.min(w, h) / 18)}" ` +
    `fill="#5b657a">${label}</text>`
  );
}

/**
 * First-frame loading state: shown while this figure has never drawn successfully and Pyodide is not ready yet.
 * Modern "skeleton screen" look (instead of a harsh spinner): soft placeholder disk + diagonal highlight sweep + staggered pulsing skeleton bars + gently breathing label.
 * Once a frame has been drawn we switch to "reuse the previous frame" and never fall back here. SMIL animations run inside the overlay's inline SVG.
 */
let warmSeq = 0;
function warming(w: number, h: number): string {
  const id = (warmSeq = (warmSeq + 1) % 1e6);
  const gid = `stmWsh${id}`;       // highlight gradient
  const cid = `stmWcl${id}`;       // placeholder-disk clip
  const fs = Math.max(13, Math.round(Math.min(w, h) / 34));
  const cx = w / 2;
  const R = Math.max(26, Math.min(w, h) * 0.17);   // center placeholder disk radius
  const cy = h * 0.42;                              // disk center slightly high; below is room for skeleton bars and label
  const sweepW = R * 1.25;
  const barW = Math.min(w * 0.46, R * 3.4);
  const barX = cx - barW / 2;
  const barTop = cy + R + fs * 1.6;
  const bars = [1, 0.78, 0.5].map((frac, i) => {
    const y = barTop + i * (fs * 1.05);
    return (
      `<rect x="${barX.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW * frac).toFixed(1)}" height="${(fs * 0.4).toFixed(1)}" rx="${(fs * 0.2).toFixed(1)}" fill="#aab4c8">` +
      `<animate attributeName="opacity" values="0.18;0.5;0.18" dur="1.5s" begin="${(i * 0.2).toFixed(2)}s" repeatCount="indefinite"/>` +
      `</rect>`
    );
  }).join('');
  const ty = barTop + 3 * (fs * 1.05) + fs * 1.4;
  const statusLine = 'Loading…';
  return (
    `<defs>` +
      `<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0%" stop-color="#cfe0ff" stop-opacity="0"/>` +
        `<stop offset="50%" stop-color="#dcebff" stop-opacity="0.5"/>` +
        `<stop offset="100%" stop-color="#cfe0ff" stop-opacity="0"/>` +
      `</linearGradient>` +
      `<clipPath id="${cid}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R.toFixed(1)}"/></clipPath>` +
    `</defs>` +
    // very faint backing card over the whole box
    `<rect x="1" y="1" width="${(w - 2).toFixed(1)}" height="${(h - 2).toFixed(1)}" rx="18" fill="#9aa3b20f"/>` +
    // center placeholder disk: gentle breathing (opacity + slight scale)
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R.toFixed(1)}" fill="#aab4c818" stroke="#aab4c833" stroke-width="1.5">` +
    `<animate attributeName="opacity" values="0.55;0.9;0.55" dur="1.8s" repeatCount="indefinite"/>` +
    `</circle>` +
    // diagonal highlight sweep (clipped to the disk), the signature skeleton-screen effect
    `<g clip-path="url(#${cid})">` +
    `<rect x="${(cx - sweepW / 2).toFixed(1)}" y="${(cy - R).toFixed(1)}" width="${sweepW.toFixed(1)}" height="${(R * 2).toFixed(1)}" fill="url(#${gid})" transform="skewX(-18)">` +
    `<animateTransform attributeName="transform" type="translate" values="${(-R * 1.8).toFixed(1)} 0;${(R * 1.8).toFixed(1)} 0" dur="1.25s" repeatCount="indefinite" additive="sum"/>` +
    `</rect>` +
    `</g>` +
    bars +
    `<text x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="sans-serif" font-size="${fs}" font-weight="600" fill="#8b96ad" letter-spacing="2">` +
    `${statusLine}` +
    `<animate attributeName="opacity" values="0.45;0.95;0.45" dur="1.8s" repeatCount="indefinite"/>` +
    `</text>`
  );
}

export const MPL_DEF: ComponentDef = {
  name: 'mpl',
  doc: 'matplotlib component for scientific computing, scientific presentation and precise information - coordinate systems, functions/derivatives, statistical charts, physical quantities, numerical simulations, 3D surfaces, rigorous geometric proofs, Venn diagrams, vector fields, and any visual that must be computed accurately from math or data before drawing. For generic concept illustrations, icons, moon-phase disks/orbit sketches, flowcharts, decorative visualizations and shots driven by visual choreography, prefer native React/SVG/CSS; do not misuse mpl for simple shapes.',
  details: [
    '- ★Reuse across beats (most important): mpl is usually a singleton. Beat 1: <Mpl id="fig" code={...} P={{...}} blit={...} style={{...}} />; later beats that continue the same main figure write <Mpl data-ref="fig" ... /> (same params as the id declaration; override code/P/blit/style as needed, anything omitted carries over from the previous beat). Never write id="fig2/fig3" in beat 2 - it flickers and cannot morph. Declare a second id only for a side-by-side comparison on the same screen (e.g. fig and fig2 left/right); the next beat that continues the left main figure still uses data-ref="fig".',
  '',
    '- Scope: use mpl when you need numpy/functions/data/geometric invariants/matplotlib-specific plots; for simple sketches such as moon-phase disks, flow arrows or card layouts, prefer React/SVG/CSS.',
    '',
    '- init(ax,P)/update(P,artists): mirrors FuncAnimation. init draws the static background and returns the artists that will move; update only changes those artists (set_data/set_offsets/set_text). Do not call ax.clear/figure/subplots.',
    '',
    '- Never plot empty data in init: fill_between([],[])/bar([]) etc. raise in Pyodide, so the figure never draws (playback stays on loading forever). Draw the static background with axhline/plot on fixed coordinates; put dynamic fills in update.',
    '',
    '- blit: fixed axes/view -> true (fast); animating xlim/ylim/autoscale/3D view_init -> false. With blit:true, update must not change the axes or create new artists.',
    '',
    '- Write code as a backtick template string; import at the top as needed (np/plt/patches). Pick colors with THEME["primary"]/["accent"]/["muted"]/["faint"]/["surfaceStroke"]/["ink"] etc. (same semantic roles as the film\'s theme palette). Scalars in P are driven by GSAP tl.to(fig.P, {..., onUpdate: fig.render}, at("word")).',
    '',
    '- ★Handle usage: with <Mpl id="fig" />, write fig.P / fig.render directly inside useGSAP (same name as the id, resolved via window[id]). **Never** put const fig = window.xxx after useGSAP - at render time the component is not mounted yet, so fig in the closure is always undefined. Also do not declare id="fourierFig" and then tween fig.P.',
    '- ★Container and coordinates: style width/height is the mount box and the figure fills it; margins are computed automatically from the title/ticks/legend (one constrained-layout pass). xlim/ylim are only the data range, not the frame aspect ratio; to lock geometric proportions (unit circle, geometric proofs) write ax.set_aspect("equal").',
    '',
    '- Geometry: hand-write only the given points; construct derived points with vectors/rotations/intersections. Consider asserting side lengths/areas/parallelism and other invariants in init.',
  ].join('\n'),
  example: [
    '// Beat 1: <Mpl id="fig" blit={true} P={{ grow: 0 }} code={`...def init/update...`} style={{...}} />',
    '// Beat 2: <Mpl data-ref="fig" P={{ grow: 0 }} code={newCode} style={{...}} />  // code/P may change; morphs automatically',
    '// useGSAP: tl.to(fig.P, { grow: 1, duration: 1, onUpdate: fig.render }, at("grows"));',
  ].join('\n'),
  paramDocs: {
    code: 'Python source string: import at the top as needed (import numpy as np if you use np; import matplotlib.pyplot as plt if you use plt; plt/np are pre-injected as a fallback, but importing as usual is recommended), and define def init(ax, P) (draw the static background + create the artists that will move, and return them) and def update(P, artists) (each frame only change those artists\' data). Mirrors the official FuncAnimation init_func/func. In geometry figures hand-write only the given points; derive other points via vectors/rotation/translation/intersection/reuse of existing points. For geometric proofs, consider asserting side-length/area/parallel-perpendicular/collinearity invariants in init. Do not call plt.figure()/plt.subplots()/ax.clear(). Read theme colors from the global THEME dict.',
    P: 'Initial parameter dict (e.g. { t: 0, grow: 0 }); scalar keys are animation channels, driven by GSAP tl.to(fig.P, {..., onUpdate: fig.render}, at("word")). Leave it as {} if nothing animates.',
    blit: 'Whether to use official blitting: pass true when the axis range/view stays fixed (only the moving artists are redrawn, ~30x faster; the vast majority of cases); pass false when you need to animate the axis range/autoscale/rotate a 3D view (full redraw every frame). Equivalent to the official FuncAnimation(..., blit=True/False). Default false (conservative: any code works).',
  },
  defaults: { code: '', P: {}, blit: false },
  // code/blit are not tweened numerically (discrete semantics); only scalars in P are interpolated per frame.
  stepParams: ['code', 'blit'],
  // The mount box comes from style; intrinsic is only a layout placeholder, the figure fills the mount box.
  fill: true,
  intrinsic() {
    return [960, 720];
  },
  // Playback gate: not ready until Pyodide + this code's heavy dependencies are loaded; the player waits for all of them before starting.
  ready(p: Params): boolean {
    const code = str(p.code);
    if (!code || !isBrowser) return true;
    return mplReadyFor(code);
  },
  contentDebugRect(p: Params, boxW: number, boxH: number): [number, number, number, number] {
    const code = str(p.code);
    if (!code) return [0, 0, boxW, boxH];
    const instanceId = str((p as Record<string, unknown>).__animsparkInstanceId);
    const sz = mplLastRasterForCode(code, instanceId || undefined);
    if (sz) return meetRectInBox(boxW, boxH, sz[0], sz[1]);
    return meetRectInBox(boxW, boxH, 960, 720);
  },
  render(p: Params, w: number, h: number): string {
    const code = str(p.code);
    if (!code) return placeholder(w, h, 'mpl: missing init/update');
    if (!isBrowser) return placeholder(w, h, 'matplotlib');
    // Browser: run Pyodide synchronously (already ready) -> return a raster <image>.
    //   While not ready / installing deps: if this figure has drawn before, mplRenderHref returns the previous frame's href (reuse it, no flashing card);
    //   only a true cold start (never drawn) returns null, and we draw a quiet placeholder once.
    const instanceId = str((p as Record<string, unknown>).__animsparkInstanceId);
    const href = mplRenderHref(code, p.P ?? {}, p.blit === true, instanceId || undefined, w, h);
    if (!href) {
      mplEnsureInit();
      return warming(w, h);
    }
    return `<image href="${href}" x="0" y="0" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`;
  },
};

export const MPL_DEFS: ComponentDef[] = [MPL_DEF];
