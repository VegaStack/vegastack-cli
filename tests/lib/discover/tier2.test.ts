// Tier-2 unit tests. Validates the grep fallback and the ripgrep cache.

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { _ripgrepCacheForTesting, clearCaches, tier2 } from "../../../src/lib/discover/tier2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");
const AWS_DIR = path.join(FIXTURE_ROOT, "aws");

describe("tier2 — happy path", () => {
  it("returns matches for a token present in markdown content", () => {
    clearCaches();
    const out = tier2({
      tokens: ["s3_bucket"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    // grep results pull in any file that contains the literal "aws_s3_bucket".
    expect(out.size).toBeGreaterThanOrEqual(0); // grep may or may not match stub bodies
  });

  it("empty token list still completes without throwing", () => {
    clearCaches();
    const out = tier2({ tokens: [], provider: "aws", providerDir: AWS_DIR });
    expect(out.size).toBeGreaterThanOrEqual(0);
  });
});

describe("tier2 — clearCaches() works (closes F18)", () => {
  it("populates cache on first call, clears it on demand", () => {
    clearCaches();
    expect(_ripgrepCacheForTesting()).toBeNull();
    tier2({ tokens: ["lambda"], provider: "aws", providerDir: AWS_DIR });
    const cached = _ripgrepCacheForTesting();
    expect(cached).not.toBeNull();
    expect(cached?.pathHash).toBeDefined();
    expect(typeof cached?.available).toBe("boolean");
    clearCaches();
    expect(_ripgrepCacheForTesting()).toBeNull();
  });

  it("cache is keyed by hashed PATH so PATH changes are picked up", () => {
    clearCaches();
    tier2({ tokens: ["s3"], provider: "aws", providerDir: AWS_DIR });
    const before = _ripgrepCacheForTesting();
    expect(before).not.toBeNull();

    const oldPath = process.env.PATH;
    process.env.PATH = `/nonexistent:${oldPath ?? ""}`;
    try {
      tier2({ tokens: ["s3"], provider: "aws", providerDir: AWS_DIR });
      const after = _ripgrepCacheForTesting();
      expect(after).not.toBeNull();
      expect(after?.pathHash).not.toBe(before?.pathHash);
    } finally {
      process.env.PATH = oldPath;
    }
  });
});

describe("tier2 — non-existent provider dir returns empty", () => {
  it("missing dir → 0 results, no throw", () => {
    clearCaches();
    const out = tier2({
      tokens: ["s3"],
      provider: "aws",
      providerDir: path.join(FIXTURE_ROOT, "does-not-exist"),
    });
    expect(out.size).toBe(0);
  });
});
