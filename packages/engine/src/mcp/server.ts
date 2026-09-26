/**
 * `anim mcp` — the engine as MCP tools for a coding agent, over stdio.
 *
 * stdout carries the protocol and nothing else: anything the engine prints while a tool runs
 * (progress, warnings, a stray console.log in a dependency) is redirected to stderr, which
 * clients show as the server's log.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { createMcpServer } from './protocol';
import { buildTools, createState } from './tools';

export const MCP_USAGE = `anim mcp

  Serve the engine to a coding agent as MCP tools over stdio: new, check, look (returns the
  image), render, clip, preview_url, plus the media commands (audio_tts, image_gen, …) while
  a provider is set up (anim login, or your own key). Every tool takes an optional
  "workspace"; the default is the server's working directory.

  Claude Code   claude mcp add animspark -- anim mcp
  Codex         codex mcp add animspark -- anim mcp
  Cursor        .cursor/mcp.json: { "mcpServers": { "animspark": { "command": "anim", "args": ["mcp"] } } }

  See docs/agents.md.`;

export const INSTRUCTIONS = [
  'AnimSpark makes videos from code: a film is film.json (the running order) plus React/GSAP scenes in mg/ and media in assets/.',
  'Create a workspace with `new` (or work in an existing one), read its CLAUDE.md/AGENTS.md and skills/animspark/mg/SKILL.md, then edit the files with your own file tools.',
  'After each round of edits call `check`; use `look` to see frames (it returns the image) and `render` for the final mp4. `preview_url` gives the user a live preview.',
  'Media tools (audio_*, image_*, font_search, web_*) appear when a provider is set up; AnimSpark Cloud ones spend the user\'s credits — use quote:true when unsure.',
].join(' ');

function version(): string {
  try { return (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '0.0.0'; } catch { return '0.0.0'; }
}

export async function serveMcpStdio(): Promise<void> {
  const out = process.stdout.write.bind(process.stdout) as (chunk: string) => boolean;
  /* From here on, only protocol messages reach stdout. */
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;

  const state = createState();
  const server = createMcpServer({
    serverInfo: { name: 'animspark', title: 'AnimSpark', version: version() },
    instructions: INSTRUCTIONS,
    tools: () => buildTools(state),
    send: (line) => { out(`${line}\n`); },
  });

  const pending = new Set<Promise<void>>();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const p = server.handleLine(line).catch((error: unknown) => {
      process.stderr.write(`[anim mcp] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    });
    pending.add(p);
    void p.finally(() => pending.delete(p));
  });

  /* The client closing stdin means it is gone: give quick calls a moment to answer, then stop the rest. */
  const shutdown = async (): Promise<void> => {
    await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 3000))]);
    server.abortAll();
    await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 2000))]);
    await Promise.allSettled([...state.previews.values()].map(async (p) => (await p).close()));
  };
  await new Promise<void>((done) => {
    rl.once('close', done);
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
  await shutdown();
  process.exit(0);
}
