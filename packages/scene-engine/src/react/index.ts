/**
 * `@animspark/scene-engine/react`: turns a component declaration into a real React component.
 *
 * It's a separate entry point because it has nothing to do with the rest of the engine: it depends only
 * on react and doesn't touch compilation, the registry, pyodide and so on. A package importing from here
 * gets just this one module.
 *
 * Why it lives in scene-engine rather than the film runtime: its users are **packages that haven't been
 * fully split out yet** (stem / data / document). Collage already writes this layer itself, because the
 * preview host bundles the whole package and can't drag scene-engine along.
 */
export {
  packComponent,
  packHandle,
  packsReady,
  type PackComponentDef,
  type PackedComponent,
  type PackHandle,
  type PackParams,
} from './pack';
