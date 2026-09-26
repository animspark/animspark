/**
 * Argument parsing for the film CLI.
 *
 * A separate module so `cli.ts` and every command can use it without importing each other:
 * commands are dynamically imported by `cli.ts`, and importing back would form a cycle.
 */

import { FilmCliError } from '@animspark/film-build';

export interface Argv {
  positional: string[];
  flags: Map<string, string | true>;
  /** All values of a flag given more than once, in order. `flags` keeps the last one. */
  repeated: Map<string, string[]>;
}

export function parseArgv(args: string[]): Argv {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const repeated = new Map<string, string[]>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = args[i + 1];
    if (next != null && !next.startsWith('--')) {
      flags.set(name, next);
      const seen = repeated.get(name);
      if (seen) seen.push(next);
      else repeated.set(name, [next]);
      i += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags, repeated };
}

export function numFlag(argv: Argv, name: string): number | undefined {
  const raw = argv.flags.get(name);
  if (typeof raw !== 'string') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new FilmCliError(`--${name} wants a number, got ${raw}`);
  return value;
}

export function strFlag(argv: Argv, name: string): string | undefined {
  const raw = argv.flags.get(name);
  return typeof raw === 'string' ? raw : undefined;
}

/** One entry per occurrence, in order. Empty array if the flag wasn't given. */
export function strFlags(argv: Argv, name: string): string[] {
  return argv.repeated.get(name) ?? [];
}
