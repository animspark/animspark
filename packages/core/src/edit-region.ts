/**
 * Box-selection hit testing: which elements does the box the user dragged actually refer to?
 *
 * The test runs in the player (it can reach the same-origin stage DOM), but the rule itself is pure
 * geometry and lives here so it can be tested on its own. The edge cases are easy to regress, and a
 * regression is invisible to the user: the reference still gets submitted, the model just receives a
 * list with something missing and edits the wrong thing.
 */

export interface EditRegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How much of the element lies inside the box: "you circled this whole thing". */
export const REGION_OF_ELEMENT = 0.6;
/** How much of the box the element fills: "you circled part of this big thing". */
export const REGION_OF_BOX = 0.5;

/**
 * Both ways of boxing count as a hit; checking only one misses what the user actually meant:
 *
 *   circling the whole thing: most of the element is inside the box (a subtitle, a button, an image);
 *   circling a corner of it: most of the box is filled by the element (marking a patch of a big chart
 *   and saying "this half is wrong").
 *
 * Checking only the first would filter out the second, because the element itself is only slightly
 * covered, leaving the list empty: the user clearly pointed at something, yet the model is told
 * "nothing was selected".
 */
export function regionHitsRect(box: EditRegionRect, rect: EditRegionRect): boolean {
  const overlapW = Math.max(0, Math.min(box.x + box.w, rect.x + rect.w) - Math.max(box.x, rect.x));
  const overlapH = Math.max(0, Math.min(box.y + box.h, rect.y + rect.h) - Math.max(box.y, rect.y));
  const overlap = overlapW * overlapH;
  if (overlap <= 0) return false;
  const rectArea = Math.max(1, rect.w * rect.h);
  const boxArea = Math.max(1, box.w * box.h);
  return overlap >= rectArea * REGION_OF_ELEMENT || overlap >= boxArea * REGION_OF_BOX;
}
