# @muspark/core

Declare melody, harmony and drums in one `Score`, compile it into a single event plan, and render it offline, in Node or the browser, into deterministic stereo audio. The score, music theory and arranging tools are pure computation; the host loads sound banks and writes WAV output.

## Using it in AnimSpark

Write section music directly in the actual MG scene component:

```tsx
const music = { id: 'scene-music', kind: 'music', score, at: 0.2 };
export const sounds = [music];

// In this scene's useGSAP, share the same note event as the sound.
tl.from('.shape', { scale: 0, duration: 0.2 }, cue(music, note).start);
```

`score` and `note` are the same score and event that make the sound; import `cue` from `@animspark/runtime`. The scene file name is up to you; the music moves, trims and changes volume together with the MG.

For music that runs continuously across sections, default-export a `Score` from a plain `.ts` / `.js` file, for example `assets/audio/music/bed.ts`, and add it to the `tracks` of `film.json`:

```json
{ "kind": "audio", "clips": [{ "id": "bed", "src": "assets/audio/music/bed.ts", "at": 0, "volume": 0.4 }] }
```

The engine synthesizes all parts of each score offline into one complete WAV, caches it, and mixes it through a single audio player. The generated audio, the waveform and the asset index are maintained automatically; the audio re-renders after you edit the source. Playback does not synthesize note by note in real time. Film-wide music is independent of MG trimming; do not play it a second time in a scene's `sounds`.

## Scores

```ts
import { drumPattern, line, scoreDuration, scoreTime, type Score } from '@muspark/core';

export const melody = line(['C4', 'E4', 'G4', null, 'E4', 'D4', 'C4'], { step: 1 });
export const score: Score = {
  bpm: 120,
  durationBeats: 8,
  tailSec: 0.4,
  channels: [
    {
      id: 'melody',
      instrument: 'piano',
      bank: 'sampled',
      gainDb: -6,
      notes: melody,
      automation: [{ beat: 0, pan: -0.3 }, { beat: 8, pan: 0.3 }],
      effects: { reverb: 0.2 },
    },
    {
      id: 'drums',
      bank: 'synth',
      gainDb: -12,
      hits: drumPattern('rock', { bars: 2 }),
    },
  ],
};

scoreTime(score, melody[1]!.beat); // 0.5 s, relative to this score's origin
scoreDuration(score);            // 4.4 s, including rests and the tail window
```

`Score` is the only authored data shape. `bpm`, `durationBeats` and `channels` are required; `channels: []` means silence of a definite length. The optional `key` is notation information and `timeSignature: [4, 4]` is for display; neither rewrites the notes. A beat is a quarter-note length, and time is always `beat * 60 / bpm`.

```ts
type Score = {
  bpm: number;
  durationBeats: number;
  tailSec?: number;               // default 0.4 s
  key?: string;
  timeSignature?: [number, number];
  channels: Channel[];
};
```

A melodic channel has a required `instrument` and can declare `notes`, `chords` and `tablature` together; these events are merged. A drum channel has a required `hits` and cannot declare melodic fields. Both kinds of channel share these controls:

| Field | Meaning |
| --- | --- |
| `id`, `label?` | `id` is a non-empty string unique within the score; `label` is a display name |
| `gainDb?` | -60 to +12 dB, default 0; both backends support positive gain |
| `pan?` | -1 left, 0 center, 1 right; default 0 |
| `mute?`, `solo?` | Mute or solo; when any unmuted solo channel exists, only those channels play |
| `automation?` | `{ beat, gainDb?, pan? }[]`, beat positions strictly increasing |
| `effects?` | `{ drive?, delay?: { timeBeats?, feedback?, mix? }, reverb? }` |
| `bank?` | `'synth'` or `'sampled'`; the instrument is validated against the chosen backend |

The event fields are as follows; `velocity` is always an optional 0–1, and 0 means silent.

```ts
notes: [{ pitch: 'C4', beat: 0, duration: 1, velocity: 0.7 }]
chords: [{ symbol: 'Cmaj7', beat: 0, duration: 4, octave: 3, inversion: 0, voices: 4 }]
tablature: {
  // Strings 1–6 default to the tuning E4 B3 G3 D3 A2 E2; override it with tuning.
  events: [{ string: 6, fret: 3, beat: 0, duration: 1 }],
}
hits: [{ drum: 'kick', beat: 0, velocity: 0.8 }]
```

`pitch` accepts scientific pitch names (`C4 = 60`, `A4 = 69`) or an integer MIDI pitch 0–127. Notes and chords can override the channel's instrument with `instrument`; tablature overrides it with `tablature.instrument`. Every start must lie within `[0, durationBeats)`, and the end of an event with a duration must not pass `durationBeats`. Drums are one-shot sounds whose length comes from the chosen instrument.

## Time, tails and automation

The score declares its playback length; it is not guessed from the last note:

- The music window is `durationBeats * 60 / bpm`, including any rests the author placed before and after.
- `tailSec` is an extra playback window, 0.4 s by default; setting it to 0 cuts the sound off at the end of the music window. Long reverbs or slow releases need it increased explicitly.
- The instrument's own release, drum decay and effects do not lengthen the file automatically. The output frame count is `ceil(scoreDuration(score) * sampleRate)`.
- `scoreTime(score, beat)` and the compiled `startSec` are both relative to the score's origin. They do not include the placement time in the film or the MG.

Automation is interpolated per sample between control points, so long notes keep changing too. Gain is interpolated on a linear dB scale and pan on a linear pan scale; a field omitted from a point carries over the previous value. When the first point is later than beat 0, interpolation starts from the channel's initial value; after the last point the final value holds, including through the tail window.

Gain and pan are applied before delay and reverb; sound already in the effects decays naturally with them. Oscillators use equal-power panning; sampled channels keep the sound bank's original stereo, at unity gain when centered and balanced with equal power toward either side. Sampled gain acts on the PCM and is not limited by the volume ceiling or step resolution of MIDI CC7.

`drive`, `reverb` and delay `mix` range over 0–1, `feedback` over 0–0.85, and `timeBeats` over 0.0625–8 (default 0.5). Delay produces at most four echoes. Oscillator drive acts per note and sampled drive acts after the channel is mixed; each way of producing sound keeps its own character.

## Sound sources

For the full names and descriptions, see the [instrument list](../engine/prompts/skills/mg/capabilities/muspark/references/instruments.md); for every custom voice field, range and default with working recipes, see [custom synth voices](../engine/prompts/skills/mg/capabilities/muspark/APIs/VoiceSpec.md). Both references are installed with the mg skill under `capabilities/muspark/`.

`INSTRUMENTS` provides 19 oscillator instruments that need no download, and `INSTRUMENT_DRUMS` 9 synthesized drums. `SAMPLED_INSTRUMENTS` provides 149 GM/extended instrument names and `SAMPLED_DRUMS` 47 sampled drum pieces; see `SAMPLED_FAMILIES` for them by instrument family.

Without `bank`, the 19 built-in instrument names and 9 drum names use oscillators, and every other registered name uses samples. For instruments whose names exist in both, such as `piano`, `guitar` and `strings`, write `bank: 'sampled'` explicitly to hear the real samples. An unknown name, or a name the chosen backend does not support, is an error.

A melodic channel can override how it produces sound with `voice`, which accepts a preset name from `CHIPTUNE_VOICE_NAMES` or a `VoiceSpec`:

```ts
const lead = {
  id: 'lead',
  instrument: 'synth-lead',
  voice: {
    oscillators: [
      { wave: 'saw', gain: 1 },
      { wave: 'square', gain: 0.3, detuneCents: 7 },
    ],
    envelope: { attack: 0.01, decay: 0.12, sustain: 0.6, release: 0.3 },
    filter: { type: 'lowpass', cutoff: 1800, resonance: 0.2 },
    vibrato: { rate: 5, depthCents: 8, delaySec: 0.2 },
    bitCrush: 10,
  },
  notes: [{ pitch: 'C5', beat: 0, duration: 2 }],
} satisfies import('@muspark/core').MelodyChannel;
```

The available waves are `sine`, `triangle`, `saw`, `square`, `pulse` and `noise`. Oscillators support ratio, phase and detune; a voice supports an envelope, filter, vibrato, drive, bitCrush and sampleReduce. `voice` is only for the synth backend and cannot be combined with `bank: 'sampled'`. Chip drums use `kit: 'chip'` with `chip-kick`, `chip-snare` and `chip-hat`; ordinary drums omit `kit`.

## Music theory and arranging tools

Every tool is exported from the pure entry `@muspark/core` and can be called at module top level.

| Tool | Returns and use |
| --- | --- |
| `midiOf`, `nameOf`, `hzOf` | Conversions between pitch names, MIDI and frequency |
| `parseChord`, `voiceChord`, `chordRoot` | Parse a chord, expand it to MIDI pitches, get the bass root |
| `scaleNotes`, `progression`, `namedProgression` | Scale pitch names, Roman-numeral chord progressions, named progressions |
| `layChords(symbols, { beatsEach, startBeat? })` | `ChordSpan[]`: `{ symbol, beat, duration }` |
| `arpeggio(spans, { step, shape?, octave?, voices?, velocity?, accent? })` | `Note[]`; a final incomplete step is shortened to the end of the span |
| `blockChord(spans, options?)`, `bassLine(spans, options?)` | `Note[]` for block harmony and a bass line |
| `line(pitches, { step, start?, duration?, velocity? })` | Equal-duration `Note[]`; `null` leaves a one-step rest |
| `seq([[pitch, duration], ...], { start?, velocity?, legato? })` | Variable-duration `Note[]`; `null` is a rest |
| `stack(pitches, { beat, duration, velocity? })` | `Note[]` that start together |
| `shift(notes, beats)`, `transpose(notes, semitones)` | Return a new `Note[]`; transposition converts pitch names and numeric pitches alike |
| `repeat(notes, times, periodBeats)` | Repeats a pattern; the period is an explicit number of beats |
| `drumPattern(template, { bars, startBeat?, beatsPerBar?, velocity?, accent? })` | `DrumHit[]`; the template can be `rock`, `ballad`, `swing`, `gentle` or your own table of drum-piece offsets |

Chords support the common triads and sevenths plus registered extended qualities; a slash bass is placed separately below the lowest note. An unrecognized suffix is an error; it is not dropped. `scaleNotes` supports major and minor, modes, pentatonic scales and more; Roman-numeral progressions accept only seven-note scales and do not force a pentatonic scale into seven-degree harmony. Pattern steps and durations must be finite and positive, repeat counts have an upper limit, and `step: 0` cannot cause an infinite loop.

## Pure compilation and validation

```ts
validateScore(value: unknown): Score
scoreTime(score: Score, beat: number): number
scoreDuration(score: Score): number
compileScore(score: Score): ScoreRenderPlan
scoreToSynthEvents(score: Score): SynthEvent[]
```

`validateScore` returns the original object and throws an error with the field path on invalid input; it does not rewrite, clamp or fill it. The time and compile functions above validate the score too. `compileScore` returns `{ events, musicalDurationSec, tailSec, durationSec }`; `scoreToSynthEvents` is only an event projection of the same plan.

Validation covers unknown fields, unique channel IDs, melodic/drum exclusivity, event ranges, pitches, instruments, effects and automation. The current workload limits are BPM 20–400, a length of 24000 beats, a tail of 0–60 seconds and at most one hour of total playback; each input array holds at most 100000 items. The host should still set smaller workload limits on piece length, number of parts and number of renders according to device memory.

`SCORE_RENDERER_VERSION` identifies the current compilation and DSP semantics. When the host caches finished audio, the cache key should include the normalized score, the sample rate, this version and a digest of the actual SoundFont content; the score or the file path alone is not enough to decide invalidation.

## Rendering in Node

```ts
import { writeFile } from 'node:fs/promises';
import {
  compileScore, hasSampledEvents, ensureSoundFont,
  renderScoreAsync, soundfontDigest,
} from '@muspark/core/server';

const plan = compileScore(score);
if (hasSampledEvents(plan.events)) await ensureSoundFont();
const result = await renderScoreAsync(score, { sampleRate: 44100 });
await writeFile('music.wav', result.wav);
// result: left/right Float32Array, wav Buffer, sampleRate, durationSec,
// eventCount, peakDb, limited.
```

`renderScore` / `renderScoreWav` are synchronous entries that support oscillators only. `renderScoreAsync` / `renderScoreWavAsync` support mixed scores. The only options are `{ sampleRate?, soundfont? }`; the playback length comes from the score. The default is 44100 Hz, and integer sample rates from 8000 to 192000 are supported; the WAV is stereo 16-bit PCM. Overload is scaled down as a whole to a 0.92 peak and reported through `limited`.

Prepare the sample bank the first time with `ensureSoundFont()`; later renders do not go online automatically. The file path is resolved in this order: an explicit `soundfont`, `MUSPARK_SOUNDFONT`, `MUSPARK_SOUNDFONT_DIR`, then the platform cache directory; the download source can be set with `MUSPARK_SOUNDFONT_URL`. `soundfontDigest()` returns the SHA-256 of the actual file; the load cache is also keyed on the actual content digest, so an updated file at the same path is resolved again.

## Rendering in the browser

```ts
import { fetchSoundBank, renderScoreAsync } from '@muspark/core/browser';

const soundBank = await fetchSoundBank(); // only needed when the score has sampled parts
const result = await renderScoreAsync(score, { sampleRate: 44100, soundBank });
const audio = new AudioContext();
const buffer = audio.createBuffer(2, result.left.length, result.sampleRate);
buffer.copyToChannel(result.left, 0);
buffer.copyToChannel(result.right, 1);
const source = audio.createBufferSource();
source.buffer = buffer;
source.connect(audio.destination);
source.start();
```

The browser entry's options are `{ sampleRate?, soundBank? }`, and the WAV is returned as a `Uint8Array`. `fetchSoundBank({ url?, cache?, cacheName?, onProgress? })` caches the default GeneralUser GS sound bank (about 32 MB) with the Cache API; you can also parse bytes you obtained yourself with `loadSoundBankBytes`. The host should reuse the parsed result. To update a sound bank at the same URL, change the versioned URL or the cache name.

Both sides share compilation, DSP, sample synthesis and WAV encoding. Tests check that the two bundles produce byte-identical output with the same sound bank, including automation and mixed backends. Rendering builds the whole PCM in memory; it is not streaming real-time synthesis. In the browser, put it in a Worker so long pieces do not occupy the UI thread.

## Tests

```sh
pnpm --filter @muspark/core test
pnpm --filter @muspark/core typecheck
```

They cover declared durations, strict validation, pattern loop limits, transposition of pitch names, continuous gain/pan on real long notes, positive sampled gain, sound-bank updates at the same path, the WAV format and browser/Node parity. Sampled tests use a sound bank already present locally and are skipped explicitly when it is missing; the tests never download it.
