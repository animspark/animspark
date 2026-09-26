/**
 * film.json canvas layer: translate / scale / rotate.
 *
 * The transform moves this block: `t` is px from the canvas top-left, `s` is a per-axis
 * multiplier, `r` is degrees. Footage defaults to the canvas size, so 1:1 fills the frame.
 * An MG decides its own width and height and lays itself out at that size.
 */
import type { CSSProperties } from 'react';

import { filmAxisScale, filmOffset, type FilmTransform } from '@animspark/core/film';

export function hasLayerTransform(t?: FilmTransform): boolean {
  if (!t) return false;
  const { scaleX, scaleY } = filmAxisScale(t);
  const { x, y } = filmOffset(t);
  return x !== 0 || y !== 0
    || scaleX !== 1
    || scaleY !== 1
    || (t.r ?? 0) !== 0;
}

function cssScale(scaleX: number, scaleY: number): string {
  return scaleX === scaleY ? `scale(${scaleX})` : `scale(${scaleX}, ${scaleY})`;
}

export function filmLayerStyle(t?: FilmTransform): CSSProperties {
  if (!hasLayerTransform(t)) {
    return { position: 'absolute', inset: 0 };
  }
  const { scaleX, scaleY } = filmAxisScale(t);
  const { x, y } = filmOffset(t);
  const rotate = t!.r ?? 0;
  const scaled = scaleX !== 1 || scaleY !== 1;
  return {
    position: 'absolute',
    left: x,
    top: y,
    width: '100%',
    height: '100%',
    ...(scaled || rotate !== 0
      ? { transform: `${cssScale(scaleX, scaleY)} rotate(${rotate}deg)`, transformOrigin: 'top left' }
      : {}),
  };
}

/**
 * Which part of the canvas a block of picture occupies **when it has no transform**.
 *
 * Putting portrait footage into a landscape frame is common: a 1080x1920 source in a
 * 1920x1080 frame, fitted whole, only has actual picture in the 607x1080 strip in the middle.
 * `objectFit:contain` already draws it that way, but this layer used to treat the whole
 * canvas as the block's box - so selecting it on the stage outlined the entire frame, the
 * handles dragged the letterbox bars, and rotation pivoted on the frame center instead of the
 * picture center. This computes the rectangle that really has picture; the box and the
 * selection frame both follow it.
 *
 * Scale is the smaller of the two axes (the definition of contain), centered - the same
 * placement the browser uses for `contain`, so switching to this moves no pixels; only the
 * answer to "how big is this block and where is it" changes.
 */
export function filmContainBox(
  natural: { w: number; h: number },
  frame: { w: number; h: number },
): { w: number; h: number; x: number; y: number } {
  if (!(natural.w > 0 && natural.h > 0 && frame.w > 0 && frame.h > 0)) {
    return { w: frame.w, h: frame.h, x: 0, y: 0 };
  }
  const k = Math.min(frame.w / natural.w, frame.h / natural.h);
  const w = natural.w * k;
  const h = natural.h * k;
  return { w, h, x: (frame.w - w) / 2, y: (frame.h - h) / 2 };
}

/**
 * Which region of the canvas this block covers - thumbnail cropping and single-block export
 * both ask this.
 *
 * Takes **a rectangle in canvas coordinates** (the layout box of the block's own clip
 * wrapper, see below) and returns it clamped to the canvas. Returns `null` when it can't be
 * measured or the crop is too small, and the caller falls back to the full frame - when in
 * doubt, give the whole picture rather than a skewed crop.
 *
 * ## Why it takes the clip wrapper's layout box, not the two attributes on the block
 *
 * `data-film-box` / `data-film-origin` describe **the component's own** box and its intrinsic
 * offset, and **exclude** the film.json transform - translation and scale are added by the
 * consumer (see filmMgLayerStyle: `left = origin + t.x`, `width = box.w * scaleX`). So using
 * those two numbers directly as canvas coordinates goes wrong in two ways:
 *
 *   - The block has a translation (`t`) - the crop takes the canvas top-left corner while
 *     the block is elsewhere. Measured on one project: all five blocks were hit, the crops
 *     were 0% content (solid black), and the thumbnail cell looked like "never generated".
 *   - The block has a scale (`s`) - the crop is larger than what's drawn, leaving black at
 *     the edges. Measured: the `poster` block at s=0.92 left 8% black on the right and bottom.
 *
 * The clip wrapper's layout box (`offsetLeft/Top/Width/Height`) has already combined all
 * three (intrinsic offset, translation, scale) - it is exactly the number the runtime uses to
 * place it, computed in one place and used in one place.
 *
 * Rotation is the only thing not folded in: the layout box is the unrotated one, and the
 * rotated bounding box is larger. Such blocks crop slightly tight (a sliver off each corner).
 * We don't fall back to the full frame for that - the full-frame answer is much further off
 * in a thumbnail.
 *
 * ## Why clamp to the canvas
 *
 * The origin **can be negative**: the box is the union of the root and its descendants, and
 * when children overflow up/left the union's origin lands outside the root. But there are no
 * pixels outside the canvas - cropping them in just leaves a black strip on the thumbnail
 * edge, which looks like a skewed crop. Edge-hugging and deliberately off-frame blocks (lower
 * thirds, corner badges, bleeding backgrounds) all look like this.
 *
 * A full-frame block (`inset:0`) crops to exactly the full frame, so this step is a no-op -
 * which is correct.
 */
export function filmPaintCrop(
  at: { x: number; y: number; w: number; h: number } | null | undefined,
  stage: { w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  if (!at) return null;
  const { x: ax, y: ay, w: aw, h: ah } = at;
  if (![ax, ay, aw, ah].every((n) => Number.isFinite(n))) return null;
  if (!(aw > 0 && ah > 0)) return null;
  if (!(stage.w > 0 && stage.h > 0)) return null;
  const right = ax + aw;
  const bottom = ay + ah;
  const x = Math.max(0, Math.min(stage.w, ax));
  const y = Math.max(0, Math.min(stage.h, ay));
  const cropRight = Math.min(stage.w, right);
  const cropBottom = Math.min(stage.h, bottom);
  /* If the canvas didn't cut it, hand back the measured number unchanged instead of doing
     the subtraction - `158.2 + 402.25 - 158.2` is `402.25000000000006` in floating point.
     Downstream Math.round would swallow that noise, but "untouched when not cut" is a more
     useful contract: the measured box and the crop can be compared for equality directly. */
  const w = x === ax && cropRight === right ? aw : cropRight - x;
  const h = y === ay && cropBottom === bottom ? ah : cropBottom - y;
  /* Too small means no crop: a block entirely off canvas comes out negative or a few pixels,
     and such a "thumbnail" is worse than the full frame. */
  if (!(w >= MIN_CROP && h >= MIN_CROP)) return null;
  return { x, y, w, h };
}

/** Crops smaller than this are not used. 8: nothing is recognizable in a smaller image. */
const MIN_CROP = 8;

export type FilmPaintBox = { x: number; y: number; w: number; h: number };

/** Layout width: HTML elements read offsetWidth; those without it (an SVG root) fall back to clientWidth, then the rendered rect. */
export function layoutWidth(el: Element): number {
  const off = (el as HTMLElement).offsetWidth;
  if (typeof off === 'number') return off;
  return el.clientWidth || el.getBoundingClientRect().width || 0;
}

/** Layout height, same as layoutWidth. */
export function layoutHeight(el: Element): number {
  const off = (el as HTMLElement).offsetHeight;
  if (typeof off === 'number') return off;
  return el.clientHeight || el.getBoundingClientRect().height || 0;
}

/**
 * How much area this block actually paints - relative to the root's top-left; `x`/`y` can be
 * negative.
 *
 * ## Why the root's offsetWidth alone isn't enough
 *
 * We used to measure the root's own **layout box**, but children are often bigger than it.
 * The most common case is a missing `box-sizing`: `{ width: 640, padding: '28px 32px' }` lays
 * out 706 wide while the root reports 640. Measured on one project, three of five blocks were
 * off by 10-16% (chart-bar: 640x420 vs 713x502 actually painted).
 *
 * This number has three consumers - the selection frame, thumbnail cropping, and
 * single-block transparent export - and they all **consistently** trusted the undersized
 * number, so all three were wrong in exactly the same way: the frame a size smaller than the
 * card, the thumbnail missing its bottom-right corner. None of them raised an error, because
 * from each one's point of view it faithfully drew the box it was given.
 *
 * ## Why offset* rather than getBoundingClientRect
 *
 * The rect includes CSS transforms, and an MG's animation **is** transforms - GSAP drives
 * scale/y entirely through transform. A box measured with rects breathes with the playhead,
 * and the effect that measures it only runs on React re-renders (GSAP writes styles directly,
 * bypassing React), so it captures the animation at "some random moment" and freezes that on
 * the attributes. offset* excludes transforms: it measures the layout box, which stays put
 * however the playhead moves.
 *
 * The measured difference (chart-bar: layout union 706x472, rect union 713x502) is exactly
 * the animation's share - which never belonged in this number.
 */
export function filmPaintedBox(root: HTMLElement): FilmPaintBox {
  let left = 0;
  let top = 0;
  /* When the root is an <svg> (manual examples like physics / noise / maps use svg as the
     root directly) there is no offsetWidth; it reads as undefined - everything becomes NaN,
     and in MgClipLayer NaN !== NaN triggers setState every time, so React throws #185 and the
     block goes white. An SVG root has a CSS box, so clientWidth measures it; it has no
     offsetLeft either, so treat that as 0 (the manual requires the root to be absolutely
     positioned, so its origin is the clip wrapper). */
  let right = layoutWidth(root);
  let bottom = layoutHeight(root);
  /* The same ancestor chain gets asked about repeatedly by descendants, and getComputedStyle
     forces a style recalc - cache once per element. */
  const clip = new Map<HTMLElement, boolean>();
  const kids = root.querySelectorAll<HTMLElement>('*');
  for (let i = 0; i < kids.length; i += 1) {
    const el = kids[i]!;
    if (el.offsetWidth <= 0 && el.offsetHeight <= 0) continue;
    /* `data-film-ghost`: layout that is present but not on screen (hosts of HTML textures -
       their pixels are painted elsewhere). Including it in the union adds empty space to the
       top-left of the selection frame. */
    if (typeof el.closest === 'function' && el.closest('[data-film-ghost]')) continue;
    const at = paintedOnRoot(el, root, clip);
    if (!at) continue;
    if (at.x < left) left = at.x;
    if (at.y < top) top = at.y;
    if (at.x + at.w > right) right = at.x + at.w;
    if (at.y + at.h > bottom) bottom = at.y + at.h;
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The region a descendant **can actually paint** in root coordinates. Returns `null` when it
 * can't reach the root (fixed positioning, display:none) or is clipped away entirely by an
 * ancestor - those don't belong in the union.
 *
 * ## Why clip against ancestors' overflow
 *
 * A layout box outside the canvas doesn't mean it paints outside the canvas: an
 * `overflow:hidden` ancestor **clips** its descendants, and the clipped part paints no pixels
 * at all. Adding without clipping lets such "ghost boxes" inflate the union out of nowhere.
 *
 * A case we actually hit (chapter-card): the card body `.card` is a 300x400 with
 * `overflow:hidden`, containing a top sheen stripe at `left:-30, top:-20`. `.card` clipped it
 * so none of it showed outside, yet it stretched the union to 330x420 @(-30,-20). All three
 * consumers were hit - selection frame a size too big, thumbnail skewed, and single-block
 * transparent export with 30x20 of empty space at the top-left. That empty space happened to
 * expose `.card`'s own drop shadow (`boxShadow: 0 18px 48px rgba(16,24,40,.16)`): the shadow
 * paints **outside** the border box, so a crop hugging the border box captures none of it;
 * once inflated, it does - so the exported image had an odd dark rim at the top-left, while
 * at the bottom-right the crop ended and cut the same shadow off, making the rim asymmetric.
 */
function paintedOnRoot(
  el: HTMLElement,
  root: HTMLElement,
  clip: Map<HTMLElement, boolean>,
): FilmPaintBox | null {
  /* offsetLeft is relative to offsetParent; accumulate up to the root. Inside the loop
     (x,y,w,h) is always this block's box in `up`'s coordinate system. */
  let x = el.offsetLeft;
  let y = el.offsetTop;
  let w = el.offsetWidth;
  let h = el.offsetHeight;
  let up = el.offsetParent as HTMLElement | null;
  while (up) {
    /* If an intermediate layer is scrolled, its contents move with it - the root's own
       scroll doesn't count (it is the coordinate origin). */
    if (up !== root) {
      x -= up.scrollLeft;
      y -= up.scrollTop;
    }
    if (clipsPaint(up, clip)) {
      /* Clipping is to the padding box, and offsetLeft is measured from the padding edge -
         the same origin. Inline ancestors have no client size; fall back to offset. */
      const capW = up.clientWidth || up.offsetWidth;
      const capH = up.clientHeight || up.offsetHeight;
      const x2 = Math.min(x + w, capW);
      const y2 = Math.min(y + h, capH);
      x = Math.max(x, 0);
      y = Math.max(y, 0);
      w = x2 - x;
      h = y2 - y;
      if (!(w > 0 && h > 0)) return null;
    }
    if (up === root) return { x, y, w, h };
    x += up.offsetLeft;
    y += up.offsetTop;
    up = up.offsetParent as HTMLElement | null;
  }
  return null;
}

/**
 * Whether this layer clips its descendants.
 *
 * Only `overflow` counts. `clip-path` also clips, but its clip region **can extend beyond the
 * border box** (`inset(-50px)`), so clipping to the border box would cut off things that are
 * really painted - better to under-clip.
 */
function clipsPaint(el: HTMLElement, clip: Map<HTMLElement, boolean>): boolean {
  const seen = clip.get(el);
  if (seen !== undefined) return seen;
  let yes = false;
  try {
    /* When one axis says hidden and the other visible, CSS computes the visible axis as
       auto - so both axes clip, and checking the `overflow` shorthand alone is enough. */
    yes = getComputedStyle(el).overflow !== 'visible';
  } catch {
    /* If the style can't be read (the node was torn down), treat it as not clipping - when
       in doubt, don't cut off the user's content. */
    yes = false;
  }
  clip.set(el, yes);
  return yes;
}

/**
 * Whether this layer **paints at all**. Things that paint no pixels don't belong in the
 * animation extent.
 *
 * `getBoundingClientRect` ignores this: an `opacity:0` element still returns a full
 * rectangle. And by convention an MG's entrance starts "not yet visible" - so the frame-0
 * rectangle is a **ghost**: it inflates the animation extent (reporting a bogus "animation
 * extends past the frame") and can be picked as the preview frame for being "the furthest
 * reach", even though that frame has no pixels. Measured on a 4.2s chapter card: frame 0 had
 * 0.0% opaque pixels and overflowed by 68px, the largest of all samples in the film - so the
 * preview came out blank.
 *
 * **`opacity` must be checked across the whole ancestor chain.** It isn't inherited, but it
 * creates a compositing group: if an ancestor is 0, a descendant set to 1 still doesn't
 * paint. That chapter card was exactly this - the card body at `opacity:0`, its buttons and
 * text each at `opacity:1`, so checking only the element itself stops none of them. Hence
 * every level is asked while walking up the ancestors.
 *
 * `visibility`, by contrast, is inherited, but a descendant can flip it back with `visible` -
 * the computed value already accounts for this, so checking each level's own is enough.
 * `display:none` needs no handling: such elements have a zero-area rect anyway (see edgesOf).
 *
 * Only **exactly 0** is excluded. `opacity:0.01` is invisible to the eye but is still
 * painting; guessing "how faint counts as nothing" with a threshold starts cutting off things
 * that really are painted, and this ruler's job is to avoid missing things, not to make design
 * judgments.
 */
function paintsAtAll(el: HTMLElement, paints: Map<HTMLElement, boolean>): boolean {
  const seen = paints.get(el);
  if (seen !== undefined) return seen;
  let yes: boolean;
  try {
    const style = getComputedStyle(el);
    yes = style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  } catch {
    /* If the style can't be read (the node was torn down), treat it as painting - same
       stance as clipsPaint: when in doubt, don't rule the user's content out. */
    yes = true;
  }
  paints.set(el, yes);
  return yes;
}

interface Edges { left: number; top: number; right: number; bottom: number }

/** Returns null when it can't be measured (node torn down) or has no area - those don't belong in the union. */
function edgesOf(el: HTMLElement): Edges | null {
  let r: DOMRect;
  try {
    r = el.getBoundingClientRect();
  } catch {
    return null;
  }
  if (!r || !(r.width > 0 && r.height > 0)) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/**
 * **How far this block paints**, in viewport coordinates - transforms included.
 *
 * This and `filmPaintedBox` are two rulers measuring two different things:
 *
 * - `filmPaintedBox` measures **layout** (`offsetLeft`/`offsetWidth`). The crop belongs to
 *   it: layout doesn't change with the animation, so every frame of this block is cropped the
 *   same, and elements move freely within a fixed frame - just as in AE the comp frame is
 *   fixed and elements move inside it.
 * - This one measures the **rendered rect** (`getBoundingClientRect`). Only here are
 *   transforms visible, so only it can answer "did GSAP push something out of the box".
 *
 * This one must **not** be used as the crop. Transforms change every frame; cropping to them
 * makes the frame chase the element: in the final film the element would appear pinned in
 * place and the animation lost entirely. So it answers only one question - was anything cut
 * off.
 *
 * Drop shadows and outer glows aren't included in `getBoundingClientRect` (it returns the
 * border box), which is what we want: with the crop hugging the border box the shadow is
 * never captured anyway, by design, and shouldn't be reported as "the animation ran out".
 */
export function filmRenderedBox(root: HTMLElement): FilmPaintBox | null {
  /* The same ancestor chain gets asked about repeatedly by descendants, and getComputedStyle
     forces a style recalc - cache once per element. */
  const clip = new Map<HTMLElement, boolean>();
  const paints = new Map<HTMLElement, boolean>();
  /* If the whole block hasn't appeared yet (the frames before its entrance), return nothing
     rather than a ghost box - the caller then **skips this frame** (see planFilmClip) instead
     of merging an area that paints nothing into the animation extent. */
  if (!paintsAtAll(root, paints)) return null;
  const own = edgesOf(root);
  if (!own) return null;
  let { left, top, right, bottom } = own;
  const kids = root.querySelectorAll<HTMLElement>('*');
  for (let i = 0; i < kids.length; i += 1) {
    const at = renderedOnScreen(kids[i]!, root, clip, paints);
    if (!at) continue;
    if (at.left < left) left = at.left;
    if (at.top < top) top = at.top;
    if (at.right > right) right = at.right;
    if (at.bottom > bottom) bottom = at.bottom;
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The region a descendant can paint in the viewport. Returns null when clipped away or when
 * it can't reach the root.
 *
 * Rects are already absolute, so there's no need to accumulate offsets level by level as
 * `paintedOnRoot` does - just intersect with each ancestor's `overflow`. For why the
 * intersection is required, see `paintedOnRoot`: the part `overflow:hidden` clips paints no
 * pixels, and a union without intersection lets ghost boxes report bogus "overflow".
 *
 * Walks `parentElement` rather than `offsetParent`: any ancestor may clip, and offsetParent
 * skips non-positioned layers.
 */
function renderedOnScreen(
  el: HTMLElement,
  root: HTMLElement,
  clip: Map<HTMLElement, boolean>,
  paints: Map<HTMLElement, boolean>,
): Edges | null {
  if (!paintsAtAll(el, paints)) return null;
  const at = edgesOf(el);
  if (!at) return null;
  let up = el.parentElement;
  for (;;) {
    if (!up) return null;
    /* If any ancestor doesn't paint, nothing beneath it does - a descendant's own
       opacity:1 can't flip that back. */
    if (!paintsAtAll(up, paints)) return null;
    if (clipsPaint(up, clip)) {
      const box = edgesOf(up);
      if (!box) return null;
      if (box.left > at.left) at.left = box.left;
      if (box.top > at.top) at.top = box.top;
      if (box.right < at.right) at.right = box.right;
      if (box.bottom < at.bottom) at.bottom = box.bottom;
      if (!(at.right > at.left && at.bottom > at.top)) return null;
    }
    if (up === root) return at;
    up = up.parentElement;
  }
}

/**
 * Which region of the canvas a block should really be cropped to.
 *
 * For an MG without a transform, the clip wrapper is `inset:0` and fills the canvas (see
 * MgClipLayer's fitted), so `offsetWidth` is 1920, not 300. The component's own box is in
 * `native` (data-film-box plus data-film-origin, or the measured union of descendants). When
 * the wrapper has already shrunk to the block (contained footage, or a translation/scale),
 * the wrapper's layout box is that region - trusting native then would lose the canvas scale.
 *
 * For full-frame components (the root is as big as the canvas) both paths give the same box,
 * and this step is a no-op.
 */
export function filmClipPaintBox(
  wrap: FilmPaintBox,
  native: FilmPaintBox | null | undefined,
  canvas: { w: number; h: number },
): FilmPaintBox | null {
  const wrapCrop = filmPaintCrop(wrap, canvas);
  const nativeCrop = native ? filmPaintCrop(native, canvas) : null;
  /* An MG without a transform has a wrapper that fills the canvas; the real module is
     native. When the wrapper has already shrunk to the block (contained footage, or a
     translation/scale), wrap is the one visible on the canvas - trusting native would lose
     the scale. "Fills" uses 90% rather than a 1px tolerance: on the capture page offsetWidth
     sometimes doesn't match __FILM_STAGE__. */
  const wrapFills = wrap.w >= canvas.w * 0.9 && wrap.h >= canvas.h * 0.9;
  if (
    nativeCrop
    && wrapFills
    && (nativeCrop.w < wrap.w * 0.9 || nativeCrop.h < wrap.h * 0.9)
  ) {
    return nativeCrop;
  }
  return wrapCrop;
}

function parsePair(raw: string | null): { a: number; b: number } | null {
  if (!raw) return null;
  const m = /^(-?[\d.]+)x(-?[\d.]+)$/.exec(raw);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b };
}

function nativeFromAttrs(clip: HTMLElement): FilmPaintBox | null {
  const box = parsePair(clip.getAttribute('data-film-box'));
  const origin = parsePair(clip.getAttribute('data-film-origin'));
  if (!box || !origin) return null;
  return { x: origin.a, y: origin.b, w: box.a, h: box.b };
}

/**
 * Before the attributes have been stamped on, measure from the inner component root.
 *
 * The coordinate system is the clip wrapper: a component writing `left: 610` means relative
 * to the canvas, and without a transform the wrapper is the canvas, so this number is the
 * same as data-film-origin.
 */
function nativeFromTree(clip: HTMLElement): FilmPaintBox | null {
  const root = clip.querySelector(':scope > [data-film-mg-inner] > *');
  if (!(root instanceof HTMLElement)) return null;
  const paint = filmPaintedBox(root);
  if (!(paint.w >= MIN_CROP && paint.h >= MIN_CROP)) return null;
  let x = 0;
  let y = 0;
  let walk: HTMLElement | null = root;
  while (walk && walk !== clip) {
    x += walk.offsetLeft;
    y += walk.offsetTop;
    const up = walk.offsetParent as HTMLElement | null;
    if (up && up !== clip) {
      x -= up.scrollLeft;
      y -= up.scrollTop;
    }
    walk = up;
  }
  if (walk !== clip) return null;
  return { x: x + paint.x, y: y + paint.y, w: paint.w, h: paint.h };
}

/**
 * Which region this block occupies in canvas coordinates. Thumbnails, previews and
 * single-block export all ask this.
 *
 * `canvas` is the canvas width and height (not whatever size the wrapper's offsetParent
 * happens to be). The wrapper's offsetLeft/Top must already be relative to this canvas - in
 * the editor the wrapper lives on `#stage`, on the capture page it lives on the film layer.
 */
export function filmClipPaintOnStage(
  clip: HTMLElement,
  canvas: { w: number; h: number },
): FilmPaintBox | null {
  const wrap: FilmPaintBox = {
    x: clip.offsetLeft,
    y: clip.offsetTop,
    w: clip.offsetWidth,
    h: clip.offsetHeight,
  };
  const native = nativeFromAttrs(clip)
    ?? ((wrap.w >= canvas.w - 1 && wrap.h >= canvas.h - 1) ? nativeFromTree(clip) : null);
  return filmClipPaintBox(wrap, native, canvas);
}

/**
 * **How far this block paints** right now, converted to canvas coordinates - the same ruler
 * as `filmClipPaintOnStage`, so the two can be subtracted directly to see whether the crop
 * cuts anything off.
 *
 * It measures **this moment**. The animation extent requires the caller to sample several
 * points on the timeline and take the union: from a single frame nobody can tell "it's always
 * here" from "it's just passing through".
 *
 * Clamped to the canvas (`filmPaintCrop`): nothing outside the canvas can be captured anyway -
 * frame capture shoots the whole canvas and then cuts the crop out of it (see code-host's
 * __filmCapture). Reporting a region that can't be captured is just noise.
 */
export function filmClipEnvelopeOnStage(
  clip: HTMLElement,
  stage: HTMLElement,
  canvas: { w: number; h: number },
): FilmPaintBox | null {
  /* Duck-type instead of `instanceof HTMLElement`: this code runs inside an iframe, and
     cross-realm nodes never pass the outer realm's constructor check - relying on it would
     silently fall back to the wrapper on real pages. */
  const inner = clip.querySelector(':scope > [data-film-mg-inner] > *');
  const root = inner && typeof (inner as HTMLElement).getBoundingClientRect === 'function'
    ? (inner as HTMLElement)
    : clip;
  const seen = filmRenderedBox(root);
  const at = edgesOf(stage);
  if (!seen || !at) return null;
  /* The preview displays the whole stage scaled down, so viewport px aren't canvas px.
     Convert using the stage's own two widths, which lands in the same coordinate system as
     the wrapper's offsetLeft. */
  const k = (at.right - at.left) / Math.max(1, stage.offsetWidth);
  if (!(k > 0)) return null;
  return filmPaintCrop({
    x: (seen.x - at.left) / k,
    y: (seen.y - at.top) / k,
    w: seen.w / k,
    h: seen.h / k,
  }, canvas);
}

/**
 * Used for an MG once the component's own width and height have been measured.
 *
 * The outer element is the unrotated visible box: top-left at (origin + x, origin + y), sides
 * of natural size x per-axis scale. Rotation pivots on the center. The inner element lays the
 * component out at its natural size and then scales it, so the left/top written inside are
 * still relative to the block itself.
 *
 * `origin` is the block's **zero point** - where it sits when the transform is 0. For footage
 * it's the top-left of the contained rectangle; for an MG it's where the component root lays
 * itself out. So `t: [0,0]` means "placed where it belongs", not "moved to the frame's
 * top-left". The zero point isn't stored in film.json: it's derived from the frame and asset
 * sizes, and writing it in would just leave a stale, mismatched number when the frame changes.
 *
 * `canvas` is passed only for MGs. For footage the inner element **is** the box (the
 * `<video>` fills it), but an MG's inner element must preserve the "canvas coordinate system"
 * as the component's frame of reference - the component's `left: 610` is relative to the
 * canvas, and if the inner element shrank to the box, that 610 would become relative to a
 * 700-wide box and the content would jump away. So the inner element still spans the whole
 * canvas, shifted back by the zero point so the root lands exactly at the outer element's
 * top-left; the scale's fixed point is pinned to the zero point too, so scaling changes size
 * without moving the block. When the zero point is (0,0) (a full-frame root, how existing
 * films look) all three numbers are zero - the output is byte-for-byte what it used to be.
 */
export function filmMgLayerStyle(
  t: FilmTransform,
  box: { w: number; h: number },
  origin?: { x: number; y: number },
  canvas?: { w: number; h: number },
): { outer: CSSProperties; inner: CSSProperties } {
  const { scaleX, scaleY } = filmAxisScale(t);
  const { x, y } = filmOffset(t);
  const rotate = t.r ?? 0;
  const scaled = scaleX !== 1 || scaleY !== 1;
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  return {
    outer: {
      position: 'absolute',
      left: ox + x,
      top: oy + y,
      width: box.w * scaleX,
      height: box.h * scaleY,
      ...(rotate
        ? { transform: `rotate(${rotate}deg)`, transformOrigin: 'center' }
        : { transform: 'none', transformOrigin: 'center' }),
    },
    inner: {
      ...(canvas
        /* `ox ? -ox : 0` rather than `-ox`: with the zero point at the top-left the latter
           gives `-0`, which isn't equal to `0` under `Object.is` - so every "geometry
           unchanged" comparison would misfire on existing films. */
        ? {
          position: 'absolute',
          left: ox ? -ox : 0,
          top: oy ? -oy : 0,
          width: canvas.w,
          height: canvas.h,
        }
        : { width: box.w, height: box.h }),
      ...(scaled
        ? { transform: cssScale(scaleX, scaleY) }
        : { transform: 'none' }),
      transformOrigin: canvas ? `${ox}px ${oy}px` : 'top left',
    },
  };
}
