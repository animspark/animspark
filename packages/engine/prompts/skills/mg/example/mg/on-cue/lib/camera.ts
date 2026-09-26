import type { gsap } from 'gsap';

/** GSAP's timeline and tween-vars types, however the workspace's gsap types declare them. */
export type Timeline = ReturnType<typeof gsap.timeline>;
export type TweenVars = Record<string, unknown>;

/** What the lens looks at: the world point at the centre of the frame, its zoom and roll (degrees). */
export interface Shot {
  x: number;
  y: number;
  zoom: number;
  roll: number;
}

export const FRAME = { w: 1920, h: 1080 } as const;
export const WIDE: Shot = { x: 960, y: 540, zoom: 1, roll: 0 };

/** Place the 1920×1080 DOM world so that `shot` sits in the middle of the frame. */
export function aim(world: HTMLElement | null, shot: Shot): void {
  if (!world) return;
  world.style.transform =
    `translate(960px, 540px) rotate(${shot.roll}deg) scale(${shot.zoom}) translate(${-shot.x}px, ${-shot.y}px)`;
}

/** The same lens for a canvas painting in frame space: draw in world coordinates afterwards, crisp at any zoom. */
export function lens(ctx: CanvasRenderingContext2D, shot: Shot): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(960, 540);
  ctx.rotate((shot.roll * Math.PI) / 180);
  ctx.scale(shot.zoom, shot.zoom);
  ctx.translate(-shot.x, -shot.y);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The shot that frames a world rectangle: centred on it, zoomed so the rectangle spans `share`
 * of the frame on whichever axis binds. A stop that comes from the thing it looks at cannot cut
 * that thing at the frame edge; a stop typed as guessed numbers often does. On Cue's stops were
 * derived by hand from object coordinates (02-script's page, 07-track's card) and checked frame
 * by frame with `anim look --at`; `framing` is the shortcut to the same result.
 */
export function framing(rect: Rect, share = 0.8, roll = 0): Shot {
  const zoom = Math.min((FRAME.w * share) / rect.w, (FRAME.h * share) / rect.h);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, zoom, roll };
}

/** The world rectangle a shot shows (roll aside): check that a stop keeps its subject inside and shows no world edge. */
export function view(shot: Shot): Rect {
  const w = FRAME.w / shot.zoom;
  const h = FRAME.h / shot.zoom;
  return { x: shot.x - w / 2, y: shot.y - h / 2, w, h };
}

/** Interpolate two shots; zoom moves geometrically so a push-in keeps its pace. */
export function blend(a: Shot, b: Shot, u: number): Shot {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    zoom: a.zoom * Math.pow(b.zoom / a.zoom, u),
    roll: a.roll + (b.roll - a.roll) * u,
  };
}

/**
 * Tween a plain state object that the canvases read. The painters run in `everyFrame`, and GSAP
 * calls a timeline's own onUpdate only after every child tween has rendered this time.
 */
export function tween<T extends object>(tl: Timeline, target: T, vars: TweenVars & Partial<Record<keyof T, unknown>>, at: number | string): Timeline {
  return tl.to(target, vars, at);
}

/** A camera the timeline moves. Tween `shot` like any object; every seek re-aims the world. */
export function camera(tl: Timeline, start: Shot) {
  const shot: Shot = { ...start };
  return {
    shot,
    move(to: Partial<Shot>, at: number, duration: number, ease = 'power2.inOut') {
      tween(tl, shot, { ...to, duration, ease }, at);
      return this;
    },
    set(to: Partial<Shot>, at: number) {
      tl.set(shot, to, at);
      return this;
    },
  };
}

/**
 * Repaint on every seek. The timeline's own onUpdate fires after all of its children have rendered
 * for that time, so the painter reads settled state; a tween's onUpdate would run in child order.
 */
export function everyFrame(tl: Timeline, seconds: number, paint: (t: number) => void): void {
  tl.set({}, {}, seconds); // hold the timeline open to the scene's full length
  tl.eventCallback('onUpdate', () => paint(tl.time()));
  paint(0);
}
