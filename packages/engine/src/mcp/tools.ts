/**
 * The tools `anim mcp` serves. Each one is the CLI command of the same name, run in-process
 * against a workspace:
 *
 *   new          create a workspace                    (anim new)
 *   check        validate film.json and compile mg/    (anim check [--timeline])
 *   look         a contact sheet / one frame / the mix  (anim look …) — returned as an image
 *   render       the mp4                                (anim render …)
 *   clip         one block on a transparent background (anim clip <id> …)
 *   preview_url  a live browser preview                 (anim preview, started once per workspace)
 *   audio_tts, image_gen, …   media commands — listed only while a provider is set up
 *
 * Workspace: every tool takes an optional `workspace` path. Without it the server uses the
 * workspace created by the last `new` call, else its own working directory; either way the
 * directory (or one above it) must hold film.json.
 */
import { FilmCliError } from '@animspark/film-build';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { CLOUD_COMMANDS, coerceArgs, META_FLAGS, type CloudCommand, type CommandOption } from '../cloud/commands';
import { configuredFor, loadProviders, type MediaProvider } from '../cloud/provider';
import type { McpCallContext, McpTool, McpToolResult } from './protocol';
import { textResult } from './protocol';

type Json = Record<string, unknown>;

export interface McpState {
  cwd: string;
  /** Set by `new`, so the next calls can omit `workspace`. */
  lastWorkspace?: string;
  previews: Map<string, Promise<{ url: string; close(): Promise<void> }>>;
  lanes: Map<string, Promise<unknown>>;
  env: Record<string, string | undefined>;
}

export function createState(cwd = process.cwd(), env: Record<string, string | undefined> = process.env): McpState {
  return { cwd, previews: new Map(), lanes: new Map(), env };
}

const WORKSPACE_PROP: Json = {
  type: 'string',
  description: 'Path to the film workspace (the directory with film.json, or the folder `new` created). Default: the workspace from the last `new` call, else the server\'s working directory.',
};

async function workspaceOf(state: McpState, arg: unknown): Promise<string> {
  if (arg !== undefined && typeof arg !== 'string') throw new FilmCliError('workspace must be a path string.');
  let start = arg ? (isAbsolute(arg) ? arg : resolve(state.cwd, arg)) : (state.lastWorkspace ?? state.cwd);
  /* `new --dir X` makes X/code; accept X too. */
  if (!existsSync(join(start, 'film.json')) && existsSync(join(start, 'code', 'film.json'))) start = join(start, 'code');
  if (!existsSync(start)) throw new FilmCliError(`${start} does not exist. Create a workspace with the new tool, or pass the path of one.`);
  const { findCliWorkspace } = await import('../film/cli-workspace');
  /* The caller named this path; resolve links in it (macOS /var → /private/var) before the
     workspace check, which refuses linked ancestors. */
  return findCliWorkspace(realpathSync(start));
}

/** One engine command at a time per workspace: they share the browser and the output folders. */
function inLane<T>(state: McpState, key: string, run: () => Promise<T>): Promise<T> {
  const before = state.lanes.get(key) ?? Promise.resolve();
  const task = before.catch(() => undefined).then(run);
  state.lanes.set(key, task);
  return task.finally(() => { if (state.lanes.get(key) === task) state.lanes.delete(key); });
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).trim();

function jsonResult(text: string): McpToolResult {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { content: [{ type: 'text', text: trimmed }], structuredContent: parsed as Json };
  } catch { /* plain text */ }
  return textResult(trimmed);
}

async function engine(state: McpState, ws: string, group: string, argv: string[], ctx: McpCallContext): Promise<string> {
  const { runCodeCli } = await import('../film/oss-cli');
  return inLane(state, ws, async () => {
    ctx.progress(`anim ${group} running`);
    try {
      return await runCodeCli(ws, group, argv, ctx.signal);
    } catch (error) {
      const what = errorText(error);
      if ((group === 'check' || group === 'look') && !what.startsWith('{')) throw new FilmCliError(JSON.stringify({ status: 'Fail', errors: [what] }, null, 2));
      throw error;
    }
  });
}

/** `{ fps: 4, poster_at: 2 }` → `['--fps', '4', '--poster-at', '2']`. */
function flags(args: Json, names: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [key, flag] of Object.entries(names)) {
    const v = args[key];
    if (v === undefined || v === null || v === false) continue;
    if (v === true) { out.push(`--${flag}`); continue; }
    if (typeof v !== 'number' && typeof v !== 'string') throw new FilmCliError(`${key} must be a number or string.`);
    out.push(`--${flag}`, String(v));
  }
  return out;
}

const num = (description: string, extra: Json = {}): Json => ({ type: 'number', description, ...extra });
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

/** Encode the PNG for the client; very large frames are downscaled for transport only. */
async function imageContent(abs: string): Promise<{ data: string; note?: string }> {
  const MAX = 3.5 * 1024 * 1024;
  const bytes = readFileSync(abs);
  if (bytes.length <= MAX) return { data: bytes.toString('base64') };
  const sharp = (await import('sharp')).default;
  const small = await sharp(bytes).resize({ width: 1280, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  return { data: small.toString('base64'), note: `The PNG is ${(bytes.length / 1e6).toFixed(1)} MB; the image here is downscaled to 1280 px wide. The full-resolution file is at the path in the receipt.` };
}

function engineTools(state: McpState): McpTool[] {
  return [
    {
      name: 'new',
      title: 'New film workspace',
      description: 'Create a new film workspace from a one-line brief (anim new). It contains film.json (the running order), assets/, skills/ and CLAUDE.md/AGENTS.md — read CLAUDE.md or AGENTS.md and skills/animspark/mg/SKILL.md before writing scenes in mg/. Later calls without `workspace` use this one.',
      inputSchema: obj({
        prompt: { type: 'string', description: 'What the film should be, in one or two sentences.' },
        dir: { type: 'string', description: 'Folder to create (relative to the server\'s working directory). The workspace is <dir>/code. Default: derived from the prompt.' },
        aspect: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '21:9'], description: 'Frame aspect. Default 16:9.' },
        sec: num('Target length in seconds.', { exclusiveMinimum: 0 }),
        locale: { type: 'string', description: 'Content language, e.g. en-US or zh-CN.' },
      }, ['prompt']),
      annotations: { destructiveHint: false, openWorldHint: false },
      async execute(args) {
        if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw new FilmCliError('prompt is required.');
        const { cmdNew } = await import('../film/new-cmd');
        const { parseArgv } = await import('../film/argv');
        const dir = typeof args.dir === 'string' && args.dir ? (isAbsolute(args.dir) ? args.dir : resolve(state.cwd, args.dir)) : undefined;
        const argv = [args.prompt, ...(dir ? ['--dir', dir] : []), ...flags(args, { aspect: 'aspect', sec: 'sec', locale: 'locale' })];
        const prev = process.env.ANIM_FILM_CWD;
        process.env.ANIM_FILM_CWD = state.cwd;
        let out: string;
        try { out = await cmdNew(parseArgv(argv)); } finally {
          if (prev === undefined) delete process.env.ANIM_FILM_CWD; else process.env.ANIM_FILM_CWD = prev;
        }
        const ws = /^Workspace ready: (.+)$/m.exec(out)?.[1]?.trim();
        if (ws) state.lastWorkspace = ws;
        return { content: [{ type: 'text', text: out.replace(/\n\ncd .*$/s, '\n\nPass this path as `workspace` to the other tools (or omit it: it is now the default).') }], ...(ws ? { structuredContent: { workspace: ws } } : {}) };
      },
    },
    {
      name: 'check',
      title: 'Check the film',
      description: 'Validate film.json and compile every MG scene (anim check). Call it after each round of edits. Returns {"status":"Pass"} with warnings, or {"status":"Fail"} with the errors to fix. timeline:true also returns the evaluated stage, duration and clip timings.',
      inputSchema: obj({ workspace: WORKSPACE_PROP, timeline: { type: 'boolean', description: 'Include the evaluated timeline.' } }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute(args, ctx) {
        const ws = await workspaceOf(state, args.workspace);
        return jsonResult(await engine(state, ws, 'check', args.timeline === true ? ['--timeline'] : [], ctx));
      },
    },
    {
      name: 'look',
      title: 'Look at the film',
      description: 'See the film as the viewer will (anim look). Without `at`: a contact sheet of thumbnails across [from, to) at `fps` — for pacing. With `at`: one frame at native resolution — for quality (small type, banding, overlaps). With sound:true: a picture of the mix (loudness, which sound plays when). Times are seconds. Returns the PNG as an image plus the JSON receipt (warnings such as frozen tails come in the receipt).',
      inputSchema: obj({
        workspace: WORKSPACE_PROP,
        at: num('One frame at this second (native resolution).', { minimum: 0 }),
        from: num('Contact sheet start, seconds. Default 0.', { minimum: 0 }),
        to: num('Contact sheet end, seconds. Default: the end of the film.', { minimum: 0 }),
        fps: num('Thumbnails per second for the contact sheet.', { exclusiveMinimum: 0 }),
        cols: { type: 'integer', minimum: 1, description: 'Contact sheet columns.' },
        width: { type: 'integer', minimum: 16, description: 'Frame width in px.' },
        sound: { type: 'boolean', description: 'Draw the sound instead of the picture.' },
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute(args, ctx) {
        const ws = await workspaceOf(state, args.workspace);
        const argv = flags(args, { at: 'at', from: 'from', to: 'to', fps: 'fps', cols: 'cols', width: 'width', sound: 'sound' });
        const text = (await engine(state, ws, 'look', argv, ctx)).trim();
        let receipt: Json;
        try { receipt = JSON.parse(text) as Json; } catch { return textResult(text); }
        const content: McpToolResult['content'] = [{ type: 'text', text }];
        if (typeof receipt.path === 'string') {
          const abs = resolve(ws, receipt.path);
          if (abs.startsWith(ws) && existsSync(abs) && statSync(abs).isFile()) {
            const img = await imageContent(abs);
            content.push({ type: 'image', data: img.data, mimeType: 'image/png' });
            if (img.note) content.push({ type: 'text', text: img.note });
          }
        }
        return { content, structuredContent: receipt };
      },
    },
    {
      name: 'render',
      title: 'Render the mp4',
      description: 'Render the whole film to an mp4 under .anim-out/ (anim render). Refuses while check fails. Takes a while — minutes for long films. For a quick listen use fps 4 and width 480: the picture is rough, the audio is identical. Returns JSON with video / poster / audio paths, duration, frames and fps.',
      inputSchema: obj({
        workspace: WORKSPACE_PROP,
        fps: num('Frames per second. Default: the source footage rate, else the engine default.', { exclusiveMinimum: 0 }),
        width: { type: 'integer', minimum: 16, description: 'Output width in px. Default: the stage width.' },
        poster_at: num('Second to take the poster frame from.', { minimum: 0 }),
        out: { type: 'string', description: 'Output folder relative to the workspace. Default .anim-out.' },
      }),
      annotations: { destructiveHint: false, openWorldHint: false },
      async execute(args, ctx) {
        const ws = await workspaceOf(state, args.workspace);
        return jsonResult(await engine(state, ws, 'render', flags(args, { fps: 'fps', width: 'width', poster_at: 'poster-at', out: 'out' }), ctx));
      },
    },
    {
      name: 'clip',
      title: 'Export one block',
      description: 'Export a single MG block over a transparent background (anim clip), silent. Formats: webm (VP9 + alpha, default; Chrome/Firefox), prores (ProRes 4444 for After Effects / Premiere / Final Cut / Resolve), png (numbered sequence), mp4 (no alpha). The receipt reports measured transparency: alpha=false means the block painted its own background.',
      inputSchema: obj({
        workspace: WORKSPACE_PROP,
        clip_id: { type: 'string', description: 'The clip id from film.json (see the clipId column of check with timeline:true).' },
        format: { type: 'string', enum: ['webm', 'prores', 'png', 'mp4'], description: 'Default webm.' },
        fps: num('Frames per second.', { exclusiveMinimum: 0 }),
        width: { type: 'integer', minimum: 16, description: 'Output width in px.' },
        out: { type: 'string', description: 'Output folder relative to the workspace.' },
      }, ['clip_id']),
      annotations: { destructiveHint: false, openWorldHint: false },
      async execute(args, ctx) {
        if (typeof args.clip_id !== 'string' || !args.clip_id) throw new FilmCliError('clip_id is required.');
        const ws = await workspaceOf(state, args.workspace);
        return jsonResult(await engine(state, ws, 'clip', [args.clip_id, ...flags(args, { format: 'format', fps: 'fps', width: 'width', out: 'out' })], ctx));
      },
    },
    {
      name: 'preview_url',
      title: 'Live preview URL',
      description: 'Start a live browser preview of the film (anim preview) and return its local URL. It follows every save — picture, sound and timeline — and shows compile errors on the page. Started once per workspace; later calls return the same URL. Give the URL to the user to watch.',
      inputSchema: obj({ workspace: WORKSPACE_PROP }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute(args) {
        const ws = await workspaceOf(state, args.workspace);
        let server = state.previews.get(ws);
        if (!server) {
          server = (async () => {
            const { syncAssetIndex } = await import('../film/asset-sync');
            await syncAssetIndex(ws).catch(() => undefined);
            const { startPreview } = await import('../film/oss-preview');
            try { return await startPreview(ws, { port: 4173 }); } catch (error) {
              if ((error as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') throw error;
              return startPreview(ws, { port: 0 });
            }
          })();
          state.previews.set(ws, server);
          server.catch(() => state.previews.delete(ws));
        }
        const { url } = await server;
        return { content: [{ type: 'text', text: JSON.stringify({ url, workspace: ws }) }], structuredContent: { url, workspace: ws } };
      },
    },
  ];
}

/* ── media commands ───────────────────────────────────────────────────────── */

function optionSchema(option: CommandOption): Json {
  if (!option.value) return { type: 'boolean', description: option.doc };
  const numeric = option.min !== undefined || option.max !== undefined || option.integer;
  const one: Json = numeric
    ? { type: option.integer ? 'integer' : 'number', ...(option.min !== undefined ? { minimum: option.min } : {}), ...(option.max !== undefined ? { maximum: option.max } : {}) }
    : { type: 'string', ...(option.choices ? { enum: [...option.choices] } : {}) };
  if (option.repeat) {
    return { type: 'array', items: one, minItems: 1, ...(option.maxOccurrences ? { maxItems: option.maxOccurrences } : {}), description: option.doc };
  }
  return { ...one, description: option.doc, ...(option.defaultValue !== undefined ? { default: option.defaultValue } : {}) };
}

export const toolNameOf = (command: CloudCommand): string => command.name.replace(' ', '_');

function mediaTool(state: McpState, command: CloudCommand, ready: MediaProvider[]): McpTool {
  const cloud = ready.some((p) => p.id === 'animspark');
  const properties: Json = { workspace: WORKSPACE_PROP };
  for (const [name, option] of Object.entries(command.options)) properties[name] = optionSchema(option);
  properties.provider = { type: 'string', enum: ready.map((p) => p.id), description: `Which provider runs it. Set up: ${ready.map((p) => `${p.id} (${p.label})`).join(', ')}. Default: the configured choice${cloud ? ' (AnimSpark Cloud)' : ''}.` };
  if (cloud) properties.tier = { ...optionSchema(META_FLAGS.tier!), description: 'AnimSpark Cloud model tier. Default flash.' };
  properties.quote = { type: 'boolean', description: 'Only return the price (AnimSpark Cloud); run nothing, spend nothing.' };
  /* An option every ready provider fills in by itself (e.g. a default voice) is not required here. */
  const filled = (name: string): boolean => ready.length > 0 && ready.every((p) => p.defaults?.(command.name, state.env)?.[name] !== undefined);
  const required = Object.entries(command.options).filter(([name, o]) => o.required && !filled(name)).map(([name]) => name);
  const runsOn = cloud
    ? 'Runs on AnimSpark Cloud and spends credits from the user\'s account (quote:true shows the price first).'
    : `Runs on ${ready.map((p) => p.label).join(' / ')}, billed to the user's own vendor account.`;
  return {
    name: toolNameOf(command),
    title: `anim ${command.name}`,
    description: `${command.description} ${runsOn} Same as \`anim ${command.name}\` in a shell. Files land in the workspace and are indexed in assets/index.jsonl.`,
    inputSchema: obj(properties, required),
    annotations: { destructiveHint: false, openWorldHint: true },
    async execute(args, ctx) {
      const { workspace, provider, tier, quote, ...rest } = args;
      if (provider !== undefined && typeof provider !== 'string') throw new FilmCliError('provider must be a string.');
      if (tier !== undefined && !['flash', 'pro', 'ultra'].includes(String(tier))) throw new FilmCliError('tier must be flash, pro or ultra.');
      const named = coerceArgs(command, rest);
      const { runCloudCommand } = await import('../cloud/run');
      const ws = quote === true && workspace === undefined ? undefined : await workspaceOf(state, workspace);
      ctx.progress(`anim ${command.name} running`);
      const out = await runCloudCommand({
        command: command.name,
        args: named,
        workspace: ws,
        provider: provider as string | undefined,
        tier: tier as string | undefined,
        quote: quote === true,
        signal: ctx.signal,
        env: state.env,
      });
      return { content: [{ type: 'text', text: JSON.stringify(out.json, null, 2) }], structuredContent: out.json };
    },
  };
}

export async function buildTools(state: McpState): Promise<McpTool[]> {
  const tools = engineTools(state);
  let providers: MediaProvider[] = [];
  try { providers = await loadProviders(state.env); } catch (error) {
    process.stderr.write(`[anim mcp] providers: ${errorText(error)}\n`);
  }
  for (const command of CLOUD_COMMANDS) {
    const ready = configuredFor(providers, command.name, state.env);
    if (ready.length) tools.push(mediaTool(state, command, ready));
  }
  return tools;
}
