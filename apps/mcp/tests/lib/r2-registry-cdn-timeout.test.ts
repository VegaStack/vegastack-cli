// Audit F-004 (code-review/mcp): the CDN fallback `fetch` must use an
// AbortController so a slow origin doesn't stall the MCP client until the
// global Workers subrequest limit fires.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { KVNamespace, R2Bucket, R2Object, R2ObjectBody } from "@cloudflare/workers-types";
import { clearRegistryCaches, readRegistryText, RegistryKeyNotFound } from "../../src/lib/r2-registry.js";

afterEach(() => {
  clearRegistryCaches();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeMissingR2Env(): Env {
  const bucket = {
    async get(): Promise<R2ObjectBody | null> {
      return null;
    },
    async head(): Promise<R2Object | null> {
      return null;
    },
  } as unknown as R2Bucket;
  return {
    REGISTRY: bucket,
    MCP_OBJECT: {} as unknown as Env["MCP_OBJECT"],
    MCP_CACHE: undefined as unknown as KVNamespace,
    REGISTRY_PUBLIC_BASE_URL: "https://cli-registry.vegastack.example",
    REGISTRY_MANIFEST_KEY: "cli/packs/terraform/MANIFEST.json",
    CACHE_TTL_SECONDS: "300",
    LOG_LEVEL: "warn",
  } as Env;
}

describe("r2-registry CDN timeout (F-004)", () => {
  it("aborts the CDN fetch when the origin hangs", async () => {
    const env = makeMissingR2Env();

    // Stub global fetch with a promise that resolves only when the signal
    // aborts. If the read never aborts we'd hang the test forever; vitest's
    // 5s default would fire — but we want to assert the fix actively, so we
    // observe abort propagation.
    const aborted = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            const sig = init?.signal;
            if (sig) {
              sig.addEventListener("abort", () => {
                aborted();
                reject(new DOMException("aborted", "AbortError"));
              });
            }
          }),
      ),
    );

    vi.useFakeTimers();
    const promise = readRegistryText(env, "cli/packs/missing");
    // Pre-attach the rejection handler so the timer-driven abort doesn't
    // surface as an unhandled rejection while we await the timer queue.
    const settled = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_500);
    const err = await settled;
    expect(err).toBeInstanceOf(RegistryKeyNotFound);
    expect(aborted).toHaveBeenCalled();
  });
});
