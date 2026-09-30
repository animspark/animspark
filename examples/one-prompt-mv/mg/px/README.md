# The film engine (`mg/px`), adapted from pdoom-video

`mg/px` is a port of the engine behind [pdoom-video](https://github.com/mexicat/pdoom-video) by mexicat
(MIT, see [LICENSE-pdoom-video.txt](LICENSE-pdoom-video.txt)): a WebGL2 renderer with sub-frame motion blur,
linear-HDR bloom, heat-by-age strokes, plotter type and audio-driven pulses. Its guide,
[docs/ENGINE.md](https://github.com/mexicat/pdoom-video/blob/main/docs/ENGINE.md), explains the scene API; this
file lists what changed. The plates in `mg/plates` and the edit in `mg/plates/timeline.ts` are ours.

## Layout
- `mg/px/*`: the engine. Shared by every plate.
- `mg/plates/<id>.ts`: one plate, default-exporting a `Scene` subclass. Helpers go in `mg/plates/<id>-*.ts`.
- `mg/plates/timeline.ts`: the edit.
- `mg/plates/handoff.ts`: boundary contracts, i.e. what must be on screen, and where, at each cut.
- `mg/plates/lyric.ts`: word lookups by index (`wStart`, `wEnd`, `wText`, `wProg`, `charTimes`). Word indices are in `mg/lyrics.ts`.
- The host is `mg/px-film.tsx`. It renders through our film runtime (headless Chromium).

## Differences from the reference
- `SCALE` is always 1 (1920×1080 logical = physical).
- Fonts are loaded from `assets/fonts`:
  - `F.archivo(width 62–125, weight 300/500/700/900)`: variable Archivo, instanced at widths 62/75/87.5/100/112.5/125.
  - `F.archivoItalic`.
  - `F.mono(400|500|600)`: IBM Plex Mono.
  - `F.serif(400|600)`: Cormorant **italic** only.
  - The stroke fonts are the same as the reference's.
- **No opentype.js**: `textPath2D` / `textPathCommands` / `ot()` don't exist. Other ways to get text shapes:
  - `textPoints` (raster samples).
  - Canvas2D itself.
  - For outlines, three's `FontLoader` typeface JSON: `mg/font-archivo-black.ts`, used via `mg/type3d.ts` (`font('block')`, `outlinePoints`).
- Audio (`this.ctx.audio`):
  - `beats`, `downbeats`, `beatAt`, `timeOfBeat`, `nearestBeat`.
  - `env('rms'|'low'|'mid'|'high', t)`.
  - `hit('kick'|'snare'|'hat', t, hl)`, `events(kind, t0, t1)`.
  - `melAt(t)`: 48 mel bands, 0..1, low → high.
  - Every Frame has `f.a.kick / snare / hat`, `f.beat`, `f.beatPhase`.
  - 122 BPM (beat 0.4918 s).
- Lyrics (`this.ctx.lyrics`) are built from `mg/lyrics.ts`. The display tokens are the same words.
- Assets load through XHR (`px/load.ts`); the framing page is file:// and `fetch()` fails there.
- Palette:
  - `signal #FF5A1F`, `ember #FF9A4D`, `blood #B8260E`; ink, bone, graphite and ash as in the reference.
  - `acid` is our **violet** `#8B5CFF`. It is only for "purple words" (46.7–50 s).
  - Only signal and ember may exceed ~0.85 linear. Bone type must stay crisp; the default bloom knee is 0.12.

## Checking your work
- `anim look --at 12.4` renders one full-quality frame; `anim look --from 12 --to 16 --fps 4` a contact sheet.
- `anim preview` plays the film live (one sample per frame, no motion blur); `anim render` writes the mp4.
- A plate that throws renders dark red, and the error is printed.
- Export renders every frame with adaptive motion blur (`assets/data/render.json`: 4–12 sub-frames).
  - A plate must be a **pure function of f.t**: no `Math.random`, no state.
  - Flicker keyed to frames uses `frameIdx(t)`.
  - Particles are indexed by birth time (see `px/motifs.ts sparkParticles`).
- Performance: aim under 40 ms per sub-frame; keep at most 2–3 Canvas2D layers per plate and precompute in `init()`.
