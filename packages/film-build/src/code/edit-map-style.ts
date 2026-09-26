/**
 * The element clicked on screen is **the n-th copy** rendered by a `.map`; write that copy's
 * style back to the source.
 *
 * There is only one template: `nodes.map((n) => <div style={{ left: n.x, borderRadius: 20 }} />)`
 * becomes six cards. The panel edits the computed value of one of them. Editing the template
 * directly would either move all six at once or flatten `n.x` into a constant. Both are wrong.
 *
 * How the edit lands depends on where the value comes from right now:
 *   · already a per-item field (`left: n.x`) → change only that item's `x` in the array
 *   · still a shared literal (`borderRadius: 20`) → hoist the key into every item, then change
 *     the clicked one
 *   · no data array, e.g. `'HELLO'.split('').map` → unroll into separate JSX, then change the
 *     clicked piece
 *
 * Edits are still targeted text replacements; the file is never reprinted (same rule as
 * edit-props).
 */

import ts from 'typescript';

import { FilmCliError } from '../workspace';
import {
  patchStyleExprInTag,
  patchStyleInTag,
  renderStyleEntryLike,
  tagEnd,
  type ParsedLoc,
} from './edit-props';

export interface SourcePatch {
  start: number;
  end: number;
  text: string;
}

export function mappedStyleEdits(
  source: string,
  loc: ParsedLoc,
  patch: Record<string, unknown>,
  at: { open: number; tag: string },
): SourcePatch[] | null {
  if (loc.instance == null) return null;
  const sf = ts.createSourceFile(loc.file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const jsx = findJsxAt(sf, at.open);
  if (!jsx) return null;
  const mapped = enclosingMap(jsx);
  if (!mapped) return null;

  const chars = charListOf(sf, mapped.receiver);
  if (chars) {
    return [unrollCharMap(source, mapped, jsx, chars, loc.instance, patch)];
  }

  const objects = objectArrayOf(sf, mapped.receiver);
  if (!objects) {
    throw new FilmCliError(
      'this layer is several copies rendered by .map, and the list behind them is nowhere in the'
      + ' source, so changing one of them cannot be written back',
    );
  }
  const index = (loc.instance - 1) % objects.elements.length;
  const item = objects.elements[index];
  if (!item || !ts.isObjectLiteralExpression(item)) {
    throw new FilmCliError(`this copy does not line up with item ${index + 1} of the data array`);
  }

  const out: SourcePatch[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new FilmCliError(`style.${key} can only be a number or a string`);
    }
    const styleVal = styleValueNode(jsx, key);
    const field = styleVal ? itemFieldName(styleVal, mapped.itemParam) : null;
    if (field) {
      if (value === null) continue;
      out.push(writeObjectProp(item, field, value));
      continue;
    }
    if (!isLiteralish(styleVal)) {
      throw new FilmCliError(
        `style.${key} is computed, changing copy ${loc.instance} alone cannot be written back`,
      );
    }
    if (!styleVal) {
      /* The template doesn't have this key yet: write only the clicked item; the others have no field, so they still render the inherited value. */
      if (value === null) continue;
      out.push(writeObjectProp(item, key, value));
    } else {
      const shared = rawLiteral(styleVal);
      for (const [i, el] of objects.elements.entries()) {
        if (!ts.isObjectLiteralExpression(el)) continue;
        if (hasProp(el, key) && i !== index) continue;
        out.push(writeObjectProp(el, key, i === index ? value : shared));
      }
    }
    const expr = `${mapped.itemParam}.${key}`;
    const replaced = patchStyleExprInTag(at.tag, key, expr);
    out.push({ start: at.open + replaced.start, end: at.open + replaced.end, text: replaced.text });
  }
  return mergePatches(out);
}

function findJsxAt(sf: ts.SourceFile, offset: number): ts.JsxOpeningLikeElement | null {
  let hit: ts.JsxOpeningLikeElement | null = null;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.getStart(sf) === offset) {
        hit = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hit;
}

interface MappedJsx {
  call: ts.CallExpression;
  itemParam: string;
  receiver: ts.Expression;
  expression: ts.JsxExpression;
}

function enclosingMap(jsx: ts.Node): MappedJsx | null {
  let cur: ts.Node | undefined = jsx;
  let fn: ts.ArrowFunction | ts.FunctionExpression | null = null;
  while (cur) {
    if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) fn = cur;
    if (
      fn
      && ts.isCallExpression(cur)
      && ts.isPropertyAccessExpression(cur.expression)
      && cur.expression.name.text === 'map'
      && cur.arguments[0] === fn
    ) {
      const item = fn.parameters[0]?.name;
      if (!item || !ts.isIdentifier(item)) return null;
      const expression = jsxExpressionOf(cur);
      if (!expression) return null;
      return {
        call: cur,
        itemParam: item.text,
        receiver: cur.expression.expression,
        expression,
      };
    }
    cur = cur.parent;
  }
  return null;
}

function jsxExpressionOf(call: ts.CallExpression): ts.JsxExpression | null {
  let cur: ts.Node | undefined = call;
  while (cur) {
    if (ts.isJsxExpression(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

function charListOf(sf: ts.SourceFile, expr: ts.Expression): string[] | null {
  const direct = splitChars(expr) ?? stringArray(expr);
  if (direct) return direct;
  if (!ts.isIdentifier(expr)) return null;
  const init = varInit(sf, expr.text);
  return init ? splitChars(init) ?? stringArray(init) : null;
}

function splitChars(expr: ts.Expression): string[] | null {
  if (!ts.isCallExpression(expr) || !ts.isPropertyAccessExpression(expr.expression)) return null;
  if (expr.expression.name.text !== 'split') return null;
  const sep = expr.arguments[0];
  if (!sep || !ts.isStringLiteral(sep) || sep.text !== '') return null;
  const recv = expr.expression.expression;
  return ts.isStringLiteral(recv) || ts.isNoSubstitutionTemplateLiteral(recv) ? recv.text.split('') : null;
}

function stringArray(expr: ts.Expression): string[] | null {
  if (!ts.isArrayLiteralExpression(expr)) return null;
  if (!expr.elements.length || !expr.elements.every((el) => ts.isStringLiteral(el))) return null;
  return expr.elements.map((el) => (el as ts.StringLiteral).text);
}

function objectArrayOf(sf: ts.SourceFile, expr: ts.Expression): ts.ArrayLiteralExpression | null {
  if (isObjectArray(expr)) return expr;
  if (!ts.isIdentifier(expr)) return null;
  const init = varInit(sf, expr.text);
  return init && isObjectArray(init) ? init : null;
}

function isObjectArray(expr: ts.Expression): expr is ts.ArrayLiteralExpression {
  return ts.isArrayLiteralExpression(expr)
    && expr.elements.length > 0
    && expr.elements.every((el) => ts.isObjectLiteralExpression(el));
}

function varInit(sf: ts.SourceFile, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function styleValueNode(jsx: ts.JsxOpeningLikeElement, key: string): ts.Expression | null {
  for (const prop of jsx.attributes.properties) {
    if (!ts.isJsxAttribute(prop) || prop.name.getText() !== 'style') continue;
    const init = prop.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression) return null;
    const obj = unwrapObject(init.expression);
    if (!obj) return null;
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : '';
      if (name === key) return p.initializer;
    }
    return null;
  }
  return null;
}

function unwrapObject(expr: ts.Expression): ts.ObjectLiteralExpression | null {
  if (ts.isObjectLiteralExpression(expr)) return expr;
  if (ts.isParenthesizedExpression(expr)) return unwrapObject(expr.expression);
  return null;
}

function itemFieldName(expr: ts.Expression, itemParam: string): string | null {
  if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.expression)) return null;
  if (expr.expression.text !== itemParam || !ts.isIdentifier(expr.name)) return null;
  return expr.name.text;
}

function isLiteralish(expr: ts.Expression | null): boolean {
  if (!expr) return true;
  return ts.isStringLiteral(expr)
    || ts.isNoSubstitutionTemplateLiteral(expr)
    || ts.isNumericLiteral(expr)
    || expr.kind === ts.SyntaxKind.TrueKeyword
    || expr.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand));
}

function rawLiteral(expr: ts.Expression | null): string | number | boolean {
  if (!expr) return 0;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand)) {
    const n = Number(expr.operand.text);
    return expr.operator === ts.SyntaxKind.MinusToken ? -n : n;
  }
  return expr.getText();
}

function hasProp(obj: ts.ObjectLiteralExpression, key: string): boolean {
  return obj.properties.some((p) => (
    ts.isPropertyAssignment(p)
    && ((ts.isIdentifier(p.name) && p.name.text === key)
      || (ts.isStringLiteral(p.name) && p.name.text === key))
  ));
}

function writeObjectProp(
  obj: ts.ObjectLiteralExpression,
  key: string,
  value: string | number | boolean | null,
): SourcePatch {
  if (value === null) {
    const prop = obj.properties.find((p) => (
      ts.isPropertyAssignment(p)
      && ((ts.isIdentifier(p.name) && p.name.text === key)
        || (ts.isStringLiteral(p.name) && p.name.text === key))
    ));
    if (!prop) return { start: 0, end: 0, text: '' };
    let from = prop.getStart();
    let to = prop.getEnd();
    /* Take the comma along, so we don't leave `{ x: 1,, y: 2 }` behind. Works on source offsets. */
    const after = obj.getSourceFile().text[to];
    if (after === ',') to += 1;
    else if (obj.getSourceFile().text[from - 1] === ',') from -= 1;
    return { start: from, end: to, text: '' };
  }
  const text = renderStyleEntryLike(obj.getSourceFile().text, value);
  const prop = obj.properties.find((p) => (
    ts.isPropertyAssignment(p)
    && ((ts.isIdentifier(p.name) && p.name.text === key)
      || (ts.isStringLiteral(p.name) && p.name.text === key))
  ));
  if (prop && ts.isPropertyAssignment(prop)) {
    return { start: prop.initializer.getStart(), end: prop.initializer.getEnd(), text };
  }
  const close = obj.end - 1;
  const src = obj.getSourceFile().text;
  let at = close;
  while (at > obj.getStart() && /\s/.test(src[at - 1]!)) at -= 1;
  /* Follow the item's own formatting: `{ x: 260 }` becomes `{ x: 260, background: '#fff' }`,
     `{x:520,y:200}` becomes `{x:520,y:200,borderRadius:20}`. One table shouldn't end up with two styles. */
  const own = src.slice(obj.getStart(), obj.end);
  const spaced = /[:,]\s/.test(own) || /^\{\s/.test(own);
  const open = src[at - 1] === '{';
  const lead = open ? (spaced ? ' ' : '') : src[at - 1] === ',' ? (spaced ? ' ' : '') : (spaced ? ', ' : ',');
  const trail = open && spaced ? ' ' : '';
  return { start: at, end: at, text: `${lead}${key}:${spaced ? ' ' : ''}${text}${trail}` };
}


function unrollCharMap(
  source: string,
  mapped: MappedJsx,
  jsx: ts.JsxOpeningLikeElement,
  chars: string[],
  instance: number,
  patch: Record<string, unknown>,
): SourcePatch {
  const element = ts.isJsxOpeningElement(jsx) && ts.isJsxElement(jsx.parent) ? jsx.parent : jsx;
  const template = source.slice(element.getStart(), element.getEnd());
  const index = (instance - 1) % chars.length;
  const lineStart = source.lastIndexOf('\n', mapped.expression.getStart()) + 1;
  const indent = /^[ \t]*/.exec(source.slice(lineStart, mapped.expression.getStart()))?.[0] ?? '';
  const copies = chars.map((ch, i) => {
    let text = template;
    const child = new RegExp(`\\{${mapped.itemParam}\\}`, 'g');
    text = text.replace(child, ch);
    text = text.replace(/\bkey=\{[^}]+\}/, `key={${i}}`);
    if (i !== index) return text;
    const end = tagEnd(text, 0);
    if (end < 0) return text;
    const tag = text.slice(0, end);
    const replaced = patchStyleInTag(tag, patch);
    return text.slice(0, replaced.start) + replaced.text + text.slice(replaced.end);
  });
  return {
    start: mapped.expression.getStart(),
    end: mapped.expression.getEnd(),
    text: copies.join(`\n${indent}`),
  };
}

function mergePatches(patches: SourcePatch[]): SourcePatch[] {
  return patches.filter((p) => p.text !== '' || p.start !== p.end);
}
