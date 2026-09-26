/**
 * Locating, downloading and loading the GM sound bank.
 *
 * The 32MB sf2 is not checked in: it is downloaded to a cache directory on first use and reused
 * after that. Downloading and loading are separate: downloading is a one-off async provisioning
 * step, loading is synchronous (on the order of 28ms), so the render path only loads and never
 * blocks on the network.
 */
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { SoundBankLoader, type BasicSoundBank } from 'spessasynth_core';

/**
 * GeneralUser GS v2: the author, S. Christian Collins, explicitly permits commercial music
 * creation and monetization. He asks that the download on his personal site not be hotlinked, so
 * this uses his own GitHub repository; to self-host, set MUSPARK_SOUNDFONT_URL to your mirror.
 */
export const DEFAULT_SOUNDFONT = {
  name: 'GeneralUser-GS.sf2',
  url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/684543d5e5efaef08d02be50dcda8d552478fa60/GeneralUser-GS.sf2',
  /** Bounds for spotting corrupt or truncated downloads; not exact values. */
  minBytes: 20 * 1024 * 1024,
  maxBytes: 64 * 1024 * 1024,
} as const;

function defaultCacheDir(): string {
  const home = homedir();
  if (platform() === 'darwin') return join(home, 'Library', 'Caches', 'muspark');
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'muspark');
  return join(process.env.XDG_CACHE_HOME || join(home, '.cache'), 'muspark');
}

/**
 * Where the sound bank should live.
 *
 * Precedence: explicit argument > MUSPARK_SOUNDFONT (full file path)
 * > MUSPARK_SOUNDFONT_DIR/<name> > platform cache directory/<name>.
 * Host projects (such as animspark) use MUSPARK_SOUNDFONT_DIR to fold it into their own cache tree.
 */
export function soundfontPath(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const file = process.env.MUSPARK_SOUNDFONT?.trim();
  if (file) return file;
  const dir = process.env.MUSPARK_SOUNDFONT_DIR?.trim() || defaultCacheDir();
  return join(dir, DEFAULT_SOUNDFONT.name);
}

/** sf2 is a RIFF container whose header looks like "RIFF....sfbk"; this rules out downloaded error pages. */
function looksLikeSoundFont(path: string): boolean {
  try {
    const size = statSync(path).size;
    if (size < DEFAULT_SOUNDFONT.minBytes || size > DEFAULT_SOUNDFONT.maxBytes) return false;
    const head = Buffer.alloc(12);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, head, 0, 12, 0);
    } finally {
      closeSync(fd);
    }
    return head.subarray(0, 4).toString('ascii') === 'RIFF'
      && head.subarray(8, 12).toString('ascii') === 'sfbk';
  } catch {
    return false;
  }
}

/** Whether the sound bank is in place and can be loaded synchronously. */
export function soundfontReady(explicit?: string): boolean {
  const path = soundfontPath(explicit);
  return existsSync(path) && looksLikeSoundFont(path);
}

export interface EnsureSoundFontOptions {
  /** Target path; defaults to soundfontPath()'s lookup order. */
  path?: string;
  /** Download URL; defaults to MUSPARK_SOUNDFONT_URL, then GeneralUser GS. */
  url?: string;
  /** Download again even if the file already exists. */
  force?: boolean;
  onProgress?: (info: { receivedBytes: number; totalBytes: number | null }) => void;
}

/**
 * Make sure the sound bank is in place and return its path. If it exists and passes the check,
 * returns right away with no network request.
 *
 * Writes go through a temp file plus rename so concurrent renders never read a half-written file.
 */
export async function ensureSoundFont(options: EnsureSoundFontOptions = {}): Promise<string> {
  const path = soundfontPath(options.path);
  if (!options.force && existsSync(path)) {
    if (looksLikeSoundFont(path)) return path;
    // The previous download is incomplete: delete it and start over
    unlinkSync(path);
  }

  const url = options.url?.trim() || process.env.MUSPARK_SOUNDFONT_URL?.trim() || DEFAULT_SOUNDFONT.url;
  mkdirSync(dirname(path), { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download the GM sound bank: HTTP ${response.status} ${url}`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || null;
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Failed to download the GM sound bank: the response has no body');
  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.byteLength;
    if (receivedBytes > DEFAULT_SOUNDFONT.maxBytes) {
      throw new Error(`Failed to download the GM sound bank: exceeded the ${DEFAULT_SOUNDFONT.maxBytes}-byte limit`);
    }
    options.onProgress?.({ receivedBytes, totalBytes });
  }

  const buffer = Buffer.concat(chunks);
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buffer.subarray(8, 12).toString('ascii') !== 'sfbk') {
    throw new Error(`The download is not a SoundFont (RIFF/sfbk magic does not match); check whether ${url} returned an error page`);
  }
  if (buffer.byteLength < DEFAULT_SOUNDFONT.minBytes) {
    throw new Error(`The downloaded sound bank is only ${buffer.byteLength} bytes and looks truncated`);
  }

  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, buffer);
  renameSync(tmp, path);
  return path;
}

/** sha256 of the sound bank file, for tracking down "the sound changed because the bank changed". */
export function soundfontDigest(explicit?: string): string {
  return createHash('sha256').update(readFileSync(soundfontPath(explicit))).digest('hex');
}

let cachedBank: BasicSoundBank | null = null;
let cachedDigest = '';

/**
 * Load the sound bank synchronously, cached in-process.
 *
 * The cache is keyed by the SHA-256 of the actual bytes, so updating the file at the same path
 * triggers a re-parse; otherwise the host's asset cache could be updated while the synth keeps
 * using the old bank.
 */
export function loadSoundBank(explicit?: string): BasicSoundBank {
  const path = soundfontPath(explicit);
  if (!existsSync(path)) {
    throw new Error(
      `GM sound bank not found: ${path}\n`
      + 'Sampled instruments need it downloaded first. Either:\n'
      + '  1) await ensureSoundFont() before rendering (about 32MB the first time)\n'
      + '  2) or set MUSPARK_SOUNDFONT to an existing sf2 file',
    );
  }
  const file = readFileSync(path);
  const digest = createHash('sha256').update(file).digest('hex');
  if (cachedBank && cachedDigest === digest) return cachedBank;
  cachedBank = SoundBankLoader.fromArrayBuffer(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
  cachedDigest = digest;
  return cachedBank;
}

/**
 * Load the sound bank only when needed.
 *
 * An oscillator-only score should not pay 32MB of memory and a disk read for a sampled bank it
 * never uses, so the Node entry points check for sampled voices before deciding whether to parse.
 */
export function loadSoundBankIf(needed: boolean, explicit?: string): BasicSoundBank | undefined {
  return needed ? loadSoundBank(explicit) : undefined;
}
