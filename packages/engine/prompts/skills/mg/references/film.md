# Complete film

This is the method for making a complete MG film, and also a worked lesson in the engine's capabilities (the scene contract is in [SKILL.md](../SKILL.md)): from a one-sentence request to a film people want to watch to the end. Each step gives the general practice first, then points to the matching source file in [On Cue](../example/film.json). On Cue is a 115-second film made with this method. AnimSpark's four terms, stage, scene, cue and track, are borrowed from the theatre, and On Cue carries out each mechanism for real inside a theatre, which is why it looks like a theatre. When you change the subject, you replace the picture; the method stays.

## When to use

A complete multi-scene film with narration: explainers, science, products, company profiles. You do not need this page to make a single card or title or to change one thing; SKILL.md is enough.

## Steps

1. **Brief.** Derive the visuals from the subject: who watches and in what setting, what exists in the subject's own world, and where the palette, lighting and information forms come from ([six questions and samples for five subjects](register.md)). Output: a brief comment at the top of theme.ts, and a single palette and set of fonts. Self-check: is this what a professional studio would deliver to this client as a sample?
2. **Script.** First settle the question the audience needs to understand, then break it into beats. For each beat write `see` (what visible change happens), `understand` (what that makes clear) and `next` (where the next beat picks up). Write narration to be cued: short sentences, name the object before it acts, and make each anchor phrase unique in its sentence. Output: a script data table and the narration text ([data/script.ts](../example/mg/on-cue/data/script.ts)). Self-check: can you write a `see` for every beat? Delete the beats where you cannot.
3. **Assets.** Narration in a single voice, fonts chosen by role, sound effects prompted from the picture; run independent requests in parallel (commands and the no-account path are in [project.md](project.md)). Output: assets/ and the measured durations and attacks in index.jsonl. Self-check: does every sound effect have the word it is meant to land on?
4. **First frame.** Get one representative frame fully right first, then extract the theme, components and objects from it, rather than designing a system up front and applying it ([01-stage](../example/mg/on-cue/scenes/01-stage.tsx)). Output: a scene you can inspect at native resolution with `anim look --at <s>`. Self-check: up close, do the type, materials and layering hold up?
5. **Scenes.** One timeline per scene, with every anchor coming from `cue`. Each anchor carries one chain of cause and effect: anticipation, hit, follow-through. Scenes agree on handoff positions. Output: the scenes and shared components under mg/. Self-check: on the contact sheet, is there a new visible change every second or two?
6. **Sound and layout.** Trim sound effects to their attack, and lead the picture about 30 ms ahead of the sound; the eye reads that as simultaneous. Music for the whole film is data, and its section starts come from the cut points. Lay out the film by placing scenes end to end using each scene's measured `durationSec`; do not fill in times by hand. Output: film.json. Self-check: in the `anim look --sound` mix, is the narration clear throughout?
7. **Acceptance.** Go through the acceptance checklist at the end of SKILL.md item by item. After that, for each change, re-check only the seconds it affects.

One anchor carries one chain of cause and effect. This is how On Cue's [05-cue](../example/mg/on-cue/scenes/05-cue.tsx) writes it on "go":

```tsx
const at = go - SYNC_LEAD;
tl.to('.oc-cuelight', { '--red': 0, '--green': 1, duration: 0.04 }, at);        // cue light turns green
tween(tl, lx12, { on: 1.45, radius: lx12.radius * 1.25, duration: 0.06 }, at);  // spotlight at full
tl.to('.oc-hung-cue .oc-mq-letter', { '--lit': 1, duration: 0.05 }, at);       // CUE lights up
tl.to('.oc-crate-hop', { y: -34, duration: 0.24 }, at - 0.24);                  // crate takes off early
tl.to('.oc-crate-hop', { y: 0, duration: 0.22, ease: 'power3.in' }, at);       // lands on the word
```

## Principles

- **When you explain a capability, make it happen.** When On Cue explains the cue, it actually calls a cue; when a product film explains battery life, a progress bar actually runs to the end.
- **One world, one camera.** Everything lives in the same coordinate system, and the camera moves because the narration needs to look somewhere else. Compute camera stops from the rectangle of the object to look at ([camera.ts](../example/mg/on-cue/lib/camera.ts) `framing`); do not fill them in by hand. In a data report, this is a push-in on the same canvas.
- **Density has a hierarchy.** The subject shows what happens in this beat, supporting elements show how it happens, and the atmosphere layer makes the place believable. Set quantities by what understanding requires; there is no universal minimum. On Cue's atmosphere is fog and wood grain; a company film's atmosphere is a clean grid and real interfaces.
- **Motion has character.** Real movement has anticipation, travel and settle ([04-blocking](../example/mg/on-cue/scenes/04-blocking.tsx)). A flat hung on a rope bounces a little; in a company film, a number rolling into place overshoots a little.
- **Reuse objects and their relationships.** The same set of pieces, arranged differently, never redrawn ([Set.tsx](../example/mg/on-cue/components/Set.tsx)); in a data film, the same metric uses the same kind of graphic throughout.
- **Each beat catches the previous one.** At the end of a scene the camera travels to the next scene's starting position, and the next scene starts from the same pose at second 0 ([theme.ts](../example/mg/on-cue/theme.ts) `handoff`).
- **Music is data the picture can read.** The same notes both make sound and drive the picture ([07-track](../example/mg/on-cue/scenes/07-track.tsx); see @muspark/core for how to write it).

## On Cue source map

| To see | File |
| --- | --- |
| Word anchors and word chips for a whole sentence | [scenes/05-cue.tsx](../example/mg/on-cue/scenes/05-cue.tsx), [lib/words.ts](../example/mg/on-cue/lib/words.ts) |
| Attack alignment, consecutive hits and scene length | [sound.ts](../example/mg/on-cue/sound.ts) |
| Light and the three canvas layers | [lib/rig.ts](../example/mg/on-cue/lib/rig.ts), [components/Theatre.tsx](../example/mg/on-cue/components/Theatre.tsx) |
| Materials that hold up close | [lib/paint.ts](../example/mg/on-cue/lib/paint.ts) |
| The one thing that stays still during a scene change | [scenes/06-change.tsx](../example/mg/on-cue/scenes/06-change.tsx) |
| Film-wide music and cut points | [music/score.ts](../example/mg/on-cue/music/score.ts), [data/cuts.ts](../example/mg/on-cue/data/cuts.ts) |
| Measured asset values | [assets/index.jsonl](../example/assets/index.jsonl) |
| Project structure, getting assets, layout and running the film | [project.md](project.md) |

## Common failures

- Treating On Cue's look as a style: dark stage, spotlights, paper cards and wooden floors in a subject that is not theatre (full list in [register.md](register.md)).
- Choreography crammed into the first two seconds of each scene, followed by still frames; `anim look` reports scenes whose timeline stops early.
- Anchors on short words that also match elsewhere: 05 uses `'Lights twelve'` rather than `'Lights'`, because the latter also matches "light, sound".
- Deriving scene length backward from the target duration, instead of from the latest sound or action plus a breath.
