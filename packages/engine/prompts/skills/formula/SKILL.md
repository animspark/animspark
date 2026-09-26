---
name: formula
description: "Typeset LaTeX equations in MG scenes and animate derivations term by term."
---

Typeset LaTeX formulas and derive them term by term. Import `Formula` from `@animspark/stem`.

Write the real expression; do not substitute an image or hand-assembled text. In each step of a derivation change only the terms that must change and leave everything else in place, so the audience can see what the step did.

## Formula

Typesets LaTeX as SVG. It supports static formulas, term-by-term morphs and derivations that unfold line by line.

```tsx
<Formula tex={String.raw`E = mc^2`} ink="#172b3a" />
```

`tex` has no surrounding `$`. In an ordinary JavaScript string, write each backslash as `\\`; with `String.raw` you can write LaTeX backslashes directly, for example `` String.raw`\frac{a}{b}` ``.

### Four forms of `tex`

| Form | Content and use |
| --- | --- |
| `string` | One whole LaTeX expression, for static formulas. Replacing the string does not produce a term-by-term morph. |
| `Part[]` | One line of independently typeset subexpressions; each term can have its own identity, color and decoration. |
| `Part[][]` | A multi-line formula; all lines are shown at once. |
| `Derivation` | Several steps declared in advance; `progress` drives the transitions or the line-by-line reveal. |

These are the shapes of the data. Declare them as plain objects and pass them to the component:

```ts
type Part = string | {
  tex: string;
  key?: string;
  color?: string;
  cancel?: boolean;
  box?: string | boolean;
};

type Derivation = {
  kind: 'derivation';
  steps: Array<string | Part[] | Part[][]>;
  layout?: 'morph' | 'stack';
  align?: '=' | 'left' | 'center';
  ink?: string;
};
```

A string term is equivalent to `{ tex: '...' }`. Operators are usually written directly as `'+'`, `'-'`, `'='`; write a subexpression that has to move or be marked as an object.

### Identity and decoration

`key` identifies the same mathematical object across a derivation; it has nothing to do with React list keys. Keep it unique within a step and consistent across steps:

```ts
const steps = [
  [{ key: 'a2', tex: 'a^2' }, '+', { key: 'b2', tex: 'b^2' }, '=', { key: 'c2', tex: 'c^2' }],
  [{ key: 'a2', tex: 'a^2' }, '=', { key: 'c2', tex: 'c^2' }, '-', { key: 'b2', tex: 'b^2' }],
];
```

Under `layout: 'morph'`, `b2` moves from the left side to the right side. The `tex` or style of the same `key` may also change: the position moves continuously and the glyphs crossfade. Terms without a `key` are paired by identical `tex` and order of occurrence; give repeated subexpressions their own names to avoid mismatches. Unmatched old terms fade out; new terms fade in from below.

| Term property | Behavior |
| --- | --- |
| `tex: string` | The term's own complete LaTeX. |
| `key?: string` | Identity tracked across `morph` steps. |
| `color?: string` | Overrides the term's text color. |
| `cancel?: boolean` | `true` draws a horizontal cancel line. |
| `box?: string \| boolean` | Draws a translucent rounded background behind the glyphs; a string sets its color, `true` uses the theme accent. |

Every term must typeset on its own: keep `\frac{a}{b}`, `\sqrt{x}`, `\sum_{n=1}^{\infty}` each within a single `tex`. Do not split denominators, radicands, superscripts/subscripts or summation limits into separate terms.

### `morph` and `stack`

| Derivation property | Default | Behavior |
| --- | --- | --- |
| `layout` | `'morph'` | The current step replaces the previous one; terms with the same identity move to their new positions. |
| `layout: 'stack'` | — | Keeps the steps already shown and appends new lines below. Old lines stay put and new lines fade in; a `key` repeated across lines does not pull terms out of the old line. |
| `align` | `'='` | Aligns on the standalone `'='` term; a line without a standalone equals sign is left-aligned. |
| `align: 'left'` | — | Left-aligned. |
| `align: 'center'` | — | Centered on the width of the longest line across all steps. |
| `ink` | the component's `ink` | Overrides the main ink color of this derivation. |

`progress` is a step index: `0` shows the first step, `1` the second, `0.5` is the transition between them; the range is `0…steps.length - 1`. A `stack` step can contain several lines, which appear together. All steps share one fixed frame, which includes the motion range of lines as they enter.

Animate `progress`; do not tween `tex` directly. Go from one integer to the next each time, then hold for a pause so each step's result can be seen. `morph` moves along straight paths and does not avoid other terms; a term that travels far may overlap others midway.

### Component props

| Prop | Type | Default and notes |
| --- | --- | --- |
| `tex` | `string \| Part[] \| Part[][] \| Derivation` | Defaults to the empty string. |
| `progress` | `number` | Defaults to `0`; only affects a `Derivation`. |
| `ink` | `string` | Defaults to the theme ink. Accepts `#hex`, `rgb()`, `rgba()`, `hsl()` or a theme color name. On a light background, set a dark color explicitly. |
| `ref` | `React.Ref<StemHandle>` | Handle to this component instance. |
| `style` | `React.CSSProperties` | Size, position and style of the outer box. |
| `className` | `string` | CSS class name of the outer box. |

Color precedence: the term's `color` → the derivation's `ink` → the component's `ink` → the theme ink.

### Example: a two-line derivation that keeps both lines

```tsx
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Formula, type StemHandle } from '@animspark/stem';

const derivation = {
  kind: 'derivation', layout: 'stack', align: '=',
  steps: [
    [{ key: 'a2', tex: 'a^2' }, '+', { key: 'b2', tex: 'b^2', color: '#147e87' }, '=', { key: 'c2', tex: 'c^2' }],
    [{ key: 'a2', tex: 'a^2' }, '=', { key: 'c2', tex: 'c^2' }, '-', { key: 'b2', tex: 'b^2', color: '#147e87' }],
  ],
};

export function Example() {
  const equation = useRef<StemHandle>(null);
  useGSAP(() => {
    const h = equation.current!;
    gsap.timeline().to(h.P, {
      progress: 1, duration: 1, ease: 'none', onUpdate: h.render,
    }, 0.5);
  });
  return <Formula ref={equation} tex={derivation} progress={0} ink="#172b3a" style={{ width: 960, height: 280 }} />;
}
```

The formula scales uniformly and is centered in its box. Adjust its visual size through the box size; CSS `fontSize` does not control the glyphs of the inner SVG. With `stack`, leave enough height for all the final lines. Invalid LaTeX may render as MathJax error text instead of failing compilation.
