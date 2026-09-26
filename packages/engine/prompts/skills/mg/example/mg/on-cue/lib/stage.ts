import type { CSSProperties } from 'react';

/**
 * The stage as a place, in world pixels.
 *
 * Stage coordinates: `sx` runs −1 (stage right, viewer's left) to 1; `sz` runs 0 at the apron edge
 * (downstage) to 1 at the cyclorama (upstage). The floor is projected with real perspective, so equal
 * steps upstage compress toward the back, and a prop's scale follows its depth.
 */
export const FLOOR = {
  frontY: 985, backY: 590,
  frontHalf: 940, backHalf: 560,
  centreX: 960,
} as const;

/** The proscenium opening the audience looks through. */
export const ARCH = { left: 150, right: 1770, top: 92, bottom: 985 } as const;

/** Fly bars: the audience sees two working battens above the border. */
export const BATTENS = [172, 262] as const;

const Z0 = 5.2, ZSPAN = 9.5;
const persp = (sz: number): number => {
  const near = 1 / Z0, far = 1 / (Z0 + ZSPAN);
  return (1 / (Z0 + sz * ZSPAN) - far) / (near - far); // 1 at the front, 0 at the back
};

export interface FloorPoint { x: number; y: number; scale: number; sz: number; sx: number }

export function floor(sx: number, sz: number): FloorPoint {
  const p = persp(Math.min(1, Math.max(0, sz)));
  const half = FLOOR.backHalf + (FLOOR.frontHalf - FLOOR.backHalf) * p;
  return {
    x: FLOOR.centreX + sx * half,
    y: FLOOR.backY + (FLOOR.frontY - FLOOR.backY) * p,
    scale: half / FLOOR.frontHalf,
    sz, sx,
  };
}

/** Screen y → stage depth, for drawing planks and pools that lie on the floor. */
export function depthAtY(y: number): number {
  const p = (y - FLOOR.backY) / (FLOOR.frontY - FLOOR.backY);
  const inv = p * (1 / Z0 - 1 / (Z0 + ZSPAN)) + 1 / (Z0 + ZSPAN);
  return Math.min(1, Math.max(0, (1 / inv - Z0) / ZSPAN));
}

/** The floor's horizontal half-width at a screen y. */
export function halfAtY(y: number): number {
  return FLOOR.backHalf + (FLOOR.frontHalf - FLOOR.backHalf) * persp(depthAtY(y));
}

/** Style helper: bottom-centre anchor a prop of `w`×`h` world px at a floor point, scaled by depth. */
export function standAt(p: FloorPoint, w: number, h: number, extra = ''): CSSProperties {
  return {
    position: 'absolute', left: p.x - w / 2, top: p.y - h, width: w, height: h,
    transformOrigin: '50% 100%',
    transform: `scale(${p.scale})${extra ? ' ' + extra : ''}`,
  };
}

/**
 * Lay a `w`×`h` element flat on the boards. The element's top edge becomes the upstage edge at
 * `szBack`, its bottom edge the downstage edge at `szFront`, between stage x `sx0` and `sx1`.
 * A homography maps the four corners onto the projected floor, so paper, chalk and pins drawn
 * inside the element in plain 2D sit in the same perspective as the planks.
 */
export function lieOnFloor(w: number, h: number, sx0: number, sx1: number, szBack: number, szFront: number): CSSProperties {
  const q = [floor(sx0, szBack), floor(sx1, szBack), floor(sx1, szFront), floor(sx0, szFront)];
  // Unit square → quad (Heckbert), then pre-scaled by w, h.
  const dx1 = q[1]!.x - q[2]!.x, dx2 = q[3]!.x - q[2]!.x, dx3 = q[0]!.x - q[1]!.x + q[2]!.x - q[3]!.x;
  const dy1 = q[1]!.y - q[2]!.y, dy2 = q[3]!.y - q[2]!.y, dy3 = q[0]!.y - q[1]!.y + q[2]!.y - q[3]!.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det;
  const a = q[1]!.x - q[0]!.x + g * q[1]!.x, b = q[3]!.x - q[0]!.x + hh * q[3]!.x, c = q[0]!.x;
  const d = q[1]!.y - q[0]!.y + g * q[1]!.y, e = q[3]!.y - q[0]!.y + hh * q[3]!.y, f = q[0]!.y;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
  return { position: 'absolute', left: 0, top: 0, width: w, height: h, transformOrigin: '0 0', transform: `matrix3d(${m.map((v) => v.toFixed(6)).join(',')})` };
}
