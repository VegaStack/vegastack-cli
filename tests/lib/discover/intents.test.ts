// buildIntents() unit tests.

import { describe, expect, it } from "vitest";
import { buildIntents } from "../../../src/lib/discover/intents.js";
import type { RankedFile } from "../../../src/lib/discover/merge.js";

function rf(p: string, score: number, kw: string, intent: string): RankedFile {
  return {
    path: p,
    score,
    reasons: [{ kind: "subcat_keyword", detail: `${kw}→${intent}` }],
    tier: "manifest",
  };
}

describe("buildIntents", () => {
  it("groups files by intent buckets when ≥2 distinct buckets present", () => {
    const groups = buildIntents([
      rf("/x/r/a.md", 100, "s3", "S3"),
      rf("/x/r/b.md", 80, "s3", "S3"),
      rf("/x/r/c.md", 60, "rds", "RDS"),
    ]);
    expect(groups).toHaveLength(2);
    const names = groups.map((g) => g.intent).sort();
    expect(names).toEqual(["RDS", "S3"]);
  });

  it("emits a rationale per group", () => {
    const groups = buildIntents([
      rf("/x/r/a.md", 100, "s3", "S3"),
      rf("/x/r/b.md", 60, "rds", "RDS"),
    ]);
    for (const g of groups) {
      expect(g.rationale).toMatch(/subcategory keyword/);
    }
  });

  it("returns [] when only one bucket fired", () => {
    const groups = buildIntents([rf("/x/r/a.md", 100, "s3", "S3")]);
    expect(groups).toEqual([]);
  });

  it("returns [] when no subcat_keyword reasons present", () => {
    const groups = buildIntents([
      {
        path: "/x/r/a.md",
        score: 100,
        reasons: [{ kind: "exact_resource", detail: "foo" }],
        tier: "manifest",
      },
    ]);
    expect(groups).toEqual([]);
  });
});
