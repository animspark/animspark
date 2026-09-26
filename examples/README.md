# Examples

Four small films, each a complete workspace. Everything is drawn in code: no images and no
recorded audio. Fonts come from the font library (fetched once, then cached).

| Example | Length | Shows |
| --- | --- | --- |
| [title-card](title-card/) | 6 s | Kinetic type: masked letter reveals, wipes, a held frame that still moves, an exit |
| [on-the-beat](on-the-beat/) | 8 s | A `@muspark/core` score as the music track, with motion cued to its kicks, snares, hats, melody and chords |
| [data-chart](data-chart/) | 9 s | SVG + d3 charts: a bar chart built year by year with a synced counter, then a donut |
| [brand-card](brand-card/) | 6 s | The README banner: a seamless loop, one scene laid out for two stages |

Run any of them from its folder:

```sh
cd examples/on-the-beat
anim check            # validate film.json and compile the scene
anim look             # contact sheet at 1 fps → .anim-look/
anim render           # mp4 → .anim-out/film.mp4
anim preview          # play it in the browser, live as you edit
```

From a checkout without `anim` installed, run `node ../../packages/engine/bin/anim.mjs <command>`
inside the example folder instead.

Each folder has a `look.png`: the `anim look` contact sheet of the current version.
