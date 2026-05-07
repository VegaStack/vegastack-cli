/**
 * R2 + KV cache helpers.
 *
 * Eval reports live in the shared `vegastack-cli-registry` bucket at
 * `cli/evals/reports/<YYYY-MM-DD>.json` (custom domain
 * `cli-registry.vegastack.com`, bucket prefix `cli/` keeps the CLI's artifacts
 * isolated from other agent-kb surfaces in the same bucket).
 * Reads are cached in Workers KV with a 1h TTL so the homepage TTFB stays
 * under 100ms even on cold edges.
 *
 * Env bindings are read via `import { env } from "cloudflare:workers"`. We
 * accept an explicit `env` arg so the same helpers are usable from both pages
 * and the test suite.
 *
 * Registry publishing owns `cli-registry.vegastack.com/cli`; eval workflows write the JSON.
 * If the prefix moves, change `REPORTS_PREFIX` only.
 */

import sampleReport from "../fixtures/sample-report.json";
import { parseReport, type EvalReport } from "./parse-report";

const REPORTS_PREFIX = "cli/evals/reports/";
const INDEX_KEY = "cli/evals/reports/INDEX.json";
const KV_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Cache schema version. Bump this prefix when the parsed shape stored in
 * KV changes incompatibly so a cold rollout doesn't serve stale entries
 * shaped to the previous schema.
 *
 * Bump procedure:
 *   1. Change `CACHE_SCHEMA_VERSION` to the next `vN`.
 *   2. Deploy. New writes land under the new prefix; old entries expire
 *      naturally within KV_TTL_SECONDS (1h).
 *   3. Optional: `wrangler kv key list` + delete the old `vN-1:` entries
 *      if you need an immediate purge.
 */
const CACHE_SCHEMA_VERSION = "v1";
const reportCacheKey = (date: string) => `${CACHE_SCHEMA_VERSION}:report:${date}`;
const indexCacheKey = `${CACHE_SCHEMA_VERSION}:index`;

/** Concurrency cap for parallel R2 reads in getRecentReports. */
const R2_FANOUT_LIMIT = 5;

/**
 * Tiny worker-pool: runs `tasks` with at most `limit` in flight. Preserves
 * input order in the result. Avoids importing a dep just for this.
 */
async function pooledMap<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface ReportIndex {
  /** YYYY-MM-DD strings, newest-first. */
  dates: string[];
  latest: string;
  generated_at: string;
}

export interface RuntimeEnv {
  REGISTRY?: R2Bucket;
  REPORTS_CACHE?: KVNamespace;
}

/**
 * Best-effort accessor for the Workers env binding. Lives in a function
 * so importers can be tree-shaken at static-page build time.
 */
export async function getEnv(): Promise<RuntimeEnv | undefined> {
  try {
    // Dynamic import — only available inside a Workers context. During
    // `astro build` of static routes this throws and we fall through.
    const mod = (await import(/* @vite-ignore */ "cloudflare:workers")) as {
      env: RuntimeEnv;
    };
    return mod.env;
  } catch (e) {
    // Surface real Workers-runtime bugs in dev so they don't get silently
    // swallowed alongside the expected "module not available outside
    // Workers" error. The catch path is still load-bearing for static
    // builds (astro build) where the specifier itself is rejected.
    if (
      typeof process !== "undefined" &&
      (process.env?.NODE_ENV === "development" || process.env?.VEGASTACK_DEBUG === "1")
    ) {
      // eslint-disable-next-line no-console
      console.warn("[dashboard] cloudflare:workers import failed:", e);
    }
    return undefined;
  }
}

/** Best-effort R2 fetch with KV cache. Falls back to the Registry-provided fixture. */
export async function getReport(
  env: RuntimeEnv | undefined,
  date: string,
): Promise<EvalReport | null> {
  const safeDate = sanitizeDate(date);
  if (!safeDate) return null;

  const cacheKey = reportCacheKey(safeDate);
  const cached = await env?.REPORTS_CACHE?.get(cacheKey, "json").catch(() => null);
  if (cached) {
    const parsed = parseReport(cached);
    if (parsed) return parsed;
  }

  const obj = await env?.REGISTRY?.get(`${REPORTS_PREFIX}${safeDate}.json`).catch(() => null);
  if (!obj) return fallbackReport(safeDate);

  let raw: unknown;
  try {
    raw = await obj.json();
  } catch {
    return fallbackReport(safeDate);
  }

  const parsed = parseReport(raw);
  if (!parsed) return fallbackReport(safeDate);

  await env?.REPORTS_CACHE?.put(cacheKey, JSON.stringify(parsed), {
    expirationTtl: KV_TTL_SECONDS,
  }).catch(() => {});

  return parsed;
}

/** Latest report — checks index, falls back to today's date, then fixture. */
export async function getLatestReport(env: RuntimeEnv | undefined): Promise<EvalReport | null> {
  const index = await getReportIndex(env);
  const latest = index?.latest ?? todayIso();
  return getReport(env, latest);
}

/** Recent N reports for the trend chart. Newest-first. */
export async function getRecentReports(env: RuntimeEnv | undefined, n = 30): Promise<EvalReport[]> {
  const index = await getReportIndex(env);
  if (!index) {
    const fb = fallbackReport(todayIso());
    return fb ? [fb] : [];
  }

  const dates = index.dates.slice(0, n);
  // Bounded fan-out: cap parallel R2 reads at R2_FANOUT_LIMIT so a cold
  // edge with N=30 doesn't fire 30 simultaneous subrequests.
  const reports = await pooledMap(dates, R2_FANOUT_LIMIT, (d) => getReport(env, d));
  return reports.filter((r): r is EvalReport => r !== null);
}

async function getReportIndex(env: RuntimeEnv | undefined): Promise<ReportIndex | null> {
  const cached = await env?.REPORTS_CACHE?.get(indexCacheKey, "json").catch(() => null);
  if (cached && isIndex(cached)) return cached;

  const obj = await env?.REGISTRY?.get(INDEX_KEY).catch(() => null);
  if (!obj) return null;

  let raw: unknown;
  try {
    raw = await obj.json();
  } catch {
    return null;
  }
  if (!isIndex(raw)) return null;

  await env?.REPORTS_CACHE?.put(indexCacheKey, JSON.stringify(raw), {
    expirationTtl: KV_TTL_SECONDS,
  }).catch(() => {});

  return raw;
}

function isIndex(raw: unknown): raw is ReportIndex {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return Array.isArray(r.dates) && typeof r.latest === "string";
}

/**
 * Fixture fallback so the dashboard renders alive even before R2 is wired.
 * The fixture's `date` is rewritten to whatever date was requested so the
 * URL and the rendered date stay consistent.
 */
function fallbackReport(date: string): EvalReport | null {
  const parsed = parseReport(sampleReport);
  if (!parsed) return null;
  return { ...parsed, date };
}

function sanitizeDate(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
