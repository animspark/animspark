/**
 * Formula typesetting - LaTeX spec → per-frame-consumable SVG + structured layout. Isomorphic,
 * **synchronous**, side-effect free.
 *
 * This layer only typesets and doesn't care where MathJax comes from: the ability to render one
 * LaTeX string is passed in by the caller as `Tex2Svg`. It is split this way because the same
 * typesetter has two hosts:
 *   · live browser rendering (formula-runtime.ts): calls in synchronously every frame once
 *     MathJax is loaded;
 *   · server-side bake (bake.ts): legacy pipeline, awaits loading and then calls in.
 * Sharing one implementation avoids one-sided typesetting differences like "aligned in the
 * preview, misaligned in the export".
 *
 * Three spec kinds:
 *  ① tex is a string → the whole LaTeX string renders to one SVG (static/readable; morph is a
 *     hard cut of the whole image).
 *  ② tex is a term array (PartSpec[] or multi-line PartSpec[][]) → each term renders
 *     separately + baseline/equals-sign aligned layout; each term's "self-contained mini-SVG +
 *     local box (x/y/w/minY/h)" goes into `_parts`. The component matches by key/same token for
 *     term-by-term transforms (TransformMatchingTex): identical terms slide to new positions,
 *     vanishing terms fade out, new terms fade in.
 *  ③ tex is {kind:'derivation', steps:[...], layout:'morph'|'stack'} → all steps are laid out
 *     at once; per frame only progress is tweened.
 */
import type { BakedResult } from '@animspark/scene-engine';
import { resolveTone } from '@animspark/scene-engine';
import { parseSvgRoot } from '@animspark/scene-engine/kit';

import type { Tex2Svg } from './mathjax';

/** Term spec: a sub-expression the author keys; color tints it, cancel strikes it out, box highlights its background. */
export interface PartSpec {
  key?: string;
  tex: string;
  color?: string;
  cancel?: boolean;
  box?: string | boolean;
}

export interface DerivationSpec {
  kind: 'derivation' | 'derive';
  steps: unknown[];
  layout?: 'morph' | 'stack';
  align?: '=' | 'left' | 'center';
  /** Main formula ink (tone name / hex / rgb). Defaults to the theme ink; on light backgrounds you must explicitly set a dark ink, on dark backgrounds a light one. */
  ink?: string;
}

/** One term rendered and positioned in global coordinates (consumed per frame by the component). */
interface GlobalPart {
  key: string;
  tex: string;
  x: number; y: number; w: number; minY: number; h: number;
  cancel: boolean;
  box: string;
  svg: string;
}

interface ViewBox { x: number; y: number; w: number; h: number; }

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Parse viewBox width/height from the SVG header. */
function parseDims(svg: string): { vbw: number; vbh: number } {
  const root = parseSvgRoot(svg);
  if (!root) return { vbw: 100, vbh: 100 };
  return { vbw: root.vbw, vbh: root.vbh };
}

/** LaTeX → SVG. MathJax glyphs use currentColor, replaced with the given ink color. */
export function renderFormulaWith(tex2svg: Tex2Svg, tex: string, ink: string): string {
  return tex2svg(tex).replace(/currentColor/g, ink);
}

/** Wrap a render result as a BakedResult; non-SVG output returns null (the host falls back to a placeholder box). */
function baked(svg: string): BakedResult | null {
  if (!svg || !svg.includes('<svg')) return null;
  const { vbw, vbh } = parseDims(svg);
  return { svg, vbw, vbh };
}

/** Prefix all ids / references in a term, so glyph defs ids don't collide when several terms are packed into one SVG. */
function namespaceIds(inner: string, prefix: string): string {
  return inner
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}-${id}"`)
    .replace(/\b(xlink:href|href)="#([^"]+)"/g, (_m, attr: string, id: string) => `${attr}="#${prefix}-${id}"`);
}

/** Current theme ink color. */
export const formulaInk = (): string => resolveTone('default', 'default');

const GAP = 150;             // gap between terms (MathJax internal units ≈ 0.15em)
const LINE_FACTOR = 1.45;    // multi-line line spacing (multiple of the tallest term's height)
const STACK_LINE_FACTOR = 1.62;   // multi-line derivation line spacing (looser than plain multi-line LINE_FACTOR, lecture-notes readability)
/** Max offset for new terms entering from below; the layout frame and the actual interpolation must use the same amount. */
export const formulaEnterRise = (height: number): number => height * 0.34;

interface RenderedPart {
  spec: PartSpec;
  inner: string;
  minY: number;
  w: number;
  h: number;
}

interface PackedFormulaState {
  svg: string;
  vbw: number;
  vbh: number;
  parts: GlobalPart[];
}

interface PackRowsOptions {
  align?: '=' | 'left' | 'center';
}

function rowWidth(row: RenderedPart[]): number {
  if (!row.length) return 0;
  return row.reduce((sum, it) => sum + it.w, 0) + GAP * Math.max(0, row.length - 1);
}

function rowEqualX(row: RenderedPart[]): number | null {
  let pen = 0;
  for (const it of row) {
    if (it.spec.tex === '=' || it.spec.tex === '\\=') return pen;
    pen += it.w + GAP;
  }
  return null;
}

/** Strike-out line (cancel): across the vertical middle of the term's box. */
function strikeLine(it: { minY: number; w: number; h: number }, color: string): string {
  const y = it.minY + it.h * 0.5;
  return `<line x1="${fmt(-40)}" y1="${fmt(y)}" x2="${fmt(it.w + 40)}" y2="${fmt(y)}" stroke="${color}" stroke-width="${fmt(Math.max(it.h * 0.05, 26))}" stroke-linecap="round"/>`;
}

/** Highlight background (box): a translucent rounded rect behind the term's box. */
function boxRect(it: { minY: number; w: number; h: number }, color: string): string {
  const pad = Math.max(it.h * 0.08, 60);
  return `<rect x="${fmt(-pad)}" y="${fmt(it.minY - pad)}" width="${fmt(it.w + 2 * pad)}" height="${fmt(it.h + 2 * pad)}" rx="${fmt(pad)}" fill="${color}" fill-opacity="0.16"/>`;
}

/** Render each term + baseline/equals-sign aligned layout; produces a packed SVG + structured parts. */
function packRows(
  tex2svg: Tex2Svg,
  rows: PartSpec[][],
  inkDefault: string,
  opts: PackRowsOptions = {},
): PackedFormulaState | null {
  const rendered: RenderedPart[][] = [];
  let maxPartH = 0;
  for (const row of rows) {
    const rr: RenderedPart[] = [];
    for (const spec of row) {
      const ink = spec.color ? resolveTone(spec.color, 'default') : inkDefault;
      const svg = renderFormulaWith(tex2svg, spec.tex, ink);
      const root = parseSvgRoot(svg);
      if (!root) continue;
      rr.push({ spec, inner: root.inner, minY: root.vby, w: root.vbw, h: root.vbh });
      maxPartH = Math.max(maxPartH, root.vbh);
    }
    rendered.push(rr);
  }
  if (!rendered.some((r) => r.length)) return null;

  const LINE = (maxPartH || 1000) * LINE_FACTOR;
  const align = opts.align ?? 'left';
  const widths = rendered.map(rowWidth);
  const maxRowW = Math.max(...widths, 1);
  const eqXs = rendered.map(rowEqualX);
  const maxEqX = Math.max(0, ...eqXs.filter((x): x is number => x != null));
  const partsOut: GlobalPart[] = [];
  let groups = '';
  let minY = Infinity;
  let maxY = -Infinity;
  let totalW = 0;

  rendered.forEach((row, r) => {
    const yBase = r * LINE;
    const rowW = widths[r] ?? 0;
    const eqX = eqXs[r];
    const rowOffset = align === 'center'
      ? Math.max(0, (maxRowW - rowW) / 2)
      : align === '=' && eqX != null
        ? Math.max(0, maxEqX - eqX)
        : 0;
    let penX = rowOffset;
    row.forEach((it, c) => {
      const prefix = `f${r}_${c}`;
      const inner = namespaceIds(it.inner, prefix);
      const box = it.spec.box ? boxRect(it, resolveTone(typeof it.spec.box === 'string' ? it.spec.box : 'accent', 'accent')) : '';
      const strike = it.spec.cancel ? strikeLine(it, resolveTone('negative', 'negative')) : '';
      groups += `<g transform="translate(${fmt(penX)},${fmt(yBase)})">${box}${inner}${strike}</g>`;
      partsOut.push({
        key: it.spec.key ?? '',
        tex: it.spec.tex,
        x: penX, y: yBase, w: it.w, minY: it.minY, h: it.h,
        cancel: !!it.spec.cancel,
        box: it.spec.box ? (typeof it.spec.box === 'string' ? it.spec.box : 'accent') : '',
        svg: inner,
      });
      minY = Math.min(minY, yBase + it.minY);
      maxY = Math.max(maxY, yBase + it.minY + it.h);
      penX += it.w + GAP;
    });
    totalW = Math.max(totalW, Math.max(penX - GAP, rowOffset + rowW, 0));
  });

  const vbH = maxY - minY;
  const packed = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 ${fmt(minY)} ${fmt(totalW)} ${fmt(vbH)}">${groups}</svg>`;
  return { svg: packed, vbw: totalW, vbh: vbH, parts: partsOut };
}

/** Render each term + baseline-aligned layout; produces a packed SVG + structured _parts. */
function packParts(tex2svg: Tex2Svg, rows: PartSpec[][], inkDefault: string): BakedResult | null {
  const packed = packRows(tex2svg, rows, inkDefault, { align: 'left' });
  return packed ? { svg: packed.svg, vbw: packed.vbw, vbh: packed.vbh, params: { _parts: packed.parts } } : null;
}

/** Normalize a spec to PartSpec[][] (multi-line). String items = unkeyed sub-expressions. */
export function normalizeRows(spec: unknown): PartSpec[][] {
  const part = (x: unknown): PartSpec => {
    if (typeof x === 'string') return { tex: x };
    if (x && typeof x === 'object') return x as PartSpec;
    return { tex: String(x ?? '') };
  };
  if (typeof spec === 'string') return [[{ tex: spec }]];
  if (Array.isArray(spec)) {
    if (spec.length > 0 && Array.isArray(spec[0])) {
      return (spec as unknown[][]).map((row) => row.map(part));
    }
    return [(spec as unknown[]).map(part)];
  }
  if (spec && typeof spec === 'object' && 'tex' in spec) return [[part(spec)]];
  return [[{ tex: String(spec ?? '') }]];
}

export function isDerivationSpec(spec: unknown): spec is DerivationSpec {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as { kind?: unknown; steps?: unknown };
  return (s.kind === 'derivation' || s.kind === 'derive') && Array.isArray(s.steps);
}

/** Metrics of one row of rendered terms: width + left-edge x of the equals sign (null if none). */
function rowMetrics(rr: RenderedPart[]): { width: number; eqX: number | null } {
  let pen = 0;
  let eqX: number | null = null;
  for (const it of rr) {
    if (eqX === null && (it.spec.tex === '=' || it.spec.tex === '\\=')) eqX = pen;
    pen += it.w + GAP;
  }
  return { width: Math.max(0, pen - GAP), eqX };
}

/** Render each term of a row (measure + namespace ids); rowTag keeps glyph ids globally unique and stable across states. */
function measureRow(tex2svg: Tex2Svg, parts: PartSpec[], ink: string, rowTag: string): RenderedPart[] {
  const rr: RenderedPart[] = [];
  let col = 0;
  for (const spec of parts) {
    const color = spec.color ? resolveTone(spec.color, 'default') : ink;
    const svg = renderFormulaWith(tex2svg, spec.tex, color);
    const root = parseSvgRoot(svg);
    if (root) rr.push({ spec, inner: namespaceIds(root.inner, `${rowTag}_${col}`), minY: root.vby, w: root.vbw, h: root.vbh });
    col += 1;
  }
  return rr;
}

/** Place a row's terms in global coordinates (yBase + in-row penX), returning GlobalPart[]. keyFor decides the match key for morph/stack. */
function placeRow(rr: RenderedPart[], yBase: number, xOffset: number, keyFor: (col: number, spec: PartSpec) => string): GlobalPart[] {
  const out: GlobalPart[] = [];
  let penX = xOffset;
  rr.forEach((it, col) => {
    out.push({
      key: keyFor(col, it.spec),
      tex: it.spec.tex,
      x: penX, y: yBase, w: it.w, minY: it.minY, h: it.h,
      cancel: !!it.spec.cancel,
      box: it.spec.box ? (typeof it.spec.box === 'string' ? it.spec.box : 'accent') : '',
      svg: it.inner,
    });
    penX += it.w + GAP;
  });
  return out;
}

/** Static positioned group for one term (including box background / cancel strike). */
function gpartGroup(p: GlobalPart): string {
  const box = p.box ? boxRect(p, resolveTone(p.box, 'accent')) : '';
  const strike = p.cancel ? strikeLine(p, resolveTone('negative', 'negative')) : '';
  return `<g transform="translate(${fmt(p.x)},${fmt(p.y)})">${box}${p.svg}${strike}</g>`;
}

/** True bounding box of a term including decorations (box padding / strike overhang). */
function gpartBounds(p: GlobalPart): { x0: number; y0: number; x1: number; y1: number } {
  const pad = p.box ? Math.max(p.h * 0.08, 60) : 0;
  const ext = Math.max(pad, p.cancel ? 40 : 0);
  return {
    x0: p.x - ext,
    x1: p.x + p.w + ext,
    y0: p.y + p.minY - pad,
    y1: p.y + p.minY + p.h + pad,
  };
}

function unionViewBox(parts: GlobalPart[], entering: ReadonlySet<GlobalPart> = new Set()): ViewBox {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of parts) {
    const b = gpartBounds(p);
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    // While entering, y = final y + (1 - ease) * rise, ease∈[0,1].
    // The fixed frame includes the full motion envelope; otherwise a new line would be clipped at the bottom while visible but not yet settled.
    y1 = Math.max(y1, b.y1 + (entering.has(p) ? formulaEnterRise(p.h) : 0));
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 1, h: 1 };
  const m = 40; // uniform margin so decorations don't touch the edge
  return { x: x0 - m, y: y0 - m, w: (x1 - x0) + 2 * m, h: (y1 - y0) + 2 * m };
}

function stateSvg(parts: GlobalPart[], vb: ViewBox): string {
  const body = parts.map(gpartGroup).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${fmt(vb.x)} ${fmt(vb.y)} ${fmt(vb.w)} ${fmt(vb.h)}">${body}</svg>`;
}

/**
 * Dynamic derivation layout. Key idea: **one global coordinate system**.
 * Every term of every step is measured and positioned at once in the same coordinate system
 * (equals signs aligned globally, line numbers increasing globally), then one **global
 * viewBox** covering all states is computed. The component then renders every frame with the
 * same viewBox:
 *   · coordinates of lines/terms already shown stay constant → old content stays **perfectly
 *     still** when new lines are added (eliminating stutter and sudden jumps);
 *   · new lines only fade in and rise; matched terms only slide smoothly.
 */
function packDerivation(tex2svg: Tex2Svg, spec: DerivationSpec, inkDefault: string): BakedResult | null {
  const layout = spec.layout ?? 'morph';
  const align = spec.align ?? '=';
  const ink = spec.ink ? resolveTone(spec.ink, 'default') : inkDefault;
  const steps = spec.steps.map(normalizeRows);
  if (!steps.length) return null;

  // ① Render and measure every step and every row.
  const measured: Array<Array<{ rr: RenderedPart[]; width: number; eqX: number | null }>> = [];
  let maxPartH = 0;
  for (let s = 0; s < steps.length; s += 1) {
    const rowsM: Array<{ rr: RenderedPart[]; width: number; eqX: number | null }> = [];
    for (let r = 0; r < steps[s]!.length; r += 1) {
      const rr = measureRow(tex2svg, steps[s]![r]!, ink, `s${s}r${r}`);
      for (const it of rr) maxPartH = Math.max(maxPartH, it.h);
      rowsM.push({ rr, ...rowMetrics(rr) });
    }
    measured.push(rowsM);
  }
  if (!maxPartH) return null;

  // ② Global alignment reference (equals-sign x / row width), so every row lands on the same anchor whenever it appears.
  let maxEqX = 0; let maxRowW = 1;
  for (const st of measured) for (const row of st) {
    if (row.eqX != null) maxEqX = Math.max(maxEqX, row.eqX);
    maxRowW = Math.max(maxRowW, row.width);
  }
  const offsetFor = (row: { width: number; eqX: number | null }): number =>
    align === 'center' ? Math.max(0, (maxRowW - row.width) / 2)
      : align === '=' && row.eqX != null ? Math.max(0, maxEqX - row.eqX)
        : 0;

  const states: PackedFormulaState[] = [];

  if (layout === 'stack') {
    const LINE = maxPartH * STACK_LINE_FACTOR;
    const globalRows: Array<{ parts: GlobalPart[]; stepIndex: number }> = [];
    let gi = 0;
    for (let s = 0; s < measured.length; s += 1) {
      for (const row of measured[s]!) {
        const idx = gi;
        const parts = placeRow(row.rr, idx * LINE, offsetFor(row),
          (col, ps) => (ps.key ? `r${idx}:${ps.key}` : `r${idx}c${col}`));
        globalRows.push({ parts, stepIndex: s });
        gi += 1;
      }
    }
    const vb = unionViewBox(
      globalRows.flatMap((g) => g.parts),
      new Set(globalRows.filter((g) => g.stepIndex > 0).flatMap((g) => g.parts)),
    );
    for (let k = 0; k < measured.length; k += 1) {
      const parts = globalRows.filter((g) => g.stepIndex <= k).flatMap((g) => g.parts);
      states.push({ svg: stateSvg(parts, vb), vbw: vb.w, vbh: vb.h, parts });
    }
    return finalizeDerivation(states, vb);
  }

  // morph: each step is its own line (multi-line steps stack within it); same key / same operator match across steps and slide.
  const LINE = maxPartH * LINE_FACTOR;
  const stepParts: GlobalPart[][] = measured.map((st) => {
    const parts: GlobalPart[] = [];
    st.forEach((row, r) => {
      parts.push(...placeRow(row.rr, r * LINE, offsetFor(row), (_col, ps) => ps.key ?? ''));
    });
    return parts;
  });
  const vb = unionViewBox(stepParts.flat());
  for (const parts of stepParts) states.push({ svg: stateSvg(parts, vb), vbw: vb.w, vbh: vb.h, parts });
  return finalizeDerivation(states, vb);
}

function finalizeDerivation(states: PackedFormulaState[], vb: ViewBox): BakedResult | null {
  const first = states[0];
  if (!first) return null;
  return { svg: first.svg, vbw: vb.w, vbh: vb.h, params: { _states: states, _statesVB: vb } };
}

/**
 * One spec → renderable result. The three forms branch here; failure returns null (the host
 * falls back to a placeholder box).
 *
 * Synchronous: the caller must already have a loaded MathJax (`loadMathjax()` / `mathjaxSync()`).
 */
export function compileFormula(tex2svg: Tex2Svg, spec: unknown, ink: string): BakedResult | null {
  if (isDerivationSpec(spec)) return packDerivation(tex2svg, spec, ink);
  if (Array.isArray(spec)) return packParts(tex2svg, normalizeRows(spec), ink);
  return baked(renderFormulaWith(tex2svg, String(spec ?? ''), ink));
}
