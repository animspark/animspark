/**
 * Choreography: build a timeline and hand it to the host to seek.
 *
 * **The host owns the clock; you only get seeked.** Playing, scrubbing, frame extraction and
 * export are all "jump to millisecond N and render", so the picture must be a pure function
 * of the current time. An animation that advances itself with `setInterval` glitches as soon
 * as you scrub, and the export won't match the preview. Each such wrong frame looks right on
 * its own, which makes it very hard to catch.
 *
 * Two paths, each for its own job:
 *
 * - `useTimeline(build)`: build a gsap timeline. Use it for complex choreography, staggers, easing.
 * - `useLocal()`:         read the current second and compute it yourself. Shorter for pure
 *                         interpolation such as counters, progress bars and camera moves.
 *
 * Don't use both on the same property: a component using `useLocal` re-renders every frame,
 * and the value declared in JSX overwrites what gsap wrote, so the property "sometimes works".
 */

import * as React from 'react';

import { useLocalMs } from './stage';
import { useChoreoSeconds } from './mg-context';

/**
 * Something the host seeks.
 *
 * The shape is structural rather than `gsap.core.Timeline`: a GSAP timeline satisfies it
 * exactly, but the runtime doesn't need to know that. A hand-written interpolator, another
 * animation library, even a fake object with only `time()` can plug in, so this layer can be
 * tested directly in node without a browser.
 */
export interface Seekable {
  time(seconds: number): unknown;
  pause?(): unknown;
  kill?(): void;
  /**
   * Force the picture to this moment, even if the playhead is already there.
   *
   * gsap's `time(t)` returns early when `t` equals the current time, and a freshly built
   * timeline's playhead is already at 0. So "go to second 0" does nothing, and the clip's first
   * frame shows the static JSX. See `seek` below.
   */
  render?(time: number, suppressEvents?: boolean, force?: boolean): unknown;
}

/**
 * Move a freshly built timeline to the current moment and **always redraw**.
 *
 * `one.time(t)` alone silently fails in one place: the first frame each clip appears. There
 * `t` is 0, and the new timeline's playhead is also at 0, so gsap thinks there's nothing to
 * do. The initial state set by `.set(..., 0)` never lands, and at every cut in the film one
 * frame flashes "the animation already finished". Frame extraction, export and scrubbing can
 * all hit it, while `anim check` stays green.
 *
 * Force only **right after building**. After that the time changes every frame and `time()`
 * draws on its own; forcing every frame would compute every property of the timeline twice,
 * and export runs through the whole film frame by frame.
 */
export function seekBuilt(one: Seekable, seconds: number): void {
  one.time(seconds);
  one.render?.(seconds, false, true);
}

/* ── Adoption ─────────────────────────────────────────────────────────────── */

interface GsapContext {
  data: readonly unknown[];
  kill(revert?: boolean): void;
}

interface GsapLike {
  context(fn: () => void, scope?: unknown): GsapContext;
  globalTimeline: unknown;
}

function isSeekable(x: unknown): x is Seekable {
  return typeof (x as Seekable | null | undefined)?.time === 'function';
}

/**
 * The gsap instance the host injected: the same one the film gets from `import { gsap }`
 * (see code-host's `__ANIM_MG_DEPS__`).
 *
 * This layer doesn't import gsap: it shouldn't know which animation library you use, and it
 * must be testable in node without gsap. If none is found it falls back to "only the return
 * value counts", which is how things worked before this function existed.
 */
function hostGsap(): GsapLike | null {
  const scope = globalThis as { __ANIM_MG_DEPS__?: Record<string, unknown>; gsap?: unknown };
  const dep = scope.__ANIM_MG_DEPS__?.gsap;
  /* What's attached is the whole namespace (`import * as gsapNS`), so unwrap one level first. */
  const found = (dep && typeof dep === 'object' && 'gsap' in dep
    ? (dep as { gsap: unknown }).gsap
    : dep) ?? scope.gsap;
  const like = found as GsapLike | undefined;
  return like && typeof like.context === 'function' && like.globalTimeline ? like : null;
}

/**
 * After building, which things the host drives.
 *
 * Returning the timeline is a **convenience**, not a requirement. Writing
 * `{ const tl = gsap.timeline(); ... }` and forgetting the final return is the easiest
 * mistake to make with this API (4 of the 13 MGs on one machine did it), and when it happens
 * the timeline stays on gsap's own clock: it keeps moving while paused, restarts when you
 * scrub backwards, and the export and preview become two different films. So what counts
 * here is not the return value but "what the build call created".
 *
 * Only top-level ones are adopted. A tween made by `tl.to(...)` is attached to `tl` and moves
 * with it; seeking a child tween on its own would detach it from its parent and break the
 * timeline apart.
 */
export function seekablesFrom(
  returned: unknown,
  created: readonly unknown[],
  root: unknown,
): Seekable[] {
  const out: Seekable[] = [];
  const add = (x: unknown): void => {
    if (isSeekable(x) && !out.includes(x)) out.push(x);
  };
  add(returned);
  for (const one of created) {
    if ((one as { parent?: unknown } | null | undefined)?.parent === root) add(one);
  }
  return out;
}

/** Which doc clip this picture is. Include it in warnings: with a dozen MGs in a film, a bare selector tells you nothing. */
function whereOf(scope: Element): string {
  const owner = scope.closest('[data-film-clip-id]');
  const id = owner?.getAttribute('data-film-clip-id');
  return id ? ` in clip "${id}"` : '';
}

/**
 * Register where the choreography ends: the second after which this clip's timeline has no
 * more motion.
 *
 * This treats "slideshow syndrome": all the tweens crammed into the first second or two while
 * `duration` is set to 18 to match the narration, leaving 16 seconds of still frame, with
 * check all green (duration, paths and audio are all correct; it doesn't look at whether the
 * picture moves). Only the built timeline knows whether anything moves, so it is recorded
 * when the timeline is built; the capture page (`anim look`) reads it and compares it with
 * the clip length to expose the problem.
 *
 * Uses `totalDuration` (repeats are counted unrolled; `repeat: -1` is Infinity, meaning
 * motion throughout). Clips where nothing can be measured (a hand-written interpolator has no
 * duration, a useLocal-driven clip has no timeline) are not registered: absence means
 * "unknown", not "dead", and the warning side only looks at registered clips.
 */
function reportChoreoEnd(scope: Element, all: readonly Seekable[]): void {
  const clipId = scope.closest('[data-film-clip-id]')?.getAttribute('data-film-clip-id');
  if (!clipId) return;
  let end = 0;
  for (const one of all) {
    const t = one as { totalDuration?: () => number; duration?: () => number };
    const sec = typeof t.totalDuration === 'function' ? t.totalDuration()
      : typeof t.duration === 'function' ? t.duration() : 0;
    end = Math.max(end, typeof sec === 'number' ? sec : 0);
  }
  if (end <= 0) return;
  const g = globalThis as { __filmChoreoEnds?: Record<string, number> };
  const book = (g.__filmChoreoEnds ??= {});
  /* Infinity doesn't survive JSON (the capture page moves this via evaluate), so a large
     number stands for "never stops". If one clip builds two timelines (or rebuilds when deps
     change), take the max: the question is "where is the latest motion". */
  book[clipId] = Math.max(book[clipId] ?? 0, Number.isFinite(end) ? end : 1e9);
}

/**
 * Build a timeline attached to the returned ref.
 *
 * `build` receives `scope`, the root node, and a selector `q` scoped to it. Animation selectors
 * **must** be scoped to it; otherwise when the same component appears twice in a film the two
 * instances animate each other's nodes.
 *
 * `build` runs only once on mount (again only when deps change), so don't read the current
 * time inside it: that number is 0 when build runs, and written into the timeline it stays 0
 * forever. Write times as constants; only content goes through props.
 *
 * The seek happens synchronously in a layout effect: in `useEffect` the browser would first
 * composite "last frame's picture + this frame's time" and then correct it, which shows up as
 * a jitter during fast scrubbing.
 */
export function useTimeline<T extends HTMLElement = HTMLDivElement>(
  build: (scope: T, q: (selector: string) => T[]) => Seekable | void,
  deps: React.DependencyList = [],
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const parked = React.useRef<readonly Seekable[]>([]);
  /* Choreography time is capped at this MG's declared duration (see useChoreoSeconds): a stretched clip holds its final moment instead of replaying. */
  const choreoSec = useChoreoSeconds(useLocalMs());
  const timeMs = choreoSec * 1000;

  React.useLayoutEffect(() => {
    const scope = ref.current;
    if (!scope) return undefined;
    const q = (selector: string): T[] => {
      const found = Array.from(scope.querySelectorAll(selector)) as T[];
      /* A selector that matches nothing is the quietest way to fail with this API: gsap tweens
         an empty array without complaint, `anim check` is green, and that choreography never
         happens on screen. One space between `.result .inner` and `.result.inner` is enough.
         So say it out loud: console errors are collected by the capture into the `anim look`
         report (see shoot's pageErrors), so there is somewhere to see it. */
      if (!found.length) {
        // eslint-disable-next-line no-console
        console.error(
          `q('${selector}') matched nothing${whereOf(scope)} — whatever you hand it animates nothing.`,
        );
      }
      return found;
    };

    /* Build inside a gsap context: every timeline created in this call is recorded, whether or
       not the author returns it. It also scopes bare selectors to this node, same as `q`. */
    const gsap = hostGsap();
    let returned: Seekable | null = null;
    const context: GsapContext | null = gsap
      ? gsap.context(() => { returned = build(scope, q) ?? null; }, scope)
      : null;
    if (!gsap) returned = build(scope, q) ?? null;

    const all = seekablesFrom(returned, context?.data ?? [], gsap?.globalTimeline);
    // Pause as soon as built: the host drives it, and letting it run on its own would be a second clock.
    for (const one of all) one.pause?.();
    reportChoreoEnd(scope, all);
    /* Seek to the current time right away. When deps change and it rebuilds, the time usually
       hasn't changed, so the effect below won't run; without seeking here the new timeline
       would sit at second 0 while the picture is at second 5. */
    for (const one of all) seekBuilt(one, timeMs / 1000);
    parked.current = all;

    return () => {
      parked.current = [];
      context?.kill();
      /* Clean up what the context can't (hand-written interpolators, other libraries). The
         gsap ones are already killed, so killing again is a no-op. */
      for (const one of all) one.kill?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  React.useLayoutEffect(() => {
    for (const one of parked.current) one.time(timeMs / 1000);
  }, [timeMs]);

  return ref;
}
