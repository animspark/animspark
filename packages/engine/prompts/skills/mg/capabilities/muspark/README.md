# Scored music (@muspark/core)

Write the score as plain data. The engine renders each `Score` into one complete WAV on the user's machine, and `anim preview`, `anim look --sound` and `anim render` all use that same file; the picture aligns to the music by reading the same notes with `cue(music, note)`. React only writes the score and the picture; it does not build a real-time sequencer. After you edit a score, `anim check` re-renders the audio. No account is needed.

## When to use

- The picture has to land on specific beats or notes, or the picture itself "reads" the music (notes light up, drum hits push the motion): use this page.
- You only need an ambient music bed with no hit points: `anim audio music` generates an audio file. It is faster and sounds more like a real recording, but it runs on AnimSpark Cloud and needs `anim login`. A muspark score needs no account.
- Music that belongs to one scene goes in that scene's `sounds`. Start from the [scene example](references/scene-music.md); it is a complete scene that runs as is.
- Continuous music across scenes is a film-wide music module: a file such as `assets/audio/music/<name>.ts` whose default export is a `Score`, placed on an audio track in film.json. See [film music](references/film-music.md).

## Beats and seconds

- One beat = 60 / bpm seconds. `scoreTime(score, beat)` converts beats to source seconds; `scoreDuration(score)` is the total seconds including the tail.
- To fill D seconds: set `durationBeats` to D × bpm / 60, rounded up to a whole bar (a multiple of 4 in 4/4). Trim the excess with the sound's `time`, or let the last bar resolve.
- The scene's `durationSec` must cover at least `music.at + duration(music)`. `tailSec` (default 0.4) is the tail for release and reverb; raise it when the reverb is long.
- Hit points: `cue(music, note).start` is in scene seconds, with `at` and `time` already applied. For a drum hit write `cue(music, { beat: hit.beat, duration: 0.2 })`.

## Default orchestration

Pick a set by subject first, then adjust it to the picture:

| Subject | Melody | Harmony / pad | Bass | Drums |
| --- | --- | --- | --- | --- |
| Corporate, product | `electric-piano` or `pluck` | `synth-pad` | `synth-bass` | `drumPattern('gentle')` |
| Explainer, science | `marimba` or `piano` | `strings` | `bass` | light `closed-hat` plus `kick`, or no drums |
| Narrative, emotional | `piano` or `cello` | `strings` or `choir` | `cello` | `drumPattern('ballad')` |
| Tech, games | `synth-lead` | `synth-pad` | `synth-bass` | `drumPattern('rock')` |

Mix starting values: with narration, set the lead channel's `gainDb` to about −12, the pad and bass 3–6 dB lower, and the drums lower still. Where the narration is dense, cut notes and voices; on key words, hit the point with a shared note or drum hit. The final judge is the `anim look --sound` mix view plus actually listening; you cannot judge from the score alone.

## Lookup by task

| What you need | Read |
| --- | --- |
| Fields for scores, channels, notes, effects and automation | [Score](APIs/Score.md) |
| Writing melodies, chords, arpeggios, bass lines and drum patterns | [Composition helpers](APIs/composition.md) |
| Choosing an instrument, synth preset, sampled instrument or drum | [Full instrument list](references/instruments.md) |
| Designing your own voice: envelope, filter, oscillators | [VoiceSpec](APIs/VoiceSpec.md) |

## Limits

- `instrument` is an instrument name; `voice` is a synth preset or a custom VoiceSpec. Do not put one in the other's field. Sampled instruments take `bank: 'sampled'`; neither `voice` nor `kit: 'chip'` can be combined with `bank: 'sampled'`.
- Drum channels take only `hits`; melodic channels take `instrument` plus `notes`, `chords` or `tablature`.
- Instrument voices have nothing to do with the TTS voiceId.
