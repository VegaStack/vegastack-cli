// Reproduces #81: scripts/update-managed-tools-manifest.ts must authenticate
// api.github.com requests when GITHUB_TOKEN (or GH_TOKEN) is present so the
// weekly managed-tools workflow doesn't hit the 60-req/h unauthenticated cap.
// Asset downloads at objects.githubusercontent.com must NOT carry the auth
// header — that domain rejects extra Authorization headers on signed URLs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "../../scripts/update-managed-tools-manifest.js";

interface RecordedCall {
  url: string;
  init: { headers?: Record<string, string> } | undefined;
}

const ENV_KEYS = ["GITHUB_TOKEN", "GH_TOKEN"] as const;

describe("update-managed-tools-manifest fetchText auth (#81)", () => {
  const saved: Record<string, string | undefined> = {};
  let calls: RecordedCall[] = [];
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    calls = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push({ url, init: init as RecordedCall["init"] });
      return new Response("ok", { status: 200 });
    }) as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function authHeader(init: RecordedCall["init"]): string | undefined {
    const h = init?.headers;
    if (!h) return undefined;
    return h.Authorization ?? h.authorization;
  }
  function apiVersionHeader(init: RecordedCall["init"]): string | undefined {
    const h = init?.headers;
    if (!h) return undefined;
    return h["X-GitHub-Api-Version"] ?? h["x-github-api-version"];
  }

  it("attaches Authorization: Bearer and api-version when GITHUB_TOKEN is set on api.github.com", async () => {
    process.env.GITHUB_TOKEN = "xyz";
    await fetchText("https://api.github.com/repos/foo/bar/releases/latest");
    expect(calls).toHaveLength(1);
    expect(authHeader(calls[0]?.init)).toBe("Bearer xyz");
    expect(apiVersionHeader(calls[0]?.init)).toBe("2022-11-28");
  });

  it("falls back to GH_TOKEN when GITHUB_TOKEN is unset", async () => {
    process.env.GH_TOKEN = "abc";
    await fetchText("https://api.github.com/repos/foo/bar/releases/latest");
    expect(authHeader(calls[0]?.init)).toBe("Bearer abc");
  });

  it("does NOT attach Authorization when no token is present", async () => {
    await fetchText("https://api.github.com/repos/foo/bar/releases/latest");
    expect(authHeader(calls[0]?.init)).toBeUndefined();
  });

  it("does NOT attach Authorization on objects.githubusercontent.com even with token set", async () => {
    process.env.GITHUB_TOKEN = "xyz";
    await fetchText("https://objects.githubusercontent.com/github-production-release/asset.tar.gz");
    expect(authHeader(calls[0]?.init)).toBeUndefined();
  });

  it("preserves the User-Agent header on every call", async () => {
    process.env.GITHUB_TOKEN = "xyz";
    await fetchText("https://api.github.com/repos/foo/bar/releases/latest");
    const h = calls[0]?.init?.headers ?? {};
    expect(h["User-Agent"]).toBe("vegastack-cli-managed-tools-updater");
  });
});
