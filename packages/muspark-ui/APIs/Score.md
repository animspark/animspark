# Score

Staff notation with note highlighting. Import it from `@muspark/ui/react`.

| Prop | Notes |
| --- | --- |
| `score` | Required: the same playable Score, in the core format. |
| `progress` | Current source beat, default 0; controlled by the caller. |
| Own props | title (heading), keySignature (key label, default C major), meter (time-signature label, default 4/4). |
| `style / className / id` | Outer layout and DOM attributes; id does not register a global handle. |

The key and time signature are display labels; they cannot transpose the score or change its meter.

```tsx
import { useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import type { Score as ScoreSpec } from '@muspark/core';
import { Score } from '@muspark/ui/react';

const score: ScoreSpec = { bpm: 120, durationBeats: 4, channels: [
    { id: 'melody', instrument: 'piano', notes: [{ pitch: 'C4', beat: 0, duration: 1 }, { pitch: 'G4', beat: 2, duration: 1.5 }] }
] };
export function Example() {
  const [beat, setBeat] = useState(0);
  useGSAP(() => {
    const clock = { beat: 0 };
    gsap.to(clock, { beat: 4, duration: 2, ease: 'none', onUpdate: () => setBeat(clock.beat) });
  });
  return <Score score={score} channel="melody" progress={beat} style={{ width: 960, height: 540 }} />;
}
```

This is a controlled-view example. To connect it to sound, use the Score and music time window already in the scene; see [Synchronization example](../references/synchronization.md).
