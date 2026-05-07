import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURES_ROOT = path.join(REPO_ROOT, "tests", "fixtures");

// Characterization-baseline JSONs and similar fixtures must not embed
// hard-coded absolute paths from the machine where they were generated.
// Otherwise the fixture is non-portable across worktrees / CI checkouts /
// contributor laptops and breaks the suite at integration time.
//
// Reference incident: tests/fixtures/discover/orchestrator-baseline.json
// was generated against /private/tmp/wt-round4-S/... by a worktree-running
// subagent and then failed assertions when the test ran from
// /Users/mk/projects/vegastack-cli/...
//
// Audit category: regression-prevention. See
// `.claude/skills/vegastack-audit/references/regression-pins.md` §
// "Absolute paths in committed test fixtures".

// Absolute-path patterns that indicate a leaked machine path.
const LEAK_PATTERNS = [
  /"\/Users\//,
  /"\/home\//,
  /"\/private\/tmp\//,
  /"\/private\/var\//,
  /"C:\\\\(?:Users|Windows)\\\\/,
  /"\/var\/folders\//,
];

function* walkFixtures(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFixtures(full);
    else if (entry.isFile() && entry.name.endsWith(".json")) yield full;
  }
}

describe("architecture — no-absolute-paths-in-fixtures", () => {
  it("no fixture JSON embeds machine-absolute paths", () => {
    const leaks: { file: string; samples: string[] }[] = [];
    for (const file of walkFixtures(FIXTURES_ROOT)) {
      const text = fs.readFileSync(file, "utf8");
      const samples: string[] = [];
      for (const re of LEAK_PATTERNS) {
        const matches = text.match(new RegExp(re.source, "g"));
        if (matches) samples.push(...matches.slice(0, 3));
      }
      if (samples.length > 0) {
        leaks.push({ file: path.relative(REPO_ROOT, file), samples });
      }
    }
    expect(leaks, JSON.stringify(leaks, null, 2)).toEqual([]);
  });
});
