# Skill package conventions

Each skill is a directory. `SKILL.md` is the entry point and `catalog.json` holds metadata. A short skill is written entirely in `SKILL.md`, with no subdirectories; only a skill too large to read in one go, whose parts are needed for different tasks, splits out `APIs/`, `references/` or `refs/`.

The engine ships these skills; `anim new` installs all of them into `skills/animspark/` in every workspace and lists them at the end of the workspace's CLAUDE.md / AGENTS.md:

| Skill | type | What it is |
| --- | --- | --- |
| `mg` | `foundation` | The scene contract: how MG components under `mg/` are written, timed and checked. Every film uses it. Holds the film method (`references/film.md`), a complete example film (`example/`) and the capabilities below. |
| `video-editing` | `foundation` | Editing real footage: cutting on speech, pacing, captions, b-roll over a talking head. |
| `formula` | `component` | LaTeX equations, and derivations animated term by term (`@animspark/stem`). |
| `sciplot` | `component` | Scientific plots computed with matplotlib in the browser (`@animspark/stem`). |
| `code-explainer` | `component` | Code that morphs between versions and traces its own execution (`@animspark/stem`). |
| `map` | `component` | World and country maps from real geography: projections, routes, a turning globe (d3-geo, world-atlas). |

A skill ships only when it has been validated on real films — installing it must make an agent's films measurably better on a class of real tasks. Genre prompts that only describe a kind of film ("how to make a product promo") do not qualify; style skills are distilled from a set of finished films and ship those films as their examples.

## Types

`catalog.json`'s `type` decides how a skill reaches the workspace (see `localWorkspaceSkills` in `src/scene/skill-catalog.ts`; a local workspace gets every shipped skill):

| type | What it is |
| --- | --- |
| `foundation` | A contract every film needs (mg, video-editing) |
| `style` | What a film looks like: a method and a kit of parts distilled from finished example films |
| `component` | One on-screen element the model cannot draw well on its own, fed with structured data (formula, sciplot, code-explainer, map, @muspark/ui) |

A component that another skill requires is written to disk but not listed; the agent finds it by following the links in the skill that requires it (the installed SKILL.md carries `metadata.required-by`).

## mg capabilities

Some libraries work differently inside an MG scene than they do natively (a shared renderer, simulate-then-replay, audio mixed by the host…). These are documented as mg `capabilities/`, not as separate skills: they are only used inside MG scenes and the "Capabilities" table in mg's SKILL.md routes to them.

| Directory | Contents |
| --- | --- |
| `capabilities/canvas.md` | 2D canvas: redraw every frame, bitmap size, loading images and fonts |
| `capabilities/three/` | 3D scenes on the shared renderer |
| `capabilities/p5/` | Generative art, instance mode, dynamic import |
| `capabilities/matter-js/` | Rigid-body physics: precompute, then replay by time |
| `capabilities/muspark/` | Playable scores (@muspark/core); picture aligned to notes |
| `capabilities/html-in-canvas/` | HTML rendered to a bitmap; only installed on the `desktop` host (catalog `hostPaths`) |

A line that only applies to some hosts ends with `<!-- hosts: desktop -->`; the installer drops that line on other hosts. `hostPaths` in catalog.json restricts a whole subdirectory to the hosts listed. Old skill ids (@animspark/three, @muspark/core, @animspark/awesome-mg…) are listed in mg's `animspark-id` so old workspaces migrate to mg.

A library is not a skill by itself; a style made with a library can be. When all a library needs is one sentence ("pass a seed"), that sentence goes into mg's timing rules.

## Layout

```text
skill/
├── SKILL.md
├── catalog.json
├── APIs/Component.md
└── references/example.md
```

`SKILL.md`'s YAML frontmatter holds only `name` and `description`. `name` may be the full `@namespace/name`; for a short name the namespace comes from catalog.json. The installer generates the `files` tree from the real resources; do not write a file list by hand.

A component's API is written in its `SKILL.md`; only when it has many exports and a lot of text is it split into `APIs/<Component>.md` by export name. Each component gives the exact parameters, data shapes, progress semantics, limits and one self-contained example component. The base scene contract belongs to @animspark/mg and the method for complete films to mg's `references/film.md`; a dependent package declares `requires` instead of repeating `durationSec`, `sounds` and the clock rules. Method and style skills describe decisions and examples in on-demand references and never invent APIs.

Scene source lives in the project's `mg/`, with paths chosen by content; the edit is decided by film.json alone. Narration, sound effects and section music belong to a scene's `sounds` and are aligned with `cue` / `duration`. Film-wide music can be a Score module referenced on an audio track.

catalog.json example:

```json
{"namespace":"animspark","audience":"mg","type":"film","category":"marketing","title":"Product Promo","tagline":"Launch, promo and demo films built from your real product and facts.","requires":"@animspark/mg"}
```

- `category` is one of `SKILL_CATEGORIES`: basics, marketing, explainer, business, editing, creative, audio. Pick it by what the film is for, not by the technology used.
- `hosts` is `desktop` or `web`; the skill is only listed, installable and announced on those hosts. Omitted means available everywhere.
- `requires` is a comma-separated list of skill ids: real dependencies only, no cycles.
- `animspark-id` lists former ids (after a rename or merge), comma-separated; they are only used to recognize old workspaces.
- `title` / `tagline` are short English display strings.

The agent only reads the manuals installed in the workspace. `skills/` is not compiled; to use example code, copy it into the project.

`APIs/`, `references/`, `example/`, `refs/`, `scripts/`, `assets/`, `agents/` and a LICENSE are installed with the skill. The main document links to resources with relative links, and resources link relative to their own file; every required document must be reachable from the entry point. Do not create empty directories or placeholder files. `cover.jpg` and `catalog.json` are not installed into workspaces.

## Writing guidelines

The reader of a skill is an agent at work. It meets a skill at four moments: **discovery** (it sees only the description), **onboarding** (it reads SKILL.md once), **execution** (it copies an example, looks up a section) and **delivery** (it goes through the acceptance checks). Each part serves one of these moments; when a skill fails, one of them was usually neglected.

1. **Write only what differs from the model's priors.** Delete a sentence and ask whether an engineer who knows React, GSAP or music theory would now get it wrong. If not, leave it deleted. What belongs here is where this engine differs (the host owns the clock, two-phase execution, the shared WebGL renderer), real values (mix levels, beats-to-seconds) and our defaults.
2. **The first code block is the template and must obey every rule in the file.** Models copy examples rather than memorize rules; when an example contradicts a rule, the example wins. Write examples complete and runnable.
3. **Keep contract, method and reference apart.** Contract: one sentence of what to do, a short clause of why, and the visible signal when it goes wrong. Method: steps, each with an output and a self-check question. Reference: tables in separate files, looked up per task. Mixed together, models treat advice as rules and rules as advice.
4. **The description states the trigger and the boundary:** what it does, when to read it, what it is not for. It is the model's only basis for deciding whether to read the skill, so the routing sentence goes here, not at the end of the body.
5. **Give defaults, not menus.** One default instrument, one default level, one default pattern, then say which table to consult to change it. Long lists invite arbitrary picks.
6. **One name per concept, and it is the name used in code and commands.** Write the command names the agent actually runs (`anim look`, `anim check`, `anim audio tts`) and the real export names; do not alternate between MG, scene, segment and clip.
7. **Rules need an observable criterion, ideally one the tools report.** "Density has a hierarchy" cannot be checked; "a new visible change every second or two on the contact sheet" can. For a rule that `anim check` or `anim look` already reports, "check warns about this" is enough.
8. **Put a rule at the earliest layer that can stop the mistake:** first the runtime making the native pattern just work; then an error message that says how to fix it; then a check / look warning; then the example; only last a sentence in a manual. Write each rule once and point to it elsewhere; a rule written in five places drifts five ways.
9. **Let failures drive changes.** Collect real sessions, classify the failures (not read, read but not followed, misunderstood, engine difference, not checkable), fix at the cheapest durable layer, and re-run. Delete rules no failure supports.
10. **Teach judgment, not finished products.** The point of an agent is to design for this user and this subject; two different films that look alike for no reason are a template. Only the contract, the constraints this kind of film must hold and the acceptance checks are fixed; the design system is derived from the subject for each film (step 1 of mg's `references/film.md`). Give several, clearly different examples and say why each choice was made.

## Suggested structure

The format is not mandatory, but skills of the same kind follow the same order so readers know where to look:

- **Contract** (@animspark/mg): a one-sentence mental model → the default pattern (complete and runnable) → rules (what, why, failure signal) → interface details → acceptance checks.
- **Library** (mg capabilities, component skills such as formula or map): when to use, when not → a minimal complete example → a table of limits that differ from common knowledge → routes by task to `APIs/`.
- **Method** (mg's `references/film.md`): when to use → steps (purpose, output, self-check) → principles (each with a one-line example from a different subject) → worked example → common failures. Keep the concrete look of the example in `references/` or `example/` and the method in the body; if you keep having to say "learn the method, do not copy the look", the example is overpowering the method.
- **Brief** (film types): when to use, when not → what to confirm before starting (ask only when missing it would change the result) → hard constraints (with the visible signal of a violation) → decisions derived from the material and the occasion → techniques specific to this kind of film → specific acceptance checks → common failures. Point to mg's film method for the general process instead of repeating it; no storyboard templates.
- **Style** (e.g. an evidence-collage explainer): the finished films come first — several example films on different subjects in `refs/` (full source and asset index), which is what people see → what this kind of film looks like (the elements on screen, how they are made, which parts make them) → the steps → composition and motion principles → the kit and the skeleton of one scene → acceptance checks. `kit/` holds copyable parts distilled from the example films, which were themselves made with it; copy the whole directory into the project's `mg/kit/` and adapt it.

## Shipping bar: a skill not validated on real tasks does not exist

A skill has one measure of value: **with it installed, an agent's films on a class of real tasks are clearly better than without it**, better in ways that can be named. A page of prompt text on "how to make an X film" does not count — the model already knows what a promo or a talking-head video is, and such a manual does not change the result. Style and genre skills are distilled from a set of well-made finished films (code, components, sound and process); people see the films first and want the same for their own content. A skill with only text and no film to show for it is not shipped.

Before a skill enters `prompts/skills` it needs:

1. **A task set**: real tasks of this kind with real material (not synthetic test cards), with acceptance criteria — which are machine-checked (length, aspect, material actually used, captions aligned with speech …) and which need watching (written as concrete observable items). Hold some tasks back for the final check only.
2. **A baseline**: run the same tasks with only the foundations (mg, video-editing) and record exactly where they fail.
3. **A comparison**: run them again with the skill installed; the failures are fixed and the held-back tasks pass too.
4. **Evidence**: a `validation.md` in the skill directory with the tasks, material sources, baseline and comparison results, the date, and where the films or contact sheets are.

Sort failures before fixing them: the model does not know the engine's way of doing something → the foundations (mg / video-editing); a missing capability (detection, tracking, alignment …) → a tool or engine feature; missing taste and look → only then the skill's job, and with examples and material, not adjectives.

Drafts live outside the repository; point `ANIMSPARK_EXTRA_SKILLS_DIR` at one to install it into a workspace and test it; move it in once it passes.

## Verification

Documents must match the source, especially defaults, discrete vs continuous progress, import paths and command names. Numeric examples may express design choices but must be distinguishable from interface defaults. When a manual is retired, remove its directory and every reference to it.

Test behavior and invariants, not wording: examples run, retired APIs do not appear, links resolve. Do not lock the text sentence by sentence; that turns a manual into keyword stuffing for tests. To check an example film, copy it into a workspace made with `anim new`, supply its media and run `anim check`.
