/**
 * formula component definition - LaTeX → math formula + 3b1b-style term-by-term transforms.
 *
 * Two forms:
 *  ① formula({ tex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' }) - a whole LaTeX string (static/readable).
 *  ② formula({ tex: [ {key:'a2',tex:'a^2'}, '+', {key:'b2',tex:'b^2'}, '=', {key:'c2',tex:'c^2'} ] })
 *     - a term array (terms can carry key/color/cancel/box). When morphing to another term-array
 *     formula, terms with the same key (or same token) slide to their new positions, vanishing
 *     terms fade out, and new terms fade in (TransformMatchingTex). Use Part[][] for multiple lines.
 *
 * "LaTeX → SVG / term layout" is done by MathJax, **rendered live in the browser** (see
 * ./formula-runtime): once MathJax is loaded, tex2svg is synchronous, so every frame can produce
 * the real image on the spot with no pre-render step. Typesetting itself lives in
 * ./formula-compile and is shared with the server-side bake (./bake, legacy pipeline).
 *
 * Render time reads one set of keys: _frameSvg (morph in-between frame) / _states (derivation) /
 * _parts (terms) / _svg (whole image). These keys are either injected by the bake of legacy
 * films or supplied by the live runtime; only when neither is available (MathJax still loading,
 * or running in Node where it doesn't exist) does it fall back to a placeholder box.
 */
import type { ComponentDef, Params, ParamValue } from '@animspark/scene-engine';
import { meetRectInBox, resolveTone } from '@animspark/scene-engine';
import { num, str, embedSvgImage, embedSvgInline, parseSvgRoot, placeholder, BAKED_SVG } from '@animspark/scene-engine/kit';

import { formulaLive, formulaRuntimeReady } from './formula-runtime';
import { formulaEnterRise } from './formula-compile';

const FRAME_SVG = '_frameSvg';
const PARTS = '_parts';
const STATES = '_states';
const STATES_VB = '_statesVB';
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

interface ViewBox { x: number; y: number; w: number; h: number; }

/** Term layout injected by bake (local coords: baseline at y=0, content y∈[minY,minY+h]). */
interface Part {
  key: string;
  tex: string;
  x: number; y: number; w: number; minY: number; h: number;
  cancel?: boolean;
  box?: string;
  svg: string;
}

/** Full formula state injected by bake: the layout of one frame of a single-line morph or an accumulated multi-line derivation. */
interface FormulaState {
  svg: string;
  parts?: Part[];
  vbw: number;
  vbh: number;
}

function readParts(p: Params): Part[] | null {
  const v = (p as Record<string, unknown>)[PARTS];
  return Array.isArray(v) && v.length ? (v as unknown as Part[]) : null;
}

function readStates(p: Params): FormulaState[] | null {
  const v = (p as Record<string, unknown>)[STATES];
  return Array.isArray(v) && v.length ? (v as unknown as FormulaState[]) : null;
}

/** Global viewBox injected by bake (one frame covering all states). Constant across frames → adding lines causes no reflow or jumps. */
function readStatesVB(p: Params): ViewBox | null {
  const v = (p as Record<string, unknown>)[STATES_VB];
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.w === 'number' && typeof o.h === 'number') {
      return { x: num(o.x, 0), y: num(o.y, 0), w: o.w, h: o.h };
    }
  }
  return null;
}

/** Fallback for old bakes (no _statesVB): compute a stable global frame from the union of all states. */
function fallbackStatesVB(states: FormulaState[]): ViewBox {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const s of states) {
    const b = stateBounds(s);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Which data this slot should render from.
 *
 * Prefer already-injected data (legacy films carry bake results in their params); otherwise let
 * the runtime render one live. Both use exactly the same keys (_svg / _parts / _states /
 * _statesVB), so there is only one way to read them below: legacy and new films run the same
 * render code, and typesetting never differs between paths.
 *
 * If live rendering isn't available (MathJax still loading, or this is Node), return params
 * unchanged; the caller falls back to a placeholder box as before.
 */
function sourceParams(p: Params): Params {
  if (readStates(p) || readParts(p) || str(p[BAKED_SVG])) return p;
  /* `ink` applies to all four tex forms (accepts tone names or hex). Defaults to the theme ink,
     which is the light ink of a dark-background palette; on a light-background film without
     ink, the formula is nearly invisible. An ink on the derivation object itself takes priority. */
  const inkRaw = (p as Record<string, unknown>).ink;
  const ink = typeof inkRaw === 'string' && inkRaw ? resolveTone(inkRaw, 'default') : undefined;
  const live = formulaLive((p as Record<string, unknown>).tex, ink);
  if (!live) return p;
  return { ...p, ...(live.params ?? {}), [BAKED_SVG]: live.svg ?? '' } as Params;
}

/**
 * Formula intrinsic size. Key constraint: layout boxes are solved at "compile time", before
 * bake has run (_svg/_vbw not yet injected), so this can only estimate from the tex itself and
 * must never depend on a baked viewBox.
 *
 * Goal: **constant font size**. A formula is "a line of text"; it should be sized by font size
 * (pixel line height), not blown up to fill the whole slot.
 * Approach: estimate how many "character widths" (em) the formula spans → width = line height ×
 * ems, height = line height × lines. Combined with layoutMaxScale=1 (never enlarge, only shrink
 * when the slot is too small), render time fits the real MathJax image centered with meet:
 *   - width overestimated → whitespace in the box, glyph height still = line height (height is
 *     capped, never exceeded); safe;
 *   - width underestimated → scaled down proportionally to fit, glyphs slightly smaller; safe.
 * So the estimate only needs to be rough (it sets the box aspect ratio); precision doesn't matter.
 */
const FORMULA_LINE_PX = 84;

const partTex = (t: unknown): string => (typeof t === 'string' ? t : str((t as { tex?: unknown } | null)?.tex));

/** tex (string / term Part[] / multi-line Part[][] / derivation spec) → {approx. source of the longest line, line count}. */
function texApprox(tex: unknown): { s: string; lines: number } {
  if (typeof tex === 'string') return { s: tex, lines: 1 };
  if (tex && typeof tex === 'object' && !Array.isArray(tex)) {
    const spec = tex as { kind?: unknown; steps?: unknown; layout?: unknown };
    if ((spec.kind === 'derivation' || spec.kind === 'derive') && Array.isArray(spec.steps)) {
      const rows = spec.steps.map((step) => texApprox(step));
      const s = rows.map((r) => r.s).reduce((a, b) => (a.length >= b.length ? a : b), '');
      const lineCount = spec.layout === 'stack'
        ? rows.reduce((sum, r) => sum + r.lines, 0)
        : Math.max(1, ...rows.map((r) => r.lines));
      return { s, lines: Math.max(1, lineCount) };
    }
  }
  if (Array.isArray(tex)) {
    if (tex.length > 0 && Array.isArray(tex[0])) {
      const rows = (tex as unknown[][]).map((r) => r.map(partTex).join(''));
      return { s: rows.reduce((a, b) => (a.length >= b.length ? a : b), ''), lines: Math.max(1, rows.length) };
    }
    return { s: (tex as unknown[]).map(partTex).join(''), lines: 1 };
  }
  return { s: '', lines: 1 };
}

/** Very rough estimate of a single LaTeX line's width in em, only to give layout a well-fitting box ratio. */
function estLineEms(src: string): number {
  let s = src;
  s = s.replace(/\\(left|right|big|bigg|Big|Bigg|displaystyle|textstyle|!|,|;|:|quad|qquad)\b/g, '');
  s = s.replace(/\\(frac|dfrac|tfrac|sqrt)\b/g, '##');
  s = s.replace(/\\(text|mathrm|mathbf|mathit|operatorname)\b/g, '');
  s = s.replace(/\\(angle|pm|mp|times|div|cdot|leq|geq|neq|approx|equiv|rightarrow|Rightarrow|leftarrow|to|sum|int|prod|infty)\b/g, '#');
  s = s.replace(/\\[a-zA-Z]+/g, '#');
  s = s.replace(/[{}^_]/g, '');
  let ems = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) ems += 0.28;
    else if ('+-=<>'.includes(ch)) ems += 1.05;
    else if ('()[]|'.includes(ch)) ems += 0.42;
    else if ('.,'.includes(ch)) ems += 0.3;
    else ems += 0.6;
  }
  return Math.max(1, ems);
}

function formulaIntrinsic(p: Params): [number, number] {
  const { s, lines } = texApprox((p as Record<string, unknown>).tex);
  // Vertical complexity: fractions/roots/sums/integrals take multiple line heights; enlarge the line height so the whole formula isn't squashed and illegible.
  const tall = /\\(d?frac|tfrac|sqrt|sum|int|iint|oint|prod|binom|over)\b/.test(s) ? 1.7 : 1;
  const w = FORMULA_LINE_PX * estLineEms(s);
  const h = FORMULA_LINE_PX * (lines + (lines - 1) * 0.3) * tall;
  return [Math.max(w, FORMULA_LINE_PX), h];
}

/** Real viewBox size of the rendered formula; falls back to the formulaIntrinsic estimate when there is no real image yet. */
function formulaContentSize(p: Params): [number, number] {
  const frame = str((p as Record<string, ParamValue>)[FRAME_SVG]);
  if (frame) {
    const parsed = parseSvgRoot(frame);
    if (parsed) return [parsed.vbw, parsed.vbh];
  }
  const s = sourceParams(p);
  const states = readStates(s);
  if (states?.length) {
    const vb = readStatesVB(s) ?? fallbackStatesVB(states);
    return [vb.w, vb.h];
  }
  const svg = str(s[BAKED_SVG]);
  if (svg) {
    const parsed = parseSvgRoot(svg);
    if (parsed) return [parsed.vbw, parsed.vbh];
  }
  return formulaIntrinsic(p);
}

function strikeLine(part: Part): string {
  const y = part.minY + part.h * 0.5;
  const color = resolveTone('negative', 'negative');
  return `<line x1="${fmt(-40)}" y1="${fmt(y)}" x2="${fmt(part.w + 40)}" y2="${fmt(y)}" stroke="${color}" stroke-width="${fmt(Math.max(part.h * 0.05, 26))}" stroke-linecap="round"/>`;
}

function boxRect(part: Part): string {
  const pad = Math.max(part.h * 0.08, 60);
  const color = resolveTone(part.box || 'accent', 'accent');
  return `<rect x="${fmt(-pad)}" y="${fmt(part.minY - pad)}" width="${fmt(part.w + 2 * pad)}" height="${fmt(part.h + 2 * pad)}" rx="${fmt(pad)}" fill="${color}" fill-opacity="0.16"/>`;
}

/** One term → positioned group (optionally with opacity); decor=false skips box/strike (for pure cross-fades, avoiding overlap jitter). */
function partGroup(part: Part, x: number, y: number, opacity: number, decor = true, idPrefix = ''): string {
  const o = opacity >= 0.999 ? '' : ` opacity="${opacity.toFixed(3)}"`;
  const box = decor && part.box ? boxRect(part) : '';
  const strike = decor && part.cancel ? strikeLine(part) : '';
  const body = idPrefix ? namespaceIds(part.svg, idPrefix) : part.svg;
  return `<g transform="translate(${fmt(x)},${fmt(y)})"${o}>${box}${body}${strike}</g>`;
}

const vbMinY = (ps: Part[]): number => Math.min(...ps.map((p) => p.y + p.minY));
const vbMaxY = (ps: Part[]): number => Math.max(...ps.map((p) => p.y + p.minY + p.h));
const totalW = (ps: Part[]): number => Math.max(...ps.map((p) => p.x + p.w));
const sameLook = (a: Part, b: Part): boolean => a.svg === b.svg && !a.cancel === !b.cancel && (a.box || '') === (b.box || '');

function stateBounds(s: FormulaState): { x: number; y: number; w: number; h: number } {
  const parts = s.parts?.length ? s.parts : null;
  if (parts) return { x: 0, y: vbMinY(parts), w: totalW(parts), h: vbMaxY(parts) - vbMinY(parts) };
  const root = parseSvgRoot(s.svg);
  return root ? { x: root.vbx, y: root.vby, w: root.vbw, h: root.vbh } : { x: 0, y: 0, w: s.vbw || 1, h: s.vbh || 1 };
}

function namespaceIds(inner: string, prefix: string): string {
  return inner
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}-${id}"`)
    .replace(/\b(xlink:href|href)="#([^"]+)"/g, (_m, attr: string, id: string) => `${attr}="#${prefix}-${id}"`);
}

function fullStateGroup(s: FormulaState, prefix: string, opacity: number): string {
  const root = parseSvgRoot(s.svg);
  if (!root) return '';
  const o = opacity >= 0.999 ? '' : ` opacity="${opacity.toFixed(3)}"`;
  return `<g${o}>${namespaceIds(root.inner, prefix)}</g>`;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => { const c = clamp01(x); return c * c * (3 - 2 * c); };

/**
 * Term-by-term A→B (same global coordinate system):
 *  · same key / same operator → slides smoothly to the new position (continuous, reads as the
 *    same object moving);
 *  · only in A (vanishing) → fades out in place;
 *  · only in B (new, e.g. the extra line in a stack) → fades in while rising slightly from
 *    below and scaling up a little, gracefully "growing in".
 * Global coords are constant → existing terms have zero displacement → old content stays
 * perfectly still when lines are added.
 */
function interpolateParts(pa: Part[], pb: Part[], t: number): string {
  const usedB = new Set<number>();
  const bByKey = new Map<string, number>();
  pb.forEach((p, i) => { if (p.key && !bByKey.has(p.key)) bByKey.set(p.key, i); });
  const matchB = (ap: Part): number => {
    if (ap.key && bByKey.has(ap.key)) {
      const j = bByKey.get(ap.key)!;
      if (!usedB.has(j)) return j;
    }
    for (let j = 0; j < pb.length; j++) if (!usedB.has(j) && pb[j]!.tex === ap.tex && !pb[j]!.key) return j;
    return -1;
  };

  const ease = smooth(t);
  const fadeOut = clamp01(1 - t * 1.7);            // vanishing terms are fully faded before the end of the transition
  const enter = clamp01((t - 0.18) / 0.82);        // new terms enter a beat later so they don't compete with moving terms
  const enterE = smooth(enter);
  const parts: string[] = [];

  for (const [i, ap] of pa.entries()) {
    const j = matchB(ap);
    if (j < 0) { parts.push(partGroup(ap, ap.x, ap.y, fadeOut, true, `old${i}`)); continue; }
    usedB.add(j);
    const bp = pb[j]!;
    const x = ap.x + (bp.x - ap.x) * ease;
    const y = ap.y + (bp.y - ap.y) * ease;
    if (sameLook(ap, bp)) {
      parts.push(partGroup(bp, x, y, 1, true, `match${j}`));
    } else {
      // Content/color/decoration changed: position stays continuous, glyphs cross-fade.
      parts.push(partGroup(ap, x, y, clamp01(1 - t * 1.4), false, `from${i}`));
      parts.push(partGroup(bp, x, y, ease, true, `to${j}`));
    }
  }
  pb.forEach((bp, j) => {
    if (usedB.has(j)) return;
    const rise = (1 - enterE) * formulaEnterRise(bp.h); // rise from below (global coords constant, landing spot is the final position)
    parts.push(partGroup(bp, bp.x, bp.y + rise, enterE, true, `new${j}`));
  });
  return parts.join('');
}

function vbStr(vb: ViewBox): string {
  return `${fmt(vb.x)} ${fmt(vb.y)} ${fmt(Math.max(1, vb.w))} ${fmt(Math.max(1, vb.h))}`;
}

/** One frame between two adjacent states, always using the global viewBox (constant across frames → no reflow, no jumps). */
function frameBetweenStates(a: FormulaState, b: FormulaState, t: number, vb: ViewBox): string {
  const pa = a.parts?.length ? a.parts : null;
  const pb = b.parts?.length ? b.parts : null;
  const inner = pa && pb
    ? interpolateParts(pa, pb, t)
    : `${fullStateGroup(a, 'from', 1 - t)}${fullStateGroup(b, 'to', t)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vbStr(vb)}">${inner}</svg>`;
}

function frameForProgress(states: FormulaState[], vb: ViewBox, rawProgress: number): string {
  const last = states.length - 1;
  const p = Math.max(0, Math.min(last, rawProgress));
  const i = Math.min(last, Math.floor(p));
  const local = p - i;
  // Integer endpoint (or out of range) → output that state's static image directly (baked with the same global viewBox, so framing is identical).
  if (i >= last || local <= 0) return states[i]!.svg;
  return frameBetweenStates(states[i]!, states[Math.min(last, i + 1)]!, local, vb);
}

/**
 * Term-by-term transform: A→B matched by key (falling back to identical tokens when there is no
 * key); matched terms slide to new positions, vanishing terms fade out, new terms fade in.
 * Returns params with _frameSvg (render prefers it); without _parts, falls back to a hard cut of
 * the whole image (old behavior).
 */
function interpolateFormula(a: Params, b: Params, t: number): Params {
  const ka = sourceParams(a);
  const kb = sourceParams(b);
  const sa = readStates(ka);
  const sb = readStates(kb);
  if (sa && sb) {
    const ap = num((a as Record<string, unknown>).progress, 0);
    const bp = num((b as Record<string, unknown>).progress, ap);
    return { ...b, progress: ap + (bp - ap) * t };
  }

  const pa = readParts(ka);
  const pb = readParts(kb);
  if (!pa || !pb) return (t < 0.5 ? a : b);

  const minY = Math.min(vbMinY(pa), vbMinY(pb));
  const maxY = Math.max(vbMaxY(pa), vbMaxY(pb));
  const w = Math.max(totalW(pa), totalW(pb));
  const frame = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 ${fmt(minY)} ${fmt(w)} ${fmt(maxY - minY)}">${interpolateParts(pa, pb, t)}</svg>`;
  return { ...b, [FRAME_SVG]: frame };
}

export const FORMULA_BRIDGE_DEF: ComponentDef = {
  name: 'formula',
  doc: 'Math formula: write standard LaTeX; supports 3b1b-style term-by-term transform derivation animations.',
  details: [
    '- tex is standard LaTeX source, without the outer $; display style (fractions/roots/super- and subscripts/sums/integrals all supported). Font size is constant (pixel line height); it is not blown up to fill the slot.',
    '- Static/whole formula: pass tex as a string. Morphing a whole string = hard cut of the whole image (no term-by-term animation).',
    "- ★ 3b1b-style term-by-term transform (the main tool for derivations): pass tex as a term array and give each term you want to track a key - const eq = formula({ tex:[{key:'a2',tex:'a^2'},'+',{key:'b2',tex:'b^2'},'=',{key:'c2',tex:'c^2'}] }); when morphing to [{key:'a2',tex:'a^2'},'=',{key:'c2',tex:'c^2'},'-',{key:'b2',tex:'b^2'}], terms with the same key (and operators with the same token) slide to their new positions, vanishing terms fade out, new terms fade in.",
    "- Dynamic derivation: tex can be {kind:'derivation', layout:'morph'|'stack', align:'=', steps:[...]}, driven continuously with progress:0→N-1; layout:'morph' gracefully morphs a single-line formula, layout:'stack' grows an aligned multi-line derivation line by line.",
    "- Terms can be colored {color:'accent'}, cancelled {cancel:true} (strike-through), or highlighted {box:'accent'} (background fill); for multiple lines use Part[][] or derivation layout:'stack'.",
    '- ★ The limits of \\sum/\\int/\\prod must be written in the same tex (e.g. \\sum_{n=1}^{\\infty}); never split them into separate Parts (e.g. {tex:"\\\\sum"},{tex:"_{n=1}"},{tex:"^{\\\\infty}"}), or the upper/lower bounds will be horizontally misaligned.',
    '- Alongside math-2d: figure draws the diagram, formula writes the expression, placed in different slots of the same layout. Colors follow the theme (MathJax glyphs render in the theme ink).',
  ].join('\n'),
  example: `// Rearranging the Pythagorean theorem: term array + keys, each term flies to its new position.
const eq = formula({ tex: [
  { key:'a2', tex:'a^2' }, '+', { key:'b2', tex:'b^2' }, '=', { key:'c2', tex:'c^2' },
] });
layout(frame('shot', { width: 1920, height: 1080 }, [node(eq, { x: 360, y: 440, width: 1200, height: 200 })]));
say('Subtract b squared from both sides: b squared moves to the right and flips sign, leaving a squared.', {
  'moves to the right': morph(eq, { tex: [
    { key:'a2', tex:'a^2' }, '=', { key:'c2', tex:'c^2' }, '-', { key:'b2', tex:'b^2' },
  ] }),
});`,
  fill: true,
  // A formula is "a line of text" and is placed by font size: never enlarge (only shrink when the slot is too small), so short formulas don't balloon.
  layoutMaxScale: 1,
  paramDocs: {
    tex: "LaTeX source (no $; display style). ① string = whole formula; ② term array [{key,tex,color?,cancel?,box?}|'operator'] = term-by-term transformable; ③ Part[][] = multiple lines; ④ {kind:'derivation', layout:'morph'|'stack', align:'='|'left'|'center', steps:[...]} = dynamic formula derivation.",
    progress: "derivation progress. 0 = first step, 1 = second step, fractions = graceful transition between adjacent steps; just tween this value with GSAP/the timeline.",
    ink: 'Formula ink (tone name or hex); applies to all four tex forms. Defaults to the theme ink (light ink, for dark backgrounds). On light backgrounds you must explicitly set a dark color.',
  },
  defaults: { tex: '', progress: 0, ink: '' },
  interpolate(a, b, t) {
    return interpolateFormula(a as Params, b as Params, t) as typeof a;
  },
  intrinsic(p) {
    return formulaIntrinsic(p as Params);
  },
  contentDebugRect(p, boxW, boxH) {
    const [cw, ch] = formulaContentSize(p as Params);
    return meetRectInBox(boxW, boxH, cw, ch);
  },
  /**
   * Playback/export gate: this slot cannot show real content until MathJax is loaded.
   *
   * Not reporting this has a concrete consequence: frame-by-frame export capture won't wait, so
   * **the placeholder spinner gets burned into the final video**: a spinner that spins forever
   * on screen, while the whole pipeline stays silent.
   */
  ready(p) {
    const params = p as Params;
    if (str((p as Record<string, ParamValue>)[FRAME_SVG])) return true;
    if (readStates(params) || readParts(params) || str(p[BAKED_SVG])) return true;
    // A slot with no tex yet (default empty string) has nothing to wait for; don't let it hold up the whole film's export.
    if (!texApprox((p as Record<string, unknown>).tex).s) return true;
    return formulaRuntimeReady();
  },
  render(p, w, h) {
    const frame = str((p as Record<string, ParamValue>)[FRAME_SVG]);
    if (frame) return embedSvgInline(frame, w, h);
    const s = sourceParams(p as Params);
    const states = readStates(s);
    if (states) {
      const vb = readStatesVB(s) ?? fallbackStatesVB(states);
      return embedSvgInline(frameForProgress(states, vb, num((p as Record<string, ParamValue>).progress, 0)), w, h);
    }
    const svg = str(s[BAKED_SVG]);
    if (svg) return embedSvgImage(svg, w, h);
    const tx = typeof p.tex === 'string' ? (p.tex as string) : 'Formula (term-by-term)';
    return placeholder('formula', w, h, tx);
  },
};
