# Releasing

## What is published

| npm package | from | what it is |
| --- | --- | --- |
| `animspark` | packages/engine | the CLI; `npm install -g animspark` gives you `anim` |
| `@animspark/core` | packages/core | the film format: `film.json` types and parsing |
| `@animspark/runtime` | packages/film-runtime | the React runtime films import (`cue`, `useStage`, `Video` …) |
| `@animspark/film-build` | packages/film-build | evaluation, bundling, mixing, checks |
| `@animspark/player` | packages/player | play a film in the browser |
| `@animspark/scene-engine` | packages/scene-engine | scene-package contracts and playback primitives |
| `@animspark/stem`, `@animspark/three`, `@animspark/p5` | scene-packages/* | scene packages films import (formulas, code, scientific plots; 3D; generative art) |
| `@muspark/core`, `@muspark/ui` | packages/muspark, packages/muspark-ui | the music engine and its score views |

**Decision:** the CLI is the unscoped `animspark` package with the `anim` bin, because that
is what people type (`npm i -g animspark`, `npx animspark`). Everything a film or another
tool imports is a scoped library under `@animspark/*`. The music engine keeps its
`@muspark/*` names because films already import `@muspark/core` and the skills teach that
name. On npm, `@animspark` is the scope of the `animspark` account and `@muspark` belongs to the
`muspark` organization; the unscoped `animspark` name is claimed by the first publish.

All packages are versioned together (currently 0.1.0) and licensed Apache-2.0; each ships
its own `LICENSE`, and `animspark` also ships `NOTICE`.

## How the packages run

There is no compile step. Packages ship their TypeScript sources and `animspark`'s bin
registers tsx at start-up (`packages/engine/bin/anim.mjs`), pointing it at the package's
own `tsconfig.json`. Everything read at run time is inside a package's `files`: prompts and
skills, vendored fonts and their licenses, `font-versions.json`, `client-compile.js`, and
the scene packages' SKILL.md / APIs / cover images.

Nothing resolves through the repository layout. Files are found relative to their own
package, and other packages through Node's resolver from the CLI package
(`packages/engine/src/package-root.ts`). Films' bare imports (three, d3-*, world-atlas,
`@muspark/core` …) resolve from the CLI package's node_modules chain, registered at
start-up (`addLibRoot` in `@animspark/film-build`).

## Where the code comes from

Most of the engine is developed in the private AnimSpark monorepo and exported here by
`scripts/oss/export.mjs` in that repository. The export copies the files listed in its
manifest onto this repository's `upstream` branch (pure copies, one commit per sync) and merges
that branch into `main`: changes made here — translations, local-only replacements, fixes —
survive, and upstream changes flow in. Everything the manifest does not list is owned by this
repository (the CLI entry, `cloud/`, `mcp/`, `preview/`, the player, docs, CI, examples) and is
never overwritten. A hygiene scan (no billing, secrets or internal endpoints) runs on every
sync. Fixes to exported files are welcome here; they are carried upstream so the next sync
does not conflict.

## Checklist

1. `pnpm install --frozen-lockfile && pnpm test && pnpm smoke && pnpm examples`.
2. `sh scripts/pack-smoke.sh` — packs every package (`pnpm -r pack` turns `workspace:*` into
   the real version), installs the tarballs with npm in an empty directory outside the
   repository, and runs the smoke test against that installed `anim`.
3. Bump every package's `version` to the same number (and the `workspace:*` ranges stay as
   they are — pnpm rewrites them on publish).
4. `pnpm -r publish --access public` (from a clean tree, logged in to npm with rights on
   the `animspark` package and the `@animspark` / `@muspark` scopes).
5. Tag the commit `v<version>`.

Users also need `ffmpeg` on `PATH` and Chromium for Playwright
(`npx playwright@1.61.1 install chromium`); playwright is pinned on purpose, so a release
that changes it must say so in its notes.
