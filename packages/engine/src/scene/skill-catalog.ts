/**
 * Skill registry: the single source of truth for which skills exist and where their bodies live.
 *
 * One skill = one directory = one package: `SKILL.md` (frontmatter + body), an optional cover
 * `cover.jpg`, optional `refs/<film>/` (example films: `film.md` + source + ledger), and
 * `references/` and `APIs/` (on-demand manuals).
 * Three sources: Scene package roots (data / stem / ...), `prompts/skills/` (libraries without a
 * Scene package, and method skills), and third-party packages without a manifest (@muspark/ui).
 *
 * SKILL.md uses the standard name / description; animspark-id in metadata keeps the old API / npm
 * identifier, and the other product fields live in metadata too. Automatic loading (foundation,
 * film types), user selection and skill_get all materialize the docs and resources into
 * `skills/<skillName>/` without installing npm dependencies. The native harness discovers
 * workspace skills and reads full text on demand.
 *
 * There is only one concept, the skill; the catalog `type` splits it into four kinds (foundation /
 * film type / style / MG component), which decide who sees it and how it enters the workspace.
 * See SkillCatalogEntry.type.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, type Stats } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { isHostShared } from '../film/host-shared';
import { allowedVendorSpec } from '../film/vendor-allowlist';
import { enabledPackages, loadedThirdPartyPackages } from './scene-packages';
import { agentSkillsEnabled, isAgentRole, type AgentRole } from '../agents/definitions';

/** Skill manuals may still name a leftover editor audience. That is not a product agent. */
export const SKILL_AUDIENCE_ROLES = ['editor', 'mg'] as const;
export type SkillAudienceRole = typeof SKILL_AUDIENCE_ROLES[number];
export type SkillAudience = SkillAudienceRole | readonly SkillAudienceRole[] | 'both';
const LEGACY_SHARED_ROLES: readonly SkillAudienceRole[] = SKILL_AUDIENCE_ROLES;
const isSkillAudienceRole = (value: unknown): value is SkillAudienceRole =>
  value === 'editor' || value === 'mg';
export type SkillAccessRole = AgentRole | 'editor';
export interface SkillAccessPolicy {
  /** Omitted only for legacy/admin callers. Role executors must supply this. */
  role?: SkillAccessRole;
  skillSearchEnabled?: boolean;
  skillGetEnabled?: boolean;
}

function sessionSkillsEnabled(role?: SkillAccessRole): boolean {
  if (role === undefined || role === 'editor') return true;
  return agentSkillsEnabled(role);
}

export function skillAudience(skill: { name: string; audience?: SkillAudience }): SkillAudience {
  return skill.audience ?? 'mg';
}

export function skillAllowed(skill: { name: string; audience?: SkillAudience }, access: SkillAccessPolicy = {}): boolean {
  if (access.role !== undefined && access.role !== 'editor' && !isAgentRole(access.role)) throw new Error('Unknown skill agent role.');
  if (!sessionSkillsEnabled(access.role)) return false;
  const audience = skillAudience(skill);
  const roles: readonly SkillAudienceRole[] = audience === 'both' ? LEGACY_SHARED_ROLES : typeof audience === 'string' ? [audience] : audience;
  return !access.role || roles.includes(access.role);
}

export function assertSkillAccess(skill: { name: string; audience?: SkillAudience }, access: SkillAccessPolicy = {}): void {
  if (!skillAllowed(skill, access)) throw new Error(`Skill ${skill.name} is not available to the ${access.role} agent.`);
}

export function assertSkillOperation(access: SkillAccessPolicy, operation: 'search' | 'get'): void {
  if (!sessionSkillsEnabled(access.role) || (operation === 'search' ? access.skillSearchEnabled === false : access.skillGetEnabled === false)) {
    throw new Error(`skill_${operation} is disabled for this agent session.`);
  }
}


/** UI language (short code, e.g. zh / es) -> user-visible title and tagline. Missing languages fall back to English. */
export type SkillI18n = Readonly<Record<string, { title?: string; tagline?: string }>>;

export interface SkillCatalogEntry {
  /** metadata.audience controls search, installation and reads, not only announcement. */
  audience?: SkillAudience;
  /**
   * The id, unique: `@namespace/name`, written like an npm scoped package (`@animspark/vox-sticker`,
   * `@animspark/three`, `@muspark/core`). Every skill has an author scope: we wrote the manual on
   * three, someone else can have `@river/three`. For skills with an npm package, the id and import
   * word are usually the same; when they differ, see `npmName`.
   */
  name: string;
  /**
   * Install directory in the workspace, relative to `skills/`: the id without `@`
   * (`animspark/vox-sticker`). The path is always `skills/<skillName>/SKILL.md`.
   */
  skillName: string;
  /** Ids from before the rename (`web/html-in-canvas`, `matter-js`): only for recognizing old messages
   * and migrating old directories; never in new output. */
  aliases?: readonly string[];
  /** Standard model-visible description, including when to use the skill. */
  description: string;
  /** Explicit selection can use this skill; automatic discovery should omit it. */
  disableModelInvocation?: boolean;
  /** User-facing title (English). Users shouldn't need package names; they need "what this can do". */
  title: string;
  /** English one-liner for the product catalog; the model's trigger condition uses description. */
  tagline: string;
  /**
   * Package-level: the word that ends up in code imports (= npm package name). Same as the name
   * when the name is itself the npm name; null for platform capabilities (web/...), which have no
   * npm package. The UI's skill chip expands to this word.
   */
  npmName?: string | null;
  /** Package-level: name of the runtime package that provides it. */
  packageName?: string;
  /** Package-level: capability families this package brings (display names from manifest.extensions). */
  capabilities?: readonly string[];
  /** Localized title / tagline for the UI to choose from; the model always sees the English one. */
  i18n?: SkillI18n;
  /**
   * Position in the catalog (frontmatter `order`). Ascending within a type; unset ones go last, by
   * name. Use it to move polished skills to the front: catalog order is iteration order.
   */
  order?: number;
  /**
   * Reference films: finished-film ids from the showcase, frontmatter `films: a, b, c`. They are the
   * first thing the UI shows when this skill is opened: watching a film shows what a craft looks
   * like faster than a sentence. Hand-picked, listed in order of how worth watching they are.
   */
  films?: readonly string[];
  /** Whether the skill ships a `cover.(jpg|png|webp)` next to its manual (a card image for skill browsers). */
  cover?: boolean;
  /**
   * Type (catalog `type`): decides who sees it and how it enters the workspace; see
   * prompts/skills/README.md:
   *   foundation - the scene contract, mg. Not on the shelf; installed in every workspace
   *                automatically, listed at the end of the system prompt. three / p5 / matter-js /
   *                scores / html-in-canvas are capabilities of mg, not skills;
   *   film       - film type: how to make a whole film (product promo). Installed only when picked;
   *   style      - style: how the film looks (collage explainer). Installed only when picked;
   *   component  - MG component: one visual inside a film (data charts). Installed when picked, or
   *                as a dependency without being announced.
   * Unset (third-party manuals) is treated like the user-picked kinds.
   */
  type?: SkillType;
  /**
   * Exists only on these hosts (catalog `hosts: desktop`). Unset = available everywhere.
   * Off-host skills are not in the catalog, can't be installed, and aren't announced;
   * html-in-canvas depends on the browser version the desktop app pins.
   */
  hosts?: readonly SkillHost[];
  /**
   * Parts of the directory installed only on some hosts
   * (catalog `hostPaths: { "capabilities/html-in-canvas": "desktop" }`).
   * A manual line that belongs only to some hosts ends with `<!-- hosts: desktop -->`; on other
   * hosts that line is removed at install time.
   */
  hostPaths?: Readonly<Record<string, readonly SkillHost[]>>;
  /**
   * Store category (frontmatter `category`, one of SKILL_CATEGORIES): which UI navigation chip it
   * goes under. The axis is "what the user uses it for"; unset or invalid values go under "Other".
   */
  category?: SkillCategory;
  /**
   * Skills this depends on (frontmatter `requires: a, b`), like a Python package's requirements.
   * "The sticker style uses world maps and data charts", but how to draw a map is the map skill's
   * job: this one only describes how they interface, without copying the other's content. Installing
   * this installs the dependency closure too; whether to read them depends on the subject, and the
   * model decides.
   */
  requires?: readonly string[];
  /**
   * Example films (`refs/<name>/`, each with a `film.md` + source + ledger). Frontmatter
   * `refs: a, b` sets the order (recommended reading order); otherwise by directory name. Only
   * directories that actually have a `film.md` are listed.
   */
  refs?: readonly string[];
}

export const SKILL_TYPES = ['foundation', 'film', 'style', 'component'] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/** Types that enter the workspace automatically: only the foundation. Film types, styles and
 * components come in by user choice (or as dependencies). */
export function isAutomaticSkill(skill: Pick<SkillCatalogEntry, 'type'>): boolean {
  return skill.type === 'foundation';
}

export const SKILL_HOSTS = ['desktop', 'web'] as const;
export type SkillHost = (typeof SKILL_HOSTS)[number];

/** The host this process runs in. The AnimSpark desktop app sets `ANIM_DESKTOP=1`; everything else, including the open-source CLI, is the default host. */
export function currentSkillHost(): SkillHost {
  return process.env.ANIM_DESKTOP === '1' ? 'desktop' : 'web';
}

export function skillOnHost(skill: Pick<SkillCatalogEntry, 'hosts'>, host: SkillHost = currentSkillHost()): boolean {
  return !skill.hosts?.length || skill.hosts.includes(host);
}

/**
 * Store categories (frontmatter `category`): the UI's navigation chips. They only give a rough area,
 * split by "what the user uses it for": basics / marketing / explainer / business data / editing /
 * creative visuals / music and audio. Skills themselves aren't restricted by kind (a particular
 * explainer style, a way to make a kind of film, a component library are all fine); this only
 * helps users find them. Unset or out-of-list values go under "Other" in the UI; categories with
 * no members are hidden.
 */
export const SKILL_CATEGORIES = ['basics', 'marketing', 'explainer', 'business', 'editing', 'creative', 'audio'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Catalog entry + body. Only `anim skill get` and the /dev docs site need the body. */
export interface Skill extends SkillCatalogEntry {
  /** Full manual text (frontmatter stripped). */
  body: string | null;
  /** Absolute path of the body file; null = no bundled manual. Shown as the source on the dev page. */
  path: string | null;
}

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Bare libraries without a Scene package (matter-js / muspark and the like). The entry ticket is
 * still a SKILL.md; the manual just ships with the service rather than with a scene package.
 */
const SKILLS_DIR = join(here, '../..', 'prompts/skills');

/**
 * Host manual directories: the one in the repo, plus `ANIMSPARK_EXTRA_SKILLS_DIR` (optional).
 *
 * The extra one is for skills still being polished: drafts are iterated and tested outside the
 * repo and moved into prompts/skills once validated. Tests also use it to build fixtures with
 * dependencies: each test process points at its own directory instead of writing temp files into
 * the real one (where a parallel test file would see them).
 */
function hostSkillDirs(): string[] {
  const extra = process.env.ANIMSPARK_EXTRA_SKILLS_DIR?.trim();
  return extra ? [SKILLS_DIR, extra] : [SKILLS_DIR];
}
const requireFromHere = createRequire(import.meta.url);

/* Standard YAML owns name/description. Product fields live under metadata;
 * the old flat literal format remains readable for existing project snapshots. */

interface Frontmatter {
  audience?: SkillAudience;
  /** Agent Skills name: the last directory segment, lowercase with hyphens. */
  name?: string;
  /** `metadata.namespace`: author / organization scope; combined with name into `@namespace/name`. */
  namespace?: string;
  /** `metadata.import`: the word films use to import the package this skill teaches; platform
   * capabilities and method skills have none. */
  importSpec?: string;
  /** `metadata.animspark-id`: ids from before the rename, only for recognizing old messages and
   * migrating old directories. */
  aliases?: string[];
  description?: string;
  standard?: boolean;
  disableModelInvocation?: boolean;
  title?: string;
  tagline?: string;
  /** `order: 1`: catalog position; see SkillCatalogEntry.order. */
  order?: number;
  /** `films: a, b, c`: reference films (showcase ids); see SkillCatalogEntry.films. */
  films?: string[];
  /** `type: film`: type; see SkillCatalogEntry.type. Unrecognized values are ignored. */
  type?: SkillType;
  /** `hosts: desktop`: hosts; see SkillCatalogEntry.hosts. */
  hosts?: SkillHost[];
  /** `hostPaths`: per-host subdirectories; see SkillCatalogEntry.hostPaths. */
  hostPaths?: Record<string, SkillHost[]>;
  /** `category: mg`: store category; see SkillCatalogEntry.category. Unrecognized values are ignored. */
  category?: SkillCategory;
  /** `requires: a, b`: skill dependencies; see SkillCatalogEntry.requires. */
  requires?: string[];
  /** `refs: a, b`: example film order; see SkillCatalogEntry.refs. */
  refs?: string[];
  i18n: Record<string, { title?: string; tagline?: string }>;
}

const splitIds = (value: string): string[] => value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

/**
 * Applies a key-value table (document+metadata from a source manual's frontmatter, or the
 * catalog.json next to it) onto a Frontmatter. SKILL.md itself carries only name/description;
 * store data belongs in catalog.json. The old format is still tolerated here because old installed
 * copies and third-party manuals may still use it.
 */
function applyFrontValues(front: Frontmatter, values: Record<string, unknown>): void {
  if (values.hostPaths !== undefined) {
    const raw = values.hostPaths;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Skill hostPaths must map a path to hosts.');
    const out: Record<string, SkillHost[]> = {};
    for (const [path, hosts] of Object.entries(raw as Record<string, unknown>)) {
      const list = (Array.isArray(hosts) ? hosts.map(String) : splitIds(String(hosts)))
        .filter((h): h is SkillHost => (SKILL_HOSTS as readonly string[]).includes(h));
      const clean = path.replace(/^\/+|\/+$/g, '');
      if (!clean || clean.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Invalid hostPaths entry: ${path}`);
      if (list.length) out[clean] = list;
    }
    front.hostPaths = out;
  }
  if (values.audience !== undefined) {
    const value = values.audience;
    if (value === 'both' || isSkillAudienceRole(value)) front.audience = value;
    else if (Array.isArray(value) && value.length && value.every(isSkillAudienceRole) && new Set(value).size === value.length) front.audience = value;
    else throw new Error('Skill audience must name registered roles, a non-empty role list, or legacy both.');
  }

  for (const [key, rawValue] of Object.entries(values)) {
    if (!['string', 'number', 'boolean'].includes(typeof rawValue)) continue;
    const value = String(rawValue).trim();
    if (key === 'namespace') front.namespace = value.replace(/^@/, '');
    else if (key === 'import') front.importSpec = value;
    else if (key === 'animspark-id') front.aliases = splitIds(value.replace(/,/g, ' '));
    else if (key === 'title') front.title = value;
    else if (key === 'tagline') front.tagline = value;
    else if (key === 'order') {
      const n = Number(value);
      if (Number.isFinite(n)) front.order = n;
    } else if (key === 'films') {
      const ids = splitIds(value);
      if (ids.length) front.films = ids;
    } else if (key === 'requires') {
      const ids = splitIds(value);
      if (ids.length) front.requires = ids;
    } else if (key === 'refs') {
      const ids = splitIds(value);
      if (ids.length) front.refs = ids;
    } else if (key === 'type') {
      if ((SKILL_TYPES as readonly string[]).includes(value)) front.type = value as SkillType;
    } else if (key === 'hosts') {
      const hosts = splitIds(value).filter((h): h is SkillHost => (SKILL_HOSTS as readonly string[]).includes(h));
      if (hosts.length) front.hosts = hosts;
    } else if (key === 'category') {
      if ((SKILL_CATEGORIES as readonly string[]).includes(value)) front.category = value as SkillCategory;
    } else if (key === 'disable-model-invocation' && rawValue === true) {
      front.disableModelInvocation = true;
    } else {
      const local = /^(title|tagline)_([a-z]{2})$/.exec(key);
      if (local) {
        const bucket = front.i18n[local[2]!] ?? (front.i18n[local[2]!] = {});
        bucket[local[1] as 'title' | 'tagline'] = value;
      }
    }
  }
}

export function parseSkillFile(text: string): { front: Frontmatter; body: string } {
  const front: Frontmatter = { i18n: {} };
  const normalized = text.replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!match) return { front, body: text };
  const header = match[1];
  const standard = /^(description|metadata|disable-model-invocation|files):/m.test(header);
  let values: Record<string, unknown>;
  if (standard) {
    const parsed: unknown = parseYaml(header);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Skill frontmatter must be a YAML mapping.');
    const document = parsed as Record<string, unknown>;
    const metadata = document.metadata;
    if (metadata != null && (typeof metadata !== 'object' || Array.isArray(metadata))) throw new Error('Skill metadata must be a YAML mapping.');
    values = { ...document, ...(metadata as Record<string, unknown> | undefined) };
    front.name = typeof document.name === 'string' ? document.name : undefined;
    front.description = typeof document.description === 'string' ? document.description : undefined;
    front.standard = true;
  } else {
    values = parseFrontmatterLines(normalized).front;
    front.name = typeof values.name === 'string' ? values.name : undefined;
  }
  applyFrontValues(front, values);

  const body = normalized.slice(match[0].length).replace(/^\n+/, '');
  return { front, body };
}

/** Where store data lives: catalog.json next to the manual. SKILL.md is the agent's manual and
 * doesn't carry UI fields. */
export const SKILL_CATALOG_FILE = 'catalog.json';

/**
 * catalog.json next to SKILL.md -> store fields overlaid onto front.
 * Absent means nothing to overlay: we don't touch third-party manuals, whose metadata can still be
 * read from frontmatter.
 */
export function overlaySkillCatalog(front: Frontmatter, skillPath: string | null): Frontmatter {
  if (!skillPath) return front;
  let raw: string;
  try { raw = readFileSync(join(dirname(skillPath), SKILL_CATALOG_FILE), 'utf8'); } catch { return front; }
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error(`${SKILL_CATALOG_FILE} must be a JSON object.`); }
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`${SKILL_CATALOG_FILE} must be a JSON object.`);
  applyFrontValues(front, values as Record<string, unknown>);
  return front;
}

/** One directory segment: the Agent Skills name rule. */
const SKILL_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** First-party skills without a namespace get this scope. */
export const DEFAULT_SKILL_NAMESPACE = 'animspark';

/**
 * Canonical id form: `@scope/name`. A missing `@` (`animspark/stem`) is added; bare names stay as is.
 * This is how npm scoped packages are written, the namespace syntax models know best from pretraining.
 */
export function normalizeSkillId(id: string): string {
  const trimmed = id.trim();
  return trimmed.includes('/') && !trimmed.startsWith('@') ? `@${trimmed}` : trimmed;
}

/** `@scope/name` -> `scope`; null if not scoped. */
function scopeOf(id: string | null | undefined): string | null {
  const match = id ? /^@([^/]+)\//.exec(id.trim()) : null;
  return match ? match[1]! : null;
}

const slug = (segment: string): string => segment.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** id -> install directory (relative to skills/): no `@` in the path, each segment slugified, the
 * namespace is the parent directory. */
export function skillDirName(id: string): string {
  return normalizeSkillId(id).replace(/^@/, '').split('/').filter(Boolean).map(slug).join('/');
}

/** Every segment valid and total length bounded: installed directory names must work on any file
 * system and must not traverse out. */
export function isValidSkillDir(dir: string): boolean {
  const segments = dir.split('/');
  return dir.length <= 128 && segments.length >= 1
    && segments.every((segment) => SKILL_SEGMENT.test(segment) && segment.length <= 64);
}

/** install directory -> id: `animspark/stem` -> `@animspark/stem`; bare directories without a
 * namespace stay as is. */
export function skillIdOfDir(dir: string): string {
  return dir.includes('/') ? `@${dir}` : dir;
}

/**
 * A skill's identity: `@namespace/name`.
 *   name       - frontmatter `name` (or the source directory name), the Agent Skills segment;
 *   namespace  - `metadata.namespace`; otherwise inferred from the scope of the old id or the npm
 *                package name, falling back to animspark.
 * Install directory = `namespace/name`.
 */
function skillIdentity(front: Frontmatter, sourceDirName: string, npmName?: string | null) {
  /* frontmatter name may be the full `@scope/leaf`; bare names are inferred from the source as before. */
  const scoped = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(front.name ?? '');
  const leaf = slug(scoped ? scoped[2]! : (front.name || sourceDirName));
  const namespace = slug(scoped ? scoped[1]! : (front.namespace || scopeOf(front.aliases?.[0]) || scopeOf(npmName) || DEFAULT_SKILL_NAMESPACE));
  const skillName = `${namespace}/${leaf}`;
  if (!isValidSkillDir(skillName)) throw new Error(`Invalid skill directory name: ${skillName}`);
  return {
    name: `@${skillName}`,
    skillName,
    description: front.description || front.tagline || '',
    ...(front.aliases?.length ? { aliases: front.aliases } : {}),
    ...(front.disableModelInvocation ? { disableModelInvocation: true } : {}),
  };
}

/** Every name this skill has gone by (lowercase): id, directory, last segment, import word, old ids.
 * Used to recognize old messages and old install records. */
export function skillIdForms(skill: Pick<SkillCatalogEntry, 'name' | 'skillName' | 'npmName' | 'aliases'>): Set<string> {
  const forms = new Set<string>([skill.name, skill.skillName, skill.skillName.split('/').pop()!]);
  if (skill.npmName) forms.add(skill.npmName);
  for (const alias of skill.aliases ?? []) { forms.add(alias); forms.add(normalizeSkillId(alias)); }
  return new Set([...forms].map((form) => form.toLowerCase()));
}

/** What `skill_search` searches: every skill with a body. */
export function searchableSkills(access: SkillAccessPolicy = {}): Skill[] {
  assertSkillOperation(access, 'search');
  return allSkills(access).filter((s) => s.body && !s.disableModelInvocation);
}

/* ───────────────────────── Package-level skills ─────────────────────────
 * Three sources merge into one plugin catalog:
 *   1. SKILL.md at Scene package roots (data / stem / ...)
 *   2. host prompts/skills (bare libraries without a Scene package, like matter-js / muspark)
 *   3. third-party packages without a manifest (@muspark/ui), manual at their own package root
 *
 * No manual, no catalog entry: a package without one could only get a "go read the docs" line,
 * and that path has been removed. */
/**
 * The import word for this id; null if there is none (platform capabilities).
 *
 * name is the npm name, so it can be read off the name: `@`-prefixed is a scoped package, no `/`
 * is a bare package, an `npm/` prefix is stripped (the namespace added when a bare name collides),
 * and the rest (`web/...`, `local/...`) have no npm package.
 */
let hostPluginCache: { key: string; skills: Skill[] } | null = null;

function hostPluginCacheKey(dirs: string[]): string {
  return dirs
    .map((dir) => {
      try {
        const path = join(dir, 'SKILL.md');
        /* The cover, example films and store data (catalog.json) are files added to the directory
           later; their presence and changes go into the key too, otherwise adding an image or an
           example, or changing the order, would need a restart. */
        const catalog = join(dir, SKILL_CATALOG_FILE);
        return `${dir}:${statSync(path).mtimeMs}:${skillCoverFile(path) ? 'cover' : '-'}:${refsStamp(path)}`
          + `:${existsSync(catalog) ? statSync(catalog).mtimeMs : '-'}`;
      } catch {
        return `${dir}:missing`;
      }
    })
    .join('|');
}

/** Path of the cover image next to the manual (`cover.jpg|png|webp`); null if none. */
export function skillCoverFile(skillPath: string | null): string | null {
  if (!skillPath) return null;
  const dir = dirname(skillPath);
  for (const ext of ['jpg', 'png', 'webp', 'jpeg']) {
    const p = join(dir, `cover.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** The frontmatter fields the catalog carries (type, dependencies, example films, showcase films,
 * cover), shared by all three sources. */
function presentationOf(
  front: Frontmatter,
  skillPath: string | null,
): Pick<SkillCatalogEntry, 'type' | 'hosts' | 'hostPaths' | 'category' | 'requires' | 'refs' | 'films' | 'cover' | 'audience'> {
  const refs = refNamesOf(skillPath, front.refs);
  return {
    ...(front.audience ? { audience: front.audience } : {}),
    ...(front.type ? { type: front.type } : {}),
    ...(front.hosts?.length ? { hosts: front.hosts } : {}),
    ...(front.hostPaths && Object.keys(front.hostPaths).length ? { hostPaths: front.hostPaths } : {}),
    ...(front.category ? { category: front.category } : {}),
    ...(front.requires?.length ? { requires: front.requires } : {}),
    ...(refs.length ? { refs } : {}),
    ...(front.films?.length ? { films: front.films } : {}),
    ...(skillCoverFile(skillPath) ? { cover: true } : {}),
  };
}

/**
 * Example film names: directories under `refs/` that have a `film.md`. Uses the frontmatter order
 * if given (unlisted ones appended), otherwise directory name. The order is the recommended reading
 * order, and the install receipt lists them in it.
 */
function refNamesOf(skillPath: string | null, declared?: readonly string[]): string[] {
  if (!skillPath) return [];
  const root = join(dirname(skillPath), REFS_DIR);
  if (!existsSync(root)) return [];
  const present = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && existsSync(join(root, e.name, REF_DOC)))
    .map((e) => e.name)
    .sort();
  const ordered = (declared ?? []).filter((n) => present.includes(n));
  return [...ordered, ...present.filter((n) => !ordered.includes(n))];
}

/** Fingerprint of the example films: which ones, and each film.md's mtime. Part of the cache key,
 * so adding an example doesn't need a restart. */
function refsStamp(skillPath: string): string {
  const root = join(dirname(skillPath), REFS_DIR);
  if (!existsSync(root)) return '';
  return refNamesOf(skillPath).map((n) => {
    try {
      return `${n}@${statSync(join(root, n, REF_DOC)).mtimeMs}`;
    } catch {
      return `${n}@?`;
    }
  }).join(',');
}

function hostPluginSkills(): Skill[] {
  const found: Array<{ dir: string; name: string }> = [];
  for (const root of hostSkillDirs()) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md'))) found.push({ dir: join(root, entry.name), name: entry.name });
    }
  }
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));

  const key = hostPluginCacheKey(found.map((f) => f.dir));
  if (hostPluginCache?.key === key) return hostPluginCache.skills;

  const skills = found.map(({ dir: skillDir, name: dir }): Skill => {
    const path = join(skillDir, 'SKILL.md');
    const { front, body } = parseSkillFile(readFileSync(path, 'utf8'));
    overlaySkillCatalog(front, path);
    const identity = skillIdentity(front, dir);
    /* Host-directory manuals come in two kinds: those teaching an actually installed package
       (matter-js, three) and those teaching a platform capability (html-in-canvas). The former
       declare `import` in frontmatter; without it there is no import word. Don't guess, or
       filmCanImport might ask the compiler about an npm package that happens to share the name
       and filter out the whole manual. */
    const spec = front.importSpec ?? null;
    return {
      ...identity,
      ...(front.order != null ? { order: front.order } : {}),
      npmName: spec && resolveNpmDir(spec) ? spec : null,
      title: front.title || identity.name,
      tagline: front.tagline ?? identity.description,
      ...(Object.keys(front.i18n).length ? { i18n: front.i18n } : {}),
      ...presentationOf(front, path),
      body,
      path,
    };
  });
  hostPluginCache = { key, skills };
  return skills;
}

function resolveNpmDir(npmName: string): string | null {
  try {
    return dirname(requireFromHere.resolve(`${npmName}/package.json`));
  } catch {
    try {
      let dir = dirname(requireFromHere.resolve(npmName));
      for (let i = 0; i < 8; i++) {
        if (existsSync(join(dir, 'package.json'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      return null;
    }
  }
  return null;
}

let pluginCache: { key: string; skills: Skill[] } | null = null;

/**
 * Whether this scan found the same set as the last one, judged by each manual's mtime.
 *
 * Same approach as hostPluginCache (above), for the same reason: the catalog doesn't change within
 * a deployment, but scanning it reads every package's SKILL.md and parses its frontmatter. It sits
 * on four paths (catalog, body, fingerprint, lookup by name), and the prompt side asks for the
 * fingerprint every turn, so one conversation would read the same files dozens of times.
 *
 * Keyed on mtime rather than a time-based expiry: during development a one-line manual edit should
 * take effect immediately, and an edited file's mtime always changes. The cost is still one stat
 * per file each time (dozens of stats, microseconds), replacing dozens of reads + parses.
 */
function pluginCacheKey(paths: readonly (string | null)[]): string {
  return paths
    .map((p) => {
      if (!p) return 'none';
      try {
        const catalog = join(dirname(p), SKILL_CATALOG_FILE);
        return `${p}:${statSync(p).mtimeMs}:${skillCoverFile(p) ? 'cover' : '-'}:${refsStamp(p)}`
          + `:${existsSync(catalog) ? statSync(catalog).mtimeMs : '-'}`;
      } catch {
        return `${p}:missing`;
      }
    })
    .join('|');
}

export function pluginSkills(): Skill[] {
  const packages = enabledPackages();
  const third = loadedThirdPartyPackages();
  /* Compute the host plugins first: their own cache key (hostPluginCache) must be part of this key,
     otherwise editing a manual in the host directory would leave this layer serving the old one.
     It is cached itself, so this is free. */
  const host = hostPluginSkills();
  const key = `${pluginCacheKey([
    ...packages.map((d) => (d.manifest.skill ? join(d.dir, d.manifest.skill) : join(d.dir, 'SKILL.md'))),
    ...third.map((p) => {
      const dir = resolveNpmDir(p.npmName);
      return dir ? join(dir, 'SKILL.md') : null;
    }),
  ])}#${hostPluginCache?.key ?? ''}`;
  if (pluginCache?.key === key) return pluginCache.skills;

  const fromPackages = packages.map((d): Skill => {
    const path = d.manifest.skill
      ? join(d.dir, d.manifest.skill)
      : join(d.dir, 'SKILL.md');
    let body: string | null = null;
    let front: Frontmatter = { i18n: {} };
    if (existsSync(path)) {
      const parsed = parseSkillFile(readFileSync(path, 'utf8'));
      body = parsed.body;
      front = overlaySkillCatalog(parsed.front, path);
    }
    /* scope comes from the package's npm name (@animspark/stem -> animspark); name from the manual,
       falling back to the package directory name. */
    const identity = skillIdentity(front, basename(d.dir), d.npmName);
    return {
      ...identity,
      description: identity.description || d.manifest.tagline,
      ...(front.order != null ? { order: front.order } : {}),
      npmName: d.npmName,
      title: front.title || identity.name,
      tagline: front.tagline || identity.description || d.manifest.tagline,
      packageName: d.manifest.packageName,
      capabilities: Object.values(d.manifest.extensions).map((ext) => ext.title),
      ...(Object.keys(front.i18n).length ? { i18n: front.i18n } : {}),
      ...presentationOf(front, body ? path : null),
      body,
      path: body ? path : null,
    };
  });

  const thirdParty = third.map((p): Skill => {
    const dir = resolveNpmDir(p.npmName);
    const path = dir ? join(dir, 'SKILL.md') : null;
    let body: string | null = null;
    let front: Frontmatter = { i18n: {} };
    if (path && existsSync(path)) {
      const parsed = parseSkillFile(readFileSync(path, 'utf8'));
      body = parsed.body;
      front = overlaySkillCatalog(parsed.front, path);
    }
    const identity = skillIdentity(front, p.npmName.split('/').pop()!, p.npmName);
    const name = identity.name;
    return {
      ...identity,
      description: identity.description || p.doc,
      ...(front.order != null ? { order: front.order } : {}),
      npmName: p.npmName,
      title: front.title || name,
      tagline: front.tagline || identity.description || p.doc,
      packageName: p.packageName,
      ...(Object.keys(front.i18n).length ? { i18n: front.i18n } : {}),
      ...presentationOf(front, body ? path : null),
      body,
      path: body ? path : null,
    };
  });

  const skills = [...fromPackages, ...host, ...thirdParty]
    .filter((s) => s.body)
    .filter((s) => filmCanImport(s.npmName ?? null))
    .sort((a, b) => a.name.localeCompare(b.name));
  pluginCache = { key, skills };
  return skills;
}

/**
 * Whether film compilation allows the import word this manual teaches.
 *
 * The catalog lists only what compiles: a manual whose first import gets blocked by anim check is
 * a trap, since the director only finds out the package doesn't exist after reading and writing.
 * The two ways through are the same two gates the compiler uses: the host-injected list
 * (HOST_SHARED_SPECS, for @animspark/* and @muspark/*) or the /film-vendor allowlist (single-file
 * builds like three / matter-js). Once a new package is on either list its manual returns to the
 * catalog automatically, with no change here. Skills with no npm word are platform capabilities
 * (web/html-in-canvas) and always pass.
 */
function filmCanImport(importSpec: string | null): boolean {
  if (!importSpec) return true;
  return isHostShared(importSpec) || allowedVendorSpec(importSpec);
}

/* ───────────────────────── Combined ───────────────────────── */

/**
 * Every skill on this host: grouped by type (foundation, film type, style, component, untyped),
 * ascending `order` within a group, unordered ones last by name. Off-host ones (html-in-canvas on
 * the web) are not here: they can't be looked up or installed.
 */
export function allSkills(access: SkillAccessPolicy = {}, options: { anyHost?: boolean; host?: SkillHost } = {}): Skill[] {
  if (!agentSkillsEnabled(access.role)) return [];
  const group = (s: Skill): number => (s.type ? SKILL_TYPES.indexOf(s.type) : SKILL_TYPES.length);
  /* anyHost: the /dev docs site needs every manual (html-in-canvas must be readable on the web too);
     catalog, install and announce never pass it. */
  return [...pluginSkills()].filter((skill) => options.anyHost || skillOnHost(skill, options.host))
    .map((skill) => ({ ...skill, audience: skillAudience(skill) }))
    .filter((skill) => skillAllowed(skill, access))
    .sort((a, b) => group(a) - group(b) || (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name));
}

/** Skills every workspace gets: the foundation on this host (mg). workspace-skills loads them into context. */
export function automaticSkills(access: SkillAccessPolicy = {}, host?: SkillHost): Skill[] {
  return allSkills(access, { host }).filter((s) => isAutomaticSkill(s) && s.body);
}

/**
 * Skills `anim new` installs into a local workspace and lists in its CLAUDE.md / AGENTS.md: all of
 * them — the foundations (mg, video-editing) and every component and style skill the engine ships.
 * A local agent has no shelf to pick from, and the engine only ships skills that were validated on
 * real films; their `requires` come along.
 */
export function localWorkspaceSkills(access: SkillAccessPolicy = {}, host?: SkillHost): Skill[] {
  return allSkills(access, { host }).filter((s) => Boolean(s.body));
}

/**
 * A skill in the catalog that doesn't belong to this host (html-in-canvas on the web). Used to
 * recognize leftover installs in a workspace and stop announcing them: a manual on disk must not
 * bypass the host restriction.
 */
export function offHostSkill(name: string): Skill | null {
  const want = normalizeSkillId(name.trim()).toLowerCase();
  return pluginSkills().find((s) => !skillOnHost(s) && skillIdForms(s).has(want)) ?? null;
}

/** Catalog entries (without bodies). */
export function skillCatalog(access: SkillAccessPolicy = {}): SkillCatalogEntry[] {
  return allSkills(access).map(({ body: _body, path: _path, ...entry }) => entry);
}

/**
 * Look up a manual by name. Returns null if not found; the caller decides what to say.
 *
 * Full names first, then the part without the namespace: a model that sees `animspark/document` in
 * the catalog quite often types `document` later, and rejecting it costs a whole turn just to say
 * "include the namespace". **Only a unique match counts**: the day two packages are both called
 * document, either guess is wrong, and that is exactly why namespaces exist.
 * Built-in manuals keep their own bare names and can't be taken by a package (pluginSkillId puts
 * colliding packages under `npm/`). Conversely, `data` is currently a free bare name, so it resolves
 * to the only skill with that tail, `@animspark/data`, which is what the model means by "data".
 */
export function findSkill(name: string, access: SkillAccessPolicy = {}): Skill | null {
  const raw = name.trim().toLowerCase();
  const want = normalizeSkillId(raw).toLowerCase();
  const all = allSkills(access);
  /* Full names first: id, install directory (without @), import word, old ids. */
  const exact = all.filter((s) => { const forms = skillIdForms(s); return forms.has(want) || forms.has(raw); });
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    const byId = exact.find((s) => s.name.toLowerCase() === want);
    if (byId) return byId;
  }
  /* Then the last segment (`data`, html-in-canvas of `web/html-in-canvas`): only a unique match counts. */
  const tail = raw.split('/').pop()!;
  const byLeaf = all.filter((s) => s.skillName.split('/').pop() === tail);
  return byLeaf.length === 1 ? byLeaf[0]! : null;
}

/** A skill's dependency closure (excluding itself), dependencies first, in declaration order,
 * deduplicated; unrecognized names are skipped. */
export function requiredSkills(skill: Pick<SkillCatalogEntry, 'name' | 'requires'>, access: SkillAccessPolicy = {}): Skill[] {
  const out: Skill[] = [];
  const seen = new Set<string>([skill.name]);
  const walk = (ids: readonly string[] | undefined): void => {
    for (const id of ids ?? []) {
      const dep = findSkill(id);
      if (!dep || seen.has(dep.name)) continue;
      assertSkillAccess(dep, access);
      seen.add(dep.name);
      walk(dep.requires);
      out.push(dep);
    }
  };
  walk(skill.requires);
  return out;
}

/* ───────────────────────── Install ─────────────────────────
 * Getting a skill = installing the whole package into the workspace at `skills/<name>/`:
 * SKILL.md + refs/<film>/ (film.md, source, ledger).
 * Like pip: dependencies in `requires` come along, and already-installed ones are reinstalled
 * (an updated skill should replace the old one).
 *
 * Why write to disk instead of putting the body into the conversation:
 *   - parts are copied with `cp` instead of being read into context and written back out; a 33k
 *     vox.tsx never touches the context;
 *   - after a new session or context compaction, manuals and examples are still on disk, one read away;
 *   - one way to read: read / glob / grep, with no separate syntax for reference films vs own code.
 * This directory is read-only in the workspace (write / edit refuse, bash only blocks writes into
 * it), is not compiled, is not part of ledger reconciliation (asset-sync only scans assets / mg),
 * and is committed with the project repo: what's installed is the version used to make this film. */

/** Directory in the workspace where skills are installed. */
export const SKILLS_INSTALL_DIR = 'skills';
const REFS_DIR = 'refs';
const REFERENCE_DIRS = ['references', 'APIs', 'example', 'capabilities'];
const REF_DOC = 'film.md';
/** Only these text files are taken from example films; media bytes are left out (the ledger records
 * the facts about them). */
const REF_TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|json|css|md|txt|svg|py|ya?ml)$/i;

/** An example film's `film.md` header: the lines that go into the install receipt and search index. */
export interface SkillRef {
  /** Directory name, also the name shown in the receipt. */
  name: string;
  /** The original brief, verbatim; search matches it against the user's query. */
  brief: string;
  /** Which aspect of the skill this film demonstrates. */
  shows: string;
  /** Files that can be copied as is (relative to this example's root). */
  copy: readonly string[];
  /** The matching finished-film id in the showcase (the UI plays the video). */
  film?: string;
  /** Text files in the example directory, relative to its root, sorted. */
  files: readonly string[];
}

function refDir(skill: Pick<Skill, 'path'>, name: string): string | null {
  if (!skill.path) return null;
  const dir = join(dirname(skill.path), REFS_DIR, name);
  return existsSync(join(dir, REF_DOC)) ? dir : null;
}

function listRefFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > 6 || out.length >= 400) return;
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(childRel, depth + 1); continue; }
      if (entry.isFile() && REF_TEXT_EXT.test(entry.name)) out.push(childRel);
    }
  };
  walk('', 0);
  return out.sort();
}

/** This skill's example films, in `refs` order; read from each `film.md` frontmatter. */
export function skillRefs(skill: Pick<Skill, 'path' | 'refs'>): SkillRef[] {
  const out: SkillRef[] = [];
  for (const name of skill.refs ?? []) {
    const dir = refDir(skill, name);
    if (!dir) continue;
    const { front } = parseRefDoc(readFileSync(join(dir, REF_DOC), 'utf8'));
    out.push({
      name,
      brief: front.brief ?? '',
      shows: front.shows ?? '',
      copy: front.copy ?? [],
      ...(front.film ? { film: front.film } : {}),
      files: listRefFiles(dir),
    });
  }
  return out;
}

/** `film.md` header: the same flat `key: value` format as SKILL.md; only these keys are read. */
export function parseRefDoc(text: string): { front: { brief?: string; shows?: string; copy?: string[]; film?: string }; body: string } {
  const { front: raw, body } = parseFrontmatterLines(text);
  const front: { brief?: string; shows?: string; copy?: string[]; film?: string } = {};
  if (raw.brief) front.brief = raw.brief;
  if (raw.shows) front.shows = raw.shows;
  if (raw.film) front.film = raw.film;
  if (raw.copy) {
    const ids = splitIds(raw.copy);
    if (ids.length) front.copy = ids;
  }
  return { front, body };
}

function parseFrontmatterLines(text: string): { front: Record<string, string>; body: string } {
  const front: Record<string, string> = {};
  if (!text.startsWith('---\n')) return { front, body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { front, body: text };
  for (const raw of text.slice(4, end).split('\n')) {
    const pair = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(raw);
    if (pair) front[pair[1]!] = pair[2]!.trim();
  }
  return { front, body: text.slice(end + 4).replace(/^\n+/, '') };
}

/** A skill as installed in the workspace. */
export interface InstalledSkill {
  name: string;
  skillName: string;
  /** Whether this call copied a new version or reused the existing snapshot. */
  status: 'installed' | 'updated' | 'unchanged';
  /** Workspace-relative path, `skills/<skillName>`. */
  dir: string;
  /** Whose `requires` caused this install; absent for directly requested skills. */
  requiredBy?: string;
  refs: SkillRef[];
  /** On-demand manuals and short examples, relative to the skill's install directory; bodies not injected. */
  references?: string[];
}

export interface InstallResult {
  /** Candidate names from the authorized catalog; error receipts cannot widen it. */
  available?: string[];
  installed: InstalledSkill[];
  /** Requested but not in the catalog. */
  missing: string[];
}

/** id (with or without `@`) -> install directory in the workspace, `skills/<skillName>`. */
export function installedSkillDir(name: string): string {
  const skillName = findSkill(name)?.skillName ?? skillDirName(name);
  if (!isValidSkillDir(skillName)) throw new Error(`Invalid skill directory name: ${name}`);
  return `${SKILLS_INSTALL_DIR}/${skillName}`;
}

const INSTALL_RECORD = '.animspark-install.json';
/* kit/: copyable parts of a style skill (the whole directory is copied into the project's mg/kit/
   and then edited), the same kind of thing as example-film source under refs/. */
const RESOURCE_DIRS = new Set([...REFERENCE_DIRS, 'refs', 'kit', 'scripts', 'assets', 'agents']);
interface SkillResource { path: string; bytes: Buffer; mode: number }

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function statEntry(path: string): Stats | null {
  try { return lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Resolve safe internal links to bytes. External links and directory cycles fail before writing. */
/** A line ending in `<!-- hosts: desktop -->` is kept only for the listed hosts; kept lines lose the marker. */
export function filterHostLines(text: string, host: SkillHost = currentSkillHost()): string {
  if (!text.includes('<!-- hosts:')) return text;
  return text.split('\n').flatMap((line) => {
    const mark = /\s*<!--\s*hosts:\s*([a-z,\s]+?)\s*-->\s*$/.exec(line);
    if (!mark) return [line];
    return splitIds(mark[1]!.replace(/,/g, ' ')).includes(host) ? [line.slice(0, mark.index)] : [];
  }).join('\n');
}

function offHostPath(skill: Pick<Skill, 'hostPaths'>, path: string, host: SkillHost): boolean {
  return Object.entries(skill.hostPaths ?? {}).some(([prefix, hosts]) => (path === prefix || path.startsWith(`${prefix}/`)) && !hosts.includes(host));
}

function skillResources(skill: Skill, requiredBy?: string): SkillResource[] {
  const root = realpathSync(dirname(skill.path!));
  const files: SkillResource[] = [];
  const host = currentSkillHost();
  const visit = (source: string, path: string, ancestors: Set<string>): void => {
    if (offHostPath(skill, path, host)) return;
    const canonical = realpathSync(source);
    if (!within(root, canonical)) throw new Error(`Skill resource escapes its source directory: ${path}`);
    const info = statSync(canonical);
    if (info.isDirectory()) {
      if (ancestors.has(canonical)) throw new Error(`Skill resource contains a directory cycle: ${path}`);
      const next = new Set(ancestors).add(canonical);
      for (const entry of readdirSync(canonical).sort()) visit(join(canonical, entry), `${path}/${entry}`, next);
    } else if (info.isFile()) {
      const bytes = readFileSync(canonical);
      files.push({ path, bytes: path.endsWith('.md') ? Buffer.from(filterHostLines(bytes.toString('utf8'), host), 'utf8') : bytes, mode: info.mode & 0o777 });
    } else throw new Error(`Unsupported skill resource: ${path}`);
  };
  visit(skill.path!, 'SKILL.md', new Set());
  for (const entry of readdirSync(root).sort()) {
    if (RESOURCE_DIRS.has(entry) || /^LICENSE(?:\.[\w-]+)?$/i.test(entry)) visit(join(root, entry), entry, new Set([root]));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  /* The manual itself is regenerated with metadata at the top (the file tree can only be drawn once
     all files are collected). */
  const manual = files.find((file) => file.path === 'SKILL.md')!;
  manual.bytes = Buffer.from(renderInstalledManual(skill, files.map((file) => file.path), requiredBy), 'utf8');
  return files;
}

/**
 * File tree of the install directory, placed in the metadata at the top of SKILL.md so the model
 * knows what the skill contains without running ls. Assets show only the index; the actual media
 * are still fully installed. The hidden install record is excluded.
 */
export function renderSkillFileTree(root: string, paths: readonly string[]): string {
  type Node = Map<string, Node>;
  const tree: Node = new Map();
  const directories = new Set<Node>();
  for (const path of paths) {
    const parts = path.split('/');
    const assets = parts.indexOf('assets');
    const indexOnly = assets >= 0 && parts.slice(assets + 1).join('/') !== 'index.jsonl';
    const visible = indexOnly ? parts.slice(0, assets + 1) : parts;
    let node = tree;
    for (const [index, part] of visible.entries()) {
      if (!node.has(part)) node.set(part, new Map());
      node = node.get(part)!;
      if (index < visible.length - 1 || indexOnly) directories.add(node);
    }
  }
  const lines = [`${root}/`];
  const walk = (node: Node, prefix: string): void => {
    const entries = [...node.entries()].sort(([a, an], [b, bn]) => Number(directories.has(an)) - Number(directories.has(bn)) || a.localeCompare(b));
    entries.forEach(([name, child], index) => {
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${name}${directories.has(child) ? '/' : ''}`);
      if (child.size) walk(child, `${prefix}${last ? '    ' : '│   '}`);
    });
  };
  walk(tree, '');
  return lines.join('\n');
}

/** Frontmatter at the top of an installed SKILL.md: name / description / files. */
export interface InstalledSkillMetadata {
  /** File tree of the install directory. */
  files: string;
}

export function installedSkillMetadata(skill: Skill, files: readonly string[]): InstalledSkillMetadata {
  return {
    files: renderSkillFileTree(`${SKILLS_INSTALL_DIR}/${skill.skillName}`, files),
  };
}

/** Files a skill would install (relative to the install directory). Used by the /dev page to draw
 * the file tree; writes nothing. */
export function installedSkillFiles(skill: Skill): string[] {
  return skill.path ? skillResources(skill).map((file) => file.path) : [];
}

/**
 * An installed SKILL.md is not a byte-for-byte copy of the source. Its frontmatter has only three
 * keys, name / description / files, which is all the model needs when opening it.
 * Store fields (title/tagline/order/films/type/hosts/requires/audience...) live in the source
 * directory's catalog.json and aren't installed. The file tree is computed from the files actually
 * written; a hand-written one would drift from the directory sooner or later.
 */
export function renderInstalledManual(skill: Skill, files: readonly string[], requiredBy?: string): string {
  const meta = installedSkillMetadata(skill, files);
  /* frontmatter keeps the full name, description and the actual file tree; the model's list reports
     the readable SKILL.md path separately. Dependency-only installs get an extra
     `metadata.required-by` line: it is committed with the project repo (the install record is a
     dotfile and stays out of the repo), the list uses it to skip the skill, and the model can see
     who brought it in. */
  const front: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
    ...(requiredBy ? { metadata: { 'required-by': requiredBy } } : {}),
    files: `${meta.files}\n`,
  };
  /* lineWidth: 0 = no wrapping: a description should be one line; wrapped YAML reads awkwardly and
     simple parsers don't handle it. */
  return `---\n${stringifyYaml(front, { lineWidth: 0 }).trimEnd()}\n---\n\n${filterHostLines(skill.body ?? '').trim()}\n`;
}

function resourceFingerprint(files: SkillResource[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(JSON.stringify([file.path, file.mode, file.bytes.length]));
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}

/** Check every path component without following workspace symlinks. */
function installedFile(root: string, path: string): Stats | null {
  let current = root;
  for (const component of path.split('/')) {
    current = join(current, component);
    const info = statEntry(current);
    if (!info || info.isSymbolicLink()) return null;
    if (current !== join(root, path) && !info.isDirectory()) return null;
  }
  return statEntry(current);
}

/**
 * Whether this skill is on disk **only** because another skill `requires` it (install record
 * `dependency: true`). Skills the user requested or the platform installed automatically don't have
 * this. The list announces only what the user picked, not dependency-only installs.
 */
export function installedAsDependency(workspace: string, skillName: string): boolean {
  return typeof installedRequiredBy(workspace, skillName) === 'string';
}

/** `required-by` recorded in the installed manual: string = dependency only; null = direct install;
 * undefined = not installed. */
function installedRequiredBy(workspace: string, skillName: string): string | null | undefined {
  let text: string;
  try { text = readFileSync(join(workspace, SKILLS_INSTALL_DIR, skillName, 'SKILL.md'), 'utf8'); } catch { return undefined; }
  const header = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n?/g, '\n'))?.[1];
  try {
    const value = (parseYaml(header ?? '') as { metadata?: Record<string, unknown> } | null)?.metadata?.['required-by'];
    return typeof value === 'string' && value ? value : null;
  } catch { return null; }
}

/** Install status for this install: a dependency install stays direct if it was previously installed directly. */
function effectiveRequiredBy(workspace: string, skillName: string, requiredBy: string | undefined): string | undefined {
  if (!requiredBy) return undefined;
  const existing = installedRequiredBy(workspace, skillName);
  return existing === null ? undefined : existing ?? requiredBy;
}

function materializeSkill(workspace: string, skill: Skill, files: SkillResource[]): InstalledSkill['status'] {
  const root = join(realpathSync(workspace), SKILLS_INSTALL_DIR);
  const rootInfo = statEntry(root);
  if (rootInfo && (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())) throw new Error(`${SKILLS_INSTALL_DIR}/ must be a real workspace directory.`);
  const dest = join(root, skill.skillName);
  const previous = statEntry(dest);
  if (previous && (!previous.isDirectory() || previous.isSymbolicLink())) throw new Error(`Skill destination must be a real directory: ${dest}`);
  const digest = resourceFingerprint(files);
  const recordPath = join(dest, INSTALL_RECORD);
  let record: { id?: string; digest?: string } = {};
  if (previous && installedFile(dest, INSTALL_RECORD)?.isFile()) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(recordPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed;
    } catch { /* Recover a corrupt installation record. */ }
  }
  /* Earlier install records use old id forms (matter-js, web/html-in-canvas); match against all of
     this skill's names. */
  const forms = skillIdForms(skill);
  if (record.id && !forms.has(record.id.toLowerCase())) throw new Error(`Skill directory ${skill.skillName} belongs to ${record.id}.`);
  if (previous && !record.id) {
    const manual = installedFile(dest, 'SKILL.md');
    if (!manual?.isFile()) throw new Error(`Skill directory already exists without a matching manual: ${dest}`);
    const { front } = parseSkillFile(readFileSync(join(dest, 'SKILL.md'), 'utf8'));
    /* A standard skill without an install record was placed by someone else: it's only ours if the
       frontmatter has our namespace or an old id. */
    /* Manuals we install use the full scoped id as name ("@animspark/video-editing", see
       renderInstalledManual). The install record is a dotfile and isn't in the project repo, so a
       project checked out from the repo has only this frontmatter. If we couldn't recognize it, the
       foundation manuals the platform installed could never be updated again (observed: installing
       a skill that depends on video-editing into a checked-out project failed with "external
       skill"). External standard skills use bare unscoped names and won't be mistaken for ours. */
    const claimed = [
      ...(front.namespace && front.name ? [`@${slug(front.namespace)}/${slug(front.name)}`] : []),
      ...(front.name?.startsWith('@') ? [front.name] : []),
      ...(front.aliases ?? []),
    ].map((id) => id.toLowerCase());
    if (front.standard && !claimed.some((id) => forms.has(id))) {
      throw new Error(`Skill directory ${skill.skillName} contains an external skill; its matching name does not authorize a catalog replacement.`);
    }
    if (!front.standard && !(front.name && forms.has(front.name.toLowerCase()))) {
      throw new Error(`Skill directory ${skill.skillName} belongs to ${front.name ?? 'an unknown skill'}.`);
    }
  }
  const unchanged = record.digest === digest && files.every((file) => {
    const info = installedFile(dest, file.path);
    return info?.isFile() && (info.mode & 0o777) === file.mode && readFileSync(join(dest, file.path)).equals(file.bytes);
  });
  if (unchanged) return 'unchanged';

  /* The namespace is a real directory level (skills/animspark/) and must exist before the rename. */
  mkdirSync(dirname(dest), { recursive: true });
  const staging = mkdtempSync(join(root, '.install-'));
  const next = join(staging, 'skill');
  const backup = join(staging, 'previous');
  let keepBackup = false;
  try {
    mkdirSync(next);
    for (const file of files) {
      const target = join(next, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
      chmodSync(target, file.mode);
    }
    writeFileSync(join(next, INSTALL_RECORD), JSON.stringify({ id: skill.name, skillName: skill.skillName, digest }, null, 2));
    if (previous) renameSync(dest, backup);
    try { renameSync(next, dest); } catch (error) {
      if (previous) {
        try { renameSync(backup, dest); } catch (restoreError) {
          keepBackup = true;
          throw new AggregateError([error, restoreError], `Skill update failed; previous files are preserved at ${backup}`);
        }
      }
      throw error;
    }
  } finally { if (!keepBackup) rmSync(staging, { recursive: true, force: true }); }
  return previous ? 'updated' : 'installed';
}

/** Update platform manuals after a contract change without replacing customized installations. */
export function refreshInstalledSkills(workspace: string, access: SkillAccessPolicy = {}): string[] {
  if (!agentSkillsEnabled(access.role)) return [];
  const updated: string[] = [];
  const base = realpathSync(workspace);
  for (const skill of allSkills(access)) {
    const rel = `${SKILLS_INSTALL_DIR}/${skill.skillName}`;
    if (!installedFile(base, `${rel}/${INSTALL_RECORD}`)?.isFile()) continue;
    const dest = join(base, rel);
    let record: { id?: string; digest?: string };
    try { record = JSON.parse(readFileSync(join(dest, INSTALL_RECORD), 'utf8')); } catch { continue; }
    if (!record || typeof record.id !== 'string' || typeof record.digest !== 'string' || !record.digest || !skillIdForms(skill).has(record.id.toLowerCase())) continue;
    const current: SkillResource[] = [];
    let ordinary = true;
    const collect = (prefix: string) => {
      for (const item of readdirSync(join(dest, prefix), { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (path === INSTALL_RECORD) continue;
        const info = installedFile(dest, path);
        if (!info || item.isSymbolicLink()) { ordinary = false; continue; }
        if (info.isDirectory()) collect(path);
        else if (info.isFile()) current.push({ path, bytes: readFileSync(join(dest, path)), mode: info.mode & 0o777 });
        else ordinary = false;
      }
    };
    collect('');
    current.sort((a, b) => a.path.localeCompare(b.path));
    if (!ordinary || resourceFingerprint(current) !== record.digest) continue;
    requiredSkills(skill, access); // A metadata change cannot smuggle another role's dependency.
    const requiredBy = installedRequiredBy(workspace, skill.skillName) ?? undefined;
    if (materializeSkill(workspace, skill, skillResources(skill, requiredBy)) === 'updated') updated.push(skill.name);
  }
  return updated;
}

/** Materialize documented resources, including skill dependencies, without installing npm packages. */
export function installSkills(workspace: string, ids: readonly string[], access: SkillAccessPolicy = {}): InstallResult {
  assertSkillOperation(access, 'get');
  const result: InstallResult = { installed: [], missing: [], ...(access.role ? { available: skillCatalog(access).map((skill) => skill.name) } : {}) };
  // Authorize the complete request and dependency closure before any file lands.
  const plan = ids.map((id) => {
    const skill = findSkill(id);
    if (!skill?.body) { result.missing.push(id); return null; }
    assertSkillAccess(skill, access);
    return { skill, dependencies: requiredSkills(skill, access) };
  });
  const done = new Set<string>();
  const put = (skill: Skill, requiredBy?: string): void => {
    if (done.has(skill.name) || !skill.path) return;
    done.add(skill.name);
    const colliding = allSkills().filter((entry) => entry.skillName === skill.skillName);
    if (colliding.length > 1) throw new Error(`Multiple skills use the directory ${skill.skillName}: ${colliding.map((entry) => entry.name).join(', ')}`);
    /* One skill's directory can't be another's parent (`a` and `a/b`), or scanning a's resources would
       pick up b. */
    const nested = allSkills().find((entry) => entry.skillName !== skill.skillName
      && (entry.skillName.startsWith(`${skill.skillName}/`) || skill.skillName.startsWith(`${entry.skillName}/`)));
    if (nested) throw new Error(`Skill directories nest: ${skill.skillName} and ${nested.skillName}`);
    const rel = `${SKILLS_INSTALL_DIR}/${skill.skillName}`;
    /* The foundation never counts as dependency-only: it's listed in the system prompt anyway and must
       not be hidden by a dependency relation. */
    const files = skillResources(skill, isAutomaticSkill(skill) ? undefined : effectiveRequiredBy(workspace, skill.skillName, requiredBy));
    const status = materializeSkill(workspace, skill, files);
    const refs = skillRefs(skill);
    const references = files.filter((file) => REFERENCE_DIRS.some((dir) => file.path.startsWith(`${dir}/`))).map((file) => file.path);
    result.installed.push({ name: skill.name, skillName: skill.skillName, status, dir: rel, ...(requiredBy ? { requiredBy } : {}), refs, ...(references.length ? { references } : {}) });
  };
  /* Every skill requested this time counts as a direct install, even if it's also a dependency of
     another requested skill. */
  const named = new Set(plan.flatMap((item) => (item ? [item.skill.name] : [])));
  for (const item of plan) {
    if (!item) continue;
    for (const dep of item.dependencies) if (!named.has(dep.name)) put(dep, item.skill.name);
    put(item.skill);
  }
  return result;
}

/**
 * Install receipt: the output of `skill_get` and `anim skill get`.
 *
 * No body: the body is on disk, `read skills/<name>/SKILL.md`. The receipt says two things only:
 * where it was installed, and which dependencies came along. What else the directory holds besides
 * SKILL.md, and how to use it, is for that document to say; receipt and prompt treat
 * "skill = one document". On a wrong name, all names are reported back: the catalog isn't in the
 * standing prompt, so this list doubles as a discovery path.
 */
export function renderInstallReceipt(result: InstallResult): string {
  const lines: string[] = [];
  for (const s of result.installed) {
    const why = s.requiredBy ? ` (required by ${s.requiredBy})` : '';
    const verb = s.status === 'unchanged' ? 'Already installed' : s.status === 'updated' ? 'Updated' : 'Installed';
    lines.push(`${verb} ${s.name} → ${s.dir}/${why}`);
    lines.push(`  ${s.dir}/SKILL.md — read it before using this skill.`);
  }
  if (result.installed.length) {
    lines.push(`${SKILLS_INSTALL_DIR}/ is read-only and not compiled.`);
  }
  for (const id of result.missing) {
    lines.push(`There is no skill called "${id}". Available: ${(result.available ?? skillCatalog().map((s) => s.name)).join(', ')}.`);
  }
  return lines.join('\n');
}

/** Skills users can see on the shelf and in the input bar: everything except the foundation, which
 * is for the agent only. */
export function pickableSkills(): SkillCatalogEntry[] {
  return skillCatalog().filter((s) => s.type !== 'foundation');
}

/**
 * The **README.md** of the package behind this skill: the human-facing one, same as its GitHub page.
 *
 * The skill drawer's info dialog renders this, not SKILL.md: SKILL.md is the model's operating
 * manual (dialect, constraints, pitfalls) and is noise for someone choosing a capability; the README
 * answers "what is this, what does it look like".
 *
 * Lookup: resolve name to its import word -> first this repo's Scene package directory, then the
 * package root in node_modules. For third-party libraries (three / matter-js...) the README is the
 * one published upstream, for free. Without a README (our own package hasn't written one yet, or a
 * platform capability has no package) returns null and the UI shows a placeholder; not an error.
 */
export function skillReadme(name: string): string | null {
  const skill = findSkill(name);
  if (!skill) return null;
  const spec = skill.npmName;
  if (!spec) return null;
  const scenePkg = enabledPackages().find((d) => d.npmName === spec);
  const dir = scenePkg?.dir ?? resolveNpmDir(spec);
  if (!dir) return null;
  for (const file of ['README.md', 'readme.md', 'Readme.md']) {
    const p = join(dir, file);
    if (!existsSync(p)) continue;
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }
  return null;
}
