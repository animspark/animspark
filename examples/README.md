# Examples

Finished films made with AnimSpark, each a complete workspace you can open, play, change and render. More are on
the way: we keep open-sourcing the best AnimSpark films here as they are made, source and all.

| Example | Length | Shows |
| --- | --- | --- |
| [one-prompt-mv](one-prompt-mv/) | 91 s | The AnimSpark launch music video: a WebGL2 engine with motion blur, nineteen shots cut on the song's beats |

## Watch one live

You need **Node.js 22+** and **ffmpeg** on your `PATH`, and a browser with WebGL2 (any current Chrome, Edge, Safari
or Firefox).

```bash
git clone https://github.com/animspark/animspark.git
cd animspark/examples/one-prompt-mv
npx animspark preview
```

`preview` serves the film at a local address and opens it in your browser: the viewer, a transport and the
timeline. It plays in real time. Leave it running and edit any file in the folder, for example a shot in
`mg/plates/`: the picture, sound and timeline update on every save, and compile or runtime errors show on the
page. Press Ctrl-C in the terminal to stop.

To keep the `anim` command around instead of going through `npx` each time:

```bash
npm install -g animspark
anim preview                  # the same live player
anim check                    # validate film.json and compile every scene
anim look --at 33             # one full-quality frame → .anim-look/
anim render                   # the finished mp4 → .anim-out/film.mp4
```

The first `check`, `look` or `render` downloads the headless Chromium that frames are drawn with (via Playwright,
about 100 MB, once).

## Change it with your agent

Each example is plain files, so a coding agent can work on it directly. Open the folder in Claude Code, Codex or
Cursor and ask for a change ("make the chorus colder", "hold the city shot a beat longer"). The agent edits the
code, checks its work with `anim check` and `anim look`, and the running preview shows the result.

Each folder has a `look.png`: the `anim look` contact sheet of the current version.
