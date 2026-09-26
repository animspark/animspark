/**
 * Seekable static file responses (HTTP Range).
 *
 * Why every local static server must support Range: the player uses the soundtrack (audio.m4a) as
 * its master clock, and <video> assets in the picture need frame-accurate seeks. When a media
 * element seeks to an unbuffered position it fetches the bytes at that offset via Range. If the
 * server ignores the Range header and always answers 200 with the whole file (especially chunked,
 * with no Content-Length at all), the browser decides the resource isn't seekable: it can only
 * read from 0, and a far seek drops readyState back to 1, resets currentTime to 0, and leaves
 * seeking stuck at true forever. The symptom: "drag the scrubber → picture freezes, the scrubber
 * doesn't move, and play does nothing".
 *
 * Object storage and CDNs support Range natively, so this failure only shows up on local servers.
 */
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';

/** Parse a single `Range: bytes=a-b` (also accepts `a-` and suffix form `-n`).
 *  null = send the whole file (no Range header / unknown unit); 'invalid' = 416. */
export function parseByteRange(
  header: string | string[] | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if (!m) return null; // multi-range or non-bytes unit: send the whole file and let the browser cope
  const startRaw = m[1] ?? '';
  const endRaw = m[2] ?? '';
  if (startRaw === '' && endRaw === '') return null;
  if (size === 0) return 'invalid';
  let start: number;
  let end: number;
  if (startRaw === '') {
    const n = Number(endRaw);
    if (!Number.isFinite(n) || n <= 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
    if (start >= size) return 'invalid';
    end = Math.min(end, size - 1);
  }
  if (start > end) return 'invalid';
  return { start, end };
}

/** MIME type for static assets.
 *  ⚠️ audio.m4a is the film's soundtrack and the player's master clock. Served as octet-stream,
 *  the browser takes the "unknown binary" path and barely parses metadata, let alone seeks. */
export function staticContentType(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': case '.map': return 'application/json';
    case '.txt': return 'text/plain; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.avif': return 'image/avif';
    case '.heic': return 'image/heic';
    case '.heif': return 'image/heif';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    /* iframe previews depend on this: octet-stream makes the browser download instead of open. */
    case '.pdf': return 'application/pdf';
    case '.woff2': return 'font/woff2';
    case '.woff': return 'font/woff';
    case '.ttf': return 'font/ttf';
    case '.otf': return 'font/otf';
    case '.wav': return 'audio/wav';
    case '.mp3': return 'audio/mpeg';
    case '.m4a': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    case '.opus': return 'audio/opus';
    case '.oga': case '.ogg': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    case '.mp4': case '.m4v': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mov': return 'video/quicktime';
    default: return 'application/octet-stream';
  }
}

/**
 * Merge headers, **lowercasing every key**.
 *
 * HTTP header names are case-insensitive, but `writeHead` takes a plain object where
 * `Content-Type` and `content-type` are two different keys, so both get sent and the browser sees
 * `content-type: video/mp4, video/mp4`. Some parsers accept that and some don't, and the way it
 * breaks ("this video won't play in some browsers") is a long way from here to debug.
 *
 * With keys lowercased, a same-named header from the caller **overrides** instead of duplicating.
 */
function headersOf(...parts: Record<string, string>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) out[key.toLowerCase()] = value;
  }
  return out;
}

/**
 * Send a file that has already passed sandbox checks, with Range / HEAD support.
 * The caller is responsible for path normalization and escape checks (this takes a resolved
 * absolute path). Missing / not a regular file → returns false; the caller decides how to 404.
 */
export function sendFileWithRange(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  extraHeaders: Record<string, string> = {},
): boolean {
  let size: number;
  let etag: string;
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    size = st.size;
    /* Weak validator: size + mtime, from one stat without reading content. Paths don't change
       with content (re-recorded narration is still 01.m4a), so clients use this to recognize "same
       bytes as last time"; the multitrack player reuses decoded samples instead of re-decoding the
       whole film's audio on every rebuild. */
    etag = `W/"${size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  } catch {
    return false;
  }

  const base = headersOf(
    { 'content-type': staticContentType(file), 'accept-ranges': 'bytes', etag },
    extraHeaders,
  );

  /* Same bytes: answer 304 instead of resending the whole file (or range). Every <video> remount
     (entering/leaving the preload window, the capture page switching clips) re-requests the
     headers and first few ranges. */
  const inm = req.headers['if-none-match'];
  if (typeof inm === 'string' && inm.split(',').some((v) => v.trim() === etag)) {
    res.writeHead(304, headersOf(base)).end();
    return true;
  }

  const range = parseByteRange(req.headers.range, size);
  if (range === 'invalid') {
    res.writeHead(416, headersOf(base, { 'content-range': `bytes */${size}` })).end();
    return true;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, size - 1);
  res.writeHead(range ? 206 : 200, headersOf(
    base,
    { 'content-length': String(size === 0 ? 0 : end - start + 1) },
    range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {},
  ));
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return true;
  }
  // Stream it: soundtracks and video assets are often several MB, and media elements send a new
  // request per seek and abort the previous one at any time; readFileSync would load the whole
  // file into memory and waste the read when aborted.
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => { res.destroy(); });
  res.on('close', () => { stream.destroy(); });
  stream.pipe(res);
  return true;
}

/**
 * Same as above, but the bytes are already in memory (outputs fetched back from a storage bucket
 * have no local file to stream).
 *
 * The caller supplies Content-Type: the key may not carry an extension, and the soundtrack
 * strictly requires this header.
 */
export function sendBufferWithRange(
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer,
  extraHeaders: Record<string, string> = {},
): void {
  const size = body.byteLength;
  const base = headersOf({ 'accept-ranges': 'bytes' }, extraHeaders);

  const range = parseByteRange(req.headers.range, size);
  if (range === 'invalid') {
    res.writeHead(416, headersOf(base, { 'content-range': `bytes */${size}` })).end();
    return;
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, size - 1);
  res.writeHead(range ? 206 : 200, headersOf(
    base,
    { 'content-length': String(size === 0 ? 0 : end - start + 1) },
    range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {},
  ));
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  res.end(range ? body.subarray(start, end + 1) : body);
}
