/**
 * mpl Python harness source + build-time static lint.
 * The browser runtime runs this exact harness for both playback and the headless-Chromium frames rendered by `anim check` / `anim look`,
 * so the frames an agent checks come from the same code that plays.
 */
import type { PyodideThemePayload } from '@animspark/scene-engine/pyodide';

export const MPL_BUF_W = 960;
export const MPL_BUF_H = 720;

/** Kept in sync with the browser Pyodide (see scene-engine/pyodide/index.ts). */
export { MPL_PYODIDE_INDEX_URL } from '@animspark/core/mg-preview-security';

/**
 * CJK font for matplotlib (~16MB).
 *
 * Pinned to a commit rather than @main: jsDelivr serves mutable refs with only max-age=604800 and immutable refs with
 * max-age=31536000, immutable - otherwise these 16MB would be re-downloaded every week. It also guarantees that server-side frame probes/posters
 * and viewers' browsers always get the same bytes (with a mutable ref, an upstream change would make the two ends render different glyphs).
 * The playback HTML preload and the runtime fetch must use the same URL, or the preload is downloaded for nothing - hence this shared constant.
 */
export { MPL_CJK_FONT_URL } from '@animspark/core/mg-preview-security';

/** Default theme for Pyodide smoke checks run outside a film (same semantic colors as lecture-lab). */
export const MPL_VALIDATION_THEME: PyodideThemePayload = {
  primary: '#5eb0ff',
  accent: '#ffb45e',
  secondary: '#5eb0ff',
  muted: '#8b93ad',
  faint: '#39426a',
  ink: '#e8edf4',
  magenta: '#ff7af0',
  positive: '#52d499',
  negative: '#ff7a7a',
};

const HEAVY_IMPORTS = /\b(?:import|from)\s+(scipy|sympy|pandas|networkx|matplotlib_venn|sklearn)\b/g;
const PYODIDE_PACKAGE_BY_IMPORT: Record<string, string> = {
  matplotlib_venn: 'matplotlib-venn',
  sklearn: 'scikit-learn',
};

/** Parse the heavy Pyodide packages that the mpl code actually imports. */
export function mplHeavyPackages(code: string): string[] {
  const set = new Set<string>();
  for (const m of code.matchAll(HEAVY_IMPORTS)) set.add(PYODIDE_PACKAGE_BY_IMPORT[m[1]!] ?? m[1]!);
  return [...set];
}

/** Build-time static lint (does not run Pyodide; takes milliseconds). */
export function lintMplPythonStatic(code: string, label: string): string[] {
  const issues: string[] = [];
  if (!/\bdef\s+init\s*\(\s*ax\b/.test(code)) {
    issues.push(`${label}: mpl code is missing def init(ax, P).`);
  }
  if (!/\bdef\s+update\s*\(\s*P\b/.test(code)) {
    issues.push(`${label}: mpl code is missing def update(P, artists).`);
  }
  if (/\bfill_between\s*\(\s*\[\s*\]\s*,\s*\[\s*\]/.test(code)) {
    issues.push(
      `${label}: fill_between([], []) in init raises in Pyodide/matplotlib, so during playback mpl is stuck on "Loading..." forever.`
      + ' Remove the empty fill_between, or call fill_between in update with real x/y data.',
    );
  }
  if (/\b(?:bar|barh|stackplot|stairs)\s*\(\s*\[\s*\]/.test(code)) {
    issues.push(
      `${label}: calling bar/barh/stackplot/stairs with empty arrays in init may raise in Pyodide.`
      + ' Draw the static background with axhline/axvline/plot on fixed data; put the dynamic parts in update.',
    );
  }
  return issues;
}

/** Exactly the Python harness that the browser mpl-runtime injects. */
export function mplPythonHarnessSource(
  bufW = MPL_BUF_W,
  bufH = MPL_BUF_H,
): string {
  return `
import json
import contextlib as _contextlib
from collections import OrderedDict as _OrderedDict
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as _mcolors
from matplotlib import patches as _mpatches
from matplotlib import font_manager as _fm
from cycler import cycler
import re as _re

for _pn in ("Wedge", "Arc", "Arrow", "FancyArrow", "FancyArrowPatch", "FancyBboxPatch",
            "Ellipse", "Circle", "Rectangle", "Polygon", "RegularPolygon", "CirclePolygon",
            "Annulus", "PathPatch", "ConnectionPatch", "Shadow"):
    if hasattr(_mpatches, _pn) and not hasattr(plt, _pn):
        setattr(plt, _pn, getattr(_mpatches, _pn))

_orig_to_rgba = _mcolors.to_rgba
def _to_rgba_css_ok(c, alpha=None):
    if isinstance(c, str):
        m = _re.fullmatch(r"\\s*rgba?\\(([^)]*)\\)\\s*", c)
        if m:
            vals = [v.strip() for v in m.group(1).split(",")]
            if len(vals) in (3, 4):
                def ch(v):
                    if v.endswith("%"):
                        return max(0.0, min(1.0, float(v[:-1]) / 100.0))
                    x = float(v)
                    return max(0.0, min(1.0, x / 255.0 if x > 1 else x))
                r, g, b = ch(vals[0]), ch(vals[1]), ch(vals[2])
                a = float(vals[3]) if len(vals) == 4 else 1.0
                if alpha is not None:
                    a = alpha
                return (r, g, b, max(0.0, min(1.0, a)))
    return _orig_to_rgba(c, alpha)
_mcolors.to_rgba = _to_rgba_css_ok

plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["figure.facecolor"] = "none"
plt.rcParams["axes.facecolor"] = "none"
plt.rcParams["savefig.facecolor"] = "none"

# Font sizes are set for video, not for papers: at dpi 100, 1pt ≈ 1.39 stage px, 15pt ticks ≈ 21px, 24pt titles ≈ 33px -
# readable even on a phone at 1080p. Authors who want bigger text call set_title(fontsize=...) / tick_params(labelsize=...) in init.
# Sizes live in their own dict: when an author swaps the whole stylesheet via STYLE we first reset to matplotlib's factory defaults (otherwise
# ggplot's light background would sit under the light text of our dark baseline), then layer these sizes back on - the stylesheet owns colors and line styles, font sizes stay video-sized.
_VIDEO_SIZES = {
    "font.size": 18,
    "axes.titlesize": 24, "axes.titleweight": "medium", "axes.titlepad": 14,
    "axes.labelsize": 18, "axes.labelpad": 8,
    "xtick.labelsize": 15, "ytick.labelsize": 15,
    "legend.fontsize": 16, "legend.borderpad": 0.6,
    "lines.linewidth": 2.6, "lines.markersize": 8,
    "lines.solid_capstyle": "round", "lines.dash_capstyle": "round",
    "axes.linewidth": 1.3, "patch.linewidth": 1.6,
    "xtick.major.size": 4.5, "ytick.major.size": 4.5,
    "xtick.major.width": 1.1, "ytick.major.width": 1.1,
    "figure.constrained_layout.use": False,
    "figure.constrained_layout.h_pad": 0.035, "figure.constrained_layout.w_pad": 0.035,
    "figure.constrained_layout.hspace": 0.02, "figure.constrained_layout.wspace": 0.02,
    "axes.unicode_minus": False,
}
plt.rcParams.update(_VIDEO_SIZES)
plt.rcParams.update({
    "legend.frameon": False,
    "axes.axisbelow": True, "axes.grid": False,
    "axes.spines.top": False, "axes.spines.right": False,
    "grid.alpha": 0.22, "grid.linewidth": 1.0, "grid.linestyle": "-",
    "xtick.direction": "out", "ytick.direction": "out",
})

_theme = {}

def _apply_theme(theme_json):
    t = json.loads(theme_json)
    if t.get("surfaceStroke") is None and t.get("faint"):
        t["surfaceStroke"] = t["faint"]
    _theme.clear(); _theme.update(t)
    ink = t.get("ink", "#e8edf4"); muted = t.get("muted", "#8b93ad"); faint = t.get("faint", "#39426a")
    cyc = [t.get("primary", "#5eb0ff"), t.get("accent", "#ffb45e"),
           t.get("secondary") or t.get("primary", "#5eb0ff"),
           t.get("magenta") or t.get("accent", "#ffb45e"),
           t.get("positive", "#52d499"), t.get("negative", "#ff7a7a")]
    # axes.titlecolor stays auto: titles follow text.color, so an author who changes text.color once in RC recolors the title too.
    plt.rcParams.update({
        "text.color": ink, "axes.labelcolor": ink,
        "axes.edgecolor": muted, "xtick.color": muted, "ytick.color": muted,
        "grid.color": faint, "axes.prop_cycle": cycler(color=cyc),
    })

def _register_font(path):
    _fm.fontManager.addfont(path)
    _name = _fm.FontProperties(fname=path).get_name()
    plt.rcParams["font.family"] = [_name, "DejaVu Sans"]
    return _name

_W, _H = ${bufW}, ${bufH}
_fig = plt.figure(figsize=(_W / 100.0, _H / 100.0), dpi=100)
# Output density. figsize is always "logical pixels / 100" inches; sharpness may only be raised via dpi:
# font sizes, line widths and markers are in pt (pixels = pt × dpi / 72), so raising dpi scales them proportionally and the composition stays identical;
# enlarging figsize without touching dpi instead makes the canvas bigger while text keeps the same pixel size - that changes every figure's composition.
_density = 1.0
_fig.patch.set_alpha(0.0)
_canvas = _fig.canvas

class _Scene:
    __slots__ = ("init", "update", "blit", "ax", "artists", "bg", "ready", "blit_failed", "last_w", "last_h", "last_box_w", "last_box_h", "rc", "style")
    def __init__(self, init_fn, update_fn, rc=None, style=None):
        self.init = init_fn
        self.update = update_fn
        self.blit = False
        self.ax = None
        self.artists = []
        self.bg = None
        self.ready = False
        self.blit_failed = False
        self.last_w = 0
        self.last_h = 0
        self.last_box_w = 0
        self.last_box_h = 0
        self.rc = rc
        self.style = style

_code_modules = {}
_scenes = _OrderedDict()
_MAX_SCENES = 16
_active_scene = None

def _load(code_id, code):
    if code_id in _code_modules:
        return
    g = {"THEME": _theme, "plt": plt, "np": np}
    exec(code, g)
    init_fn = g.get("init")
    update_fn = g.get("update")
    if init_fn is None or update_fn is None:
        raise ValueError("mpl: must define def init(ax, P) and def update(P, artists)")
    # This figure's own style: STYLE is a built-in stylesheet name (or a list of names / a dict), RC is arbitrary rcParams.
    # Applied only while drawing this figure (rc_context), so it doesn't leak into other figures in the same film.
    rc = g.get("RC")
    style = g.get("STYLE")
    # Source functions are compiled once; Axes/artists/background belong to each component instance.
    _code_modules[code_id] = (
        init_fn, update_fn,
        rc if isinstance(rc, dict) and rc else None,
        style if style else None,
    )

def _drop_scene(scene_id):
    global _active_scene
    _scenes.pop(scene_id, None)
    if _active_scene == scene_id:
        _active_scene = None
        _fig.clf()
        _invalidate_all()

def _scene_for(code_id, scene_id):
    sc = _scenes.get(scene_id)
    if sc is None:
        sc = _Scene(*_code_modules[code_id])
        _scenes[scene_id] = sc
    _scenes.move_to_end(scene_id)
    while len(_scenes) > _MAX_SCENES:
        _drop_scene(next(iter(_scenes)))
    return sc

def _scene_style(sc):
    """This figure's own style, restored on exit.

    STYLE (a stylesheet) starts from matplotlib's factory defaults, then the video sizes and a transparent figure background are layered back on
    (the stylesheet's axes background stays - that is its look; a solid white slab pasted over the film is not); RC is applied last, the author has the final word.
    Without STYLE, RC is layered directly onto our baseline (transparent background, dark-background palette)."""
    stack = _contextlib.ExitStack()
    if sc.style:
        stack.enter_context(plt.style.context(sc.style, after_reset=True))
        stack.enter_context(matplotlib.rc_context(rc={**_VIDEO_SIZES, "figure.facecolor": "none"}))
    if sc.rc:
        stack.enter_context(matplotlib.rc_context(rc=sc.rc))
    return stack

def _new_ax(sc, P):
    plt.figure(_fig.number)
    _fig.clf()
    # The baseline figure.facecolor is none (transparent, the film's background shows through); if the author set a background in RC / STYLE, use it.
    _fc = plt.rcParams["figure.facecolor"]
    _fig.set_facecolor(_fc)
    _fig.patch.set_alpha(0.0 if str(_fc).lower() == "none" else None)
    ax = _fig.add_subplot(111)
    arts = sc.init(ax, P) or []
    # init may replace this axes (ax.remove() then add_subplot(111, projection='3d') is the proper way to draw 3D).
    # After that, draw_artist must target the live axes, not one that has already left the figure.
    if ax not in _fig.axes and _fig.axes:
        ax = _fig.axes[0]
    sc.ax = ax
    sc.artists = arts
    return ax, arts

def _iter_artists(obj):
    if obj is None:
        return []
    if hasattr(obj, "draw"):
        return [obj]
    if isinstance(obj, dict):
        out = []
        for v in obj.values():
            out.extend(_iter_artists(v))
        return out
    try:
        out = []
        for v in obj:
            out.extend(_iter_artists(v))
        return out
    except TypeError:
        return []

def _invalidate(scene_id):
    sc = _scenes.get(scene_id)
    if sc is not None:
        sc.ready = False

def _invalidate_all():
    for sc in _scenes.values():
        sc.ready = False

def _set_density(d):
    """Switch output density (1.0 = 1080p output, 2.0 = 4K). Only changes dpi, never figsize."""
    global _density
    try:
        d = float(d)
    except (TypeError, ValueError):
        return
    d = max(0.45, min(4.0, d))
    if abs(d - _density) < 1e-6:
        return
    _density = d
    _fig.set_dpi(100.0 * _density)
    # The bg cached by the blit path was copied with copy_from_bbox in physical pixels, so its size no longer matches once dpi changes;
    # the margins pinned by the full-redraw path were also computed at the old dpi. Invalidate everything and rebuild.
    _invalidate_all()

def _ensure_fig_pixels(out_w, out_h, sc):
    out_w = max(64, int(out_w))
    out_h = max(64, int(out_h))
    if sc.last_w != out_w or sc.last_h != out_h:
        sc.ready = False
        sc.bg = None
        sc.last_w = out_w
        sc.last_h = out_h
    plt.figure(_fig.number)
    want_dpi = 100.0 * _density
    if abs(_fig.get_dpi() - want_dpi) > 1e-6:
        _fig.set_dpi(want_dpi)
    _fig.set_size_inches(out_w / 100.0, out_h / 100.0, forward=True)
    return out_w, out_h

def _build_scene(sc, P, box_w, box_h):
    """The figure is the mount box (logical pixels).

    This used to infer a "content aspect ratio" from the xlim/ylim data range and meet it into the box - for plots whose x and y units
    aren't comparable (bar chart x∈[0.5,8.5], y∈[0,1.25]) that came out as 6.4:1, leaving a 1250×195 strip in a 1250×600 box,
    with the title and x-axis labels cropped off. The data range is not the frame aspect ratio. Figures that need locked geometric proportions
    (unit circle, geometric proofs) call ax.set_aspect('equal') themselves, and matplotlib centers the axes in the box with margins."""
    _ensure_fig_pixels(max(64, int(box_w)), max(64, int(box_h)), sc)
    return _new_ax(sc, P)

def _layout_once():
    """Run constrained layout once, then switch it off: margins are computed for the decorations this figure actually has
    (title / ticks / legend), then pinned. Figures with axis('off') thus fill the frame and titled figures don't get their title cropped;
    after that the blit path only does restore + draw_artist each frame and never touches layout again."""
    try:
        _fig.set_layout_engine("constrained")
        _canvas.draw()
    except Exception:
        _canvas.draw()
    finally:
        try:
            _fig.set_layout_engine("none")
        except Exception:
            pass

def _box_changed(sc, box_w, box_h):
    return sc.last_box_w != box_w or sc.last_box_h != box_h

def _note_box(sc, box_w, box_h):
    if _box_changed(sc, box_w, box_h):
        sc.ready = False
        sc.bg = None
        sc.last_box_w = box_w
        sc.last_box_h = box_h

def _draw(code_id, p_json, blit, box_w, box_h, density=1.0, instance_id=None):
    scene_id = instance_id or code_id
    sc = _scene_for(code_id, scene_id)
    with _scene_style(sc):
        return _draw_scene(sc, scene_id, p_json, blit, box_w, box_h, density)

def _draw_scene(sc, scene_id, p_json, blit, box_w, box_h, density):
    global _active_scene
    # box_w/box_h are logical pixels (stage coordinates); the actual raster = logical × density, realized via dpi.
    _set_density(density)
    P = json.loads(p_json)
    box_w = max(64, int(box_w))
    box_h = max(64, int(box_h))
    _note_box(sc, box_w, box_h)
    if (_active_scene is not None and _active_scene != scene_id) or sc.blit != bool(blit):
        sc.ready = False
        sc.bg = None
    if blit and not sc.blit_failed:
        try:
            if not sc.ready or sc.bg is None:
                ax, arts = _build_scene(sc, P, box_w, box_h)
                _active_scene = scene_id
                for a in _iter_artists(arts):
                    try: a.set_animated(True)
                    except Exception: pass
                _layout_once()
                sc.bg = _canvas.copy_from_bbox(_fig.bbox)
                sc.ready = True
                sc.blit = True
                _canvas.restore_region(sc.bg)
                sc.update(P, arts)
                for a in _iter_artists(arts):
                    sc.ax.draw_artist(a)
                _canvas.blit(_fig.bbox)
                return np.asarray(_canvas.buffer_rgba())
            _canvas.restore_region(sc.bg)
            sc.update(P, sc.artists)
            for a in _iter_artists(sc.artists):
                sc.ax.draw_artist(a)
            _canvas.blit(_fig.bbox)
            return np.asarray(_canvas.buffer_rgba())
        except Exception:
            sc.blit_failed = True
            sc.ready = False
            sc.bg = None
            for a in _iter_artists(sc.artists):
                try: a.set_animated(False)
                except Exception: pass
    ax, arts = _build_scene(sc, P, box_w, box_h)
    _active_scene = scene_id
    sc.update(P, arts)
    _layout_once()
    sc.ready = True
    sc.blit = False
    return np.asarray(_canvas.buffer_rgba())
`;
}
