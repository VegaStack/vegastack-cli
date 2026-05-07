// Check whether a newer @vegastack/cli is available on the registry.
//
// Strategy: cache the answer on disk for 24h, refresh it from `npm view`
// (which respects the user's ~/.npmrc auth + scoped registry routing).
// We never block a vegastack command on a network call — refreshes happen
// only inside `vegastack doctor` or `vegastack update`, and the nag printed on
// every command reads from the cached value only.

import { spawnCmdSync } from "./spawn-cmd.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { HOME } from "./paths.js";
import { atomicWriteFileSync } from "./fs-utils.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PKG_NAME = "@vegastack/cli";

export interface UpdateCache {
  checkedAt: string; // ISO
  latest: string;
}

export function updateCachePath(): string {
  return path.join(HOME, ".config", "vegastack", "update-check.json");
}

export function readUpdateCache(): UpdateCache | null {
  try {
    const raw = fs.readFileSync(updateCachePath(), "utf8");
    const parsed = JSON.parse(raw) as UpdateCache;
    if (typeof parsed.checkedAt !== "string" || typeof parsed.latest !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeUpdateCache(cache: UpdateCache): void {
  const file = updateCachePath();
  // Atomic temp+rename so concurrent CLI invocations (e.g. `vegastack doctor`
  // running while a separate `vegastack update` finishes) cannot leave a
  // truncated/half-written JSON document at the canonical path. A partial
  // write would make `readUpdateCache` JSON.parse-fail and silently return
  // null, suppressing the update nag for the next 24h.
  atomicWriteFileSync(file, JSON.stringify(cache, null, 2) + "\n");
}

export function cacheIsFresh(cache: UpdateCache, now = Date.now()): boolean {
  const checked = Date.parse(cache.checkedAt);
  if (Number.isNaN(checked)) return false;
  return now - checked < CACHE_TTL_MS;
}

/** Compare semver-like x.y.z strings. Returns true if `a` > `b`. Handles only numeric x.y.z. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/** Run `npm view @vegastack/cli version` and return the version string, or null on failure. */
export function fetchLatestVersion(timeoutMs = 5000): string | null {
  const r = spawnCmdSync("npm", ["view", PKG_NAME, "version"], {
    timeout: timeoutMs,
  });
  if (r.status !== 0) return null;
  const v = (r.stdout ?? "").trim();
  if (!/^\d+\.\d+\.\d+/.test(v)) return null;
  return v;
}

/**
 * Refresh the cache by hitting the registry. Returns the new latest version,
 * or null if the lookup failed (network down, auth missing, etc.).
 */
export function refreshUpdateCache(): string | null {
  const latest = fetchLatestVersion();
  if (latest === null) return null;
  writeUpdateCache({ checkedAt: new Date().toISOString(), latest });
  return latest;
}

/**
 * One-line stderr nag if the cache says a newer version is available.
 * Reads cache only — never makes network calls. Safe to call on every command.
 * Suppressed when:
 *   - VEGASTACK_NO_UPDATE_NAG is set (CI / scripts)
 *   - JSON mode is active (caller's responsibility — pass `quiet: true`)
 *   - cache is missing or stale (unknown state → silent)
 */
export function printUpdateNagIfStale(
  currentVersion: string,
  opts: { quiet?: boolean } = {},
): void {
  if (opts.quiet) return;
  if (process.env.VEGASTACK_NO_UPDATE_NAG) return;
  const cache = readUpdateCache();
  if (cache === null) return;
  if (!isNewer(cache.latest, currentVersion)) return;
  process.stderr.write(
    `note: a newer @vegastack/cli is available (${currentVersion} → ${cache.latest}). run \`vegastack update\` to upgrade.\n`,
  );
}
