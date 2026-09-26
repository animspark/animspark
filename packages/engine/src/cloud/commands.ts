/**
 * The media commands: voices, speech, sound effects, music, transcription, images and fonts.
 * None of them run on this machine — each is handed to a media provider
 * (AnimSpark Cloud by default, or a bring-your-own-key adapter; see provider.ts).
 *
 * One table drives everything: argument parsing and validation for the CLI, `--help`,
 * and the MCP tool input schemas. The option names are the wire contract of
 * `POST /v1/anim/run` (`args` is exactly `{ <option>: value }`), so do not rename them.
 */
import { FilmCliError } from '@animspark/film-build';

export type ArgValue = string | number | boolean | string[];
export type MediaArgs = Record<string, ArgValue>;

export interface CommandOption {
  /** Placeholder shown in help (`--text <text>`). Omitted = boolean flag. */
  value?: string;
  required?: boolean;
  /** May be given more than once; sent as a string[]. */
  repeat?: boolean;
  maxOccurrences?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  choices?: readonly string[];
  defaultValue?: string | number;
  doc: string;
  /** Accepted synonyms, not shown in help. */
  aliases?: readonly string[];
}

export const CLOUD_COMMAND_NAMES = [
  'audio voice', 'audio tts', 'audio sfx', 'audio music', 'audio asr',
  'image search', 'image gen', 'font search',
] as const;
export type CloudCommandName = (typeof CLOUD_COMMAND_NAMES)[number];

export interface CloudCommand {
  name: CloudCommandName;
  short: string;
  description: string;
  options: Record<string, CommandOption>;
  /** Where the produced files land (informational; the provider decides the exact path). */
  outputDir?: string;
  /** Takes `--out <name>`; when omitted the CLI derives a name from the text/prompt. */
  outputName?: boolean;
  /** Options that name a workspace file which must be uploaded with the request. */
  inputs?: readonly string[];
  example: string;
  timeoutSec: number;
}

const out: CommandOption = {
  value: 'name',
  doc: 'Output name without directory or extension; an existing file with that name is replaced. Default: derived from the text or prompt.',
};
const prompt: CommandOption = { value: 'text', required: true, doc: 'What you want, described in English.' };

export const CLOUD_COMMANDS: readonly CloudCommand[] = [
  {
    name: 'audio voice', short: 'Search voices and return voice IDs.', timeoutSec: 60,
    options: {
      language: { value: 'code', doc: 'Language code such as en, zh, ja. Default: from the prompt or the project language.' },
      gender: { value: 'gender', choices: ['m', 'f'], doc: 'Filter by gender: m or f. Default: any.' },
      prompt: { value: 'text', doc: 'Describe the voice ("calm narrator", "energetic young host").' },
      limit: { value: 'N', min: 1, max: 100, integer: true, defaultValue: 5, doc: 'How many candidates, 1–100.', aliases: ['n'] },
    },
    description: 'Search voices; returns voiceId, name, language, gender and description for each candidate. Pass a voiceId to `audio tts --voice`. Candidates are also recorded in assets/index.jsonl as kind:"voice" rows.',
    example: 'anim audio voice --language en --gender f --prompt "warm documentary narrator"',
  },
  {
    name: 'audio tts', short: 'Synthesize one narration line into assets/audio/vo/.', outputDir: 'assets/audio/vo', outputName: true, timeoutSec: 300,
    options: {
      out,
      text: { value: 'text', required: true, doc: 'The words to speak.' },
      voice: { value: 'voiceId', required: true, doc: 'A voice ID from `anim audio voice`.' },
    },
    description: "Synthesize speech; returns src, dur (seconds), alignment status and the transcript path. alignment:ready means word timings are stored with the asset: synchronize MG animation with cue(sound, 'phrase') from @animspark/runtime, and never run ASR on synthesized speech.",
    example: 'anim audio tts --out intro --text "Hello there" --voice v-xx',
  },
  {
    name: 'audio sfx', short: 'Get a sound effect into assets/audio/sfx/.', outputDir: 'assets/audio/sfx', outputName: true, timeoutSec: 300,
    options: { out, prompt, sec: { value: 'seconds', min: 0.5, max: 22, doc: 'Requested length, 0.5–22 s; the returned measured dur is what counts.' } },
    description: 'Get a sound effect into assets/audio/sfx/; returns src, measured dur and, when available, attack (seconds to the transient) and peakDb.',
    example: 'anim audio sfx --out ding --prompt "a short glass chime" --sec 1',
  },
  {
    name: 'audio music', short: 'Get a music bed into assets/audio/music/.', outputDir: 'assets/audio/music', outputName: true, timeoutSec: 300,
    options: { out, prompt, sec: { value: 'seconds', min: 3, max: 300, doc: 'Requested length, 3–300 s; the returned measured dur is what counts.' } },
    description: 'Get music into assets/audio/music/; returns src and measured dur. (Music can also be written locally as a muspark score — no cloud needed.)',
    example: 'anim audio music --out bed --prompt "calm ambient pad" --sec 30',
  },
  {
    name: 'audio asr', short: 'Transcribe workspace audio/video into word timings.', inputs: ['src'], timeoutSec: 300,
    options: {
      src: { value: 'path', required: true, doc: 'Audio or video file inside this workspace (under assets/). It is uploaded for transcription.' },
      force: { doc: 'Transcribe again even when a transcript already exists.' },
    },
    description: 'Transcribe audio/video; returns a text preview, alignment status and the transcript path (a WebVTT under assets/transcripts/, cues separated at pauses — the gaps are safe cut points).',
    example: 'anim audio asr --src assets/upload/interview.m4a',
  },
  {
    name: 'image search', short: 'Find and download images into assets/image/.', outputDir: 'assets/image', outputName: true, timeoutSec: 300,
    options: { out, prompt, n: { value: 'N', min: 1, max: 8, integer: true, defaultValue: 1, doc: 'How many images, 1–8.', aliases: ['limit'] } },
    description: 'Search the web for images and download them into assets/image/; returns paths and dimensions.',
    example: 'anim image search --out hero --prompt "brass key on linen, top view" --n 2',
  },
  {
    name: 'image gen', short: 'Generate one image into assets/image/.', outputDir: 'assets/image', outputName: true, timeoutSec: 300,
    options: {
      out, prompt,
      ratio: { value: 'ratio', choices: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'], defaultValue: '3:2', doc: 'Aspect ratio.' },
      quality: { value: 'level', choices: ['low', 'high'], defaultValue: 'low', doc: 'Image quality.' },
      transparent: { doc: 'Generate with a transparent background.' },
    },
    description: 'Generate one image into assets/image/; returns its path and dimensions.',
    example: 'anim image gen --out hero --prompt "minimal line-art triangle" --ratio 16:9 --quality high',
  },
  {
    name: 'font search', short: 'Find a font family and install it under assets/fonts/.', outputDir: 'assets/fonts', timeoutSec: 120,
    options: { prompt: { value: 'text', required: true, doc: 'The look you want ("bold variety-show headline") or a family name.' } },
    description: 'Find a font family matching the description and install it under assets/fonts/; returns the family name to use in CSS.',
    example: 'anim font search --prompt "bold geometric headline"',
  },
];

export const CLOUD_GROUPS: Record<string, string> = {
  audio: 'Voices, speech, sound effects, music and transcription.',
  image: 'Search and generate images.',
  font: 'Find and install fonts.',
};

export const isCloudGroup = (group: string | undefined): boolean => !!group && Object.hasOwn(CLOUD_GROUPS, group);

export function findCloudCommand(name: string): CloudCommand | undefined {
  return CLOUD_COMMANDS.find((c) => c.name === name);
}

/** Flags every media command understands in addition to its own options. */
export const META_FLAGS: Record<string, CommandOption> = {
  provider: { value: 'id', doc: 'Run on this provider instead of the default (see `anim credits` / docs/cloud.md).' },
  tier: { value: 'tier', choices: ['flash', 'pro', 'ultra'], doc: 'AnimSpark Cloud model tier. Default: flash (or $ANIMSPARK_TIER).' },
  quote: { doc: 'Only print the price; run nothing and spend nothing.' },
};

export interface ParsedCommand {
  args: MediaArgs;
  provider?: string;
  tier?: string;
  quote: boolean;
  help: boolean;
}

function checkValue(name: string, option: CommandOption, raw: string): string | number {
  if (!raw.trim()) throw new FilmCliError(`--${name} cannot be empty.`);
  if (option.choices && !option.choices.includes(raw)) throw new FilmCliError(`--${name} must be ${option.choices.join(' | ')}.`);
  if (option.min !== undefined || option.max !== undefined || option.integer) {
    const n = Number(raw);
    if (!Number.isFinite(n) || (option.integer && !Number.isInteger(n))
      || (option.min !== undefined && n < option.min) || (option.max !== undefined && n > option.max)) {
      throw new FilmCliError(`--${name} needs ${option.integer ? 'an integer' : 'a number'}`
        + `${option.min !== undefined ? ` >= ${option.min}` : ''}${option.max !== undefined ? ` and <= ${option.max}` : ''}.`);
    }
    return n;
  }
  return raw;
}

function lookup(command: CloudCommand, name: string): [string, CommandOption] | undefined {
  const direct = command.options[name];
  if (direct) return [name, direct];
  return Object.entries(command.options).find(([, o]) => o.aliases?.includes(name));
}

/** argv after the command name (`['--text', 'hi', '--voice', 'v1']`) → named args. Required options are checked later (`requireArgs`). */
export function parseCommandArgv(command: CloudCommand, argv: readonly string[]): ParsedCommand {
  const args: MediaArgs = {};
  const parsed: ParsedCommand = { args, quote: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') { parsed.help = true; continue; }
    const match = /^--([^=]+)(?:=(.*))?$/s.exec(arg);
    if (!match) throw new FilmCliError(`anim ${command.name} takes named options only; unexpected ${JSON.stringify(arg)}. Run anim ${command.name} --help.`);
    const flag = match[1]!;
    const inline = match[2];
    const takeValue = (): string => {
      const value = inline ?? argv[i + 1];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new FilmCliError(`--${flag} needs a value. Run anim ${command.name} --help.`);
      if (inline === undefined) i += 1;
      return value;
    };
    if (flag === 'quote') { parsed.quote = true; continue; }
    if (flag === 'provider') { parsed.provider = takeValue(); continue; }
    if (flag === 'tier') { parsed.tier = String(checkValue('tier', META_FLAGS.tier!, takeValue())); continue; }
    const found = lookup(command, flag);
    if (!found) throw new FilmCliError(`Unknown option --${flag} for anim ${command.name}. Run anim ${command.name} --help.`);
    const [name, option] = found;
    if (!option.value) {
      if (inline !== undefined) throw new FilmCliError(`--${name} is a flag and takes no value.`);
      args[name] = true;
      continue;
    }
    const value = checkValue(name, option, takeValue());
    if (option.repeat) {
      const list = [...((args[name] as string[] | undefined) ?? []), String(value)];
      if (option.maxOccurrences !== undefined && list.length > option.maxOccurrences) throw new FilmCliError(`--${name} may appear at most ${option.maxOccurrences} times.`);
      args[name] = list;
    } else {
      if (name in args) throw new FilmCliError(`--${name} may appear only once.`);
      args[name] = value;
    }
  }
  return parsed;
}

/**
 * Named args from an untrusted object (MCP tool call) → validated MediaArgs. Unknown keys
 * are rejected so a typo does not silently drop an option.
 */
export function coerceArgs(command: CloudCommand, input: Record<string, unknown>): MediaArgs {
  const args: MediaArgs = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const found = lookup(command, key);
    if (!found) throw new FilmCliError(`Unknown option ${key} for ${command.name}.`);
    const [name, option] = found;
    if (!option.value) {
      if (typeof value !== 'boolean') throw new FilmCliError(`${name} must be true or false.`);
      if (value) args[name] = true;
      continue;
    }
    if (option.repeat) {
      const list = Array.isArray(value) ? value : [value];
      if (!list.length) continue;
      if (option.maxOccurrences !== undefined && list.length > option.maxOccurrences) throw new FilmCliError(`${name} takes at most ${option.maxOccurrences} values.`);
      args[name] = list.map((v) => String(checkValue(name, option, String(v))));
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw new FilmCliError(`${name} must be a ${option.min !== undefined || option.integer ? 'number' : 'string'}.`);
    args[name] = checkValue(name, option, String(value));
  }
  return args;
}

/** ASCII slug for a default `--out`. Non-Latin text falls back to a short stable hash. */
export function defaultOutName(command: CloudCommand, args: MediaArgs): string {
  const basis = String(args.text ?? args.prompt ?? command.name.split(' ')[1] ?? 'asset');
  const slug = basis.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-').slice(0, 40).replace(/-+$/, '');
  if (slug) return slug;
  let h = 0;
  for (const ch of basis) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `${command.name.split(' ')[1]}-${h.toString(36).slice(0, 6)}`;
}

const OUT_NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,120}$/u;

/** Fill provider defaults and `--out`, then insist on every required option. */
export function requireArgs(command: CloudCommand, args: MediaArgs, defaults: MediaArgs = {}): MediaArgs {
  const full: MediaArgs = { ...defaults, ...args };
  if (command.outputName) {
    if (full.out === undefined) full.out = defaultOutName(command, full);
    const name = String(full.out);
    if (!OUT_NAME.test(name) || /\.[a-z0-9]{2,4}$/i.test(name)) throw new FilmCliError('--out must be a simple name without a directory or extension.');
  }
  for (const [name, option] of Object.entries(command.options)) {
    if (option.required && full[name] === undefined) {
      throw new FilmCliError(`anim ${command.name} needs --${name}.\n\n${commandHelp(command)}`);
    }
  }
  return full;
}

export function commandHelp(command: CloudCommand, runsOn?: string): string {
  const rows = [...Object.entries(command.options), ...Object.entries(META_FLAGS)].map(([name, o]) => {
    const flag = `--${name}${o.value ? ` <${o.value}>` : ''}`;
    const extra = [
      o.required ? 'required' : '',
      o.choices ? `one of ${o.choices.join(' | ')}` : '',
      o.defaultValue !== undefined ? `default ${o.defaultValue}` : '',
      o.repeat ? 'repeatable' : '',
    ].filter(Boolean).join('; ');
    return `  ${flag.padEnd(24)} ${o.doc}${extra ? ` (${extra})` : ''}`;
  });
  return [
    `anim ${command.name} [options]`,
    '',
    `  ${command.description}`,
    '',
    'Options:',
    ...rows,
    '',
    `Example: ${command.example}`,
    ...(runsOn ? ['', runsOn] : []),
  ].join('\n');
}

export function groupHelp(group: string): string {
  const commands = CLOUD_COMMANDS.filter((c) => c.name.startsWith(`${group} `));
  return [
    `anim ${group} <command> [options] — ${CLOUD_GROUPS[group] ?? ''}`,
    '',
    ...commands.map((c) => `  ${c.name.slice(group.length + 1).padEnd(10)} ${c.short}`),
    '',
    `Run anim ${group} <command> --help for its options.`,
  ].join('\n');
}
