/**
 * Time on the tree is in seconds, the same unit gsap uses. Internal registration, the mix and
 * the player clock still run on integer milliseconds.
 */

export function toMs(sec: number): number {
  return Math.round(sec * 1000);
}

export function toSec(ms: number): number {
  return ms / 1000;
}

/** For writing back to source: snap to 1ms and drop the IEEE float tail. */
export function snapSec(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}
