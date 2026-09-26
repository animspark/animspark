/**
 * A film has exactly one WebGL context.
 *
 * Browsers impose a hard limit on simultaneously live WebGL contexts (about 16 in desktop
 * Chrome), and a dozen-plus 3D shots in one film is normal. If every shot built its own,
 * past the limit the browser **silently reclaims the oldest one** - the symptom is that the
 * picture of earlier shots suddenly turns black later in the film, with only a warning in
 * the console.
 *
 * So only one is built here, and all 3D shots take turns with it: render into its offscreen
 * canvas, then copy the whole frame onto the shot's own visible canvas. That costs one extra
 * full-frame blit (about 1-2ms at 1080p) in exchange for "any number of 3D shots never blows
 * up". The overhead is noise in export - the per-frame capture round trip costs dozens of
 * times more.
 *
 * **The renderer is supplied by the film, not built by this layer.** The runtime doesn't
 * depend on three: it only knows "there's something that can setSize, render, and dispose".
 * That way upgrading three, or swapping in another WebGL library, is none of the runtime's
 * business.
 */

import * as React from 'react';

/** Everything this layer requires of a renderer. `THREE.WebGLRenderer` fits exactly. */
export interface SharedRenderer {
  domElement: HTMLCanvasElement;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio?(ratio: number): void;
  render(scene: unknown, camera: unknown): void;
  dispose(): void;
}

/** Draw one frame: call it after posing the scene. */
export type DrawFrame = (scene: unknown, camera: unknown) => void;

let shared: SharedRenderer | null = null;
/** How many shots are still using it. At zero the context goes back to the browser - a finished film shouldn't hold on to GPU memory. */
let users = 0;
/**
 * Source of the make factory that built the current shared renderer.
 *
 * The context is built by the **first** mounted make, and later shots can only reuse it -
 * properties like alpha can't change after creation. When two shots specify different
 * configs, the later one **silently has no effect**: in one measured case a shot that wanted
 * a transparent background ran into a context the earlier-mounted shot had built without
 * alpha, rendered an opaque black background covering all tracks underneath, and raised no
 * error. The source is compared with whitespace stripped (different line breaks shouldn't
 * trigger it), so when two configs in the same bundle really differ it always reports - the
 * whole point here is to turn silence into noise.
 */
let sharedMakeSrc: string | null = null;

function acquire(make: () => SharedRenderer, src: string): SharedRenderer {
  if (!shared) {
    shared = make();
    sharedMakeSrc = src;
  } else if (sharedMakeSrc !== null && sharedMakeSrc !== src) {
    console.error(
      'A film shares one WebGL context, built from the FIRST 3D clip\'s factory — '
      + 'this clip\'s factory differs, so its settings are silently ignored. '
      + 'A clip that wants a transparent backdrop gets an opaque black one this way. '
      + 'Give every 3D clip the identical factory: '
      + 'new THREE.WebGLRenderer({ antialias: true, alpha: true }), '
      + 'and set scene.background when a clip wants an opaque backdrop.',
    );
  }
  users += 1;
  return shared;
}

function release(): void {
  users -= 1;
  if (users > 0 || !shared) return;
  shared.dispose();
  shared = null;
  sharedMakeSrc = null;
}

/**
 * Get a function that "draws the scene into this canvas".
 *
 * ```tsx
 * const canvas = useRef<HTMLCanvasElement>(null);
 * const draw = useSharedRenderer(canvas, () => new THREE.WebGLRenderer({ antialias: true, alpha: true }));
 * const t = useLocal();
 * useLayoutEffect(() => { pose(scene.current, t); draw(scene.current, camera.current); }, [t, draw]);
 * ```
 *
 * `make` is called only once, when the **first** 3D shot of the whole film mounts; every shot
 * after that shares the same one - so every shot must use the **same** config
 * (`{ antialias: true, alpha: true }`). Express an opaque background with scene.background,
 * not by turning alpha off.
 */
export function useSharedRenderer(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  make: () => SharedRenderer,
): DrawFrame {
  const paint = useSharedPaint(canvas, make);
  return React.useCallback((scene, camera) => {
    paint((r) => { r.render(scene, camera); });
  }, [paint]);
}

/** The draw-it-yourself path: you're called after sizing, and the result is copied afterwards. `w`/`h` are this frame's **physical** pixel counts. */
export type PaintFrame = (paint: (r: SharedRenderer, w: number, h: number) => void) => void;

/**
 * Same as `useSharedRenderer`, except you do the final draw.
 *
 * Scenes with their own post-processing chain need this path: `EffectComposer` output doesn't
 * go through `renderer.render(scene, camera)`, and its RenderTargets must match the shared
 * renderer's buffer size - so it needs to be notified when the size changes.
 *
 * ```tsx
 * const paint = useSharedPaint(canvas, () => new THREE.WebGLRenderer({ antialias: true, alpha: true }));
 * paint((r, w, h) => { embed.resize(w, h); embed.at(gt); embed.render(); });
 * ```
 */
export interface SharedPaintOptions {
  /**
   * Lower bound for the render pixel ratio. Defaults to following the device (at most 2).
   *
   * Setting it to 2 means supersampling: render at twice the size and let the blit scale it
   * back down to the visible size, so hard edges no longer stair-step.
   *
   * **Measure before enabling.** The nominal cost is 4x fill rate, but **scenes with a
   * post-processing chain cost far more than 4x** - bloom-style multi-level down/upsampling
   * grows superlinearly with resolution. Measured (the lighthouse shot, UnrealBloom + SMAA):
   *
   *     off      0.33s per frame
   *     at 2     3.9s per frame      <- 12x
   *
   * That time it was enabled to fix an aliasing difference on a **still frame**, and the cost
   * only showed up during **continuous playback**: frame-by-frame capture waits for each frame
   * to finish before shooting it, so even 100x slower goes unnoticed and the contact sheet
   * stays all green. The result was "the progress bar moves, the picture is frozen", with no
   * error anywhere.
   *
   * So: enable it only when jaggies are really visible at native resolution, and only after
   * **measuring the playback frame rate**.
   */
  minPixelRatio?: number;
}

export function useSharedPaint(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  make: () => SharedRenderer,
  opts: SharedPaintOptions = {},
): PaintFrame {
  const minRatio = Math.max(1, opts.minPixelRatio ?? 1);
  /* make is a new closure on every render, but it's only really called the first time -
     keep a ref to it instead of putting it in deps, which would make the effect re-run
     every frame. */
  const factory = React.useRef(make);
  factory.current = make;

  const renderer = React.useRef<SharedRenderer | null>(null);
  React.useLayoutEffect(() => {
    /* Take the source here: inside acquire we'd always get the wrapper closure below, and
       comparing that compares nothing. Strip whitespace before comparing - the same config
       with different line breaks shouldn't trigger a report. */
    renderer.current = acquire(() => factory.current(), factory.current.toString().replace(/\s+/g, ''));
    return () => { renderer.current = null; release(); };
  }, []);

  return React.useCallback((paint) => {
    const r = renderer.current;
    const out = canvas.current;
    if (!r || !out) return;

    /* How many pixels to render depends on how much of the **screen** this canvas really
     * occupies - not how wide it is in stage coordinates.
     *
     * A film is laid out on a fixed stage (e.g. 1920x1080), then scaled as a whole via CSS
     * transform into the player's box. So `clientWidth` gives stage coordinates (1180), while
     * to the viewer it's only 787 CSS pixels. Rendering the former times dpr gives 2360 wide
     * on Retina - 2.25x the area the screen actually needs (1574), and the extra is scaled
     * away during compositing without a single pixel of it being visible.
     *
     * The cost isn't linear: scenes with a bloom post-processing chain (multi-level
     * down/upsampling) grow superlinearly with resolution. Measured: the lighthouse shot
     * dropped to 15fps on Retina because of this, while the old architecture, rendering a
     * fixed 1920x1080, ran at a full 115fps.
     *
     * `getBoundingClientRect` already accounts for ancestor transforms, so it is that "really
     * occupies" number. During export and frame capture the page is 1:1 with no outer
     * scaling, so the two are equal - image quality isn't affected by this step. */
    const dpr = Math.max(minRatio, Math.min(2, globalThis.devicePixelRatio || 1));
    const box = out.getBoundingClientRect();
    /* Quantize to multiples of 8. Following the on-screen size means guarding against **size
       jitter**: while a card does an entrance scale its width changes by fractions of a pixel
       every frame, and every size change resets the renderer and rebuilds the post-processing
       chain's RenderTargets - far more expensive than rendering a few extra pixels. 8px steps
       are invisible, yet they cut rebuilds during the whole animation to single digits. */
    const step = (v: number): number => Math.max(8, Math.round(v / 8) * 8);
    const w = step(box.width || out.clientWidth || out.width);
    const h = step(box.height || out.clientHeight || out.height);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (r.domElement.width !== pw || r.domElement.height !== ph) {
      r.setPixelRatio?.(dpr);
      r.setSize(w, h, false);
    }
    if (out.width !== pw || out.height !== ph) {
      out.width = pw;
      out.height = ph;
    }

    paint(r, pw, ph);

    /* Copy onto our own canvas. The shared renderer's canvas belongs to someone else next
       frame; without the copy, switching to another 3D shot would make this shot's picture
       turn into that one's. */
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(r.domElement, 0, 0, pw, ph);
  }, [canvas, minRatio]);
}
