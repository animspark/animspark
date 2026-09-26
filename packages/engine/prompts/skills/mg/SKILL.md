---
name: mg
description: "Create motion graphics, from standalone titles, cards and diagrams to complete multi-scene films with synchronized sound. The scene contract: read it before writing any file under mg/. It routes to the film method for complete films (script, assets, first frame, scenes, sound-driven choreography, verification, with a finished example and its source) and to the engine capabilities: canvas drawing, 3D (three), generative art (p5), rigid-body physics (matter-js), playable scores synced to picture (@muspark/core) and fonts."
---

An MG is a React component in `mg/`. It can be a standalone element such as a title or a card, or a complete scene. The component exports picture, sound (`sounds`) and duration (`durationSec`), and `film.json` places it on the timeline as a clip. Picture and sound share one local time that starts at 0.

Write it as native React, CSS and GSAP, with one fundamental difference: **the host owns the clock**. Playback, scrubbing, frame grabs and rendering all jump to second t and render directly, so every frame must be determined by t alone. The rest of this page covers only what differs from native use.

For a complete multi-scene film with narration, read [Complete film](references/film.md) first. It includes the full source of an example film.

## Default pattern

The component is the default export, and the module also exports `durationSec`, a positive finite number. Prepare the narration and sound effects first, then replace the paths and phrases in the example with your actual assets. The example only demonstrates the API; it is not a benchmark for choreography density in a finished film.

```tsx
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue, duration, useStage } from '@animspark/runtime';

gsap.registerPlugin(useGSAP);
const vo = { id: 'narration', kind: 'voice', src: 'assets/audio/vo/intro.m4a', at: 0.2 };
export const sounds = [vo,
  { id: 'hit', kind: 'sfx', src: 'assets/audio/sfx/hit.mp3', at: cue(vo, 'reaches Earth').start },
];
export const durationSec = Math.max(...sounds.map(sound => (sound.at ?? 0) + duration(sound))) + 0.4;

export default function Scene() {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useStage();
  useGSAP(() => {
    gsap.timeline()
      .from('.word', { scale: 0, duration: 0.4, ease: 'back.out(2)' }, cue(vo, 'Energy is conserved').start)
      .to('.word', { x: w * 0.06, duration: 0.6, ease: 'power2.inOut' }, cue(vo, 'reaches Earth').start);
  }, { scope: ref });
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#f5f1e8' }}>
      <div className="word" style={{ fontSize: h * 0.11 }}>Energy is conserved</div>
    </div>
  );
}
```

Create animations inside `useGSAP` and scope selectors with `scope`. To animate the root element, pass `ref.current` directly; under `scope: ref`, string selectors match only descendants of the root. Take dimensions from `useStage()`; do not assume 1920×1080. Ordinary reusable child components do not need to export `durationSec` or `sounds`.

## Time

- The host pauses the animations created in `useGSAP` and seeks them to the film clock: timelines, standalone tweens with `delay`, `gsap.set`, and `repeat`/`yoyo` all behave with their native semantics.
- CSS animations/transitions, wall-clock timers and independent animation loops do not follow the film clock: `requestAnimationFrame`, `setInterval`/`setTimeout`, `Date.now()`, and bare `<video>`/`<audio>` make playback, scrubbing and rendering each produce different frames. `anim check` warns about these patterns.
- Seed random numbers (for example with mulberry32), and pass a seed to noise and hand-drawn libraries too. Do not accumulate state from frame to frame (`x += v`): during scrubbing and rendering, frames arrive out of order.
- For picture computed continuously from t (canvas, noise, physics lookup tables), read the current second with `useLocal()`. For a state object choreographed on a timeline and then read by a canvas, redraw in the timeline's own `onUpdate`: by the time GSAP calls it, every child tween has finished this frame. Do not draw some other state from inside an individual tween's `onUpdate`.
- Register resources prepared asynchronously (dynamic `import()`, images and fonts a canvas needs, 3D textures) with `registerFilmPending(promise)`, and redraw at the current t once they finish; frame grabs and rendering wait for them to settle.

## Two-phase execution

The module top level and the component render first run once in Node to collect `durationSec` and `sounds`. That pass has no DOM and runs no effects. So both exports must be computable at module top level; use `document`, `window`, canvas and browser-only libraries only inside `useGSAP` or an effect; load libraries that touch `window` at import time (such as p5) with dynamic `import()`. Pure computation such as `gsap.parseEase` and `gsap.utils` works in both phases.

These packages can be imported without installing anything: the individual `d3-*` modules, `roughjs`, `simplex-noise`, `highlight.js`, `topojson-client`, `world-atlas`.

## Sound

Export the `sounds` array statically. Each sound has an `id`, a `kind` (`voice` / `sfx` / `music`) and a `src` file path; optionally `at` (start within the scene, default 0), `time: [source in, source out]` (default: the whole file) and `volume` (default 1; 0 mutes). A silent scene can omit `sounds` and give its duration directly.

`duration(src)` returns the asset's original length; `duration(sound)` returns the trimmed length in seconds, excluding `at`. Sounds must fall within `durationSec`; with several sounds, the latest end point determines the scene's duration. Moving, trimming and changing the volume of the outer MG applies to its sounds as a whole. Put continuous music for the whole film on an audio track in the film, so it does not play twice alongside the scenes.

`cue(vo, 'phrase')` returns `start`, `end` and `dur` in scene time, and accounts for the sound's `at` and `time` automatically. If you use it once, inline it; declare a variable only when several actions share it. Anchor on a phrase that is unique in its sentence; if the same phrase occurs more than once, pick one with `{ occurrence: 2 }` (counting from 1). A missing word, an ambiguous match, or a match that falls in a trimmed-away part is an error; when the end time of the last word is missing, only `start` can be read. After you regenerate the narration, anchors re-align automatically.

Word timing comes from `anim audio tts` (the narration it synthesizes is aligned) or from `anim audio asr` for a recording; both are AnimSpark Cloud commands and need `anim login`. Without word timing, `cue(vo, 'phrase')` on that file is an error: place the sound with `at` / `time` and time the actions in explicit scene seconds, using `duration()` for lengths.

With no narration at all, let the music carry the timing: write the score (see [capabilities/muspark](capabilities/muspark/README.md)) and anchor actions on its notes with `cue({ score, time }, note).start` — the notes are data, so filter them (by drum, channel or beat) and every hit, keystroke or cut lands on its beat. Pick only notes that lie entirely inside the window the scene plays.

Asset paths, durations, text previews and `alignment` status are in the read-only `assets/index.jsonl`. `alignment: ready` means the engine already has word-level timing: use `cue` on that narration directly, and do not run ASR for it. The full text of each voice asset is in `assets/transcripts/<path>.vtt`, split at pauses, with times in source seconds. Use it to read the content and find phrases; for timing inside a scene use only `cue`, and never copy numbers from the VTT.

## Visual assets

Use `<img src="assets/image/hero.png" />` for images. For video, use `import { Video } from '@animspark/runtime'`:

```tsx
<Video src="assets/video/shot.mp4" at={1} time={[2, 5]} volume={0}
  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
```

This plays seconds 2–5 of the source video starting at second 1 of the scene. `at` defaults to 0, `time` to the whole video, `volume` to 1. If you choreograph the same original audio separately, mute the Video first. The video should fall within `durationSec`. Write masks, crops, filters and transforms directly in React/CSS/GSAP.

Set fonts by family name; do not import them. The available families and weights are in [Fonts](references/fonts.md).

For per-pixel drawing (particles, flow fields, waveforms), use a 2D canvas; see [Canvas](capabilities/canvas.md). WebGL goes only through the shared renderer of [three](capabilities/three/README.md).

## Capabilities

The engine handles these libraries differently from their native use. Read the matching page before you use one:

| The picture needs | Read |
| --- | --- |
| Per-pixel drawing such as particles, flow fields, waveforms | [Canvas](capabilities/canvas.md) |
| Real perspective, lighting, materials and occlusion | [3D (three)](capabilities/three/README.md) |
| Generative art, noise fields, large numbers of particles | [p5](capabilities/p5/README.md) |
| Collisions, falling, stacking | [Rigid-body physics (matter-js)](capabilities/matter-js/README.md) |
| Music whose beats and notes the picture locks to | [Scored music (@muspark/core)](capabilities/muspark/README.md) |
| Slicing laid-out HTML, turning it into particles, mapping it onto 3D surfaces | [HTML in canvas](capabilities/html-in-canvas/README.md) | <!-- hosts: desktop -->

## Placing it in film.json

The stage size comes from `stage` in `film.json`. For a full-frame picture, the root node fills the canvas (`inset: 0`) and is referenced in place, for example saved as `mg/energy.tsx`:

```json
{"kind":"mg","clips":[{"id":"energy","src":"mg/energy","at":0}]}
```

For titles, badges and cards, size the root node to its content, do not set `left`/`top`, and position it on the canvas with `transform.t`:

```json
{"kind":"mg","clips":[{"id":"badge","src":"mg/badge","at":2,"transform":{"t":[1480,80]}}]}
```

The host computes a clip's bounds (used for its thumbnail and for the `anim clip` export size) from the layout bounds of the root node and its descendants; a transparent full-frame root also takes the full frame. `at` is in film seconds; trim a clip with `time: [source in, source out]`.

## Acceptance

Check each item before delivering:

- **Content**: what each section makes clear, and which objects, evidence or changes express it; respect the content, duration and style the user gave; do not add subtitles or a timeline to the picture by default. For a complete film, follow [Complete film](references/film.md).
- **Change**: view a 1 fps contact sheet with `anim look --from <s> --to <s> --fps 1`. Every second or two there is a new visible change, with no unintended long still frames. When `anim look` reports a timeline that stops early, add choreography or shorten the scene. Look more densely at the seconds of each key action to confirm it really happens.
- **Frame**: lay it out for where and how the audience will watch: frame 0 is already a complete picture; the subject and the text read clearly on that screen, and the frame has no large empty areas.
- **Close-up**: at key moments, view a single frame at native resolution with `anim look --at <s>`. Small text is readable, the subject is not cut off by the frame, and fonts are not fallbacks.
- **Sound**: view the mix with `anim look --sound`. Narration is clear, music sits under the narration, sound effects land on their word anchors, and there are no unexpected silent stretches.
- **Health check**: `anim check` passes, and every warning from `anim check` and `anim look` is either fixed or kept for a reason.
