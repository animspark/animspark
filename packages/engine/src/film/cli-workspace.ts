/** Media commands also run in code-only MG workspaces. Their identity comes
 * from the host's sibling runtime, never from a file the agent can author. */
import { FilmCliError, findWorkspace, userCwd } from '@animspark/film-build';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isAgentRole } from '../agents/definitions';
type AgentWorkspaceRole = 'editor' | 'mg';

const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function layoutRole(workspace: string): AgentWorkspaceRole | undefined {
  if (basename(workspace) !== 'workspace') return;
  const owner = dirname(workspace);
  if (basename(owner) === 'editor') return 'editor';
  if (basename(dirname(owner)) === 'mg' && ASSET_ID.test(basename(owner))) return 'mg';
}

/** Reject linked ancestors as well as linked task files; a copied marker or a
 * symlink must not let a child command acquire another project's workspace. */
function regularPath(path: string, file = false): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (file ? !stat.isFile() : !stat.isDirectory())) return false;
    if (realpathSync(path) !== path) return false;
    const parent = dirname(path);
    return parent === path || regularPath(parent);
  } catch { return false; }
}

export function findCliWorkspace(start = userCwd()): string {
  const cwd = resolve(start);
  if (!regularPath(cwd)) throw new FilmCliError('The CLI workspace must be an existing directory without linked ancestors.');
  for (let dir = cwd; ; dir = dirname(dir)) {
    const role = layoutRole(dir);
    if (role) {
      const task = join(dirname(dir), 'runtime', 'task.json');
      let authorized = false;
      if (regularPath(task, true)) {
        try {
          const config = JSON.parse(readFileSync(task, 'utf8'));
          /* task.json's role records **which agent** owns this workspace, not the directory
             layout: the product agent (mg) works in editor/workspace, and editor is no longer a
             registered role. */
          authorized = isAgentRole(config?.role);
        } catch { /* invalid host configuration is not a legacy-film fallback */ }
      }
      if (!authorized) throw new FilmCliError('The agent workspace is unavailable. Its host task configuration must match its role.');
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
  }
  // Standalone/legacy CLI projects retain their existing film.json contract.
  return findWorkspace(cwd);
}
