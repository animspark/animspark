/**
 * imgproc function - live client-side image processing (Pillow/PIL + numpy, running on the shared Pyodide).
 *
 * A Function does not render screen elements itself. Authors place the picture with a native <canvas id="...">;
 * imgproc({ id, src, code, P }) returns { P, render, renderNow, ref }; tween P with GSAP, then call render.
 */
import type { FunctionDef } from '@animspark/scene-engine';
import { getSyncImageSource, onImageReady } from '@animspark/scene-engine/playback';
import { pilRenderHref, pilReadyFor } from './pil-runtime';

export const IMGPROC_FUNCTION_DEF: FunctionDef = {
  name: 'imgproc',
  doc: 'PIL/numpy image-processing function. It does not render anything itself; it returns a canvas binding + P + render. Display it with a native <canvas id="..."/>, tween x.P with GSAP and call x.render in onUpdate.',
  details: [
    '- imgproc is a Function, not a Component: do not write <Imgproc />.',
    '- src is a workspace-relative image under assets/ (e.g. assets/photo.png; user uploads land in assets/upload/) or any image URL the page can load; imgproc only consumes the image, it does not decide where it comes from.',
    '- In code define def render(P, img): img is a PIL.Image (RGBA); return a PIL.Image or a numpy array (uint8; RGB/RGBA/grayscale are all normalized).',
    '- Current stable pattern: imgproc({ id:"edgeCanvas", ... }) + <canvas id="edgeCanvas" />. The returned object also carries ref, so once real React refs are supported you can write <canvas ref={edge.ref} />.',
    '- Performance first: render draws the PIL/numpy result straight onto the canvas, with no <img src> / base64 / component wrapper.',
  ].join('\n'),
  paramDocs: {
    src: 'Source image: usually assets/xxx.png (workspace-relative); can also be any relative/absolute image URL the page can load.',
    code: 'Python source string: define render(P, img) - process one frame with standard PIL/numpy and return the processed PIL.Image or numpy array.',
    P: 'Initial parameter dict (e.g. { threshold: 80 }); tween this object with GSAP and call render in onUpdate.',
    id: 'Optional: stable slot id. Recommended when calling imgproc several times or reusing it across beats.',
  },
  defaults: { src: '', code: '', P: {}, id: '' },
  returns: '{ ref, P, render, src }',
};

export interface ImgprocSpec {
  id?: string;
  src?: string;
  code?: string;
  P?: Record<string, unknown>;
}

function stripGsap(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k !== '_gsap') out[k] = v;
  }
  return out;
}

function escapeAttrSelector(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findCanvas(id: string, explicit: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (explicit?.isConnected) return explicit;
  if (!id || typeof document === 'undefined') return null;
  const cssId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  const all = Array.from(document.querySelectorAll<HTMLCanvasElement>(`canvas#${cssId},canvas[data-ref="${escapeAttrSelector(id)}"]`));
  return all.find((el) => {
    const shot = el.closest<HTMLElement>('[data-shot]');
    return !shot || getComputedStyle(shot).display !== 'none';
  }) ?? all[0] ?? null;
}

/**
 * TSX authoring function: returns a canvas control object. Display is left to native HTML/CSS/GSAP.
 */
export function imgproc(spec: ImgprocSpec = {}) {
  const id = String(spec.id || `imgproc-${Math.random().toString(36).slice(2)}`);
  const src = String(spec.src || '');
  const code = String(spec.code || '');
  const P = { ...(spec.P ?? {}) };
  let canvas: HTMLCanvasElement | null = null;
  let raf = 0;
  let subscribed = false;

  const api = {
    id,
    src,
    P,
    /** Playback gate: ready only once Pyodide + the code + the source image are all ready (see the runtime's assets-ready roll-up). */
    ready(): boolean {
      return pilReadyFor(code, src);
    },
    ref(el: HTMLCanvasElement | null) {
      canvas = el;
      if (el) api.renderNow();
    },
    render() {
      if (raf || typeof requestAnimationFrame === 'undefined') return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        api.renderNow();
      });
    },
    renderNow() {
      const target = findCanvas(id, canvas);
      if (!target || !code) return;
      const href = pilRenderHref(code, src, stripGsap(P), id);
      if (!href) {
        if (!subscribed) {
          subscribed = true;
          onImageReady(api.renderNow);
        }
        return;
      }
      const source = getSyncImageSource(href);
      if (!source) return;
      const rect = target.getBoundingClientRect();
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const w = Math.max(1, Math.round((rect.width || target.width || 1024) * dpr));
      const h = Math.max(1, Math.round((rect.height || target.height || 1024) * dpr));
      if (target.width !== w) target.width = w;
      if (target.height !== h) target.height = h;
      const ctx = target.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      try {
        ctx.drawImage(source, 0, 0, w, h);
      } catch {
        // keep last frame when the source is mid-update
      }
    },
  };

  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>)[id] = api;
    // Register in the playback component table: the runtime relies on it to (1) prewarm src into imageCache (the imgproc source image
    // may not be in any <img>; without registering, getCachedImageSource never finds it -> the canvas stays black);
    // (2) redraw everything on seek/beat changes.
    const w = window as unknown as { __animsparkComponents?: unknown[] };
    w.__animsparkComponents = w.__animsparkComponents || [];
    w.__animsparkComponents.push(api);
  }
  return api;
}
