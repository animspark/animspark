/**
 * Host-side Scene package loading. The engine itself knows nothing about packages; the host scans
 * node_modules and decides which ones to load.
 *
 * Two layers:
 *   1. Installed - scene-discovery scans node_modules and reads manifests (imports no code);
 *   2. Enabled   - ANIMSPARK_ENABLED_PACKAGES picks the packages to register (default: all).
 * Official packages are only read via their manifest (vocabulary, playback entry); only
 * third-party packages the host names explicitly get imported.
 *
 * Each package's playback entry is resolved from its own manifest (playback), with no hardcoded
 * official package names: whatever is installed is discovered, and enabling it is enough.
 */
import type { ScenePackage, DiscoveredPackage } from '@animspark/scene-engine';
import { discoverScenePackages } from './scene-discovery';

/* 1. Detect: scan node_modules (reads JSON only, imports no code). */
const DISCOVERED: DiscoveredPackage[] = discoverScenePackages();

/* 2. Enable: restricted by ANIMSPARK_ENABLED_PACKAGES (comma-separated package names); default all. */
function applyEnableConfig(all: DiscoveredPackage[]): DiscoveredPackage[] {
  const raw = process.env.ANIMSPARK_ENABLED_PACKAGES?.trim();
  if (!raw) return all;
  const want = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  return all.filter((d) => want.has(d.name));
}
const ENABLED: DiscoveredPackage[] = applyEnableConfig(DISCOVERED);

/** Enabled package name -> discovered entry (for resolving playback entries). */
const BY_NAME = new Map<string, DiscoveredPackage>(ENABLED.map((d) => [d.name, d]));

/**
 * Which packages are enabled on this machine (manifest only, package code untouched).
 *
 * For callers that build a listing from manifests; the skill catalog is the first. All it needs
 * is tagline / whenToUse / extensions, which live in the manifest; listing them should not
 * import seven packages' runtimes.
 */
export function enabledPackages(): readonly DiscoveredPackage[] {
  return ENABLED;
}

/* ───────────────────── Vocabulary sponsorship (manifest.vocabulary) ─────────────────────
 * Bare npm words are no longer foundation constants: a package declares vocabulary, which is
 * allowed only while the package is enabled and disappears at compile time once it is disabled.
 * Entries match the specifier itself or a subpath prefix ('three' also covers 'three/addons/**'). */

function vocabularyMatches(word: string, specifier: string): boolean {
  return specifier === word || specifier.startsWith(`${word}/`);
}

/** specifier -> the *installed* package that sponsors it (enabled or not; used to name the owner in errors). */
/**
 * Bare import words allowed for third-party packages.
 *
 * `@muspark/core` is a **standalone** package we develop. It has zero dependency on AnimSpark and
 * should not carry an animspark manifest in its own package.json just to be allowed by the
 * platform. Allowing a word is the **platform's** decision (what to allow, when to revoke it),
 * so it belongs on this side.
 */
const THIRD_PARTY_VOCABULARY: ReadonlyArray<{ word: string }> = [
  { word: '@muspark/core' },
  /* d3 used to be allowed via @animspark/data; that package was removed in 2026-09 (the model
     writes charts better on its own), but the d3 library itself stays allowed. */
  { word: 'd3' },
  /* three / p5 each used to come in through a wrapper package; both wrappers were retired on
     2026-08-13. The words stay allowed: what was retired was the two `code={string}` components,
     not the libraries themselves. */
  { word: 'three' },
  { word: 'p5' },
];

export function vocabularySponsor(specifier: string): string | null {
  for (const d of DISCOVERED) {
    for (const word of d.manifest.vocabulary ?? []) {
      if (vocabularyMatches(word, specifier)) return d.name;
    }
  }
  for (const t of THIRD_PARTY_VOCABULARY) {
    if (vocabularyMatches(t.word, specifier)) return t.word;
  }
  return null;
}

/** Whether the specifier is allowed by the vocabulary of some *enabled* package. */
export function vocabularyEnabled(specifier: string): boolean {
  for (const d of ENABLED) {
    for (const word of d.manifest.vocabulary ?? []) {
      if (vocabularyMatches(word, specifier)) return true;
    }
  }
  return THIRD_PARTY_VOCABULARY.some((t) => vocabularyMatches(t.word, specifier));
}

export interface RuntimeModule {
  /** Package import name resolvable by esbuild/Node (including the manifest's main-entry subpath) */
  npm: string;
}

/** Web Runtime package entries for the given package names (undiscovered/disabled names are skipped). */
export function resolveRuntimeModules(
  packageNames: Iterable<string>,
): Array<RuntimeModule & { name: string }> {
  const out: Array<RuntimeModule & { name: string }> = [];
  for (const name of packageNames) {
    const d = BY_NAME.get(name);
    if (d) out.push({ name, npm: importSpecifier(d.npmName, d.manifest.playback) });
  }
  return out;
}

/** Appends the manifest entry ("./playback") to the npm name; missing or "." = main entry. */
function importSpecifier(npmName: string, subpath?: string): string {
  if (!subpath || subpath === '.' || subpath === './') return npmName;
  return npmName + subpath.replace(/^\./, '');
}

/**
 * Third-party packages: no animspark manifest; the host names them explicitly.
 *
 * `@muspark/ui` (score visualization) is a **standalone** package we develop. It has zero
 * dependency on AnimSpark, ships its own types and React wrapper, and works on its own. So it
 * should not carry an animspark manifest in its package.json just to be discovered; that would
 * push the coupling into it.
 *
 * The coupling belongs on this side: AnimSpark knows the package exists, the package does not
 * know AnimSpark exists. Its default export is structurally equivalent to `ScenePackage`
 * (TypeScript is structurally typed), so it loads like any other.
 *
 * Its one-line description is not copied here; we use the package's own `ScenePackage.doc`
 * (a copy would drift from the package's).
 */
const THIRD_PARTY_PACKAGES: ReadonlyArray<{ npm: string }> = [
  { npm: '@muspark/ui' },
];

/* A third-party package's main-entry default export = ScenePackage (top-level await, module initializes once). */

interface LoadedThirdParty {
  pkg: ScenePackage;
  npm: string;
}

/** Third-party packages that loaded (the skill catalog needs their doc; failed ones are absent). */
const LOADED_THIRD_PARTY: LoadedThirdParty[] = (
  await Promise.all(
    THIRD_PARTY_PACKAGES.map(async (entry): Promise<LoadedThirdParty | null> => {
      /* Don't throw on load failure: third-party packages are optional. Missing one only means
         one kind of visual is unavailable; it should not keep the whole service from starting. */
      const mod = await import(entry.npm).catch(() => null);
      const pkg = (mod?.default ?? null) as ScenePackage | null;
      return pkg ? { pkg, npm: entry.npm } : null;
    }),
  )
).filter((e): e is LoadedThirdParty => e != null);

/**
 * Third-party packages that loaded, for the skill catalog.
 *
 * Kept separate from `enabledPackages()` because the metadata comes from different places: those
 * are read from manifests (no code imported), these only from the loaded `ScenePackage` (they
 * have no manifest).
 */
export function loadedThirdPartyPackages(): ReadonlyArray<{
  npmName: string;
  packageName: string;
  doc: string;
}> {
  return LOADED_THIRD_PARTY.map((e) => ({
    npmName: e.npm,
    packageName: e.pkg.name,
    doc: e.pkg.doc,
  }));
}
