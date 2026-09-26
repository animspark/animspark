/**
 * Launch Chromium and capture the shot page as frames.
 *
 * The page itself comes from `@animspark/film-build` (that layer must install on machines without
 * Playwright); this module only drives the browser, which is an engine-side capability.
 */

import { FilmCliError } from '@animspark/film-build';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { serveFontLibrary } from '../scene/font-library';
import { serveWorkspaceMedia } from './serve-media';

/**
 * Timestamp strip height = stage width / this. The page and the viewport must use the same value, or
 * the strip gets cut off outside the viewport.
 */
const CAP_DIVISOR = 22;

export const captionHeight = (stageW: number): number => Math.round(stageW / CAP_DIVISOR);


export interface ShotFrame {
  atMs: number;
  path: string;
}

/** Timestamp for file names: `3200` → `3.200s`. Used by both contact sheets and single frames. */
export function lookStamp(ms: number): string {
  return `${(Math.round(ms) / 1000).toFixed(3)}s`;
}

/** A loaded shot page: seek to a moment and capture that frame. */
export interface ShotSession {
  /** Collect media declarations inside the same isolated browser as the visuals. */
  collect(): Promise<import('@animspark/runtime').FilmSummary>;
  /** Seek to a millisecond and wait for the picture to settle. `label` only matters with a timestamp strip. */
  seek(atMs: number, label?: string): Promise<void>;
  /** Capture the current frame. Written to `path` if given; the bytes are returned either way. */
  capture(opts?: { path?: string; jpegQuality?: number }): Promise<Buffer>;
  /**
   * Is this block on stage right now?
   *
   * Single-clip export uses it to validate the name, and it **must only be asked after seeking into
   * the block's range** — a block is mounted only during its own span, so asking at the start of
   * the film about something that appears at 30s always answers no.
   */
  onStage(clipId: string): Promise<boolean>;
  /** Text currently covered, off frame, or cropped by a container (see LayoutIssue). */
  layout(): Promise<LayoutIssue[]>;
  /**
   * This block's two boxes right now (canvas coordinates): `paint` is the layout crop box (same
   * width every frame), `envelope` is how far it paints including transforms. From the shot page's
   * `__filmClipPaint` / `__filmClipEnvelope` (see code-shoot) — the same measures the web app's
   * single-clip export uses. Both null when the block is not on stage.
   */
  clipBounds(clipId: string): Promise<{ paint: ShotBox | null; envelope: ShotBox | null }>;
}

export interface ShotBox { x: number; y: number; w: number; h: number }

/**
 * A run of text that can't be fully seen. Of the problems `look` can show, this is the one models
 * miss most: in a thumbnail, text over an image is just a smudge of color, yet in the finished film
 * it is the most glaring error (C2 baseline: a chip photo covering "Broadcom BCM2712 · quad-core").
 */
export interface LayoutIssue {
  text: string;
  issue: 'covered' | 'off-frame' | 'cropped' | 'straddles';
  /** What covers it: tag + class name / image file name / that text. */
  by?: string;
  /** Share of sample points where it isn't visible. */
  share: number;
}

/**
 * The stage tweaks: isolate one block, drop the background.
 *
 * Done with a stylesheet, not by editing nodes' inline styles. While seeking frame by frame,
 * blocks enter and leave, and React mounts **brand-new nodes** that lack our edits — the symptom is
 * a neighboring block suddenly reappearing at some second of the export, only on those frames. A
 * stylesheet persists, so new nodes pick up the rules as soon as they mount.
 *
 * `!important` is required: three background colors are set in React style attributes (see
 * code-shoot), and `!important` in an author stylesheet beats a normal inline declaration — the
 * one place in the cascade where a stylesheet wins over inline.
 *
 * Isolation uses visibility, not display. display changes layout, and block positions are relative
 * to the stage: pull siblings out of the flow and anything not absolutely positioned moves.
 * visibility also handles nested films: it inherits, and descendants can override it with
 * `visible`, so "keep this block and its inner layers while hiding the pixels of the layers that
 * wrap it" is a single rule.
 */
export function stageCss(opts: { alpha?: boolean | undefined; only?: string | undefined }): string {
  const rules: string[] = [];
  if (opts.alpha) {
    rules.push('html,body{background:transparent!important}');
    rules.push('#anim-shot,#anim-stage{background:transparent!important}');
  }
  if (opts.only) {
    const id = `[data-film-clip-id=${cssQuote(opts.only)}]`;
    rules.push('#anim-stage [data-film-clip-id]{visibility:hidden}');
    /* Same specificity as the rule above; wins by source order. The third rule handles inner
       layers: nested blocks match the first rule (more specific than an inherited `visible`), so
       without it a nested film would be hidden along with its own wrapper. */
    rules.push(`#anim-stage ${id}{visibility:visible}`);
    rules.push(`#anim-stage ${id} [data-film-clip-id]{visibility:visible}`);
    /* visibility can't hide descendants that set `visibility: visible` themselves — gsap's
       autoAlpha writes exactly that inline, so strokes or a paper texture from other blocks show
       through the "hidden" shell (observed: a single-clip export of a caption bar came out with
       the neighboring scene's paper texture at 30% beneath it). Blocks unrelated to this one (not
       it, not a wrapper of it, not inside it) also get opacity:0 — opacity multiplies, so
       descendants can't undo it. Wrappers can't be treated this way, or the block goes with them. */
    rules.push(`#anim-stage [data-film-clip-id]:not(${id}):not(:has(${id})):not(${id} *){opacity:0!important}`);
  }
  return rules.join('\n');
}

/**
 * Block names are user-chosen; spliced raw into a selector, quotes and backslashes in them break it.
 *
 * An attribute selector value is a CSS string, so only three things need escaping: backslashes,
 * quotes, and bare control characters (a newline is illegal in a CSS string and must be a hex
 * escape; the trailing space terminates the escape).
 */
function cssQuote(value: string): string {
  const escaped = value.replace(
    /[\\"]|[\u0000-\u001f]/g,
    (c) => (c === '\\' || c === '"' ? `\\${c}` : `\\${c.charCodeAt(0).toString(16)} `),
  );
  return `"${escaped}"`;
}

/**
 * How far `width` may stray from the stage's native size.
 *
 * These are the bounds of Chromium's `deviceScaleFactor` — here `width` **does not change the
 * viewport**, only raster density (the viewport is always the stage's native size, so layout is
 * identical and the aspect ratio is preserved). Exportable widths are therefore clamped to 0.1-2x
 * the stage width: 192 to 3840 for a 1920 film.
 */
export const SHOT_SCALE_MIN = 0.1;
export const SHOT_SCALE_MAX = 2;

/** A box in canvas coordinates → a Playwright screenshot clip. Full frame returns null (no crop). */
export function shotClipOf(
  box: { x: number; y: number; w: number; h: number },
  stage: { w: number; h: number },
  origin: { left: number; top: number; scale: number } = { left: 0, top: 0, scale: 1 },
): { x: number; y: number; width: number; height: number } | null {
  const x0 = origin.left + box.x * origin.scale;
  const y0 = origin.top + box.y * origin.scale;
  const w0 = box.w * origin.scale;
  const h0 = box.h * origin.scale;
  if (!(w0 >= 8 && h0 >= 8)) return null;
  if (!(w0 < stage.w - 1 || h0 < stage.h - 1)) return null;
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.ceil(w0), stage.w - x)),
    height: Math.max(1, Math.min(Math.ceil(h0), stage.h - y)),
  };
}

export interface ShotPageOptions {
  /** The shot page, already written (the HTML opened via file://). */
  page: string;
  stage: { w: number; h: number };
  /**
   * The worktree root. The film's `assets/upload/x.mp4` resolves against it, and those assets may be
   * only pointers — see serveWorkspaceMedia below. Defaults to `dirname(page)`, since the shot page
   * is written at the tree root (see writeCodeShotPage).
   */
  workspace?: string;
  /** Output width. Defaults to the stage's native size. */
  width?: number;
  /** Add a timestamp strip under the frame. Contact sheets want it; single frames and renders don't. */
  captioned?: boolean;
  /**
   * Transparent background: drop the page's black background layers and capture with alpha.
   *
   * Both halves are required — the page's own backgrounds are removed by a stylesheet (see
   * stageCss), the browser's default background by Playwright's `omitBackground`. Doing only one
   * still yields solid black, with no error.
   */
  alpha?: boolean;
  /**
   * Keep only this block on stage (a clip id from film.json).
   *
   * Single-clip export relies on it. Omitted means the full composited stage — what renders and
   * contact sheets use.
   */
  only?: string;
  /**
   * The region this block occupies, in canvas coordinates. When given, crop to it instead of
   * measuring on the page.
   *
   * The editor has already measured it (data-film-box); measuring again on the shot page often
   * yields the full frame: the wrapper is inset:0, and capture starts before the attribute is
   * applied — the export comes out 2520×1080 while the dialog says 330×420.
   */
  crop?: { x: number; y: number; w: number; h: number };
  /**
   * Scale relative to the block's native size. 1 = native, 2 = double. Chromium's DSF goes up to 2;
   * larger factors are upscaled afterwards by the render layer.
   */
  scale?: number;
  /**
   * `false` = the caller already holds a shot slot for this run (see shot-slots).
   *
   * Local export splits a long film into segments captured in parallel: the whole export takes one
   * slot, and the pages opened per segment don't queue separately — otherwise, with a single slot
   * on the desktop app, segment two would wait for segment one's slot while segment one waits for
   * the export to finish: deadlock. By default the call queues for itself.
   */
  slot?: false;
  /**
   * Take lossless captures via CDP's `optimizeForSpeed` (fast zlib): measured 250ms → 92ms for the
   * same 1080p transparent PNG. Slightly larger files (lower compression), identical pixels. Frames
   * with CSS / WAAPI animations running fall back to the Playwright path (which freezes animations;
   * see `animations: 'disabled'`), so the picture is unchanged. JPEG is unaffected.
   */
  fastPng?: boolean;
  /** Cancellation: close the browser at once — a frame stuck in an evaluate then fails and throws. */
  signal?: AbortSignal;
}

/**
 * Give the shot page a real GPU.
 *
 * Headless Chromium defaults to SwiftShader — a CPU-emulated "GPU": WebGL, canvas and CSS filters
 * all run on the CPU while the machine's GPU sits idle. Measured on an M5: the default is
 * `SwiftShader Device (LLVM)`; only with `--use-angle=metal` is it `ANGLE Metal Renderer: Apple M5`.
 *
 * On by default in the desktop app: it's the user's own machine, so export should use all of it,
 * and the editor preview the user sees is GPU-drawn anyway, so GPU capture matches it more
 * closely. On servers (Linux containers without a GPU) nothing changes.
 * `ANIM_SHOT_GPU=0/1` forces it off / on.
 */
export function shotGpuArgs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const forced = env.ANIM_SHOT_GPU?.trim();
  const on = forced === '1' || (forced !== '0' && env.ANIM_DESKTOP === '1');
  if (!on) return [];
  const angle = platform === 'darwin' ? 'metal' : platform === 'win32' ? 'd3d11' : 'vulkan';
  return ['--enable-gpu', '--ignore-gpu-blocklist', `--use-angle=${angle}`, '--enable-gpu-rasterization'];
}

/**
 * Load the shot page once and hand it to `run` for repeated captures.
 *
 * One page captures every frame: launching Chromium is the most expensive step here (hundreds of
 * ms), while seek plus capture takes tens of ms. So the expensive step happens once — a render
 * captures thousands of frames, and the difference is one minute versus half an hour.
 */

/**
 * Launch Chromium, installing it the first time. `npm install -g animspark` cannot fetch the
 * browser itself (package installs run no scripts by default), so without this the first
 * `anim look` would fail with Playwright's "Executable doesn't exist". Progress goes to stderr:
 * stdout carries JSON receipts and, under `anim mcp`, the protocol.
 * Set ANIMSPARK_NO_BROWSER_INSTALL=1 to get the plain error instead.
 */
async function launchChromium(
  chromium: typeof import('playwright').chromium,
  options: import('playwright').LaunchOptions,
): Promise<import('playwright').Browser> {
  try {
    return await chromium.launch(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Executable doesn't exist|browserType\.launch: .*(?:install|not found)/i.test(message) || process.env.ANIMSPARK_NO_BROWSER_INSTALL === '1') throw error;
    process.stderr.write('[anim] Chromium is not installed yet; downloading the headless Chromium every check, look and render uses (about 100 MB, once)…\n');
    const { createRequire } = await import('node:module');
    const { spawn } = await import('node:child_process');
    const { dirname: dirOf, join: joinPath } = await import('node:path');
    /* cli.js is not in playwright's `exports`, so find it next to the package manifest. */
    const cli = joinPath(dirOf(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
    await new Promise<void>((resolveInstall, rejectInstall) => {
      const child = spawn(process.execPath, [cli, 'install', '--only-shell', 'chromium'], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stderr);
      child.stderr.pipe(process.stderr);
      child.on('error', rejectInstall);
      child.on('exit', (code) => (code === 0 ? resolveInstall() : rejectInstall(new Error(
        `Installing Chromium failed (exit ${code}). Install it yourself with: npx playwright install chromium`,
      ))));
    });
    return chromium.launch(options);
  }
}

export async function withShot<T>(
  opts: ShotPageOptions,
  run: (shot: ShotSession) => Promise<T>,
): Promise<{ value: T; errors: string[]; choreo: Record<string, number> }> {
  const { chromium } = await import('playwright');
  const { page } = opts;
  const workspace = opts.workspace ?? dirname(page);

  /* Queue before launching Chromium. One shot costs ~1.4 cores and 0.9 GB, and agents run this
     command from their own sandbox — no in-process semaphore can see it. See shot-slots. */
  const { acquireShotSlot } = await import('./shot-slots');
  opts.signal?.throwIfAborted();
  const slot = opts.slot === false ? { granted: true, release() {} } : await acquireShotSlot();

  const scale = opts.scale != null
    ? Math.max(SHOT_SCALE_MIN, Math.min(SHOT_SCALE_MAX, opts.scale))
    : (opts.width ? opts.width / opts.stage.w : 1);
  /* Out-of-range values can only be clamped here — this layer doesn't know who asked for the number
     and has no way to reply. The real check belongs at the entry point (see clipShotWidth in
     clip-export): clamping means a user who asks for 8000 gets 3840 without a word in the report,
     a silent lie. */
  let browser: import('playwright').Browser | undefined;
  const onAbort = () => { void browser?.close().catch(() => {}); };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    browser = await launchChromium(chromium, {
      args: [
        '--no-sandbox',
        '--force-color-profile=srgb',
        /* HTML-in-Canvas (WICG; in Chromium, behind chrome://flags/#canvas-draw-element). The
           drawElementImage taught by the `web/html-in-canvas` manual depends on it — without it,
           films that use it capture as an empty canvas here, while the component's feature
           detection (DOM fallback when the API is missing) keeps check green: silently black.
           It only adds the API and leaves existing rendering alone — canvases without
           layoutsubtree behave as before. */
        '--enable-blink-features=CanvasDrawElement',
        /* The shot page is opened via file://. The runtime HTML-texture fallback (see
           html-texture in film-runtime) inlines @font-face bytes into SVG, and font files can only
           be read with XHR — fetch rejects file: by spec, and XHR does too without this flag. The
           native path (the flag above) is primary here; the fallback only takes over when it
           fails, but when it does, the font must not come out as Times. */
        '--allow-file-access-from-files',
        ...shotGpuArgs(),
      ],
    });
    if (opts.signal?.aborted) throw new FilmCliError('The export was cancelled');
    /* The viewport must include the timestamp strip. `#root` has a fixed size + overflow hidden
       (otherwise stage scaling would add scrollbars), so if the viewport is too short the strip
       is cut off — the capture looks perfectly normal, just without the timestamp. */
    const capH = opts.captioned ? captionHeight(opts.stage.w) : 0;
    const dsf = Math.max(SHOT_SCALE_MIN, Math.min(SHOT_SCALE_MAX, scale));
    const tab = await browser.newPage({
      viewport: { width: opts.stage.w, height: opts.stage.h + capH },
      deviceScaleFactor: dsf,
    });
    /* Collect errors the page throws. `__filmReady` is set in an effect, so any exception during
       rendering keeps it from ever becoming true — reporting just "timed out waiting" would then
       withhold the real cause (some MG blew up on the first frame), and this command exists
       precisely so the agent can inspect the picture. */
    const pageErrors: string[] = [];
    /* Keep uncaught exceptions separately: once one fires, the picture for this moment is gone
       (React unmounted the whole tree), and capturing would just wait for the stage node and time
       out 30s later with an error unrelated to the cause. */
    const uncaught: string[] = [];
    let seekedMs: number | null = null;
    tab.on('pageerror', (error) => { pageErrors.push(error.message); uncaught.push(error.message); });
    tab.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text());
    });

    /* The page is opened from file://. Fonts are served from the local font cache (fetched
       once, then offline); pointer-only assets fail loudly instead of rendering black. */
    await serveFontLibrary(tab);
    await serveWorkspaceMedia(tab, { worktree: workspace });
    await tab.goto(`file://${page}`);
    try {
      await tab.waitForFunction('window.__filmReady === true', undefined, { timeout: 15_000 });
    } catch {
      const mgErrors = await tab.evaluate(
        () => (window as unknown as { __FILM_ERRORS__?: string[] }).__FILM_ERRORS__ ?? [],
      ).catch(() => [] as string[]);
      const why = [...mgErrors, ...pageErrors];
      throw new FilmCliError(
        `The framing page never came up${why.length ? ':' : ' — the page reported no error, so the stage itself most likely will not render.'}\n`
        + why.map((line) => `  ${line}`).join('\n'),
      );
    }
    /* Wait for fonts to load: capturing while an @font-face is still downloading shows the fallback
       font, which is one of the problems look exists to catch. But fonts load on first use, so
       fonts.ready only tracks those already in flight — text that appears after a later seek
       hasn't been queued yet and would still render in the fallback font frame after frame. Kick
       off every declared face (load() ignores unicode-range) and start once all have settled;
       broken fonts don't block, 15s cap. */
    await tab.evaluate(async () => {
      const set = document.fonts;
      if (!set || typeof set.forEach !== 'function') return null;
      const deadline = Date.now() + 15000;
      // This callback is serialized into Chromium. A named nested function
      // would pull tsx's Node-only __name helper into the page (keepNames).
      while (true) {
        let pending = false;
        set.forEach((face) => {
          if (face.status === 'unloaded') face.load().catch(() => {});
          if (face.status !== 'loaded' && face.status !== 'error') pending = true;
        });
        if (set.status === 'loading') pending = true;
        if (!pending || Date.now() >= deadline) return null;
        await new Promise((r) => setTimeout(r, 100));
      }
    });

    /* Transparent background / single block. Added last — the film's own CSS is in the document
       head, and at equal specificity the later rule wins. */
    const css = stageCss({ alpha: opts.alpha, only: opts.only });
    if (css) await tab.addStyleTag({ content: css });

    // With a timestamp strip, capture picture + strip; without, just the picture.
    /* Prefixed ids: this locator is **global**, and `#shot` / `#stage` are names anyone might use.
       A node with the same id in the film makes the capture fail on the spot with a strict mode
       violation — and the error points at the shot command, with no hint that the film's own JSX
       collided. This has happened. */
    const shot = tab.locator(opts.captioned ? '#anim-shot' : '#anim-stage');
    /* The film may be framed inside #anim-stage (contain-scaled and centered). Canvas coordinates
       must go through this transform to become screenshot clip coordinates. Unframed, left/top=0
       and scale=1, a no-op. */
    const inner = await tab.evaluate(() => {
      const frame = (window as unknown as {
        __FILM_FRAME__?: { inner?: { left: number; top: number; scale: number } };
      }).__FILM_FRAME__;
      return frame?.inner ?? { left: 0, top: 0, scale: 1 };
    }).catch(() => ({ left: 0, top: 0, scale: 1 }));
    /* Single-clip export crops to the module's own region. If the editor already measured it, use
       that box — measuring again on the shot page often yields the full frame (wrapper is inset:0,
       attribute not applied yet). undefined = not measured yet; null = measured, and it is the
       full frame (full-bleed background / source fills the frame). */
    let paintClip: { x: number; y: number; width: number; height: number } | null | undefined
      = opts.crop ? shotClipOf(opts.crop, opts.stage, inner) : undefined;
    /* Fast path (see ShotPageOptions.fastPng). null = this frame doesn't take the fast path. */
    let cdp: import('playwright').CDPSession | null = null;
    let stageBox: { x: number; y: number; width: number; height: number } | null = null;
    const fastPngCapture = async (
      clip: { x: number; y: number; width: number; height: number } | null,
    ): Promise<Buffer | null> => {
      const animating = await tab.evaluate(() => (typeof document.getAnimations === 'function'
        ? document.getAnimations().some((a) => a.playState === 'running')
        : false)).catch(() => true);
      if (animating) return null;
      if (!cdp) {
        cdp = await tab.context().newCDPSession(tab);
        if (opts.alpha) {
          await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
        }
      }
      if (!clip) stageBox ??= await shot.boundingBox();
      const rect = clip ?? stageBox;
      if (!rect) return null;
      const r = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        optimizeForSpeed: true,
        captureBeyondViewport: false,
        /* CDP's clip is in CSS pixels and the output ignores the viewport's deviceScaleFactor —
           pass the scale here, or a 2x export gets a 1x image upscaled by ffmpeg (blurry, no
           error). */
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: dsf },
      });
      return Buffer.from(r.data, 'base64');
    };
    const session: ShotSession = {
      async collect() {
        return tab.evaluate(() => {
          const collect = (window as unknown as { __filmCollect?: () => import('@animspark/runtime').FilmSummary }).__filmCollect;
          if (!collect) throw new Error('This film page has no declaration collector.');
          return collect();
        });
      },
      async seek(atMs, label) {
        seekedMs = atMs;
        await tab.evaluate(
          ([ms, text]: [number, string]) => {
            (window as unknown as { __filmSeek: (n: number, s: string) => void })
              .__filmSeek(ms, text);
          },
          [atMs, label ?? ''] as [number, string],
        );
        /* Wait two frames: after a seek React has to commit, and most MG animations hang off layout
           effects. Waiting one frame captures the previous moment — the hardest kind of bug to
           find, because the picture itself looks right. */
        await tab.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
        }));
        /* Async work components register themselves (dynamically imported p5 / three loaders):
           `__filmPending` on the page holds those promises, and capture must wait for them to
           settle, or it catches the canvas while still empty. Capped — a hung import shouldn't
           stall the whole contact sheet. */
        await tab.evaluate(async () => {
          const w = window as unknown as { __filmPending?: Set<Promise<unknown>> };
          const started = Date.now();
          while (w.__filmPending?.size) {
            const left = 120000 - (Date.now() - started);
            if (left <= 0) throw Error('Film asynchronous frame did not settle.');
            await Promise.race([
              Promise.allSettled([...w.__filmPending]),
              new Promise((_resolve, reject) => setTimeout(() => reject(Error('Film asynchronous frame timed out.')), left)),
            ]);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
          }
          return null;
        });
        /* Videos need one more wait. The two frames above cover **synchronous** things like React
           and gsap; setting currentTime on a `<video>` triggers async decoding, and a long jump
           (start of film to 6s) decodes hundreds of frames — 33ms is nowhere near enough. Not
           waiting fails in two ways, neither with an error:
             · a video that already decoded frames shows the **previous** moment — the picture
               looks fine, it's just not that moment;
             · one just mounted with no decoded frame is simply blank — it shows up as "this clip
               is in the document but missing from the contact sheet", and only sometimes
               (observed: same document, same moment, different results across two runs).
           The latter is the costliest: the agent takes it for a wrong box or an occluding layer
           and chases a bug that doesn't exist. Frame-by-frame export advances one frame at a time,
           so the decoder is already there and this await returns at once — no slowdown. */
        /* **No named function bindings at all** in this block. It is serialized into the page and
           eval'd, and tsx's esbuild runs with keepNames — `const settle = () => {}` compiles to
           `__name(() => {}, "settle")`, a helper that exists only in the Node-side module scope,
           not on the page. The failure is very hard to attribute: with no <video> the map callback
           never runs and everything works; as soon as a video is on screen it throws
           `ReferenceError: __name is not defined`, with no clip id or asset id in the stack, so it
           looks like some MG failed to compile. Someone once bisected their own MG for eleven
           rounds over this. Hence only anonymous arrows below, cleaned up via { once: true }. */
        await tab.evaluate(() => Promise.all(
          [...document.querySelectorAll('video')].map((v) => (
            v.readyState >= 2 && !v.seeking
              ? null
              : new Promise((done) => {
                v.addEventListener('seeked', () => done(null), { once: true });
                v.addEventListener('loadeddata', () => done(null), { once: true });
                // A failed decode must not hang the whole shot — better a blank frame than a
                // stuck export. Resolving twice is safe (a settled promise doesn't change).
                setTimeout(() => done(null), 2000);
              })
          )),
        ));
        /* One more wait for pack components' async backends (MathJax for Formula, Pyodide +
           matplotlib for Mpl, and the like). The waits above cover React commits and video
           decoding; for backends that render a placeholder until loaded and then request another
           frame, only the pack layer knows whether they're ready — it exposes a probe as
           __animPacksReady (see react/pack in scene-engine). Without this wait, the first capture
           of such a frame lands on the placeholder, with not a single console error.

           The 120s cap is sized for the heaviest backend (Pyodide cold start: pyodide.js + numpy +
           matplotlib from a CDN, over ten MB), and only applies to the first frame; a backend that
           fails to load reports itself "ready" (the frame keeps its placeholder, the error goes
           to the console), so this loop rarely hits the cap. When it truly times out (network
           down), __animPacksGaveUp is set and later frames stop waiting — otherwise a 30fps
           render would waste two minutes per frame. */
        await tab.evaluate(() => new Promise((done) => {
          /* Same rule as above: function literals only as arguments, never bound to a named const
             (keepNames). Ask synchronously once before deciding to wait: a render passes through
             here frame by frame, and sleeping an extra 40ms per frame once the backend is ready
             adds over half a minute to the whole film. */
          const w = window as unknown as { __animPacksReady?: () => boolean; __animPacksGaveUp?: boolean };
          const ready = w.__animPacksReady;
          if (!ready || ready() || w.__animPacksGaveUp) {
            done(null);
            return;
          }
          const t0 = Date.now();
          const id = setInterval(() => {
            const up = Date.now() - t0 > 120_000;
            if (up) w.__animPacksGaveUp = true;
            if (ready() || up) {
              clearInterval(id);
              done(null);
            }
          }, 40);
        }));
      },
      async capture(captureOpts = {}) {
        if (uncaught.length) {
          const at = seekedMs == null ? '' : ` at ${(seekedMs / 1000).toFixed(3).replace(/\.?0+$/, '')}s`;
          throw new FilmRenderError(seekedMs, [...new Set(uncaught)],
            `The film threw while rendering${at}, so there is no frame to show:\n${[...new Set(uncaught)].map((line) => `  ${line}`).join('\n')}`);
        }
        if (opts.only && paintClip === undefined) {
          const stageW = opts.stage.w;
          const stageH = opts.stage.h;
          /* Bind to a const before the closure: `opts.only` is a property access, so narrowing
             doesn't survive into the arrow function body, and TS would see `string | undefined`. */
          const only = opts.only;
          const read = () => tab.evaluate((id: string) => {
            const w = window as unknown as { __filmClipPaint?: (clipId: string) => (
              { x: number; y: number; w: number; h: number } | null
            ) };
            return typeof w.__filmClipPaint === 'function' ? w.__filmClipPaint(id) : null;
          }, only).catch(() => null);
          /* The wrapper fills the stage before data-film-box is applied. Trusting 1920x1080 on the
             first frame would export the whole range full-frame. */
          let box = await read();
          for (let i = 0; i < 8; i += 1) {
            if (box && box.w >= 8 && box.h >= 8 && (box.w < stageW - 1 || box.h < stageH - 1)) break;
            await tab.evaluate(() => new Promise((done) => { setTimeout(() => done(null), 40); }));
            box = await read();
          }
          paintClip = box ? shotClipOf(box, opts.stage, inner) : null;
        }
        const wantsPng = !(captureOpts.jpegQuality != null && !opts.alpha);
        if (opts.fastPng && wantsPng) {
          const fast = await fastPngCapture(paintClip ?? null);
          if (fast) {
            if (captureOpts.path) writeFileSync(captureOpts.path, fast);
            return fast;
          }
        }
        // Locator screenshots always use the element's box and ignore `clip`.
        // A measured crop is in page coordinates, so capture it through Page.
        return (paintClip ? tab : shot).screenshot({
          animations: 'disabled',
          /* The browser's default background. The page's own layers are removed by the injected
             stylesheet; this one is Playwright's job — both are required. */
          ...(opts.alpha ? { omitBackground: true } : {}),
          ...(captureOpts.path ? { path: captureOpts.path } : {}),
          /* No JPEG when alpha is wanted. JPEG has no alpha channel and won't error — it flattens
             transparency to black, yielding a film with the right format and size but no alpha. */
          ...(captureOpts.jpegQuality != null && !opts.alpha
            ? { type: 'jpeg' as const, quality: captureOpts.jpegQuality }
            : {}),
          /* Isolating the block isn't enough: it only hides siblings, and the capture is still the
             whole canvas. An MG's native size is the component's own box (300x400), not 1920x1080. */
          ...(paintClip ? { clip: paintClip } : {}),
        });
      },
      async layout() {
        /* Same rule: no named function bindings in code serialized into the page (keepNames would
           pull in __name). */
        return tab.evaluate(() => {
          const root = document.getElementById('anim-film');
          if (!root) return [];
          /* elementsFromPoint skips pointer-events:none nodes, which MG layers over video often set —
             without overriding it, all their text would count as "cropped by a container". Removed
             after the check. */
          const hitAll = document.createElement('style');
          hitAll.textContent = '#anim-film, #anim-film * { pointer-events: auto !important; }';
          document.head.appendChild(hitAll);
          const box = root.getBoundingClientRect();
          const stageArea = box.width * box.height;
          const out: Array<{ text: string; issue: 'covered' | 'off-frame' | 'cropped' | 'straddles'; by?: string; share: number }> = [];
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const done = new Set<Element>();
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
            const el = node.parentElement;
            /* Two characters or fewer is usually decoration (a giant "5", letters split for
               per-letter animation), and those are also what gets placed behind images on purpose. */
            if (!el || done.has(el) || (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3) continue;
            done.add(el);
            let alpha = 1;
            for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
              const cs = getComputedStyle(e);
              if (cs.display === 'none' || cs.visibility === 'hidden') { alpha = 0; break; }
              alpha *= Number(cs.opacity);
            }
            if (alpha < 0.6) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            const rects = [...range.getClientRects()].filter((r) => r.width > 3 && r.height > 3);
            let points = 0; let off = 0; let cropped = 0; let covered = 0; let by = '';
            let straddles = 0; let photo = '';
            for (const r of rects) {
              /* A line of text half over a photo and half not: the photo's edge cuts through the text
                 (C2: "quad-core" over the corner of the chip photo). A line entirely on the image is
                 a label on the image and doesn't count. */
              let onPhoto = 0; let lineSeen = 0; let linePhoto = '';
              for (const fx of [0.03, 0.18, 0.34, 0.5, 0.66, 0.82, 0.97]) {
                for (const fy of [0.35, 0.65]) {
                  const x = r.left + r.width * fx; const y = r.top + r.height * fy;
                  points += 1;
                  if (x < box.left || x > box.right || y < box.top || y > box.bottom) { off += 1; continue; }
                  const stack = document.elementsFromPoint(x, y);
                  const mine = stack.findIndex((hit) => hit === el || el.contains(hit));
                  if (mine < 0) { cropped += 1; continue; }
                  lineSeen += 1;
                  for (let k = mine + 1; k < stack.length; k += 1) {
                    const under = stack[k]!;
                    if (under.contains(el) || !root.contains(under)) continue;
                    if (!['img', 'canvas', 'video'].includes(under.tagName.toLowerCase())) continue;
                    const ur = under.getBoundingClientRect();
                    if (ur.width * ur.height > stageArea * 0.8) continue;
                    onPhoto += 1;
                    if (!linePhoto) linePhoto = `<${under.tagName.toLowerCase()}>${under.getAttribute('src') ? ` ${(under.getAttribute('src') ?? '').split('/').pop()}` : ''}`;
                    break;
                  }
                  for (let k = 0; k < mine; k += 1) {
                    const hit = stack[k]!;
                    if (hit.contains(el) || !root.contains(hit)) continue;
                    const hr = hit.getBoundingClientRect();
                    if (hr.width * hr.height > stageArea * 0.8) continue;
                    const cs = getComputedStyle(hit);
                    let seen = 1;
                    for (let e: Element | null = hit; e && e !== root; e = e.parentElement) {
                      const ecs = getComputedStyle(e);
                      if (ecs.visibility === 'hidden') { seen = 0; break; }
                      seen *= Number(ecs.opacity);
                    }
                    if (seen < 0.5) continue;
                    const tag = hit.tagName.toLowerCase();
                    const bg = cs.backgroundColor.match(/[\d.]+/g);
                    const paints = ['img', 'canvas', 'video', 'path', 'rect', 'circle', 'ellipse', 'image', 'polygon', 'text'].includes(tag)
                      || cs.backgroundImage !== 'none'
                      || (bg !== null && (bg.length < 4 ? bg.length === 3 : Number(bg[3]) > 0.5))
                      || [...hit.childNodes].some((c) => c.nodeType === 3 && /[\p{L}\p{N}]/u.test(c.textContent ?? ''));
                    if (!paints) continue;
                    covered += 1;
                    if (!by) {
                      const src = hit.getAttribute('src') ?? hit.getAttribute('href') ?? '';
                      const own = [...hit.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent ?? '').join('').trim();
                      by = `<${tag}${typeof hit.className === 'string' && hit.className ? ` class="${hit.className.slice(0, 40)}"` : ''}>`
                        + (src ? ` ${src.split('/').pop()}` : own ? ` "${own.slice(0, 30)}"` : '');
                    }
                    break;
                  }
                }
              }
              if (onPhoto > 0 && onPhoto < lineSeen) { straddles += onPhoto; if (!photo) photo = linePhoto; }
            }
            if (!points) continue;
            /* Entirely off frame / entirely hidden by a container means it's parked offstage waiting
               to enter (carousel, mask not yet revealed) — not visible, so not a problem. Partly
               showing is. */
            if (off + cropped >= points) continue;
            const worst = Math.max(off, cropped, covered);
            if (worst >= 2 && worst / points >= 0.15) {
              const issue = worst === covered ? 'covered' : worst === off ? 'off-frame' : 'cropped';
              out.push({ text: text.slice(0, 48), issue, ...(issue === 'covered' && by ? { by } : {}), share: Math.round((worst / points) * 100) / 100 });
            } else if (straddles > 0) {
              out.push({ text: text.slice(0, 48), issue: 'straddles', by: photo, share: Math.round((straddles / points) * 100) / 100 });
            }
          }
          hitAll.remove();
          return out;
        }).catch(() => []);
      },
      async clipBounds(clipId) {
        return tab.evaluate((id: string) => {
          const w = window as unknown as {
            __filmClipPaint?: (clipId: string) => { x: number; y: number; w: number; h: number } | null;
            __filmClipEnvelope?: (clipId: string) => { x: number; y: number; w: number; h: number } | null;
          };
          return {
            paint: typeof w.__filmClipPaint === 'function' ? w.__filmClipPaint(id) : null,
            envelope: typeof w.__filmClipEnvelope === 'function' ? w.__filmClipEnvelope(id) : null,
          };
        }, clipId).catch(() => ({ paint: null, envelope: null }));
      },
      async onStage(clipId) {
        return tab.evaluate((id: string) => {
          /* Scan instead of using a selector: this call **validates the name**, and building a
             selector from that name would, when malformed, look exactly like "not on stage". */
          const all = document.querySelectorAll('[data-film-clip-id]');
          for (let i = 0; i < all.length; i += 1) {
            if (all[i]?.getAttribute('data-film-clip-id') === id) return true;
          }
          return false;
        }, clipId).catch(() => false);
      },
    };

    let value: T;
    try {
      value = await run(session);
    } catch (error) {
      /* Failures after the page came up: `__filmReady` is already true, so the branch above never
         runs, and Playwright reports "timed out waiting for #anim-stage" — which points at the
         shot command itself, hiding that some scene crashed the tree on its first frame (React
         unmounted the stage, so of course it never appears). The page errors are right here;
         dropping them throws away the only clue. */
      /* Our own render error already carries the cause and time; pass it through unchanged (the
         caller uses the time to find which block). */
      if (error instanceof FilmRenderError) throw error;
      const why = [
        ...await tab.evaluate(
          () => (window as unknown as { __FILM_ERRORS__?: string[] }).__FILM_ERRORS__ ?? [],
        ).catch(() => [] as string[]),
        ...pageErrors,
      ];
      if (!why.length) throw error;
      throw new FilmCliError(
        `${error instanceof Error ? error.message : String(error)}\n`
        + 'Errors on the page:\n'
        + why.slice(0, 8).map((line) => `  ${line}`).join('\n'),
      );
    }
    /* Page errors count too. A capture doesn't necessarily show an error — when a backend fails to
       initialize, the picture is a placeholder reading "Initializing WebGL…", and the cause is
       only in the console. Discarding the console on a successful shot would make that frame look
       like the film is meant to be that way. */
    const errors = [
      ...await tab.evaluate(
        () => (window as unknown as { __FILM_ERRORS__?: string[] }).__FILM_ERRORS__ ?? [],
      ),
      ...pageErrors,
    ];
    /* The choreography-end registry (see reportChoreoEnd in film-runtime's timeline): each MG block
       records "motion runs until second N" in a page global while building its timeline. Read it
       here; look compares it with block lengths to report frozen frames. Only blocks that were
       seeked into register (blocks never shown don't), so collect it after all frames ran. */
    const choreo = await tab.evaluate(
      () => (window as unknown as { __filmChoreoEnds?: Record<string, number> }).__filmChoreoEnds ?? {},
    ).catch(() => ({} as Record<string, number>));
    return { value, errors, choreo };
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    try {
      await browser?.close();
    } finally {
      // Always release the slot, including launch and cleanup failures.
      // Close Chromium before another holder can consume the same memory budget.
      slot.release();
    }
  }
}

/** Capture one frame to disk at each of the given milliseconds. */
/**
 * The page threw an uncaught exception while rendering. Carries the time it happened so the caller
 * can point to the block.
 */
export class FilmRenderError extends FilmCliError {
  constructor(readonly atMs: number | null, readonly errors: readonly string[], message: string) {
    super(message);
  }
}

export async function shootFrames(opts: {
  /** The shot page, already written (see code-shoot). */
  page: string;
  stage: { w: number; h: number };
  times: readonly number[];
  outDir: string;
  /** Explicit times can include multiple points inside the same millisecond. */
  uniqueNames?: boolean;
  /** The worktree root; defaults to the shot page's directory. */
  workspace?: string;
  width?: number;
  /**
   * Burn a timestamp strip under each frame. Contact sheets want it; single frames don't (it would
   * add a band below the native-resolution picture).
   */
  label?: (atMs: number) => string;
  /** Also check each frame for partly hidden text (look wants it, export doesn't). */
  audit?: boolean;
}): Promise<{ frames: ShotFrame[]; errors: string[]; choreo: Record<string, number>; layout: Array<LayoutIssue & { atMs: number }> }> {
  mkdirSync(opts.outDir, { recursive: true });
  const layout: Array<LayoutIssue & { atMs: number }> = [];
  const { value, errors, choreo } = await withShot({
    page: opts.page,
    stage: opts.stage,
    ...(opts.workspace ? { workspace: opts.workspace } : {}),
    ...(opts.width != null ? { width: opts.width } : {}),
    captioned: Boolean(opts.label),
  }, async (shot) => {
    const frames: ShotFrame[] = [];
    for (const [index, atMs] of opts.times.entries()) {
      await shot.seek(atMs, opts.label?.(atMs));
      const path = join(opts.outDir, `${opts.uniqueNames ? `${index}-` : ''}${lookStamp(atMs)}.png`);
      await shot.capture({ path });
      frames.push({ atMs, path });
      if (opts.audit) for (const issue of await shot.layout()) layout.push({ ...issue, atMs });
    }
    return frames;
  });
  return { frames: value, errors, choreo, layout };
}
