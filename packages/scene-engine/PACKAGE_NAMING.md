# Package top-level design and naming conventions

This is a design record. In this repository the packages that exist are `scene-packages/stem`, `scene-packages/three`, `scene-packages/p5` and the music pair `packages/muspark` (`@muspark/core`) + `packages/muspark-ui` (`@muspark/ui`). The `data` and `document` packages and the music extensions other than `Score` and `PianoRoll` described below are not part of it.

## 1. Two classifications that must not be mixed

- **Film genres** answer "what video does the user want to make": marketing, social, education, popular science, business, celebration, creative.
- A **Package** answers "which real capability beyond the base does this video need": STEM, Music, Document, Data, Three, P5.
- An **Extension** is one stable authoring API under a Package that can be called directly and has its own docs and examples.
- **Component / Function** is how an Extension is implemented; use cases are only example tags and must not merge several APIs into a vague category.

A marketing film can use STEM's data plots or nothing but the base; a popular-science film can also use Music's sheet music. Do not invent `marketing` / `social` / `celebration` packages after the genres — those are uses, not rendering domains.

## 2. Three layers of product identity

| Layer | Responsibility | Example |
|---|---|---|
| **Developer** | The developer and publishing source of a Package, credited as `from <Developer>` | `AnimSpark` |
| **Package** | A set of real capabilities the base cannot produce reliably, imported on demand | `STEM` |
| **Extension** | One stable Component / Function API with its docs and examples | `Formula` |

The canonical id of `AnimSpark / STEM / Formula` is `animspark/stem/formula`, which maps directly to the authoring API `Formula`. In principle one Extension carries one API contract; only tightly coupled variants that users cannot choose between independently may share a row.

**The base** is the common part outside the three identity layers: available to everyone, not imported, not matched — TSX/HTML/CSS/SVG, the GSAP timeline (including `cue` word anchors), the design system and determinism protocol, and engine-level sockets such as the shared effect canvas and the Pyodide socket. The base contains no concrete components; every concrete capability (including 3D, generative art and data visualization) exists as a package.

## 2.1 Two kinds of package

| Kind | What it provides | Test | Examples |
|---|---|---|---|
| **Domain-semantics package** | Domain precision or parsing of real formats | The result must be exact (music theory, formulas, cell coordinates); hand-writing it on the base is bound to be wrong | `stem` `music` `document` `data` |
| **Engine-bridge package** | The runtime lifecycle of one rendering engine | The engine has its own canvas/clock/resources, so someone must manage determinism, seeking and export | `three` `p5` |

A Package's value must come from one of these two kinds; animation choreography still goes back to GSAP. If a component can be written better in a dozen lines of TSX/SVG, it stays hand-written on the base and does not become a package.

## 2.2 Vocabulary sponsorship

Bare npm words (such as `three`, `p5`, `d3`, `muspark`) do not belong to the base; a package **sponsors** them in the `vocabulary` field of its manifest: the word can be imported only when the package is enabled, and when the package is disabled it is a compile-time error. Rules:

- A word has exactly one sponsoring package; subpaths (such as `three/addons/**`, `d3-*`) follow the main word.
- The sponsoring package must carry a manual (`SKILL.md` at the package root): when the word should be used and the common ways of getting it wrong.
- Words that are resident in the base (general-purpose pieces such as `gsap`, `react`, `matter-js`, `roughjs`) need no sponsor. The criterion for handing a base word over to a package is "the word's correct use depends on a runtime the package manages": three needs the shared renderer, so it goes with `animspark/three`.

## 3. Official Package map

### `animspark/three` (launched, engine-bridge package)

~~Engine bridge for three.js (WebGL)~~ **Retired 2026-08-13**: films `import * as THREE from 'three'` directly and get the renderer through `useSharedRenderer()`. Previously `<Three />` took a standard setup()/update() scene, and the system managed the shared WebGLRenderer, frame-by-frame determinism, exact seeking and 4K export; it sponsors the words `three` and `three/addons/**` (the official addons enter the package by import subpath).

| Canonical Extension | Asset category | Authoring API | Capability |
|---|---|---|---|
| `animspark/three/three` | `extension-three` | `Three` | Real-time 3D: geometry, materials and lighting, particle fields and camera moves |

### `animspark/p5` (launched, engine-bridge package)

~~Engine bridge for p5.js~~ **Retired 2026-08-13**: films `import p5 from 'p5'` directly (dynamic import). Previously `<P5 />` took an instance-mode draw(p, P) illustration layer, and the system managed the canvas and the determinism of reseeding every frame; it sponsors the word `p5`.

| Canonical Extension | Asset category | Authoring API | Capability |
|---|---|---|---|
| `animspark/p5/p5` | `extension-p5` | `P5` | 2D generative art: noise flow fields, particle painting, organic texture |

### `animspark/data` (launched, domain-semantics package; not in this repository)

Data storytelling package: a narrative chart grammar, ranking evolution, flows and composition, and translating orders of magnitude; it sponsors the word `d3` (including the `d3-*` subpackages).

| Canonical Extension | Asset category | Authoring API | Capability |
|---|---|---|---|
| `animspark/data/chart` | `extension-data-chart` | `Chart` | bar/line/area/scatter/donut, layer-by-layer reveal and turning-point annotations |
| `animspark/data/race` | `extension-data-race` | `Race` | Ranking evolution (bar chart race) |
| `animspark/data/flow` | `extension-data-flow` | `Flow` | Sankey / funnel / waterfall |
| `animspark/data/scale` | `extension-data-scale` | `Scale` | Translating orders of magnitude (built-in library of reference objects) |

### `animspark/stem` (launched, domain-semantics package)

Professional visualization for Science, Technology, Engineering and Mathematics. The former `animspark/math` and `animspark/python` have been merged; the underlying technology no longer decides how the product is split into packages.
As a product it is one Package, while playback bundling still selects capability subentries by internal API: using only Formula neither bundles nor warms up Python/Pyodide; only `Mpl` / `imgproc` load the corresponding scientific runtime.

| Canonical Extension | Asset category | Authoring API | Capability |
|---|---|---|---|
| `animspark/stem/formula` | `extension-stem-formula` | `Formula` | LaTeX formulas, term-by-term morphs, multi-step derivations |
| `animspark/stem/plot` | `extension-stem-plot` | `Mpl` | Functions, statistics, signals, fields, 3D surfaces, scientific and data figures |
| `animspark/stem/image` | `extension-stem-image` | `imgproc` | Pixel-level image analysis, filtering, edges, color and remapping |
| `animspark/stem/code` | `extension-stem-code` | `CodeMorph`, `ExecutionTrace` | Changes in code structure, the executing line, variables and call stack |
| `animspark/stem/molecule` | Planned | Planned | Molecular structures, reaction equations, atom/bond highlighting |
| `animspark/stem/circuit` | Planned | Planned | Circuit diagrams, signals and engineering state |

### `animspark/music` (launched)

Music is a set of composable APIs, not grouped by use case such as "education / production / performance". One beat time base and structured Note / Chord / Tablature / Drum data drive both the picture and deterministic instrument stems; at publishing the stems are mixed into `audio.wav`. It is foreground content music, independent of any background music the user chooses; when both are present they only duck automatically and never switch each other off. Future format adapters for MIDI, MusicXML and so on only convert into the same music semantic model.

In this repository the sound side is `@muspark/core` and the views are `@muspark/ui`, which ships `Score` and `PianoRoll`; the other rows below are the planned catalog.

| Canonical Extension | Asset category | Authoring API | Capability |
|---|---|---|---|
| `animspark/music/score` | `extension-music-score` | `Score` | Staff notation, notes, durations, bars and playhead |
| `animspark/music/piano-roll` | `extension-music-piano-roll` | `PianoRoll` | Pitch, duration, velocity and a piano-roll timeline |
| `animspark/music/tablature` | `extension-music-tablature` | `Tablature` | Strings, frets, fingering and tuning |
| `animspark/music/rhythm` | `extension-music-rhythm` | `Rhythm` | Drum kit, subdivisions, accents and beat grid |
| `animspark/music/harmony` | `extension-music-harmony` | `Harmony` | Chord progressions, function, tension and resolution |
| `animspark/music/interval` | `extension-music-interval` | `Interval` | Semitone distance, frequency ratios and ear-training stages |
| `animspark/music/arrangement` | `extension-music-arrangement` | `Arrangement` | Multi-track clips, sections and instrument roles |
| `animspark/music/mixer` | `extension-music-mixer` | `Mixer` | Levels, gain, pan, mute, solo, automation and effects |
| `animspark/music/instrument` | `extension-music-instrument` | `Instrument` | Keyboards, string fingerboards, drum pads and playing feedback |
| `animspark/music/timbre` | `extension-music-timbre` | `Timbre` | Waveforms, harmonics, envelopes and timbre comparison |

The usage model has three steps: 1) declare one `Score` (`bpm`, `durationBeats`, `channels: [{ id, instrument, notes?/chords?/tablature?, gainDb?, pan?, mute?, solo?, automation?, effects? }]`, drum channels with `hits`) and put it in a scene's `sounds` as `{ id, kind: 'music', score, at }`, or on a film audio track as a module that default-exports it; 2) every view component receives the same `score` (choose a channel with `channel`) and derives its picture from the event list itself; 3) drive each view's `progress` in source beats from the same clock, using `cue(music, …)` from `@animspark/runtime` for the music's time window and note events. No component keeps a second copy of visual data, and the music's `at` shares its time base with the narration's `cue` anchors.

Deterministic instruments cover piano, electric-piano, organ, guitar, bass, violin, cello, strings, brass, saxophone, clarinet, flute, marimba, pluck, bell, synth-pad, synth-lead, synth-bass, choir; drums cover kick, snare, closed/open hat, clap, tom, ride, crash, shaker. Output is rendered as stereo PCM, with per-channel pan, gain automation, soft drive, beat-synced delay and short-reflection reverb. The picture and the synthesizer are computed from the same `bpm`/beat event list; hand-writing an approximate duration separately is forbidden.

Ordinary decorative spectra, lyrics and scaling on the beat still belong to hand-writing on the base; use Music only when the semantics of pitch, duration, string position, rhythm, orchestration or harmony must be exact.

### `animspark/document` (launched; not in this repository)

For business, marketing, training and review workflows. In the hosted product, uploaded CSV/XLSX, PPTX and DOCX files pass size, extension and ZIP-expansion safety checks, and a server-side parser produces restricted props the components can use directly. The parser keeps cells/formulas, slide order and shape coordinates, and heading/paragraph/page-break structure, then maps them onto four Extensions.

| Canonical Extension | Asset category | Authoring API | Capability |
|---|---|---|---|
| `animspark/document/spreadsheet` | `extension-document-spreadsheet` | `Spreadsheet` | Cells, formulas, ranges, filters and data changes |
| `animspark/document/slides` | `extension-document-slides` | `Slides` | Page order, thumbnail rail, heading hierarchy and presentation narrative |
| `animspark/document/pages` | `extension-document-pages` | `Pages` | Headings, paragraphs, page breaks, footers and review comments |
| `animspark/document/document-diff` | `extension-document-diff` | `DocumentDiff` | Insertions, deletions, replacements and item-by-item review |

If all you need is to draw a table, a card or a few posters, keep hand-writing it on the base; use Document only when the real document structure and version semantics must be preserved.

### Candidates: `animspark/geo`, `animspark/character`

Geo becomes a package only if it supports CRS, GeoJSON, tiles and real geographic coordinates; ordinary world maps stay hand-written on the base. Character becomes a package only if it supports Live2D/Spine/skeletal assets and automatic lip sync; hand-written SVG characters stay on the base. Candidates are not shown in advance as empty packages.

## 4. Naming

- npm package: `@<scope>/<package>`, for example `@animspark/stem`.
- Runtime package name: `<scope>/<package>`, for example `animspark/stem`.
- Developer source: manifest `developer: { id, name }`, credited as `from AnimSpark`.
- Canonical Extension: `<developer>/<package>/<extension>`, for example `animspark/stem/code`.
- Extension category: `extension-<package>-<extension>`, for example `extension-stem-plot`; an engine-bridge package with a single Extension drops the repeated segment, for example `extension-three` (not `extension-three-three`).
- Example asset ids keep describing the content and are not forced to include the package name, for example `extension-chord-anatomy`.
- In meta, `components` holds full paths, for example `animspark/stem/mpl`.

## 5. Hard rules

- Use `animspark/stem/mpl` for exact mathematical/scientific figures; hand-write simple bar comparisons or flow boxes directly on the base.
- Use `animspark/stem/formula` for formulas; plain text numbers do not call Formula.
- Use `animspark/stem/imgproc` for pixel analysis; pure CSS filters and visual texture stay on the base.
- Semantic code animation belongs to `animspark/stem/code`; ordinary terminal windows, static code cards and typing effects stay on the base.
- GSAP is the only choreography driver of the base and does not become a package; `react` is only a JSX shim and does not become a package.
- Bare npm words enter the author scope only through vocabulary sponsorship; one word, one sponsoring package, and the word goes away when the package does.
- Engine-bridge packages do not reinvent the authoring API: what you write inside `<Three />` is standard three.js and inside `<P5 />` standard p5 — the package only manages the lifecycle (canvas, clock, determinism, seeking, export) and invents no new dialect.
- By default an Extension must map one-to-one to a stable Component / Function API and have both its own docs and examples; a use case cannot serve as an Extension name.
- Packages are not planned by revenue share; revenue comes from the same professional capability being reused across genres.
- A new **domain-semantics package** must plan at least three independently understandable Extensions, and have both shared professional semantics / real formats and reuse value across paid scenarios; an **engine-bridge package** may have a single Extension but must really manage an engine's runtime lifecycle.
- A new Package ships only with all of: an implementation, authoring docs (a `SKILL.md` the agent can read), and at least one finished film for a corresponding Extension.

## 6. Repository and manifest conventions

Each Package is one independently packable directory (currently `scene-packages/<name>`; as open source, each can become its own repository). The manifest goes in the `animspark` field of `package.json`:

| Field | Required | Meaning |
|---|---|---|
| `scenePackage: true` | ✓ | Declares a scene package; the host discovers it by this |
| `developer: { id, name }` | ✓ | Publishing source, credited as `from <name>` |
| `packageName` | ✓ | Runtime package name `<scope>/<package>` |
| `tagline` / `whenToUse` / `keywords` | ✓ | One sentence and criteria for prompts and retrieval |
| `components` | ✓ | The authoring API names provided (lowercase), matching the registry registration |
| `extensions` | ✓ | Extension list: title / tagline / components |
| `playbackByCapability` | As needed | capability → playback subentry (tree-shaking boundary) |
| `vocabulary` | As needed | Bare npm words it sponsors (see 2.2) |
| `engine` | ✓ | Compatible scene-engine version range (semver range) |

Quality gate (all must pass before shipping): `typecheck`, `test` (including SSR placeholder rendering outside the browser), determinism checks (the same seed gives pixel-identical frames, and any seek matches sequential playback), a `SKILL.md` at the package root, and at least one finished film for an Extension. Package code depends only on the public entries of `@animspark/scene-engine` (core / playback) and must not import internal modules of the host (engine).
