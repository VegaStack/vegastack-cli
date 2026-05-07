// Audit F-002 (code-review/mcp): non-NotFound errors raised inside a tool
// handler must be collapsed to a generic `Internal` envelope; raw R2 /
// binding messages must NOT reach the client.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { KVNamespace, R2Bucket, R2Object, R2ObjectBody } from "@cloudflare/workers-types";
import { clearRegistryCaches } from "../../src/lib/r2-registry.js";
import { handleRegistryGetKnowledgeCard } from "../../src/tools/registry_get_knowledge_card.js";
import { handleRegistryGetRecipe } from "../../src/tools/registry_get_recipe.js";

afterEach(() => {
  clearRegistryCaches();
  vi.restoreAllMocks();
});

function makeThrowingEnv(message: string): Env {
  const bucket = {
    async get(_key: string): Promise<R2ObjectBody | null> {
      throw new Error(message);
    },
    async head(): Promise<R2Object | null> {
      return null;
    },
  } as unknown as R2Bucket;
  return {
    REGISTRY: bucket,
    MCP_OBJECT: {} as unknown as Env["MCP_OBJECT"],
    MCP_CACHE: undefined as unknown as KVNamespace,
    // No CDN fallback — error from R2 must surface.
    REGISTRY_PUBLIC_BASE_URL: "",
    REGISTRY_MANIFEST_KEY: "cli/packs/terraform/MANIFEST.json",
    CACHE_TTL_SECONDS: "300",
    LOG_LEVEL: "error",
  } as Env;
}

describe("tool error sanitization (F-002)", () => {
  it("knowledge_card returns Internal envelope and does not leak raw error message", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "R2: binding not configured: __INTERNAL_REQ_ID_abc123__";
    // R2 throws, but no CDN fallback, so the fetch path also returns null —
    // forcing a synthesised non-NotFound error path. We override readRegistryText
    // by making R2 throw a non-binding-availability error and disabling fallback.
    const env = makeThrowingEnv(secret);
    // Force the throw to escape the readRegistryText catch by routing through a
    // thrown ArtifactTooLarge-style condition: but simpler — readRegistryText
    // currently swallows R2 throws and returns RegistryKeyNotFound. To exercise
    // the F-002 sanitization path, monkey-patch readRegistryText.
    const r2 = await import("../../src/lib/r2-registry.js");
    const orig = r2.readRegistryText;
    vi.spyOn(r2, "readRegistryText").mockImplementation(async () => {
      throw new Error(secret);
    });
    const out = await handleRegistryGetKnowledgeCard(env, { id: "anything" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
    expect(parsed.code).toBe("Internal");
    expect(parsed.error).not.toContain("R2:");
    expect(parsed.error).not.toContain("__INTERNAL_REQ_ID_abc123__");
    expect(errSpy).toHaveBeenCalled();
    void orig;
  });

  it("recipe returns Internal envelope and does not leak raw error message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = makeThrowingEnv("ignored");
    const r2 = await import("../../src/lib/r2-registry.js");
    vi.spyOn(r2, "readRegistryText").mockImplementation(async () => {
      throw new Error("R2: binding error reqId=cf-internal-7af");
    });
    const out = await handleRegistryGetRecipe(env, { id: "anything" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
    expect(parsed.code).toBe("Internal");
    expect(parsed.error).not.toContain("R2:");
    expect(parsed.error).not.toContain("cf-internal");
  });
});
