import type { Plugin } from 'esbuild';
import type { MediaTimeIndex } from '@animspark/runtime';

import { DEPS_PARAM } from '../shared-deps';
import { readAssetIndex } from './asset-index';

/** Internal import only; never a workspace file or an author API. */
export const PROJECT_RUNTIME_HOST = 'animspark:runtime-host';

/** The closure is initialized before any importing author module executes. */
export function projectRuntimeSource(assets: MediaTimeIndex): string {
  const timing = Object.fromEntries(Object.entries(assets).flatMap(([src, entry]) => entry ? [[src, {
    ...(entry.dur != null ? { dur: entry.dur } : {}),
    ...(entry.words?.length ? { words: entry.words } : {}),
    ...(entry.text ? { text: entry.text } : {}),
  }]] : []));
  return [
    `import { createMediaAt, createMediaDuration, createMediaCue } from ${JSON.stringify(PROJECT_RUNTIME_HOST)};`,
    `export * from ${JSON.stringify(PROJECT_RUNTIME_HOST)};`,
    `const __mediaTimes = ${JSON.stringify(timing)};`,
    'export const at = createMediaAt(__mediaTimes);',
    'export const duration = createMediaDuration(__mediaTimes);',
    'export const cue = createMediaCue(__mediaTimes);',
  ].join('\n');
}

/**
 * Give each output bundle an independent @animspark/runtime facade. The base
 * runtime remains a singleton; at and duration share project-specific metadata.
 * This also makes module-level calls safe while multiple SSR builds coexist.
 */
export function projectRuntimePlugin(workspace: string, shared: boolean): Plugin {
  const source = projectRuntimeSource(readAssetIndex(workspace));
  const bypass = {};
  return {
    name: 'anim-project-runtime',
    setup(build) {
      build.onResolve({ filter: /^@animspark\/runtime$/ }, (args) => (
        args.pluginData === bypass ? undefined : { path: args.path, namespace: 'anim-project-runtime' }
      ));
      build.onResolve({ filter: /^animspark:runtime-host$/ }, async () => {
        if (shared) return { path: '@animspark/runtime', namespace: 'anim-project-runtime-host' };
        return build.resolve('@animspark/runtime', {
          kind: 'import-statement', resolveDir: workspace, pluginData: bypass,
        });
      });
      build.onLoad({ filter: /.*/, namespace: 'anim-project-runtime' }, () => ({ contents: source, loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'anim-project-runtime-host' }, () => ({
        contents: `module.exports = ${DEPS_PARAM}['@animspark/runtime'];`, loader: 'js',
      }));
    },
  };
}
