import { describe, it, expect, vi } from "vitest";
import { getRecentReports } from "../src/lib/r2";
import sample from "../src/fixtures/sample-report.json";

/**
 * Why: getRecentReports asked for 30 reports and used Promise.all to fan
 * them all out at once. Against a slow R2 origin (or under burst load on
 * a Worker isolate's subrequest pool) that creates 30 unbounded parallel
 * GETs and a thundering herd. Cap concurrency at a small worker-pool
 * size (5) so an isolate sees at most 5 in-flight R2 reads at any moment.
 */
describe("getRecentReports concurrency", () => {
  it("never has more than 5 R2 GETs in flight simultaneously", async () => {
    const dates = Array.from({ length: 30 }, (_, i) => `2026-04-${String(i + 1).padStart(2, "0")}`);
    const indexJson = {
      dates,
      latest: dates[0],
      generated_at: new Date().toISOString(),
    };

    let inFlight = 0;
    let maxInFlight = 0;
    const env = {
      REPORTS_CACHE: undefined,
      REGISTRY: {
        get: vi.fn(async (key: string) => {
          if (key.endsWith("INDEX.json")) {
            return { json: async () => indexJson };
          }
          inFlight++;
          if (inFlight > maxInFlight) maxInFlight = inFlight;
          // simulate latency so overlap is observable
          await new Promise((r) => setTimeout(r, 10));
          inFlight--;
          return { json: async () => sample };
        }),
      },
    } as unknown as Parameters<typeof getRecentReports>[0];

    const out = await getRecentReports(env, 30);
    expect(out.length).toBe(30);
    expect(maxInFlight).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });
});
