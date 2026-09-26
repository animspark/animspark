/**
 * Write a line of text edited on screen back to the source.
 *
 * The user double-clicks a title in the preview and changes a couple of words — the line belongs
 * in the children of a tag on some line of some file: `<h1>Old title</h1>` becomes
 * `<h1>New title</h1>`. The prop-editing path (applyPropEdits) can't do this; it only handles
 * `prop="…"`, and text on screen is almost always written between tags.
 *
 * Same rule as prop editing: **targeted text replacement, never reprint the AST**. A film is code
 * written by people and agents, with comments, variables and expressions computed from
 * transcripts; serializing the tree back would reformat the whole file, and the next agent turn
 * would face code it never wrote. So only those words are replaced; no other character is touched,
 * and indentation and line breaks stay as they were.
 *
 * Three shapes can be edited:
 *
 *   ① Written between tags: `<h1>Two trillion</h1>`.
 *   ② Handed to a child component: `<div><Chars text="There is a company" /></div>` — per-letter
 *      animation, typewriter and line-split effects all have this shape; the line is a prop, not
 *      children. **The most prominent large text on screen usually lives here**, so this path isn't
 *      an extra, it is the main one.
 *   ③ Split up by styling: `<div>$1B<span style={blue}>-</span></div>`. Clicking "$1B" replaces
 *      only that run; clicking the whole line still splits at the anchors, leaving the small styled
 *      tags as they are. The two must not be mixed: if the top level joined both runs into "$1B-"
 *      and edited that, the lower level would require the new line to keep the "-", and error if
 *      it didn't.
 *
 * Nothing else is edited: `<h1>{title}</h1>` isn't written here at all. A mechanical replacement
 * would change what the code means, while the user thinks they only changed two words. If it can't
 * be edited, say so and let them ask the agent.
 */

import { FilmCliError } from '../workspace';

import { jsxOpenAt, parseLoc, tagEnd } from './edit-props';

/** Edit one line: replace the text of the tag at this location with this. */
export interface TextEdit {
  /** Location pointing at the `<`, same scheme as prop edits (see parseLoc). */
  loc: string;
  /** The new text. */
  value: string;
  /**
   * What the screen said before the edit.
   *
   * The location was injected **at the last compile**, and the source may have been rewritten by
   * the agent since (the preview is open while another conversation turn runs). Without this check
   * the edit would land on a line that no longer exists — it would still compile, it would just
   * replace some other text. Whitespace differences don't count (the line may be wrapped in the
   * source).
   *
   * For a line split by styling this may be the whole line (`$1B-`) or the clicked run (`$1B`).
   * Whichever matches decides how the edit is applied; see replaceMixedChildren.
   */
  expect?: string;
  /**
   * For a line split by styling, which editable run was clicked (0-based; blank runs don't count).
   *
   * When given, only that run is replaced, and the new text needn't keep the neighbouring styled
   * anchors. When two runs have the same text, expect alone can't tell them apart; this is needed.
   */
  run?: number;
}

/** Location → offset of the opening tag's `<`. Line and column are 1-based; a position inside the same opening tag's attributes also counts. */
function openAt(source: string, loc: string): number {
  const parsed = parseLoc(loc);
  if (!parsed) throw new FilmCliError(`unrecognised loc format: ${loc}`);
  const lines = source.split('\n');
  if (lines[parsed.line - 1] == null) throw new FilmCliError(`${loc}: this file has no line ${parsed.line}`);
  let at = 0;
  for (let i = 0; i < parsed.line - 1; i += 1) at += lines[i]!.length + 1;
  const open = jsxOpenAt(source, at + parsed.column - 1);
  if (open < 0) throw new FilmCliError(`${loc}: this position is not the start of a JSX tag`);
  return open;
}

/** Line breaks and whitespace don't count as differences — the line may be wrapped over two lines in the source but show as one on screen. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * How a line is written as JSX.
 *
 * Line breaks become `<br />`, not a `\n` in a string — HTML swallows `\n` as whitespace, so the
 * user's Shift+Enter would do nothing on screen (while the source clearly gained a line break,
 * which is even harder to track down).
 *
 * Otherwise: bare JSX text can't contain `{}<>`, and JSX itself eats leading/trailing whitespace;
 * both cases are written as a string expression (`{"…"}`) — another way to write the same line,
 * and one that never gets mangled.
 */
export function renderJsxText(value: string): string {
  if (value === '') return '{""}';
  return value
    .split('\n')
    .map((line) => {
      if (line === '') return '';
      const plain = !/[<>{}]/.test(line) && line === line.trim();
      return plain ? line : `{${JSON.stringify(line)}}`;
    })
    .join('<br />');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * children written as `{"…"}` — **the line is still hard-coded**, just written differently.
 *
 * Who writes it this way: renderJsxText above. A line with leading/trailing spaces, or containing
 * `{}<>`, gets mangled in bare JSX (whitespace eaten, braces taken as expressions), so it has to be
 * wrapped in a string expression.
 *
 * Without this, text editing would be **one-way**: the user adds a space at the end of a title on
 * screen, the line becomes `{"Title "}`, and the next click on it is judged "computed, changing it
 * means changing the code" — even though a second ago they produced it themselves in the same box.
 * One added space would lock the line forever, for a reason the user can never see.
 */
const QUOTED_CHILD = /^\{\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\}$/;

function quotedChildText(raw: string): string | null {
  const literal = QUOTED_CHILD.exec(raw.trim())?.[1];
  if (!literal) return null;
  /* Convert single-quoted strings into valid JSON double-quoted ones first, then use the same
     parser — escape sequences (\n, \u4e00) are the same under both quote styles, and writing a
     second parser would only produce a second way to get it wrong. */
  const json = literal.startsWith('"')
    ? literal
    : `"${literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** One run in children: editable text, or a tag kept as-is (its own text is fixed). */
interface Segment {
  kind: 'text' | 'element';
  start: number;
  end: number;
  /** The run exactly as in the source (leading/trailing whitespace is kept when writing back). */
  raw: string;
  /** The text this run contributes on screen. `<br />` contributes a line break. */
  text: string;
}

/**
 * Which characters a run of bare JSX text actually shows on screen.
 *
 * JSX has its own whitespace rules (different from HTML): all-whitespace lines are dropped, each
 * line's leading and trailing indentation is dropped, and the remaining lines are joined with a
 * space. Long lines in a film are almost always wrapped —
 *
 *     <div className="safety">
 *       Safety<span style={{ color: orange }}>,</span> comes before capability
 *     </div>
 *
 * That indentation doesn't exist on screen. **Comparing the raw source with the on-screen text,
 * nothing matches** — so this applies JSX's own rules (the same thing Babel/esbuild do at compile
 * time).
 */
function renderedJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastFilled = 0;
  lines.forEach((line, i) => { if (/[^ \t]/.test(line)) lastFilled = i; });
  let out = '';
  lines.forEach((line, i) => {
    let trimmed = line.replace(/\t/g, ' ');
    if (i !== 0) trimmed = trimmed.replace(/^ +/, '');
    if (i !== lines.length - 1) trimmed = trimmed.replace(/ +$/, '');
    if (trimmed) out += i === lastFilled ? trimmed : `${trimmed} `;
  });
  return out;
}

/**
 * Split children into "editable text" and "tags kept as-is".
 *
 * Why split: lines in a film often carry styling — `Safety<span style={orange}>,</span> comes
 * before capability`. Rewriting the whole thing would flatten the orange punctuation along with its
 * color (the user thinks they changed a few words, but actually changed the design too); refusing
 * the whole line would leave the most prominent lines in a film uneditable. So the styled runs are
 * **fixed anchors**: the new line must still contain them, it is split at them, and only the text
 * in between is replaced.
 *
 * Returns null when it can't be split (nested tags, computed text); then the AI takes over.
 */
function splitChildren(
  source: string,
  from: number,
  closing: RegExp,
): { segments: Segment[]; end: number } | null {
  const segments: Segment[] = [];
  /* Merge adjacent text into one run (bare text and `<br />` alternate) — with only one editable
     run between anchors, the new line has a unique way to be split. */
  const addText = (start: number, end: number, text: string) => {
    const last = segments[segments.length - 1];
    if (last?.kind === 'text' && last.end === start) {
      last.end = end;
      last.raw = source.slice(last.start, end);
      last.text += text;
      return;
    }
    segments.push({ kind: 'text', start, end, raw: source.slice(start, end), text });
  };
  let pos = from;
  for (;;) {
    const next = source.indexOf('<', pos);
    if (next < 0) return null;
    if (next > pos) addText(pos, next, renderedJsxText(source.slice(pos, next)));
    if (closing.test(source.slice(next))) {
      return segments.length ? { segments, end: next } : null;
    }
    const openEnd = tagEnd(source, next);
    if (openEnd < 0) return null;
    const name = /^<\s*([A-Za-z_$][\w$.:-]*)/.exec(source.slice(next, openEnd + 1))?.[1];
    if (!name) return null;
    if (source[openEnd - 1] === '/') {
      /* The only self-closing tag accepted is `<br />`; others (icons, decorations) contribute no text — those can't be split. */
      if (name.toLowerCase() !== 'br') return null;
      /* A line break counts as **part of the text**, not an anchor: it carries no styling, and
         the new line can express it or not. As an anchor, a user joining two lines back into one
         would be refused — when that should be an ordinary text edit. */
      addText(next, openEnd + 1, '\n');
      pos = openEnd + 1;
      continue;
    }
    /* Tags with children: only accepted when the inside is exactly one run of literal text (`<span>,</span>`). */
    const innerStart = openEnd + 1;
    const innerNext = source.indexOf('<', innerStart);
    if (innerNext < 0) return null;
    const close = new RegExp(`^</\\s*${escapeRegExp(name)}\\s*>`).exec(source.slice(innerNext));
    if (!close) return null;
    const inner = source.slice(innerStart, innerNext);
    if (inner.includes('{') || inner.includes('}')) return null;
    const end = innerNext + close[0].length;
    segments.push({
      kind: 'element',
      start: next,
      end,
      raw: source.slice(next, end),
      text: renderedJsxText(inner),
    });
    pos = end;
  }
}

/**
 * Distribute the new line back into the text runs around the fixed anchors.
 *
 * Anchors are looked up in order in the new line: if one isn't found, the user deleted or changed
 * the styled part — and then we mustn't guess, because a wrong guess silently changes the design
 * on screen.
 */
function distribute(segments: readonly Segment[], value: string): (string | null)[] | null {
  const out: (string | null)[] = [];
  let rest = value;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    if (seg.kind === 'element') {
      if (!rest.startsWith(seg.text)) return null;
      rest = rest.slice(seg.text.length);
      out.push(null);
      continue;
    }
    const nextElement = segments.slice(i + 1).find((s) => s.kind === 'element');
    if (!nextElement) {
      out.push(rest);
      rest = '';
      continue;
    }
    const at = rest.indexOf(nextElement.text);
    if (at < 0) return null;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  return rest === '' ? out : null;
}

/**
 * Edit one line in a source file.
 *
 * Throws when the edit can't be made — the message is for the user (it shows up on the preview
 * page), so it says why the edit can't be made, not which assertion failed.
 */
export function applyTextEdit(source: string, edit: TextEdit): string {
  const open = openAt(source, edit.loc);
  const end = tagEnd(source, open);
  if (end < 0) throw new FilmCliError(`${edit.loc}: this tag never closes`);
  if (source[end - 1] === '/') {
    throw new FilmCliError('This tag is self-closing, there is no text inside it to change');
  }
  const name = /^<\s*([A-Za-z_$][\w$.:-]*)/.exec(source.slice(open, end + 1))?.[1];
  if (!name) throw new FilmCliError(`${edit.loc}: this does not look like a JSX tag`);

  /* The inner part starts after `>` and runs to the next `<`. If that `<` is this tag's own closing
     tag, the inside is text only; if it is another tag, the line was handed to a child component
     (path ② below). */
  const childStart = end + 1;
  const nextTag = source.indexOf('<', childStart);
  if (nextTag < 0) throw new FilmCliError(`${edit.loc}: this tag never closes`);
  const closing = new RegExp(`^</\\s*${escapeRegExp(name)}\\s*>`);
  const raw = source.slice(childStart, nextTag);

  /* ③ The line is split up by styling: `Safety<span style={orange}>,</span> comes before
     capability`. The styled runs are fixed anchors and only the text in between is replaced —
     otherwise changing a few words would flatten the punctuation's color too. */
  const split = splitChildren(source, childStart, closing);
  /* With small styled tags, or an existing line break (`<br />`, which is '\n' in text), the edit
     has to go run by run. A single run of plain text takes the simpler path below (leading and
     trailing indentation kept). */
  if (split && split.segments.some((s) => s.kind === 'element' || s.text.includes('\n'))) {
    return replaceMixedChildren(source, split, edit);
  }

  /* ② The line is **passed down**: `<div><Chars text="There is a company" /></div>`. Per-letter
     animation, typewriter and line-split effects all have this shape, and they are the most
     prominent text on screen — without this path, the lines most often edited in a film couldn't
     be edited at all. What changes is the string prop on the child element. */
  if (!closing.test(source.slice(nextTag))) {
    if (raw.trim()) {
      throw new FilmCliError(
        `the words inside <${name}> are split across several places (some written straight in, some in other tags),`
        + ' changing it this way would change the wrong ones — let the AI do it',
      );
    }
    return replaceChildStringProp(source, nextTag, edit);
  }

  /* ① The line is written right between the tags — bare, or wrapped as `{"…"}`. */
  const quoted = quotedChildText(raw);
  if (quoted == null && (raw.includes('{') || raw.includes('}'))) {
    throw new FilmCliError('This line is computed, not typed in — changing it means changing the code');
  }
  const current = quoted ?? raw;
  if (!current.trim()) throw new FilmCliError(`<${name}> has no text in it to begin with`);
  if (edit.expect != null && normalize(current) !== normalize(edit.expect)) {
    /* Most likely the source was rewritten while the preview was open (another conversation turn
       is running). Say clearly that it doesn't match rather than that it failed — the user's next
       step is to refresh and see what it says now. */
    throw new FilmCliError(
      `the source no longer says "${normalize(edit.expect)}" (it now says "${normalize(current)}")`
      + ' — the film was just changed, refresh and try again',
    );
  }

  /* Replace only the trimmed part, keeping leading/trailing line breaks and indentation — changing
     two words in a line shouldn't add formatting changes to the diff. */
  const lead = raw.length - raw.trimStart().length;
  const tail = raw.length - raw.trimEnd().length;
  return source.slice(0, childStart + lead)
    + renderJsxText(edit.value)
    + source.slice(nextTag - tail);
}

/** Replace only the text runs in children; styled tags stay as they are. */
function replaceMixedChildren(
  source: string,
  split: { segments: Segment[]; end: number },
  edit: TextEdit,
): string {
  const { segments } = split;
  const whole = segments.map((s) => s.text).join('');
  const textSegs = segments.filter((s) => s.kind === 'text' && normalize(s.text) !== '');
  const run = mixedRunTarget(textSegs, edit, whole);
  if (run) {
    if (edit.expect != null && normalize(run.text) !== normalize(edit.expect)) {
      throw new FilmCliError(
        `the source no longer says "${normalize(edit.expect)}" (it now says "${normalize(run.text)}")`
        + ' — the film was just changed, refresh and try again',
      );
    }
    return rewriteMixedSegments(source, split, (seg) => (seg === run ? edit.value : null));
  }
  if (edit.expect != null && normalize(whole) !== normalize(edit.expect)) {
    throw new FilmCliError(
      `the source no longer says "${normalize(edit.expect)}" (it now says "${normalize(whole)}")`
      + ' — the film was just changed, refresh and try again',
    );
  }
  const parts = distribute(segments, edit.value);
  if (!parts) {
    const fixed = segments
      .filter((s) => s.kind === 'element')
      .map((s) => (s.text === '\n' ? 'line break' : `"${s.text}"`))
      .join(', ');
    throw new FilmCliError(
      `the ${fixed} in this line carries styling of its own, the new line has to keep it as-is`
      + ' (same order too), or that styling goes with it',
    );
  }
  return rewriteMixedSegments(source, split, (_seg, i) => parts[i] ?? null);
}

/**
 * Whether the click was on one run's own text or on the whole line.
 *
 * An expect for the whole line matches the joined text, so split at the anchors; an expect for one
 * run matches only that run, so replace only that run — the new text needn't carry the "-". When
 * two runs have the same text, run must be given, or they can't be told apart.
 */
function mixedRunTarget(
  textSegs: readonly Segment[],
  edit: TextEdit,
  whole: string,
): Segment | null {
  if (edit.run != null) {
    const target = textSegs[edit.run];
    if (!target) {
      throw new FilmCliError(`this line has no run ${edit.run + 1} of editable text`);
    }
    return target;
  }
  if (edit.expect == null) return null;
  if (normalize(edit.expect) === normalize(whole)) return null;
  const hits = textSegs.filter((s) => normalize(s.text) === normalize(edit.expect!));
  if (hits.length > 1) {
    throw new FilmCliError(
      `${hits.length} places in this line say "${normalize(edit.expect)}", cannot tell which run to change — let the AI do it`,
    );
  }
  return hits[0] ?? null;
}

/** Write back run by run: text runs get new text, styled tags stay as-is. `next` returning null leaves that run unchanged. */
function rewriteMixedSegments(
  source: string,
  split: { segments: Segment[]; end: number },
  next: (seg: Segment, index: number) => string | null,
): string {
  const { segments } = split;
  let out = source.slice(0, segments[0]!.start);
  segments.forEach((seg, i) => {
    if (seg.kind === 'element') {
      out += seg.raw;
      return;
    }
    const value = next(seg, i);
    if (value == null) {
      out += seg.raw;
      return;
    }
    /* Keep indentation and wrapping, replace only the words in between — changing two words shouldn't add a pile of formatting changes to the diff. */
    const blank = seg.raw.trim() === '';
    const lead = blank ? seg.raw : seg.raw.slice(0, seg.raw.length - seg.raw.trimStart().length);
    const tail = blank ? '' : seg.raw.slice(seg.raw.trimEnd().length);
    out += lead + (value ? renderJsxText(value) : '') + tail;
  });
  return out + source.slice(split.end);
}

/**
 * The line is a string prop on a child element; replace it.
 *
 * **Which prop is identified by matching the on-screen text, not by guessing names.** Every film
 * names these props differently (`text` / `label` / `line` / `title`); guessing names is bound to go
 * wrong eventually, and changing the wrong prop silently changes something else on screen.
 * Comparing against the original is deterministic: edit only on a match, otherwise say it can't be
 * edited.
 *
 * This also catches "the source has already changed" — then no prop matches.
 */
function replaceChildStringProp(source: string, childOpen: number, edit: TextEdit): string {
  const childEnd = tagEnd(source, childOpen);
  if (childEnd < 0) throw new FilmCliError(`${edit.loc}: the tag inside never closes`);
  const expect = edit.expect == null ? null : normalize(edit.expect);
  if (!expect) {
    throw new FilmCliError(
      'This line is handed to the component inside, cannot change it without knowing what it said before',
    );
  }
  const tag = source.slice(childOpen, childEnd + 1);
  /* Only literal string props are accepted (`text="…"`, `text='…'`). A line written as
     `text={t}` lives elsewhere and can't be edited, just like children that are an expression. */
  const attr = /([A-Za-z_$][\w$]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  const hits: { start: number; end: number; name: string }[] = [];
  for (let m = attr.exec(tag); m; m = attr.exec(tag)) {
    const value = m[3] ?? m[4] ?? '';
    if (normalize(value) !== expect) continue;
    hits.push({
      start: childOpen + m.index + m[0].length - m[2]!.length,
      end: childOpen + m.index + m[0].length,
      name: m[1]!,
    });
  }
  if (!hits.length) {
    throw new FilmCliError(
      `no prop on the component inside says "${expect}" — this line may be computed, or the film was just changed`,
    );
  }
  if (hits.length > 1) {
    throw new FilmCliError(
      `${hits.length} props on the component inside say "${expect}", cannot tell which one to change — let the AI do it`,
    );
  }
  const hit = hits[0]!;
  return source.slice(0, hit.start) + JSON.stringify(edit.value) + source.slice(hit.end);
}
