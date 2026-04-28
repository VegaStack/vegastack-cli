// mergeAndRank() unit tests.

import { describe, expect, it } from "vitest";
import { mergeAndRank } from "../../../src/lib/discover/merge.js";
import type { ScoredFile } from "../../../src/lib/discover/types.js";

function sf(score: number, kind: ScoredFile["reasons"][0]["kind"]): ScoredFile {
  return {
    score,
    reasons: [{ kind, detail: "x" }],
    tier: "manifest",
  };
}

describe("mergeAndRank", () => {
  it("dedupes paths and promotes shared hits to manifest+grep", () => {
    const tier1Map = new Map([["/x/r/a.html.markdown", sf(100, "exact_resource")]]);
    const tier2Map = new Map([["/x/r/a.html.markdown", sf(40, "grep_resource")]]);
    const merged = mergeAndRank(tier1Map, tier2Map, 10);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.tier).toBe("manifest+grep");
    expect(merged[0]?.score).toBeCloseTo(120, 1);
  });

  it("pure-grep results get tier='grep'", () => {
    const merged = mergeAndRank(
      new Map(),
      new Map([["/x/r/a.html.markdown", sf(40, "grep_resource")]]),
      10,
    );
    expect(merged[0]?.tier).toBe("grep");
  });

  it("pure-manifest results get tier='manifest'", () => {
    const merged = mergeAndRank(
      new Map([["/x/r/a.html.markdown", sf(100, "exact_resource")]]),
      new Map(),
      10,
    );
    expect(merged[0]?.tier).toBe("manifest");
  });

  it("sorts by score desc; on tie, shorter resource name first", () => {
    const tier1Map = new Map([
      ["/x/r/cloudflare_zone_dns_settings.html.markdown", sf(100, "exact_resource")],
      ["/x/r/cloudflare_dns_record.html.markdown", sf(100, "exact_resource")],
    ]);
    const merged = mergeAndRank(tier1Map, new Map(), 10);
    expect(merged[0]?.path).toBe("/x/r/cloudflare_dns_record.html.markdown");
  });

  it("respects maxFiles cap", () => {
    const tier1Map = new Map();
    for (let i = 0; i < 50; i++) {
      tier1Map.set(`/x/r/r${i}.html.markdown`, sf(100 - i, "exact_resource"));
    }
    expect(mergeAndRank(tier1Map, new Map(), 5)).toHaveLength(5);
  });
});
