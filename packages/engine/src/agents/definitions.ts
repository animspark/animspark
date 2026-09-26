/** The agent roles a workspace can be written for. The engine ships one: the film author. */
export const AGENT_DEFINITIONS = {
  mg: {
    id: 'mg',
    label: 'AnimSpark Agent',
    description: 'Authors film.json and native React/CSS/GSAP scenes, then checks and looks at the result with the anim CLI.',
    /** The manual under prompts/ that becomes the workspace's CLAUDE.md / AGENTS.md. */
    prompt: 'system_prompt.md',
    skillsEnabled: true,
  },
} as const;

export type AgentRole = keyof typeof AGENT_DEFINITIONS;
export const AGENT_ROLES: readonly AgentRole[] = Object.freeze(Object.keys(AGENT_DEFINITIONS) as AgentRole[]);

/** Only registered roles can select a prompt, tool policy or workspace. */
export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AGENT_DEFINITIONS, value);
}

/** Whether the role's workspace gets the installed skills. */
export function agentSkillsEnabled(role?: AgentRole | 'editor'): boolean {
  if (role === undefined || role === 'editor') return true;
  if (!isAgentRole(role)) throw new Error('Unknown agent role.');
  return AGENT_DEFINITIONS[role].skillsEnabled;
}
