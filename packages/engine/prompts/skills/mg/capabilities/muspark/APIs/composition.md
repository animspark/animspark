# Composition helpers

Import the helpers from `@muspark/core`. They return plain event arrays.

| Function | Example |
| --- | --- |
| `line` evenly spaced melody | `line(['C5', null, 'E5', 'G5'], { step: 0.5, duration: 0.4 })`; `null` is a rest |
| `seq` free durations | `seq([['C5', 1], [null, 0.5], ['E5', 0.5]])` |
| `stack` simultaneous notes | `stack(['C4', 'E4', 'G4'], { beat: 0, duration: 2 })` |
| `progression` scale degrees → chords | `progression('C major', ['I', 'V', 'vi', 'IV'])` |
| `layChords` lay chords out in time | `layChords(['C', 'G', 'Am', 'F'], { beatsEach: 2 })` |
| `arpeggio` arpeggio | `arpeggio(harmony, { shape: [0, 1, 2, 1], step: 0.5, octave: 4 })`; keeps each chord's `beat`, so do not offset it again |
| `blockChord` block chords | `blockChord(harmony, { octave: 4, sustain: 0.8 })`; `sustain` is a multiplier on the chord's length, `0.8` plays 80% of it |
| `bassLine` bass line | `bassLine(harmony, { octave: 2, style: 'root-fifth', step: 1 })` |
| `drumPattern` drum pattern | `drumPattern('rock', { bars: 2 })` returns `{ drum, beat, velocity }[]`. Drums per template: `rock` kick/snare/closed-hat, `ballad` kick/snare/closed-hat, `swing` ride/snare/kick, `gentle` only shaker/ride (no kick). Before syncing picture to the beat, filter by `hit.drum` and make sure the result is not empty |

Let voices enter in turn and leave rests. Under narration, lower density and volume; on key words, reinforce with a note or drum hit.
