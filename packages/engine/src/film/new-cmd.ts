/**
 * `anim new "<what the film should be>" [--dir …]` — create a workspace on this machine.
 *
 * For a coding agent (Claude Code / Cursor / Codex) working on its own machine with nothing but
 * its file tools and this CLI.
 *
 * No server process is involved: materializing a workspace is a plain write to disk.
 */

import { isVideoAspect, resolveStagePreset } from '@animspark/core';
import { FilmCliError, userCwd } from '@animspark/film-build';
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { type Argv, numFlag, strFlag } from './argv';

const DEFAULT_ASPECT = '16:9';

/** The default directory name is a slice of the request, which is easier to recognize than a timestamp. */
function defaultDir(prompt: string): string {
  /* At most ~24 characters, cut at a word boundary: "a-20-second-launch", not "a-20-second-launch-vide". */
  const words = prompt.replace(/[\\/:*?"<>|]/g, '').trim().split(/\s+/).filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 24 && slug) break;
    slug = next.slice(0, 40);
  }
  slug = slug || 'film';
  return resolve(userCwd(), slug);
}

export async function cmdNew(argv: Argv): Promise<string> {
  const prompt = argv.positional[0]?.trim();
  if (!prompt) {
    throw new FilmCliError(
      'Usage: anim new "<what the film should be>" [--dir <dir>] [--aspect 16:9|9:16|1:1|4:3] [--sec 60] [--locale zh-CN]',
    );
  }

  const dirRaw = strFlag(argv, 'dir');
  const taskRoot = dirRaw
    ? (isAbsolute(dirRaw) ? dirRaw : resolve(userCwd(), dirRaw))
    : defaultDir(prompt);
  /* Layout: `<taskRoot>/code` is the agent's working directory; `<taskRoot>/runtime` holds the
     job parameters (task.json) and engine-private state. */
  const code = join(taskRoot, 'code');
  if (existsSync(code) && readdirSync(code).some((n) => !n.startsWith('.'))) {
    throw new FilmCliError(`${code} already exists and is not empty. Pick another --dir.`);
  }

  const aspectRaw = strFlag(argv, 'aspect') ?? DEFAULT_ASPECT;
  if (!isVideoAspect(aspectRaw)) {
    throw new FilmCliError(`--aspect ${aspectRaw} is not one I know. Takes: 16:9 · 9:16 · 1:1 · 4:3 · 21:9`);
  }
  const stage = resolveStagePreset(aspectRaw);

  /* The duration is written to task.json, which the manual tells the agent to read first;
     `anim check` compares the film against it. */
  const secRaw = numFlag(argv, 'sec');
  if (secRaw != null && (!Number.isFinite(secRaw) || secRaw <= 0)) {
    throw new FilmCliError(`--sec ${secRaw} is not a length. Give it seconds: --sec 30`);
  }
  const durationSec = secRaw != null ? Math.round(secRaw) : undefined;

  const { materializeContextPack, prepareTaskBootstrap } = await import('../workbench/context-pack');
  const opts = {
    dest: code,
    prompt,
    stage: { w: stage.w, h: stage.h, aspect: aspectRaw },
    ...(durationSec ? { durationSec } : {}),
    ...(strFlag(argv, 'locale') ? { contentLocale: strFlag(argv, 'locale')! } : {}),
    externalAgentDocs: true,
  };
  prepareTaskBootstrap(opts);
  materializeContextPack(opts);
  /* Keep renders, contact sheets and engine state out of version control from the start. */
  const { existsSync: exists, writeFileSync } = await import('node:fs');
  const ignore = join(code, '.gitignore');
  if (!exists(ignore)) writeFileSync(ignore, '# anim output and engine state\n.anim/\n.anim-out/\n.anim-look/\n.anim-look*.html\nnode_modules/\n', 'utf8');
  /* Install the skills into skills/: the mg foundation plus every film-type skill (with their
     dependencies). The manual lists the same set (see localWorkspaceSkills). */
  const { localWorkspaceSkills, installSkills } = await import('../scene/skill-catalog');
  installSkills(code, localWorkspaceSkills({ role: 'mg' }).map(skill => skill.name));

  return [
    `Workspace ready: ${code}`,
    '',
    '  film.json               the running order — the root of the picture (starts empty)',
    '  assets/                 material (uploads go in assets/upload/)',
    '  skills/                 installed manuals — read skills/animspark/mg/SKILL.md before writing mg/',
    '  CLAUDE.md / AGENTS.md   the workspace manual — read it first',
    `  ../runtime/task.json    this job's parameters: stage${durationSec ? ', duration' : ''}${strFlag(argv, 'locale') ? ', language' : ''}`,
    '',
    `Next: cd ${code}, read CLAUDE.md, then anim check to see where it stands.`,
    'To watch the film live while it is being edited, run anim preview there (a long-running server).',
  ].join('\n');
}
