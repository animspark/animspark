/**
 * Stamp the live-preview build with "which source line rendered this DOM node".
 *
 * Why: double-clicking a line of text on the canvas edits it in place, landing on that tag's
 * children in the source (see film-build's applyTextEdit). But the film.tsx path had no anchors on
 * its DOM: `__loc` only reaches the props of the components placed on the timeline (see
 * runtime/jsx-dev-runtime), and the browser build still uses production JSX, which carries no
 * source at all. So "which line is the clicked text written on" couldn't be answered; all we could
 * hand the agent was a box and a screenshot.
 *
 * Only **host tags** (`<h1>`, `<div>`) are stamped: a user-written component gains nothing from an
 * unknown prop (it may not pass it down), and only DOM nodes are ever clickable and editable.
 * Half the insertions, half the risk.
 *
 * Live preview only (see code-host). The capture page and bundled output are not stamped: a
 * finished film shouldn't carry debug attributes, and nobody clicks the picture on those paths.
 *
 * Same approach as web-shot (instrumentWebShotSourceAnchors): **the AST is only used to locate;
 * attributes are spliced into the original text by offset**. Reprinting the whole file turns JSX
 * text like `// comment` into invalid code, which once broke a fully validated film at bundle
 * time. Inserted fragments contain no newlines, so every line and column still matches: error
 * stacks and `__loc` both count by line and column.
 *
 * Fuse: after inserting, run a syntax check; if it isn't clean, return the source untouched.
 * Anchors only make the picture clickable; they're never worth breaking the preview build.
 */

import ts from 'typescript';

/** The attribute on the DOM node. Same name as the old playback path, so one frontend parser handles both. */
const ATTR = 'data-animspark-source';
/**
 * This span's text is editable: the UI uses it to decide whether to offer the "Text" button.
 *
 * Why instrumentation answers this: the UI only sees the DOM, and the DOM can't tell whether a
 * sentence is **written** in the source or **passed down**. Per-character animation hits exactly
 * this: `<Chars text="A company" />` renders a run of one-character spans, each of which looks
 * editable, while in the source their content is just `{c}`.
 *
 * These shapes all count as editable, because the source side can edit all of them (see
 * film-build's applyTextEdit):
 *
 *   ① Written between the tags: `<h1>$2 trillion</h1>`: edit children.
 *   ② Handed to a child component: `<div><Chars text="A company" /></div>`: edit that string prop.
 *      This is the common shape for per-character animation, typewriters and line-split effects:
 *      the sentence is a prop, not children. Without it, the most prominent big text in a film
 *      would all be uneditable, and that's exactly the text most often edited.
 *   ③ A sentence split by styling: `Safety <span style={orange}>first</span>, then capability`.
 *      The inner word is edited on its own, and the outer text on its own; editing the whole
 *      sentence still goes through applyTextEdit's anchor splitting. Both layers are stamped
 *      because clicking the plain text lands on the parent div (text nodes can't be hit); without
 *      a mark on the parent, those words couldn't be edited.
 */
const TEXT_ATTR = 'data-animspark-text';
/**
 * Keys written in this element's `style={{ … }}`. The property panel exposes only these, never
 * inherited computed values, as editable parameters. Only object literals can be listed;
 * `style={theme}` can't, so the panel stays empty.
 */
const STYLE_ATTR = 'data-animspark-style';
/**
 * Attributes written on this element other than style / className: SVG's fill, d, viewBox all
 * land here. Same rule as style: editable only if listable; computed values can't be listed.
 */
const ATTRS_ATTR = 'data-animspark-attrs';

const SKIP_ATTRS = new Set(['style', 'className', 'class', 'key', 'ref', 'children']);

/** The children that count as content (whitespace and newlines don't; JSX drops them too). */
function meaningfulChildren(parent: ts.JsxElement): ts.JsxChild[] {
  return parent.children.filter((child) => (
    !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces)
  ));
}

/**
 * Small tags inside this span with their own styling and hard-coded text: `<span style={orange}>,</span>`,
 * `<br />`.
 *
 * They act as **fixed anchors** within a sentence: kept as-is when the text is edited, so their
 * color isn't lost.
 */
function isFixedRun(child: ts.JsxChild, sourceFile: ts.SourceFile): boolean {
  if (ts.isJsxSelfClosingElement(child)) {
    return child.tagName.getText(sourceFile).toLowerCase() === 'br';
  }
  if (!ts.isJsxElement(child)) return false;
  if (!isHostTag(child.openingElement.tagName.getText(sourceFile))) return false;
  const inner = child.children[0];
  return child.children.length === 1
    && !!inner
    && ts.isJsxText(inner)
    && inner.getText(sourceFile).trim() !== '';
}

/** Whether this tag's text is editable, and in which shape. Null if not editable. */
function editableTextShape(
  node: ts.JsxOpeningElement,
  sourceFile: ts.SourceFile,
): 'children' | 'prop' | null {
  const parent = node.parent;
  if (!ts.isJsxElement(parent)) return null;
  const children = meaningfulChildren(parent);
  const only = children.length === 1 ? children[0] : null;
  if (!only) {
    /* ③ A sentence split by styling: `Safety <span style={orange}>first</span>, then capability`.
       The most prominent sentences in a film often look like this (punctuation or keywords colored
       separately). Both the parent and the small inner tags are stamped: click inside to edit that
       word, click the parent's own text to edit that part. Editing the joined sentence requires the
       new text to keep the styled anchors; dropping one is an error. */
    if (!children.some((child) => ts.isJsxText(child))) return null;
    return children.every((child) => ts.isJsxText(child) || isFixedRun(child, sourceFile))
      ? 'children'
      : null;
  }
  if (ts.isJsxText(only)) return only.getText(sourceFile).trim() ? 'children' : null;
  /* `{"Title "}`: still a hard-coded sentence, but with leading/trailing whitespace or `{}<>` it
     would get mangled if written bare, so applyTextEdit wrapped it in a string expression when
     writing back. Without recognizing this, a user adding a trailing space to a title on the canvas
     would make that line unclickable, and the thing that produced this shape was the previous edit. */
  if (ts.isJsxExpression(only) && only.expression && ts.isStringLiteral(only.expression)) {
    return only.expression.text.trim() ? 'children' : null;
  }
  /* A single child element: it must be a (user-written) component with at least one literal string
     prop; that's the only place the sentence can be. Which prop exactly is decided on the source
     side by matching it against the sentence on screen, not by guessing names. */
  const child = ts.isJsxSelfClosingElement(only)
    ? only
    : ts.isJsxElement(only) ? only.openingElement : null;
  if (!child) return null;
  if (isHostTag(child.tagName.getText(sourceFile))) return null;
  const hasStringProp = child.attributes.properties.some((property) => (
    ts.isJsxAttribute(property)
    && property.initializer
    && ts.isStringLiteral(property.initializer)
    && property.initializer.text.trim() !== ''
  ));
  return hasStringProp ? 'prop' : null;
}

/** Host tags: `div`, `h1`, `my-thing`. Capitalized or dotted names are components (`<Seq>`, `<Icons.Sun>`). */
function isHostTag(name: string): boolean {
  return /^[a-z][\w-]*$/.test(name);
}

/** The keys in `style={{ left: n.x, borderRadius: 20 }}`. Spreads and variables can't be listed. */
function styleKeysOf(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): string[] {
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText(sourceFile) !== 'style') continue;
    const init = property.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression) return [];
    let expr: ts.Expression = init.expression;
    if (ts.isParenthesizedExpression(expr)) expr = expr.expression;
    if (!ts.isObjectLiteralExpression(expr)) return [];
    const keys: string[] = [];
    for (const item of expr.properties) {
      if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) continue;
      const name = item.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        keys.push(name.text);
      }
    }
    return keys;
  }
  return [];
}

/**
 * Attribute values written as literals: `"#fff"`, `{2}`, `{'#fff'}`, `{-4}`.
 *
 * Only these can be edited from the panel, since the edit changes the value itself. Editing
 * `fill={color}` would collapse `color` into a constant, silently disconnecting everything else
 * driven by it (animation, another spot with the same color), while the user thinks they only
 * changed a color.
 */
function isLiteralInit(init: ts.JsxAttributeValue | undefined): boolean {
  if (!init) return false;
  if (ts.isStringLiteral(init)) return true;
  if (!ts.isJsxExpression(init) || !init.expression) return false;
  let expr: ts.Expression = init.expression;
  if (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken) expr = expr.operand;
  return ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr);
}

/** `fill="#fff"`, `d="M0 0"`, `strokeWidth={2}` etc.; only literal values are listed (see isLiteralInit). */
function attrNamesOf(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): string[] {
  const names: string[] = [];
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property)) continue;
    const name = property.name.getText(sourceFile);
    if (SKIP_ATTRS.has(name) || name.startsWith('data-animspark') || /^on[A-Z]/.test(name)) continue;
    if (!isLiteralInit(property.initializer)) continue;
    names.push(name);
  }
  return names;
}

function parseIssues(source: string, filename: string): number {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  return diagnostics?.length ?? 0;
}

/**
 * Insert `data-animspark-source="film.tsx:12:5"` on host tags, plus
 * `data-animspark-text="children|prop"` on those whose text is editable.
 *
 * The column points at the `<` itself, 1-based: the same convention as parseLoc / applyPropEdits /
 * applyTextEdit.
 */
export function filmSourceAnchors(source: string, filename: string): string {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  /* Don't instrument source that already fails to parse: the AST is broken, and insertion points
     would land in unexpected places. The preview keeps showing the previous frame (see
     evaluateFilm); that's not this layer's concern. */
  if (parseIssues(source, filename)) return source;

  const insertions: { offset: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      const has = node.attributes.properties.some((property) => (
        ts.isJsxAttribute(property) && property.name.getText(sourceFile) === ATTR
      ));
      if (isHostTag(tag) && !has) {
        const at = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const shape = ts.isJsxOpeningElement(node) ? editableTextShape(node, sourceFile) : null;
        const styleKeys = styleKeysOf(node, sourceFile);
        const attrNames = attrNamesOf(node, sourceFile);
        insertions.push({
          offset: node.attributes.end,
          text: ` ${ATTR}=${JSON.stringify(`${filename}:${at.line + 1}:${at.character + 1}`)}`
            + (shape ? ` ${TEXT_ATTR}="${shape}"` : '')
            + (styleKeys.length ? ` ${STYLE_ATTR}=${JSON.stringify(styleKeys.join(','))}` : '')
            + (attrNames.length ? ` ${ATTRS_ATTR}=${JSON.stringify(attrNames.join(','))}` : ''),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!insertions.length) return source;

  /* Insert back to front: front to back, the first insertion would shift every later offset, and
     code mis-inserted that way usually still compiles, just with attributes on the wrong tags. */
  let out = source;
  for (const { offset, text } of insertions.sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, offset) + text + out.slice(offset);
  }
  return parseIssues(out, filename) ? source : out;
}
