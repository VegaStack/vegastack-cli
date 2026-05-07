// Characterization (golden-output) test for tier1.
//
// Pinned for refactor of audit issue #59 (cyclomatic complexity 117 → ≤15).
// Each case asserts that tier1() produces byte-identical output (paths, scores,
// reason kinds, reason details, ordering after sort) for a fixed set of inputs.
// Baseline was captured from the pre-refactor implementation.

import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifest } from "../../../src/lib/discover/manifest.js";
import { tier1 } from "../../../src/lib/discover/tier1.js";
import type { AliasRewrite } from "../../../src/lib/discover/tokenize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BASELINE_PATH = path.join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "discover",
  "tier1-baseline.json",
);

interface BaselineCase {
  input: {
    tokens: string[];
    provider: string;
    aliasMatches: AliasRewrite[] | null;
  };
  fixture: string;
  entries: Array<[string, { score: number; reasons: Array<{ kind: string; detail: string }>; tier: string }]>;
}

const baseline: Record<string, BaselineCase> = JSON.parse(
  fs.readFileSync(BASELINE_PATH, "utf8"),
);

describe("tier1 — characterization (#59 refactor pin)", () => {
  for (const [name, c] of Object.entries(baseline)) {
    it(`preserves output for case: ${name}`, () => {
      const providerDir = path.join(REPO_ROOT, c.fixture);
      const manifest = loadManifest(providerDir);
      const out = tier1({
        manifest,
        tokens: c.input.tokens,
        provider: c.input.provider,
        providerDir,
        aliasMatches: c.input.aliasMatches ?? undefined,
      });
      const got = Array.from(out.entries())
        .map(([k, v]) => [
          path.relative(providerDir, k),
          {
            score: v.score,
            reasons: v.reasons.map((r) => ({ kind: r.kind, detail: r.detail })),
            tier: v.tier,
          },
        ] as const)
        .sort(([a], [b]) => (a as string).localeCompare(b as string));
      expect(got).toEqual(c.entries);
    });
  }
});
