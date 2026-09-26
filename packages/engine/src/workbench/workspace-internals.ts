/** Platform scaffolding belongs outside the agent's code tree, including on resumed projects. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isolateAssetWords } from '@animspark/film-build';
import { workspaceRuntimeDir } from './workspace-env';

/** Preserve legacy files privately instead of deleting possibly edited copies. */
export function isolateWorkspaceInternals(workspace: string): void {
  if (!existsSync(workspace)) return;
  isolateAssetWords(workspace);
  const legacy: string[] = [];
  for (const path of ['tsconfig.json', 'types']) {
    if (existsSync(join(workspace, path))) legacy.push(path);
  }
  const collectKeepFiles = (dir: string, prefix = ''): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name === '.gitkeep') legacy.push(rel);
      // Never follow symlinks or walk platform state / installed dependencies.
      else if (entry.isDirectory() && !entry.name.startsWith('.')
        && !['node_modules', 'types', 'skills'].includes(entry.name)) {
        collectKeepFiles(join(dir, entry.name), rel);
      }
    }
  };
  collectKeepFiles(workspace);
  if (!legacy.length) return;
  const privateRoot = join(workspaceRuntimeDir(workspace), 'workspace-internals');
  mkdirSync(privateRoot, { recursive: true });
  const backup = mkdtempSync(join(privateRoot, 'legacy-'));
  for (const rel of legacy) {
    const dest = join(backup, rel);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(join(workspace, rel), dest);
  }
}
