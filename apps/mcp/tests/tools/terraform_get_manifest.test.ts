import { afterEach, describe, expect, it } from "vitest";
import { clearRegistryCaches } from "../../src/lib/r2-registry.js";
import { handleTerraformGetManifest } from "../../src/tools/terraform_get_manifest.js";
import { makeEnv, SEED_BASIC } from "../_fixtures.js";

afterEach(() => clearRegistryCaches());

describe("terraform_get_manifest", () => {
  it("returns the full provider manifest when no resource is given", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformGetManifest(env, { provider: "aws" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.provider).toBe("aws");
    expect(parsed.resources.aws_s3_bucket).toBeDefined();
  });

  it("returns the single resource entry when resource is given", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformGetManifest(env, { provider: "aws", resource: "aws_s3_bucket" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.provider).toBe("aws");
    expect(parsed.resource).toBe("aws_s3_bucket");
    expect(parsed.entry.required_args[0].name).toBe("bucket");
  });

  it("returns error envelope for unknown resource", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformGetManifest(env, { provider: "aws", resource: "aws_does_not_exist" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
    expect(parsed.code).toBe("ResourceUnknown");
  });

  it("returns error envelope for unknown provider", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformGetManifest(env, { provider: "fake" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
  });
});
