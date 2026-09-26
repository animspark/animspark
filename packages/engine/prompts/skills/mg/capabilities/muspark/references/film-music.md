# Film music

Film-wide music is a plain `.ts` / `.js` module whose default export is a `Score`, for example `assets/audio/music/bed.ts`. The path is up to you, and no extra MG component is needed:

```ts
import { arpeggio, layChords, type Score } from '@muspark/core';

const harmony = layChords(['C', 'G', 'Am', 'F'], { beatsEach: 8 });
export const melody = arpeggio(harmony, { shape: [0, 1, 2, 1], step: 0.5, octave: 4 });
const score: Score = {
  bpm: 120,
  durationBeats: 32,
  channels: [
    { id: 'keys', instrument: 'piano', notes: melody, gainDb: -8 },
  ],
};
export default score;
```

Reference the source file from an audio track in `film.json.tracks`. `at` is in film seconds; trim with `time: [source in, source out]`.

```json
{ "kind": "audio", "clips": [{ "id": "bed", "src": "assets/audio/music/bed.ts", "at": 0, "volume": 0.4 }] }
```

`film.json` keeps the source path, and the engine renders the audio on the user's machine: any audio clip whose `src` is a `.ts` / `.js` module is evaluated as a Score, and `anim check`, `anim preview` and `anim render` render it to a WAV (`assets/audio/music/score-<hash>.wav`, recorded in `assets/index.jsonl`) and re-render it when the score changes. No account is needed. Scenes can import the same score and its events, but do not add it to their `sounds` as well. Film music is independent of how MG clips are trimmed.

When the film music starts at 0 and a scene occupies seconds 4–8, import the same `score`, and convert to scene time with `const window = { score, time: [4, 8] as const };` and `cue(window, note).start`. Pick only events that lie entirely inside the window. Do not add `window` to `sounds`, and move the window when you move the scene.
