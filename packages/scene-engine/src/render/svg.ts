/**
 * SVG frame rendering: FrameState -> a complete SVG string.
 * Shared by the player (React) and headless export; deterministic.
 */
import type { FrameState } from '../compile/interpolate';
import { SAFE_RECT, STAGE_H, STAGE_W } from '../core/types';
import { COLOR, FAMILY, currentTheme, type DecorLayer } from '../core/tokens';
import type { Registry } from '../core/registry';
import { renderTextualInBox } from './textual-fit';
import { resolveContentDebugRect } from './content-rect';
import { fmtScaleDown } from '../kit';

export interface RenderOptions {
  /** Show the safe-area dashed outline (debug) */
  debugSafeArea?: boolean;
  /** Debug: draw a bbox + id label for every element */
  debugBoxes?: boolean;
}

/**
 * Clamp a debug label's anchor into the visible stage so boxes at the edge/bleed (margin:0) don't clip the text.
 * A monospace glyph is about 0.6 x font size wide; text is baseline-aligned by default, so leave extra room for glyph height vertically.
 */
function clampLabel(x: number, y: number, text: string, fontSize: number): [number, number] {
  const estW = text.length * fontSize * 0.6;
  const cx = Math.max(4, Math.min(x, STAGE_W - estW - 4));
  const cy = Math.max(fontSize, Math.min(y, STAGE_H - 4));
  return [cx, cy];
}

export function renderFrameSvg(frame: FrameState, registry: Registry, options: RenderOptions = {}): string {
  const cam = frame.camera;
  const viewW = STAGE_W / cam.zoom;
  const viewH = STAGE_H / cam.zoom;
  const viewX = cam.cx - viewW / 2;
  const viewY = cam.cy - viewH / 2;

  let body = '';
  if (options.debugSafeArea) {
    body += `<rect x="${SAFE_RECT.x}" y="${SAFE_RECT.y}" width="${SAFE_RECT.w}" height="${SAFE_RECT.h}" fill="none" stroke="#e8eaf0" stroke-dasharray="10 8"/>`;
  }

  if (options.debugBoxes && frame.layoutSlots?.length) {
    for (const slot of frame.layoutSlots) {
      const { x, y, w, h } = slot.rect;
      // Draw the layout box name in the box's top-left corner, clamped into the stage so edge/bleed boxes don't clip it
      const [lx, ly] = clampLabel(x + 12, y + 28, slot.name, 22);
      body +=
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="10 7" opacity="0.55"/>`
        + `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="22" fill="#3b82f6" font-family="monospace" font-weight="700" opacity="0.9">${slot.name}</text>`;
    }
    // Label the layout name once, in the stage's bottom-left corner, instead of repeating it per slot/box
    const tpl = frame.layoutTemplate ?? '';
    if (tpl) {
      body += `<text x="${(SAFE_RECT.x).toFixed(1)}" y="${(STAGE_H - 28).toFixed(1)}" font-size="26" fill="#3b82f6" font-family="monospace" font-weight="700" opacity="0.9">layout: ${tpl}</text>`;
    }
  }

  for (const { id, props } of frame.elements) {
    const def = registry.component(props.component, props.sourcePackage);
    if (!def) continue;
    const [iw, ih] = def.intrinsic(props.params);
    const x = props.cx - props.w / 2;
    const y = props.cy - props.h / 2;
    // "Content layer" scaling: the layout box (props.w/h/cx/cy) stays fixed; scale only scales the content, around scaleAt (element-local 0..1).
    // Content-layer transforms such as gsap go through this path, so neighbors / the parent box layout don't shift at all.
    const k = props.scale;
    const r = props.rotation ?? 0;
    const [ax, ay] = props.scaleAt ?? [0.5, 0.5];
    const ox = ax * props.w;
    const oy = ay * props.h;
    const contentXform = k === 1 && r === 0
      ? ''
      : ` translate(${ox.toFixed(1)},${oy.toFixed(1)}) rotate(${r.toFixed(3)}) scale(${k.toFixed(4)}) translate(${(-ox).toFixed(1)},${(-oy).toFixed(1)})`;
    let inner: string;
    if (def.fill) {
      // Fill components (backgrounds/panels): render at the layout box's w x h directly so they fill it exactly, without locking the intrinsic aspect ratio
      inner = def.render(props.params, props.w, props.h);
    } else if (def.textual) {
      inner = renderTextualInBox(def, props.params, props.w, props.h);
    } else {
      // Hard rule: an element never overflows its layout box (only the layout's w/h count; scale is handled by the outer layer).
      // Round the scale down before centering; rounding to nearest could push content outside the box, breaking the rule.
      const sStr = fmtScaleDown(Math.min(props.w / iw, props.h / ih));
      const s = Number(sStr);
      const tx = (props.w - iw * s) / 2;
      const ty = (props.h - ih * s) / 2;
      inner = `<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${sStr})">${def.render(props.params, iw, ih)}</g>`;
    }
    body += `<g opacity="${props.opacity.toFixed(3)}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})${contentXform}">${inner}</g>`;
    if (options.debugBoxes) {
      const bx = props.cx - props.w / 2;
      const by = props.cy - props.h / 2;
      const boxTag = `${id} box ${Math.round(props.w)}×${Math.round(props.h)}`;
      const wantInside = by - 8 < 16;
      const [lx, ly] = clampLabel(bx, wantInside ? by + 22 : by - 8, boxTag, 20);
      body +=
        `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${props.w.toFixed(1)}" height="${props.h.toFixed(1)}" fill="none" stroke="#e8590c" stroke-width="2" stroke-dasharray="6 5" opacity="${(props.opacity * 0.85).toFixed(2)}"/>`
        + `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="20" fill="#e8590c" font-family="monospace" opacity="${props.opacity.toFixed(2)}">${boxTag}</text>`;
      const [cx, cy, cw, ch] = resolveContentDebugRect(def, props.params, props.w, props.h);
      const contentTag = `${id} obj ${Math.round(cw)}×${Math.round(ch)}`;
      const cbx = bx + cx;
      const cby = by + cy;
      const wantContentInside = cby - 8 < 16;
      const [clx, cly] = clampLabel(cbx, wantContentInside ? cby + 22 : cby - 8, contentTag, 18);
      body +=
        `<rect x="${cbx.toFixed(1)}" y="${cby.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-dasharray="4 4" opacity="${(props.opacity * 0.9).toFixed(2)}"/>`
        + `<text x="${clx.toFixed(1)}" y="${cly.toFixed(1)}" font-size="18" fill="#22c55e" font-family="monospace" opacity="${props.opacity.toFixed(2)}">${contentTag}</text>`;
    }
  }

  // Draw the background as a rect rather than a style attribute, so a host (player) injecting style can't create a duplicate attribute that knocks out the background
  const theme = currentTheme();
  const kind = frame.pageKind ?? 'content';
  // Per-page-kind background override: cover/section can have their own background (a string for a flat color or [start, end] for a gradient)
  const bgOverride = kind !== 'content' ? theme.bgByPage?.[kind] : undefined;
  const grad = Array.isArray(bgOverride) ? bgOverride : bgOverride ? undefined : theme.bgGradient;
  const flat = typeof bgOverride === 'string' ? bgOverride : COLOR.bg;
  let defs = grad
    ? `<linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${grad[0]}"/><stop offset="1" stop-color="${grad[1]}"/></linearGradient>`
    : '';
  const bgRect = `<rect x="${viewX.toFixed(1)}" y="${viewY.toFixed(1)}" width="${viewW.toFixed(1)}" height="${viewH.toFixed(1)}" fill="${grad ? 'url(#bgGrad)' : flat}"/>`;
  // Per-page-kind decor: decorByPage.<kind> wins; otherwise fall back to the film-wide decor
  const layers = theme.decorByPage?.[kind] ?? theme.decor;
  const decor = renderDecor(layers, viewX, viewY, viewW, viewH);
  defs += decor.defs;
  const chrome = renderChrome(frame, viewX, viewY, viewW, viewH);
  const defsTag = defs ? `<defs>${defs}</defs>` : '';
  return `<svg viewBox="${viewX.toFixed(1)} ${viewY.toFixed(1)} ${viewW.toFixed(1)} ${viewH.toFixed(1)}" xmlns="http://www.w3.org/2000/svg">${defsTag}${bgRect}${decor.body}${body}${chrome}</svg>`;
}

/**
 * Slide chrome: kicker (top-left, the current beat title in small caps) / page number (bottom-right) / footer (bottom-left, film title).
 * The theme's chrome switches decide which are drawn; they sit above content but hug the edges at low contrast, like master elements in a PPT template.
 *
 * renderChromeSvg is exported publicly: the dev page's config dialog renders chrome samples with the same code, so "field -> visual" never drifts.
 */
export function renderChromeSvg(
  ctx: { filmTitle: string; shotTitle: string; shotNo: number; shotCount: number },
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const conf = currentTheme().chrome;
  if (!conf) return '';
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const pad = Math.min(w, h) * 0.045;
  const fs = 24;
  const font = `font-size="${fs}" font-family="${FAMILY.label}" font-weight="700" letter-spacing="4"`;
  let out = '';
  if (conf.kicker && ctx.shotTitle) {
    // kicker: a short accent-color bar + the beat title (like a magazine section label)
    const ky = y + pad + fs * 0.5;
    out +=
      `<rect x="${(x + pad).toFixed(1)}" y="${(ky - fs * 0.38).toFixed(1)}" width="10" height="${(fs * 0.82).toFixed(1)}" fill="${COLOR.accent}"/>`
      + `<text x="${(x + pad + 24).toFixed(1)}" y="${ky.toFixed(1)}" ${font} fill="${COLOR.ink}" opacity="0.75" dominant-baseline="central">${esc(ctx.shotTitle.toUpperCase())}</text>`;
  }
  if (conf.pageNo && ctx.shotCount > 1) {
    const label = `${String(ctx.shotNo).padStart(2, '0')} / ${String(ctx.shotCount).padStart(2, '0')}`;
    out += `<text x="${(x + w - pad).toFixed(1)}" y="${(y + h - pad + fs * 0.2).toFixed(1)}" ${font} fill="${COLOR.muted}" opacity="0.8" text-anchor="end">${label}</text>`;
  }
  if (conf.footer && ctx.filmTitle) {
    out += `<text x="${(x + pad).toFixed(1)}" y="${(y + h - pad + fs * 0.2).toFixed(1)}" ${font} fill="${COLOR.muted}" opacity="0.7">${esc(ctx.filmTitle.toUpperCase())}</text>`;
  }
  return out;
}

function renderChrome(frame: FrameState, x: number, y: number, w: number, h: number): string {
  const ctx = frame.chrome;
  if (!ctx) return '';
  return renderChromeSvg(ctx, x, y, w, h);
}

/**
 * Background decor layers (a PPT-template feel): drawn above the background color and below content, following the camera frame (like a slide border).
 * Vocabulary: see tokens.DecorLayer. Low-opacity overlays that don't compete with content for attention; deterministic, no randomness.
 *
 * Exported publicly: the dev page's config dialog renders decor previews with the same code, so "source field -> visual" never drifts.
 */
export function renderDecorSvg(
  layers: DecorLayer[] | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): { defs: string; body: string } {
  return renderDecor(layers, x, y, w, h);
}

function renderDecor(
  layers: DecorLayer[] | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): { defs: string; body: string } {
  if (!layers?.length) return { defs: '', body: '' };
  const f = (n: number) => n.toFixed(1);
  const full = `x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"`;
  let defs = '';
  let body = '';

  layers.forEach((l, i) => {
    const id = `dc${i}`;
    switch (l.kind) {
      case 'glow': {
        const op = l.opacity ?? 0.14;
        const r = l.r ?? 0.45;
        defs += `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${l.color}" stop-opacity="${op}"/><stop offset="1" stop-color="${l.color}" stop-opacity="0"/></radialGradient>`;
        body += `<ellipse cx="${f(x + w * l.at[0])}" cy="${f(y + h * l.at[1])}" rx="${f(w * r)}" ry="${f(h * r * 1.15)}" fill="url(#${id})"/>`;
        break;
      }
      case 'dots': {
        const gap = l.gap ?? 56;
        defs += `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="${l.color}" opacity="${l.opacity ?? 0.05}"/></pattern>`;
        body += `<rect ${full} fill="url(#${id})"/>`;
        break;
      }
      case 'grid': {
        const gap = l.gap ?? 64;
        defs += `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse"><path d="M ${gap} 0 H 0 V ${gap}" fill="none" stroke="${l.color}" stroke-width="1" opacity="${l.opacity ?? 0.07}"/></pattern>`;
        body += `<rect ${full} fill="url(#${id})"/>`;
        break;
      }
      case 'frame': {
        const m = Math.min(w, h) * 0.024;
        body += `<rect x="${f(x + m)}" y="${f(y + m)}" width="${f(w - 2 * m)}" height="${f(h - 2 * m)}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 2}" opacity="${l.opacity ?? 1}"/>`;
        break;
      }
      case 'corners': {
        const m = Math.min(w, h) * 0.024;
        const cl = l.len ?? Math.min(w, h) * 0.06;
        const sw = l.width ?? 5;
        const fx = x + m;
        const fy = y + m;
        const fw = w - 2 * m;
        const fh = h - 2 * m;
        body +=
          `<path d="M ${f(fx)} ${f(fy + cl)} V ${f(fy)} H ${f(fx + cl)}" fill="none" stroke="${l.color}" stroke-width="${sw}"/>` +
          `<path d="M ${f(fx + fw - cl)} ${f(fy + fh)} H ${f(fx + fw)} V ${f(fy + fh - cl)}" fill="none" stroke="${l.color}" stroke-width="${sw}"/>`;
        break;
      }
      case 'band': {
        const s = l.size ?? 4;
        const op = l.opacity ?? 0.8;
        if (l.edge === 'top') body += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${s}" fill="${l.color}" opacity="${op}"/>`;
        else if (l.edge === 'bottom') body += `<rect x="${f(x)}" y="${f(y + h - s)}" width="${f(w)}" height="${s}" fill="${l.color}" opacity="${op}"/>`;
        else if (l.edge === 'left') body += `<rect x="${f(x)}" y="${f(y)}" width="${s}" height="${f(h)}" fill="${l.color}" opacity="${op}"/>`;
        else body += `<rect x="${f(x + w - s)}" y="${f(y)}" width="${s}" height="${f(h)}" fill="${l.color}" opacity="${op}"/>`;
        break;
      }
      case 'vignette': {
        defs += `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.72"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${l.opacity ?? 0.4}"/></radialGradient>`;
        body += `<rect ${full} fill="url(#${id})"/>`;
        break;
      }
      case 'blob': {
        const cx = x + w * l.at[0];
        const cy = y + h * l.at[1];
        const rr = Math.min(w, h) * l.r;
        const sq = l.squish ?? 1;
        body += l.stroke
          ? `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rr)}" ry="${f(rr * sq)}" fill="none" stroke="${l.color}" stroke-width="3" opacity="${l.opacity ?? 0.9}"/>`
          : `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rr)}" ry="${f(rr * sq)}" fill="${l.color}" opacity="${l.opacity ?? 1}"/>`;
        break;
      }
      case 'arc': {
        const cx = x + w * l.at[0];
        const cy = y + h * l.at[1];
        const rr = Math.min(w, h) * l.r;
        body += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rr)}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 2.5}" opacity="${l.opacity ?? 0.5}"/>`;
        break;
      }
      case 'dotcol': {
        const n = l.n ?? 9;
        const gap = h * 0.045;
        const cx = x + w - Math.min(w, h) * 0.035;
        const y0 = y + h / 2 - ((n - 1) / 2) * gap;
        for (let i = 0; i < n; i++) {
          const active = i === Math.floor(n / 3);
          body += `<circle cx="${f(cx)}" cy="${f(y0 + i * gap)}" r="${active ? 9 : 6.5}" fill="${active ? (l.activeColor ?? l.color) : l.color}" opacity="${active ? 0.95 : (l.opacity ?? 0.35)}"/>`;
        }
        break;
      }
      case 'wedge': {
        const d = l.depth;
        const sk = l.skew ?? 0.12;
        let pts = '';
        if (l.edge === 'bottom') pts = `${f(x)},${f(y + h)} ${f(x + w)},${f(y + h)} ${f(x + w)},${f(y + h - h * d)} ${f(x)},${f(y + h - h * (d + sk))}`;
        else if (l.edge === 'top') pts = `${f(x)},${f(y)} ${f(x + w)},${f(y)} ${f(x + w)},${f(y + h * (d + sk))} ${f(x)},${f(y + h * d)}`;
        else if (l.edge === 'left') pts = `${f(x)},${f(y)} ${f(x)},${f(y + h)} ${f(x + w * (d + sk))},${f(y + h)} ${f(x + w * d)},${f(y)}`;
        else pts = `${f(x + w)},${f(y)} ${f(x + w)},${f(y + h)} ${f(x + w - w * (d + sk))},${f(y + h)} ${f(x + w - w * d)},${f(y)}`;
        body += `<polygon points="${pts}" fill="${l.color}" opacity="${l.opacity ?? 1}"/>`;
        break;
      }
      case 'ripple-corner': {
        const cx = x + w * l.at[0];
        const cy = y + h * l.at[1];
        const n = l.n ?? 5;
        const gap = l.gap ?? Math.min(w, h) * 0.045;
        for (let i = 1; i <= n; i++) {
          body += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(i * gap)}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 3}" opacity="${l.opacity ?? 0.5}"/>`;
        }
        break;
      }
      case 'plus': {
        const n = l.n ?? 3;
        const gap = l.gap ?? Math.min(w, h) * 0.055;
        const s = l.size ?? 9;
        const cx0 = x + w * l.at[0];
        const cy0 = y + h * l.at[1];
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            const px = cx0 + c * gap;
            const py = cy0 + r * gap;
            body += `<path d="M ${f(px - s)} ${f(py)} H ${f(px + s)} M ${f(px)} ${f(py - s)} V ${f(py + s)}" stroke="${l.color}" stroke-width="3" opacity="${l.opacity ?? 0.5}"/>`;
          }
        }
        break;
      }
      case 'wave': {
        const amp = (l.amp ?? 0.025) * h;
        const freq = l.freq ?? 3;
        const off = (l.offset ?? 0.06) * h;
        const baseY = l.edge === 'top' ? y + off : y + h - off;
        const seg = w / (freq * 2);
        let d = `M ${f(x)} ${f(baseY)}`;
        for (let i = 0; i < freq * 2; i++) {
          const sx = x + i * seg;
          const dir = i % 2 === 0 ? -1 : 1;
          d += ` Q ${f(sx + seg / 2)} ${f(baseY + dir * amp * 2)} ${f(sx + seg)} ${f(baseY)}`;
        }
        const close = l.edge === 'top'
          ? ` L ${f(x + w)} ${f(y)} L ${f(x)} ${f(y)} Z`
          : ` L ${f(x + w)} ${f(y + h)} L ${f(x)} ${f(y + h)} Z`;
        body += `<path d="${d}${close}" fill="${l.color}" opacity="${l.opacity ?? 0.14}"/>`;
        break;
      }
      case 'rays': {
        const cx = x + w * l.at[0];
        const cy = y + h * l.at[1];
        const n = l.n ?? 14;
        const rr = (l.r ?? 1.2) * Math.max(w, h);
        const sw = l.width ?? 3;
        let d = '';
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          d += `M ${f(cx + Math.cos(a) * rr * 0.12)} ${f(cy + Math.sin(a) * rr * 0.12)} L ${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)} `;
        }
        body += `<path d="${d}" stroke="${l.color}" stroke-width="${sw}" opacity="${l.opacity ?? 0.18}"/>`;
        break;
      }
      case 'mountains': {
        const peaks = l.peaks ?? 4;
        const mh = (l.height ?? 0.16) * h;
        const baseY = y + h;
        const seg = w / peaks;
        let pts = `${f(x)},${f(baseY)}`;
        for (let i = 0; i < peaks; i++) {
          // Deterministic ups and downs: odd/even peak heights alternate, first and last slightly lower
          const pk = mh * (i % 2 === 0 ? 1 : 0.62) * (i === 0 || i === peaks - 1 ? 0.8 : 1);
          pts += ` ${f(x + seg * (i + 0.5))},${f(baseY - pk)} ${f(x + seg * (i + 1))},${f(baseY - mh * 0.18)}`;
        }
        pts += ` ${f(x + w)},${f(baseY)}`;
        body += `<polygon points="${pts}" fill="${l.color}" opacity="${l.opacity ?? 0.12}"/>`;
        break;
      }
      case 'stars': {
        const n = l.n ?? 24;
        const seed = l.seed ?? 7;
        const op = l.opacity ?? 0.5;
        for (let i = 0; i < n; i++) {
          // Golden-angle scatter (deterministic "randomness")
          const t = (i * 0.618 + seed * 0.137) % 1;
          const u = ((i * 0.382 + seed * 0.291) % 1);
          const px = x + w * t;
          const py = y + h * u;
          const s = 7 + ((i * 7 + seed) % 5) * 3;
          if (i % 3 === 0) {
            body += `<path d="M ${f(px)} ${f(py - s)} L ${f(px + s * 0.3)} ${f(py - s * 0.3)} L ${f(px + s)} ${f(py)} L ${f(px + s * 0.3)} ${f(py + s * 0.3)} L ${f(px)} ${f(py + s)} L ${f(px - s * 0.3)} ${f(py + s * 0.3)} L ${f(px - s)} ${f(py)} L ${f(px - s * 0.3)} ${f(py - s * 0.3)} Z" fill="${l.color}" opacity="${(op * (0.5 + (i % 4) * 0.16)).toFixed(2)}"/>`;
          } else {
            body += `<circle cx="${f(px)}" cy="${f(py)}" r="${(s * 0.4).toFixed(1)}" fill="${l.color}" opacity="${(op * (0.35 + (i % 5) * 0.13)).toFixed(2)}"/>`;
          }
        }
        break;
      }
      case 'scallop': {
        const rr = (l.r ?? 0.035) * Math.min(w, h);
        const n = Math.ceil(w / (rr * 2));
        const baseY = l.edge === 'top' ? y : y + h;
        const sweep = l.edge === 'top' ? 0 : 1;
        let d = `M ${f(x)} ${f(baseY)}`;
        for (let i = 0; i < n; i++) {
          d += ` A ${f(rr)} ${f(rr)} 0 0 ${sweep} ${f(x + (i + 1) * rr * 2)} ${f(baseY)}`;
        }
        body += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="2.5" opacity="${l.opacity ?? 0.4}"/>`;
        break;
      }
      case 'stripes': {
        const gap = l.gap ?? 18;
        const sw = l.width ?? 5;
        const ang = l.angle ?? 45;
        defs += `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})"><rect width="${sw}" height="${gap}" fill="${l.color}" opacity="${l.opacity ?? 0.12}"/></pattern>`;
        if (l.corner) {
          const cs = (l.size ?? 0.3) * Math.min(w, h);
          let pts = '';
          if (l.corner === 'tl') pts = `${f(x)},${f(y)} ${f(x + cs)},${f(y)} ${f(x)},${f(y + cs)}`;
          else if (l.corner === 'tr') pts = `${f(x + w)},${f(y)} ${f(x + w - cs)},${f(y)} ${f(x + w)},${f(y + cs)}`;
          else if (l.corner === 'bl') pts = `${f(x)},${f(y + h)} ${f(x + cs)},${f(y + h)} ${f(x)},${f(y + h - cs)}`;
          else pts = `${f(x + w)},${f(y + h)} ${f(x + w - cs)},${f(y + h)} ${f(x + w)},${f(y + h - cs)}`;
          body += `<polygon points="${pts}" fill="url(#${id})"/>`;
        } else {
          body += `<rect ${full} fill="url(#${id})"/>`;
        }
        break;
      }
      case 'squiggle': {
        const cx = x + w * l.at[0];
        const cy = y + h * l.at[1];
        const len = (l.len ?? 0.12) * w;
        const amp = l.amp ?? 16;
        const n = l.n ?? 4;
        const seg = len / n;
        let d = `M ${f(cx - len / 2)} ${f(cy)}`;
        for (let i = 0; i < n; i++) {
          const dir = i % 2 === 0 ? -1 : 1;
          d += ` Q ${f(cx - len / 2 + seg * (i + 0.5))} ${f(cy + dir * amp * 2)} ${f(cx - len / 2 + seg * (i + 1))} ${f(cy)}`;
        }
        body += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 6}" stroke-linecap="round" opacity="${l.opacity ?? 0.6}"/>`;
        break;
      }
      case 'confetti': {
        const n = l.n ?? 18;
        const seed = l.seed ?? 3;
        const op = l.opacity ?? 0.5;
        for (let i = 0; i < n; i++) {
          const t = (i * 0.618 + seed * 0.173) % 1;
          const u = (i * 0.414 + seed * 0.319) % 1;
          const px = x + w * t;
          const py = y + h * u;
          const c = l.colors[i % l.colors.length]!;
          const s = 14 + ((i * 3 + seed) % 6) * 3;
          const rot = ((i * 47 + seed * 13) % 90) - 45;
          const shape = i % 3;
          const o = (op * (0.5 + (i % 3) * 0.2)).toFixed(2);
          if (shape === 0) body += `<rect x="${f(px - s / 2)}" y="${f(py - s / 2)}" width="${f(s)}" height="${f(s)}" fill="${c}" opacity="${o}" transform="rotate(${rot} ${f(px)} ${f(py)})"/>`;
          else if (shape === 1) body += `<circle cx="${f(px)}" cy="${f(py)}" r="${f(s * 0.45)}" fill="${c}" opacity="${o}"/>`;
          else body += `<polygon points="${f(px)},${f(py - s * 0.6)} ${f(px + s * 0.55)},${f(py + s * 0.4)} ${f(px - s * 0.55)},${f(py + s * 0.4)}" fill="${c}" opacity="${o}" transform="rotate(${rot} ${f(px)} ${f(py)})"/>`;
        }
        break;
      }
      case 'segments': {
        // Edge-hugging band split into equal multi-color segments
        const size = l.size ?? 14;
        const n = l.colors.length || 1;
        const segW = w / n;
        const sy = l.edge === 'top' ? y : y + h - size;
        l.colors.forEach((c, i) => {
          body += `<rect x="${f(x + i * segW)}" y="${f(sy)}" width="${f(segW + 1)}" height="${f(size)}" fill="${c}" opacity="${l.opacity ?? 1}"/>`;
        });
        break;
      }
      case 'ribbon': {
        // Large ribbon arc: cubic Bezier (default control points interpolate the endpoints, giving a smooth sweeping arc)
        const p0 = [x + l.from[0] * w, y + l.from[1] * h];
        const p3 = [x + l.to[0] * w, y + l.to[1] * h];
        const c1 = l.ctrl ? [x + l.ctrl[0] * w, y + l.ctrl[1] * h] : [p0[0]! * 0.4 + p3[0]! * 0.6, p0[1]!];
        const c2 = l.ctrl2 ? [x + l.ctrl2[0] * w, y + l.ctrl2[1] * h] : [p3[0]! * 0.4 + p0[0]! * 0.6, p3[1]!];
        body += `<path d="M ${f(p0[0]!)} ${f(p0[1]!)} C ${f(c1[0]!)} ${f(c1[1]!)}, ${f(c2[0]!)} ${f(c2[1]!)}, ${f(p3[0]!)} ${f(p3[1]!)}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 4}" opacity="${l.opacity ?? 1}"/>`;
        break;
      }
      case 'illustration': {
        // Arbitrary SVG illustration as a fill element: a nested <svg> keeps the original's own viewBox, and the outer one sets the placement rect.
        // The inner SVG's viewBox is preserved (it comes with the original svg string); the outer one controls shape via x/y/width/height + preserveAspectRatio.
        const ax = l.at?.[0] ?? 0;
        const ay = l.at?.[1] ?? 0;
        const sw = l.size?.[0] ?? 1;
        const sh = l.size?.[1] ?? 1;
        const px = x + ax * w;
        const py = y + ay * h;
        const pw = sw * w;
        const ph = sh * h;
        const align = l.align ?? 'xMidYMid meet';
        const op = l.opacity ?? 1;
        // Extract the viewBox and inner content of the inner <svg ...>...</svg>; if it isn't valid svg, put it into a <g> as-is (best-effort tolerance)
        const m = /<svg\b[^>]*?\bviewBox\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/svg>/i.exec(l.svg);
        if (m) {
          body += `<svg x="${f(px)}" y="${f(py)}" width="${f(pw)}" height="${f(ph)}" viewBox="${m[1]}" preserveAspectRatio="${align}" opacity="${op}">${m[2]}</svg>`;
        } else {
          // Not an <svg> container (inline markup given directly, e.g. <g>...</g>): place and scale it with a transform
          body += `<g opacity="${op}" transform="translate(${f(px)} ${f(py)}) scale(${f(pw / Math.max(w, 1))} ${f(ph / Math.max(h, 1))})">${l.svg}</g>`;
        }
        break;
      }
    }
  });
  return { defs, body };
}
