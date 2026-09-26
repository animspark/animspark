/**
 * "Where are this asset's bytes" is no longer the same as "its path in the workspace".
 *
 * Once source media is uploaded straight to object storage, the working tree often holds only a
 * pointer, with not one byte of the real file on disk. ffmpeg / ffprobe only read paths — so
 * someone has to fill in the path before reading.
 *
 * How to do that doesn't live in this package: it needs to understand the pointer format, hold
 * bucket credentials and keep a local cache, while this package must install on a machine that has
 * nothing but ffmpeg (the standalone `anim` workbench is such a machine). So this file only defines
 * the shape, and the platform side injects it. Without injection it is the old behavior: use the
 * file if it's on disk, otherwise treat it as absent.
 */

/**
 * Workspace-relative path → a locally readable absolute path. null = the asset can't be fetched.
 *
 * The returned path is **not guaranteed to be inside the workspace** — bytes fetched from remote
 * land in a cache shared across projects, and materializing them into the workspace would copy the
 * media back into every project. Callers should only read from it, never use it to work out where
 * the file sits in the workspace.
 */
export type MediaResolver = (rel: string) => Promise<string | null>;

/**
 * Known media facts — the part that can be answered without fetching the bytes.
 *
 * Narrower than `MediaFacts`: `hasAudio` / `hasVideo` require actually looking at the streams,
 * while the source here is the few numbers probed at upload time and committed to git with the
 * pointer. The narrowness is deliberate — mix "probed" and "guessed" into one type and sooner or
 * later someone uses a default `hasAudio: false` to decide whether to mix audio.
 */
export interface KnownMediaFacts {
  durMs?: number;
  w?: number;
  h?: number;
  fps?: number;
}

/**
 * A **free** source for how long and how large an asset is.
 *
 * Why it exists: `ffprobe` only reads paths, so asking it how long a clip is means first pulling
 * the whole master from object storage onto disk — 3 GB of media for one integer. Yet that integer
 * was probed at upload time, written into the pointer, and came down with git into the working
 * tree.
 *
 * Injected by the platform side; without it, the old behavior (fetch the bytes and probe).
 */
export interface MediaFactsStore {
  /** Relative path → known facts. null = unknown; the caller fetches the bytes and probes. */
  get(rel: string): Promise<KnownMediaFacts | null>;
  /**
   * Record facts after one probe so the bytes needn't be fetched again.
   *
   * Absent = don't record (the standalone workbench has no pointers to write). Pointers of existing
   * assets have no `meta`; this step heals them — otherwise they'd be downloaded again every round.
   */
  put?(rel: string, facts: KnownMediaFacts): Promise<void>;
}

/**
 * Resolve a batch of relative paths in one go.
 *
 * This exists so that **pure functions like `mixPlan` stay synchronous**: the mix graph it builds
 * can be tested on its own, and making it async just to fetch bytes would lose that. So all the
 * async work is squeezed into this step, and graph building still gets a ready-made table.
 *
 * Fetched concurrently, not serially: a film has dozens of sounds, each of which may need a remote
 * fetch, and in series those round trips add up.
 */
export async function resolveAll(
  srcs: Iterable<string>,
  resolve: MediaResolver,
): Promise<Map<string, string>> {
  const unique = [...new Set(srcs)];
  const found = await Promise.all(unique.map(async (src) => [src, await resolve(src)] as const));
  return new Map(
    found.filter((pair): pair is readonly [string, string] => pair[1] != null),
  );
}
