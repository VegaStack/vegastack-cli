// Audit F-003 (code-review/mcp): readRegistryText must fail fast when an
// R2 object exceeds the artifact size cap, rather than allocating the full
// body into the isolate.

import { afterEach, describe, expect, it } from "vitest";
import type { KVNamespace, R2Bucket, R2Object, R2ObjectBody } from "@cloudflare/workers-types";
import {
  ArtifactTooLarge,
  MAX_REGISTRY_ARTIFACT_BYTES,
  clearRegistryCaches,
  readRegistryText,
} from "../../src/lib/r2-registry.js";

afterEach(() => clearRegistryCaches());

function makeOversizeEnv(): { env: Env; textCalls: { count: number } } {
  const textCalls = { count: 0 };
  const bucket = {
    async get(_key: string): Promise<R2ObjectBody | null> {
      return {
        size: MAX_REGISTRY_ARTIFACT_BYTES + 1,
        async text() {
          textCalls.count++;
          return "x".repeat(MAX_REGISTRY_ARTIFACT_BYTES + 1);
        },
        body: null,
      } as unknown as R2ObjectBody;
    },
    async head(): Promise<R2Object | null> {
      return null;
    },
  } as unknown as R2Bucket;
  const env = {
    REGISTRY: bucket,
    MCP_OBJECT: {} as unknown as Env["MCP_OBJECT"],
    MCP_CACHE: undefined as unknown as KVNamespace,
    REGISTRY_PUBLIC_BASE_URL: "",
    REGISTRY_MANIFEST_KEY: "cli/packs/terraform/MANIFEST.json",
    CACHE_TTL_SECONDS: "300",
    LOG_LEVEL: "warn",
  } as Env;
  return { env, textCalls };
}

describe("r2-registry size cap (F-003)", () => {
  it("rejects oversized R2 objects without reading the body", async () => {
    const { env, textCalls } = makeOversizeEnv();
    await expect(readRegistryText(env, "cli/packs/foo")).rejects.toBeInstanceOf(ArtifactTooLarge);
    expect(textCalls.count).toBe(0);
  });
});
