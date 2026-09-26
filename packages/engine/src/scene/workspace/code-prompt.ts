/**
 * The agent prompt = the static body in prompts/system_prompt.md + a closing list of the skills
 * installed in the workspace (`<platform_skills>`).
 *
 * The foundation skill (mg; three, p5 and the rest are mg capabilities, not skills) is installed in
 * every workspace at a fixed path. A local workspace (`anim new`) also gets the film-type skills
 * (see localWorkspaceSkills), so the list only depends on the engine version and the host.
 *
 * `<!-- hosted-only -->…<!-- /hosted-only -->` blocks in the body are kept for the `web` surface and
 * removed, content included, for the `local` surface (a developer's own coding agent).
 *
 * The body is cached by file mtime, so an edit is picked up on the next call.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_DEFINITIONS, AGENT_ROLES, agentSkillsEnabled, isAgentRole, type AgentRole } from '../../agents/definitions';
import { automaticSkills, currentSkillHost, localWorkspaceSkills, SKILLS_INSTALL_DIR, type SkillHost } from '../skill-catalog';
import { formatSkillList } from '../skill-list';

const here = dirname(fileURLToPath(import.meta.url));
export const SYSTEM_PROMPT_FILE = 'system_prompt.md';
/** The body ships with the engine package (prompts/), not with the repository docs. */
export const SYSTEM_PROMPT_PATH = join(here, '../../..', 'prompts', SYSTEM_PROMPT_FILE);
export const MG_PROMPT_FILE = AGENT_DEFINITIONS.mg.prompt;
export const MG_PROMPT_PATH = join(here, '../../..', 'prompts', MG_PROMPT_FILE);

export type CodePromptRole = AgentRole;
export const ROLE_PROMPT_PATHS = Object.fromEntries(AGENT_ROLES.map(role => [
  role, join(here, '../../..', 'prompts', AGENT_DEFINITIONS[role].prompt),
])) as Readonly<Record<AgentRole, string>>;

export const FILM_AGENT_NAME = 'mg';

export interface CodePromptOptions {
  role?: CodePromptRole;
  /** `local` = a developer's coding agent in an `anim new` workspace. Default `web`. */
  surface?: 'web' | 'local';
  /** Which host to list skills for; defaults to the host of this process. */
  host?: SkillHost;
}

const cached = new Map<string, { key: string; text: string }>();

/* Marker lines, and whole blocks, of `<!-- hosted-only -->…<!-- /hosted-only -->`. */
const HOSTED_MARKS = /^<!-- \/?hosted-only -->\n?/gm;
const HOSTED_BLOCK = /^<!-- hosted-only -->\n[\s\S]*?^<!-- \/hosted-only -->\n?/gm;

function stripPrompt(source: string, surface: 'web' | 'local'): string {
  const body = surface === 'local' ? source.replace(HOSTED_BLOCK, '') : source;
  return body.replace(HOSTED_MARKS, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** The static body (without the skill list). */
export function renderStaticPrompt(opts: CodePromptOptions = {}): string {
  if (opts.role !== undefined && !isAgentRole(opts.role)) throw new Error(`Unknown agent role: ${String(opts.role)}`);
  const surface = opts.surface ?? 'web';
  const path = opts.role === undefined ? SYSTEM_PROMPT_PATH : ROLE_PROMPT_PATHS[opts.role];
  const stat = statSync(path);
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cacheKey = `${surface}:${path}`;
  const hit = cached.get(cacheKey);
  if (hit?.key === key) return hit.text;

  const source = readFileSync(path, 'utf8').trim();
  if (!source) throw new Error(`The system prompt is empty: ${path}`);
  const text = stripPrompt(source, surface);
  cached.set(cacheKey, { key, text });
  return text;
}

/** The project contract for an external agent: the same body without the hosted-only blocks. */
export function renderProjectContract(): string {
  return stripPrompt(readFileSync(SYSTEM_PROMPT_PATH, 'utf8').trim(), 'local');
}

/** The closing skill list. Empty when the role has skills disabled. */
export function renderPlatformSkills(opts: CodePromptOptions = {}): string {
  const role = opts.role ?? FILM_AGENT_NAME as AgentRole;
  if (!agentSkillsEnabled(role)) return '';
  const skills = opts.surface === 'local' ? localWorkspaceSkills({ role }, opts.host) : automaticSkills({ role }, opts.host);
  const list = formatSkillList('platform_skills', skills.map((skill) => ({
    name: skill.name, path: `${SKILLS_INSTALL_DIR}/${skill.skillName}/SKILL.md`, description: skill.description,
  })));
  if (!list) return '';
  return [
    '# Skills',
    '',
    'These skills are installed under `skills/` in this workspace. Read a skill\'s SKILL.md when the task matches its description; it links to its own references. Skills that others list as dependencies may also be installed there.',
    '',
    list,
  ].join('\n');
}

/** The full prompt: static body + skill list. */
export function renderCodePrompt(opts: CodePromptOptions = {}): string {
  const text = renderStaticPrompt(opts);
  const skills = renderPlatformSkills(opts);
  return skills ? `${text}\n\n${skills}` : text;
}

/**
 * Harnesses that take an instruction file get one written to a content-addressed path, so the same
 * text always lands at the same path.
 */
export function systemPromptFile(opts: CodePromptOptions = {}): string {
  const text = renderCodePrompt(opts);
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const dir = join(tmpdir(), 'animspark-prompts');
  const path = join(dir, `system_prompt.${opts.host ?? currentSkillHost()}.${digest}.md`);
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${text}\n`, 'utf8');
    renameSync(temporary, path);
  }
  return path;
}
