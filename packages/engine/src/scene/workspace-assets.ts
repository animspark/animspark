/** A workspace keeps all of its media under assets/ (uploads in assets/upload/). */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const ASSETS_DIR = 'assets';
export const LEGACY_RESOURCE_DIR = 'resource';
export function workspaceAssetsDirName(_fsRoot: string): typeof ASSETS_DIR { return ASSETS_DIR; }
export function assetsDirPath(fsRoot: string): string { return join(fsRoot, ASSETS_DIR); }
export function ensureAssetsDir(fsRoot: string): string {
  const dir = assetsDirPath(fsRoot);
  mkdirSync(join(dir, 'upload'), { recursive: true });
  return dir;
}
export function assetsRelPrefix(_fsRoot: string): string { return `${ASSETS_DIR}/`; }
