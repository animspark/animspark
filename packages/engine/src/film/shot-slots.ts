/**
 * Take a slot before launching Chromium — across processes.
 *
 * look, render and clip each launch a headless Chromium (roughly 1.4 cores and 0.9 GB for a
 * 1080p film with 3D). A coding agent may run several of them at once from separate shells,
 * which no in-process semaphore can see, so slots are directories under the runtime root:
 * `mkdir` is atomic, so creating one is taking the lock. Slot names are fixed (`0..N-1`).
 *
 * A holder killed mid-run leaves its slot behind, so a slot is a lease: the holder renews it
 * every `RENEW_MS`, and an expired slot may be reclaimed by anyone.
 *
 * Tuning: ANIM_SHOT_SLOTS (how many Chromiums at once, default 1), ANIM_SHOT_WAIT_MS (how
 * long to wait for a slot).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runtimeRoot } from '../storage-root';

/**
 * How many Chromiums may run at once on this machine. Two: one for a render the person started
 * (it holds its slot for minutes), one for the agent's `look` / `check` — with one slot, every
 * look during a render would queue for minutes and then report the queue full.
 */
const DEFAULT_SLOTS = 2;
const configuredSlots = Number(process.env.ANIM_SHOT_SLOTS ?? DEFAULT_SLOTS);
const SLOTS = Number.isFinite(configuredSlots) ? Math.max(1, Math.floor(configuredSlots)) : DEFAULT_SLOTS;

export function shotSlotLimit(): number { return SLOTS; }

/**
 * When a lease expires. A look takes seconds, a full render can take minutes — keep this generous
 * but rely on renewal, not on a long lease.
 */
const LEASE_MS = 60_000;
/** Renewal interval. Must be well under LEASE_MS, or a live holder gets reclaimed as dead. */
const RENEW_MS = 15_000;
/**
 * How long to wait for a slot.
 *
 * On timeout, or if the queue is not writable, fail with a clear error — never bypass the
 * concurrency limit and launch a browser anyway.
 */
const WAIT_MS = Math.max(0, Number(process.env.ANIM_SHOT_WAIT_MS ?? 120_000));

export function shotSlotsDir(): string {
  return join(runtimeRoot(), 'shot-slots');
}

function leaseFile(dir: string, i: number): string {
  return join(dir, String(i), 'lease');
}

/**
 * Has this slot's lease expired? An unreadable lease (just mkdir'd, not yet written) counts as
 * freshly taken; don't steal it.
 */
function expired(dir: string, i: number): boolean {
  try {
    const at = Number(readFileSync(leaseFile(dir, i), 'utf8').trim());
    return Number.isFinite(at) && Date.now() - at > LEASE_MS;
  } catch {
    return false;
  }
}

function tryTake(dir: string, i: number): boolean {
  const slot = join(dir, String(i));
  try {
    /* recursive: false is the point — it throws EEXIST when the directory exists, which means
       "this slot is taken". recursive: true succeeds silently, and everyone thinks they got it. */
    mkdirSync(slot, { recursive: false });
  } catch {
    if (!expired(dir, i)) return false;
    /* Dead slot: take it over in place rather than delete-and-recreate. If two processes reclaim
       the same dead slot, deleting opens a window where either can create it, leaving two
       holders. Rewriting the lease is idempotent; the worst case is both briefly think they
       reclaimed it, and only one keeps it through the next renewal — a transient, not a
       lasting double hold. */
  }
  try {
    writeFileSync(leaseFile(dir, i), String(Date.now()), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export interface ShotSlot {
  /** Always true on a successful return. */
  granted: boolean;
  release(): void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/**
 * Take a slot, waiting if none is free; after `WAIT_MS`, report the queue full.
 *
 * Polls rather than using filesystem notifications: slots are held for seconds to minutes, so a
 * 200ms poll costs nothing, while inotify-style watching has its own pitfalls on macOS and in
 * containers — not worth it for this.
 */
export async function acquireShotSlot(opts: { signal?: AbortSignal } = {}): Promise<ShotSlot> {
  const dir = shotSlotsDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    throw new Error('Rendering queue is unavailable; refusing to start without a resource slot.');
  }

  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    /* The waiter gave up (export cancelled): stop trying. Noticing only after taking a slot would
       leave it with no one to release it. */
    opts.signal?.throwIfAborted();
    for (let i = 0; i < SLOTS; i += 1) {
      if (!tryTake(dir, i)) continue;
      const renew = setInterval(() => {
        try { writeFileSync(leaseFile(dir, i), String(Date.now()), 'utf8'); } catch { /* disk full, etc. */ }
      }, RENEW_MS);
      renew.unref?.();
      return {
        granted: true,
        release() {
          clearInterval(renew);
          try { rmSync(join(dir, String(i)), { recursive: true, force: true }); } catch { /* already gone */ }
        },
      };
    }
    if (Date.now() >= deadline) {
      throw new Error(`Rendering queue is full after ${WAIT_MS}ms (${SLOTS} slots). Try again when a render completes.`);
    }
    await sleep(200);
  }
}

/**
 * Sweep dead slots at server startup.
 *
 * A killed process can't release its slot, and the lease takes a minute to expire — so for the
 * first minute after a restart, leftovers from the previous run would hold slots for nothing.
 * This clears them right away.
 */
export function sweepShotSlots(): void {
  const dir = shotSlotsDir();
  if (!existsSync(dir)) return;
  for (let i = 0; i < SLOTS; i += 1) {
    if (!existsSync(join(dir, String(i)))) continue;
    if (!expired(dir, i)) continue;
    try { rmSync(join(dir, String(i)), { recursive: true, force: true }); } catch { /* race */ }
  }
}
