# Scene music and hit points

Write the score and the animation in the actual scene TSX; the file name is up to you. This example defines a custom lead voice, backed by bass and drums; the eight notes sync with the picture one by one.

```tsx
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue, duration } from '@animspark/runtime';
import { bassLine, drumPattern, layChords, line, progression, type Score, type VoiceSpec } from '@muspark/core';

gsap.registerPlugin(useGSAP);
const melody = line(['C5', 'E5', 'G5', 'B5', 'A5', 'G5', 'E5', 'C5'], { step: 1, duration: 0.65 });
const harmony = layChords(progression('C major', ['I', 'V', 'vi', 'IV']), { beatsEach: 2 });
const leadVoice: VoiceSpec = {
  oscillators: [{ wave: 'triangle' }, { wave: 'sine', ratio: 2, gain: 0.2 }],
  envelope: { attack: 0.01, decay: 0.12, sustain: 0.3, release: 0.15 },
  filter: { type: 'lowpass', cutoff: 3200 },
};
const score: Score = {
  bpm: 120,
  durationBeats: 8,
  tailSec: 0.4,
  channels: [
    { id: 'lead', instrument: 'synth-lead', voice: leadVoice, notes: melody, gainDb: -6 },
    { id: 'bass', instrument: 'bass', notes: bassLine(harmony), gainDb: -10 },
    { id: 'drums', hits: drumPattern('gentle', { bars: 2 }), gainDb: -12 },
  ],
};
const music = { id: 'scene-music', kind: 'music', score, at: 0.2 };
export const sounds = [music];
export const durationSec = music.at + duration(music) + 0.2;

export default function Scene() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const tl = gsap.timeline();
    melody.forEach((note, i) => {
      tl.from(`.note-${i}`, { opacity: 0, y: 50, duration: 0.2 }, cue(music, note).start);
    });
  }, { scope: ref });
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, background: '#101820', color: '#f5e9bc' }}>
      {melody.map((note, i) => <div key={i} className={`note-${i}`} style={{ fontSize: 70 }}>{String(note.pitch)}</div>)}
    </div>
  );
}
```

Each `Score` is first rendered on the user's machine into one complete WAV and cached; the player mixes music, narration and sound effects in one place, and `anim render` and `anim look --sound` reuse the same result. The browser does not synthesize note by note in real time. `anim check` prepares the audio and re-renders it when the score changes; the rendered file (`assets/audio/music/score-<hash>.wav`) and its entry in `assets/index.jsonl` are maintained automatically. React does not create a player or a clock of its own.

Narration, sound-effect files and programmatic music share `sounds`. The music's `at` can be `cue(vo, 'let the music play').start` (a word anchor needs word timing, which comes from `anim audio tts` or `anim audio asr`). `cue(music, note)` accepts `{ beat, duration }`; for a drum hit write `cue(music, { beat: hit.beat, duration: 0.2 })`. The returned `start/end/dur` are in scene seconds, with `at` and the `time` trim applied. If the score is not reused elsewhere, inline it.
