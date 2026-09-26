# Working on this repository

Instructions for coding agents (and people) changing the AnimSpark engine itself. To *make films*
with it, use `anim new` — every workspace gets its own manual.

## Layout

- `packages/engine` — the `anim` CLI (`src/film/oss-bin.ts` is the entry), preview player
  (`src/preview`, served by `src/film/oss-preview.ts`), MCP server (`src/mcp`), cloud providers
  (`src/cloud`), the agent manual and skills (`prompts/`).
- `packages/film-build` (evaluate, compile, check, mixdown), `packages/film-runtime` (what scenes
  import), `packages/core` (the `film.json` contract), `packages/player`, `packages/scene-engine`,
  `packages/muspark*`, `scene-packages/*` (stem, three, p5).
- `examples/` — complete films; each must pass `anim check`.

TypeScript runs through tsx; there is no build step.

## Commands

```sh
pnpm install
pnpm --dir packages/engine exec playwright install chromium   # once
node packages/engine/bin/anim.mjs --help                       # the CLI from source
pnpm test                                                      # unit tests
pnpm smoke                                                     # new → check → look → render, asserts the mp4
pnpm examples                                                  # anim check on every example
npx tsc --noEmit -p packages/engine                            # type check (must stay at 0 errors)
sh scripts/pack-smoke.sh                                       # pack, install outside the repo, run it
```

Run `pnpm test`, `pnpm smoke` and the type check before you finish a change.

## Rules

- Every frame is a pure function of time. Anything that makes rendering depend on wall-clock
  time, randomness without a seed, or network timing is a bug.
- What `anim preview` shows, `anim look` shows and `anim render` writes must be the same picture.
- English everywhere: code, comments, messages, docs. Chinese appears only where it is content
  (CJK font names, CJK punctuation tables, Chinese caption line-breaking).
- No hosted-service code: nothing about accounts, billing, buckets or internal endpoints. Cloud
  features go through `src/cloud` and the public API only.
- Skills (`packages/engine/prompts/skills`) change only with evidence from real films — see
  "Shipping bar" in `prompts/skills/README.md`.
- `playwright` is pinned: it decides which Chromium renders every frame. Upgrade it deliberately.
