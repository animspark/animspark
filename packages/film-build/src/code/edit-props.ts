/**
 * Write a drag on the timeline back to the source.
 *
 * The blocks in the UI are a projection evaluated from `film.tsx`, so "move this scene 200 ms to
 * the right" ends up as one prop on one line of one file — `from={1.5}` becomes `from={1.7}`. The
 * location is injected at compile time (see runtime/jsx-dev-runtime); this file makes the change.
 *
 * **Why edit props instead of rewriting the whole tree**: a film is code written by people (and
 * agents), with comments, variables and expressions computed from transcripts. Serializing the tree
 * back would flatten all of that, and in the next conversation turn the agent would face code it
 * never wrote — worse than not being able to drag at all. So only that one number changes; no
 * other character is touched.
 *
 * **Why no AST library**: changing a number would go parse → edit → print, and the print step
 * inevitably reformats (quotes, parentheses, line breaks). The whole-file diff would bury the one
 * real change. This does targeted text replacement instead; the cost is recognising the few ways a
 * JSX prop can be written, the benefit is a diff with only that line.
 */

import { FilmCliError } from '../cli-error';
import { mappedStyleEdits } from './edit-map-style';
import { coerceTimePropValue, type PropEdit, type PropValue } from './edit-types';

export {
  coerceTimePropValue,
  type PropEdit,
  type PropValue,
  type SplitEdit,
} from './edit-types';

/** `mg/hook.tsx:18:9` or `mg/hook.tsx:18:9#2` — a location injected at compile time; `#n` is which copy rendered from the same JSX. */
export interface ParsedLoc {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based. Points at the `<` itself (that is what esbuild gives). */
  column: number;
  /**
   * 1-based. When one piece of JSX renders several copies through `.map`, which copy was clicked.
   * Absent = there is only one, or the caller doesn't distinguish instances.
   */
  instance?: number;
}

export function parseLoc(loc: string): ParsedLoc | null {
  const m = /^(.+):(\d+):(\d+)(?:#(\d+))?$/.exec(loc);
  if (!m) return null;
  const [, file, line, column, instance] = m;
  const n = instance ? Number(instance) : undefined;
  if (n != null && (!Number.isInteger(n) || n < 1)) return null;
  return {
    file: file!,
    line: Number(line),
    column: Number(column),
    ...(n != null ? { instance: n } : {}),
  };
}

/**
 * Is this offset the `<` of an opening tag?
 *
 * `</div>` doesn't count. Nor does a comparison like `a<b` — the previous character is still part
 * of an identifier.
 */
function isJsxOpening(source: string, i: number): boolean {
  if (source[i] !== '<') return false;
  const next = source[i + 1];
  if (!next || !/[A-Za-z_$]/.test(next)) return false;
  if (i > 0 && /[\w$]/.test(source[i - 1]!)) return false;
  return true;
}

/**
 * A location should point at `<`. With a multi-line `style={{ … }}`, the preview's anchors often go
 * stale: the tag moved up in the source, and the old line and column now land inside the same
 * opening tag's attributes (in the hello example, `38:7` pointed at `textAlign`). Write-back still
 * accepts that tag rather than treating "not on the angle bracket" as uneditable.
 *
 * It only walks back to **the opening tag enclosing this position**. A position in children doesn't
 * count — that is already past the `>`, and accepting it would edit the outer tag.
 */
export function jsxOpenAt(source: string, pos: number): number {
  if (pos < 0 || pos >= source.length) return -1;
  if (isJsxOpening(source, pos)) return pos;
  for (let i = pos - 1; i >= 0; i -= 1) {
    if (!isJsxOpening(source, i)) continue;
    const end = tagEnd(source, i);
    if (end >= 0 && pos < end) return i;
  }
  return -1;
}

/** Line/column (1-based) → source offset. Returns -1 if the line doesn't exist. */
function offsetAtLoc(source: string, loc: ParsedLoc): number {
  const lines = source.split('\n');
  if (loc.line < 1 || loc.line > lines.length) return -1;
  let at = 0;
  for (let i = 0; i < loc.line - 1; i += 1) at += lines[i]!.length + 1;
  return at + loc.column - 1;
}

/** From this offset, find where the JSX tag ends (`>` or `/>`), skipping anything inside strings and braces. */
export function tagEnd(text: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') { depth += 1; continue; }
    if (ch === '}') { depth -= 1; continue; }
    if (depth === 0 && ch === '>') return i;
  }
  return -1;
}

/** Where a prop's value sits within this tag (excluding the prop name and the equals sign). */
function findProp(
  tag: string,
  prop: string,
): { start: number; end: number; whole: { start: number; end: number } } | null {
  /* The prop name must be preceded by whitespace — otherwise `dur` would match the tail of
     `durMs`, and code edited that way still compiles, with all the timing wrong. */
  const re = new RegExp(`(^|\\s)${prop}\\s*=\\s*`, 'g');
  const m = re.exec(tag);
  if (!m) return null;
  const nameStart = m.index + (m[1]?.length ?? 0);
  const valueStart = m.index + m[0].length;
  const first = tag[valueStart];
  if (first === '{') {
    let depth = 0;
    for (let i = valueStart; i < tag.length; i += 1) {
      if (tag[i] === '{') depth += 1;
      else if (tag[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          return { start: valueStart, end: i + 1, whole: { start: nameStart, end: i + 1 } };
        }
      }
    }
    return null;
  }
  if (first === '"' || first === "'") {
    const close = tag.indexOf(first, valueStart + 1);
    if (close < 0) return null;
    return { start: valueStart, end: close + 1, whole: { start: nameStart, end: close + 1 } };
  }
  return null;
}

function renderValue(value: number | string | boolean): string {
  if (typeof value === 'boolean' || typeof value === 'number') return `{${value}}`;
  return JSON.stringify(value);
}

export function renderStyleEntry(value: string | number | boolean): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/**
 * Same as above, but strings use the surrounding source's own quote style — a `"#fff"` appearing in
 * a file that is single-quoted throughout makes that diff line look like someone else wrote it.
 * `sample` is the text used to detect the quote style (one tag, or the whole file).
 */
export function renderStyleEntryLike(sample: string, value: string | number | boolean): string {
  if (typeof value !== 'string') return renderStyleEntry(value);
  const singles = (sample.match(/'/g) ?? []).length;
  const doubles = (sample.match(/"/g) ?? []).length;
  if (singles <= doubles) return renderStyleEntry(value);
  return `'${JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
}

/**
 * Where a key's value sits in something like `{ fontSize: 72, color: '#fff' }`.
 *
 * Object literals only. An extra layer of JSX braces (`{{ … }}`) is stripped before getting here.
 */
function findStyleKey(
  object: string,
  key: string,
): { start: number; end: number; whole: { start: number; end: number } } | null {
  const re = new RegExp(`(^|[,\\s{])(${key})\\s*:`, 'g');
  const m = re.exec(object);
  if (!m) return null;
  const nameStart = m.index + (m[1]?.length ?? 0);
  let i = m.index + m[0].length;
  while (i < object.length && /\s/.test(object[i]!)) i += 1;
  const valueStart = i;
  let depth = 0;
  let quote: string | null = null;
  for (; i < object.length; i += 1) {
    const ch = object[i]!;
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{' || ch === '(' || ch === '[') { depth += 1; continue; }
    if (ch === '}' || ch === ')' || ch === ']') {
      if (depth === 0) break;
      depth -= 1;
      continue;
    }
    if (depth === 0 && ch === ',') break;
  }
  /* Whitespace between the value and the comma / closing brace isn't part of the value —
     replacing it would turn `borderRadius: 20 }}` into `borderRadius: 34}}`, adding a pointless
     formatting change to the diff. */
  let end = i;
  while (end > valueStart && /\s/.test(object[end - 1]!)) end -= 1;
  return { start: valueStart, end, whole: { start: nameStart, end } };
}

/** Strip JSX `{{ … }}` down to the object literal inside. Returns null if it isn't an object literal. */
function styleObjectLiteral(raw: string): { open: number; close: number; body: string } | null {
  const inner = raw.startsWith('{') && raw.endsWith('}') ? raw.slice(1, -1).trim() : raw.trim();
  if (!inner.startsWith('{') || !inner.endsWith('}')) return null;
  return { open: 0, close: inner.length, body: inner };
}

/**
 * Write some CSS keys into this tag's `style={{ … }}`.
 *
 * Existing keys only get their value replaced; missing keys are inserted. If there is no `style`
 * yet, one is added. A `null` value deletes the key. Something like `style={theme}`, which isn't an
 * object literal, can't be written back — it is a computed style, and flattening it would lose
 * the relationship.
 */
export function patchStyleInTag(
  tag: string,
  patch: Record<string, unknown>,
): { start: number; end: number; text: string } {
  const found = findProp(tag, 'style');
  const entries = Object.entries(patch);
  if (!found) {
    const written = entries
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}: ${renderStyleEntry(v as string | number | boolean)}`);
    if (!written.length) return { start: 0, end: 0, text: '' };
    let at = tag.length;
    if (tag[at - 1] === '/') at -= 1;
    while (at > 0 && /\s/.test(tag[at - 1]!)) at -= 1;
    return { start: at, end: at, text: ` style={{ ${written.join(', ')} }}` };
  }
  const raw = tag.slice(found.start, found.end);
  const obj = styleObjectLiteral(raw);
  if (!obj) {
    throw new FilmCliError('style is not an object literal, cannot write back into it');
  }
  let body = obj.body;
  for (const [key, value] of entries) {
    const hit = findStyleKey(body, key);
    if (value === null) {
      if (!hit) continue;
      body = dropStyleKey(body, hit);
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new FilmCliError(`style.${key} can only be a number or a string`);
    }
    const text = renderStyleEntryLike(tag, value);
    if (hit) {
      body = body.slice(0, hit.start) + text + body.slice(hit.end);
      continue;
    }
    body = addStyleKey(body, `${key}: ${text}`);
  }
  return { start: found.start, end: found.end, text: `{${body}}` };
}

/**
 * Replace a style key with an expression (`n.color`) rather than a literal.
 *
 * Used when a template inside `.map` has to become "each item's own value": the literal
 * `color: '#fff'` is hoisted into `color: n.color`, and the real values land in the data array.
 * Lands in the same place as patchStyleInTag, except the value isn't JSON.
 */
export function patchStyleExprInTag(
  tag: string,
  key: string,
  expr: string,
): { start: number; end: number; text: string } {
  if (!/^[A-Za-z_$][\w$]*$/.test(expr) && !/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(expr)) {
    throw new FilmCliError(`unrecognised expression for style.${key}`);
  }
  const found = findProp(tag, 'style');
  if (!found) {
    let at = tag.length;
    if (tag[at - 1] === '/') at -= 1;
    while (at > 0 && /\s/.test(tag[at - 1]!)) at -= 1;
    return { start: at, end: at, text: ` style={{ ${key}: ${expr} }}` };
  }
  const raw = tag.slice(found.start, found.end);
  const obj = styleObjectLiteral(raw);
  if (!obj) throw new FilmCliError('style is not an object literal, cannot write back into it');
  let body = obj.body;
  const hit = findStyleKey(body, key);
  if (hit) body = body.slice(0, hit.start) + expr + body.slice(hit.end);
  else body = addStyleKey(body, `${key}: ${expr}`);
  return { start: found.start, end: found.end, text: `{${body}}` };
}

/**
 * Add a key to an object literal.
 *
 * Follow the existing layout: with one key per line, insert a new line with matching indentation;
 * when everything is on one line, append to it. Reformatting the whole object would look like
 * "this whole block changed" in the diff when the real change is one key — which is exactly why
 * this path avoids an AST library (see the file header).
 */
function addStyleKey(body: string, entry: string): string {
  const close = body.lastIndexOf('}');
  const at = close < 0 ? body.length : close;
  const head = body.slice(0, at);
  const tail = body.slice(at);
  const trimmed = head.replace(/\s+$/, '');
  /* The whitespace between the last key and `}` — kept as-is, so the closing line isn't pulled up. */
  const gap = head.slice(trimmed.length);
  const multiline = gap.includes('\n');
  if (!multiline) {
    if (trimmed.endsWith('{')) return `${trimmed} ${entry} ${tail}`;
    /* Don't add a comma if one is already there — `{ a: 1,, b: 2 }` doesn't compile. */
    const sep = trimmed.endsWith(',') ? ' ' : ', ';
    return `${trimmed}${sep}${entry}${gap || ' '}${tail}`;
  }
  const indent = /\n([ \t]*)\S.*$/.exec(trimmed)?.[1] ?? '  ';
  const sep = trimmed.endsWith('{') || trimmed.endsWith(',') ? '' : ',';
  return `${trimmed}${sep}\n${indent}${entry},${gap}${tail}`;
}

/**
 * Remove a key from an object literal.
 *
 * If the key has its own line (the usual one-key-per-line layout), the whole line goes with it —
 * removing only the key would leave a line of bare indentation, and the next agent turn would read
 * code it never wrote.
 */
function dropStyleKey(
  body: string,
  hit: { whole: { start: number; end: number } },
): string {
  let from = hit.whole.start;
  let to = hit.whole.end;
  if (body[to] === ',') {
    to += 1;
    /* Take the space after the comma along, or a double space like `{  height: 80 }` is left behind. */
    while (body[to] === ' ' || body[to] === '\t') to += 1;
  } else if (body[from - 1] === ',') from -= 1;
  const lineStart = body.lastIndexOf('\n', hit.whole.start - 1) + 1;
  const lineEnd = body.indexOf('\n', to);
  const aloneOnLine = lineStart > 0
    && lineEnd >= 0
    && body.slice(lineStart, hit.whole.start).trim() === ''
    && body.slice(to, lineEnd).trim() === '';
  if (aloneOnLine) return body.slice(0, lineStart - 1) + body.slice(lineEnd);
  return body.slice(0, from) + body.slice(to);
}

/**
 * What to change a computed original value into.
 *
 * Times in a film are often tied to the transcript: `at={Q17}`, where `Q17 = said(L, '17').start` —
 * the moment the narration says "17". And **the same variable usually also drives the on-screen
 * animation**, so the sound effect and the motion stay locked to the same word and move together
 * automatically after a re-record.
 *
 * Flattening it to `at={8.86}` destroys that: the sound effect is pinned at 8.86 s while the
 * picture still follows `Q17`, so the next voice-over takes sound and picture apart — an error only
 * noticed by listening.
 *
 * So a drag changes the **offset**, not the whole value: `{Q17}` → `{Q17 + 0.34}`. The user can
 * drag, and the alignment is kept. If there is already an offset term, that number changes instead
 * of adding another.
 */
function shiftExpression(raw: string, target: number, current: number): string | null {
  const inner = raw.startsWith('{') ? raw.slice(1, -1).trim() : raw.trim();
  if (!inner || /^-?\d+(\.\d+)?$/.test(inner)) return null;
  const delta = Math.round((target - current) * 1000) / 1000;
  /* If it already ends in `+ 0.34` / `- 0.12`, replace that along with its sign — three drags shouldn't grow three plus signs. */
  const tail = /^(.*?)\s*([+-])\s*(\d+(?:\.\d+)?)$/s.exec(inner);
  const base = tail ? tail[1]!.trim() : inner;
  const had = tail ? Number(tail[3]) * (tail[2] === '-' ? -1 : 1) : 0;
  const next = Math.round((had + delta) * 1000) / 1000;
  if (next === 0) return `{${base}}`;
  return `{${base} ${next > 0 ? '+' : '-'} ${Math.abs(next)}}`;
}

/**
 * Apply several edits to one source file.
 *
 * Edits in the same file are applied together and **back to front** — front to back, the first
 * replacement would shift every later position by the difference in length between old and new
 * values. That kind of error is never reported; it just writes a number into some other prop.
 */
/**
 * Did this edit hard-code a **computed** value?
 *
 * Times in a film are often computed: `at={CUE[2] * 1000}`, `at={XAT * 1000}`. One drag would
 * replace the whole expression with a constant — correct on screen, but that line of code is cut
 * off from what it depended on, and the next agent turn reads code it never wrote.
 *
 * Normally a drag only shifts the offset (see shiftExpression) and the expression stays. This
 * checks the case where **that wasn't possible** — the caller didn't pass `from` (no original
 * value, so no offset can be computed), so the whole thing has to be replaced. Then it must be
 * said: that line is now cut off from what it depended on.
 */
export function overwritesExpression(source: string, edit: PropEdit): boolean {
  const loc = parseLoc(edit.loc);
  if (!loc || typeof edit.value !== 'number') return false;
  // With the original value we can shift just the offset, and the expression isn't flattened.
  if (edit.from != null) return false;
  const open = jsxOpenAt(source, offsetAtLoc(source, loc));
  if (open < 0) return false;
  const end = tagEnd(source, open);
  if (end < 0) return false;
  const found = findProp(source.slice(open, end), edit.prop);
  if (!found) return false;
  const raw = source.slice(open + found.start, open + found.end).trim();
  const inner = raw.startsWith('{') ? raw.slice(1, -1).trim() : raw;
  return !/^-?\d+(\.\d+)?$/.test(inner);
}

export function applyPropEdits(source: string, edits: readonly PropEdit[]): string {
  const lines = source.split('\n');
  /** Start offset of each line. */
  const lineStart: number[] = [];
  let at = 0;
  for (const line of lines) {
    lineStart.push(at);
    at += line.length + 1;
  }

  interface Resolved { start: number; end: number; text: string }
  const resolved: Resolved[] = [];

  for (const raw of edits) {
    const edit = { ...raw, value: coerceTimePropValue(raw.prop, raw.value) };
    /* `style` is the only prop that takes an object — writing it back isn't "replace this value"
       but "add a few keys to that object" (see patchStyleInTag). Other objects (transform / mask /
       props) have no such landing spot in JSX; they can only go into the film doc. */
    const stylePatch = edit.prop === 'style' && edit.value !== null && typeof edit.value === 'object'
      ? edit.value as Record<string, unknown>
      : null;
    if (!stylePatch && edit.value !== null && typeof edit.value === 'object') {
      throw new FilmCliError(
        `${edit.prop} is an object, the JSX path cannot write that. The film.json form takes film.json#track.clip`,
      );
    }
    const value = edit.value as number | string | boolean | null;
    const loc = parseLoc(edit.loc);
    if (!loc) throw new FilmCliError(`unrecognised loc format: ${edit.loc}`);
    const base = lineStart[loc.line - 1];
    if (base == null) throw new FilmCliError(`${edit.loc}: this file has no line ${loc.line}`);
    /* The column points at `<`. A tag can span many lines (one prop per line is common), so the
       end has to be scanned for rather than taken from this line. When a preview anchor is stale,
       the position lands inside the same opening tag's attributes; walk back to the `<`. */
    const open = jsxOpenAt(source, base + loc.column - 1);
    if (open < 0) {
      throw new FilmCliError(`${edit.loc}: this position is not the start of a JSX tag`);
    }
    const end = tagEnd(source, open);
    if (end < 0) throw new FilmCliError(`${edit.loc}: this tag never closes`);
    const tag = source.slice(open, end);

    if (stylePatch) {
      /* When one piece of JSX renders several copies (`.map`), an edit without an instance number
         keeps the old behavior and edits the template — all six cards move. With `#n`, only that
         copy changes: fields from the data array are edited in the array, shared literals are
         hoisted into per-item values, and `'HELLO'.split('').map` is unrolled into separate pieces
         (see edit-map-style). */
      if (loc.instance != null) {
        const mapped = mappedStyleEdits(source, loc, stylePatch, { open, tag });
        if (mapped) {
          resolved.push(...mapped);
          continue;
        }
      }
      const patch = patchStyleInTag(tag, stylePatch);
      if (patch.text || patch.end !== patch.start) {
        resolved.push({ start: open + patch.start, end: open + patch.end, text: patch.text });
      }
      continue;
    }

    const found = findProp(tag, edit.prop);
    if (value === null) {
      if (!found) continue;
      /* Delete the preceding space too, or a double space like `<Seq  dur={1}>` is left behind. */
      const from = open + found.whole.start;
      const before = source[from - 1] === ' ' ? from - 1 : from;
      resolved.push({ start: before, end: open + found.whole.end, text: '' });
      continue;
    }
    if (found) {
      const raw = source.slice(open + found.start, open + found.end);
      /* If the original value is computed (a time tied to the transcript), shift only the offset
         and don't flatten the expression into a constant — that would cut this line off from what
         it depends on, and the same variable most likely also drives the on-screen animation. */
      const shifted = typeof value === 'number' && edit.from != null
        ? shiftExpression(raw, value, edit.from)
        : null;
      resolved.push({
        start: open + found.start,
        end: open + found.end,
        text: shifted ?? renderValue(value),
      });
      continue;
    }
    /* The prop doesn't exist yet (e.g. the scene was laid out in sequence by `<Series>` and never
       had a `from`). Insert it **after the last prop**: inserting right after the tag name would
       push something you look for at a glance, like `src`, into second place, and people read a
       line of JSX straight from the name to the src. */
    if (!/^<[A-Za-z_$][\w$.]*/.test(tag)) {
      throw new FilmCliError(`${edit.loc}: this does not look like a JSX tag`);
    }
    /* Skip back over the closing `/` and whitespace, landing at the end of the last prop. */
    let at = tag.length;
    if (tag[at - 1] === '/') at -= 1;
    while (at > 0 && /\s/.test(tag[at - 1]!)) at -= 1;
    resolved.push({
      start: open + at,
      end: open + at,
      text: ` ${edit.prop}=${renderValue(value)}`,
    });
  }

  let out = source;
  for (const r of resolved.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

/**
 * Where an element starts and ends (children included), and whether it is self-closing.
 *
 * `open` points at `<`. A self-closing element (`<Sfx … />`) ends at tagEnd; one with children needs
 * its matching `</Name>` — the same name can nest (`<Seq>` inside `<Seq>` is the usual way to make
 * chapters), so depth is counted.
 *
 * When scanning children only two things matter: braces (expressions and comments live inside
 * them, and any `</Seq>` text there doesn't count) and tags (handed to tagEnd, which skips attribute
 * strings itself). JSX text can't contain a bare `<` (it wouldn't compile), so any `<` seen is a
 * tag.
 */
function elementEnd(source: string, open: number): { end: number; selfClosing: boolean } {
  const gt = tagEnd(source, open);
  if (gt < 0) throw new FilmCliError('this tag never closes');
  if (source[gt - 1] === '/') return { end: gt, selfClosing: true };
  const name = /^<([A-Za-z_$][\w$.]*)/.exec(source.slice(open, gt + 1))?.[1];
  if (!name) throw new FilmCliError('this position is not the start of a JSX tag');

  let depth = 0;
  let brace = 0;
  let quote: string | null = null;
  let i = gt + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (brace > 0) {
      if (quote) {
        if (ch === quote && source[i - 1] !== '\\') quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') brace += 1;
      else if (ch === '}') brace -= 1;
      i += 1;
      continue;
    }
    if (ch === '{') { brace = 1; i += 1; continue; }
    if (ch !== '<') { i += 1; continue; }
    if (source.startsWith(`</${name}>`, i)) {
      if (depth === 0) return { end: i + name.length + 2, selfClosing: false };
      depth -= 1;
      i += name.length + 3;
      continue;
    }
    if (source[i + 1] === '/') {
      const close = source.indexOf('>', i);
      if (close < 0) throw new FilmCliError(`</…> never closes (around byte ${i})`);
      i = close + 1;
      continue;
    }
    const inner = tagEnd(source, i);
    if (inner < 0) throw new FilmCliError(`this tag never closes (around byte ${i})`);
    const opened = new RegExp(`^<${name.replace(/[.$]/g, '\\$&')}[\\s/>]`).test(source.slice(i, i + name.length + 2));
    if (opened && source[inner - 1] !== '/') depth += 1;
    i = inner + 1;
  }
  throw new FilmCliError(`<${name}> has no matching </${name}>`);
}

/** Start and indentation of the line containing this offset. */
function lineAround(source: string, offset: number): { start: number; indent: string } {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  const indent = /^[ \t]*/.exec(source.slice(start, offset + 1))?.[0] ?? '';
  return { start, indent };
}

/** Lay out an element's (possibly multi-line) source at the given indentation — relative indentation inside is kept. */
function indentBlock(element: string, indent: string): string {
  return element.trim().split('\n').map((line) => indent + line).join('\n');
}

/** Insert a new element into the source. */
export interface InsertEdit {
  /**
   * Which container it goes into. `file:line:column` (pointing at the opening tag's `<`, the same
   * kind of loc as elsewhere), or a component name (`Tracks`) — a name only works when it appears
   * exactly once in the file; with two or more there's no telling which one.
   */
  container: string;
  /** Source of the element to insert. Multi-line is fine; relative indentation inside is kept. */
  element: string;
  /** Insert after this sibling element (`file:line:column`). Without it, insert just before the container's closing tag. */
  after?: string;
}

/**
 * Insert a new element into a container.
 *
 * Copy-paste, or pasting an element copied from another project, means **one more line** in the
 * source — the prop-editing path can't do that: it only changes numbers and can't create anything.
 *
 * What is inserted is **the text verbatim**, with only the indentation adjusted. Validation is left
 * to the evaluation after writing: if the inserted code doesn't compile, the caller (/film/edit)
 * rolls the whole thing back — no half-parser here.
 */
export function insertElement(source: string, edit: InsertEdit): string {
  /* Insert after a sibling: the new block gets the same indentation, right after the sibling's end. */
  if (edit.after) {
    const loc = parseLoc(edit.after);
    if (!loc) throw new FilmCliError(`unrecognised loc format: ${edit.after}`);
    const lines = source.split('\n');
    if (lines[loc.line - 1] == null) throw new FilmCliError(`${edit.after}: this file has no line ${loc.line}`);
    const open = jsxOpenAt(source, offsetAtLoc(source, loc));
    if (open < 0) throw new FilmCliError(`${edit.after}: this position is not the start of a JSX tag`);
    const { end } = elementEnd(source, open);
    const { indent } = lineAround(source, open);
    return source.slice(0, end + 1)
      + '\n' + indentBlock(edit.element, indent)
      + source.slice(end + 1);
  }

  /* Find the container's opening tag. */
  const byLoc = parseLoc(edit.container);
  let open: number;
  if (byLoc) {
    const lines = source.split('\n');
    if (lines[byLoc.line - 1] == null) {
      throw new FilmCliError(`${edit.container}: this file has no line ${byLoc.line}`);
    }
    open = jsxOpenAt(source, offsetAtLoc(source, byLoc));
    if (open < 0) {
      throw new FilmCliError(`${edit.container}: this position is not the start of a JSX tag`);
    }
  } else {
    if (!/^[A-Za-z_$][\w$.]*$/.test(edit.container)) {
      throw new FilmCliError(`unrecognised container: ${edit.container} — give a component name, or file:line:column`);
    }
    const re = new RegExp(`<${edit.container.replace(/[.$]/g, '\\$&')}[\\s/>]`, 'g');
    const hits: number[] = [];
    for (const m of source.matchAll(re)) hits.push(m.index);
    if (!hits.length) throw new FilmCliError(`no <${edit.container}> in this file`);
    if (hits.length > 1) {
      throw new FilmCliError(`this file has ${hits.length} <${edit.container}>, use file:line:column to say which one`);
    }
    open = hits[0]!;
  }

  const { end, selfClosing } = elementEnd(source, open);
  const { indent } = lineAround(source, open);
  const child = indentBlock(edit.element, indent + '  ');

  /* An empty container written as self-closing (`<Tracks />`): expand it into a pair, then put the new block inside. */
  if (selfClosing) {
    const name = /^<([A-Za-z_$][\w$.]*)/.exec(source.slice(open, end + 1))![1]!;
    let tail = end - 1;
    while (tail > open && /\s/.test(source[tail - 1]!)) tail -= 1;
    return source.slice(0, tail) + '>\n' + child + '\n' + indent + `</${name}>` + source.slice(end + 1);
  }

  /* Insert just before the closing tag. If the closing tag has its own line (the usual case),
     insert a new line; if it shares a line with the children, break the line there — the layout
     changes, but there is no other correct answer. */
  const closeStart = source.lastIndexOf('</', end);
  const { start: closeLineStart, indent: closeIndent } = lineAround(source, closeStart);
  const onOwnLine = source.slice(closeLineStart, closeStart).trim() === '';
  if (onOwnLine) {
    return source.slice(0, closeLineStart) + child + '\n' + source.slice(closeLineStart);
  }
  return source.slice(0, closeStart) + '\n' + child + '\n' + closeIndent + source.slice(closeStart);
}

/**
 * Remove an element from the source.
 *
 * "Delete this clip" on the timeline means **one line less** in the source. It pairs with split:
 * one creates something new, the other erases something existing.
 *
 * When the line (or lines) contain only this element, the lines go too; otherwise only the element
 * itself is removed — anything else would leave a line of lonely indentation, and the next agent
 * turn would read code with an extra blank line.
 *
 * Platform components with children (`<Seq>…</Seq>`) aren't deleted: they hold other clips, so
 * deleting one would delete those too, while the user clicked "this clip", not "this pile". Native
 * tags clicked on screen (`<div>text</div>`, `<path … />`) can be deleted — that layer is exactly
 * what the user pointed at.
 */
export function removeElement(source: string, loc: string): string {
  const parsed = parseLoc(loc);
  if (!parsed) throw new FilmCliError(`unrecognised loc format: ${loc}`);
  const lines = source.split('\n');
  if (lines[parsed.line - 1] == null) throw new FilmCliError(`${loc}: this file has no line ${parsed.line}`);
  const open = jsxOpenAt(source, offsetAtLoc(source, parsed));
  if (open < 0) throw new FilmCliError(`${loc}: this position is not the start of a JSX tag`);
  const span = elementEnd(source, open);
  const name = /^<([A-Za-z_$][\w$.]*)/.exec(source.slice(open, span.end))?.[1];
  if (!span.selfClosing && !(name && /^[a-z]/.test(name))) {
    throw new FilmCliError(
      'This clip has other things inside it, cannot delete — you clicked this one clip, not the whole pile',
    );
  }
  /* elementEnd's end points at the last character (`>`); the removed range is half-open. */
  return dropSpan(source, open, span.end + 1);
}

/** Remove [open, end). If it occupies whole lines by itself, the lines go too. */
function dropSpan(source: string, open: number, end: number): string {
  const lineStart = source.lastIndexOf('\n', open - 1) + 1;
  const afterNl = source.indexOf('\n', end);
  const lineTailEnd = afterNl < 0 ? source.length : afterNl;
  const before = source.slice(lineStart, open);
  const after = source.slice(end, lineTailEnd);
  if (before.trim() !== '' || after.trim() !== '') {
    return source.slice(0, open) + source.slice(end);
  }
  if (afterNl < 0) return source.slice(0, lineStart);
  return source.slice(0, lineStart) + source.slice(afterNl + 1);
}
