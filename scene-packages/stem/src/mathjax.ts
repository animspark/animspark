/**
 * MathJax loading - the single LaTeX → SVG entry point, shared by server and browser.
 *
 * **Loading and typesetting must be kept separate**; this is what makes live rendering of the
 * whole pipeline possible: once MathJax is loaded, `tex2svg` is a synchronous call, and the
 * `ComponentDef.render` contract happens to be synchronous too. So the whole pipeline has only
 * one async step (pulling the modules in the first time); after that, any moment and any
 * frame can produce the real image on the spot, with no server-side bake-then-paste step.
 * mpl does the same with Pyodide (see the header of mpl-runtime.ts).
 *
 * Runs on both sides: `liteAdaptor` does not touch the DOM, and `AllPackages` is pure JS. SVG
 * output uses `fontCache:'local'` to inline glyphs as `<path>`, so no extra math fonts need to
 * load; export, offline playback and headless frame capture never lose glyphs.
 * (The previous KaTeX generation had to stuff base64 woff2 into `<head>` to keep glyphs in
 * headless mode; that is exactly where it fell down.)
 */

/** One LaTeX string (display style, no outer `$`) → full SVG text. Synchronous once loaded. */
export type Tex2Svg = (tex: string) => string;

let loaded: Tex2Svg | null = null;
let loading: Promise<Tex2Svg> | null = null;

/**
 * Returns the renderer if already loaded, otherwise null.
 *
 * For the synchronous render path: null means "draw a placeholder for this frame", not "this
 * formula cannot be rendered". The caller should also kick off `loadMathjax()` and request a
 * repaint once it finishes.
 */
export function mathjaxSync(): Tex2Svg | null {
  return loaded;
}

/** Load MathJax (idempotent; concurrent calls share the same load). */
export function loadMathjax(): Promise<Tex2Svg> {
  if (loaded) return Promise.resolve(loaded);
  if (loading) return loading;
  loading = (async () => {
    const { mathjax: MJ } = await import('mathjax-full/js/mathjax.js');
    const { TeX } = await import('mathjax-full/js/input/tex.js');
    const { SVG } = await import('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = await import('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js');
    const { AllPackages } = await import('mathjax-full/js/input/tex/AllPackages.js');
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({ packages: AllPackages });
    const svg = new SVG({ fontCache: 'local' });
    const doc = MJ.document('', { InputJax: tex, OutputJax: svg });
    loaded = (src: string): string => adaptor.innerHTML(doc.convert(src, { display: true }));
    return loaded;
  })();
  /* On failure, forget this attempt. If we kept it (e.g. after a network blip), every later
     `loadMathjax()` would get the same rejected promise, and every formula in the film would
     stay stuck on its placeholder box forever, with no further error reported. */
  loading.catch(() => { loading = null; });
  return loading;
}
