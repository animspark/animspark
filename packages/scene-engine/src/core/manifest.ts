/**
 * Package manifest (the "animspark" field in package.json): the package's "matching profile" metadata.
 *
 * Product identity is fixed at three layers:
 *   Developer (source) -> Package (distribution / domain) -> Extension (a capability family users can understand).
 * Component / Function are author APIs inside an Extension and don't enter the product taxonomy.
 *
 * Three-stage lifecycle (see the PACKAGE spec):
 *   1. Installed - scan node_modules and build the catalog by reading only the animspark field of package.json, without importing code;
 *   2. Enabled   - a separate config (animspark.config) selects which packages to register;
 *   3. Loaded    - only after a film's read_doc / match hits is the package code imported to get the full ScenePackage docs.
 *
 * So the lightweight info the matching agent needs (name + one-liner + component/function names) lives here and only needs a JSON read;
 * installing a thousand packages means reading a thousand small JSON files. Heavy docs (usage/objectModel/example/cases) stay in ScenePackage and load only once enabled.
 */
export interface AnimSparkDeveloperManifest {
  /** Stable developer id, also the first segment of the canonical Extension id (e.g. animspark). */
  id: string;
  /** User-facing source name; the Package card shows `from <name>`. */
  name: string;
}

export interface AnimSparkExtensionManifest {
  /** User-facing Extension name. */
  title: string;
  /** One sentence on what professional expression problem this capability family solves. */
  tagline: string;
  /** Component API names belonging to this Extension. */
  components?: string[];
  /** Function API names belonging to this Extension. */
  functions?: string[];
}

export interface AnimSparkPackageManifest {
  /** Marker: this is a Scene package (discovery scanning filters node_modules by it) */
  scenePackage: true;
  /** Package developer / publisher; the UI shows `from developer.name`. */
  developer: AnimSparkDeveloperManifest;
  /** Runtime package name = ScenePackage.name; official top-level packages use <scope>/<name> (e.g. animspark/stem). */
  packageName: string;
  /** Derived field (parsed from the package name): math|cs|misc for domain packages, empty for flat base packages (indexed under "General"). Hand-filled values are overwritten. */
  category?: string;
  /** One-line positioning = the pkg.doc shown in the index (the matching agent's main criterion) */
  tagline: string;
  /** Keywords (search / matching aid) */
  keywords?: string[];
  /** Component name list (names only, for index display; the actual components live in code) */
  components?: string[];
  /** Function name list (names only, for index display; the actual functions live in code) */
  functions?: string[];
  /**
   * The user-facing product-layer Extension catalog. The key is the third segment of the canonical Extension id:
   * developer.id / last segment of packageName / extension key, e.g. animspark/stem/code.
   */
  extensions: Record<string, AnimSparkExtensionManifest>;
  /** Tool names this package contributes to the agent (if any; implementations live in the serverTools entry) */
  tools?: string[];
  /** Import subpath of the player bundle entry (an export subpath, e.g. "./browser"); defaults to the main entry ".", whose default export = ScenePackage */
  playback?: string;
  /**
   * Optional per-capability player entries. key = component/function name, value = export subpath.
   * Lets one product Package keep unified naming while avoiding bundling other heavy runtimes into the player when only a light capability is used.
   */
  playbackByCapability?: Record<string, string>;
  /** Import subpath of the server-side bake renderer entry (e.g. "./bake"); the module exports `bakers: BakerRegistry`, server-only, never in the browser bundle */
  bake?: string;
  /** Import subpath of the server-side tool implementation entry (e.g. "./server"); the module exports `tools: ToolRegistry` and optional `systemDoc`, server-only */
  serverTools?: string;
  /**
   * Bare npm vocabulary (import specifiers) sponsored by this package.
   * The host's author import allowlist = base vocabulary + the vocabulary of all enabled packages:
   * a word is allowed only while its package is enabled; when the package is disabled, the bare npm words it sponsors disappear at compile time (no runtime black screen).
   * Entries match "the specifier itself or as a subpath prefix" (e.g. "three" also covers "three/addons/**").
   */
  vocabulary?: string[];
  /**
   * Path to the manual relative to the package root, when it lives elsewhere. **Normally leave this unset**: a `SKILL.md` at the package root takes effect automatically.
   *
   * Not requiring registration is deliberate: if "write a manual" and "register it in the manifest" had to agree, forgetting
   * the second half would leave the file sitting in the package while the model is told the package has no manual, with no error anywhere. The file
   * being there is the declaration itself.
   *
   * It's a **file path**, not an export subpath: the manual is markdown for the model to read, not a module. Going through exports
   * would mean inventing a fake export in package.json for a piece of text. With a .md sitting next to the code,
   * whoever changes the usage sees it right away.
   *
   * Packages without a manual still enter the skill catalog. The point of writing a manual is to supply what the API contract can't:
   * when to use this package instead of drawing it yourself, and the common ways things go wrong in this domain.
   */
  skill?: string;
  /** Compatible engine runtime version (semver range, checked against playback's RUNTIME_VERSION; default = no constraint declared). */
  engine?: string;
}

/** Minimal read shape of package.json (may include the animspark field) */
export interface AnimSparkAwarePackageJson {
  name?: string;
  version?: string;
  animspark?: Partial<AnimSparkPackageManifest> & { scenePackage?: boolean };
  [k: string]: unknown;
}

/** Type guard: does this package.json declare a Scene package (used for filtering during discovery). */
export function isAnimSparkPackage(pkgJson: AnimSparkAwarePackageJson | undefined | null): pkgJson is AnimSparkAwarePackageJson & { animspark: AnimSparkPackageManifest } {
  const s = pkgJson?.animspark;
  return !!s
    && s.scenePackage === true
    && typeof s.developer?.id === 'string'
    && typeof s.developer?.name === 'string'
    && typeof s.packageName === 'string'
    && typeof s.tagline === 'string'
    && !!s.extensions
    && typeof s.extensions === 'object';
}

/** Discovery catalog entry: a Scene package found on disk (not yet enabled/loaded). */
export interface DiscoveredPackage {
  /** Runtime package name (= manifest.packageName) */
  name: string;
  /** npm package name (the directory/package name in node_modules) */
  npmName: string;
  /** Absolute path of the package root */
  dir: string;
  /** Parsed manifest */
  manifest: AnimSparkPackageManifest;
}
