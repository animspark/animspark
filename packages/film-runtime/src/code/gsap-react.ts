/**
 * Connect the official @gsap/react hook to the film clock.
 *
 * The host supplies the real hook and its GSAP singleton. Its own context,
 * dependencies, scope and revert lifecycle remain in charge; this adapter only
 * seeks the top-level animations that context owns.
 */
import * as React from 'react';

import { FilmClipIdContext } from './refs';
import { useLocalMs } from './stage';
import { useChoreoSeconds } from './mg-context';

interface Animation {
  parent?: unknown;
  pause(): unknown;
  totalTime(seconds: number): unknown;
  totalDuration(): number;
  delay(): number;
  timeScale(): number;
  render?(seconds: number, suppressEvents: boolean, force: boolean): unknown;
}

interface Context {
  data: readonly unknown[];
  revert: Callback;
}

type Callback = (this: unknown, ...args: any[]) => any;
type ContextSafe = <T extends Callback>(callback: T) => T;
interface HookResult {
  context: Context;
  contextSafe: ContextSafe;
}

interface ClockState {
  seconds: number;
  syncedSeconds?: number;
  syncing: boolean;
  clipId: string | null;
  context?: Context;
  animations: Set<Animation>;
}

function contextAnimations(context: Context, root: unknown): Animation[] {
  const result = new Set<Animation>();
  const seen = new Set<unknown>();
  const visit = (one: unknown): void => {
    if (!one || typeof one !== 'object' || seen.has(one)) return;
    seen.add(one);
    const item = one as Partial<Animation> & { data?: unknown };
    if (item.parent === root && typeof item.totalTime === 'function') {
      result.add(item as Animation);
    } else if (Array.isArray(item.data)) {
      // A nested gsap.context is recorded in its owner's data as a context,
      // rather than flattening its tweens into the outer context's array.
      for (const child of item.data) visit(child);
    }
  };
  for (const one of context.data) visit(one);
  const timeline = root as { getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => Animation[] };
  if (typeof timeline?.getChildren === 'function') {
    // A nested context can be extended after its parent's later animations
    // were created. Follow the real parent's sibling order, not the order of
    // a flattened context tree; GSAP's root does not sort children by delay.
    return instantFirst(timeline.getChildren(false, true, true).filter((one) => result.has(one)));
  }
  return instantFirst([...result]);
}

/**
 * Native GSAP renders gsap.set() the moment it is created, but not under a paused
 * ancestor, and the host pauses the root. Until the first sync such a set has not
 * happened yet, so it must sync before any timeline created ahead of it; otherwise
 * that timeline records a stale start value and the set then overwrites its frame.
 * Delayed sets keep creation order: they happen at their own time, not on creation.
 */
function instantFirst(all: Animation[]): Animation[] {
  const instant = (one: Animation): boolean => one.totalDuration() === 0 && one.delay() === 0;
  if (!all.some(instant)) return all;
  return [...all.filter(instant), ...all.filter((one) => !instant(one))];
}

function syncContext(state: ClockState, root: unknown): void {
  // A contextSafe onUpdate runs *inside* this seek. Its post-callback capture
  // must not seek recursively, nor restart animations during context.revert.
  if (state.syncing || !state.context) return;
  state.syncing = true;
  try { seekContext(state, root); }
  finally { state.syncing = false; }
}

function seekContext(state: ClockState, root: unknown): void {
  if (!state.context) return;
  const all = contextAnimations(state.context, root);
  // GSAP also visits siblings in reverse order when its parent timeline moves
  // backward. Otherwise a later tween can restore its start value *after* an
  // earlier tween has already painted the requested earlier frame.
  const ordered = state.syncedSeconds != null && state.seconds < state.syncedSeconds
    ? [...all].reverse() : all;
  let end = 0;
  for (const one of ordered) {
    const first = !state.animations.has(one);
    if (first) one.pause();
    const speed = Math.abs(one.timeScale());
    const delay = one.delay();
    const seconds = (state.seconds - delay) * speed;
    // time() wraps back into a repeated animation's first cycle; totalTime()
    // preserves repeat, repeatDelay and yoyo, including on backward seeks.
    one.totalTime(seconds);
    // Force the initial frame only once this animation has begun. Forcing a
    // delayed tween early eagerly captures a start value that previous tweens
    // have not reached yet, defeating GSAP's lazy initialization.
    if (first && seconds >= 0) one.render?.(seconds, false, true);
    end = Math.max(end, delay + one.totalDuration() / (speed || 1));
  }
  state.syncedSeconds = state.seconds;
  state.animations = new Set(all);
  const id = state.clipId;
  if (id && end > 0) {
    const host = globalThis as { __filmChoreoEnds?: Record<string, number> };
    const book = (host.__filmChoreoEnds ??= {});
    book[id] = Math.max(book[id] ?? 0, Number.isFinite(end) ? end : 1e9);
  }
}

/** Keep the supplied official hook's public type, including its static fields. */
export function createUseGSAPBridge<T extends (...args: any[]) => any>(
  officialUseGSAP: T,
  gsap: { globalTimeline: unknown },
): T {
  const useGSAP = (callback?: unknown, dependencies?: unknown): HookResult => {
    /* Capped at this MG's declared duration: a stretched tail holds the end, and `repeat: -1` doesn't loop. */
    const seconds = useChoreoSeconds(useLocalMs());
    const clipId = React.useContext(FilmClipIdContext);
    const state = React.useRef<ClockState>({ seconds, clipId, syncing: false, animations: new Set() });
    const boundContext = React.useRef<Context | null>(null);
    state.current.seconds = seconds;
    state.current.clipId = clipId;

    const invoke = (fn: Callback): Callback => function (this: unknown, ...args: unknown[]) {
      try { return fn.apply(this, args); }
      finally { syncContext(state.current, gsap.globalTimeline); }
    };
    const wrapSafe = (safe: ContextSafe): ContextSafe => (
      <F extends Callback>(fn: F): F => safe(invoke(fn) as F)
    );
    const build = typeof callback === 'function'
      ? function (this: unknown, context: Context, contextSafe: ContextSafe) {
        state.current.context = context;
        return invoke(callback as Callback).call(this, context, wrapSafe(contextSafe));
      }
      : callback;

    // Pass both official call forms through unchanged: useGSAP(fn, deps/config)
    // and useGSAP(config). In particular, do not implement cleanup ourselves.
    const official = officialUseGSAP(build, dependencies) as HookResult;
    state.current.context = official.context;
    if (boundContext.current !== official.context) {
      const revert = official.context.revert;
      // GSAP may invoke animation callbacks while reverting as well. Leave
      // the official cleanup and context intact without seeking during cleanup.
      official.context.revert = function (this: unknown, ...args: unknown[]) {
        const syncing = state.current.syncing;
        state.current.syncing = true;
        try { return revert.apply(this, args); }
        finally { state.current.syncing = syncing; }
      };
      boundContext.current = official.context;
    }
    const contextSafe = React.useCallback(wrapSafe(official.contextSafe), [official.contextSafe]);

    React.useLayoutEffect(() => {
      syncContext(state.current, gsap.globalTimeline);
    }, [seconds]);

    return { context: official.context, contextSafe };
  };

  // gsap.registerPlugin(useGSAP) must still call the official .register, and
  // .headless must survive so registration works before a browser is available.
  return Object.assign(useGSAP, officialUseGSAP) as T;
}
