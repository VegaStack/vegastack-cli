import { describe, expect, it } from "vitest";
import {
  computeLift,
  formatLiftPct,
  formatPct,
  parseReport,
  sortArchetypes,
  type ArchetypeRollup,
} from "../src/lib/parse-report";
import sample from "../src/fixtures/sample-report.json";

describe("parse-report", () => {
  it("parses the bundled fixture", () => {
    const report = parseReport(sample);
    expect(report).not.toBeNull();
    expect(report?.schema_version).toBe(1);
    expect(report?.prompts.length).toBeGreaterThan(0);
    expect(report?.archetypes.length).toBe(12);
  });

  it("rejects malformed input", () => {
    expect(parseReport(null)).toBeNull();
    expect(parseReport({})).toBeNull();
    expect(parseReport({ date: "2026-04-28" })).toBeNull();
  });

  it("formats lift percentages with explicit sign", () => {
    expect(formatLiftPct(0.47)).toBe("+47%");
    expect(formatLiftPct(0)).toBe("0%");
    expect(formatLiftPct(-0.1)).toBe("-10%");
  });

  it("formats pass rates as plain percent", () => {
    expect(formatPct(0.69)).toBe("69%");
    expect(formatPct(1)).toBe("100%");
  });

  it("computes lift on the closed-error formula", () => {
    expect(computeLift(0.4, 0.7)).toBeCloseTo(0.5);
    expect(computeLift(0, 0.5)).toBeCloseTo(0.5);
    // Already perfect baseline → no headroom.
    expect(computeLift(1, 1)).toBe(0);
  });

  it("sorts archetypes A1..A12", () => {
    const shuffled: ArchetypeRollup[] = [
      { archetype: "A12", prompt_count: 1, baseline_pass_rate: 0, with_skill_pass_rate: 1, lift: 1 },
      { archetype: "A1", prompt_count: 1, baseline_pass_rate: 0, with_skill_pass_rate: 1, lift: 1 },
      { archetype: "A5", prompt_count: 1, baseline_pass_rate: 0, with_skill_pass_rate: 1, lift: 1 },
    ];
    expect(sortArchetypes(shuffled).map((r) => r.archetype)).toEqual([
      "A1",
      "A5",
      "A12",
    ]);
  });
});

describe("sample fixture invariants", () => {
  const report = parseReport(sample)!;

  it("has all 12 archetypes represented", () => {
    const archs = new Set(report.archetypes.map((a) => a.archetype));
    [
      "A1", "A2", "A3", "A4", "A5", "A6",
      "A7", "A8", "A9", "A10", "A11", "A12",
    ].forEach((a) => expect(archs.has(a as never)).toBe(true));
  });

  it("headline lift is internally consistent", () => {
    const computed = computeLift(
      report.baseline_pass_rate,
      report.with_skill_pass_rate,
    );
    // Allow 5pp drift (fixture is hand-authored, not regenerated).
    expect(Math.abs(computed - report.lift)).toBeLessThan(0.05);
  });

  it("every prompt rolls up under a known archetype", () => {
    const known = new Set(report.archetypes.map((a) => a.archetype));
    for (const p of report.prompts) {
      expect(known.has(p.archetype)).toBe(true);
    }
  });
});
