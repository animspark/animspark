# Syncing sound and controlled views

Add the score and the views to the actual scene component; the file name is up to you. The music and the two views share one score, and `cue()` maps the beat window of the whole piece onto the MG's GSAP clock.

```tsx
import { useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue, duration } from '@animspark/runtime';
import { line, type Score as ScoreSpec } from '@muspark/core';
import { Score, PianoRoll } from '@muspark/ui/react';

gsap.registerPlugin(useGSAP);
const score: ScoreSpec = {
  bpm: 120,
  durationBeats: 8,
  channels: [{ id: 'melody', instrument: 'piano', notes: line(['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'C4'], { step: 1, duration: 0.8 }) }],
};
const music = { id: 'study', kind: 'music', score, at: 0.2 };
export const sounds = [music];
export const durationSec = music.at + duration(music) + 0.2;

export default function MusicStudy() {
  const ref = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(0);
  useGSAP(() => {
    const playhead = { beat: 0 };
    const span = cue(music, { beat: 0, duration: score.durationBeats });
    gsap.timeline().to(playhead, {
      beat: score.durationBeats,
      duration: span.dur,
      ease: 'none',
      onUpdate: () => setBeat(playhead.beat),
    }, span.start);
  }, { scope: ref });
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, background: '#101012' }}>
      <div style={{ position: 'absolute', left: 50, top: 40, width: 1820, height: 480 }}>
        <Score score={score} channel="melody" progress={beat} title="Theme in C" />
      </div>
      <div style={{ position: 'absolute', left: 50, top: 560, width: 1820, height: 480 }}>
        <PianoRoll score={score} channel="melody" progress={beat} />
      </div>
    </div>
  );
}
```

Every instance can take its own `progress`. When they should show the same progress, share one state; `id` is only a DOM attribute, and animation selectors are scoped by the MG's own `scope`.

If the music declaration has `time: [source in, source out]`, progress also starts from the beat that corresponds to the source in point, not from 0: `fromBeat = time[0] * score.bpm / 60`. Tween only the audible part of the music, and hold the final beat during the tail. Placement, trimming and picture must all use the same `music` declaration.
