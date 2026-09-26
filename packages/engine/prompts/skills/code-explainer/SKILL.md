---
name: code-explainer
description: "Animate source code changing between versions and step through execution state in MG scenes."
---

Explain code: use `CodeMorph` for source that changes between versions and `ExecutionTrace` for the variables and call stack during line-by-line execution. Import both from `@animspark/stem`.

Explain one change or one execution step at a time and keep everything else still. Provide code snapshots and execution records separately; do not mix them in one component.

## CodeMorph

Pairs and moves tokens between several complete versions of a source file. Suited to showing refactors, syntax conversions and changes in API usage. The input is source snapshots; the component does not run them.

```tsx
<CodeMorph states={['const value = load(url)', 'const value = await load(url)']} filename="loader.ts" lang="typescript" />
```

### Providing source snapshots

`states` is a `string[]` in order. Each item is one complete source, with lines separated by `\n`; there is no patch format and no diff to provide. Provide at least one snapshot; with only one, the code is shown statically.

`progress` goes from `0` to `states.length - 1`: an integer selects one snapshot, and a fraction is the transition between two neighboring snapshots. For example, `1.25` means the second snapshot is a quarter of the way to the third. Out-of-range values are clamped to the first and last snapshots.

```ts
const states = [
  'let total = 0\ntotal = total + 3',
  'let total = 0\ntotal += 3',
  'let total = 0\ntotal += 3\nconsole.log(total)',
];
```

### How tokens keep their identity

Tokens are paired by "token text + which occurrence of it in the whole source". Matched tokens move to their new line and column; tokens only in the old snapshot fade out, and tokens only in the new snapshot fade in. Tokens take no custom `key`, and there is no analysis of variable scope or the AST.

When a variable or symbol with the same name occurs several times, inserting a new occurrence can change the pairing of every later one. Splitting a complex refactor into consecutive small steps reduces wrong visual associations. Tokens move in straight lines and do not route around other tokens.

### Props

| Prop | Type | Default and notes |
| --- | --- | --- |
| `states` | `string[]` | Defaults to two demo sources, `const value = load()` and `const value = await load()`. In real use, provide your own snapshots explicitly. |
| `progress` | `number` | Defaults to `0`; the snapshot index, may be fractional. |
| `filename` | `string` | Defaults to `example.ts`, shown in the editor title bar. |
| `lang` | `string` | Defaults to `typescript`, shown as an uppercase label in the top-right corner; it does not select a different lexer. |
| `ref` | `React.Ref<StemHandle>` | Handle to this component instance. |
| `style` | `React.CSSProperties` | Size, position and style of the outer box. |
| `className` | `string` | CSS class name of the outer box. |

### Example: shortening an assignment

```tsx
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { CodeMorph, type StemHandle } from '@animspark/stem';

const states = ['let total = 0\ntotal = total + 3', 'let total = 0\ntotal += 3'];

export function Example() {
  const code = useRef<StemHandle>(null);
  useGSAP(() => {
    const h = code.current!;
    gsap.timeline().to(h.P, {
      progress: 1, duration: 1, ease: 'none', onUpdate: h.render,
    }, 0.5);
  });
  return <CodeMorph ref={code} states={states} progress={0} filename="sum.ts" lang="typescript" style={{ width: 960, height: 540 }} />;
}
```

### Limits of language support and layout

Highlighting uses a simple line-based regex lexer that recognizes common JS/TS/Python keywords, numbers, strings, comments and symbols. Every `lang` shares these rules; multi-line strings, block comments spanning lines and language-specific syntax are not guaranteed to be recognized. Indent with spaces; tabs are not expanded to an editor tab width.

The component always draws the editor's dark background, font, syntax colors, line numbers and the snapshot indicator dots at the bottom; there are no `theme`, `fontSize` or `colors` props. The box suits a 16:9 ratio; CSS changes only the outer box and does not replace the inner syntax colors.

Code does not wrap or scroll, and the font size does not shrink with longer source. For a long program, excerpt the contiguous part you need to explain so the content does not overflow the box. If you only need a static code card or a completely different editor design, laying it out in ordinary DOM is more direct.

## ExecutionTrace

Keeps the source still and shows the current line, variables, call stack and a note from snapshots provided in advance. The component displays an execution; it is not an execution engine and does not work out variable values or call relationships by itself.

### One step is one complete snapshot

`code` holds the source string and `steps` holds the execution snapshots. Each snapshot means either "before this line runs" or "after this line runs"; keep one convention throughout. The example below means "after":

```ts
const code = 'let total = 0\ntotal += 3\nconsole.log(total)';
const steps = [
  { line: 1, vars: { total: 0 }, stack: ['main'], note: 'Initialize total' },
  { line: 2, vars: { total: 3 }, stack: ['main'], note: 'Add three' },
  { line: 3, vars: { total: 3 }, stack: ['main'], note: 'Print result' },
];
```

For a complex algorithm, record the real execution with a script first, then pass the snapshots in as ordinary data. Write the complete current state in every step: omitting `vars` or `stack` shows an empty state; nothing is inherited from the previous snapshot.

| Snapshot field | Type | Display behavior |
| --- | --- | --- |
| `line` | `number` | Source line number starting at **1**; omitted, it points at the first line; out of range, it is clamped to the first or last line. Use integers. |
| `vars` | object from variable name to JSON value | Shows the first 7 entries in property order. Objects and arrays are shown as JSON strings. |
| `stack` | `string[]` | Call frame names from outermost to innermost; the last frame is the current one. Keep it within 5 frames. |
| `note` | `string` | A short explanation of the current step. Omitted, it shows `Executing line N`. |

Values in `vars` are strings, numbers, booleans, null, arrays or plain objects; do not pass functions or circular references. Variable names, values, call frames and notes do not wrap.

### `step` is a discrete index

`step: 0` is the first snapshot and `step: 1` the second. Fractions are floored and clamped to `0…steps.length - 1`, so `1.8` still shows the second one. Variable values and the highlighted line are not interpolated between snapshots.

To switch step by step, use `tl.set(h.P, { step: index }, time)` and redraw in the timeline's `onUpdate`; both forward playback and seeking back then refresh the snapshot. A continuous tween of `step` also plays, but the picture only switches after flooring; when each step must appear at an exact time, set each integer index separately.

### Props

| Prop | Type | Default and notes |
| --- | --- | --- |
| `code` | `string` | Defaults to `const answer = 42`. Separate lines with `\n`; keep the source unchanged during playback. |
| `steps` | array of snapshot objects | Defaults to one demo snapshot showing `answer: 42`. In real use, provide your own complete snapshots explicitly. |
| `step` | `number` | Defaults to `0`; zero-based snapshot index. |
| `filename` | `string` | Defaults to `trace.ts`, shown in the editor title bar. |
| `lang` | `string` | Defaults to `typescript`. The prop is accepted but the current rendering does not use it. |
| `ref` | `React.Ref<StemHandle>` | Handle to this component instance. |
| `style` | `React.CSSProperties` | Size, position and style of the outer box. |
| `className` | `string` | CSS class name of the outer box. |

### Example: showing three steps in turn

```tsx
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ExecutionTrace, type StemHandle } from '@animspark/stem';

const code = 'let total = 0\ntotal += 3\nconsole.log(total)';
const steps = [
  { line: 1, vars: { total: 0 }, stack: ['main'], note: 'Initialize total' },
  { line: 2, vars: { total: 3 }, stack: ['main'], note: 'Add three' },
  { line: 3, vars: { total: 3 }, stack: ['main'], note: 'Print result' },
];

export function Example() {
  const trace = useRef<StemHandle>(null);
  useGSAP(() => {
    const h = trace.current!;
    gsap.timeline({ onUpdate: h.render })
      .set(h.P, { step: 1 }, 1)
      .set(h.P, { step: 2 }, 2);
  });
  return <ExecutionTrace ref={trace} code={code} steps={steps} step={0} filename="sum.ts" style={{ width: 960, height: 540 }} />;
}
```

### Display capacity

The component uses a fixed dark editor with a 70% / 30% left-right split: source on the left, variables, call stack and note on the right. It suits a 16:9 box and has no `theme`, `fontSize`, `colors` or split-ratio props.

Source highlighting is a simple line-based regex lexer that recognizes common JS/TS/Python keywords, numbers, strings, comments and symbols; `lang` does not switch the rules or the execution language. Multi-line strings, block comments spanning lines and special syntax are not guaranteed to be highlighted correctly; indent with spaces.

The source, the side panel and the note never scroll, wrap or shrink their font size. Keep the source short, avoid long arrays as variable values, put at most 5 frames on the call stack and write the note as one short phrase; show any further information in the surrounding layout.
