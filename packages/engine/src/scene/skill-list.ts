export type SkillListTag = 'platform_skills' | 'available_skills' | 'newly_added_skills';
const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function formatSkillList(tag: SkillListTag, skills: readonly { name: string; path: string; description: string }[]): string {
  if (!skills.length) return '';
  return [`<${tag}>`, ...skills.flatMap(skill => [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <path>${escapeXml(skill.path)}</path>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    '  </skill>',
  ]), `</${tag}>`].join('\n');
}
