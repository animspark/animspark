/**
 * Reference bring-your-own-key adapter: `anim audio tts` on OpenAI's speech endpoint.
 *
 *   export OPENAI_API_KEY=sk-…
 *   anim audio tts --provider openai --text "Hello there" [--voice coral] [--out intro]
 *
 * API: POST https://api.openai.com/v1/audio/speech
 *      { model, input, voice, response_format } → audio bytes
 * Docs: https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
 *       (also https://platform.openai.com/docs/api-reference/audio/createSpeech)
 *       (models tts-1, tts-1-hd, gpt-4o-mini-tts; voices alloy, ash, ballad, coral, echo,
 *        sage, shimmer, verse, marin, cedar; input up to 4096 characters)
 *
 * Environment: OPENAI_API_KEY (required), OPENAI_TTS_MODEL (default gpt-4o-mini-tts),
 * OPENAI_BASE_URL (default https://api.openai.com/v1 — point it at a compatible server).
 *
 * The speech comes back without word timings, so `cue(vo, 'phrase')` cannot anchor to it;
 * time the animation by hand, or transcribe the file with `anim audio asr`.
 *
 * To write your own adapter, copy this file: implement `supports` and `run`, return the
 * files as `{ path: 'assets/…', bytes }`, and the engine lands and indexes them.
 */
import { checkApiUrl } from '../credentials';
import { errorMessage, fetchWithTimeout, ProviderHttpError, type MediaProvider } from '../provider';

const MAX_INPUT = 4096;

export const openaiTts: MediaProvider = {
  id: 'openai',
  label: 'OpenAI (your key)',
  setup: 'set OPENAI_API_KEY',
  configured: (env) => !!env.OPENAI_API_KEY?.trim(),
  supports: (command) => command === 'audio tts',
  defaults: () => ({ voice: 'alloy' }),

  async run(req, ctx) {
    const env = ctx.env ?? process.env;
    const key = env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('OPENAI_API_KEY is not set.');
    const text = String(req.args.text ?? '');
    if (text.length > MAX_INPUT) throw new Error(`OpenAI speech takes at most ${MAX_INPUT} characters; this text has ${text.length}. Split it into several lines.`);
    const model = env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
    const voice = String(req.args.voice ?? 'alloy');
    const base = checkApiUrl(env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1');

    const res = await fetchWithTimeout(`${base}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
    }, { timeoutMs: 120_000, signal: ctx.signal, fetch: ctx.fetch });
    if (!res.ok) {
      const { message, body } = await errorMessage(res);
      throw new ProviderHttpError(`OpenAI speech failed (HTTP ${res.status}): ${message}`, res.status, body);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error('OpenAI returned an empty audio file.');

    const src = `assets/audio/vo/${String(req.args.out)}.mp3`;
    return {
      files: [{ path: src, bytes }],
      index: [{ src, kind: 'audio', text, from: { mode: 'tts', provider: 'openai', model } }],
      receipt: { src, voice, provider: 'openai', model, alignment: 'none' },
      note: 'No word timings from this provider: cue(vo, …) cannot anchor to this line. Time it by hand or run anim audio asr on it.',
    };
  },
};

export default openaiTts;
