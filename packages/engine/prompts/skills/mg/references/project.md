# The On Cue project

## Layout

```text
example/
├── film.json                    layout: 8 scenes end to end + a film-wide music track
├── assets/index.jsonl           asset catalog: dur / alignment / attack / peakDb / fonts, plus the prompt each asset was made from
├── mg/on-cue/
│   ├── theme.ts                 visual language: ink palette, gel light colors, type fonts, handoff positions
│   ├── style.css                font setup, the world container, a few global classes
│   ├── sound.ts                 voice / hit / texture / run / sceneLength
│   ├── data/script.ts           prompt book: one request → 8 beats, each with see / understand / next
│   ├── data/cuts.ts             scene starts of the final cut, generated from film.json (see "Layout and final cut")
│   ├── data/envelopes.ts        measured envelopes of the narration, taken from the narration audio (see "Media")
│   ├── lib/                     stage perspective floor · camera · rig lighting · paint materials · noise · words
│   ├── components/              Theatre three canvas layers · Set scenery and reusable pieces · Marquee · Fixtures · Props · Flats · Book · Marks · Hand · Curtain · Waveform · types
│   ├── music/score.ts           film-wide music, written as note data from cuts.ts
│   └── scenes/01…08             one file per scene: word anchors, sounds, timeline, scenery
```

Responsibilities are split as in an ordinary React project: [theme.ts](../example/mg/on-cue/theme.ts) is the only source of colors and fonts; [components/](../example/mg/on-cue/components/Set.tsx) holds objects and their relationships; [lib/](../example/mg/on-cue/lib/rig.ts) holds geometry, lighting and drawing; [data/](../example/mg/on-cue/data/script.ts) treats the script as data; [scenes/](../example/mg/on-cue/scenes/05-cue.tsx) only schedules events. Give each unrelated production unit its own `mg/<unit>/`.

The workspace has no node_modules: `react`, `gsap` and `@animspark/runtime` are resolved by the host at compile time, and `anim check` only transpiles; it does not type-check. If the workspace has a `types/` directory, it only holds loose type stubs for the editor to read. Do not look for `.d.ts` files and do not install dependencies; type annotations are for the reader, and [components/types.ts](../example/mg/on-cue/components/types.ts) is only a few aliases this film uses for itself. Errors that surface only at runtime, such as a lookup that fails (`HITS[name]` has no entry), are located through the stack trace in `anim check`'s error output.

The example ships only source and `assets/index.jsonl`, with no media files such as audio or fonts. Every `assets/…` path you meet in the source can be looked up in index.jsonl, with its measured data and the prompt it was made from.

## Media

All media was obtained with the AnimSpark Cloud commands (they need `anim login` with an API key from https://animspark.com; `anim <command> --help` shows the arguments). Each successful command writes the file under `assets/` and updates `assets/index.jsonl`, and requests for different outputs can run in parallel: 8 narration lines (`anim audio tts`, one voice) and 27 sound effects (`anim audio sfx`). Fonts need no fetching: all 5 families are in the font library, and naming the family in the source loads it; the engine downloads it on first use ([Fonts](fonts.md)). The output of each command gives the facts to use: narration that comes back with `alignment: ready` can be used with `cue` directly; the engine stores the word timing, and the full text is in `assets/transcripts/<path>.vtt`. Do not run ASR on TTS narration that is already aligned. Sound effects were done in two rounds: first prompts written from what the picture needs (one event, one material, distance, dry or wet); then, after viewing the whole mix with `anim look --sound` and actually listening, a second round for what the mix was missing. The four that were auditioned and not used were not kept in assets/. Look up durations, attacks and peaks in the asset index; `cue` reads the narration's word timing from the stored alignment, and the source refers to phrases.

You do not need to measure sound-effect attack and peak yourself: when `anim audio sfx` records a file, it prints `attack` / `peakDb` and writes them into index.jsonl (no `attack` field means the onset is within the first 40 ms; record it as 0). The HITS table in [sound.ts](../example/mg/on-cue/sound.ts) copies these values in; `hit` uses them to trim to the attack and level by `gain`, the trim end never runs past the file length, and a name not in the table is an error. The only thing this film measures itself is the narration envelope (decode to PCM with ffmpeg, take the peak every 10 ms, normalize, and encode as base36 into [data/envelopes.ts](../example/mg/on-cue/data/envelopes.ts)), because the paper strip in 05 draws the real sound waveform. If your film does not draw sound, it has no such step.

Without an account, use files the user provides under `assets/`, muspark scores for music, and visuals drawn in code. Word anchors (`cue(vo, 'phrase')`) need word timing, which comes only from `anim audio tts` or `anim audio asr`; a recording without word timing can still be placed and trimmed by seconds (`duration()`, explicit `at`/`time`). `attack` / `peakDb` are only filled in for sounds made with `anim audio sfx`; for other sound effects, measure the attack yourself (for example with ffmpeg) or by eye with `anim look --sound`.

## Layout and final cut

The layout is not filled in by hand. `anim check` measures each scene's `durationSec` and writes it into index.jsonl (the `dur` of `kind: mg` rows). A script of a dozen or so lines reads those values, places the scenes end to end on film.json's mg track, trims the music track's `time` to the length of the picture, and writes each scene's start into [data/cuts.ts](../example/mg/on-cue/data/cuts.ts). The music depends on cuts.ts, and cuts.ts depends on the scene durations: make a rough layout first so the music can be written, then run it again once the scenes are final; that is the final cut. Whenever any scene's length changes after that, rerun this step; do not edit cuts.ts by hand.

## Validation

Run `anim check` until there are zero warnings. It reports the same sound effect stacked on itself, music longer than the picture, sounds that run past `durationSec`, a film length that deviates from task.json, and gaps of black or overlaps left when a scene changed length but film.json was not re-laid out (rerun the layout script; do not edit `at` by hand). Use `anim look --from <s> --to <s> --fps 1` for one contact sheet per scene to check pacing and handoffs; `anim look --at <s>` for single frames to check materials, small text and gradients; `anim look --sound` for loudness, placement and hits across the whole mix. `anim render` makes the mp4 in `.anim-out/`. For each change, re-check only the seconds it affects.

## Running this film

The example ships only source and `assets/index.jsonl`; it has no media. To run it:

1. Create a workspace with `anim new`, and copy `film.json` and `mg/` from the example into the workspace's working directory (`<dir>/code`).
2. Supply the media at the paths the source uses. Either regenerate each asset with the cloud commands from the `from` prompt and `voiceId` recorded in the example's index.jsonl (re-synthesized narration gets new word timing; `cue` re-aligns to it automatically; if you change the text, update the phrase selectors), or substitute your own files at the same paths.
3. Run `anim check`, `anim look`, then `anim render`.

With the media in place, the example passes `anim check`; the only warnings are about fallback system fonts in its font stacks. The example's index.jsonl is a read-only fact sheet for reading; do not copy it into the workspace over the workspace's own index.
