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
3. Bump every package's `version` to the same number (the `workspace:*` ranges stay as they
   are — packing rewrites them) and add a `## <version>` section to `CHANGELOG.md`.
4. Push a tag `v<version>` on that commit. `.github/workflows/release.yml` checks that the
   version matches the tag, runs the tests and the smoke render again, waits for a maintainer
   to approve the `npm` environment, publishes every package and creates the GitHub release
   from the changelog section.

## How publishing is authenticated

There is no npm token. Every package trusts one publisher on npmjs.com (package → Settings →
Trusted publishing): GitHub Actions, repository `animspark/animspark`, workflow `release.yml`,
environment `npm`. npm exchanges the workflow's OIDC identity for a short-lived publish
credential and attaches a provenance statement, so each version on npm links back to the
commit and the run that built it. Package publishing access is set to require 2FA and
disallow tokens, so nothing else can publish.

The `npm` environment only accepts `v*.*.*` tags and needs a maintainer's approval; tags
matching `v*` cannot be moved or deleted (repository ruleset).

A new package has to exist before a trusted publisher can be attached to it. Add it to this
table, publish its first version by hand (`npm publish --access public` from its directory,
logged in with 2FA), attach the trusted publisher, and set its publishing access as above.

Users also need `ffmpeg` on `PATH`. The headless Chromium Playwright drives is downloaded on the
first `anim check`, `look` or `render`. playwright is pinned on purpose (it decides which
Chromium renders every frame), so a release that changes it must say so in its notes.
