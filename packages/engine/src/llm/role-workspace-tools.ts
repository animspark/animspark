/** Workspace path and web boundaries for role sessions. MG Bash runs OS-sandboxed directly on the real workspace. */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { filmPublishedMgMediaSrc, isPrivateAssetWordsPath } from '@animspark/core';
import { assertWorkspaceSkillPath } from '../scene/workspace-skills';
import type { SkillAccessPolicy } from '../scene/skill-catalog';
import { agentSkillsEnabled, type AgentRole } from '../agents/definitions';

export type PathRole = AgentRole | 'editor';

const PUBLISHED = (src: string) => filmPublishedMgMediaSrc(src) !== null;
class BoundaryError extends Error {}
const deny = (message: string): never => { throw new BoundaryError(message); };

function privateWorkspacePath(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return isPrivateAssetWordsPath(path.toLowerCase()) || /\.animptr$/i.test(path)
    || parts.some(p => p.startsWith('.') || ['node_modules', 'types', 'tsconfig.json', 'dist', 'runtime', 'state', 'private', 'outputs'].includes(p.toLowerCase()));
}

export function rolePathAvailable(role: PathRole, path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  if (privateWorkspacePath(path)) return false;
  if (role !== 'editor' && !agentSkillsEnabled(role) && (parts[0]?.toLowerCase() === 'skills' || parts.some(p => p.toLowerCase() === 'skill.md'))) return false;
  if (role === 'mg') {
    if (path.toLowerCase() === 'assets/index.json') return false;
    return path === '' || path === '.' || path === 'film.json'
      || ['assets', 'mg', 'skills'].some(dir => path === dir || path.startsWith(dir + '/'));
  }
  // Uploaded source documents are reference data, not another Agent's implementation.
  if (path === 'assets/upload' || path.startsWith('assets/upload/')) return true;
  if (path.startsWith('skills/') || path === 'skills') return true; // Audience is checked separately.
  if (path.startsWith('assets/mg/')) return PUBLISHED(path) || /^assets\/mg\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(path)
    || /^assets\/mg\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/(?:v[1-9][0-9]*\/)?(?:media\.webm|preview\.(?:png|jpg|webm|mp4))$/.test(path);
  if (path === '.' || path === '' || path === 'film.json' || path === 'assets') return true;
  if (!path.startsWith('assets/')) return false;
  return !/\.(?:tsx?|jsx?|mjs|cjs|html?|css|map|sh|py|wasm)$/i.test(path);
}

function noLinks(root: string, abs: string): void {
  for (let at = abs; ; at = dirname(at)) {
    let info;
    try { info = lstatSync(at); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (info && (info.isSymbolicLink() || realpathSync(at) !== at)) deny('Linked paths are not available.');
    if (at === root) break;
    if (dirname(at) === at) deny('File not available in this workspace.');
  }
}


/** Host-only reads of existing MG snapshots; never use this for an agent file/query input. */
export function assertLegacyMgSourcePath(workspace: string, path: string): string {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)
    || path.split('/').includes('..')) deny('Use a source path inside this MG workspace.');
  const root = realpathSync(workspace);
  const clean = relative(root, resolve(root, path)).replace(/\\/g, '/');
  if (!clean || privateWorkspacePath(clean) || ['assets/index.json', 'audio.tsx', 'project.ts'].includes(clean.toLowerCase())
    || clean === 'skills' || clean.startsWith('skills/')) deny('MG source file is not available.');
  const abs = resolve(root, clean);
  noLinks(root, abs);
  if (!existsSync(abs) || !lstatSync(abs).isDirectory()) noLinks(root, abs + '.animptr');
  return abs;
}

/** No absolute paths, traversal, hidden metadata, or symlink ancestors, including CAS pointers. */
export function assertRolePath(workspace: string, role: PathRole, path: string, access: SkillAccessPolicy, write = false): string {
  if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)
    || path.split('/').includes('..')) deny('Use a path inside this workspace.');
  const root = realpathSync(workspace);
  const clean = relative(root, resolve(root, path)).replace(/\\/g, '/');
  if (!rolePathAvailable(role, clean)) {
    deny(clean === 'assets/index.json'
      ? 'assets/index.json is the private ledger — use the materialized view assets/index.jsonl (one lean line per asset) instead.'
      : 'File not available in this workspace.');
  }
  if (write && (clean === '' || clean.toLowerCase() === 'assets/index.json' || clean.toLowerCase() === 'assets/index.jsonl' || clean === 'skills' || clean.startsWith('skills/')
    || clean === 'assets/mg' || clean.startsWith('assets/mg/') || clean === 'assets/references' || clean.startsWith('assets/references/')
    || clean === 'assets/upload' || clean.startsWith('assets/upload/'))) {
    deny('This path is managed by the engine and is read-only.');
  }
  const abs = resolve(root, clean);
  noLinks(root, abs);
  if (abs !== root && (!existsSync(abs) || !lstatSync(abs).isDirectory())) noLinks(root, abs + '.animptr');
  if (clean === 'skills' || clean.startsWith('skills/')) assertWorkspaceSkillPath(workspace, abs, access);
  return abs;
}
