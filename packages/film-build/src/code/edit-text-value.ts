/**
 * The text on screen is **computed** (`<h1>{title}</h1>`); find the original in the source by
 * what it looks like now.
 *
 * The text-editing path (applyTextEdit) only handles text written inside the tag, yet the most
 * common pattern in a film is to put the copy somewhere else: a constant at the top of the file,
 * a table in `data/script.ts`, children passed to a child component. The line is identical on
 * screen and in the source — it just isn't inside that tag.
 *
 * So ask a different question: is there **exactly one** literal in all of `mg/` that reads this
 * line? If so, edit that one — that is where the author wrote it, and editing it is the same as the
 * author editing it. With more than one we don't guess; list them all and let the user pick. With
 * none, report not found (the line is assembled, so only the AI can change it).
 *
 * Same rule as the other write-backs: targeted text replacement, never reprint the AST.
 */

import ts from 'typescript';

import { renderJsxText } from './edit-text';

export interface TextLiteralHit {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** The span to replace (quotes / backticks included; JSX text excludes leading and trailing whitespace). */
  start: number;
  end: number;
  kind: 'string' | 'template' | 'jsx';
  /** The source line, shown when the user has to pick. */
  context: string;
}

/** Line breaks and whitespace don't count as differences — same rule as applyTextEdit's `expect` check. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function scriptKindOf(file: string): ts.ScriptKind | null {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js') || file.endsWith('.mjs')) return ts.ScriptKind.JS;
  if (file.endsWith('.json')) return ts.ScriptKind.JSON;
  return null;
}

/** Is this string copy? Module paths and object keys aren't — even if they read the same, they aren't this line. */
function isContentString(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): boolean {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return false;
  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent))
    && parent.name === node) return false;
  if (ts.isLiteralTypeNode(parent)) return false;
  return true;
}

export function findTextLiterals(file: string, source: string, expect: string): TextLiteralHit[] {
  const kind = scriptKindOf(file);
  const want = normalize(expect);
  if (kind == null || !want) return [];
  /* Cheap pre-filter: if the file doesn't even contain the first word of the line, skip building the AST. */
  const probe = want.split(' ')[0]!;
  if (!source.includes(probe)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const lines = source.split('\n');
  const hits: TextLiteralHit[] = [];
  const push = (start: number, end: number, hitKind: TextLiteralHit['kind']) => {
    const at = sf.getLineAndCharacterOfPosition(start);
    const line = lines[at.line] ?? '';
    hits.push({
      file,
      line: at.line + 1,
      column: at.character + 1,
      start,
      end,
      kind: hitKind,
      context: line.trim().slice(0, 120),
    });
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && normalize(node.text) === want && isContentString(node)) {
      push(node.getStart(sf), node.getEnd(), ts.isStringLiteral(node) ? 'string' : 'template');
    } else if (ts.isJsxText(node) && normalize(node.text) === want) {
      const raw = node.getText(sf);
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      push(node.getStart(sf) + lead, node.getEnd() - trail, 'jsx');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Write back with the original quotes — a single-quoted file shouldn't grow a double-quoted string because one word changed. */
function renderString(raw: string, value: string, json: boolean): string {
  const quote = raw[0];
  if (json || quote !== "'") return JSON.stringify(value);
  const body = JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
  return `'${body}'`;
}

function renderTemplate(value: string): string {
  return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``;
}

export function replaceTextLiteral(source: string, hit: TextLiteralHit, value: string): string {
  const raw = source.slice(hit.start, hit.end);
  const text = hit.kind === 'jsx'
    ? renderJsxText(value)
    : hit.kind === 'template'
      ? renderTemplate(value)
      : renderString(raw, value, hit.file.endsWith('.json'));
  return source.slice(0, hit.start) + text + source.slice(hit.end);
}
