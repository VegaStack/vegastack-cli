import { afterEach, describe, expect, it } from "vitest";
import { clearRegistryCaches } from "../../src/lib/r2-registry.js";
import { handleTerraformListProviders } from "../../src/tools/terraform_list_providers.js";
import { makeEnv, SEED_BASIC } from "../_fixtures.js";

afterEach(() => clearRegistryCaches());

describe("terraform_list_providers", () => {
  it("returns sorted providers + registry_version + count", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformListProviders(env);
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.providers).toEqual(["aws", "cloudflare", "datadog"]);
    expect(parsed.registry_version).toBe("2026.04.28");
    expect(parsed.count).toBe(3);
    expect(out.structuredContent).toEqual(parsed);
  });
});
