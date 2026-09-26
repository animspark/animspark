/**
 * Pointer-only assets on the look/render page.
 *
 * The page is opened from `file://`, so `assets/upload/screen.mp4` is read straight from disk.
 * When the workspace holds only a pointer for it (`screen.mp4.animptr`, bytes in AnimSpark
 * Cloud), Chromium would get a 404 and the frame would silently render black. This route
 * turns that into an explicit failure naming the file, so look/render report it instead.
 */
import type { Page } from 'playwright';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planWorkspaceMedia, pointerOnlyMessage } from '../workspace-media';

/** Requests outside `worktree` (the page itself, its scripts) pass through untouched. */
export async function serveWorkspaceMedia(page: Page, opts: { worktree: string }): Promise<void> {
  const worktree = resolve(opts.worktree);
  const base = pathToFileURL(worktree).href.replace(/\/+$/, '');

  await page.route(`${base}/**`, async (route) => {
    let abs: string;
    try {
      abs = decodeURIComponent(new URL(route.request().url()).pathname);
    } catch {
      await route.continue();
      return;
    }
    const rel = relative(worktree, abs);
    if (!rel || rel.startsWith('..') || planWorkspaceMedia(abs).kind !== 'pointer') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 502, body: pointerOnlyMessage(rel) });
  });
}
