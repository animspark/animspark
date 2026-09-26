/**
 * One media command, end to end: pick the provider, validate the options, upload inputs,
 * run, land the files, index them, and put together the receipt. The CLI (cli.ts) and the
 * MCP server (../mcp/tools.ts) both call this, so they behave identically.
 */
import { FilmCliError, readAssetIndex } from '@animspark/film-build';
import { randomUUID } from 'node:crypto';

import { findCloudCommand, requireArgs, type CloudCommand, type CloudCommandName, type MediaArgs } from './commands';
import { landResult, readWorkspaceInput } from './land';
import { chooseProvider, loadProviders, type MediaProvider, type MediaRequest, type ProviderChoice } from './provider';

type Env = Record<string, string | undefined>;

const MAX_INPUT_BYTES = 48 * 1024 * 1024;

export interface CloudRunOptions {
  command: CloudCommandName;
  args: MediaArgs;
  /** Needed to run; not needed for --quote. */
  workspace?: string;
  provider?: string;
  tier?: string;
  quote?: boolean;
  signal?: AbortSignal;
  env?: Env;
  fetch?: typeof fetch;
  /** Normally generated here, one per invocation. */
  idempotencyKey?: string;
}

export interface CloudRunOutput {
  /** The JSON answer for the agent. */
  json: Record<string, unknown>;
  /** One human line (stderr in the CLI). */
  summary: string;
}

/** The narration language from ../runtime/task.json, when `anim new --locale` set one. */
async function contentLocaleOf(workspace: string | undefined): Promise<string | undefined> {
  if (!workspace) return undefined;
  try {
    const { readTaskConfig } = await import('../workbench/workspace-env');
    return readTaskConfig(workspace).contentLocale;
  } catch { return undefined; }
}

const kb = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export async function resolveCommand(name: CloudCommandName, provider: string | undefined, env: Env): Promise<{ command: CloudCommand; choice: ProviderChoice; providers: MediaProvider[] }> {
  const command = findCloudCommand(name);
  if (!command) throw new FilmCliError(`anim ${name} is not a command.`);
  const providers = await loadProviders(env);
  return { command, choice: chooseProvider(providers, name, provider, env), providers };
}

export async function runCloudCommand(opts: CloudRunOptions): Promise<CloudRunOutput> {
  const env = opts.env ?? process.env;
  const { command, choice } = await resolveCommand(opts.command, opts.provider, env);
  const { provider } = choice;
  const args = requireArgs(command, opts.args, provider.defaults?.(command.name, env));
  const contentLocale = await contentLocaleOf(opts.workspace);
  const req: MediaRequest = {
    command: command.name,
    args,
    ...(contentLocale ? { context: { contentLocale } } : {}),
    ...(opts.tier ? { tier: opts.tier } : {}),
  };
  const idempotencyKey = opts.idempotencyKey ?? `anim-${randomUUID()}`;

  if (opts.quote) {
    if (!provider.quote) {
      return {
        json: { command: command.name, provider: provider.id, quote: null, note: `${provider.label} does not quote prices; it bills your own account with that vendor.` },
        summary: `${provider.label} has no quotes.`,
      };
    }
    const q = await provider.quote(req, { workspace: opts.workspace ?? '', idempotencyKey, signal: opts.signal, fetch: opts.fetch, env });
    return { json: { command: command.name, provider: provider.id, ...(q.quote as object), ...(q.note ? { note: q.note } : {}) }, summary: `quote from ${provider.label}` };
  }

  if (!opts.workspace) throw new FilmCliError('This command writes into a workspace: run it inside one (a directory with film.json).');
  const ws = opts.workspace;
  const inputs = (command.inputs ?? []).flatMap((flag) => {
    const rel = args[flag];
    if (typeof rel !== 'string') return [];
    try { return [{ path: rel, bytes: readWorkspaceInput(ws, rel, MAX_INPUT_BYTES) }]; } catch (error) {
      throw new FilmCliError(`--${flag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (inputs.length) req.inputs = inputs;

  let result;
  try {
    result = await provider.run(req, { workspace: ws, idempotencyKey, signal: opts.signal, fetch: opts.fetch, env });
  } catch (error) {
    if (error instanceof FilmCliError) throw error;
    if (opts.signal?.aborted) throw error;
    throw new FilmCliError(`anim ${command.name} on ${provider.label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let landed;
  try {
    landed = await landResult(ws, result);
  } catch (error) {
    throw new FilmCliError(`${provider.label} returned a file this workspace will not accept. ${error instanceof Error ? error.message : String(error)}`);
  }
  const index = readAssetIndex(ws);
  const files = landed.written.map((f) => {
    const dur = index[f.path]?.dur;
    return { path: f.path, bytes: f.bytes, ...(typeof dur === 'number' ? { dur } : {}) };
  });

  const receipt = result.receipt;
  const body: Record<string, unknown> = Array.isArray(receipt) ? { results: receipt }
    : receipt && typeof receipt === 'object' ? { ...(receipt as Record<string, unknown>) }
    : receipt === undefined ? {} : { result: receipt };
  const json: Record<string, unknown> = {
    ...body,
    provider: provider.id,
    ...(files.length ? { files } : {}),
    ...(result.credits ? { credits: result.credits } : {}),
    ...(result.balance !== undefined && result.balance !== null ? { balance: result.balance } : {}),
    ...(result.budget ? { budget: result.budget } : {}),
    ...(result.note ? { note: result.note } : {}),
    ...(landed.indexError ? { indexWarning: `The files are written, but the asset index was not fully updated: ${landed.indexError}` } : {}),
  };

  const spent = result.credits ? (result.credits.cost ?? result.credits.charged) : undefined;
  const summary = [
    `anim ${command.name} via ${provider.label}`,
    files.length ? `wrote ${files.map((f) => `${f.path} (${kb(f.bytes)})`).join(', ')}` : 'no files',
    ...(spent !== undefined ? [`${spent} credits charged${result.credits?.refunded ? ` (${result.credits.refunded} refunded)` : ''}`] : []),
    ...(result.balance !== undefined && result.balance !== null ? [`balance ${result.balance}`] : []),
  ].join(' · ');
  return { json, summary };
}
