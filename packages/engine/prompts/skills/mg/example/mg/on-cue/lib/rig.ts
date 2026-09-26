import { ARCH, BATTENS, FLOOR, depthAtY, floor, halfAtY } from './stage';
import { clamp01, hash, lerp, noise1, noise2 } from './noise';
import { beam, dust, glow, grain, hexToRgb, mixRgb, mottle, pool, rgb, type RGB } from './paint';
import { lens, type Shot } from './camera';
import { gel, ink } from '../theme';

/**
 * The lighting rig is the scene's material. The world is dark until a lamp points at something;
 * a lamp is a fixture position, an aim point on the floor, a pool radius, a gel and an intensity.
 * Scenes tween these numbers; the three canvases repaint from them on every frame.
 */
export interface Lamp {
  id: string;
  x: number; y: number;
  tx: number; ty: number;
  radius: number;
  r: number; g: number; b: number;
  on: number;
  /** How much haze the beam shows: 1 = full cone, 0 = pool only (a lamp out of frame). */
  cone: number;
  /** 0 = steady; > 0 = a nervous filament (the ghost light). */
  flicker: number;
  seed: number;
}

export interface Rig {
  /** Scrim darkness in a blackout, 0..1. */
  dark: number;
  /** Work lights: lift the whole house, warm and flat. */
  work: number;
  /** House lights on the audience side: also warms the proscenium. */
  house: number;
  /** Cyclorama gel and intensity. */
  cycR: number; cycG: number; cycB: number; cycOn: number;
  /** Footlights along the apron. */
  foot: number;
  haze: number;
  lamps: Lamp[];
}

export function lamp(id: string, x: number, y: number, tx: number, ty: number, radius: number, colour: RGB, on = 0, cone = 1, seed = 1): Lamp {
  return { id, x, y, tx, ty, radius, r: colour[0], g: colour[1], b: colour[2], on, cone, flicker: 0, seed };
}

export function defaultRig(lamps: Lamp[] = []): Rig {
  return { dark: 0.9, work: 0, house: 0, cycR: gel.amber[0], cycG: gel.amber[1], cycB: gel.amber[2], cycOn: 0, foot: 0, haze: 1, lamps };
}

export const setGel = (target: { r: number; g: number; b: number } | Rig, colour: RGB) =>
  'cycR' in target ? { cycR: colour[0], cycG: colour[1], cycB: colour[2] } : { r: colour[0], g: colour[1], b: colour[2] };

const OAK = hexToRgb(ink.oak), OAK_HI = hexToRgb(ink.oakHi), OAK_LO = hexToRgb(ink.oakLo);
const VELVET = hexToRgb(ink.velvet), VELVET_HI = hexToRgb(ink.velvetHi), VELVET_LO = hexToRgb(ink.velvetLo);
const BRASS = hexToRgb(ink.brass), BRASS_HI = hexToRgb(ink.brassHi), BRASS_LO = hexToRgb(ink.brassLo);
const HOUSE = hexToRgb(ink.house), DEEP = hexToRgb(ink.houseDeep);

const lampColour = (l: Lamp): RGB => [l.r, l.g, l.b];
const lampLevel = (l: Lamp, t: number): number =>
  l.on * (l.flicker > 0 ? 1 - l.flicker * (0.5 + 0.5 * Math.pow(noise1(t * 7.3, l.seed), 3)) : 1);

/* ─────────────────────────── back canvas: the house ─────────────────────────── */

/** The planked floor, drawn in world space every frame so it stays crisp when the lens pushes in. */
function paintFloor(g: CanvasRenderingContext2D): void {
  const top = FLOOR.backY, bottom = 1080;
  // Base wood, darker upstage.
  const base = g.createLinearGradient(0, top, 0, FLOOR.frontY);
  base.addColorStop(0, rgb(mixRgb(OAK_LO, OAK, 0.35)));
  base.addColorStop(1, rgb(OAK));
  g.fillStyle = base;
  g.fillRect(0, top, 1920, bottom - top);
  // Planks converge on the vanishing point: boundaries are straight lines from front x to back x.
  const count = 22;
  const edgeAtFront = (i: number) => FLOOR.centreX + (i / count * 2 - 1) * FLOOR.frontHalf * 1.35;
  const edgeAt = (i: number, y: number) => FLOOR.centreX + (edgeAtFront(i) - FLOOR.centreX) * (halfAtY(y) / FLOOR.frontHalf);
  for (let i = 0; i < count; i++) {
    const tone = hash(i * 3.7) - 0.5;
    g.beginPath();
    g.moveTo(edgeAt(i, top), top);
    g.lineTo(edgeAt(i + 1, top), top);
    g.lineTo(edgeAt(i + 1, bottom), bottom);
    g.lineTo(edgeAt(i, bottom), bottom);
    g.closePath();
    g.fillStyle = rgb(mixRgb(OAK, tone > 0 ? OAK_HI : OAK_LO, Math.abs(tone) * 0.55), 0.6);
    g.fill();
    // Grain: a few lines along the plank, faded and slightly wandering.
    for (let k = 0; k < 4; k++) {
      const f = 0.15 + k * 0.22 + hash(i * 9 + k) * 0.1;
      g.beginPath();
      for (let y = top; y <= bottom; y += 12) {
        const x = edgeAt(i, y) + (edgeAt(i + 1, y) - edgeAt(i, y)) * (f + (noise1(y / 90, i * 7 + k) - 0.5) * 0.08);
        y === top ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = rgb(OAK_LO, 0.16 + hash(i + k * 2) * 0.16);
      g.lineWidth = 0.8 + hash(k + i) * 1.2;
      g.stroke();
    }
    // Plank joints staggered in depth.
    const joints = 2 + Math.floor(hash(i * 1.3) * 2);
    for (let j = 0; j < joints; j++) {
      const y = top + 30 + hash(i * 5 + j * 11) * (bottom - top - 60);
      g.beginPath();
      g.moveTo(edgeAt(i, y), y);
      g.lineTo(edgeAt(i + 1, y), y);
      g.strokeStyle = rgb(OAK_LO, 0.55);
      g.lineWidth = 1.2;
      g.stroke();
    }
    // Board edge.
    g.beginPath();
    g.moveTo(edgeAt(i, top), top);
    g.lineTo(edgeAt(i, bottom), bottom);
    g.strokeStyle = rgb(OAK_LO, 0.5);
    g.lineWidth = 1;
    g.stroke();
  }
  // Wear: a soft mottle across the boards.
  mottle(g, 0, top, 1920, bottom - top, 24, OAK_LO, OAK_HI, 0.1, 3, 0.6, 1.4);
  // The apron's front face below the stage edge.
  const face = g.createLinearGradient(0, FLOOR.frontY, 0, 1080);
  face.addColorStop(0, rgb(mixRgb(OAK_LO, DEEP, 0.3)));
  face.addColorStop(1, rgb(DEEP));
  g.fillStyle = face;
  g.fillRect(0, FLOOR.frontY, 1920, 1080 - FLOOR.frontY);
  g.fillStyle = rgb(BRASS_LO, 0.9);
  g.fillRect(0, FLOOR.frontY - 3, 1920, 4);
  g.fillStyle = rgb(BRASS_HI, 0.55);
  g.fillRect(0, FLOOR.frontY - 3, 1920, 1);
}

function velvetPanel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, folds: number, seed: number, lift: number): void {
  const fold = w / folds;
  for (let i = 0; i < folds; i++) {
    const g = c.createLinearGradient(x + i * fold, 0, x + (i + 1) * fold, 0);
    const deep = mixRgb(VELVET_LO, VELVET, lift * 0.35);
    const hi = mixRgb(VELVET, VELVET_HI, 0.35 + lift * 0.6);
    const shift = hash(i + seed) * 0.25;
    g.addColorStop(0, rgb(deep));
    g.addColorStop(0.3 + shift, rgb(hi));
    g.addColorStop(0.55 + shift * 0.5, rgb(mixRgb(VELVET, VELVET_HI, 0.1 + lift * 0.3)));
    g.addColorStop(1, rgb(deep));
    c.fillStyle = g;
    c.fillRect(x + i * fold, y, fold + 0.6, h);
  }
  // Nap: fine vertical fabric noise.
  mottle(c, x, y, w, h, 6, VELVET_LO, VELVET_HI, 0.12, seed, 3, 0.2);
}

export function paintHouse(c: CanvasRenderingContext2D, rig: Rig, shot: Shot, t: number): void {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = ink.houseDeep;
  c.fillRect(0, 0, 1920, 1080);
  lens(c, shot);
  const lift = clamp01(rig.work * 0.9 + rig.house * 0.5);

  // Cyclorama: a cloth that takes whatever colour is thrown at it.
  const cyc: RGB = [rig.cycR, rig.cycG, rig.cycB];
  const cycTop = ARCH.top - 60, cycBottom = FLOOR.backY + 2;
  const wash = c.createLinearGradient(0, cycTop, 0, cycBottom);
  const cycA = clamp01(rig.cycOn);
  wash.addColorStop(0, rgb(mixRgb(HOUSE, cyc, cycA * 0.22 + lift * 0.1)));
  wash.addColorStop(0.62, rgb(mixRgb(HOUSE, cyc, cycA * 0.5 + lift * 0.12)));
  wash.addColorStop(1, rgb(mixRgb(HOUSE, cyc, cycA * 0.78 + lift * 0.15)));
  c.fillStyle = wash;
  c.fillRect(ARCH.left - 200, cycTop, ARCH.right - ARCH.left + 400, cycBottom - cycTop);
  mottle(c, ARCH.left - 200, cycTop, ARCH.right - ARCH.left + 400, cycBottom - cycTop, 18, DEEP, cyc, 0.05 + cycA * 0.06, 11, 0.9, 0.9);

  // Floor.
  paintFloor(c);
  // Work light flattens the floor a little; blackout deepens the upstage.
  const depthShade = c.createLinearGradient(0, FLOOR.backY, 0, FLOOR.frontY);
  depthShade.addColorStop(0, rgb(DEEP, 0.55 - lift * 0.4));
  depthShade.addColorStop(1, rgb(DEEP, 0.05));
  c.fillStyle = depthShade;
  c.fillRect(0, FLOOR.backY, 1920, FLOOR.frontY - FLOOR.backY);

  // Battens: two pipes the audience can see, with their hanging clamps.
  for (const y of BATTENS) {
    c.fillStyle = rgb(hexToRgb(ink.metal));
    c.fillRect(ARCH.left - 80, y - 5, ARCH.right - ARCH.left + 160, 10);
    c.fillStyle = rgb(hexToRgb(ink.metalHi), 0.5 + lift * 0.4);
    c.fillRect(ARCH.left - 80, y - 5, ARCH.right - ARCH.left + 160, 2);
    for (let x = ARCH.left - 40; x < ARCH.right + 40; x += 160) {
      c.fillStyle = rgb(DEEP, 0.9);
      c.fillRect(x - 2, 0, 4, y - 5);
    }
  }
}

/** Where the legs hang: anything in the world outside these x's is in the wings and out of sight. */
export const LEGS = { left: ARCH.left + 150, right: ARCH.right - 150 } as const;

/**
 * Everything downstage of the acting area: legs, border, proscenium, footlights. Painted on the
 * scrim canvas, above the DOM world, so a desk in the prompt corner is really half behind the leg,
 * a stagehand can exit into the wing, and a lantern's clamp is hidden by the border, the way a house
 * is built. `darkness` is the blackout the rest of the scrim carries; the front takes the same.
 */
export function paintFront(c: CanvasRenderingContext2D, rig: Rig, darkness: number): void {
  const lift = clamp01(rig.work * 0.9 + rig.house * 0.5);
  // Legs (side curtains) and the border above the opening.
  velvetPanel(c, ARCH.left - 20, ARCH.top - 20, LEGS.left - ARCH.left + 20, FLOOR.frontY - ARCH.top + 20, 5, 1, lift);
  velvetPanel(c, LEGS.right, ARCH.top - 20, ARCH.right - LEGS.right + 20, FLOOR.frontY - ARCH.top + 20, 5, 7, lift);
  c.save();
  const borderH = 96;
  const bg = c.createLinearGradient(0, ARCH.top - 30, 0, ARCH.top + borderH);
  bg.addColorStop(0, rgb(mixRgb(VELVET_LO, VELVET, lift * 0.3)));
  bg.addColorStop(0.7, rgb(mixRgb(VELVET, VELVET_HI, 0.2 + lift * 0.5)));
  bg.addColorStop(1, rgb(mixRgb(VELVET_LO, VELVET, 0.2)));
  c.fillStyle = bg;
  c.fillRect(ARCH.left - 40, ARCH.top - 30, ARCH.right - ARCH.left + 80, borderH + 30);
  // Scallops with brass fringe.
  for (let x = ARCH.left - 40; x < ARCH.right + 40; x += 64) {
    c.beginPath();
    c.arc(x + 32, ARCH.top + borderH, 32, 0, Math.PI);
    c.fillStyle = rgb(mixRgb(VELVET, VELVET_HI, 0.25 + lift * 0.4));
    c.fill();
    c.strokeStyle = rgb(mixRgb(BRASS_LO, BRASS_HI, 0.3 + lift * 0.5), 0.9);
    c.lineWidth = 3;
    c.stroke();
  }
  c.restore();

  // Proscenium: the frame around the opening. Dark moulding with a brass fillet.
  c.fillStyle = rgb(DEEP);
  c.fillRect(-400, -400, ARCH.left + 400, 1480);
  c.fillRect(ARCH.right, -400, 800, 1480);
  c.fillRect(-400, -400, 2720, ARCH.top + 400 - 40);
  const mould = c.createLinearGradient(ARCH.left - 60, 0, ARCH.left, 0);
  mould.addColorStop(0, rgb(mixRgb(DEEP, HOUSE, 0.5)));
  mould.addColorStop(1, rgb(mixRgb(HOUSE, BRASS_LO, 0.25 + lift * 0.5)));
  c.fillStyle = mould;
  c.fillRect(ARCH.left - 60, ARCH.top - 100, 60, FLOOR.frontY - ARCH.top + 100);
  const mouldR = c.createLinearGradient(ARCH.right, 0, ARCH.right + 60, 0);
  mouldR.addColorStop(0, rgb(mixRgb(HOUSE, BRASS_LO, 0.25 + lift * 0.5)));
  mouldR.addColorStop(1, rgb(mixRgb(DEEP, HOUSE, 0.5)));
  c.fillStyle = mouldR;
  c.fillRect(ARCH.right, ARCH.top - 100, 60, FLOOR.frontY - ARCH.top + 100);
  const mouldT = c.createLinearGradient(0, ARCH.top - 100, 0, ARCH.top - 40);
  mouldT.addColorStop(0, rgb(mixRgb(DEEP, HOUSE, 0.5)));
  mouldT.addColorStop(1, rgb(mixRgb(HOUSE, BRASS_LO, 0.25 + lift * 0.5)));
  c.fillStyle = mouldT;
  c.fillRect(ARCH.left - 60, ARCH.top - 100, ARCH.right - ARCH.left + 120, 60);
  c.strokeStyle = rgb(mixRgb(BRASS_LO, BRASS_HI, 0.25 + lift * 0.6), 0.85);
  c.lineWidth = 3;
  c.strokeRect(ARCH.left - 8, ARCH.top - 48, ARCH.right - ARCH.left + 16, FLOOR.frontY - ARCH.top + 60);
  c.strokeStyle = rgb(BRASS_LO, 0.6);
  c.lineWidth = 1;
  c.strokeRect(ARCH.left - 22, ARCH.top - 62, ARCH.right - ARCH.left + 44, FLOOR.frontY - ARCH.top + 80);

  // Footlights: small hooded lamps along the apron.
  for (let i = 0; i < 13; i++) {
    const x = 240 + i * 120;
    c.fillStyle = rgb(hexToRgb(ink.metal));
    c.beginPath();
    c.moveTo(x - 22, FLOOR.frontY + 2);
    c.lineTo(x + 22, FLOOR.frontY + 2);
    c.lineTo(x + 16, FLOOR.frontY - 16);
    c.lineTo(x - 16, FLOOR.frontY - 16);
    c.closePath();
    c.fill();
    c.fillStyle = rgb(mixRgb(BRASS_LO, gel.straw, rig.foot * 0.9), 0.95);
    c.fillRect(x - 12, FLOOR.frontY - 12, 24, 8);
  }
  // The same blackout the scrim carries, laid once over what the front owns: proscenium, border, legs.
  if (darkness > 0.002) {
    const borderBottom = ARCH.top + borderH + 32;
    c.fillStyle = `rgba(4,3,6,${darkness})`;
    c.fillRect(-400, -400, ARCH.left + 400, 1480);
    c.fillRect(ARCH.right, -400, 800, 1480);
    c.fillRect(ARCH.left, -400, ARCH.right - ARCH.left, borderBottom + 400);
    c.fillRect(ARCH.left, borderBottom, LEGS.left - ARCH.left, FLOOR.frontY - borderBottom);
    c.fillRect(LEGS.right, borderBottom, ARCH.right - LEGS.right, FLOOR.frontY - borderBottom);
  }
}

/* ─────────────────────────── scrim canvas: darkness the lamps cut through ─────────────────────────── */

export function paintScrim(c: CanvasRenderingContext2D, rig: Rig, shot: Shot, t: number): void {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, 1920, 1080);
  const darkness = clamp01(rig.dark * (1 - clamp01(rig.work) * 0.92 - clamp01(rig.house) * 0.35));
  c.fillStyle = `rgba(4,3,6,${darkness})`;
  c.fillRect(0, 0, 1920, 1080);
  lens(c, shot);
  c.globalCompositeOperation = 'destination-out';
  // The cyc is lit by its own lamps.
  if (rig.cycOn > 0) {
    const g = c.createLinearGradient(0, ARCH.top - 60, 0, FLOOR.backY + 40);
    g.addColorStop(0, `rgba(0,0,0,${clamp01(rig.cycOn) * 0.45})`);
    g.addColorStop(0.7, `rgba(0,0,0,${clamp01(rig.cycOn) * 0.85})`);
    g.addColorStop(1, `rgba(0,0,0,0)`);
    c.fillStyle = g;
    c.fillRect(ARCH.left - 60, ARCH.top - 60, ARCH.right - ARCH.left + 120, FLOOR.backY - ARCH.top + 100);
  }
  // Footlights lift the downstage floor and whatever stands on it.
  if (rig.foot > 0) {
    const g = c.createLinearGradient(0, FLOOR.frontY - 40, 0, FLOOR.backY);
    g.addColorStop(0, `rgba(0,0,0,${clamp01(rig.foot) * 0.75})`);
    g.addColorStop(1, `rgba(0,0,0,0)`);
    c.fillStyle = g;
    c.fillRect(ARCH.left - 100, ARCH.top, ARCH.right - ARCH.left + 200, FLOOR.frontY - ARCH.top);
  }
  for (const l of rig.lamps) {
    const level = lampLevel(l, t);
    if (level <= 0.002) continue;
    // A pool on the floor, plus a taller reveal above it so a prop standing in the pool is lit too.
    c.save();
    c.translate(l.tx, l.ty);
    c.scale(1, 0.42);
    const g = c.createRadialGradient(0, 0, l.radius * 0.1, 0, 0, l.radius);
    g.addColorStop(0, `rgba(0,0,0,${level})`);
    g.addColorStop(0.6, `rgba(0,0,0,${level * 0.7})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, l.radius, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.save();
    c.translate(l.tx, l.ty - l.radius * 0.55);
    c.scale(0.72, 1);
    const up = c.createRadialGradient(0, 0, l.radius * 0.1, 0, 0, l.radius * 1.05);
    up.addColorStop(0, `rgba(0,0,0,${level * 0.92})`);
    up.addColorStop(0.55, `rgba(0,0,0,${level * 0.5})`);
    up.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = up;
    c.beginPath();
    c.arc(0, 0, l.radius * 1.05, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.globalCompositeOperation = 'source-over';
  // The house's front, above the world: what stands in the wings is really out of sight.
  paintFront(c, rig, darkness);
  // Lens: vignette and grain live on the frame, not in the world.
  c.setTransform(1, 0, 0, 1, 0, 0);
  const v = c.createRadialGradient(960, 540, 420, 960, 540, 1180);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, 1920, 1080);
  grain(c, 0.16);
}

/* ─────────────────────────── glow canvas: beams, haze, bulbs ─────────────────────────── */

export function paintGlow(c: CanvasRenderingContext2D, rig: Rig, shot: Shot, t: number): void {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, 1920, 1080);
  lens(c, shot);
  c.globalCompositeOperation = 'lighter';
  const cyc: RGB = [rig.cycR, rig.cycG, rig.cycB];
  if (rig.cycOn > 0) {
    const g = c.createLinearGradient(0, ARCH.top, 0, FLOOR.backY);
    g.addColorStop(0, rgb(cyc, 0));
    g.addColorStop(1, rgb(cyc, clamp01(rig.cycOn) * 0.16));
    c.fillStyle = g;
    c.fillRect(ARCH.left, ARCH.top, ARCH.right - ARCH.left, FLOOR.backY - ARCH.top);
    // Bounce off the upstage floor.
    const b = c.createLinearGradient(0, FLOOR.backY, 0, FLOOR.backY + 160);
    b.addColorStop(0, rgb(cyc, clamp01(rig.cycOn) * 0.14));
    b.addColorStop(1, rgb(cyc, 0));
    c.fillStyle = b;
    c.fillRect(ARCH.left, FLOOR.backY, ARCH.right - ARCH.left, 160);
  }
  if (rig.foot > 0) {
    for (let i = 0; i < 13; i++) {
      const x = 240 + i * 120;
      glow(c, x, FLOOR.frontY - 8, 60, gel.straw, rig.foot * 0.35);
    }
    const g = c.createLinearGradient(0, FLOOR.frontY, 0, FLOOR.backY + 80);
    g.addColorStop(0, rgb(gel.straw, rig.foot * 0.12));
    g.addColorStop(1, rgb(gel.straw, 0));
    c.fillStyle = g;
    c.fillRect(ARCH.left, FLOOR.backY + 80, ARCH.right - ARCH.left, FLOOR.frontY - FLOOR.backY - 80);
  }
  if (rig.work > 0) {
    c.fillStyle = rgb(gel.work, rig.work * 0.05);
    c.fillRect(-200, -200, 2320, 1480);
  }
  for (const l of rig.lamps) {
    const level = lampLevel(l, t);
    if (level <= 0.002) continue;
    const colour = lampColour(l);
    beam(c, l.x, l.y, l.tx, l.ty, l.radius, colour, level * l.cone * rig.haze, t, l.seed);
    dust(c, l.x, l.y, l.tx, l.ty, l.radius, [255, 245, 225], level * l.cone * rig.haze * 0.9, t, l.seed);
    pool(c, l.tx, l.ty, l.radius, 0.42, colour, level * 0.42);
    glow(c, l.x, l.y, 34, colour, level * l.cone * 0.9);
    glow(c, l.x, l.y, 9, [255, 255, 245], level * l.cone);
  }
  c.globalCompositeOperation = 'source-over';
}

/** A lamp aimed at a stage point from a batten directly above it, the way a spot is hung. */
export function hang(id: string, batten: number, sx: number, sz: number, radius: number, colour: RGB, on = 0, dx = 0): Lamp {
  const target = floor(sx, sz);
  return lamp(id, target.x + dx, batten, target.x, target.y, radius * target.scale, colour, on, 1, id.length + Math.round(sx * 10));
}

export { depthAtY, noise2 };
