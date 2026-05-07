import { VegaStackError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes total per request.

export interface FetchWithTimeoutOptions extends Omit<globalThis.RequestInit, "signal"> {
  /** Total timeout in ms. Falls back to VEGASTACK_FETCH_TIMEOUT_MS env, else 5 min. */
  timeoutMs?: number;
}

/**
 * fetch() wrapper that aborts hung connections via AbortController.
 * Throws a VegaStackError("NetworkError") on timeout. All other fetch errors
 * are wrapped as NetworkError as well so callers don't need to inspect cause.
 *
 * Used by registry.ts, managed-tool-installer.ts, cloudflared.ts, ripgrep.ts.
 */
export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs, ...rest } = opts;
  const ms = pickTimeout(timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new VegaStackError("NetworkError", `request to ${url} timed out after ${ms} ms`, {
        cause: e,
        context: { url, timeout_ms: ms },
      });
    }
    throw new VegaStackError("NetworkError", `failed to fetch ${url}: ${(e as Error).message}`, {
      cause: e,
      context: { url },
    });
  } finally {
    clearTimeout(timer);
  }
}

function pickTimeout(explicit: number | undefined): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return explicit;
  const env = process.env.VEGASTACK_FETCH_TIMEOUT_MS;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_TIMEOUT_MS;
}
