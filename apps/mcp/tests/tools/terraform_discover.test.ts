import { afterEach, describe, expect, it } from "vitest";
import { clearRegistryCaches } from "../../src/lib/r2-registry.js";
import { handleTerraformDiscover, terraformDiscoverSchema } from "../../src/tools/terraform_discover.js";
import { makeEnv, SEED_BASIC } from "../_fixtures.js";

afterEach(() => clearRegistryCaches());

describe("terraform_discover", () => {
  it("schema fields are present and validate basic input", async () => {
    expect(terraformDiscoverSchema.query).toBeDefined();
    expect(terraformDiscoverSchema.provider).toBeDefined();
    expect(terraformDiscoverSchema.max).toBeDefined();
    // empty query rejected
    const parsed = terraformDiscoverSchema.query.safeParse("");
    expect(parsed.success).toBe(false);
  });

  it("returns canonical envelope (status='ok') with explicit provider", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformDiscover(env, {
      query: "S3 bucket with versioning",
      provider: "aws",
    });
    expect(out.content[0]?.type).toBe("text");
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("ok");
    expect(parsed.provider).toBe("aws");
    expect(parsed.schema_version).toBe(1);
    expect(parsed.registry_version).toBe("2026.04.28");
    expect(parsed.tokens).toContain("s3");
    expect(parsed.tokens).toContain("versioning");
    expect(parsed.tiers_used).toContain("manifest");
    expect(Array.isArray(parsed.knowledge)).toBe(true);
    expect(Array.isArray(parsed.recipes)).toBe(true);
    expect(Array.isArray(parsed.concept_aliases_used)).toBe(true);
    expect(Array.isArray(parsed.citations)).toBe(true);
    expect(parsed.count).toBe(parsed.files.length);
    expect(parsed.files.length).toBeGreaterThanOrEqual(2);
    const top = parsed.files[0];
    expect(top.path).toMatch(/^cli\/packs\/terraform\/docs\/aws\//);
    expect(top.score_norm).toBe(100);
    expect(top.tier).toBe("manifest");
    expect(top.manifest_entry).toBeDefined();
    expect(typeof top.example_usage).toBe("string");
    expect(top.example_usage.startsWith("resource ")).toBe(true);
  });

  it("auto-detects provider from query when omitted", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformDiscover(env, { query: "cloudflare DNS record" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("ok");
    expect(parsed.provider).toBe("cloudflare");
    expect(parsed.provider_confidence).toBeGreaterThan(0.5);
    expect(parsed.files[0].manifest_entry.required_args.map((a: { name: string }) => a.name)).toContain("zone_id");
  });

  it("returns error envelope for unknown provider", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformDiscover(env, { query: "anything", provider: "fake-cloud" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
    expect(parsed.code).toBe("ProviderUnknown");
  });

  it("returns error envelope when no provider can be detected", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformDiscover(env, { query: "make a thing" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
    expect(parsed.code).toBe("ProviderUnknown");
  });

  it("respects the max limit", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformDiscover(env, {
      query: "S3 bucket",
      provider: "aws",
      max: 1,
    });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.files.length).toBeLessThanOrEqual(1);
  });

  it("structuredContent matches the JSON-encoded text body", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTerraformDiscover(env, { query: "S3 bucket", provider: "aws" });
    expect(out.structuredContent).toEqual(JSON.parse(out.content[0]!.text));
  });
});
