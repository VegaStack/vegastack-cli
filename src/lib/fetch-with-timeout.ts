import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { VegaStackError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes total per request.

/**
 * Return the URL with its query and fragment stripped, for use in user-facing
 * error messages. Falls back to the raw input if it is not a parseable URL.
 */
function stripUrlQuery(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

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

export interface StreamDownloadOptions extends FetchWithTimeoutOptions {
  /** Hard byte ceiling. Stream is aborted once this is exceeded. */
  maxBytes: number;
  /** Optional exact-bytes invariant for verified artifacts. */
  expectedBytes?: number;
  /** Optional hex sha256 the streamed bytes must match. */
  expectedSha?: string;
}

/**
 * Download `url` to `target` while streaming the body to a `.part` file.
 * Aborts and throws ArtifactCorrupt if running total exceeds `maxBytes`,
 * which prevents a malicious mirror from OOM-ing the CLI by serving a
 * multi-GB body before any size/sha check.
 */
export async function streamDownloadVerified(
  url: string,
  target: string,
  opts: StreamDownloadOptions,
): Promise<void> {
  const { maxBytes, expectedBytes, expectedSha, ...rest } = opts;
  const response = await fetchWithTimeout(url, { redirect: "follow", ...rest });
  if (!response.ok) {
    throw new VegaStackError("NetworkError", `failed to fetch ${url}: HTTP ${response.status}`, {
      context: { url, status: response.status },
    });
  }
  const body = response.body;
  if (!body) {
    throw new VegaStackError("ArtifactCorrupt", `empty body from ${url}`, { context: { url } });
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const partPath = `${target}.part`;
  const handle = fs.createWriteStream(partPath);
  const hash = createHash("sha256");
  let total = 0;
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const cleanupPart = (): void => {
    try {
      handle.destroy();
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(partPath);
    } catch {
      /* ignore */
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        cleanupPart();
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new VegaStackError(
          "ArtifactCorrupt",
          `download from ${url} exceeded ${maxBytes} bytes`,
          {
            context: { url, max_bytes: maxBytes },
          },
        );
      }
      const chunk = Buffer.from(value);
      hash.update(chunk);
      if (!handle.write(chunk)) {
        await new Promise<void>((resolve) => handle.once("drain", resolve));
      }
    }
    await new Promise<void>((resolve, reject) => {
      handle.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    cleanupPart();
    throw e;
  }

  // Strip query/fragment from URL before formatting into user-visible
  // messages so a future signed-URL or token-bearing query string cannot
  // leak via logs. Full URL is preserved in `context` for debugging.
  const safeUrl = stripUrlQuery(url);
  if (expectedBytes !== undefined && total !== expectedBytes) {
    cleanupPart();
    throw new VegaStackError("ArtifactCorrupt", `size mismatch for ${safeUrl}`, {
      context: { url, expected: expectedBytes, actual: total },
    });
  }
  const actualSha = hash.digest("hex");
  if (expectedSha !== undefined && actualSha !== expectedSha) {
    cleanupPart();
    throw new VegaStackError("ChecksumMismatch", `checksum mismatch for ${safeUrl}`, {
      context: { url, expected: expectedSha, actual: actualSha },
    });
  }
  fs.renameSync(partPath, target);
}

export interface FetchTextWithCapOptions extends FetchWithTimeoutOptions {
  /** Hard byte ceiling for the response body. */
  maxBytes: number;
}

/**
 * fetch the URL as text, but stream the body and abort with ArtifactCorrupt
 * once the running byte total exceeds `maxBytes`. Defends against a hostile
 * mirror that streams a multi-GB body to OOM the CLI before any
 * size/signature/JSON check runs.
 */
export async function fetchTextWithCap(
  url: string,
  opts: FetchTextWithCapOptions,
): Promise<string> {
  const { maxBytes, ...rest } = opts;
  const response = await fetchWithTimeout(url, { redirect: "follow", ...rest });
  if (!response.ok) {
    throw new VegaStackError("NetworkError", `failed to fetch ${url}: HTTP ${response.status}`, {
      context: { url, status: response.status },
    });
  }
  const body = response.body;
  if (!body) {
    // Body-less response (e.g. 204 in tests). Nothing to cap.
    return "";
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new VegaStackError(
          "ArtifactCorrupt",
          `response from ${url} exceeded ${maxBytes} bytes`,
          { context: { url, max_bytes: maxBytes } },
        );
      }
      chunks.push(Buffer.from(value));
    }
  } catch (e) {
    if (e instanceof VegaStackError) throw e;
    throw new VegaStackError("NetworkError", `failed to read ${url}: ${(e as Error).message}`, {
      cause: e,
      context: { url },
    });
  }
  return Buffer.concat(chunks).toString("utf8");
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
