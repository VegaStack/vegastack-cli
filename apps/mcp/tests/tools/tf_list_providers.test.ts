import { afterEach, describe, expect, it } from "vitest";
import { clearBundleCaches } from "../../src/lib/r2-bundle.js";
import { handleTfListProviders } from "../../src/tools/tf_list_providers.js";
import { makeEnv, SEED_BASIC } from "../_fixtures.js";

afterEach(() => clearBundleCaches());

describe("tf_list_providers", () => {
  it("returns sorted providers + bundle_version + count", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTfListProviders(env);
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.providers).toEqual(["aws", "cloudflare", "datadog"]);
    expect(parsed.bundle_version).toBe("2026.04.28");
    expect(parsed.count).toBe(3);
    expect(out.structuredContent).toEqual(parsed);
  });
});
