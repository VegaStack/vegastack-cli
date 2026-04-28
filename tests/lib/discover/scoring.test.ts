// Scoring helpers — canonical multiplier, length tie-break, normalization.

import { describe, expect, it } from "vitest";
import {
  Scorer,
  applyCanonicalMultiplier,
  normalizeScores,
  tieBreakByNameLength,
} from "../../../src/lib/discover/scoring.js";
import type { ScoredFile } from "../../../src/lib/discover/types.js";

describe("Scorer (basic)", () => {
  it("accumulates score and reasons; toMap returns the entries", () => {
    const s = new Scorer();
    s.add("/a/r/foo.html.markdown", 100, "exact_resource", "x_foo");
    s.add("/a/r/foo.html.markdown", 25, "subcategory_peer", "X");
    const m = s.toMap();
    const e = m.get("/a/r/foo.html.markdown")!;
    expect(e.score).toBeCloseTo(125, 1);
    expect(e.reasons).toHaveLength(2);
  });

  it("DEDUPE_REASON_KINDS collapses repeats", () => {
    const s = new Scorer();
    s.add("/a/r/foo.html.markdown", 25, "subcategory_peer", "X");
    s.add("/a/r/foo.html.markdown", 25, "subcategory_peer", "X");
    s.add("/a/r/foo.html.markdown", 25, "subcategory_peer", "X");
    const e = s.toMap().get("/a/r/foo.html.markdown")!;
    expect(e.reasons).toHaveLength(1);
  });
});

describe("applyCanonicalMultiplier (closes F6)", () => {
  it("boosts files with exact_resource by ×1.5", () => {
    const m = new Map<string, ScoredFile>([
      [
        "/a/r/foo.html.markdown",
        { score: 100, reasons: [{ kind: "exact_resource", detail: "foo" }], tier: "manifest" },
      ],
      [
        "/a/r/bar.html.markdown",
        { score: 100, reasons: [{ kind: "name_partial", detail: "bar" }], tier: "manifest" },
      ],
    ]);
    const out = applyCanonicalMultiplier(m);
    expect(out.get("/a/r/foo.html.markdown")?.score).toBeCloseTo(150, 1);
    expect(out.get("/a/r/bar.html.markdown")?.score).toBeCloseTo(100, 1);
  });

  it("boosts files with primary_resource by ×1.5", () => {
    const m = new Map<string, ScoredFile>([
      [
        "/a/r/p.html.markdown",
        { score: 80, reasons: [{ kind: "primary_resource", detail: "p" }], tier: "manifest" },
      ],
    ]);
    expect(applyCanonicalMultiplier(m).get("/a/r/p.html.markdown")?.score).toBeCloseTo(120, 1);
  });
});

describe("tieBreakByNameLength (closes F6)", () => {
  it("score desc; on tie, shorter resource name wins", () => {
    const a = { path: "/x/r/cloudflare_dns_record.html.markdown", score: 100 };
    const b = { path: "/x/r/cloudflare_zone_dns_settings.html.markdown", score: 100 };
    const sorted = [a, b].sort(tieBreakByNameLength);
    expect(sorted[0]?.path).toBe(a.path);
  });

  it("score desc dominates length tie-break", () => {
    const a = { path: "/x/r/zzz_long_name.html.markdown", score: 200 };
    const b = { path: "/x/r/a.html.markdown", score: 100 };
    expect([b, a].sort(tieBreakByNameLength)[0]?.path).toBe(a.path);
  });
});

describe("normalizeScores (closes F7)", () => {
  it("maps raw scores to 0..100 against the theoretical max", () => {
    const m = new Map([
      ["/x/r/a.html.markdown", { score: 200 }],
      ["/x/r/b.html.markdown", { score: 100 }],
      ["/x/r/c.html.markdown", { score: 0 }],
    ]);
    const norms = normalizeScores(m, 400);
    expect(norms.get("/x/r/a.html.markdown")).toBeCloseTo(50, 1);
    expect(norms.get("/x/r/b.html.markdown")).toBeCloseTo(25, 1);
    expect(norms.get("/x/r/c.html.markdown")).toBe(0);
  });

  it("clamps to 100 when raw exceeds theoretical max", () => {
    const m = new Map([["/x/r/a.html.markdown", { score: 9_999 }]]);
    expect(normalizeScores(m, 400).get("/x/r/a.html.markdown")).toBe(100);
  });

  it("uses default theoretical max (400) when not specified", () => {
    const m = new Map([["/x/r/a.html.markdown", { score: 200 }]]);
    expect(normalizeScores(m).get("/x/r/a.html.markdown")).toBeCloseTo(50, 1);
  });
});
