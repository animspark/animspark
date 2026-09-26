/**
 * codeMorph - token-preserving code morph.
 *
 * Pairs several source versions by token occurrence order; identical tokens move between
 * states, removed tokens fade out, added tokens fade in. Suited to refactors, API evolution
 * and before/after code narratives.
 */
import type { ComponentDef, Params } from '@animspark/scene-engine';

export interface CodeMorphParams extends Params {
  states: string[];
  progress: number;
  lang: string;
  filename: string;
}

interface CodeToken {
  key: string;
  text: string;
  kind: TokenKind;
  line: number;
  column: number;
}

type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'identifier' | 'operator';

const KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'do', 'else',
  'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'interface',
  'let', 'new', 'none', 'null', 'of', 'pass', 'raise', 'return', 'throw', 'true', 'try', 'type',
  'undefined', 'var', 'while', 'with', 'yield',
]);

const COLORS: Record<TokenKind, string> = {
  comment: '#697386',
  string: '#a7d98b',
  number: '#f4c274',
  keyword: '#c7a0ff',
  identifier: '#dce7f5',
  operator: '#7dd3fc',
};

const TOKEN_RE = /\/\/.*|#.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|=>|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||\*\*|[^\s]/g;

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function kindOf(text: string): TokenKind {
  if (text.startsWith('//') || text.startsWith('#') || text.startsWith('/*')) return 'comment';
  if (/^["'`]/.test(text)) return 'string';
  if (/^\d/.test(text)) return 'number';
  if (KEYWORDS.has(text.toLowerCase())) return 'keyword';
  if (/^[A-Za-z_$]/.test(text)) return 'identifier';
  return 'operator';
}

function tokenize(code: string): CodeToken[] {
  const occurrences = new Map<string, number>();
  const tokens: CodeToken[] = [];
  code.split('\n').forEach((line, lineIndex) => {
    for (const match of line.matchAll(TOKEN_RE)) {
      const text = match[0];
      const count = (occurrences.get(text) ?? 0) + 1;
      occurrences.set(text, count);
      tokens.push({
        key: `${text}\u0000${count}`,
        text,
        kind: kindOf(text),
        line: lineIndex,
        column: match.index ?? 0,
      });
    }
  });
  return tokens;
}

function statesOf(params: CodeMorphParams): string[] {
  const states = Array.isArray(params.states)
    ? params.states.filter((state): state is string => typeof state === 'string')
    : [];
  return states.length ? states : ['// Add at least one code state'];
}

function tokenText(
  token: CodeToken,
  x: number,
  y: number,
  opacity: number,
  fontSize: number,
): string {
  if (opacity <= 0.002) return '';
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="${COLORS[token.kind]}" opacity="${opacity.toFixed(3)}" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="${fontSize.toFixed(2)}" font-weight="${token.kind === 'keyword' ? 650 : 500}" xml:space="preserve">${esc(token.text)}</text>`;
}

function renderCodeMorph(params: CodeMorphParams, width: number, height: number): string {
  const w = Math.max(320, width);
  const h = Math.max(180, height);
  const scale = Math.min(w / 1280, h / 720);
  const states = statesOf(params);
  const progress = clamp(Number(params.progress) || 0, 0, Math.max(0, states.length - 1));
  const fromIndex = Math.min(states.length - 1, Math.floor(progress));
  const toIndex = Math.min(states.length - 1, fromIndex + 1);
  const t = toIndex === fromIndex ? 0 : progress - fromIndex;
  const from = tokenize(states[fromIndex]!);
  const to = tokenize(states[toIndex]!);
  const toByKey = new Map(to.map((token) => [token.key, token]));
  const fromKeys = new Set(from.map((token) => token.key));

  const gutter = 76 * scale;
  const codeLeft = 116 * scale;
  const codeTop = 130 * scale;
  const lineHeight = 43 * scale;
  const charWidth = 14.2 * scale;
  const fontSize = 24 * scale;
  const lineCount = Math.max(states[fromIndex]!.split('\n').length, states[toIndex]!.split('\n').length);
  const pieces: string[] = [
    `<rect x="0" y="0" width="${w}" height="${h}" rx="${22 * scale}" fill="#07101c"/>`,
    `<rect x="${1 * scale}" y="${1 * scale}" width="${w - 2 * scale}" height="${h - 2 * scale}" rx="${21 * scale}" fill="none" stroke="#203247" stroke-width="${2 * scale}"/>`,
    `<rect x="0" y="0" width="${w}" height="${72 * scale}" rx="${22 * scale}" fill="#0b1725"/>`,
    `<rect x="0" y="${50 * scale}" width="${w}" height="${22 * scale}" fill="#0b1725"/>`,
    `<circle cx="${30 * scale}" cy="${36 * scale}" r="${7 * scale}" fill="#ff6b6b"/>`,
    `<circle cx="${54 * scale}" cy="${36 * scale}" r="${7 * scale}" fill="#f6c85f"/>`,
    `<circle cx="${78 * scale}" cy="${36 * scale}" r="${7 * scale}" fill="#55d187"/>`,
    `<text x="${106 * scale}" y="${44 * scale}" fill="#9fb0c3" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${18 * scale}">${esc(params.filename || 'refactor.ts')}</text>`,
    `<text x="${w - 36 * scale}" y="${43 * scale}" text-anchor="end" fill="#6e8299" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${14 * scale}" letter-spacing="${2 * scale}">${esc((params.lang || 'code').toUpperCase())}</text>`,
    `<line x1="${gutter}" y1="${92 * scale}" x2="${gutter}" y2="${h - 42 * scale}" stroke="#1c2a3a" stroke-width="${1 * scale}"/>`,
  ];

  for (let line = 0; line < lineCount; line++) {
    pieces.push(
      `<text x="${54 * scale}" y="${codeTop + line * lineHeight}" text-anchor="end" fill="#42566c" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${17 * scale}">${line + 1}</text>`,
    );
  }

  for (const token of from) {
    const target = toByKey.get(token.key);
    const x0 = codeLeft + token.column * charWidth;
    const y0 = codeTop + token.line * lineHeight;
    if (target) {
      const x1 = codeLeft + target.column * charWidth;
      const y1 = codeTop + target.line * lineHeight;
      pieces.push(tokenText(token, lerp(x0, x1, t), lerp(y0, y1, t), 1, fontSize));
    } else {
      pieces.push(tokenText(token, x0 - 8 * scale * t, y0, 1 - t, fontSize));
    }
  }
  for (const token of to) {
    if (fromKeys.has(token.key)) continue;
    const x = codeLeft + token.column * charWidth + 8 * scale * (1 - t);
    const y = codeTop + token.line * lineHeight;
    pieces.push(tokenText(token, x, y, t, fontSize));
  }

  const dotsY = h - 27 * scale;
  states.forEach((_state, index) => {
    const active = Math.abs(progress - index) < 0.52;
    pieces.push(
      `<circle cx="${w / 2 + (index - (states.length - 1) / 2) * 22 * scale}" cy="${dotsY}" r="${(active ? 4.5 : 3.2) * scale}" fill="${active ? '#67e8f9' : '#34495e'}"/>`,
    );
  });
  return pieces.join('');
}

export const CODE_MORPH_DEF: ComponentDef<CodeMorphParams> = {
  name: 'codeMorph',
  doc: 'Smoothly morphs between several source versions while preserving token identity; for explaining refactors, API evolution and code before/after.',
  details: [
    'states provides the full source for each state in time order; progress goes from 0 to states.length - 1.',
    'Identical tokens move to their new positions, removed tokens fade out, added tokens fade in.',
    'Plain terminal windows or static code cards do not need this component; use it only when the code structure changes.',
  ].join('\n'),
  example: `<CodeMorph id="refactor" lang="typescript" filename="loader.ts"
  states={['load(url, cb)', 'const data = await load(url)']} progress={0} />`,
  paramDocs: {
    states: 'Array of source strings in time order.',
    progress: 'State progress: 0 is the first source, 1 the second; fractional values transition between adjacent states.',
    lang: 'Language label, used only for syntax keywords and the UI badge.',
    filename: 'File name shown in the editor title bar.',
  },
  defaults: {
    states: ['const value = load()', 'const value = await load()'],
    progress: 0,
    lang: 'typescript',
    filename: 'example.ts',
  },
  intrinsic: () => [1280, 720],
  fill: true,
  render: renderCodeMorph,
  contentDebugRect: (_params, w, h) => [0, 0, w, h],
};
