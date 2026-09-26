export interface ShellCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Keep command output as text, including its real newlines and literal escapes. */
export function formatShellResult(result: ShellCommandResult): string {
  let text = result.exitCode === 0 ? '' : `[shell exited with code ${result.exitCode}]\n`;
  text += result.stdout;
  if (result.stderr) {
    if (text && !text.endsWith('\n')) text += '\n';
    text += `[stderr]\n${result.stderr}`;
  }
  return text;
}

/** Old receipts used exactly this envelope. Decode only that one outer layer. */
export function parseLegacyShellResult(text: string): ShellCommandResult | undefined {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === 3 && Number.isInteger(value.exitCode)
      && typeof value.stdout === 'string' && typeof value.stderr === 'string') return value;
  } catch { /* Current receipts and ordinary command output are already text. */ }
  return undefined;
}

export function displayShellOutput(text: string): string {
  const legacy = parseLegacyShellResult(text);
  return legacy ? formatShellResult(legacy) : text;
}

export function shellOutputFailed(text: string): boolean {
  const legacy = parseLegacyShellResult(text);
  return legacy ? legacy.exitCode !== 0 : /^\[shell exited with code -?[1-9]\d*\]/.test(text);
}

/** The transport stores tool arguments as JSON; the UI shows the Bash source. */
export function shellInputPreview(input: unknown): { command: string; options: string } | undefined {
  try {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    if (!value || typeof value !== 'object' || typeof value.command !== 'string') return undefined;
    const options = [
      typeof value.workdir === 'string' ? `workdir: ${value.workdir}` : '',
      typeof value.timeoutSec === 'number' ? `timeout: ${value.timeoutSec}s` : '',
    ].filter(Boolean).join(' · ');
    return { command: value.command, options };
  } catch { return undefined; }
}
