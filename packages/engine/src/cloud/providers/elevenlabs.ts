/**
 * Reference bring-your-own-key adapter: ElevenLabs for voices, speech and sound effects.
 *
 *   export ELEVENLABS_API_KEY=…
 *   export ANIMSPARK_PROVIDER=elevenlabs            # or --provider elevenlabs per call
 *   anim audio voice --prompt "calm narrator"        # → voiceId
 *   anim audio tts --text "Hello there" --voice <voiceId> --out intro
 *   anim audio sfx --prompt "a short glass chime" --sec 1 --out ding
 *
 * APIs (all authenticate with the `xi-api-key` header):
 *   audio voice  GET  https://api.elevenlabs.io/v2/voices?search=&page_size=
 *                https://elevenlabs.io/docs/api-reference/voices/search
 *   audio tts    POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
 *                { text, model_id } → audio bytes
 *                https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 *   audio sfx    POST https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128
 *                { text, duration_seconds (0.5–30), model_id } → audio bytes
 *                https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
 *
 * Environment: ELEVENLABS_API_KEY (required); ELEVENLABS_TTS_MODEL (default
 * eleven_multilingual_v2); ELEVENLABS_VOICE_ID (default voice for tts; else "George",
 * JBFqnCBsd6RMkjVDRZzb, from the ElevenLabs quickstart); ELEVENLABS_BASE_URL (default
 * https://api.elevenlabs.io).
 *
 * Speech from this adapter has no word timings (the plain endpoint does not return them),
 * so `cue(vo, 'phrase')` cannot anchor to it. Upgrading to the `/with-timestamps` variant
 * and returning `words` rows in `index` is a good first contribution.
 */
import type { CloudCommandName, MediaArgs } from '../commands';
import { checkApiUrl } from '../credentials';
import { errorMessage, fetchWithTimeout, ProviderHttpError, type MediaContext, type MediaProvider, type MediaResult } from '../provider';

const SUPPORTED: readonly CloudCommandName[] = ['audio voice', 'audio tts', 'audio sfx'];
const OUTPUT_FORMAT = 'mp3_44100_128';

type Env = Record<string, string | undefined>;

function setup(ctx: MediaContext): { key: string; base: string; env: Env } {
  const env = ctx.env ?? process.env;
  const key = env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set.');
  return { key, base: checkApiUrl(env.ELEVENLABS_BASE_URL?.trim() || 'https://api.elevenlabs.io'), env };
}

async function call(ctx: MediaContext, url: string, init: RequestInit, what: string): Promise<Response> {
  const res = await fetchWithTimeout(url, init, { timeoutMs: 180_000, signal: ctx.signal, fetch: ctx.fetch });
  if (!res.ok) {
    const { message, body } = await errorMessage(res);
    throw new ProviderHttpError(`ElevenLabs ${what} failed (HTTP ${res.status}): ${message}`, res.status, body);
  }
  return res;
}

async function audio(res: Response): Promise<Buffer> {
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error('ElevenLabs returned an empty audio file.');
  return bytes;
}

interface ElevenVoice {
  voice_id: string;
  name?: string;
  description?: string | null;
  labels?: Record<string, string | undefined>;
  preview_url?: string | null;
}

export const elevenlabs: MediaProvider = {
  id: 'elevenlabs',
  label: 'ElevenLabs (your key)',
  setup: 'set ELEVENLABS_API_KEY',
  configured: (env) => !!env.ELEVENLABS_API_KEY?.trim(),
  supports: (command) => SUPPORTED.includes(command),
  defaults: (command, env): MediaArgs => (command === 'audio tts' ? { voice: env.ELEVENLABS_VOICE_ID?.trim() || 'JBFqnCBsd6RMkjVDRZzb' } : {}),

  async run(req, ctx): Promise<MediaResult> {
    const { key, base, env } = setup(ctx);
    const headers = { 'xi-api-key': key, 'content-type': 'application/json' };

    if (req.command === 'audio voice') {
      const limit = Number(req.args.limit ?? 5);
      const q = new URLSearchParams({ page_size: String(Math.min(100, limit * 3)) });
      if (req.args.prompt) q.set('search', String(req.args.prompt));
      const res = await call(ctx, `${base}/v2/voices?${q}`, { headers: { 'xi-api-key': key } }, 'voice search');
      const body = (await res.json()) as { voices?: ElevenVoice[] };
      const gender = req.args.gender === 'm' ? 'male' : req.args.gender === 'f' ? 'female' : null;
      const language = req.args.language ? String(req.args.language).toLowerCase() : null;
      const voices = (body.voices ?? [])
        .filter((v) => !gender || !v.labels?.gender || v.labels.gender.toLowerCase() === gender)
        .filter((v) => !language || !v.labels?.language || v.labels.language.toLowerCase().startsWith(language))
        .slice(0, limit)
        .map((v) => ({
          voiceId: v.voice_id,
          name: v.name ?? v.voice_id,
          ...(v.labels?.language ? { language: v.labels.language } : {}),
          ...(v.labels?.gender ? { gender: v.labels.gender.toLowerCase().startsWith('f') ? 'f' : 'm' } : {}),
          ...(v.description || v.labels?.description ? { description: v.description ?? v.labels?.description } : {}),
          ...(v.preview_url ? { preview: v.preview_url } : {}),
        }));
      return { files: [], receipt: voices };
    }

    if (req.command === 'audio tts') {
      const text = String(req.args.text ?? '');
      const voice = String(req.args.voice);
      const model = env.ELEVENLABS_TTS_MODEL?.trim() || 'eleven_multilingual_v2';
      const res = await call(ctx, `${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${OUTPUT_FORMAT}`, {
        method: 'POST', headers, body: JSON.stringify({ text, model_id: model }),
      }, 'speech');
      const src = `assets/audio/vo/${String(req.args.out)}.mp3`;
      return {
        files: [{ path: src, bytes: await audio(res) }],
        index: [{ src, kind: 'audio', text, from: { mode: 'tts', provider: 'elevenlabs', model } }],
        receipt: { src, voiceId: voice, provider: 'elevenlabs', model, alignment: 'none' },
        note: 'No word timings from this provider: cue(vo, …) cannot anchor to this line. Time it by hand or run anim audio asr on it.',
      };
    }

    if (req.command === 'audio sfx') {
      const prompt = String(req.args.prompt ?? '');
      const sec = req.args.sec === undefined ? undefined : Number(req.args.sec);
      const res = await call(ctx, `${base}/v1/sound-generation?output_format=${OUTPUT_FORMAT}`, {
        method: 'POST', headers,
        body: JSON.stringify({ text: prompt, model_id: 'eleven_text_to_sound_v2', ...(sec !== undefined ? { duration_seconds: sec } : {}) }),
      }, 'sound generation');
      const src = `assets/audio/sfx/${String(req.args.out)}.mp3`;
      return {
        files: [{ path: src, bytes: await audio(res) }],
        index: [{ src, kind: 'audio', from: { mode: 'gen', provider: 'elevenlabs', prompt, ...(sec !== undefined ? { sec } : {}) } }],
        receipt: { src, provider: 'elevenlabs' },
      };
    }

    throw new Error(`ElevenLabs adapter cannot run ${req.command}.`);
  },
};

export default elevenlabs;
