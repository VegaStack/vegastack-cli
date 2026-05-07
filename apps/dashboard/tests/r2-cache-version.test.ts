import { describe, it, expect, vi } from "vitest";
import { getReport } from "../src/lib/r2";
import sample from "../src/fixtures/sample-report.json";

/**
 * Why: KV cache keys for parsed reports must carry a schema-version prefix
 * so that future schema changes can be rolled out by bumping the prefix
 * (e.g. v1 -> v2) without serving stale entries from the previous shape.
 *
 * Bug pre-fix: cacheKey was `report:<date>` — no version namespace.
 */
describe("r2 KV cache schema-version prefix", () => {
  it("reads from a versioned cache key (v1:report:<date>)", async () => {
    const seenKeys: string[] = [];
    const env = {
      REPORTS_CACHE: {
        get: vi.fn(async (key: string, _kind: string) => {
          seenKeys.push(key);
          return sample; // pretend cached
        }),
        put: vi.fn(async () => {}),
      },
      REGISTRY: { get: vi.fn(async () => null) },
    } as unknown as Parameters<typeof getReport>[0];

    await getReport(env, "2026-04-28");
    expect(seenKeys).toContain("v1:report:2026-04-28");
    // Defensive: must NOT use the un-namespaced key
    expect(seenKeys).not.toContain("report:2026-04-28");
  });

  it("writes new entries under the versioned key", async () => {
    const r2Get = vi.fn(async () => ({
      json: async () => sample,
    }));
    const kvPut = vi.fn(async () => {});
    const env = {
      REPORTS_CACHE: {
        get: vi.fn(async () => null),
        put: kvPut,
      },
      REGISTRY: { get: r2Get },
    } as unknown as Parameters<typeof getReport>[0];

    const out = await getReport(env, "2026-04-28");
    expect(out).not.toBeNull();
    expect(kvPut).toHaveBeenCalled();
    expect(kvPut.mock.calls[0]![0]).toBe("v1:report:2026-04-28");
  });

  it("uses a versioned key for the report index", async () => {
    const seenKeys: string[] = [];
    const env = {
      REPORTS_CACHE: {
        get: vi.fn(async (key: string) => {
          seenKeys.push(key);
          return null;
        }),
        put: vi.fn(async () => {}),
      },
      REGISTRY: { get: vi.fn(async () => null) },
    } as unknown as Parameters<typeof getReport>[0];

    // getRecentReports calls getReportIndex internally
    const { getRecentReports } = await import("../src/lib/r2");
    await getRecentReports(env, 5);
    expect(seenKeys.some((k) => k.startsWith("v1:"))).toBe(true);
    expect(seenKeys).not.toContain("index");
  });
});
