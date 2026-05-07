// Characterization (golden-output) test for the discover() orchestrator.
//
// Pinned for the round-4 refactor of the discover() orchestrator
// (cyclomatic complexity 37 → ≤15). Each case asserts that discover()
// produces the same envelope shape (status, files, knowledge, recipes,
// counts, tokens, tiers_used, concept_aliases_used, citations,
// provider_confidence, mode, error fields) for a fixed set of inputs.
//
// Baseline was captured from the pre-refactor implementation via
// scripts/gen-orchestrator-baseline.mjs against tests/fixtures/registry-mini.

import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../../../src/lib/discover/index.js";
import type { DiscoverArgs, DiscoverResult } from "../../../src/lib/discover/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BASELINE_PATH = path.join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "discover",
  "orchestrator-baseline.json",
);

interface BaselineCase {
  input: DiscoverArgs;
  output: DiscoverResult;
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Record<string, BaselineCase>;

function normalize(r: DiscoverResult): DiscoverResult {
  // Drop timings (non-deterministic) and re-stringify for stable structural
  // compare. Mirrors the generator script.
  const out = JSON.parse(JSON.stringify(r)) as DiscoverResult & { timings?: unknown };
  delete out.timings;
  return out;
}

describe("discover orchestrator — characterization (round-4 refactor pin)", () => {
  for (const [name, c] of Object.entries(baseline)) {
    it(`preserves envelope for case: ${name}`, async () => {
      // Re-resolve the root path against the running repo so the test is
      // portable across worktrees / CI runners. The baseline was captured
      // against tests/fixtures/registry-mini, so we substitute in the
      // local absolute path.
      const localRoot = path.join(REPO_ROOT, "tests", "fixtures", "registry-mini");
      const args = { ...c.input, root: localRoot };
      const got = normalize(await discover(args));
      const expected = normalize(c.output);
      expect(got).toEqual(expected);
    });
  }
});
