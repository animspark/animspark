/**
 * Compiles the workspace inside the iframe. code-host injects this file verbatim into the host page.
 *
 * Shared packages (three) go through the import map + import(), cached by the browser;
 * workspace source comes from `/film/code-bundle` in one request. esbuild used to discover imports
 * while resolving and fetch them level by level, five levels in series; now resolve/load run entirely
 * in memory. **Compilation still happens in this page**; not a byte of bundling moved to the server.
 *
 * Three things that used to be redone on every open and no longer are:
 *   · **Build output is stored by source fingerprint** (Cache API). Reopening the same source, the
 *     thumbnail frame, undoing back to an old version: all free, without even initializing esbuild.
 *   · **The 12.3 MB wasm is instantiated only when a build is really needed**. A cache hit never touches it.
 *   · **Editing the film no longer swaps the document**. The outer page sends `refresh` and this page
 *     rebuilds and remounts in place, saving a full page reload, re-parsing the 2 MB host script and
 *     re-instantiating wasm.
 */
(function () {
  var post = function (msg) { try { parent.postMessage(msg, '*'); } catch (e) {} };
  /* The list is written by the host page (host-shared.ts); do not copy it here too, a missing entry means a 404 in preview. */
  var SHARED = window.__FILM_SHARED_SPECS__ || {};

  var codeBase = window.__FILM_CODE_BASE__;
  var vendorBase = window.__FILM_VENDOR_BASE__;
  var pkgBase = window.__FILM_PKG_BASE__ || vendorBase;
  var bundleUrl = window.__FILM_BUNDLE_URL__;
  var buildRev = window.__FILM_BUILD_REV__ || '0';
  var fileBase = (document.querySelector('base') && document.querySelector('base').href) || '/';
  /* The benchmark measures the old path (`/film/host?legacy=1`): no bundle fetch, no build cache, files fetched one by one. */
  var legacy = Boolean(window.__FILM_LEGACY__);

  /** Build cache. The key includes the compiler's own version: when the compiler changes, old output must not be reused. */
  var BUILD_CACHE = 'anim-film-build-v4';

  function extOf(path) {
    var i = String(path).lastIndexOf('.');
    return i < 0 ? '' : String(path).slice(i).toLowerCase();
  }

  /* Whether the specifier itself has a **source** extension. In `./figure-boxes.gen` the `.gen` is not an
     extension but part of the file name; on disk it is `figure-boxes.gen.ts`. Judging by the last dot alone
     would treat it as complete and request a file that does not exist. The node-side esbuild uses this same
     extension table; this matches it. */
  var SOURCE_EXT = { '.tsx': 1, '.ts': 1, '.jsx': 1, '.js': 1, '.mjs': 1, '.cjs': 1, '.json': 1, '.css': 1,
    '.png': 1, '.jpg': 1, '.jpeg': 1, '.webp': 1, '.gif': 1, '.svg': 1, '.avif': 1, '.woff': 1, '.woff2': 1, '.ttf': 1, '.otf': 1,
    '.mp4': 1, '.webm': 1, '.mov': 1, '.mp3': 1, '.m4a': 1, '.wav': 1, '.txt': 1, '.md': 1 };
  function hasSourceExt(path) {
    return Boolean(SOURCE_EXT[extOf(path)]);
  }

  function loaderOf(path) {
    var ext = extOf(path);
    if (ext === '.tsx') return 'tsx';
    if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts';
    if (ext === '.jsx') return 'jsx';
    if (ext === '.css') return 'css';
    if (ext === '.json') return 'json';
    return 'js';
  }

  function isImage(path) {
    var ext = extOf(path);
    return ext === '.png' || ext === '.jpg' || ext === '.jpeg'
      || ext === '.svg' || ext === '.webp' || ext === '.gif';
  }

  function isFont(path) {
    var ext = extOf(path);
    return ext === '.woff' || ext === '.woff2' || ext === '.ttf' || ext === '.otf';
  }

  function isThree(spec) {
    return spec === 'three' || spec.indexOf('three/') === 0;
  }

  function isBare(spec) {
    return Boolean(spec) && spec.charAt(0) !== '.' && spec.charAt(0) !== '/';
  }

  function joinRel(fromDir, spec) {
    var dir = String(fromDir || '').replace(/\\/g, '/').replace(/^\.\/?$/, '');
    var base = dir ? dir.replace(/\/?$/, '/') : '';
    var url = new URL(spec, 'https://film.invalid/' + base);
    return decodeURIComponent(url.pathname.replace(/^\//, ''));
  }

  function parentDir(path) {
    var norm = String(path).replace(/\\/g, '/');
    var i = norm.lastIndexOf('/');
    return i < 0 ? '' : norm.slice(0, i);
  }

  function encodePath(rel) {
    return String(rel).split('/').map(encodeURIComponent).join('/');
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(url + ' ' + res.status);
      return res.text();
    });
  }

  function mimeImage(path) {
    var ext = extOf(path);
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return 'image/png';
  }

  function toDataUrl(url, mime) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(url + ' ' + res.status);
      return res.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        var chunk = 0x8000;
        var bin = '';
        for (var i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
        }
        return 'data:' + mime + ';base64,' + btoa(bin);
      });
    });
  }

  function kindOf(args) {
    if (args.namespace === 'npm' || args.namespace === 'three') return args.namespace;
    if (args.pluginData && args.pluginData.kind) return args.pluginData.kind;
    return 'ws';
  }

  /* ── Source bundle ───────────────────────────────────────────── */

  /**
   * Fetch the bundle, retrying disconnects and 5xx three times before giving up.
   *
   * This request has to survive "the server is on its way back": for a few seconds after a restart the
   * upstream returns 503 or drops the connection, and a failure here means a cell full of red text that
   * the user can only fix by refreshing. 4xx is not retried: 404 means "this project has no film", and
   * asking again will not change that.
   */
  function fetchBundle() {
    var delays = [800, 2000, 5000];
    function attempt(i) {
      return fetch(bundleUrl, { cache: 'no-cache' }).then(function (res) {
        if (res.ok) return res.json();
        if (res.status >= 500 && i < delays.length) return later(i);
        throw new Error('code-bundle ' + res.status);
      }, function (e) {
        if (i < delays.length) return later(i);
        throw e;
      });
    }
    function later(i) {
      return new Promise(function (resolve) { setTimeout(resolve, delays[i]); })
        .then(function () { return attempt(i + 1); });
    }
    return attempt(0);
  }

  /**
   * The host page already sent this request on its first line (see code-host); usually this just picks it up.
   * If the picked-up request failed, fetch again rather than caching a transient failure as permanent red text.
   *
   * `reload` is used after an edit: ask with the ETag; the server answers 304 if the source is unchanged and
   * sends a new body only if it changed.
   */
  function loadBundle(reload) {
    if (legacy || !bundleUrl) return Promise.resolve(null);
    if (!reload && window.__FILM_BUNDLE__) {
      var held = window.__FILM_BUNDLE__.catch(function () { return fetchBundle(); }).then(adoptMediaBase);
      window.__FILM_BUNDLE__ = held;
      return held;
    }
    var p = fetchBundle().then(adoptMediaBase);
    window.__FILM_BUNDLE__ = p;
    return p;
  }

  /**
   * A local project in the desktop app: media is read straight from disk (`anim-media://`).
   * Only when the outer page really is the desktop shell (`animsparkDesktop` is put there by its
   * preload): an ordinary browser has no such protocol and would show black. Reading the outer
   * page needs the same origin; a cross-origin parent is never used.
   */
  function adoptMediaBase(bundle) {
    try {
      if (bundle && typeof bundle.mediaBase === 'string' && window.parent !== window && window.parent.animsparkDesktop) {
        window.__FILM_MEDIA_BASE__ = bundle.mediaBase;
      }
    } catch (e) { /* cross-origin parent */ }
    return bundle;
  }

  /** Find a workspace file in the bundle. Returns null if missing, and the caller falls back to fetching it on its own. */
  function fromBundle(bundle, path) {
    if (!bundle || !bundle.files) return null;
    var rel = String(path).replace(/^\/+/, '').replace(/^\.\//, '');
    var candidates = [rel];
    if (!hasSourceExt(rel)) {
      candidates.push(rel + '.tsx', rel + '.ts', rel + '.js', rel + '/index.tsx', rel + '/index.ts');
    }
    for (var i = 0; i < candidates.length; i++) {
      var text = bundle.files[candidates[i]];
      if (typeof text === 'string') return { rel: candidates[i], text: text };
    }
    return null;
  }

  /* ── esbuild ────────────────────────────────────────────────── */

  var initPromise = null;

  /**
   * Instantiate the wasm only when a build is really needed.
   *
   * On a build-cache hit these 12.3 MB are never touched, which is the normal case when reopening a
   * project you just looked at.
   */
  function ensureEsbuild() {
    if (!initPromise) {
      var start = function () {
        return esbuild.initialize({ wasmURL: pkgBase + 'esbuild.wasm', worker: true });
      };
      /* Don't keep a rejected promise around: if the 12 MB download breaks once (a network blip, a
         slow server), every later compile would get the same reject until the user reloads the page.
         esbuild clears its own state after a failure and allows initialize again, so retry once after
         a short delay, surface the error only if that fails too, and the next compile tries again. */
      initPromise = start()
        .catch(function () {
          return new Promise(function (r) { setTimeout(r, 800); }).then(start);
        })
        .catch(function (error) {
          initPromise = null;
          throw error;
        });
    }
    return initPromise;
  }

  /* Entry for the code form. The entry for the arrangement-document form (film.json) comes from the server
     with the bundle (bundle.entry, see docEntryFor in code-bundle): the document is not a module, so the
     browser cannot enter through it directly. */
  var TSX_ENTRY = 'export { default } from "./film.tsx";\nexport * from "./film.tsx";';

  async function runBuild(bundle) {
    try {
      await ensureEsbuild();
      var result = await esbuild.build({
        stdin: { contents: (bundle && bundle.entry) || TSX_ENTRY, resolveDir: '.', loader: 'js' },
        bundle: true,
        write: false,
        outdir: '/out',
        format: 'iife',
        globalName: '__ANIM_FILM__',
        platform: 'browser',
        target: ['es2022'],
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent',
        plugins: [{
          name: 'anim-client',
          setup: function (build) {
            build.onResolve({ filter: /.*/ }, function (args) {
              var spec = args.path;
              if (spec.charAt(0) === '\0') return null;
              if (spec === 'animspark:runtime-host') return { path: '@animspark/runtime', namespace: 'shared' };
              if (spec === '@animspark/runtime' && bundle && bundle.runtimeSource) {
                return { path: spec, namespace: 'project-runtime' };
              }
              if (SHARED[spec]) return { path: spec, namespace: 'shared' };
              if (spec.indexOf('http://') === 0 || spec.indexOf('https://') === 0 || spec.indexOf('data:') === 0) {
                return { path: spec, external: true };
              }

              var kind = kindOf(args);
              var fromDir = (args.pluginData && args.pluginData.dir) || (kind === 'ws' || kind === 'npm' ? args.resolveDir : '') || '';
              /* Workspace-relative paths (`assets/…`, `mg/…`) are accepted even when written bare: documents and
                 components write them that way everywhere (`url("assets/fonts/x/a.woff2")`, `src="assets/image/a.png"`),
                 and they cannot be npm package names. Otherwise fonts would be requested from /vendor/, 404, and the
                 whole film would fall back to system fonts. */
              var wsBare = isBare(spec) && /^(assets|mg)\//.test(spec);
              var resolved = isBare(spec) ? spec : joinRel(fromDir, spec);

              if (isFont(spec) || isFont(resolved)) {
                if ((kind === 'npm' || isBare(spec)) && !wsBare) {
                  return { path: vendorBase + resolved, external: true };
                }
                return { path: new URL(resolved, fileBase).href, external: true };
              }

              if (wsBare) {
                return { path: spec, namespace: 'ws', pluginData: { dir: parentDir(spec), kind: 'ws' } };
              }

              if (isThree(spec) || isThree(resolved)) {
                return { path: isBare(spec) ? spec : resolved, namespace: 'three' };
              }

              if (spec.charAt(0) === '/') {
                var absPath = spec.replace(/^\/+/, '');
                return { path: absPath, namespace: 'ws', pluginData: { dir: parentDir(absPath), kind: 'ws' } };
              }

              if (isBare(spec)) {
                return { path: spec, namespace: 'npm', pluginData: { dir: parentDir(spec), kind: 'npm' } };
              }

              if (kind === 'npm') {
                return { path: resolved, namespace: 'npm', pluginData: { dir: parentDir(resolved), kind: 'npm' } };
              }

              return { path: resolved, namespace: 'ws', pluginData: { dir: parentDir(resolved), kind: 'ws' } };
            });

            build.onLoad({ filter: /.*/, namespace: 'shared' }, function (args) {
              return {
                contents: 'module.exports = window.__ANIM_MG_DEPS__[' + JSON.stringify(args.path) + '];',
                loader: 'js',
              };
            });

            build.onLoad({ filter: /.*/, namespace: 'project-runtime' }, function () {
              return { contents: bundle.runtimeSource, loader: 'js' };
            });

            build.onLoad({ filter: /.*/, namespace: 'three' }, async function (args) {
              if (!window.__ANIM_MG_DEPS__[args.path]) {
                window.__ANIM_MG_DEPS__[args.path] = await import(args.path);
              }
              return {
                contents: 'module.exports = window.__ANIM_MG_DEPS__[' + JSON.stringify(args.path) + '];',
                loader: 'js',
              };
            });

            build.onLoad({ filter: /.*/, namespace: 'npm' }, async function (args) {
              var text = await fetchText(vendorBase + encodePath(args.path));
              return {
                contents: text,
                loader: loaderOf(args.path),
                pluginData: { dir: parentDir(args.path), kind: 'npm' },
                resolveDir: parentDir(args.path),
              };
            });

            build.onLoad({ filter: /.*/, namespace: 'ws' }, async function (args) {
              var path = String(args.path).replace(/^\/+/, '').replace(/^\.\//, '');

              /* Use the bundle copy if there is one: this is where five serial levels collapse into one. */
              var hit = fromBundle(bundle, path);
              if (hit) {
                return {
                  contents: hit.text,
                  loader: loaderOf(hit.rel),
                  pluginData: { dir: parentDir(hit.rel), kind: 'ws' },
                  resolveDir: parentDir(hit.rel),
                };
              }

              /* Not in the bundle: images (the bundle holds only text) or files left out for size. Fetch them one by one. */
              var candidates = [path];
              if (!hasSourceExt(path)) {
                candidates.push(path + '.tsx', path + '.ts', path + '.js', path + '/index.tsx', path + '/index.ts');
              }
              var lastErr = null;
              for (var i = 0; i < candidates.length; i++) {
                var rel = candidates[i];
                try {
                  if (isImage(rel)) {
                    var data = await toDataUrl(new URL(rel, fileBase).href, mimeImage(rel));
                    return {
                      contents: 'export default ' + JSON.stringify(data) + ';',
                      loader: 'js',
                      pluginData: { dir: parentDir(rel), kind: 'ws' },
                      resolveDir: parentDir(rel),
                    };
                  }
                  var text = await fetchText(codeBase + encodePath(rel));
                  return {
                    contents: text,
                    loader: loaderOf(rel),
                    pluginData: { dir: parentDir(rel), kind: 'ws' },
                    resolveDir: parentDir(rel),
                  };
                } catch (e) {
                  lastErr = e;
                }
              }
              throw lastErr || new Error('missing ' + path);
            });
          },
        }],
      });
      var files = result.outputFiles || [];
      return {
        css: files.filter(function (f) { return /\.css$/i.test(f.path); }).map(function (f) { return f.text; }).join('\n'),
        js: files.filter(function (f) { return /\.js$/i.test(f.path); }).map(function (f) { return f.text; }).join('\n'),
      };
    } finally {
      // WASM memory only grows. Release the compiler worker after every build,
      // including failures; rendered output is ordinary JS/CSS and stays usable.
      esbuild.stop();
      initPromise = null;
    }
  }

  /* ── Build cache ─────────────────────────────────────────────── */

  /**
   * The asset-shelf double-click / poster path: build only this one MG.
   *
   * The bundle entry imports only modules named in film.json, so an unused `mg/hello` would not be built.
   * Only a valid query string is accepted, since it ends up in an import path and `..` must not get through.
   * Keep the same shape as core's parseFilmMgPreview / filmMgPreviewEntry.
   */
  function previewSrc() {
    try {
      var raw = new URLSearchParams(location.search).get('preview') || '';
      raw = raw.replace(/^\/+/, '').replace(/\/+$/, '');
      if (!raw || raw.indexOf('..') >= 0 || raw.indexOf('\\') >= 0) return '';
      return /^(?:mg\/[A-Za-z0-9._/-]+|assets\/mg\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/v[1-9][0-9]*)?)$/.test(raw) ? raw : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * The stage size while previewing this one clip.
   *
   * It has to come from the query string: the host page HTML is **one compile shell** shared by every
   * project, and its `__FILM_STAGE__` can only hard-code one value (1920x1080). Preview mode **does not read
   * film.json** (see `if (!preview) await seedDoc` below), so a portrait project's module would be laid out
   * on a landscape stage: `inset:0` fills the wrong way, `--film-w` gives the wrong width, and anything pinned
   * to the right edge ends up off-frame.
   *
   * Without it, fall back to the shell's value, so old URLs (without the parameter) still work.
   */
  function previewStage(fallback) {
    try {
      var m = /^(\d{2,5})x(\d{2,5})$/.exec(new URLSearchParams(location.search).get('stage') || '');
      if (!m) return fallback;
      return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
    } catch (e) {
      return fallback;
    }
  }

  function previewEntrySource(src, stage, project, facts, assets, words) {
    var runtimeAssets = 'filmAssetsWithWords(' + JSON.stringify(assets || {}) + ',' + JSON.stringify(words || {}) + ')';
    if (/^assets\/mg\//.test(src)) return [
      'import { filmFromLiveDoc, filmAssetsWithWords } from "@animspark/runtime";',
      'const __film=filmFromLiveDoc(()=>globalThis.__FILM_DOC__,{},' + runtimeAssets + ',' + JSON.stringify(facts && facts.dur ? { [src + '/media.webm']: facts.dur } : {}) + ', {projects:' + JSON.stringify(project ? { [src]: project } : {}) + '});',
      'export const stage=' + JSON.stringify(stage) + ';export default __film.Film;',
    ].join('\n');
    return [
      'import { filmFromLiveDoc, filmAssetsWithWords } from "@animspark/runtime";',
      'import __mg, * as __mgNs from ' + JSON.stringify('./' + src) + ';',
      /* Match the normal film entry. Only legacy modules with neither duration
         declaration use a measured duration or the three-second preview fallback. */
      'Object.assign(__mg, {duration: __mg.duration ?? __mgNs.durationSec ?? ' + JSON.stringify(facts && facts.dur != null ? facts.dur : 3) + ', sounds: __mgNs.sounds});',
      'const __film = filmFromLiveDoc(() => globalThis.__FILM_DOC__, {',
      '  ' + JSON.stringify(src) + ': __mg,',
      '}, ' + runtimeAssets + ', {});',
      'export const stage = ' + JSON.stringify(stage) + ';',
      'export default __film.Film;',
      '',
    ].join('\n');
  }

  function buildKey(srcHash) {
    var preview = previewSrc();
    /* The stage goes into the key: previewEntrySource writes it into the entry source, so two stages are two
       different builds. Otherwise a portrait project would hit a landscape project's cached build, showing up
       as "switched projects and the module is still laid out wrong". */
    var stage = preview ? previewStage(null) : null;
    return '/__film-build/' + encodeURIComponent(buildRev) + '/' + encodeURIComponent(srcHash)
      + (preview ? '/' + encodeURIComponent(preview) : '')
      + (stage ? '/' + stage.w + 'x' + stage.h : '');
  }

  async function readCachedBuild(srcHash) {
    if (legacy || !srcHash || typeof caches === 'undefined') return null;
    try {
      var c = await caches.open(BUILD_CACHE);
      var hit = await c.match(buildKey(srcHash));
      if (!hit) return null;
      var out = await hit.json();
      return out && typeof out.js === 'string' && out.js ? out : null;
    } catch (e) {
      return null;
    }
  }

  async function writeCachedBuild(srcHash, out) {
    if (legacy || !srcHash || typeof caches === 'undefined') return;
    try {
      var c = await caches.open(BUILD_CACHE);
      await c.put(
        buildKey(srcHash),
        new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } }),
      );
    } catch (e) { /* Failing to store does not affect this render */ }
  }

  /**
   * Get the build output for this version of the source.
   *
   * `skipCache` is used on the edit path: the source really changed, so reading the cache would be a wasted trip.
   */
  async function buildFor(bundle, skipCache) {
    var srcHash = bundle && bundle.srcHash;
    if (!skipCache) {
      var hit = await readCachedBuild(srcHash);
      if (hit) return { js: hit.js, css: hit.css, fromCache: true };
    }
    var out = await runBuild(bundle);
    if (!out.js) throw new Error('The film build output is empty');
    void writeCachedBuild(srcHash, out);
    return { js: out.js, css: out.css, fromCache: false };
  }

  /* ── Mounting ────────────────────────────────────────────────── */

  /**
   * The runtime modules the build output asks for by name, i.e. the three family.
   *
   * These packages are not in the build; the output keeps a lookup like `window.__ANIM_MG_DEPS__["three"]`,
   * so one three is shared by the whole film, and the export and the preview must use the same instance.
   *
   * **Who puts it there** is why this exists. It used to be a side effect of compiling (the `three` onLoad
   * called `import()` before returning the lookup), so "the output runs" silently depended on "it was just
   * compiled". Once the output came free from the cache, that import never happened: the lookup returned
   * undefined and the screen showed `THREE.WebGLRenderer is not a constructor` (the thumbnail frame blew up
   * first in practice).
   *
   * So now the output itself is read: the output says what it needs, not a side effect of compiling.
   */
  var DEP_RE = /__ANIM_MG_DEPS__\[\s*"([^"]+)"\s*\]/g;

  function depsIn(js) {
    var out = [];
    var seen = {};
    var m;
    DEP_RE.lastIndex = 0;
    while ((m = DEP_RE.exec(js))) {
      var spec = m[1];
      /* The shared ones (react/gsap/runtime) are set up by the host script from the start; nothing to do. */
      if (seen[spec] || SHARED[spec]) continue;
      seen[spec] = true;
      out.push(spec);
    }
    return out;
  }

  async function ensureDeps(js) {
    var specs = depsIn(js);
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      if (!window.__ANIM_MG_DEPS__[spec]) {
        window.__ANIM_MG_DEPS__[spec] = await import(spec);
      }
    }
  }

  var styleEl = null;

  /**
   * The font library's stylesheets (the bundle's `fonts`, see code-bundle). Writing a family name
   * in the source loads it: shot pages and playback packs get server-inserted <link>s; the
   * preview compiles in the browser and can only insert what the bundle lists.
   *
   * Only ever added, never removed: a sheet left over after a family is dropped is harmless
   * (@font-face downloads on use), while removing and re-adding would flash every glyph.
   * Inserted before the film's own <style>, so an author's @font-face of the same name still wins.
   */
  var fontLinks = {};

  function applyFonts(fonts) {
    if (!fonts || !fonts.length) return Promise.resolve();
    var pending = [];
    for (var i = 0; i < fonts.length; i++) {
      var href = fonts[i] && fonts[i].href;
      if (typeof href !== 'string' || !/^(https?:\/\/|\/)/.test(href) || fontLinks[href]) continue;
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      /* Wait for the sheet before mounting the film: otherwise the first frame lays out in the
         fallback font and the whole screen reflows when @font-face arrives. A sheet that fails
         (offline, 404) still lets it through — system fonts beat no picture. */
      pending.push(new Promise(function (done) { link.onload = link.onerror = function () { done(); }; }));
      fontLinks[href] = link;
      if (styleEl) document.head.insertBefore(link, styleEl);
      else document.head.appendChild(link);
    }
    return Promise.all(pending);
  }

  /**
   * Ask what the film looks like now.
   *
   * A failed collection (a slip in the film) does not block the picture: it only affects the outer
   * timeline, and the picture is already on screen. `Infinity` is flattened: it marks sounds whose length
   * was not measured yet during collection, and it cannot survive structured cloning.
   */
  function collectSummary() {
    var summary = null;
    try {
      if (typeof window.__filmCollect === 'function') summary = window.__filmCollect();
    } catch (e) { /* A failed collection does not block the picture */ }
    if (!summary) return null;
    if (summary.durationMs) window.__FILM_DURATION__ = summary.durationMs;
    try {
      summary = JSON.parse(JSON.stringify(summary, function (_k, v) {
        return typeof v === 'number' && !isFinite(v) ? 0 : v;
      }));
    } catch (e) { /* Hand it over even if not fully clean; the outer page clamps it again */ }
    return summary;
  }

  /* ready waits for fonts to settle (see __filmFontsIn in code-host): @font-face downloads only on use, so
     text that appears later is not queued yet. Sending ready early means "playback starts before fonts
     load", and all the text on screen swaps mid-playback. Old shells without this hook just send it. */
  var postReady = function () {
    if (typeof window.__filmFontsIn === 'function') {
      window.__filmFontsIn(function () { post(lastReady); });
      return;
    }
    post(lastReady);
  };

  async function applyBuild(out) {
    await ensureDeps(out.js);
    if (out.css) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = out.css;
      /* @font-face downloads only on use, so kick every face as soon as the CSS lands, running downloads in
         parallel with mounting/collection; ready only waits for them all (see postReady). Without the kick,
         text that appears later is drawn in a fallback font first and jumps when the woff2 arrives. */
      if (typeof window.__filmFontsKick === 'function') window.__filmFontsKick();
    }
    (0, eval)(out.js);
    var film = window.__ANIM_FILM__ || {};
    if (film.stage && film.stage.w) window.__FILM_STAGE__ = film.stage;
    var summary = collectSummary();
    if (typeof window.__filmFit === 'function') window.__filmFit();
    if (typeof window.__filmMount !== 'function') throw new Error('The host page is not mounted yet');
    window.__filmMount();
    /* Send ready even if collection failed. The outer loading screen listens only for this; without it the
       picture might already be mounted while the user keeps staring at "Loading the picture". */
    lastReady = { source: 'anim-film', type: 'ready', film: summary || undefined };
    postReady();
  }

  /* ── Arrangement document ────────────────────────────────────── */

  /**
   * Put the document on a global where the build output reads it (see runtime mode in film-build's doc-entry).
   *
   * This must happen before eval: the output reads it once at module initialization (the frame size is a
   * module-level constant).
   *
   * The bundle usually contains `film.json`; when it was left out for size (see MAX_FILE_BYTES in
   * code-bundle) it is fetched separately. The code form (no entry) does nothing: those films have no document.
   */
  async function seedDoc(bundle) {
    if (!bundle || !bundle.entry) return;
    var text = bundle.files && bundle.files['film.json'];
    if (typeof text !== 'string') {
      text = await fetchText(codeBase + 'film.json').catch(function () { return null; });
    }
    if (text == null) return;
    /* A bad document is not reported here: the entry module throws a clip-by-clip error as soon as it runs,
       which is far more useful than JSON.parse's "Unexpected token". */
    try { window.__FILM_DOC__ = JSON.parse(text); } catch (e) {}
  }

  /** A document that was handed over but cannot be applied yet (see applyDoc), and the deadline for waiting on it. */
  var owedDoc = null;
  var owedUntil = 0;

  /**
   * Apply the owed document: retried after a build finishes and during the tick or two while the tree mounts.
   *
   * `__filmDoc` is attached by code-host's Host in an effect, a tick or two after `__filmMount()` returns
   * (a React thing), so "built" does not yet mean "can be applied".
   *
   * Only after the wait runs out does it fall back to a full rebuild: that path is for old shells (which have
   * no `__filmDoc` at all), and by then the POST that saved to disk has long returned, so the rebuild reads
   * the new version from disk.
   */
  function flushDoc() {
    if (!owedDoc || window.__FILM_BUSY__) return;
    if (typeof window.__filmDoc !== 'function') {
      if (Date.now() < owedUntil) {
        setTimeout(flushDoc, 50);
        return;
      }
      owedDoc = null;
      void schedule({ reload: true });
      return;
    }
    var doc = owedDoc;
    owedDoc = null;
    applyDoc(doc);
  }

  /**
   * The outer page only moved a few clips: re-render with a new document, without rebuilding.
   *
   * This path saves an authenticated bundle round trip, an esbuild run (hundreds of ms to seconds) and a
   * full tree remount (video re-decoding, gsap timelines rebuilt, a canvas flash). All that is left is one
   * React re-render.
   *
   * **If it cannot be applied right now, keep it; never drop it.** It cannot be applied in two cases: the
   * tree has not mounted for the first time yet (`__filmDoc` is attached by code-host's Host only in an
   * effect, while `__filmDocPush` exists as soon as the script runs, with the seconds of the bundle build in
   * between), or a full rebuild is in progress. Neither can apply it in place: the end of the build reseeds
   * from the `film.json` **on disk** (see seedDoc), and the POST saving to disk may still be in flight, so
   * what would come back is the version before the edit.
   *
   * This used to "drop it and request a full rebuild instead", which silently rolled the edit back while the
   * outer page had already recorded it as delivered. The thumbnail page suffered most: it captures elements
   * by clip name (see `only` in __filmCapture), and holding the old document it got 'no-node' for the whole
   * round, so a clip just duplicated on the timeline only ever had the poster fallback cell.
   */
  function applyDoc(doc) {
    if (!doc) return;
    /* This page has **no compiled film module** (an empty project compiled to nothing, or the last
       build failed): pushing the document in leaves nothing to render it, yet the code below still
       replies ready, so the outer page assumes all is well, thumbnail capture gets 'no-node' for the
       whole round, the timeline has no thumbnails at all, and nobody ever asks for a rebuild again.
       The first asset dropped into an empty project always takes this path. The only option is a
       full rebuild; the POST the outer page sent before pushing the document is already on disk, so
       the rebuild reads exactly that version. */
    var mod = window.__ANIM_FILM__;
    if (!(mod && mod.default) && !window.__FILM_BUSY__ && typeof window.__filmRefresh === 'function') {
      window.__filmRefresh();
      return;
    }
    if (typeof window.__filmDoc !== 'function' || window.__FILM_BUSY__) {
      owedDoc = doc;
      owedUntil = Date.now() + 15000;
      setTimeout(flushDoc, 50);
      return;
    }
    if (doc.stage && doc.stage.w) {
      window.__FILM_STAGE__ = doc.stage;
      if (typeof window.__filmFit === 'function') window.__filmFit();
    }
    window.__filmDoc(doc);
    var summary = collectSummary();
    lastReady = { source: 'anim-film', type: 'ready', film: summary || undefined };
    postReady();
  }

  /**
   * The "ready" from the last finished build, so an outer page that arrives late can ask for it again.
   *
   * That message used to be **one-shot**: sent once after a build, and lost if nobody was listening. Once the
   * build cache cut compiles from seconds to hundreds of ms, "the outer page has not attached its listener
   * yet" became the norm (measured in dev: the iframe was ready at 965ms while the outer tree was still
   * hydrating), and the picture sat on screen while the outer page stayed on its loading screen.
   */
  var lastReady = null;

  function fail(e) {
    var msg = String((e && e.message) || e || 'compile failed');
    if (e && e.errors && e.errors[0] && e.errors[0].text) {
      msg = e.errors.map(function (x) { return x.text; }).filter(Boolean).join('\n') || msg;
    }
    post({ source: 'anim-film', type: 'error', message: msg });
  }

  var current = { srcHash: null };
  var running = null;

  async function compile(opts) {
    var reload = Boolean(opts && opts.reload);
    var force = Boolean(opts && opts.force);
    var bundle = await loadBundle(reload).catch(function (e) {
      /* The benchmark path (legacy) has no bundle, so fall back to fetching files one by one. The entry for the
         document form lives in the bundle; after a bundle 404/400, fetching film.tsx would only 404 again and
         hide the real error. */
      if (legacy) return null;
      throw e;
    });
    /* If the bundle path fails (old server, huge workspace), fall back to fetching files one by one: slow, but it always renders. */
    var preview = previewSrc();
    var stage = previewStage(window.__FILM_STAGE__ || { w: 1920, h: 1080 });
    if (preview) {
      var project = bundle && bundle.projects && bundle.projects[preview];
      var assets = bundle && bundle.assets;
      var facts = project || (assets && assets[preview]);
      if (facts && facts.w && facts.h) stage = { w: facts.w, h: facts.h };
      window.__FILM_DOC__ = {
        stage: stage,
        tracks: [{ kind: 'mg', clips: [{ id: 'preview', src: preview }] }],
      };
      window.__FILM_STAGE__ = stage;
      bundle = Object.assign({}, bundle || {}, {
        entry: previewEntrySource(preview, stage, project, facts, assets, bundle && bundle.words),
      });
    }
    var out = await buildFor(bundle, force || (bundle && bundle.srcHash === null));
    current.srcHash = bundle && bundle.srcHash;
    window.__FILM_SRC_HASH__ = current.srcHash;
    window.__FILM_FROM_CACHE__ = out.fromCache;
    /* Seed the document before eval: the output reads it at initialization. This matters most when the output
       came free from the cache, since the page has just opened and nothing is on the globals yet.
       Preview mode has already set its own document; do not overwrite it with the whole film's film.json. */
    if (!preview) await seedDoc(bundle);
    await applyFonts(bundle && bundle.fonts);
    await applyBuild(out);
  }

  // A burst of file writes needs the newest revision, not one build per event.
  var pendingOptions = null;
  function schedule(opts) {
    var requested = opts || {};
    pendingOptions = {
      reload: Boolean(requested.reload || (pendingOptions && pendingOptions.reload)),
      force: Boolean(requested.force || (pendingOptions && pendingOptions.force)),
    };
    if (running) return running;
    window.__FILM_BUSY__ = true;
    running = Promise.resolve().then(async function () {
      try {
        while (pendingOptions) {
          var next = pendingOptions;
          pendingOptions = null;
          try { await compile(next); } catch (error) { fail(error); }
        }
      } finally {
        running = null;
        window.__FILM_BUSY__ = false;
        flushDoc();
      }
    });
    return running;
  }

  /**
   * The outer page says the source changed.
   *
   * The old way was to change the iframe's `?v=` and redo the whole page: host HTML, re-parsing the 2 MB host
   * script, re-instantiating wasm, re-fetching the source. This one message saves all of that.
   */
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'anim-host') return;
    /* The outer page just attached its listener and asks "are you ready?". If the build is done, send it again. */
    if (d.type === 'hello') {
      if (lastReady) post(lastReady);
      return;
    }
    /* The outer page asks how big this clip is on the stage. An untransformed MG clip wrapper is full-frame,
       so the real module size has to be measured. Mounting can lag ready by a frame or two; if it is not found,
       poll briefly rather than reporting 1920x1080 as the native size. */
    if (d.type === 'clip-box') {
      var clipId = d.clipId;
      var tries = 0;
      var sendBox = function () {
        var box = typeof window.__filmClipPaint === 'function' ? window.__filmClipPaint(clipId) : null;
        if (!box) return false;
        var stage = window.__FILM_STAGE__ || { w: 1920, h: 1080 };
        var tight = box.w < stage.w - 1 || box.h < stage.h - 1;
        /* The clip wrapper fills the frame first and data-film-box is applied afterwards. Reporting 1920x1080
           too early makes the "native" size in the export list wrong. A truly full-frame module (whose root is
           the stage) reports full-frame once polling ends, which is correct. */
        if (!tight && tries < 12) return false;
        post({ source: 'anim-film', type: 'clip-box', clipId: clipId, box: box });
        return true;
      };
      if (sendBox()) return;
      var timer = setInterval(function () {
        tries += 1;
        if (sendBox() || tries > 12) clearInterval(timer);
      }, 40);
      return;
    }
    /* Only a few clips moved: swap the document without rebuilding (see applyDoc). Single-module preview ignores the whole film's document. */
    if (d.type === 'doc') {
      if (previewSrc()) return;
      applyDoc(d.doc);
      return;
    }
    if (d.type !== 'refresh') return;
    void schedule({ reload: true, force: Boolean(d.force) });
  });

  window.__filmRefresh = function (force) { return schedule({ reload: true, force: force }); };
  /* The outer page probes for this: only if it exists does it push just the document; otherwise it must request a full rebuild (see ProjectView). */
  window.__filmDocPush = applyDoc;

  void schedule({});
})();
