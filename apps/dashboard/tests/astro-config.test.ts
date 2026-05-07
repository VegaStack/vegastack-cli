import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs has no types
import config from "../astro.config.mjs";

describe("astro.config.mjs", () => {
  it("uses server output so SSR routes (index, /api/latest.json) are not frozen at build time", () => {
    // `output: "static"` would silently treat unmarked pages as prerendered,
    // freezing build-time R2 misses (e.g. a 503 from index.astro) into the
    // static bundle. SSR-required routes need a server runtime.
    expect((config as { output?: string }).output).not.toBe("static");
    expect(["server", "hybrid"]).toContain((config as { output?: string }).output);
  });
});
