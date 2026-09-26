/**
 * The cloud half of the `anim` CLI:
 *
 *   anim login [--key <key>] [--api-url <url>]   connect an AnimSpark Cloud account
 *   anim logout                                  forget the saved key
 *   anim credits [--tier <t>] [--json]           balance, plan and the server's price card
 *   anim audio|image|font|web <verb> [options]   media commands, run on a provider
 */
import { FilmCliError } from '@animspark/film-build';

import {
  commandHelp, findCloudCommand, groupHelp, parseCommandArgv, type CloudCommandName,
} from './commands';
import {
  DEFAULT_API_URL, KEYS_PAGE, apiUrlFrom, checkApiUrl, credentialsPath, deleteCredentials, maskKey, saveCredentials,
  type ResolvedCredentials,
} from './credentials';
import { CloudApiError, getSession, requireCredentials, tierOf, type CloudSession } from './animspark';
import { chooseProvider, loadProviders, NoProviderError } from './provider';
import { runCloudCommand } from './run';

type Env = Record<string, string | undefined>;

export const LOGIN_USAGE = `anim login [--key <key>] [--api-url <url>]

  Connect this machine to your AnimSpark Cloud account. Voices, speech, sound effects,
  music, transcription, images and fonts then run there, on your credits.

  Create an API key with the videos:write scope at ${KEYS_PAGE}. Then either
    anim login                      paste it at the hidden prompt, or
    echo "$KEY" | anim login        pipe it in (keeps it out of shell history), or
    anim login --key <key>          pass it (visible in shell history and ps).
  The key is checked against the API, then saved to ${'$XDG_CONFIG_HOME'}/animspark/credentials.json
  (~/.config/animspark/credentials.json by default, mode 600). ANIMSPARK_API_KEY in the
  environment takes precedence over the saved key. --api-url (or ANIMSPARK_API_URL) points at
  another API server.`;

export const CREDITS_USAGE = `anim credits [--tier flash|pro|ultra] [--json]

  Your AnimSpark Cloud balance, plan, the tiers your plan allows and the price of every
  media command, exactly as the server quotes them. Also lists bring-your-own-key providers.`;

function flagValue(args: string[], name: string): string | undefined {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = args[i]!;
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new FilmCliError(`--${name} needs a value.`);
  return v;
}

/** Read a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(question);
  return new Promise((resolve, reject) => {
    let buf = '';
    const done = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (chunk: Buffer | string): void => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') { done(); resolve(buf.trim()); return; }
        if (ch === '\u0003' || ch === '\u0004') { done(); reject(new FilmCliError('Cancelled.')); return; }
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        if (ch >= ' ') buf += ch;
      }
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

function sessionLines(session: CloudSession, creds: ResolvedCredentials): string[] {
  const from = creds.source === 'env' ? 'ANIMSPARK_API_KEY' : creds.path;
  const lines = [
    `AnimSpark Cloud  ${creds.apiUrl}`,
    `  key      ${maskKey(creds.apiKey)} (from ${from})`,
    ...(session.plan ? [`  plan     ${session.plan}`] : []),
    `  balance  ${session.balance} credits`,
  ];
  if (session.budget) lines.push(`  budget   ${session.budget.spent} of ${session.budget.cap ?? '∞'} credits used by this key`);
  if (session.tier) {
    const allowed = (session.tiers ?? []).filter((t) => t.allowed).map((t) => t.tier);
    const locked = (session.tiers ?? []).filter((t) => !t.allowed).map((t) => t.tier);
    lines.push(`  tier     ${session.tier}${allowed.length ? `  (your plan: ${allowed.join(', ')}${locked.length ? `; not included: ${locked.join(', ')}` : ''})` : ''}`);
  }
  return lines;
}

export async function cmdLogin(args: string[], env: Env = process.env): Promise<string> {
  if (args.includes('--help') || args.includes('-h')) return LOGIN_USAGE;
  const apiUrlFlag = flagValue(args, 'api-url');
  let key = flagValue(args, 'key');
  if (!key && !process.stdin.isTTY) key = await readStdin();
  if (!key && process.stdin.isTTY) {
    process.stderr.write(`Create an API key (scope videos:write) at ${KEYS_PAGE}, then paste it here.\n`);
    key = await promptHidden('AnimSpark API key: ');
  }
  key = key?.trim();
  if (!key) throw new FilmCliError(`No key given.\n\n${LOGIN_USAGE}`);
  if (/\s/.test(key)) throw new FilmCliError('That does not look like an API key (it contains whitespace).');

  const apiUrl = apiUrlFlag ? checkApiUrl(apiUrlFlag) : apiUrlFrom(env, null);
  const creds: ResolvedCredentials = { apiKey: key, apiUrl, source: 'file', path: credentialsPath(env) };
  let session: CloudSession;
  try {
    session = await getSession(creds, { tier: tierOf(undefined, env) });
  } catch (error) {
    if (error instanceof CloudApiError && error.status === 401) throw new FilmCliError(`AnimSpark Cloud did not accept that key. Create one with the videos:write scope at ${KEYS_PAGE}. Nothing was saved.`);
    if (error instanceof CloudApiError && error.status === 403) throw new FilmCliError(`${error.message} The key needs the videos:write scope; create one at ${KEYS_PAGE}. Nothing was saved.`);
    throw new FilmCliError(`${error instanceof Error ? error.message : String(error)} Nothing was saved.`);
  }
  /* Remember a non-default server: the key was checked against that one. */
  const path = saveCredentials({ apiKey: key, ...(apiUrl !== DEFAULT_API_URL ? { apiUrl } : {}) }, env);
  return [
    'Logged in.',
    ...sessionLines(session, { ...creds, path }),
    '',
    `Saved to ${path}.`,
    ...(env.ANIMSPARK_API_KEY?.trim() && env.ANIMSPARK_API_KEY.trim() !== key ? ['Note: ANIMSPARK_API_KEY is set in this environment and takes precedence over the saved key.'] : []),
    'Media commands (anim audio / image / font / web) now run on AnimSpark Cloud. `anim credits` shows prices.',
  ].join('\n');
}

export function cmdLogout(args: string[], env: Env = process.env): string {
  if (args.includes('--help') || args.includes('-h')) return 'anim logout\n\n  Delete the API key saved by anim login. Keys stay valid on the server; revoke them at https://animspark.com.';
  const had = deleteCredentials(env);
  return [
    had ? `Logged out: removed ${credentialsPath(env)}.` : 'Not logged in (no saved key).',
    ...(env.ANIMSPARK_API_KEY?.trim() ? ['ANIMSPARK_API_KEY is still set in this environment, so commands will keep using it.'] : []),
    `To revoke the key itself, delete it at ${KEYS_PAGE}.`,
  ].join('\n');
}

export async function cmdCredits(args: string[], env: Env = process.env): Promise<string> {
  if (args.includes('--help') || args.includes('-h')) return CREDITS_USAGE;
  const tier = flagValue(args, 'tier');
  if (tier && !['flash', 'pro', 'ultra'].includes(tier)) throw new FilmCliError('--tier must be flash | pro | ultra.');
  const providers = await loadProviders(env);
  const byo = providers.filter((p) => p.id !== 'animspark')
    .map((p) => `  ${p.id.padEnd(12)} ${p.configured(env) ? 'ready' : `not set up (${p.setup})`}`);
  let creds: ResolvedCredentials;
  try { creds = requireCredentials(env); } catch (error) {
    throw new FilmCliError(`${error instanceof Error ? error.message : String(error)}\n\nBring-your-own-key providers:\n${byo.join('\n')}`);
  }
  const session = await getSession(creds, { tier: tierOf(tier, env) });
  if (args.includes('--json')) return JSON.stringify({ apiUrl: creds.apiUrl, keySource: creds.source, ...session }, null, 2);
  const prices = session.prices ?? [];
  const width = Math.max(12, ...prices.map((p) => p.command.length));
  return [
    ...sessionLines(session, creds),
    '',
    ...(prices.length ? [`Prices${session.tier ? ` (${session.tier} tier)` : ''}, as quoted by the server:`, ...prices.map((p) => `  ${p.command.padEnd(width)}  ${p.price}`)] : ['The server sent no price card.']),
    '',
    'Use --quote on any media command for the exact upper bound before running it.',
    '',
    'Bring-your-own-key providers (pick with --provider or ANIMSPARK_PROVIDER_<COMMAND>):',
    ...byo,
  ].join('\n');
}

async function runsOnLine(name: CloudCommandName, explicit: string | undefined, env: Env): Promise<string> {
  const providers = await loadProviders(env);
  const alternatives = providers.filter((p) => p.id !== 'animspark' && p.supports(name));
  const alt = alternatives.length
    ? `\nAlso available with your own key: ${alternatives.map((p) => `${p.id} (${p.configured(env) ? 'ready' : p.setup})`).join(', ')} — pass --provider <id>.`
    : '';
  try {
    const { provider, why } = chooseProvider(providers, name, explicit, env);
    if (provider.id === 'animspark') return `Runs on AnimSpark Cloud and spends credits from your account (\`anim credits\`; --quote prices a call first).${alt}`;
    return `Runs on ${provider.label}${why === 'flag' ? '' : ` (chosen by ${why === 'env' ? 'ANIMSPARK_PROVIDER' : 'ANIMSPARK_PROVIDER_*'})`}; billed by that vendor.${alt}`;
  } catch (error) {
    if (error instanceof NoProviderError && !explicit) return `Runs on AnimSpark Cloud after \`anim login\` (keys at ${KEYS_PAGE}).${alt}`;
    return `Provider: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * `anim <group> <verb> …`. `workspace` is resolved lazily: help, quotes and the
 * not-logged-in answer do not need one.
 */
export async function runCloudCli(group: string, rest: string[], opts: { workspace?: string; signal?: AbortSignal; env?: Env } = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const [verb, ...args] = rest;
  if (!verb || verb === '--help' || verb === '-h') return groupHelp(group);
  const command = findCloudCommand(`${group} ${verb}`);
  if (!command) throw new FilmCliError(`anim ${group} has no '${verb}'.\n\n${groupHelp(group)}`);
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    let explicit: string | undefined;
    try { explicit = flagValue(args, 'provider'); } catch { /* help anyway */ }
    return commandHelp(command, await runsOnLine(command.name, explicit, env));
  }
  const parsed = parseCommandArgv(command, args);
  const needsWorkspace = !parsed.quote;
  const workspace = opts.workspace || (needsWorkspace ? await findWorkspaceAfterProvider(command.name, parsed.provider, env) : undefined);
  const out = await runCloudCommand({
    command: command.name,
    args: parsed.args,
    provider: parsed.provider,
    tier: parsed.tier,
    quote: parsed.quote,
    workspace,
    signal: opts.signal,
    env,
  });
  process.stderr.write(`[anim] ${out.summary}\n`);
  return JSON.stringify(out.json, null, 2);
}

/** Say "log in" before "not a workspace": the provider is the first thing a new user is missing. */
async function findWorkspaceAfterProvider(name: CloudCommandName, provider: string | undefined, env: Env): Promise<string> {
  chooseProvider(await loadProviders(env), name, provider, env);
  const { findCliWorkspace } = await import('../film/cli-workspace');
  const ws = findCliWorkspace();
  try { const { syncAssetIndex } = await import('../film/asset-sync'); await syncAssetIndex(ws); } catch { /* bookkeeping only */ }
  return ws;
}
