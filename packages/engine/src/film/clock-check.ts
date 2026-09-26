/**
 * Wall-clock-driven patterns in MG source.
 *
 * The host owns the clock: playback, scrubbing, frame grabs, and export all "jump to second t and
 * render". Motion advanced by the wall clock looks fine during continuous playback, but every seek and
 * every export lands on a different frame; it compiles, passes every check, and a single grabbed frame
 * won't show it. This matches the most common patterns literally and reports warnings, not errors: a
 * literal match can't read intent, and blocking a publish costs more than one extra reminder.
 */

interface Rule { pattern: RegExp; what: string }

const SCRIPT = /\.(?:tsx?|jsx?|[cm][jt]s)$/;

const CSS_CLOCK = 'CSS transitions and animations run on the browser clock, independent of seeks and export.'
  + ' Animate the property with GSAP inside useGSAP.';

const SCRIPT_RULES: readonly Rule[] = [
  {
    pattern: /\brequestAnimationFrame\s*\(/g,
    what: 'requestAnimationFrame runs on the wall clock, not the film clock, so playback, scrubbing and export'
      + ' each land on a different frame. Build motion inside useGSAP, or read the current second with'
      + ' useLocal() from @animspark/runtime and draw from it.',
  },
  {
    pattern: /\bset(?:Interval|Timeout)\s*\(/g,
    what: 'setInterval/setTimeout fire on the wall clock, so what they change is not a function of film time.'
      + ' Put the change on the useGSAP timeline at its second.',
  },
  {
    pattern: /\b(?:Date|performance)\.now\s*\(/g,
    what: 'Date.now()/performance.now() read the wall clock; a frame may depend only on film time.'
      + ' Read the current second with useLocal().',
  },
  {
    pattern: /\bMath\.random\s*\(/g,
    what: 'Math.random() changes on every page load, so preview, look and export disagree.'
      + ' Use a seeded generator (for example mulberry32) or a fixed table.',
  },
  {
    pattern: /<video\b/g,
    what: 'a raw <video> plays on its own clock and ignores seeks and export. Use <Video> from @animspark/runtime.',
  },
  {
    pattern: /<audio\b/g,
    what: 'a raw <audio> is not part of the film mix and ignores seeks. Declare the sound in the exported sounds array.',
  },
  {
    pattern: /(?<![\w-])(?:transition|animation)\s*:\s*['"`](?!\s*none\b)|@keyframes\b/g,
    what: CSS_CLOCK,
  },
];

const STYLE_RULES: readonly Rule[] = [
  {
    pattern: /(?<![\w-])(?:transition|animation)(?:-[a-z-]+)?\s*:(?!\s*none\b)|@keyframes\b/g,
    what: CSS_CLOCK,
  },
];

/** Blank out comments with same-length whitespace: line numbers stay put; patterns in comments don't count. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function linesOf(text: string, pattern: RegExp): number[] {
  const lines = new Set<number>();
  for (const match of text.matchAll(pattern)) {
    lines.add(text.slice(0, match.index).split('\n').length);
  }
  return [...lines];
}

export function clockIssues(
  files: Readonly<Record<string, string>>,
): Array<{ level: 'warn'; what: string }> {
  const out: Array<{ level: 'warn'; what: string }> = [];
  for (const [path, source] of Object.entries(files)) {
    const rules = SCRIPT.test(path) ? SCRIPT_RULES : path.endsWith('.css') ? STYLE_RULES : null;
    if (!rules) continue;
    const text = blankComments(source);
    for (const rule of rules) {
      const lines = linesOf(text, rule.pattern);
      if (!lines.length) continue;
      const at = lines.slice(0, 3).join(',') + (lines.length > 3 ? ',…' : '');
      out.push({ level: 'warn', what: `${path}:${at}: ${rule.what}` });
    }
  }
  return out;
}
