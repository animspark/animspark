/**
 * Whether this film compiles in the product preview.
 *
 * `anim check` used to run only the server-side evaluation: Node esbuild can bundle a TS source
 * package that's installed only on the server, from the engine's node_modules, so the timeline is all
 * green, while the iframe's compile fetches it from /film-vendor, gets a 404, and the picture stays on
 * the starter template. look / export also bundle on the server, so they can't see this either.
 *
 * So the check asks one more question: does the preview path accept every bare import in the
 * workspace?
 */

import { allowedVendorSpec } from './vendor';
import { isHostShared } from './host-shared';

export { HOST_SHARED_SPECS, hostSharedMap, isHostShared } from './host-shared';

export function isPreviewResolvable(spec: string): boolean {
  if (isHostShared(spec)) return true;
  return allowedVendorSpec(spec);
}

export function previewCompileIssues(
  packages: readonly string[],
  /** Which file imports each package. When given, it goes into the error; a film has dozens of modules. */
  importedBy: Readonly<Record<string, string>> = {},
): Array<{ level: 'error'; what: string }> {
  const seen = [...new Set(packages)].sort();
  const where = (spec: string): string => (importedBy[spec] ? ` in ${importedBy[spec]}` : '');
  const blocked = seen.filter((s) => !isPreviewResolvable(s));
  return blocked.map((spec) => ({
    level: 'error' as const,
    what: `The preview cannot build the picture: import '${spec}'${where(spec)}.`
      + ' The product preview builds the film in the browser and knows two kinds of package: '
      + 'the host-injected ones (react / gsap / @gsap/react / @animspark/runtime / '
      + '@animspark/stem / @muspark/*), '
      + 'and the browser libraries /film-vendor lets through (three / p5 / d3 / matter-js …).'
      + ` '${spec}' is in neither: the iframe 404s, the picture stays on the previous version,`
      + ' while anim look may still look fine — that path bundles on the server.',
  }));
}
