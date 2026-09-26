/** Authoring layer: Web Runtime docs + package/component doc generation (consumed by the gen service). The old DSL parser is no longer exposed from the public entry. */
export type { ComponentImport } from './types';
export { animsparkJsxName } from './author-api';
export {
  parseAnimSparkImports,
  parseAnimSparkImportsFromSource,
  animsparkImportsToComponentImports,
  npmNameToPackageName,
  importedNameToComponentName,
  suggestAuthorImport,
  type ParsedAnimSparkImport,
} from './parse-package-imports';
export {
  inferDomainPackagesFromShotSources,
  mergeLoadedPackages,
  shotSourcesUseComponent,
} from './infer-packages';
export {
  splitComponentPath,
  generatePackageDoc,
  generateComponentDoc,
  componentDoc,
  functionDoc,
} from './docs';