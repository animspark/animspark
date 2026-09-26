/**
 * Registry for async work inside components.
 *
 * The picture must be a pure function of the current time, but some things inherently have
 * to wait: a dynamically imported p5, three's texture loader. The capture page waits for the
 * promises registered here to settle before it fires the shutter (see the engine's shoot.ts);
 * otherwise it grabs a frame the canvas hasn't drawn yet, and silently. The player doesn't
 * wait: it always has a next frame.
 *
 * A registered promise removes itself once settled. Rejection counts as settled: what we
 * wait for is "won't change any more", not "succeeded".
 */
export function registerFilmPending<T>(work: Promise<T>): Promise<T> {
  if (typeof window === 'undefined') return work;
  const w = window as unknown as { __filmPending?: Set<Promise<unknown>> };
  const set = (w.__filmPending ??= new Set());
  set.add(work);
  const drop = (): void => { set.delete(work); };
  work.then(drop, drop);
  return work;
}
