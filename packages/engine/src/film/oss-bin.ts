#!/usr/bin/env node
/**
 * anim — the open-source AnimSpark engine.
 *
 *   anim new "<what the film should be>" [--dir <dir>] [--aspect 16:9] [--sec 30]
 *   anim check [--timeline]
 *   anim look [--from <s> --to <s>] [--fps <n>] | --at <s> | --sound
 *   anim render [--fps <n>] [--width <px>] [--out <dir>]
 *   anim clip <clip-id> [--format webm|prores|png|mp4]
 *   anim preview [--port <n>] [--no-open]
 *   anim mcp                                    stdio MCP server for coding agents
 *   anim login | logout | credits               AnimSpark Cloud account (media commands)
 *   anim audio|image|font|web <verb> …          media, run on a provider (src/cloud)
 *
 * Films are checked, looked at and rendered on your machine: Node, Chromium (via Playwright)
 * and ffmpeg, no account. Only the media commands need a provider.
 */
import { FilmCliError } from '@animspark/film-build';
import { findCliWorkspace } from './cli-workspace';
import { parseArgv } from './argv';

const USAGE = `anim — describe a film, let your coding agent write it, render it here.

  anim new "<what the film should be>" [--dir <dir>] [--aspect 16:9] [--sec 30]
  anim preview [--port <n>] [--no-open]   play it in the browser; follows every save
  anim check [--timeline]     validate film.json and compile the scenes
  anim look [--from <s> --to <s>] [--fps <n>]   contact sheet (PNG)
  anim look --at <s>          one frame at native resolution
  anim look --sound           draw the mix
  anim render [--fps <n>] [--width <px>] [--out <dir>]   mp4 into .anim-out/
  anim clip <clip-id> [--format webm|prores|png|mp4]      one block, transparent
  anim mcp                    serve these commands to a coding agent over MCP (stdio)

Media — voices, speech, sound, music, transcription, images, fonts.
Runs on AnimSpark Cloud (anim login) or a provider with your own key (--provider):
  anim audio voice|tts|sfx|music|asr …    anim image search|gen …
  anim font search …
  anim login | anim logout                connect / forget your AnimSpark Cloud key
  anim credits                            balance, plan and prices (from the server)

Run any command with --help for its full contract. anim --version prints the version.`;

async function main(args: string[]): Promise<string> {
  const [group, ...rest] = args;
  if (!group || group === '--help' || group === '-h') return USAGE;
  if (group === '--version' || group === '-v' || group === 'version') {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { ENGINE_ROOT } = await import('../package-root');
    const pkg = JSON.parse(readFileSync(join(ENGINE_ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
    return `${pkg.name} ${pkg.version} (node ${process.version}, ${process.platform}-${process.arch})`;
  }
  if (group === 'new') { const { cmdNew } = await import('./new-cmd'); return cmdNew(parseArgv(rest)); }
  if (group === 'login') { const { cmdLogin } = await import('../cloud/cli'); return cmdLogin(rest); }
  if (group === 'logout') { const { cmdLogout } = await import('../cloud/cli'); return cmdLogout(rest); }
  if (group === 'credits') { const { cmdCredits } = await import('../cloud/cli'); return cmdCredits(rest); }
  if (group === 'mcp') {
    if (rest.includes('--help') || rest.includes('-h')) { const { MCP_USAGE } = await import('../mcp/server'); return MCP_USAGE; }
    const { serveMcpStdio } = await import('../mcp/server'); await serveMcpStdio(); return '';
  }
  const { isCloudGroup } = await import('../cloud/commands');
  if (isCloudGroup(group)) { const { runCloudCli } = await import('../cloud/cli'); return runCloudCli(group, rest); }
  if (group === 'preview') {
    if (rest.includes('--help') || rest.includes('-h')) return 'anim preview [--port <n>] [--host <addr>] [--no-open]\n\nServes the film in this workspace at a local URL. Picture, sound and timeline follow\nevery save; compile and runtime errors show on the page. Ctrl-C to stop.';
    const argv = parseArgv(rest);
    const ws = findCliWorkspace();
    const { syncAssetIndex } = await import('./asset-sync');
    await syncAssetIndex(ws).catch(() => undefined);
    const { startPreview } = await import('./oss-preview');
    const port = argv.flags.get('port');
    const server = await startPreview(ws, { port: typeof port === 'string' ? Number(port) : 4173, host: typeof argv.flags.get('host') === 'string' ? argv.flags.get('host') as string : undefined });
    process.stdout.write(`anim preview  ${server.url}\n  watching ${ws}\n  Ctrl-C to stop\n`);
    if (!argv.flags.has('no-open') && process.stdout.isTTY) {
      const { spawn } = await import('node:child_process');
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', server.url] : [server.url];
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
    }
    await new Promise<void>((done) => { process.once('SIGINT', done); process.once('SIGTERM', done); });
    await server.close();
    return '';
  }
  if (['check', 'look', 'render', 'clip', 'film', 'hear'].includes(group)) {
    const helpish = rest.includes('--help') || rest.includes('-h');
    const ws = helpish ? '' : findCliWorkspace();
    if (!helpish) { try { const { syncAssetIndex } = await import('./asset-sync'); await syncAssetIndex(ws); } catch (e) { process.stderr.write(`[anim] asset index: ${e instanceof Error ? e.message : String(e)}\n`); } }
    const { runCodeCli } = await import('./oss-cli');
    try { return await runCodeCli(ws, group, rest); }
    catch (error) { const what = error instanceof Error ? error.message : String(error);
      if ((group === 'check' || group === 'look') && !what.trimStart().startsWith('{')) throw new FilmCliError(`${JSON.stringify({ status: 'Fail', errors: [what] }, null, 2)}\n`);
      throw error; }
  }
  throw new FilmCliError(`anim ${group} is not a command.\n\n${USAGE}`);
}

main(process.argv.slice(2)).then((out) => { if (out) process.stdout.write(`${out}\n`); }).catch((error: unknown) => {
  const what = error instanceof Error ? error.message : String(error);
  (what.trimStart().startsWith('{') ? process.stdout : process.stderr).write(`${what}\n`); process.exit(1);
});
