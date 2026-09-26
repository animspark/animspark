# Score

- `bpm`: beats per minute. `durationBeats`: total beats of the piece, rests included; notes must not run past it.
- `tailSec`: seconds of tail for release, delay and reverb, default `0.4`. Increase it for longer tails.
- `channels`: each channel needs a unique `id`. Melodic channels take `instrument` plus `notes`, `chords` or `tablature`; drum channels take `hits` and must not mix in melodic fields.
- `notes`: `{ pitch, beat, duration, velocity?, instrument? }`. Pitch is `'C4'`, `'F#5'` or a MIDI number; `beat/duration` are in beats; `velocity` is 0–1.
- `chords`: `{ symbol, beat, duration, velocity?, octave?, inversion?, voices? }`, e.g. `Cmaj7`, `Am`; the chord is played directly.
- `hits`: `{ drum, beat, velocity? }`. `tablature`: `{ tuning?, events: [{ string, fret, beat, duration, velocity? }] }`; strings are numbered 1–6.
- A channel can set `label`, `gainDb`, `pan` (−1–1), `mute`, `solo`; `automation: [{ beat, gainDb?, pan? }]` automates the channel by beat.
- A channel's `effects`: `{ drive?, delay?: { timeBeats?, feedback?, mix? }, reverb? }`.

`scoreTime(score, beat)`: beats → source seconds; `scoreDuration(score)`: total seconds including the tail; `validateScore(score)`: validation. For placing and trimming in MG, use `duration(sound)` and `cue(sound, event)`.



The full types are exported by `@muspark/core`. All note, chord and drum-hit data is in beats. Convert to seconds with cue only when aligning to a scene.
