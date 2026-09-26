/** Load the glyph ranges actually used by the mounted film, including hidden future titles. */
async function loadStageFonts(root: Element | null): Promise<FontFace[]> {
  if (!root || !document.fonts) return [];
  const groups = new Map<string, Set<string>>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || !node.parentElement
      || node.parentElement.closest('style,script')) continue;
    const style = getComputedStyle(node.parentElement);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    let chars = groups.get(font);
    if (!chars) groups.set(font, chars = new Set());
    for (const char of node.textContent) chars.add(char);
  }
  // FontFace.load() ignores unicode-range and downloads every CJK subset. FontFaceSet.load()
  // selects subsets by text and weight, while still warming opacity:0 / display:none titles.
  const loads = [...groups].map(([font, chars]) => document.fonts.load(font, [...chars].join('')));
  const results = await Promise.allSettled(loads);
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

export async function settleStageFonts(root: Element | null, timeoutMs = 15_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      loadStageFonts(root).then(() => document.fonts.ready),
      new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const embeddedFonts = new Map<string, string>();
let embeddedBytes = 0;
const MAX_EMBED_BYTES = 16 * 1024 * 1024;

async function embeddedFont(url: string): Promise<string> {
  const cached = embeddedFonts.get(url);
  if (cached) {
    embeddedFonts.delete(url); embeddedFonts.set(url, cached);
    return cached;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Font HTTP ${response.status}`);
  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  if (data.length * 2 <= MAX_EMBED_BYTES) {
    while (embeddedFonts.size >= 64 || embeddedBytes + data.length * 2 > MAX_EMBED_BYTES) {
      const key = embeddedFonts.keys().next().value!;
      embeddedBytes -= embeddedFonts.get(key)!.length * 2; embeddedFonts.delete(key);
    }
    // Another capture can finish the same resource while this one is fetching it.
    embeddedBytes -= (embeddedFonts.get(url)?.length ?? 0) * 2;
    embeddedFonts.set(url, data); embeddedBytes += data.length * 2;
  }
  return data;
}

function faceKey(face: { family: string; weight: string; style: string; stretch: string; unicodeRange: string }): string {
  return [face.family.replace(/["']/g, '').trim().toLowerCase(),
    (face.weight || 'normal').replace(/^normal$/, '400').replace(/^bold$/, '700'),
    face.style || 'normal', face.stretch || 'normal',
    (face.unicodeRange || 'U+0-10FFFF').replace(/\s/g, '').toUpperCase()].join('|');
}

/**
 * Stylesheets whose cssRules can't be read (the font library sheets are on another origin): fetch the
 * text once and parse it into rules ourselves.
 *
 * Previously any such sheet made the whole function return undefined, leaving html-to-image to its
 * own fallback: for every capture it fetched the CSS, inlined every font URL as a data URL, and
 * insertRule'd it into the iframe's stylesheet, **every single time**. Rules piled up, each capture
 * was slower than the last, and that's where the "Error inlining remote css file" console messages
 * came from. Fetched text is memoized by URL, so each sheet is fetched once per page.
 */
const remoteSheets = new Map<string, Promise<CSSRuleList | null>>();

function remoteRules(href: string): Promise<CSSRuleList | null> {
  let hit = remoteSheets.get(href);
  if (!hit) {
    hit = fetch(href, { signal: AbortSignal.timeout(15_000) })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`CSS HTTP ${res.status}`))))
      .then((text) => {
        const sheet = new CSSStyleSheet({ baseURL: href });
        /* replaceSync doesn't accept @import. Font sheets have none anyway; strip any so the
           whole sheet isn't thrown out. */
        sheet.replaceSync(text.replace(/@import[^;]+;/g, ''));
        return sheet.cssRules;
      })
      .catch(() => {
        remoteSheets.delete(href);
        return null;
      });
    remoteSheets.set(href, hit);
  }
  return hit;
}

/**
 * Embed CSS for the same set of faces (same faceKeys) is computed once. Capturing a filmstrip means
 * dozens of captures of the same frame.
 */
const embedCssCache = new Map<string, string>();

/** html-to-image filters by family only, otherwise embedding every CJK range/weight again. */
export async function stageFontEmbedCSS(root: Element): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loaded: FontFace[];
  try {
    loaded = await Promise.race([
      loadStageFonts(root),
      new Promise<FontFace[]>(resolve => { timer = setTimeout(() => resolve([]), 15_000); }),
    ]);
  } finally { clearTimeout(timer); }
  const faces = new Set(loaded.map(faceKey));
  const cacheKey = [...faces].sort().join('\n');
  const cached = embedCssCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const rules: Array<{ rule: CSSFontFaceRule; base: string }> = [];
  const visit = (list: CSSRuleList, base: string) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSFontFaceRule) rules.push({ rule, base });
      else if (rule instanceof CSSImportRule && rule.styleSheet) {
        try { visit(rule.styleSheet.cssRules, rule.styleSheet.href || base); } catch { /* cross-origin @import: filled in by URL below */ }
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules, base);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    const base = sheet.href || document.baseURI;
    let list: CSSRuleList | null = null;
    try {
      list = sheet.cssRules;
    } catch {
      /* Cross-origin sheet: one unreadable sheet doesn't affect the rest; fetch its text separately. */
      list = sheet.href ? await remoteRules(sheet.href) : null;
    }
    if (list) visit(list, base);
  }
  const selected = rules.filter(({ rule: { style } }) => faces.has(faceKey({
    family: style.fontFamily, weight: style.fontWeight, style: style.fontStyle,
    stretch: style.fontStretch, unicodeRange: style.getPropertyValue('unicode-range'),
  })));
  const out: string[] = [];
  let complete = true;
  // Keep downloads sequential: each preview may share the same engine connection budget.
  for (const { rule, base } of selected) {
    let css = rule.cssText;
    const urls = [...css.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g)];
    try {
      for (const match of urls) {
        const url = new URL(match[1]!.trim(), base).href;
        if (url.startsWith('data:')) continue;
        css = css.replace(match[0], `url("${await embeddedFont(url)}")`);
      }
      out.push(css);
    } catch {
      /* Failed fonts use the same fallback as the visible preview. Not cached; retried next time. */
      complete = false;
    }
  }
  const css = out.join('\n');
  if (complete) {
    if (embedCssCache.size >= 32) embedCssCache.delete(embedCssCache.keys().next().value!);
    embedCssCache.set(cacheKey, css);
  }
  return css;
}
