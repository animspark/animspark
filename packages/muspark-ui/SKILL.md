---
name: ui
description: "Display one playable Score as staff notation or a piano roll, in sync with the music."
---

Displays one `@muspark/core` score as staff notation or a piano roll. For how to write the score, see the scored-music capability of @animspark/mg (`capabilities/muspark/`).

Import the components from `@muspark/ui/react`. Both require `score`; `progress` is the position in source-score beats (default 0). They only display; the sound still comes from the scene's `sounds` or from a film-wide audio track. Several views stay in sync by sharing `score`/`progress`; no global ID or handle is needed.

| Component | Shows |
| --- | --- |
| [Score](APIs/Score.md) | Staff notation with note highlighting |
| [PianoRoll](APIs/PianoRoll.md) | Pitch, duration, velocity and a playhead |

Read the page of the component you choose first. When the progress has to correspond to how the music is placed and trimmed, read [Synchronization example](references/synchronization.md). The components fill their outer container; use `style`/`className` to set the box.

Do not copy a second set of notes from the waveform; use the Score that produces the sound. Give notes, ticks and labels enough room.
