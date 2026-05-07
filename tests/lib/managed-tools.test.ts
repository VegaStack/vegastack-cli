// Smoke coverage for src/lib/managed-tools.ts.
//
// installManagedTools fans out to per-tool installers that all hit the
// network. We instead exercise the include-filter + capture wrapper by
// passing an `include` list with no matching tools, which yields an empty
// dispatch but still exercises the entry point.

import { describe, expect, it } from "vitest";
import {
  installManagedTools,
  type ManagedToolsUpdateResult,
} from "../../src/lib/managed-tools.js";

describe("installManagedTools (smoke)", () => {
  it("returns a manifest_generated_at timestamp and an empty tools map for an empty include list", async () => {
    const result: ManagedToolsUpdateResult = await installManagedTools({ include: [] });
    expect(typeof result.manifest_generated_at).toBe("string");
    expect(result.manifest_generated_at.length).toBeGreaterThan(0);
    expect(result.tools).toEqual({});
  });

  it("ignores unknown include names without throwing", async () => {
    const result = await installManagedTools({
      // Cast through `unknown` so the test exercises the runtime filter
      // even when an unknown tool name slips through type-checking upstream.
      include: ["definitely-not-a-tool" as unknown as never],
    });
    expect(result.tools).toEqual({});
  });
});
