/** Load code as data for planning; author modules never execute in the Node host. */
import { build } from 'esbuild';
import { existsSync, statSync } from 'node:fs';
import { assertLegacyMgSourcePath, assertRolePath } from '../llm/role-workspace-tools';
import { createContext, Script } from 'node:vm';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { MediaTimeIndex } from '@animspark/runtime';
import { validateScore, type Score } from '@muspark/core';
import { SHARED_DEPS, LIB_PATHS } from '@animspark/film-build';
import { packageDir } from '../package-root';

/** One scene module; `id` only names it in error messages. */
export interface MgSourceScene { id: string; file: string }
const own = (base: string, path: string) => { const rel = relative(base, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
const browserExtensions = /^(?:react-dom(?:\/.*)?|@animspark\/(?:runtime|three|p5|stem)(?:\/film)?|@muspark\/(?:core|ui(?:\/react)?)|three(?:\/.*)?|p5|d3(?:-[a-z-]+)?|roughjs|simplex-noise|matter-js|mathjs|highlight\.js(?:\/.*)?|topojson-client|world-atlas(?:\/.*)?|@fontsource\/[^/]+(?:\/.*)?|@chinese-fonts\/[^/]+(?:\/.*)?|animspark)$/;
const isMgBrowserDependency = (name: string): boolean => (SHARED_DEPS as readonly string[]).includes(name) || browserExtensions.test(name);

async function validateImports(root: string, file: string, sourceAccess: 'author' | 'legacy') {
  const text = await readFile(join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const paths: string[] = [];
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) paths.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        const first = node.arguments[0];
        if (!first || !ts.isStringLiteral(first)) throw new Error(`${file}: dynamic module paths are not supported.`);
        paths.push(first.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const path of paths) {
    if (!path.startsWith('.') && !/^(react(?:\/.*)?|react-dom(?:\/.*)?|gsap(?:\/.*)?|@gsap\/react)$/.test(path)
      && path !== '@animspark/runtime' && !/^@muspark\/(core|ui)(?:\/react)?$/.test(path)) throw new Error(`${file}: only React, CSS, GSAP, @animspark/runtime, @muspark/core, @muspark/ui and local modules are available.`);
    if (/[\\\u0000-\u001f\u007f]/.test(path) || (!path.startsWith('.') && path.split('/').some((part) => part === '..' || part === '.'))) throw new Error(`${file}: invalid module path ${path}`);
    if (path.startsWith('.')) {
      if (!own(root, resolve(root, dirname(file), path))) throw new Error(`${file}: import escapes the MG workspace: ${path}`);
      const target = resolveLocalModule(root, relative(root, resolve(root, dirname(file), path)));
      if (sourceAccess === 'legacy') assertLegacyMgSourcePath(root, target);
      else assertRolePath(root, 'mg', target, { role: 'mg' });
    } else if (!isMgBrowserDependency(path)) throw new Error(`${file}: module is not an allowed browser dependency: ${path}`);
  }
  return paths.filter((path) => path.startsWith('.'));
}

function resolveLocalModule(root: string, raw: string) {
  return [raw, ...['.tsx','.ts','.jsx','.js','.mjs','.json'].map(ext => raw + ext), raw+'/index.tsx', raw+'/index.ts']
    .find(path => existsSync(join(root,path)) && statSync(join(root,path)).isFile()) ?? raw;
}

/** Query-time metadata evaluation enforces the same imports as check. */
export async function validateMgSceneSource(root: string, file: string, sourceAccess: 'author' | 'legacy' = 'author') {
  const queue = [file], seen = new Set<string>();
  for (const source of queue) {
    if (seen.has(source)) continue;
    seen.add(source);
    if (sourceAccess === 'legacy') assertLegacyMgSourcePath(root, source);
    else assertRolePath(root, 'mg', source, { role: 'mg' });
    for (const dependency of await validateImports(root,source,sourceAccess)) {
      const target = resolveLocalModule(root,relative(root,resolve(root,dirname(source),dependency)));
      if (/\.[cm]?[jt]sx?$/.test(target)) queue.push(target);
    }
  }
}

/** Metadata-only package stand-in, created inside the VM (no host callbacks). */
const sandboxPrelude = `
const __stub = new Proxy(function(){return __stub}, {get(_t,k){
  if(k==='__esModule') return true;
  if(k===Symbol.toPrimitive) return ()=>{throw Error('Browser-only value used in metadata')};
  return __stub;
}});
const require = (name) => ({__esModule:true,default:__stub,createContext:__stub,
  useRef:__stub,useContext:__stub,useEffect:__stub,useLayoutEffect:__stub,useMemo:__stub,
  useState:__stub,useCallback:__stub,createElement:__stub,Fragment:__stub,forwardRef:__stub,
  gsap:__stub,useGSAP:__stub,jsx:__stub,jsxs:__stub,jsxDEV:__stub});
const module = {exports:{}}; const exports = module.exports;
`;
/* The runtime's timing module, found through package resolution (works from an npm install too). */
const timingRuntimePath = join(packageDir('@animspark/runtime'), 'src', 'code', 'media-at.ts');

/**
 * The remaining `@animspark/runtime` exports (useStage, useLocal, useSharedRenderer, ...) for the
 * metadata pass. They are only called inside mounted components, never at module top level, but
 * the import statement itself must still resolve; otherwise a scene that exports `sounds` and also
 * uses useStage (the mg manual's default pattern) fails to compile in this pass.
 * The list is read from the real runtime, so a new export needs no registration here.
 */
let runtimeStubNames: Promise<string[]> | null = null;
const TIMING_EXPORTS = new Set(['at', 'duration', 'cue', 'Video', 'Still', 'vo', 'syncVideo', 'sceneSec', 'mediaAt', 'mediaDuration', 'createMediaCue']);
function runtimeStubs(): Promise<string[]> {
  runtimeStubNames ??= import('@animspark/runtime')
    .then((runtime) => Object.keys(runtime).filter((name) => !TIMING_EXPORTS.has(name) && /^[A-Za-z_$][\w$]*$/.test(name)))
    .catch(() => []);
  return runtimeStubNames;
}

async function evaluateExports(workspace: string, file: string, timing: MediaTimeIndex, dataOnly: boolean): Promise<Record<string, unknown>> {
  const root = await realpath(workspace);
  const stubs = await runtimeStubs();
  const bundled = await build({
    entryPoints: [join(root, file)], absWorkingDir: root, bundle: true, write: false,
    platform: 'neutral', format: 'cjs', target: 'es2022', treeShaking: true, logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    jsx: 'automatic', conditions: ['browser', 'import'], mainFields: ['module', 'main'],
    nodePaths: LIB_PATHS,
    plugins: [{ name: 'mg-metadata-boundary', setup(ctx) {
      ctx.onResolve({ filter: /.*/ }, async (args) => {
        if (args.path === 'mg:timing-host') return { path: timingRuntimePath };
        if (/^(react(?:\/.*)?|gsap(?:\/.*)?|@gsap\/react)$/.test(args.path)) {
          if (dataOnly && args.importer && own(root, args.importer)) throw new Error(`${file} only imports local data modules.`);
          return { path: args.path, external: true };
        }
        // Trusted timing implementation and its bundled pure dependencies.
        if (args.importer && !own(root, args.importer) && args.namespace !== 'mg-runtime') return undefined;
        if (args.path === '@animspark/runtime' || args.path === 'animspark') {
          if (dataOnly) throw new Error(`${file} must export data declarations, without runtime imports.`);
          return { path: args.path, namespace: 'mg-runtime' };
        }
        if (!args.path.startsWith('.') && !isAbsolute(args.path)) {
          if (!isMgBrowserDependency(args.path)) throw new Error(`Unsupported MG import: ${args.path}`);
          if (dataOnly) throw new Error(`${file} only imports local data modules.`);
          if (args.path === 'p5') return { path: args.path, external: true };
          return undefined;
        }
        const path = isAbsolute(args.path) ? args.path : resolve(args.resolveDir, args.path);
        if (!own(root, path)) throw new Error(`MG import leaves its source workspace: ${args.path}`);
        return undefined;
      });
      ctx.onLoad({ filter: /.*/, namespace: 'mg-runtime' }, () => ({ contents:
        `import {mediaAt, mediaDuration, createMediaCue} from 'mg:timing-host';
         const times=${JSON.stringify(timing)};
         export const at=(src,phrase)=>mediaAt(times,src,phrase);
         export const duration=(src)=>mediaDuration(times,src);
         export const cue=createMediaCue(times);
         export const Video=()=>{throw Error('Video belongs in a mounted scene')};
         export const Still=()=>{throw Error('Still belongs in a mounted scene')};
         export const vo=()=>{throw Error('vo() cannot determine module metadata')};
         export const syncVideo=()=>{throw Error('syncVideo belongs in a mounted scene')};
         export const sceneSec=()=>{throw Error('sceneSec() cannot define its own duration')};
         export {mediaAt, mediaDuration, createMediaCue};
         ${stubs.map((name) => `export const ${name}=__stub;`).join('\n')}`,
        loader: 'js', resolveDir: root }));
      ctx.onLoad({ filter: /\.(css|woff2?|ttf|otf|png|jpe?g|svg|webp)$/ }, () => ({ contents: 'export default "";', loader: 'js' }));
    } }],
  });
  // A fresh context has no process, filesystem, network, timers or host objects.
  // String/wasm code generation is disabled, including Function constructors.
  const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
  const code = `${sandboxPrelude}\n${bundled.outputFiles[0].text}\n
    if(module.exports.sounds!==undefined){
      if(!Array.isArray(module.exports.sounds))throw Error('MG sounds must be a synchronous plain data array');
      JSON.stringify(module.exports.sounds,(_k,v)=>{
        if(typeof v==='function'||typeof v==='symbol'||(v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null))throw Error('MG sounds must contain synchronous plain data');
        return v;
      });
    }
    JSON.stringify({...module.exports,
    __componentDuration:module.exports.default?.duration,__componentAudio:module.exports.default?.audio}, (_k,v)=>{
    if(typeof v==='number'&&!Number.isFinite(v)) throw Error('Non-finite metadata');
    ${dataOnly ? `if(typeof v==='function'||(v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null))throw Error(${JSON.stringify(file + ' must export synchronous plain data')});` : ''}
    if(typeof v==='function') return undefined; return v;
  });`;
  /* The film's own code, run on the author's machine: a vm context with a timeout, not a sandbox. */
  const json = new Script(code, { filename: `mg-metadata:${file}` }).runInContext(context, { timeout: 1500 });
  return JSON.parse(json) as Record<string, unknown>;
}

export async function readMgSceneDuration(workspace: string, scene: MgSourceScene, timing: MediaTimeIndex): Promise<number> {
  const data = await evaluateExports(workspace, scene.file, timing, false);
  return sceneDuration(data, scene);
}

/** Module-level declarations are evaluated once with the project's current media facts. */
export async function readMgSceneMetadata(workspace: string, scene: MgSourceScene, timing: MediaTimeIndex): Promise<{ durationSec: number; sounds?: unknown }> {
  const data = await evaluateExports(workspace, scene.file, timing, false);
  return { durationSec: sceneDuration(data, scene), ...(data.sounds === undefined ? {} : { sounds: data.sounds }) };
}

/** A full-film audio source is a module whose default export is a plain Score. */
export async function readScoreModule(workspace: string, file: string, timing: MediaTimeIndex): Promise<Score> {
  return validateScore((await evaluateExports(workspace, file, timing, false)).default);
}

/** Static sound declarations used to prepare score media before browser playback. */
export async function readMgSoundDeclarations(workspace: string, file: string, timing: MediaTimeIndex): Promise<unknown> {
  return (await evaluateExports(workspace, file, timing, false)).sounds;
}

function sceneDuration(data: Record<string, unknown>, scene: MgSourceScene): number {
  const value = data.durationSec;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${scene.id}: export a positive finite durationSec.`);
  return value;
}
