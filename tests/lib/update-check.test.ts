import { describe, expect, it } from "vitest";
import { cacheIsFresh, isNewer } from "../../src/lib/update-check.js";

describe("isNewer", () => {
  it("compares semver-ish patch versions", () => {
    expect(isNewer("0.1.2", "0.1.1")).toBe(true);
    expect(isNewer("0.1.1", "0.1.2")).toBe(false);
    expect(isNewer("0.1.1", "0.1.1")).toBe(false);
  });
  it("compares minor and major", () => {
    expect(isNewer("0.2.0", "0.1.99")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
  });
  it("missing parts default to 0", () => {
    expect(isNewer("1", "0.99.99")).toBe(true);
    expect(isNewer("0.1", "0.1.0")).toBe(false);
  });
});

describe("cacheIsFresh", () => {
  it("treats < 24h as fresh", () => {
    const c = { checkedAt: new Date(Date.now() - 1000).toISOString(), latest: "0.1.0" };
    expect(cacheIsFresh(c)).toBe(true);
  });
  it("treats > 24h as stale", () => {
    const c = {
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      latest: "0.1.0",
    };
    expect(cacheIsFresh(c)).toBe(false);
  });
  it("treats invalid timestamps as stale", () => {
    expect(cacheIsFresh({ checkedAt: "nope", latest: "0.1.0" })).toBe(false);
  });
});
