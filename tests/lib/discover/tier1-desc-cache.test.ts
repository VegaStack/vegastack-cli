// Audit code-review/discover F-003: stage1h (description substring match)
// used to allocate a fresh ~1.7k-entry array via [...Object.entries(...)]
// AND lower-case every description on every query. The fix memoises a
// flat lowercased index per manifest object via a WeakMap.

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifest } from "../../../src/lib/discover/manifest.js";
import { tier1 } from "../../../src/lib/discover/tier1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AWS_DIR = path.resolve(__dirname, "..", "..", "fixtures", "registry-mini", "aws");

describe("tier1 stage1h description-index cache (F-003)", () => {
  it("two calls on the same manifest produce identical description-reasoned hits", () => {
    const manifest = loadManifest(AWS_DIR);
    const args = {
      manifest,
      tokens: ["bucket"],
      provider: "aws",
      providerDir: AWS_DIR,
    };
    const a = tier1(args);
    const b = tier1(args);

    const descKindsA = Array.from(a.values())
      .flatMap((v) => v.reasons.filter((r) => r.kind === "description").map((r) => r.detail))
      .sort();
    const descKindsB = Array.from(b.values())
      .flatMap((v) => v.reasons.filter((r) => r.kind === "description").map((r) => r.detail))
      .sort();

    expect(descKindsA).toEqual(descKindsB);
  });

  it("does not mutate manifest entries while building the index", () => {
    const manifest = loadManifest(AWS_DIR);
    const before = JSON.stringify(manifest.resources);
    tier1({ manifest, tokens: ["bucket"], provider: "aws", providerDir: AWS_DIR });
    expect(JSON.stringify(manifest.resources)).toBe(before);
  });
});
