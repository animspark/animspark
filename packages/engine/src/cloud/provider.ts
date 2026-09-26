/**
 * Media providers — who actually runs `anim audio tts`, `anim image gen`, … .
 *
 * The engine itself never synthesizes speech or generates images: it hands the request to a
 * `MediaProvider` and lands whatever files come back in the workspace (see land.ts). The
 * default provider is AnimSpark Cloud (animspark.ts, `anim login`). Bring-your-own-key
 * adapters (providers/*.ts) call a vendor API directly with your own key; they are small on
 * purpose, so copying one is the fastest way to add another vendor.
 *
 * ## Which provider runs a command
 *
 *   1. `--provider <id>` on the command line (or `provider` on the MCP tool), else
 *   2. `ANIMSPARK_PROVIDER_<COMMAND>` — e.g. `ANIMSPARK_PROVIDER_AUDIO_TTS=openai`, else
 *   3. `ANIMSPARK_PROVIDER` — one provider for every command it supports, else
 *   4. AnimSpark Cloud, when you are logged in.
 *
 * A bring-your-own-key provider is never picked just because its key happens to be in the
 * environment: it bills your vendor account, so you choose it explicitly (1–3).
 *
 * ## Adding your own
 *
 * Write a module whose default export is a `MediaProvider` (or an array of them) and list it
 * in `ANIMSPARK_PROVIDER_MODULES` (comma-separated absolute paths or package names).
 * `.ts` files work — the CLI runs under tsx. See docs/cloud.md.
 */
import { FilmCliError } from '@animspark/film-build';
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';

import { CLOUD_COMMANDS, type CloudCommandName, type MediaArgs } from './commands';

export interface MediaRequest {
  command: CloudCommandName;
  /** Validated named options, exactly as documented in commands.ts (`out` is always filled in for commands that write a named file). */
  args: MediaArgs;
  /** Workspace files the command reads (today only `audio asr --src`). */
  inputs?: Array<{ path: string; bytes: Buffer }>;
  /** Facts about the project the provider may use, e.g. the narration language. */
  context?: { contentLocale?: string };
  /** AnimSpark Cloud model tier; other providers ignore it. */
  tier?: string;
}

export interface MediaContext {
  /** Absolute path of the workspace (the directory holding film.json). */
  workspace: string;
  /**
   * One key per user-level invocation. A provider that retries must reuse it, so a
   * retried call is never billed twice.
   */
  idempotencyKey: string;
  signal?: AbortSignal;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
}

export interface MediaFile {
  /** Workspace-relative path under assets/, forward slashes (`assets/audio/vo/intro.mp3`). */
  path: string;
  bytes: Buffer;
}

export interface MediaCredits {
  quoted?: number;
  charged?: number;
  metered?: number;
  refunded?: number;
  cost?: number;
}

export interface MediaResult {
  files: MediaFile[];
  /** Rows for assets/index.jsonl describing the files (dur, words, voice rows …). Optional. */
  index?: Array<Record<string, unknown>>;
  /** The command's JSON answer, handed to the agent as is. */
  receipt?: unknown;
  /** Credits as reported by the server (AnimSpark Cloud only). */
  credits?: MediaCredits;
  balance?: number | null;
  budget?: unknown;
  note?: string;
}

export interface MediaQuote {
  /** Whatever the server said; printed as is. */
  quote: unknown;
  note?: string;
}

export interface MediaProvider {
  /** Short, lowercase, used with --provider (`openai`). */
  id: string;
  /** Human name for receipts and help (`OpenAI (your key)`). */
  label: string;
  /** True when this provider has what it needs (a key) to run. */
  configured(env: Record<string, string | undefined>): boolean;
  /** One line telling the user how to configure it (`set OPENAI_API_KEY`). */
  setup: string;
  supports(command: CloudCommandName): boolean;
  /** Defaults for options this provider can fill in itself (e.g. a default voice). */
  defaults?(command: CloudCommandName, env: Record<string, string | undefined>): MediaArgs;
  quote?(req: MediaRequest, ctx: MediaContext): Promise<MediaQuote>;
  run(req: MediaRequest, ctx: MediaContext): Promise<MediaResult>;
}

/* ── registry ─────────────────────────────────────────────────────────────── */

const registered: MediaProvider[] = [];
let builtinsLoaded: Promise<void> | null = null;
const loadedModules = new Set<string>();

export function registerProvider(provider: MediaProvider): void {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(provider.id)) throw new Error(`Provider id ${JSON.stringify(provider.id)} must be lowercase letters, digits and dashes.`);
  const at = registered.findIndex((p) => p.id === provider.id);
  if (at >= 0) registered[at] = provider; else registered.push(provider);
}

/** Tests only. */
export function resetProviders(): void {
  registered.length = 0;
  builtinsLoaded = null;
  loadedModules.clear();
}

function isProvider(value: unknown): value is MediaProvider {
  const p = value as MediaProvider | null;
  return !!p && typeof p.id === 'string' && typeof p.run === 'function' && typeof p.supports === 'function' && typeof p.configured === 'function';
}

/** Built-ins plus anything listed in ANIMSPARK_PROVIDER_MODULES. */
export async function loadProviders(env: Record<string, string | undefined> = process.env): Promise<MediaProvider[]> {
  builtinsLoaded ??= (async () => {
    const [{ animsparkCloud }, { openaiTts }, { elevenlabs }] = await Promise.all([
      import('./animspark'), import('./providers/openai-tts'), import('./providers/elevenlabs'),
    ]);
    for (const p of [animsparkCloud, openaiTts, elevenlabs]) if (!registered.some((r) => r.id === p.id)) registered.push(p);
  })();
  await builtinsLoaded;
  for (const spec of (env.ANIMSPARK_PROVIDER_MODULES ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (loadedModules.has(spec)) continue;
    loadedModules.add(spec);
    let mod: { default?: unknown };
    try {
      mod = await import(isAbsolute(spec) ? pathToFileURL(spec).href : spec);
    } catch (error) {
      throw new FilmCliError(`Could not load provider module ${spec} (from ANIMSPARK_PROVIDER_MODULES): ${error instanceof Error ? error.message : String(error)}`);
    }
    const list = Array.isArray(mod.default) ? mod.default : [mod.default];
    if (!list.length || !list.every(isProvider)) throw new FilmCliError(`${spec} must default-export a MediaProvider (or an array of them): { id, label, setup, configured, supports, run }.`);
    for (const p of list) registerProvider(p);
  }
  return [...registered];
}

export const envKeyFor = (command: CloudCommandName): string => `ANIMSPARK_PROVIDER_${command.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;

export class NoProviderError extends FilmCliError {}

export const NOT_LOGGED_IN = (command: CloudCommandName): string => [
  `anim ${command} runs on a media provider, and none is set up.`,
  '',
  '  · Run `anim login` to connect an AnimSpark Cloud account (create an API key at',
  '    https://animspark.com). Check your balance with `anim credits`.',
  '  · Or use your own files: put them under assets/ (e.g. assets/audio/vo/, assets/image/) and',
  '    reference them from film.json or mg/ — anim check picks them up.',
  '  · Music needs no cloud at all: write a muspark score (assets/audio/music/<name>.ts) and put it',
  '    on an audio track — it renders on this machine.',
].join('\n');

export interface ProviderChoice {
  provider: MediaProvider;
  /** How it was chosen, for help and receipts. */
  why: 'flag' | 'env-command' | 'env' | 'default';
}

/** Pick the provider for one command, or throw a message that lists what would work. */
export function chooseProvider(
  providers: readonly MediaProvider[],
  command: CloudCommandName,
  explicit?: string,
  env: Record<string, string | undefined> = process.env,
): ProviderChoice {
  const byId = (id: string, why: ProviderChoice['why'], source: string): ProviderChoice => {
    const provider = providers.find((p) => p.id === id);
    if (!provider) throw new NoProviderError(`${source} names provider "${id}", which does not exist. Known providers: ${providers.map((p) => p.id).join(', ')}.`);
    if (!provider.supports(command)) {
      const able = providers.filter((p) => p.supports(command)).map((p) => p.id);
      throw new NoProviderError(`${provider.label} cannot run anim ${command}. Providers that can: ${able.join(', ') || 'none'}.`);
    }
    if (!provider.configured(env)) throw new NoProviderError(`${provider.label} is not set up: ${provider.setup}.`);
    return { provider, why };
  };
  if (explicit) return byId(explicit, 'flag', '--provider');
  const perCommand = env[envKeyFor(command)]?.trim();
  if (perCommand) return byId(perCommand, 'env-command', envKeyFor(command));
  const global = env.ANIMSPARK_PROVIDER?.trim();
  if (global) {
    const p = providers.find((x) => x.id === global);
    /* The global preference only applies where that provider can help; everything else falls through. */
    if (!p) throw new NoProviderError(`ANIMSPARK_PROVIDER names provider "${global}", which does not exist. Known providers: ${providers.map((x) => x.id).join(', ')}.`);
    if (p.supports(command)) return byId(global, 'env', 'ANIMSPARK_PROVIDER');
  }
  const cloud = providers.find((p) => p.id === 'animspark');
  if (cloud?.supports(command) && cloud.configured(env)) return { provider: cloud, why: 'default' };

  const others = providers.filter((p) => p.id !== 'animspark' && p.supports(command));
  const ready = others.filter((p) => p.configured(env));
  const lines = [NOT_LOGGED_IN(command)];
  if (ready.length) {
    lines.push('', `Your own key is set for: ${ready.map((p) => p.id).join(', ')}. Choose it explicitly:`,
      `    anim ${command} --provider ${ready[0]!.id} …   or   export ${envKeyFor(command)}=${ready[0]!.id}`);
  } else if (others.length) {
    lines.push('', `Bring-your-own-key providers for this command: ${others.map((p) => `${p.id} (${p.setup})`).join('; ')}.`,
      `Then pass --provider <id> or set ${envKeyFor(command)}.`);
  }
  throw new NoProviderError(lines.join('\n'));
}

/** Providers that are set up and can run this command. */
export function configuredFor(providers: readonly MediaProvider[], command: CloudCommandName, env: Record<string, string | undefined> = process.env): MediaProvider[] {
  return providers.filter((p) => p.supports(command) && p.configured(env));
}

/** Commands with at least one configured provider (for the MCP tool list). */
export function availableCommands(providers: readonly MediaProvider[], env: Record<string, string | undefined> = process.env): CloudCommandName[] {
  return CLOUD_COMMANDS.map((c) => c.name).filter((name) => configuredFor(providers, name, env).length > 0);
}

/* ── small HTTP helper shared by the adapters ─────────────────────────────── */

export class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

/** A fetch with a deadline that also honours the caller's AbortSignal. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; signal?: AbortSignal; fetch?: typeof fetch },
): Promise<Response> {
  const signals = [AbortSignal.timeout(opts.timeoutMs), ...(opts.signal ? [opts.signal] : [])];
  return (opts.fetch ?? fetch)(url, { ...init, signal: AbortSignal.any(signals) });
}

/** Read an error body as the vendor's message, as far as that is possible. */
export async function errorMessage(res: Response): Promise<{ message: string; body: unknown }> {
  const text = await res.text().catch(() => '');
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  const b = body as { error?: unknown; message?: unknown; detail?: unknown } | string;
  const pick = (v: unknown): string | undefined => typeof v === 'string' ? v
    : v && typeof v === 'object' && typeof (v as { message?: unknown }).message === 'string' ? (v as { message: string }).message : undefined;
  const message = typeof b === 'string' ? b.slice(0, 300)
    : pick(b.message) ?? pick(b.error) ?? pick(b.detail) ?? (b.detail ? JSON.stringify(b.detail).slice(0, 300) : undefined) ?? `HTTP ${res.status}`;
  return { message: message || `HTTP ${res.status}`, body };
}
