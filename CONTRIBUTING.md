# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

## Setup

- Node 22 or newer (`.nvmrc`), pnpm (the version in `package.json` → `packageManager`;
  `corepack enable` picks it up), and `ffmpeg` / `ffprobe` on your `PATH`.
- Chromium for Playwright, matching the pinned version:

```sh
git clone https://github.com/animspark/animspark.git
cd animspark
pnpm install
pnpm --dir packages/engine exec playwright install chromium
```

## Run the CLI from source

The engine ships as TypeScript run through tsx, so there is no build step:

```sh
node packages/engine/bin/anim.mjs new "A title card" --sec 6 --dir /tmp/demo
cd /tmp/demo/code
node /path/to/repo/packages/engine/bin/anim.mjs check
```

`pnpm anim <command>` does the same from the repository root. Set `ANIMSPARK_HOME` to keep
the engine's caches somewhere other than `~/.cache/animspark`.

## Where the code comes from

Most of the engine is developed in AnimSpark's main repository and exported here (see
[docs/releasing.md](docs/releasing.md)). Pull requests against any file are welcome; changes to
exported files are carried back upstream, so the next export keeps them.

## Tests

```sh
pnpm test        # unit tests in every package that has them
pnpm smoke       # new → check → look → render a tiny film, assert frames and audio
pnpm examples    # anim check every film under examples/
sh scripts/pack-smoke.sh   # pack all packages, npm-install them outside the repo, run smoke
```

CI runs the first three plus the packaging test on every push and pull request.

## Guidelines

- Keep the engine local: no accounts, telemetry or network calls beyond fetching public
  packages, fonts and the soundfont the NOTICE lists.
- Keep bundles' third-party license comments (`legalComments: 'eof'`).
- Resolve files and dependencies through package resolution (see
  `packages/engine/src/package-root.ts`), never through the repository layout, so the code
  works from an npm install.
- New dependencies need a reason in the pull request; check their license is compatible
  with Apache-2.0 and add them to NOTICE if we redistribute them.

## License

By contributing you agree that your contributions are licensed under the Apache License 2.0
(see LICENSE). We do not require a CLA or DCO sign-off.
