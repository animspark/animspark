import { agentSkillsEnabled } from '../agents/definitions';
/**
 * Skills in the workspace, plus the record of which ones have been announced to the model in this
 * session.
 *
 * Skills reach the model in two places, both carrying only name, path and description; the model
 * reads the body itself:
 *   - `<platform_skills>` at the end of the system prompt: the mg foundation (rendered by
 *     code-prompt, one copy for the whole site);
 *   - a list in the user message: what the user added (film types / styles / components picked
 *     from the shelf, third-party), as follows:
 *   - first turn: `<available_skills>`, the user-added skills currently installed in the workspace;
 *   - every later turn: `<newly_added_skills>`, those installed since the previous turn (named by
 *     the user, or installed by the model via skill_get); nothing at all if there are none.
 * path is the workspace-relative path of the installed SKILL.md. Bodies are not injected: the model
 * reads whichever file it needs. The system prompt contains nothing skill-specific; it is one copy
 * for the whole site, byte-for-byte stable.
 *
 * The list is persisted with session state (`announced`), so resumed or compacted sessions do not
 * re-announce old skills as new.
 *
 * Dependencies are installed but not announced: when a skill depends on data / document, those are
 * written alongside it (install record `dependency: true`) but stay off the list; the model finds
 * them by following links in the skill that needs them. Components and styles appear on the list
 * only when the user picked them.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { formatSkillList, type SkillListTag } from './skill-list';
export { formatSkillList } from './skill-list';
import { allSkills, assertSkillAccess, automaticSkills, findSkill, installedAsDependency, installedSkillDir, installSkills, isAutomaticSkill, isValidSkillDir, normalizeSkillId, offHostSkill, parseSkillFile, refreshInstalledSkills, skillAllowed, skillAudience, skillIdForms, skillIdOfDir, type SkillAccessPolicy, type SkillAudience } from './skill-catalog';

/**
 * `announced`: SKILL.md paths already announced to the model in this session.
 * `started`: the first turn is over. The first turn may announce nothing (the user added nothing),
 * so an empty `announced` can't be used to tell.
 */
interface SkillState { schemaVersion: 2; announced: string[]; started?: boolean }
export interface WorkspaceSkillOptions {
  /** Role policy comes from the host, never from an agent-supplied tool argument. */
  access?: SkillAccessPolicy;
  /** Session state file; without it nothing is persisted (every instance counts as the first turn). */
  statePath?: string;
  /** Skills the user picked in the input bar this turn: installed at turn start, listed as newly added. */
  requestedIds?: readonly string[];
  /**
   * Skills "installed" at the account level (styles / components the user picked on the shelf):
   * installed into a new workspace on the first turn, listed as available.
   */
  automaticIds?: readonly string[];
  /**
   * Install the foundation (catalog type foundation: mg). Missing ones are filled in every turn:
   * they are part of the platform, and old sessions should get newly added ones too. On in
   * production sessions; off by default in unit tests so every fixture doesn't install twenty manuals.
   */
  platformSkills?: boolean;
  /** Character budget for the list; over budget, descriptions are truncated first, then entries dropped. */
  catalogCharBudget?: number;
}
/** The list to attach to this turn's user message (empty string = nothing to announce) and load diagnostics. */
export interface SkillAnnouncement { text: string; diagnostics: string[] }
/** An installed skill that skill_get found by name / path. */
export interface InstalledSkillRef { id: string; name: string; path: string }

const DEFAULT_CATALOG_CHAR_BUDGET = 8_000;

/**
 * A skill installed in the workspace.
 *   name - the id `@scope/name`, derived from the directory (`skills/animspark/vox-sticker/` ->
 *          `@animspark/vox-sticker`); a bare directory without a namespace gives a bare name. Used
 *          for installing and resolving references.
 *   dir  - the directory under `skills/` (`animspark/vox-sticker`); the file is `skills/<dir>/SKILL.md`.
 *   leaf - the standard name in the frontmatter (= the last directory segment).
 */
export interface InstalledSkill { name: string; dir: string; leaf: string; description: string; filePath: string; audience?: SkillAudience; disableModelInvocation?: boolean }

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
};
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function skillSessionStatePath(runtimeDir: string, sessionKey: string): string {
  return join(runtimeDir, 'skill-sessions', `${digest(sessionKey)}.json`);
}

/** Resolve missing paths through their nearest existing ancestor, including dangling links. */
function physicalPath(path: string): string {
  try { return realpathSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // A dangling symlink must not be mistaken for an ordinary absent file.
    let stat: ReturnType<typeof lstatSync> | undefined;
    try { stat = lstatSync(path); } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
    }
    if (stat?.isSymbolicLink()) throw new Error(`Dangling skill symlink: ${path}`);
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(physicalPath(parent), basename(path));
  }
}

/** Apply the discovery boundary to direct reads of installed manuals and supporting files. */
export function assertWorkspaceSkillPath(workspace: string, path: string, access: SkillAccessPolicy = {}): void {
  if (!agentSkillsEnabled(access.role)) throw new Error('Skills are temporarily disabled for this agent.');
  const base = resolve(workspace);
  const target = resolve(base, path);
  if (!within(join(base, 'skills'), target)
    || !within(join(physicalPath(base), 'skills'), physicalPath(target))) {
    throw new Error('Skill path escapes workspace skills/.');
  }
  if (!access.role) return;
  const root = join(base, 'skills');
  for (let dir = lstatSync(target).isDirectory() ? target : dirname(target); within(root, dir) && dir !== root; dir = dirname(dir)) {
    const manual = join(dir, 'SKILL.md');
    if (!existsSync(manual)) continue;
    if (!within(join(physicalPath(base), 'skills'), physicalPath(manual))) throw new Error('Skill path escapes workspace skills/.');
    const { front } = parseSkillFile(readFileSync(manual, 'utf8'));
    /* Installed manuals carry only name/description/files, so audience is looked up in the catalog;
       front.audience is the fallback for old installs (back when it was still in the manual header). */
    const dirId = skillIdOfDir(relative(root, dir).split(sep).join('/'));
    assertSkillAccess({ name: dirId, audience: front.audience ?? findSkill(dirId)?.audience }, access);
    return;
  }
  if (lstatSync(target).isFile()) throw new Error('Skill file has no authorized SKILL.md.');
}

/** Read only installed manuals, rejecting escaping symlinks and directory cycles. */
function loadWorkspaceManuals(workspace: string, ignored: ReadonlySet<string>) {
  const root = join(workspace, 'skills');
  const physicalRoot = join(physicalPath(workspace), 'skills');
  const diagnostics: Array<{ path: string; message: string }> = [];
  const skills: Array<{ name: string; description: string; filePath: string; disableModelInvocation: boolean }> = [];
  const readTextFile = async (path: string) => {
    try {
      if (!within(root, path) || !within(physicalRoot, physicalPath(path))) throw new Error('Skill path escapes workspace skills/.');
      return { ok: true as const, value: readFileSync(path, 'utf8') };
    } catch (error) {
      return { ok: false as const, error: { code: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not_found' : 'permission_denied', message: errorText(error) } };
    }
  };
  const visit = async (dir: string, ancestors = new Set<string>()) => {
    if ([...ignored].some(path => within(path, dir))) return;
    try {
      const real = physicalPath(dir);
      if (!within(physicalRoot, real)) throw new Error('Skill path escapes workspace skills/.');
      if (ancestors.has(real)) throw new Error('Skill directory contains a symlink cycle.');
      const next = new Set([...ancestors, real]);
      const filePath = join(dir, 'SKILL.md');
      if (dir !== root && existsSync(filePath)) {
        const source = await readTextFile(filePath);
        if (!source.ok) throw new Error(source.error.message);
        const { front } = parseSkillFile(source.value);
        if (!front.standard || !front.name || !front.description) throw new Error('Invalid skill metadata: name and description are required.');
        const yaml = parseYaml(source.value.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '') as Record<string,unknown> | null;
        skills.push({ name: front.name, description: front.description, filePath, disableModelInvocation: yaml?.['disable-model-invocation'] === true });
        return;
      }
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) await visit(join(dir, entry.name), next);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push({ path: dir, message: errorText(error) }); }
  };
  return { readTextFile, load: async () => { await visit(root); return { skills, diagnostics }; } };
}

export class WorkspaceSkillContext {
  private readonly workspace: string;
  private readonly announced = new Set<string>();
  private started = false;
  private readonly diagnostics: string[] = [];
  private loadedState = false;
  private installedRequested = false;
  private savedState = '';

  constructor(workspace: string, private readonly options: WorkspaceSkillOptions = {}) {
    this.workspace = resolve(workspace);
  }

  private relativePath(path: string): string { return relative(this.workspace, path).split(sep).join('/'); }
  private report(message: string): void { this.diagnostics.push(message); }

  private readState(): void {
    if (this.loadedState) return;
    this.loadedState = true;
    if (!this.options.statePath) return;
    try {
      const state = JSON.parse(readFileSync(this.options.statePath, 'utf8')) as Partial<SkillState>;
      if (state.schemaVersion !== 2 || !Array.isArray(state.announced)) throw new Error('Unsupported skill session state.');
      this.started = state.started === true || state.announced.length > 0;
      for (const item of state.announced) {
        if (typeof item !== 'string') continue;
        const path = resolve(this.workspace, item);
        if (basename(path) === 'SKILL.md' && within(join(this.workspace, 'skills'), path)) this.announced.add(this.relativePath(path));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.report(`Skill session state: ${errorText(error)}`);
    }
  }

  private saveState(): void {
    if (!this.options.statePath) return;
    const state: SkillState = { schemaVersion: 2, announced: [...this.announced].sort(), ...(this.started ? { started: true } : {}) };
    const text = `${JSON.stringify(state, null, 2)}\n`;
    if (text === this.savedState) return;
    const temporary = `${this.options.statePath}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.options.statePath), { recursive: true });
      writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, this.options.statePath);
      this.savedState = text;
    } catch (error) {
      this.report(`Could not save skill session state: ${errorText(error)}`);
    } finally { rmSync(temporary, { force: true }); }
  }

  /** An installed skill's directory under skills/. */
  private installedDir(filePath: string): string {
    return relative(join(this.workspace, 'skills'), dirname(filePath)).split(sep).join('/');
  }

  /**
   * Old-layout directories stay readable for past messages but are no longer treated as skills:
   *   - `skills/@animspark/x/`: the `@`-prefixed id used directly as the directory name;
   *   - `skills/x/`: the flat layout used for a while; identified by the id recorded in
   *     `.animspark-install.json`;
   *   - `skills/web/x/`, `skills/local/x/`: ids from before the rename (animspark-id in frontmatter).
   * If we installed it and the new location is still empty, install into the new location; if we
   * didn't (a same-named skill the user placed there), leave it alone.
   */
  private migrateLegacySkills(): Set<string> {
    const ignored = new Set<string>();
    const skillsRoot = join(this.workspace, 'skills');
    const physicalRoot = join(physicalPath(this.workspace), 'skills');
    for (const source of allSkills(this.options.access)) {
      try {
        const canonicalDir = resolve(this.workspace, installedSkillDir(source.name));
        const forms = skillIdForms(source);
        const leaf = source.skillName.split('/').pop()!;
        /* [directory, is the name alone enough to know it's ours?] */
        const candidates = new Map<string, boolean>();
        candidates.set(resolve(skillsRoot, `@${source.skillName}`), true);
        candidates.set(resolve(skillsRoot, leaf), false);
        for (const alias of source.aliases ?? []) {
          if (alias.includes('/')) candidates.set(resolve(skillsRoot, alias.replace(/^@/, '')), true);
        }
        candidates.delete(canonicalDir);
        for (const [legacyDir, claimedByName] of candidates) {
          const path = join(legacyDir, 'SKILL.md');
          if (!within(skillsRoot, path) || !within(physicalRoot, physicalPath(path)) || !existsSync(path)) continue;
          let ours = claimedByName;
          if (!ours) {
            const recordPath = join(legacyDir, '.animspark-install.json');
            if (existsSync(recordPath)) {
              try {
                const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { id?: unknown };
                ours = typeof record.id === 'string' && forms.has(record.id.toLowerCase());
              } catch { /* A broken record means not ours: better an extra copy than deleting someone else's. */ }
            }
          }
          if (!ours) continue;
          if (!existsSync(join(canonicalDir, 'SKILL.md'))) installSkills(this.workspace, [source.name], { ...this.options.access, skillGetEnabled: true });
          ignored.add(legacyDir);
        }
      } catch (error) { this.report(`Legacy skill ${source.name}: ${errorText(error)}`); }
    }
    return ignored;
  }

  /** Skills currently installed in the workspace's skills/ with valid metadata; paths are absolute. */
  private async scan(): Promise<InstalledSkill[]> {
    if (!agentSkillsEnabled(this.options.access?.role)) return [];
    this.readState();
    for (const id of refreshInstalledSkills(this.workspace, this.options.access)) {
      // A changed manual needs a fresh announcement even in a resumed session.
      this.announced.delete(`${installedSkillDir(id)}/SKILL.md`);
    }
    const env = loadWorkspaceManuals(this.workspace, this.migrateLegacySkills());
    const result = await env.load();
    const skills: InstalledSkill[] = [];
    for (const loaded of result.skills) {
      const manual = await env.readTextFile(loaded.filePath);
      const front = manual.ok ? parseSkillFile(manual.value).front : undefined;
      const dir = this.installedDir(loaded.filePath);
      /* Standard: the frontmatter name points at this directory, either as the leaf name (old
         installs, name == last directory segment) or the full name (canonical, name == @scope/leaf).
         The path in the model's list is the actual file path. */
      const nameResolves = loaded.name === basename(dir) || normalizeSkillId(loaded.name) === skillIdOfDir(dir);
      if (basename(loaded.filePath) !== 'SKILL.md' || !isValidSkillDir(dir)
        || !nameResolves || loaded.description.length > 1024
        || /[<>"\r\n]/.test(loaded.filePath) || !front?.standard || front.name !== loaded.name) {
        this.report(`Ignored nonstandard skill: ${this.relativePath(loaded.filePath)}`);
        continue;
      }
      const skill: InstalledSkill = { name: skillIdOfDir(dir), dir, leaf: basename(dir), description: loaded.description, filePath: loaded.filePath };
      /* An old workspace opened on another host (a desktop project moved to the web) may contain manuals
         for other hosts: don't announce them or allow reading them. */
      if (offHostSkill(skill.name)) {
        this.report(`Skill ${skill.name} is not available on this host.`);
        continue;
      }
      /* Installed frontmatter has only name/description/files, so audience comes from the catalog;
         front.audience is the fallback for old installs. */
      skill.audience = skillAudience({ name: skill.name, audience: front.audience ?? findSkill(skill.name)?.audience });
      // A forbidden manual left on disk would still be reachable through file
      // tools. Refuse this role workspace rather than merely hiding its index.
      assertSkillAccess(skill, this.options.access);
      if (loaded.disableModelInvocation) skill.disableModelInvocation = true;
      const policyPath = join(dirname(skill.filePath), 'agents', 'openai.yaml');
      const policyFile = await env.readTextFile(policyPath);
      if (policyFile.ok) {
        try {
          const config = parseYaml(policyFile.value) as { policy?: { allow_implicit_invocation?: unknown } } | null;
          if (config?.policy?.allow_implicit_invocation === false) skill.disableModelInvocation = true;
        } catch (error) {
          skill.disableModelInvocation = true;
          this.report(`${this.relativePath(policyPath)}: ${errorText(error)}`);
        }
      } else if (policyFile.error.code !== 'not_found') {
        skill.disableModelInvocation = true;
        this.report(`${this.relativePath(policyPath)}: ${policyFile.error.message}`);
      }
      skills.push(skill);
    }
    for (const diagnostic of result.diagnostics) this.report(`${this.relativePath(diagnostic.path)}: ${diagnostic.message}`);
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }

  /**
   * Find an installed skill by name. Accepts: the id (`@animspark/vox-sticker`, with or without `@`),
   * the directory, the SKILL.md path, any old name of the catalog entry (`web/html-in-canvas` -> its
   * current install directory), and a last segment that matches exactly one skill.
   * null = the last segment is ambiguous; don't guess, and don't install a catalog stand-in instead.
   */
  private resolveSkill(id: string, skills: readonly InstalledSkill[], options: { reportMissing?: boolean } = {}): InstalledSkill | null | undefined {
    const want = normalizeSkillId(id).toLowerCase().replace(/\/+$/, '');
    const byName = skills.find((skill) => skill.name.toLowerCase() === want || skill.dir === want.replace(/^@/, ''));
    if (byName) return byName;
    let filePath = resolve(this.workspace, id.trim());
    if (basename(filePath) !== 'SKILL.md') filePath = join(filePath, 'SKILL.md');
    const byPath = skills.find((skill) => resolve(skill.filePath) === filePath);
    if (byPath) return byPath;
    const source = findSkill(want, this.options.access);
    if (source) {
      const installed = skills.find((skill) => skill.filePath === join(this.workspace, installedSkillDir(source.name), 'SKILL.md'));
      if (installed) return installed;
    }
    const byLeaf = skills.filter((skill) => skill.leaf === want);
    if (byLeaf.length > 1) {
      this.report(`"${id}" matches several installed skills: ${byLeaf.map((skill) => skill.name).join(', ')}; use the full name.`);
      return null;
    }
    if (byLeaf.length === 1) return byLeaf[0];
    if (options.reportMissing !== false) this.report(`Skill is not installed or has invalid metadata: ${id}`);
    return;
  }

  private renderList(tag: SkillListTag, skills: readonly InstalledSkill[]): string {
    const requestedBudget = this.options.catalogCharBudget ?? DEFAULT_CATALOG_CHAR_BUDGET;
    const budget = Number.isFinite(requestedBudget) ? Math.max(0, Math.floor(requestedBudget)) : DEFAULT_CATALOG_CHAR_BUDGET;
    const render = (items: readonly InstalledSkill[]): string => formatSkillList(tag,
      items.map(skill => ({ name: skill.name, path: this.relativePath(skill.filePath), description: skill.description })));
    // Keep complete readable paths whenever possible; verbose descriptions yield space first.
    let compact: InstalledSkill[] = [...skills];
    for (const maxDescription of [Infinity, 240, 160]) {
      compact = skills.map((skill) => ({
        ...skill,
        description: skill.description.length > maxDescription
          ? `${skill.description.slice(0, maxDescription - 1).trimEnd()}…` : skill.description,
      }));
      const catalog = render(compact);
      if (catalog.length <= budget) return catalog;
    }
    const included: InstalledSkill[] = [];
    let catalog = '';
    for (const skill of compact) {
      const next = render([...included, skill]);
      if (next.length > budget) { this.report(`Skill catalog budget omitted ${skill.name}.`); continue; }
      included.push(skill);
      catalog = next;
    }
    return catalog;
  }

  /**
   * At turn start, install three batches of skills into the workspace (once only; anything already
   * installed, even a same-named third-party skill, is left alone):
   *   - platform: the foundation (`platformSkills`); filled in every turn;
   *   - automatic: the account's "installed" skills, the workspace's baseline; first turn only;
   *   - requested: the ones the user picked in the input bar this turn.
   * Returns which were newly installed **because they were requested**: those are listed as newly
   * added, the baseline as available.
   */
  private async installRequested(skills: readonly InstalledSkill[]): Promise<{ skills: InstalledSkill[]; requested: Set<string> }> {
    const requested = new Set<string>();
    if (this.installedRequested) return { skills: [...skills], requested };
    this.installedRequested = true;
    const platform = this.options.platformSkills ? automaticSkills(this.options.access).map((skill) => skill.name) : [];
    const automatic = [...platform, ...(this.started ? [] : this.options.automaticIds ?? [])];
    const install = (ids: readonly string[], byRequest: boolean): boolean => {
      let installed = false;
      for (const id of ids) {
        // An independently installed skill owns its location even if our catalog uses the same name.
        const present = this.resolveSkill(id, skills, { reportMissing: false });
        /* A skill installed only as a dependency that the user now names (or has on the account shelf):
           record it as a direct install so it shows up on the list from now on. */
        const promote = present && !platform.includes(id) && installedAsDependency(this.workspace, present.dir);
        if (present !== undefined && !promote) continue;
        const source = findSkill(id);
        if (!source) { this.report(`Skill is not installed or has invalid metadata: ${id}`); continue; }
        if (!skillAllowed(source, this.options.access)) {
          if (byRequest) this.report(`Skill ${source.name} belongs to another agent role.`);
          continue;
        }
        if (requested.has(source.skillName) || (byRequest && automatic.some((auto) => findSkill(auto)?.name === source.name))) continue;
        try {
          // Account installs and explicit user picks are not model skill_get.
          installSkills(this.workspace, [source.name], { ...this.options.access, skillGetEnabled: true });
          installed = true;
          if (byRequest) requested.add(source.skillName);
        } catch (error) { this.report(`Could not install ${source.name}: ${errorText(error)}`); }
      }
      return installed;
    };
    const a = install(automatic, false);
    const b = install(this.options.requestedIds ?? [], true);
    return { skills: a || b ? await this.scan() : [...skills], requested };
  }

  /**
   * Call once at the start of each turn to get the list to attach to this turn's user message.
   *
   *   First turn (nothing announced yet in this session): `<available_skills>` lists the automatically
   *   installed ones (default skills, ones already in the workspace), `<newly_added_skills>` lists
   *   those the user requested this turn; each block appears only if non-empty.
   *   Later turns: only `<newly_added_skills>`, listing what appeared since last time (requested,
   *   installed via skill_get); empty string if nothing.
   * Announced paths are recorded in session state; deleted ones drop out of the record and count as
   * newly added if installed again later.
   */
  async announce(): Promise<SkillAnnouncement> {
    if (!agentSkillsEnabled(this.options.access?.role)) return { text: '', diagnostics: [] };
    const { skills, requested } = await this.installRequested(await this.scan());
    const visible = skills.filter((skill) => !skill.disableModelInvocation);
    const current = new Set(visible.map((skill) => this.relativePath(skill.filePath)));
    for (const path of this.announced) if (!current.has(path)) this.announced.delete(path);
    const first = !this.started;
    const unannounced = visible.filter((skill) => !this.announced.has(this.relativePath(skill.filePath)) && this.userAdded(skill));
    const fresh = first ? unannounced.filter((skill) => requested.has(skill.dir)) : unannounced;
    const available = first ? unannounced.filter((skill) => !requested.has(skill.dir)) : [];
    for (const skill of unannounced) this.announced.add(this.relativePath(skill.filePath));
    this.started = true;
    this.saveState();
    const text = [this.renderList('available_skills', available), this.renderList('newly_added_skills', fresh)].filter(Boolean).join('\n\n');
    return { text, diagnostics: [...new Set(this.diagnostics.splice(0))] };
  }

  /**
   * What goes on the user-message list: what the user added. The foundation is already listed in the
   * system prompt (when installed in its canonical directory); skills written only because another
   * skill `requires` them (install record `dependency: true`) are not announced either.
   */
  private userAdded(skill: InstalledSkill): boolean {
    const source = findSkill(skill.name);
    if (source && isAutomaticSkill(source) && skill.dir === source.skillName) return false;
    return !installedAsDependency(this.workspace, skill.dir);
  }

  /**
   * For external agents that don't go through our system prompt (the desktop MCP's open_session):
   * fills in the foundation, migrates old directories, and returns what the agent should see:
   * foundation + user-added, excluding dependency-only installs. Writes no session state, announces
   * nothing.
   */
  async agentVisible(): Promise<InstalledSkill[]> {
    if (!agentSkillsEnabled(this.options.access?.role)) return [];
    const { skills } = await this.installRequested(await this.scan());
    this.diagnostics.splice(0);
    return skills.filter((skill) => {
      if (skill.disableModelInvocation) return false;
      const source = findSkill(skill.name);
      return (source && isAutomaticSkill(source)) || !installedAsDependency(this.workspace, skill.dir);
    });
  }

  /** Every skill currently installed in the workspace (including model-hidden ones), for the UI's
   * "this workspace" list. Installs nothing, announces nothing. */
  async list(): Promise<InstalledSkill[]> {
    const skills = await this.scan();
    this.diagnostics.splice(0);
    return skills;
  }

  /**
   * Whether project source imports the package this skill teaches. If so it can't be removed:
   * without the manual, the code still uses the package and next turn the model faces calls it has
   * no documentation for. Only source files under mg/ are checked; skills/ itself doesn't count.
   */
  importedBy(skill: InstalledSkill): string[] {
    const spec = findSkill(skill.name)?.npmName;
    if (!spec) return [];
    const pattern = new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*)['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/[^'"]*)?['"]`);
    const hits: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 6 || !existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'skills') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, depth + 1);
        else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
          try { if (pattern.test(readFileSync(path, 'utf8'))) hits.push(this.relativePath(path)); } catch { /* unreadable = not referenced */ }
        }
      }
    };
    const roots = this.options.access?.role === 'mg' ? ['.'] : ['mg'];
    for (const root of roots) walk(join(this.workspace, root), 0);
    return hits.sort();
  }

  /**
   * Remove a skill from the workspace. Deletes only that one real directory under `skills/`; returns
   * `removed: false` if not found, throws if ambiguous. If project source still imports the package
   * it teaches, nothing is deleted and `importedBy` is returned so the UI can ask the user to remove
   * the imports first. The session's announced record is left alone; it drops out on the next
   * announce once the directory is gone.
   */
  async remove(id: string): Promise<{ removed: boolean; importedBy?: string[] }> {
    const skill = this.resolveSkill(id, await this.scan(), { reportMissing: false });
    this.diagnostics.splice(0);
    if (skill === null) throw new Error(`"${id}" matches several installed skills; use the full name.`);
    if (!skill) return { removed: false };
    /* The foundation is part of the platform and would be restored next turn; removing it would only
       make the user think it was gone. */
    if (findSkill(skill.name)?.type === 'foundation') return { removed: false };
    const importedBy = this.importedBy(skill);
    if (importedBy.length) return { removed: false, importedBy };
    const dir = dirname(skill.filePath);
    assertWorkspaceSkillPath(this.workspace, dir);
    if (lstatSync(dir).isSymbolicLink()) throw new Error(`Skill directory is a symlink: ${skill.dir}`);
    rmSync(dir, { recursive: true, force: true });
    /* If the namespace level is now empty, remove it too; don't leave an empty skills/animspark/. */
    const parent = dirname(dir);
    if (parent !== join(this.workspace, 'skills') && existsSync(parent) && readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
    return { removed: true };
  }

  /** For skill_get: which of these ids are installed in the workspace (by name, path or product id),
   * which are missing, and which are ambiguous. */
  async resolveInstalled(ids: readonly string[]): Promise<{ found: InstalledSkillRef[]; missing: string[]; ambiguous: string[] }> {
    if (!agentSkillsEnabled(this.options.access?.role)) return { found: [], missing: [...ids], ambiguous: [] };
    const skills = await this.scan();
    const found: InstalledSkillRef[] = [];
    const missing: string[] = [];
    const ambiguous: string[] = [];
    for (const id of ids) {
      const skill = this.resolveSkill(id, skills, { reportMissing: false });
      if (skill) found.push({ id, name: skill.name, path: `skills/${skill.dir}/SKILL.md` });
      else if (skill === null) ambiguous.push(id);
      else missing.push(id);
    }
    this.diagnostics.splice(0);
    return { found, missing, ambiguous };
  }
}
