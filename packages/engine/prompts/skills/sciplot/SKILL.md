---
name: sciplot
description: "Plot real scientific figures with Python, NumPy and matplotlib inside MG scenes, driven frame by frame."
---

Draw scientific figures with real Python / NumPy / matplotlib: functions, statistics, signals, fields, 3D surfaces. Import `Mpl` from `@animspark/stem`.

Use it when the numbers must be right. The figure's colors and fonts follow the film (that figure's `RC` and `STYLE`); do not leave matplotlib's default look.

## Mpl

Embeds a real matplotlib figure in React. Python draws on an Axes provided by the host, and the JS props arrive as the dictionary `P`; numerical work can use NumPy and the available scientific libraries.

### Example: a sweeping spectrum

Put it in a container with an explicit width and height; the component fills the container. Keep the initial data and the Python source at module top level; the animation changes only `sweep`.

```tsx
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Mpl, type StemHandle } from '@animspark/stem';

const signal = { frequencies: [1, 3, 5], amplitudes: [1, 0.55, 0.28] };
const CODE = `
def init(ax, P):
    ax.set_xlim(0.5, 5.5)
    ax.set_ylim(0, 1.15)
    ax.set_xlabel("Frequency (Hz)")
    ax.set_ylabel("Amplitude")
    ax.set_xticks(range(1, 6))
    bars = ax.bar(range(1, 6), [0] * 5, width=0.6, color="#5eb0ff")
    cursor = ax.axvline(0.5, color="#ffb45e", lw=2)
    return {"bars": list(bars), "cursor": cursor}

def update(P, artists):
    f = 0.5 + 5 * P["sweep"]
    artists["cursor"].set_xdata([f, f])
    data = P["signal"]
    amplitudes = dict(zip(data["frequencies"], data["amplitudes"]))
    for frequency, bar in enumerate(artists["bars"], start=1):
        reveal = np.clip(f - frequency + 0.5, 0, 1)
        bar.set_height(amplitudes.get(frequency, 0) * reveal)
`;

export function Example() {
  const plot = useRef<StemHandle>(null);
  useGSAP(() => {
    const h = plot.current!;
    gsap.to(h.P, {
      sweep: 1, duration: 3.2, ease: 'none', onUpdate: h.render,
    });
  });
  return <Mpl ref={plot} code={CODE} blit sweep={0} signal={signal} />;
}
```

### Props and Python entry points

```tsx
<Mpl ref={plot} code={CODE} blit={true} progress={0} data={data} />
```

| Prop | Meaning |
| --- | --- |
| `code: string` | Python source; it must define the two functions below. |
| `blit?: boolean` | Default `false`. Set `true` when the background is fixed and only the dynamic artists are redrawn. |
| Any other custom prop | Passed as a JSON value into the Python dictionary `P`, e.g. `progress` → `P["progress"]`. Use finite numbers, strings, booleans, arrays, plain objects or `null`. |
| `ref` | `useRef<StemHandle>(null)`; once mounted, read `current.P` and call `current.render()`. |
| `style` / `className` | Ordinary React layout props; they do not reach Python. The component fills its outer box, so the parent needs an explicit size. |

`id` and `children` are also reserved by React / the host; `code` and `blit` do not go into the Python parameter dictionary. Do not name a prop `P`. Keep references to large arrays stable and tween only a few scalars; do not rebuild the whole data set or the source every frame.

```python
def init(ax, P):
    # Set up the axes; create the static figure and the dynamic artists.
    line, = ax.plot([], [])
    return [line]

def update(P, artists):
    # Set the picture from this frame's absolute parameters.
    line, = artists
    x = np.linspace(0, 2 * np.pi, 160)
    line.set_data(x, np.sin(x + P["phase"]))
```

`ax` is the Axes provided by the host. Python already has `np` (NumPy), `plt` (pyplot) and `THEME` (a dictionary of semantic colors) injected. `init` can return a list, tuple or dictionary of artists, nested if needed; `update` receives the same structure, and its return value is ignored. A static figure still keeps `update`; its body can be `pass`.

Do not start a `FuncAnimation`, a timer or a playback loop of your own, and do not call `plt.show()` / `plt.savefig()`. The host manages the Figure and the Canvas; draw on `ax` and do not create another `plt.figure()` / `plt.subplots()`. Every frame must be fully determined by the current `P`: use `x = speed * P["time"]`, not `x += speed`. `init` may be called again when the figure is switched, resized or restyled, so do not rely on it running only once. Precompute random data with a fixed seed; do not keep consuming random numbers in `update`.

### Choosing blit

| Situation | Write | What actually runs |
| --- | --- | --- |
| Axes and view are fixed; only curves, points, bar heights or text change | `blit` | `init` builds the background and returns the dynamic artists; after that, the background is restored, `update` runs and the returned artists are redrawn. |
| Axis ranges/ticks change, a 3D view rotates, the number of artists changes | `blit={false}` | Every redraw runs `init → update → draw the whole Figure`. Both functions can read the current `P`. |

In `blit` mode, **every artist that changes must be returned by `init`**, including dynamic titles and annotations. The static background is not recomputed when `update` modifies the axes; turn blit off when you change xlim / ylim, autoscale or the camera. Dynamic artists are drawn over the static background, in the order they are returned; for complex occlusion use a full redraw. The principle is the same as [blitting in matplotlib](https://matplotlib.org/stable/users/explain/animations/blitting.html).

Common update methods: `Line2D.set_data(x, y)`; a vertical line `set_xdata([x, x])`; a scatter `set_offsets(np.column_stack([x, y]))`; a bar `set_height(value)`; an image `set_data(array)`; text `set_text(text)`; in general `set_alpha(value)` / `set_visible(bool)`. Prefer updating existing artists.

Do not initialize a filled region with `fill_between([], [])`; use valid arrays. For bars, fix the number of categories first, then create a zero array of the same length. When the topology changes in complicated ways, a full redraw is more direct than maintaining a set of artists that keeps being added and removed.

### Sharing data

Prefer a custom prop such as `data={data}`: the host handles JSON encoding and decoding, and Python reads `P["data"]` in `init` / `update`. React and Python can refer to the same JS data.

When the data is needed for precomputation at module load, inject the JSON text as a **Python string** and `json.loads` it. Both levels of `JSON.stringify` below are required: the inner one produces JSON, the outer one produces a safe quoted string.

```tsx
const data = { label: 'She said "wave"', values: [0, 1, 0], enabled: true, note: null };
const CODE = `
import json
DATA = json.loads(${JSON.stringify(JSON.stringify(data))})
VALUES = np.asarray(DATA["values"], dtype=float)

def init(ax, P):
    ax.set_xlim(0, len(VALUES) - 1)
    ax.set_ylim(-1.2, 1.2)
    line, = ax.plot(np.arange(len(VALUES)), VALUES)
    ax.set_title(DATA["label"])
    return [line]

def update(P, artists):
    artists[0].set_ydata(VALUES * P["gain"])
`;
// <Mpl code={CODE} blit gain={1} />
```

Do not write `DATA = ${JSON.stringify(data)}`: JSON's `true` / `false` / `null` are not Python literals. Do not read `assets/...` directly from Python; the file system of Python in the browser is not the project's file system. Do large-scale cleaning, reading external files or offline solving in the shell first, then pass the results in as data.

### Dynamic fills and 3D

Each snippet below can replace `CODE` in the example; the matching props follow each one.

When the filled range changes, rebuild the whole figure directly from the current parameters:

```python
def init(ax, P):
    ax.set_xlim(0, 2 * np.pi)
    ax.set_ylim(-1.1, 1.1)
    full = np.linspace(0, 2 * np.pi, 200)
    ax.plot(full, np.sin(full), color="#5eb0ff")
    until = np.clip(P["progress"], 0, 1) * 2 * np.pi
    x = np.linspace(0, until, max(2, int(200 * P["progress"])))
    ax.fill_between(x, 0, np.sin(x), color="#5eb0ff", alpha=0.25)
    return []

def update(P, artists):
    pass
```

Mount it as `<Mpl ref={plot} code={CODE} blit={false} progress={0} />` and tween `progress: 1`.

3D uses the host's same Figure and replaces the default Axes:

```python
def init(ax, P):
    fig = ax.figure
    ax.remove()
    ax = fig.add_subplot(111, projection="3d")
    t = np.linspace(0, 4 * np.pi, 240)
    ax.plot(np.cos(t), np.sin(t), t, color="#5eb0ff")
    ax.set(xlim=(-1.2, 1.2), ylim=(-1.2, 1.2), zlim=(0, 4 * np.pi))
    return {"axes": ax}

def update(P, artists):
    artists["axes"].view_init(elev=25, azim=P["azimuth"])
```

Mount it as `<Mpl ref={plot} code={CODE} blit={false} azimuth={-60} />` and tween `azimuth`. Multiple panels also use the same Figure: use `ax.inset_axes(...)` / `ax.twinx()`, or remove the default axes and call `fig.add_subplot(...)`. For multiple axes, colorbars and dynamic layouts, first confirm correctness with a full redraw, then consider optimizing.

### Style and layout

The figure's output aspect ratio comes from the outer CSS box, not from the numeric x/y ranges. When geometric lengths must be to scale, use `ax.set_aspect('equal')`. Large titles, captions and key readouts belong in the React DOM; keep coordinates, units and legends inside the figure. Font sizes, line widths and markers use matplotlib's native units: font sizes are in pt, not CSS px.

By default the Figure / Axes background is transparent, with font sizes suited to video and a color scheme for dark backgrounds. For a light scene, set that figure's `RC` explicitly; the project theme can also be passed in as shared data. Do not assume `THEME` reads a `theme.ts` you created.

```python
RC = {
    "text.color": "#183044",
    "axes.labelcolor": "#183044",
    "axes.edgecolor": "#6c7987",
    "xtick.color": "#6c7987",
    "ytick.color": "#6c7987",
    "grid.color": "#b7c3ca",
    "font.size": 18,
}
## Or pick a built-in matplotlib style instead: STYLE = "ggplot"
```

`RC` accepts any available matplotlib rcParams; `STYLE` accepts a built-in style name, a list of names or a style dictionary. Declare both at the top level of the Python module. STYLE is applied first, the video font sizes next, and RC last overrides both; the effect is limited to the current figure. Plain colors can also be passed straight to matplotlib, for example `color=THEME["primary"]`. Common THEME keys: `primary`, `accent`, `secondary`, `muted`, `faint`, `ink`, `magenta`, `positive`, `negative`.

For CJK text in figures, the host loads Noto Sans CJK; CSS fonts from the DOM do not reach Python. Do not turn on `text.usetex`, which depends on an external TeX installation; use matplotlib's mathtext for short math labels, and the `formula` skill when you need a term-by-term derivation.

### Running and checking

Python runs in Pyodide in the browser; the host prepares NumPy and matplotlib. A top-level import of `scipy`, `sympy`, `pandas`, `networkx` or `sklearn` triggers loading on demand; `sklearn` corresponds to `scikit-learn`. Other packages depend on the current Pyodide distribution, which is not your local pip environment; do not assume that arbitrary Python packages, system binaries or `matplotlib_venn` are available. For the ordinary APIs of the available libraries, refer to their official documentation.

The first draw has to load the runtime and the packages it uses: Pyodide, its packages and the CJK font come from a CDN (cdn.jsdelivr.net, over ten megabytes on a cold start), so `anim preview`, `anim look`, `anim check` and `anim render` need network access to draw a figure. Rendering waits until they are ready; if loading fails, the figure stays a placeholder and the error goes to the console. A complex figure may briefly keep the previous frame in the live `anim preview`; for exact framing, check with the target parameters. Avoid solving differential equations or doing large matrix decompositions per frame: solve first, then index or interpolate by `P`.

A successful TSX compile does not mean the Python actually ran. Check the figure in real browser frames (`anim look`); seeking back to the same parameters must give the same picture. `[mpl]` errors in the output of `anim look` / `anim check` carry the reason Python failed.

| Symptom | Check first |
| --- | --- |
| Blank figure | Python syntax, the two entry functions, whether dependencies are available, the parent's size. |
| Parameters change but the figure doesn't move | Whether you update `handle.P` and call `render()`; whether the `P` key names match in Python; whether the dynamic artists are returned by `init`. |
| Axis range or title doesn't update | You modified the static background: use a full redraw, or return the dynamic text artist and update it. |
| CJK text shows as boxes | Whether loading the Noto CJK font failed; CSS fonts do not reach Python. |
| Coordinates or labels are clipped | Box width and height, font size, axis decorations and layout; do not derive the canvas ratio from the data range. |
| Seeking back to an earlier moment gives a different picture | Accumulated state, random numbers, runtime state stored and mutated in module globals. |
