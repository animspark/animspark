/**
 * Applies the overrides in the film document (see core's filmOverrideSchema) to the nodes an
 * MG renders.
 *
 * ## Why the individual transform properties
 *
 * The layer is usually being animated by GSAP, which writes inline `transform`. If the
 * override also wrote `transform`, the two would overwrite each other every frame: either the
 * animation or the move would be lost. CSS `translate` / `scale` / `rotate` are three
 * independent properties that the browser multiplies with `transform` - the animation runs as
 * usual and its whole path is shifted, scaled, and rotated. React doesn't manage these three
 * either (nobody writes them in the source), so re-renders don't wipe them.
 *
 * Style overrides (colors, font sizes that can't be written back into the source) are applied
 * with `!important`: GSAP writes plain inline values to the same node, so without it they'd be
 * overwritten on the next frame. As a result, animation on that key stops - the editor says
 * so on that field.
 *
 * ## Finding the nodes
 *
 * First look up by source anchor (`data-animspark-source` equal to `at`); when `.map` produces
 * several copies, pick the `n`th. If none is found, or the one found no longer looks like it
 * did (`fp` doesn't match) - the source was rewritten, line numbers moved - look again inside
 * this clip wrapper by `fp`: same tag, same text. If that still fails, don't move anything;
 * don't guess.
 *
 * Nodes mount and unmount over time (conditional rendering), so any node change inside the
 * wrapper triggers a reapply (see MgClipLayer).
 */

import type { FilmOverride } from '@animspark/core/film';

const ATTR = 'data-animspark-source';
/** Marker stamped on after applying: the editor reads it to know how much this layer is currently moved (the panel's numbers come from here). */
export const OVERRIDE_ATTR = 'data-film-override';

function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function matchesPrint(node: Element, fp: NonNullable<FilmOverride['fp']>): boolean {
  if (node.tagName.toLowerCase() !== fp.tag.toLowerCase()) return false;
  if (fp.text == null) return true;
  return normalize(node.textContent).slice(0, 80) === normalize(fp.text);
}

/** Which nodes this override currently points at. */
export function overrideTargets(root: ParentNode, override: FilmOverride): HTMLElement[] {
  if (override.at.includes('"') || override.at.includes('\\')) return [];
  const byAnchor = [...root.querySelectorAll(`[${ATTR}="${override.at}"]`)] as HTMLElement[];
  const pick = (nodes: HTMLElement[]) => (override.n == null ? nodes : nodes[override.n - 1] ? [nodes[override.n - 1]!] : []);
  const fp = override.fp;
  if (!fp) return pick(byAnchor);
  const anchored = pick(byAnchor).filter((node) => matchesPrint(node, fp));
  if (anchored.length) return anchored;
  /* The anchor went stale: look again by appearance. Only when there is text - by tag name
     alone, a clip wrapper has plenty of divs. */
  if (fp.text == null || !normalize(fp.text)) return [];
  const byPrint = ([...root.querySelectorAll(`[${ATTR}]`)] as HTMLElement[]).filter((node) => matchesPrint(node, fp));
  if (byPrint.length === 1) return byPrint;
  /* Several identical copies (cards from `.map`): when the anchor goes stale they all moved
     lines together, so still pick by index. */
  if (override.n != null && byPrint.length > 1) {
    const anchors = new Set(byPrint.map((node) => node.getAttribute(ATTR)));
    return anchors.size === 1 && byPrint[override.n - 1] ? [byPrint[override.n - 1]!] : [];
  }
  return [];
}

/** Which style keys were applied - next time, keys no longer overridden are removed, only these, never the ones the source wrote itself. */
const STYLE_KEYS_ATTR = 'data-film-override-style';

/* Aligned with React's table: these numbers don't get px appended (see apps/web's
   stage-inspect; both sides use the same set). */
const UNITLESS = new Set([
  'opacity', 'fontWeight', 'lineHeight', 'zIndex', 'flex', 'flexGrow', 'flexShrink',
  'order', 'zoom', 'scale', 'fillOpacity', 'strokeOpacity', 'strokeMiterlimit',
]);

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function cssValue(key: string, value: string | number): string {
  return typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : String(value);
}

/**
 * The node's own inline values before the override (rendered from the source's `style={...}`).
 * When the override is removed they must be put back - a plain removeProperty would also
 * delete the source's value: remove the `background-color` rendered from
 * `background: theme.bg` and the block becomes transparent.
 */
const STYLE_ORIG_ATTR = 'data-film-override-orig';

function paintStyle(node: HTMLElement, style: FilmOverride['style']): void {
  const before = (node.getAttribute(STYLE_KEYS_ATTR) ?? '').split(',').filter(Boolean);
  const now = Object.keys(style ?? {});
  let orig: Record<string, string> = {};
  try {
    orig = JSON.parse(node.getAttribute(STYLE_ORIG_ATTR) ?? '{}') as Record<string, string>;
  } catch { /* corrupted record: treat as empty */ }
  for (const key of before) {
    if (now.includes(key)) continue;
    const css = kebab(key);
    if (orig[css]) node.style.setProperty(css, orig[css]!);
    else node.style.removeProperty(css);
    delete orig[css];
  }
  for (const key of now) {
    const css = kebab(key);
    if (!before.includes(key) && !(css in orig)) orig[css] = node.style.getPropertyValue(css);
    node.style.setProperty(css, cssValue(key, style![key]!), 'important');
  }
  if (now.length) node.setAttribute(STYLE_KEYS_ATTR, now.join(','));
  else node.removeAttribute(STYLE_KEYS_ATTR);
  if (Object.keys(orig).length) node.setAttribute(STYLE_ORIG_ATTR, JSON.stringify(orig));
  else node.removeAttribute(STYLE_ORIG_ATTR);
}

/**
 * A shape inside an SVG that is scaled up or moved out gets clipped by its `<svg>` viewport -
 * it looks like "only half of it scaled". For shapes with a geometry override, open up their
 * `<svg>`'s clipping; restore it once all overrides are removed (only restoring what we
 * opened ourselves).
 */
const SVG_OPENED_ATTR = 'data-film-override-overflow';

function ownerSvgOf(node: Element): SVGSVGElement | null {
  const owner = (node as SVGElement).ownerSVGElement ?? null;
  return owner && owner !== node ? owner : null;
}

function openSvg(node: Element): void {
  const svg = ownerSvgOf(node);
  if (!svg || svg.hasAttribute(SVG_OPENED_ATTR)) return;
  svg.setAttribute(SVG_OPENED_ATTR, svg.style.getPropertyValue('overflow'));
  svg.style.setProperty('overflow', 'visible');
}

function closeSvg(node: Element): void {
  const svg = ownerSvgOf(node);
  if (!svg || !svg.hasAttribute(SVG_OPENED_ATTR)) return;
  if (svg.querySelector(`[${OVERRIDE_ATTR}]`)) return;
  const before = svg.getAttribute(SVG_OPENED_ATTR) ?? '';
  if (before) svg.style.setProperty('overflow', before);
  else svg.style.removeProperty('overflow');
  svg.removeAttribute(SVG_OPENED_ATTR);
}

function clear(node: HTMLElement): void {
  PAINTED.delete(node);
  node.style.removeProperty('translate');
  node.style.removeProperty('scale');
  node.style.removeProperty('rotate');
  paintStyle(node, undefined);
  node.removeAttribute(OVERRIDE_ATTR);
  closeSvg(node);
}

/**
 * What the three properties were last set to on each node - so they can be put back if
 * something else wipes them (see restoreWipedOverrides).
 *
 * The culprit is GSAP: when it clears transforms (`clearProps`, a context revert) it also
 * writes `translate` / `rotate` / `scale` as `none`, and immediately re-reads the transform -
 * at that moment the three are already none and don't make it into its own matrix, so the
 * override is lost: the film document still says it was moved, but the picture is back in
 * its original place.
 */
const PAINTED = new WeakMap<HTMLElement, { translate: string; scale: string; rotate: string; override: FilmOverride }>();

function paint(node: HTMLElement, override: FilmOverride): void {
  const [x, y] = override.t ?? [0, 0];
  if (x || y) node.style.setProperty('translate', `${x}px ${y}px`);
  else node.style.removeProperty('translate');
  const [sx, sy] = Array.isArray(override.s) ? override.s : [override.s ?? 1, override.s ?? 1];
  if (sx !== 1 || sy !== 1) node.style.setProperty('scale', sx === sy ? String(sx) : `${sx} ${sy}`);
  else node.style.removeProperty('scale');
  if (override.r) node.style.setProperty('rotate', `${override.r}deg`);
  else node.style.removeProperty('rotate');
  if (x || y || sx !== 1 || sy !== 1 || override.r) openSvg(node);
  PAINTED.set(node, {
    translate: node.style.getPropertyValue('translate'),
    scale: node.style.getPropertyValue('scale'),
    rotate: node.style.getPropertyValue('rotate'),
    override,
  });
  paintStyle(node, override.style);
  node.setAttribute(OVERRIDE_ATTR, JSON.stringify({
    at: override.at,
    ...(override.n != null ? { n: override.n } : {}),
    ...(override.t ? { t: override.t } : {}),
    ...(override.s != null ? { s: override.s } : {}),
    ...(override.r != null ? { r: override.r } : {}),
    ...(override.style && Object.keys(override.style).length ? { style: override.style } : {}),
  }));
}

/**
 * Apply once. Returns the nodes applied to this time - on the next call, nodes no longer
 * targeted get the three properties removed (the override was deleted or now points at a
 * different node); otherwise they'd stay in the moved position.
 */
export function applyElementOverrides(
  root: ParentNode,
  overrides: readonly FilmOverride[] | undefined,
  previous: ReadonlySet<HTMLElement> = new Set(),
): Set<HTMLElement> {
  const now = new Set<HTMLElement>();
  for (const override of overrides ?? []) {
    for (const node of overrideTargets(root, override)) {
      paint(node, override);
      now.add(node);
    }
  }
  for (const node of previous) if (!now.has(node)) clear(node);
  return now;
}

/**
 * Checks whether the overrides on these nodes were wiped by something else, and if so puts
 * them back as they were last applied. Returns how many were restored.
 * Only the three individual transform properties are compared - style overrides carry
 * `!important`, which GSAP's plain inline values can't beat.
 */
export function restoreWipedOverrides(nodes: Iterable<HTMLElement>): number {
  let fixed = 0;
  for (const node of nodes) {
    const was = PAINTED.get(node);
    if (!was) continue;
    const st = node.style;
    if (
      st.getPropertyValue('translate') === was.translate
      && st.getPropertyValue('scale') === was.scale
      && st.getPropertyValue('rotate') === was.rotate
    ) continue;
    paint(node, was.override);
    fixed++;
  }
  return fixed;
}
