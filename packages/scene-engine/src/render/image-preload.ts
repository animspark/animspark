/**
 * Image preloading: scan every image URL in the film IR and download them up front, so images aren't
 * still loading mid-playback.
 *
 * Why: the Canvas renderer skips an <image> that hasn't loaded and redraws on a later frame. During
 * playback the audio clock drives rAF, so some later frame naturally fills it in. But on the first frame,
 * while paused, or during export, nothing triggers a redraw -> the image stays missing.
 * Fix: after the scene compiles and before the player allows playback, preload all URLs in one pass,
 * with a timeout fallback.
 *
 * Side effect: this populates the same imageCache in canvas.ts (href -> HTMLImageElement), so after one
 * preload later renders reuse it directly, with zero duplicate requests.
 */
import type { CompiledScene } from '../core/types';
import type { ParamValue } from '../core/types';
import { BAKED_SVG, svgImageHref } from '../kit';
import { cacheSvgDocument, imageCache, isSvgImageHref, loadImageWithCorsFallback, svgDocCache } from './canvas';

/** Recursively scan params for image URLs (http/https, data:image, or assets|resource/ relative paths). */
function isImageUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^data:image\//i.test(s) || /^(?:assets|resource)\//i.test(s);
}

function collectFromValue(v: ParamValue, out: Set<string>): void {
  if (typeof v === 'string') {
    if (isImageUrl(v)) out.add(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectFromValue(x, out);
    return;
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) collectFromValue((v as Record<string, ParamValue>)[k]!, out);
  }
}

/** Scan the keyframe params of an entire CompiledScene and collect a deduplicated list of image URLs */
export function collectImageUrls(scene: CompiledScene): string[] {
  const set = new Set<string>();
  for (const tr of scene.tracks) {
    for (const kf of tr.keyframes) {
      collectFromValue(kf.props.params as ParamValue, set);
      // Baked html/markdown: convert the _svg injected by bake into a data URL ahead of time and warm it too.
      // Otherwise the data URL is first generated on the frame where set swaps content -> Canvas decodes on the spot and
      // leaves a frame or two blank -> the whole block flickers. On replay it's already in imageCache so there's no flicker;
      // warming it makes the first play match replays, smoothly.
      const params = kf.props.params as Record<string, ParamValue> | undefined;
      const baked = params?.[BAKED_SVG];
      if (typeof baked === 'string' && baked.includes('<svg')) {
        const href = svgImageHref(baked);
        if (href) set.add(href);
      }
    }
  }
  return [...set];
}

/**
 * Preload a set of URLs; returns Promise<list of URLs that loaded successfully>.
 * - An imageCache hit reuses the same HTMLImageElement; later Canvas renders don't wait.
 * - A single image timing out (default 8s) doesn't block the whole process; that image just shows a gray placeholder on the first frame.
 * - onProgress is an optional callback the player can use to show loading progress.
 */
export function preloadImages(
  urls: string[],
  opts: { timeoutMs?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<string[]> {
  const { timeoutMs = 8000, onProgress } = opts;
  if (typeof Image === 'undefined' || !urls.length) return Promise.resolve([]);
  const total = urls.length;
  let done = 0;
  const tick = (): void => { done++; onProgress?.(done, total); };
  return Promise.all(
    urls.map(href => new Promise<string | null>(resolve => {
      if (isSvgImageHref(href) && typeof fetch !== 'undefined') {
        if (svgDocCache.has(href)) {
          tick();
          resolve(href);
          return;
        }
        let settled = false;
        const finish = (ok: boolean): void => {
          if (settled) return;
          settled = true;
          tick();
          resolve(ok ? href : null);
        };
        void fetch(href)
          .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
          .then(text => finish(cacheSvgDocument(href, text)))
          .catch(() => finish(false));
        window.setTimeout(() => finish(false), timeoutMs);
        return;
      }

      let img = imageCache.get(href);
      if (img && img.complete && img.naturalWidth) {
        tick();
        resolve(href);
        return;
      }
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        tick();
        resolve(ok ? href : null);
      };
      if (!img) {
        // With the CORS fallback, a CORS failure automatically retries without crossOrigin, so the first error here is not final;
        // settle only on a successful load or on timeout (the timeout covers the case where both attempts fail).
        img = loadImageWithCorsFallback(href, () => finish(true));
        imageCache.set(href, img);
      } else {
        const cur = img;
        cur.addEventListener('load', () => finish(true), { once: true });
        if (cur.complete && cur.naturalWidth) finish(true);
      }
      window.setTimeout(() => finish(false), timeoutMs);
    })),
  ).then(rs => rs.filter((s): s is string => !!s));
}

/** Register an alias for the same HTMLImageElement / SVG document (e.g. resource/ -> the task-resource API URL). */
export function aliasImageCache(aliasHref: string, canonicalHref: string): void {
  const img = imageCache.get(canonicalHref);
  if (img) imageCache.set(aliasHref, img);
  const doc = svgDocCache.get(canonicalHref);
  if (doc) svgDocCache.set(aliasHref, doc);
}
