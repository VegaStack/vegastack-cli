// Lightweight per-entry mutex for concurrent registry installs.
//
// `installPublishedRegistryEntry` performs a multi-step `rename` dance to
// atomically swap the cache root for an entry. Two concurrent `vegastack`
// invocations targeting the same entry can both reach the rename block and
// clobber each other: process A renames `dest` aside, process B then renames
// its freshly-installed dest aside (taking A's), and the surviving cache may
// have mismatched content and metadata.
//
// We use an atomic `fs.mkdirSync` of `${root}/${name}.lock` as the mutex —
// `mkdir(2)` is the canonical POSIX advisory lock that doesn't add an npm
// dependency (we deliberately removed `proper-lockfile` in rollup B). A
// stale-detection window (default 10 min) lets a crashed sibling's lock
// expire instead of wedging the CLI forever.

import * as fs from "node:fs";
import * as path from "node:path";

export interface InstallLockOptions {
  /** Treat a lock dir older than this as abandoned. Default 10 min. */
  staleAfterMs?: number;
  /** Poll interval while waiting for a held lock. Default 100 ms. */
  pollIntervalMs?: number;
  /** Total wait budget before giving up. Default 5 min. */
  timeoutMs?: number;
}

const DEFAULT_STALE_MS = 10 * 60 * 1000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Acquire an exclusive install lock for `name` under `root`. Returns a
 * `release()` callback that the caller MUST invoke (typically in a
 * try/finally) to drop the lock.
 *
 * Uses `mkdirSync` as the atomic primitive: a stale lock from a crashed
 * sibling is detected by mtime and removed before another caller proceeds.
 */
export async function acquireRegistryInstallLock(
  root: string,
  name: string,
  opts: InstallLockOptions = {},
): Promise<() => void> {
  fs.mkdirSync(root, { recursive: true });
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lockDir = path.join(root, `${name}.lock`);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      // Atomic in POSIX and on Win32: fails with EEXIST if the dir exists.
      fs.mkdirSync(lockDir);
      // Update mtime so future stale-detection sees a fresh timestamp.
      fs.utimesSync(lockDir, new Date(), new Date());
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          fs.rmdirSync(lockDir);
        } catch {
          /* lock already removed (stale-cleaned by a sibling) — ignore */
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // Lock held — check for staleness.
      try {
        const st = fs.statSync(lockDir);
        if (Date.now() - st.mtimeMs > staleAfterMs) {
          // Best-effort: remove the stale lock dir and try again. Use rmSync
          // to handle the unlikely case where the dir contains files left
          // by an old format. The next loop iteration will race with any
          // sibling also racing to clean — whichever wins the next mkdir
          // proceeds.
          try {
            fs.rmSync(lockDir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
          continue;
        }
      } catch {
        // Lock vanished between EEXIST and stat — retry immediately.
        continue;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out waiting for registry install lock on ${name} after ${timeoutMs} ms (${lockDir})`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}
