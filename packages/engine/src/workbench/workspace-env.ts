/**
 * Workbench workspace conventions: the minimal configuration surface of a film workspace.
 *
 * Layout:
 *   <ws>/code/              the coding agent's only working directory
 *   <ws>/runtime/task.json  private task configuration
 * Older self-contained workspaces with <ws>/.anim/task.json are still supported.
 *
 * The workbench server (server.ts) only accepts absolute workspace paths. On each API call it
 * reads task.json to build a minimal WorkspaceEnv and reuses the same validation, preview and
 * assembly functions as every other entry point, so all of them share one implementation.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export interface WorkbenchTaskConfig {
  role?: 'editor' | 'mg';
  skillSearchEnabled?: boolean;
  skillGetEnabled?: boolean;
  /**
   * Legacy field; older workspaces may still carry it. New workspaces do not write it:
   * a film has no separate name.
   */
  title?: string;
  /** The user's original request (used to pick voice and music themes). */
  prompt: string;
  stage: { w: number; h: number; aspect: string };
  /**
   * Requested length in seconds. Absent when the user gave none; the agent then infers the
   * length from the request.
   *
   * It is stored because it is the number the whole film is planned against: every `at` and
   * every `duration` is measured against it, and the agent reads it from task.json.
   */
  durationSec?: number;
  /**
   * Whether durationSec is a **hard constraint** or a target.
   *
   * It sets how strictly the check treats the length (see briefDuration in film/oss-cli.ts):
   * missing a target is a warning, missing a hard constraint is an error, and an error fails
   * `anim check`, so the agent must bring the length within tolerance before delivering.
   */
  durationStrict?: boolean;
  contentLocale?: string;
  /** Poster frame time in seconds (captured to dist/playback/poster.jpg at the end of a build; defaults to the middle of the first beat). */
  posterAtSec?: number;
  /**
   * Session host: `agent` = unattended session, `local` (default) = a person at the terminal.
   *
   * Affects only the wording of command receipts, never the output. The difference is who can
   * open watchUrl: in a local workspace a person can, so giving them the URL is useful. An
   * unattended agent cannot open a browser or hear sound; given a 127.0.0.1 link, it would only
   * copy it into its reply, where it is an unreachable local address.
   */
  host?: 'agent' | 'local';
}

/** Legacy self-contained workspace path; kept only for compatibility with existing pack:context output and older tasks. */
export const TASK_CONFIG_RELPATH = '.anim/task.json';

/** Runtime state for `<ws>/code` lives in the sibling directory `<ws>/runtime`. */
export function workspaceRuntimeDir(workspace: string): string {
  return join(dirname(resolve(workspace)), 'runtime');
}

/**
 * The workspace's derived-output directory (`code/dist/`).
 *
 * The finished film is not built here (there is no build step; scenes are source code rendered
 * directly). It now holds the TTS cache written by `anim audio` (dist/tts) and restored
 * repository media. Keeping a single location avoids readers and writers disagreeing about
 * where derived files live.
 */
export function workspaceBuildDir(workspace: string): string {
  return join(resolve(workspace), 'dist');
}

/*
 * Build records and validate snapshots used to live here. With no build step nothing writes
 * dist/build.json any more, so they were removed. Whether a run produced a film is decided from
 * the sources themselves.
 */

export function taskConfigPath(workspace: string): string {
  const external = join(workspaceRuntimeDir(workspace), 'task.json');
  if (['code', 'workspace'].includes(basename(resolve(workspace))) && existsSync(external)) return external;
  return join(resolve(workspace), TASK_CONFIG_RELPATH);
}

export function writeTaskConfig(workspace: string, config: WorkbenchTaskConfig): void {
  const runtimeDir = workspaceRuntimeDir(workspace);
  const externalRuntimeExists = ['code', 'workspace'].includes(basename(resolve(workspace))) && existsSync(runtimeDir);
  const path = externalRuntimeExists
    ? join(runtimeDir, 'task.json')
    : join(resolve(workspace), TASK_CONFIG_RELPATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function isWorkbenchWorkspace(dir: string): boolean {
  return existsSync(taskConfigPath(dir));
}

/** Validate and normalize a workspace path (absolute, exists, has task.json). */
export function resolveWorkspaceDir(raw: string): string {
  const dir = resolve(raw);
  if (!isAbsolute(dir)) throw new Error(`workspace must be an absolute path: ${raw}`);
  if (!existsSync(dir)) throw new Error(`workspace does not exist: ${dir}`);
  if (!isWorkbenchWorkspace(dir)) {
    throw new Error(`not an anim workspace (missing runtime/task.json or ${TASK_CONFIG_RELPATH}): ${dir}`);
  }
  return dir;
}

export function readTaskConfig(workspace: string): WorkbenchTaskConfig {
  const p = taskConfigPath(workspace);
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<WorkbenchTaskConfig>;
  if (!parsed || typeof parsed !== 'object') throw new Error(`task.json is not an object: ${p}`);
  const stage = parsed.stage && Number.isFinite(parsed.stage.w) && Number.isFinite(parsed.stage.h)
    ? parsed.stage
    : { w: 1920, h: 1080, aspect: '16:9' };
  return {
    role: parsed.role === 'editor' || parsed.role === 'mg' ? parsed.role : undefined,
    skillSearchEnabled: parsed.skillSearchEnabled,
    skillGetEnabled: parsed.skillGetEnabled,
    prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
    title: parsed.title,
    stage: { w: stage.w, h: stage.h, aspect: stage.aspect || (stage.w >= stage.h ? '16:9' : '9:16') },
    contentLocale: parsed.contentLocale,
    /* Requested length. `anim new --sec` writes it and the check compares the film against it.
       Without this line the stored value has no reader, and a one-second sample film still passes. */
    durationSec: Number.isFinite(Number(parsed.durationSec)) && Number(parsed.durationSec) > 0
      ? Number(parsed.durationSec)
      : undefined,
    /* Only an explicit true is strict. The default is lenient: an unreadable value must not
       turn every length check into a hard failure. */
    durationStrict: parsed.durationStrict === true,
    // Poster time pinned by the author: if it is not read back, the default replaces it and the poster changes on every rebuild.
    posterAtSec: Number.isFinite(Number(parsed.posterAtSec)) && Number(parsed.posterAtSec) >= 0
      ? Number(parsed.posterAtSec)
      : undefined,
    ...(parsed.host === 'agent' || parsed.host === 'local' ? { host: parsed.host } : {}),
  };
}

/** Partially update task.json (fields that must persist across calls, such as a finalized title). */
export function patchTaskConfig(workspace: string, patch: Partial<WorkbenchTaskConfig>): void {
  const p = taskConfigPath(workspace);
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  writeFileSync(p, `${JSON.stringify({ ...parsed, ...patch }, null, 2)}\n`, 'utf8');
}
