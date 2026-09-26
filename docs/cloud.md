# Media commands, AnimSpark Cloud and your own providers

Everything that makes a film — `anim check`, `look`, `render`, `clip`, `preview` — runs on your
machine with no account. Ten **media commands** fetch or generate material instead, and those
run on a *media provider*:

| Command | What it does | Lands in |
| --- | --- | --- |
| `anim audio voice` | Search voices; returns voice IDs | (receipt; voice rows in `assets/index.jsonl`) |
| `anim audio tts` | One line of narration, with word timings | `assets/audio/vo/` |
| `anim audio sfx` | A sound effect | `assets/audio/sfx/` |
| `anim audio music` | A music bed | `assets/audio/music/` |
| `anim audio asr` | Transcribe audio/video you have | `assets/transcripts/` |
| `anim image search` | Find and download images | `assets/image/` |
| `anim image gen` | Generate an image | `assets/image/` |
| `anim font search` | Find and install a font family | `assets/fonts/` |

`anim <command> --help` lists each command's options and says which provider it will run on.

You do not need any of them to finish a film: put your own files under `assets/` (uploads go in
`assets/upload/`) and reference them from `film.json` or `mg/`; `anim check` indexes them. Music
does not need a provider at all — write a muspark score (`assets/audio/music/<name>.ts`) and it
renders on your machine.

## AnimSpark Cloud

The default provider. You pay with AnimSpark credits; the price list, your balance and your
plan all come from the server.

```sh
anim login                  # paste an API key at the hidden prompt
anim credits                # balance, plan, tiers and prices as the server quotes them
anim audio tts --text "Hello there" --voice v-xx --out intro --quote   # price only
anim audio tts --text "Hello there" --voice v-xx --out intro
```

- **Keys.** Create an API key with the `videos:write` scope at <https://animspark.com>.
  `anim login` checks it against the API before saving it. Other ways in:
  `echo "$KEY" | anim login` (keeps it out of shell history) or `anim login --key <key>`.
- **Where it is kept.** `$XDG_CONFIG_HOME/animspark/credentials.json`
  (`~/.config/animspark/credentials.json` by default), mode 600, shaped
  `{ "apiKey": "…", "apiUrl"?: "…" }`. `anim logout` deletes the file; revoke the key itself
  on the website.
- **Environment.** `ANIMSPARK_API_KEY` overrides the saved key (CI, containers).
  `ANIMSPARK_API_URL` points at another API server (default `https://api.animspark.com/v1`).
  The key is only ever sent over https, or plain http to `localhost`/`127.0.0.1`.
- **Tiers.** `--tier flash|pro|ultra` (or `ANIMSPARK_TIER`) picks the model tier; `anim credits`
  shows which ones your plan includes. Default: flash.
- **What a call costs.** `--quote` asks the server for the upper bound and runs nothing. A run
  is charged the quote up front and settled to measured usage; the receipt reports
  `credits.cost` (what you paid), `credits.refunded` and your new `balance`. A failed call is
  refunded in full.
- **Retries are safe.** Each invocation carries one `Idempotency-Key`; network errors, timeouts
  and 5xx are retried with the same key, so the server charges a call at most once. A call that
  had already completed replays its receipt without the file bytes — the receipt says so; run
  it again with a new `--out` if you need the files.

### Errors you may see

| Message | Meaning |
| --- | --- |
| *did not accept … (HTTP 401)* | The key is wrong or revoked. Create a new one and `anim login`. |
| *refused … needs videos:write* (403) | The key lacks the `videos:write` scope. |
| *tier is not available on your plan* (403) | Use `--tier flash` or a plan that includes the tier. |
| *Not enough AnimSpark credits* (402) | Top up on the website; `anim credits` shows the balance. |
| *spend cap is used up* (402) | That key has a spending limit; raise it or use another key. |
| *rejected the request* (400) | An option the server did not accept; the message names it. |

## Bring your own key

Two reference adapters call a vendor directly with **your** key; the vendor bills you, no
AnimSpark account is involved:

| Provider | Commands | Environment |
| --- | --- | --- |
| `openai` | `audio tts` | `OPENAI_API_KEY`; optional `OPENAI_TTS_MODEL` (default `gpt-4o-mini-tts`), `OPENAI_BASE_URL` |
| `elevenlabs` | `audio voice`, `audio tts`, `audio sfx` | `ELEVENLABS_API_KEY`; optional `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_BASE_URL` |

A bring-your-own-key provider is **never picked just because its key is in your environment** —
you choose it. For each command the engine takes, in order:

1. `--provider <id>` on the command line (`provider` on the MCP tool);
2. `ANIMSPARK_PROVIDER_<COMMAND>`, e.g. `ANIMSPARK_PROVIDER_AUDIO_TTS=openai`;
3. `ANIMSPARK_PROVIDER` — one provider for every command it supports (others fall through);
4. AnimSpark Cloud, if you are logged in.

If none applies, the command tells you what would work.

```sh
export OPENAI_API_KEY=sk-…
anim audio tts --provider openai --text "Hello there" --voice coral --out intro

export ELEVENLABS_API_KEY=… ANIMSPARK_PROVIDER=elevenlabs
anim audio voice --prompt "warm narrator"
anim audio sfx --prompt "a short glass chime" --sec 1 --out ding
```

Speech from these adapters has **no word timings**, so `cue(vo, 'phrase')` cannot anchor to it
(AnimSpark Cloud's `audio tts` returns timings). Time those lines by hand, or transcribe them.

## Writing your own provider

A provider is a small object (`packages/engine/src/cloud/provider.ts`):

```ts
// my-tts.ts — the MediaProvider type is in packages/engine/src/cloud/provider.ts;
// a plain .mjs file with the same object works too.
const myTts = {
  id: 'mytts',                       // used with --provider
  label: 'My TTS (your key)',
  setup: 'set MYTTS_KEY',            // shown when it is not configured
  configured: (env: Record<string, string | undefined>) => !!env.MYTTS_KEY,
  supports: (command: string) => command === 'audio tts',
  defaults: () => ({ voice: 'default' }),   // optional: options you can fill in yourself
  async run(req: any, ctx: any) {
    // req.command, req.args (validated options; `out` is always set), req.inputs, req.context
    // ctx.workspace, ctx.idempotencyKey (reuse it if you retry), ctx.signal, ctx.fetch, ctx.env
    const res = await (ctx.fetch ?? fetch)('https://tts.example.com/speak', {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.env?.MYTTS_KEY}` },
      body: JSON.stringify({ text: req.args.text, voice: req.args.voice }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`My TTS failed: HTTP ${res.status}`);
    const src = `assets/audio/vo/${req.args.out}.mp3`;
    return {
      files: [{ path: src, bytes: Buffer.from(await res.arrayBuffer()) }],
      index: [{ src, kind: 'audio', text: String(req.args.text) }],  // optional
      receipt: { src },
    };
  },
};
export default myTts;
```

Load it with `ANIMSPARK_PROVIDER_MODULES=/abs/path/my-tts.ts` (comma-separated; `.ts` works) and
select it with `--provider mytts`. The copyable references are
`packages/engine/src/cloud/providers/openai-tts.ts` and `elevenlabs.ts`.

What the engine does with your result, whichever provider produced it:

- every `files[].path` must be relative, under `assets/`, without `..`, hidden segments or
  backslashes, and no directory on the way may be a symlink — otherwise **nothing** is written;
- files are written atomically (temp file, then rename);
- `index` rows (the `assets/index.jsonl` shape: `src`, `kind`, `dur`, `text`, `words` …) are
  merged into the asset ledger, then the regular reconciliation stamps and probes the new files;
- the receipt printed to the agent is your `receipt` plus `provider`, the files written (with
  measured `dur`), and — for AnimSpark Cloud — `credits` and `balance`.

To try the CLI without an account, run the mock server used by the tests:

```sh
node --import tsx packages/engine/src/cloud/testing/mock-api.ts 4799
ANIMSPARK_API_URL=http://127.0.0.1:4799/v1 anim login --key test
```

## Privacy: what leaves your machine

Only the media commands talk to a network, and only to the provider that runs them.

To **AnimSpark Cloud** (`ANIMSPARK_API_URL`), per call:

- your API key (`Authorization` header) and an `Idempotency-Key`;
- the command name and the options you gave it — e.g. the narration text, a prompt, search
  queries, URLs to fetch — plus the output name;
- for `audio asr` only: the bytes of the one file named by `--src` (at most 48 MB);
- the tier, and the workspace's content language from `../runtime/task.json` if it has one.

Not sent: `film.json`, your scenes in `mg/`, other assets, file paths outside the command's
options, or renders. `anim check` / `look` / `render` / `preview` never contact AnimSpark (the
engine may download a font family from a public CDN the first time a scene uses it — the
family name is all that request reveals). `anim login` and `anim credits` send only the key.

To a **bring-your-own-key provider**, the adapter sends what that vendor's API needs (for
text-to-speech: the text, voice and model) directly to the vendor, under that vendor's terms.
AnimSpark sees none of it.
