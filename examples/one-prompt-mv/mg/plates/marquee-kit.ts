// Geometry, the static engraving atlas and the lamp layouts for plate `marquee`.
// World space: logical px at zoom 1, y DOWN, the letter board centred on (0, 0). At the hand-off frame
// the camera shows the world at zoom 1 with the board's centre on screen (960, 500): SCREEN_H8.
import * as THREE from 'three';
import { F, font, layout, measure } from '../px/type';
import { rgba } from '../px/palette';
import { clamp, lerp, smoothstep, TAU } from '../px/util';
import { font as font3d } from '../type3d';

export const G = {
  BOARD: { hw: 500, hh: 210 },
  FACE: { hw: 760, hh: 380 }, // the engraved canopy face (the banknote)
  CANOPY: { hw: 790, hh: 410 }, // face + the chase-lamp strip
  STRIP: { hw: 775, hh: 395 }, // lamp centreline of the strip
  SIGN: { cy: -620, hw: 740, hh: 180 }, // the TONIGHT! sign panel
  SIGN_LAMPS: { hw: 720, hh: 160 },
  PLINTH: { y0: -440, y1: -410, hw: 700 },
  SOFFIT: { y0: 410, y1: 440 },
  DOORS: { y0: 440, y1: 640 },
  KERB: 840,
  VPY: 420, // street vanishing point (eye height)
  ROOF: -1340, // roofline: the top edge of the cornice (H9)
  CORNICE_BOT: -1180,
  PIL: { x: 1250, hw: 50 },
  ROSE: { x: 960, y: -1045, r: 150 }, // facade rosettes (±x)
  MEDAL: { x: 627, r: 72 }, // canopy side medallions (±x, y 0)
  NUM: { x: 627, y: 238 }, // corner numerals (±x, ±y)
  NAME: { y: -975, cap: 150 },
};

/** The static engraving atlas: world rect and px per world unit. */
export const AT = { x0: -1640, y0: -1360, w: 3280, h: 1820, s: 1.5 };

export type RGB = [number, number, number];
export const sc = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mixc = (a: RGB, b: RGB, u: number): RGB => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/** fresh type on the bone board: ember → signal, then it cools to ink (CSS) */
export function hotInk(age: number, a = 1): string {
  const E: RGB = [255, 154, 77], S: RGB = [255, 90, 31], K: RGB = [14, 13, 14];
  const c = age < 0.06 ? mixc(E, S, clamp(age / 0.06)) : mixc(S, K, smoothstep(0.06, 0.36, age));
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
/** fresh mono on ink: ember → signal → bone/ash (CSS) */
export function hotCss(age: number, a = 1, cool = 'bone'): string {
  if (age < 0) return rgba(cool, 0);
  const E: RGB = [255, 154, 77], S: RGB = [255, 90, 31];
  const B: RGB = cool === 'bone' ? [238, 233, 223] : cool === 'ash' ? [156, 151, 143] : [94, 91, 87];
  const c = age < 0.08 ? mixc(E, S, age / 0.08) : mixc(S, B, smoothstep(0.08, 0.36, age));
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

// ---------------------------------------------------------------- camera
export interface Cam { x: number; y: number; z: number; r: number }
export function w2s(c: Cam, x: number, y: number) {
  const dx = x - c.x, dy = y - c.y, cs = Math.cos(c.r), sn = Math.sin(c.r);
  return { x: 960 + c.z * (cs * dx - sn * dy), y: 540 + c.z * (sn * dx + cs * dy) };
}
export function s2w(c: Cam, sx: number, sy: number) {
  const dx = (sx - 960) / c.z, dy = (sy - 540) / c.z, cs = Math.cos(c.r), sn = Math.sin(c.r);
  return { x: c.x + cs * dx + sn * dy, y: c.y - sn * dx + cs * dy };
}
/** put a 2D context in world coordinates for camera c */
export function camTransform(ctx: CanvasRenderingContext2D, c: Cam) {
  const cs = Math.cos(c.r) * c.z, sn = Math.sin(c.r) * c.z;
  ctx.setTransform(cs, sn, -sn, cs, 960 - (cs * c.x - sn * c.y), 540 - (sn * c.x + cs * c.y));
}
export const sdBox = (x: number, y: number, hw: number, hh: number) => {
  const dx = Math.abs(x) - hw, dy = Math.abs(y) - hh;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};

// ---------------------------------------------------------------- lamps
export interface Lamp { x: number; y: number; k: number; d: number }
/** lamps round a rectangle (centre cx, cy), clockwise from the top centre; d = arc distance from there (either way) */
export function rectLamps(cx: number, cy: number, hw: number, hh: number, step: number): Lamp[] {
  const P = 4 * (hw + hh);
  const n = Math.round(P / step);
  const out: Lamp[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i / n) * P; // clockwise from top centre
    const p = rectAt(cx, cy, hw, hh, s);
    out.push({ x: p.x, y: p.y, k: i, d: Math.min(s, P - s) });
  }
  return out;
}
/** point at arc length s clockwise from the top centre of a rectangle */
export function rectAt(cx: number, cy: number, hw: number, hh: number, s: number) {
  const P = 4 * (hw + hh);
  s = ((s % P) + P) % P;
  const e = [hw, 2 * hh, 2 * hw, 2 * hh, hw];
  if (s < e[0]!) return { x: cx + s, y: cy - hh };
  s -= e[0]!;
  if (s < e[1]!) return { x: cx + hw, y: cy - hh + s };
  s -= e[1]!;
  if (s < e[2]!) return { x: cx + hw - s, y: cy + hh };
  s -= e[2]!;
  if (s < e[3]!) return { x: cx - hw, y: cy + hh - s };
  s -= e[3]!;
  return { x: cx - hw + s, y: cy - hh };
}

export interface Bulb { x: number; y: number; li: number }
export interface TonightGeo { bulbs: Bulb[]; faces: { x: number; y: number }[][][]; x0: number; x1: number; cap: number; bang: { x: number; y: number } }
/**
 * TONIGHT! as lamp letters: the Archivo Black outlines (three's typeface) of each glyph placed at the kerned
 * advances of Archivo 900 (Canvas layout), lamps evenly spaced along every contour. World coordinates.
 */
export function tonightGeo(width: number, cy: number, spacing: number): TonightGeo {
  const str = 'TONIGHT!';
  const fam = F.archivo(100, 900);
  const lay100 = layout(str, fam, 100);
  const size = (width / lay100.width) * 100;
  const lay = layout(str, fam, size);
  const f3 = font3d('block');
  const capShapes = f3.generateShapes('H', size);
  let capTop = -Infinity;
  for (const s of capShapes) for (const p of s.getPoints(4)) capTop = Math.max(capTop, p.y);
  const cap = capTop;
  const base = cy + cap / 2;
  const x0 = -lay.width / 2;
  const bulbs: Bulb[] = [];
  const faces: { x: number; y: number }[][][] = [];
  lay.glyphs.forEach((g, li) => {
    const shapes = f3.generateShapes(g.ch, size);
    // centre the typeface glyph in the Canvas glyph's advance
    let bx0 = Infinity, bx1 = -Infinity;
    for (const s of shapes) for (const p of s.getPoints(4)) { bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x); }
    const ox = x0 + g.x + g.w / 2 - (bx0 + bx1) / 2;
    const toW = (p: THREE.Vector2) => ({ x: ox + p.x, y: base - p.y });
    const take = (path: THREE.Path) => {
      const len = path.getLength();
      const n = Math.max(3, Math.round(len / spacing));
      for (let k = 0; k < n; k++) { const p = toW(path.getPointAt(k / n)); bulbs.push({ x: p.x, y: p.y, li }); }
    };
    for (const s of shapes) {
      take(s); s.holes.forEach(take);
      const ex = s.extractPoints(10);
      faces.push([ex.shape.map(toW), ...ex.holes.map((h) => h.map(toW))]);
    }
  });
  const bang = bulbs.filter((b) => b.li === 7);
  const bx = bang.reduce((a, b) => a + b.x, 0) / Math.max(1, bang.length);
  const by = bang.reduce((a, b) => a + b.y, 0) / Math.max(1, bang.length);
  return { bulbs, faces, x0, x1: -x0, cap, bang: { x: bx, y: by } };
}

// ---------------------------------------------------------------- the engraving atlas
/**
 * Static world lettering, one mask per channel (sampled by the engraving shader):
 *   R  fine lettering and microtext (bone hairline ink, lit by the scene's light)
 *   G  banknote display letters, hatched by the shader (THE CARET, the corner numerals)
 *   B  the painted faces of the TONIGHT! lamp letters
 */
export function buildAtlas(tg: TonightGeo, lampCount: number): { tex: THREE.CanvasTexture; roseX: number } {
  const cv = document.createElement('canvas');
  cv.width = Math.round(AT.w * AT.s); cv.height = Math.round(AT.h * AT.s);
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
  c.setTransform(AT.s, 0, 0, AT.s, -AT.x0 * AT.s, -AT.y0 * AT.s);
  c.globalCompositeOperation = 'lighter';
  const R = 'rgb(255,0,0)', Gc = 'rgb(0,255,0)', B = 'rgb(0,0,255)';
  c.textBaseline = 'middle';
  const MICRO = 'ONE PROMPT, ONE FILM TONIGHT! ✦ ';
  const micro = (s: string, n: number) => s.repeat(Math.ceil(n / s.length) + 1);

  /** a line of repeated microtext from (x0,y) to (x1,y), clipped to the span */
  const microLine = (x0: number, x1: number, y: number, size: number, txt = MICRO, fam = F.mono(500)) => {
    c.save();
    c.beginPath(); c.rect(x0, y - size, x1 - x0, size * 2); c.clip();
    c.font = font(fam, size); c.fillStyle = R; c.textAlign = 'left';
    const per = measure(txt, fam, size);
    c.fillText(micro(txt, Math.ceil((x1 - x0) / per) * txt.length + txt.length), x0, y);
    c.restore();
  };
  /** microtext round a rectangle (centre cx, cy, half sizes), reading clockwise */
  const microRect = (cx: number, cy: number, hw: number, hh: number, size: number, txt = MICRO) => {
    const sides: [number, number, number, number][] = [ // x, y, rotation, length
      [cx - hw, cy - hh, 0, 2 * hw], [cx + hw, cy - hh, Math.PI / 2, 2 * hh], [cx + hw, cy + hh, Math.PI, 2 * hw], [cx - hw, cy + hh, -Math.PI / 2, 2 * hh],
    ];
    for (const [x, y, rot, len] of sides) {
      c.save(); c.translate(x, y); c.rotate(rot);
      microLine(size * 0.8, len - size * 0.8, 0, size, txt);
      c.restore();
    }
  };
  /** text round a circle, letters upright on the tangent (clockwise), repeated to fill the ring */
  const ringText = (cx: number, cy: number, r: number, size: number, txt: string, fam = F.mono(500), a0 = -Math.PI / 2) => {
    c.save();
    c.font = font(fam, size); c.fillStyle = R; c.textAlign = 'center';
    const per = measure(txt, fam, size);
    const reps = Math.max(1, Math.floor((TAU * r) / per));
    const full = txt.repeat(reps);
    const lay = layout(full, fam, size);
    const k = (TAU * r) / lay.width;
    for (const g of lay.glyphs) {
      const a = a0 + ((g.x + g.w / 2) * k) / r;
      c.save(); c.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.rotate(a + Math.PI / 2);
      c.fillText(g.ch, 0, 0); c.restore();
    }
    c.restore();
  };
  const text = (s: string, x: number, y: number, size: number, fam: string, col: string, align: CanvasTextAlign = 'center', track = 0) => {
    c.font = font(fam, size); c.fillStyle = col; c.textAlign = align;
    c.letterSpacing = `${track}px`;
    c.fillText(s, x, y);
    c.letterSpacing = '0px';
  };

  const { FACE, BOARD, SIGN, MEDAL, NUM, NAME } = G;
  // ---- the canopy face: the note
  microRect(0, 0, FACE.hw - 40, FACE.hh - 40, 6.2);
  microRect(0, 0, BOARD.hw + 34, BOARD.hh + 34, 5.2);
  // top band: serial (drawn live), the presentation line; bottom band: the legal line
  text('THE ONE PROMPT FILM CO. PRESENTS', 0, -BOARD.hh - 62, 17, F.archivo(125, 700), R, 'center', 5);
  text('THIS NOTE IS LEGAL TENDER FOR ONE (1) SCREENING · ANY SEAT · TONIGHT ONLY', 0, BOARD.hh + 58, 9.5, F.mono(500), R, 'center', 2.2);
  text('PRINTED FROM ONE LINE OF TEXT · NO OTHER INPUT WAS USED', 0, BOARD.hh + 76, 7, F.mono(400), R, 'center', 1.6);
  // side bands: corner numerals (hatched) with PROMPT under them, medallion ring text
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    text('1', sx * NUM.x, sy * NUM.y - 8, 104, F.archivo(100, 900), Gc);
    text('PROMPT', sx * NUM.x, sy * NUM.y + 44, 11, F.mono(600), R, 'center', 4);
  }
  for (const sx of [-1, 1]) {
    ringText(sx * MEDAL.x, 0, MEDAL.r + 9, 5.6, 'ONE PROMPT · ONE FILM · TONIGHT · ');
    text(sx < 0 ? 'SERIES 2026' : 'FIG. 9', sx * MEDAL.x, -MEDAL.r - 30, 8, F.mono(600), R, 'center', 3);
    text('ONE NIGHT', sx * MEDAL.x, MEDAL.r + 30, 8, F.mono(600), R, 'center', 3);
  }
  // the board's own plate (bottom right, printed on the panel: drawn live, it counts letters)

  // ---- the sign: its plinth, the lamp faces
  text(`${lampCount} LAMPS · 40 W · WIRED BY THE CARET · CUE 57`, 0, (G.PLINTH.y0 + G.PLINTH.y1) / 2, 10, F.mono(600), R, 'center', 3);
  microRect(0, SIGN.cy, SIGN.hw - 44, SIGN.hh - 44, 5.2, 'TONIGHT! TONIGHT! TONIGHT! · ');
  c.fillStyle = B;
  for (const poly of tg.faces) {
    c.beginPath();
    for (const ring of poly) { ring.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); }
    c.fill('evenodd');
  }

  // ---- the facade: the house name in banknote letters, flanked by rosettes
  const nameFam = F.archivo(112.5, 900);
  const nameSize = NAME.cap / 0.72;
  const nameW = measure('THE CARET', nameFam, nameSize, 14);
  c.textBaseline = 'alphabetic';
  text('THE CARET', 0, NAME.y, nameSize, nameFam, Gc, 'center', 14);
  text('PICTURE PALACE  ·  EST. 2026  ·  1,000 SEATS  ·  ONE SCREEN', 0, NAME.y + 50, 20, F.mono(600), R, 'center', 7);
  text('ALL IT TAKES IS ONE LINE', 0, NAME.y - NAME.cap - 34, 13, F.mono(500), R, 'center', 9);
  c.textBaseline = 'middle';
  const roseX = Math.max(G.ROSE.x, nameW / 2 + G.ROSE.r + 70);
  for (const sx of [-1, 1]) ringText(sx * roseX, G.ROSE.y, G.ROSE.r + 13, 7, 'THE CARET · PICTURE PALACE · ONE PROMPT · ONE FILM · ');
  // the frieze under the cornice: microtext, the whole width
  microLine(AT.x0, AT.x0 + AT.w, G.CORNICE_BOT + 9, 6.5);
  microLine(AT.x0, AT.x0 + AT.w, G.CORNICE_BOT - 3, 5, 'SERIES 2026 · ONE PROMPT FILM CO. · ');

  // ---- street level: the box office and the poster cases
  text('BOX OFFICE', 0, G.DOORS.y0 + 30, 15, F.archivo(125, 700), R, 'center', 5);
  text('ADMIT ONE (1) PROMPT', 0, G.DOORS.y0 + 52, 8, F.mono(600), R, 'center', 2.5);
  for (const sx of [-1, 1]) {
    const px = sx * 650, py = 540;
    text('NOW SHOWING', px, py - 70, 10, F.mono(600), R, 'center', 3);
    text(sx < 0 ? 'ONE' : 'ONE', px, py - 34, 34, F.archivo(75, 900), R, 'center', 2);
    text(sx < 0 ? 'PROMPT' : 'FILM', px, py + 2, 34, F.archivo(75, 900), R, 'center', 2);
    text(sx < 0 ? 'RATED G · GENERATED' : 'RUNNING TIME: YES', px, py + 36, 7, F.mono(500), R, 'center', 1.5);
    text(sx < 0 ? 'FROM ONE LINE OF TEXT' : 'NO SEQUELS REQUIRED', px, py + 50, 7, F.mono(500), R, 'center', 1.5);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, roseX };
}
