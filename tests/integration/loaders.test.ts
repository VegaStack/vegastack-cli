// Loader coverage on the test fixture bundle (tests/fixtures/bundle-mini).
//
// E2 owns the actual loader implementations (src/lib/discover/{knowledge,recipes,aliases}.ts).
// This file ships the contract-level tests that loaders MUST satisfy when E2 lands them.
// Until E2 ships, the tests parse the on-disk fixtures directly so the suite proves the
// fixture is well-formed and the contract is documented.

import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(HERE, "..", "fixtures", "bundle-mini");

describe("bundle-mini fixture sanity", () => {
  it("has a root MANIFEST.json with expected providers", async () => {
    const m = JSON.parse(await readFile(join(BUNDLE, "MANIFEST.json"), "utf8")) as {
      providers: string[];
      bundle_version: string;
    };
    expect(m.providers).toEqual(expect.arrayContaining(["aws", "cloudflare"]));
    expect(m.bundle_version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
  });

  it("each provider has at least 5 resources in MANIFEST.json", async () => {
    for (const provider of ["aws", "cloudflare"]) {
      const m = JSON.parse(await readFile(join(BUNDLE, provider, "MANIFEST.json"), "utf8")) as {
        resources: Record<string, unknown>;
      };
      expect(Object.keys(m.resources).length).toBeGreaterThanOrEqual(5);
    }
  });

  it("each provider has aliases.yaml with at least 2 entries", async () => {
    for (const provider of ["aws", "cloudflare"]) {
      const yaml = await readFile(join(BUNDLE, provider, "aliases.yaml"), "utf8");
      const entries = (yaml.match(/^- phrase:/gm) ?? []).length;
      expect(entries).toBeGreaterThanOrEqual(2);
    }
  });

  it("knowledge dir has at least 1 card with required frontmatter", async () => {
    const cards = await readdir(join(BUNDLE, "knowledge"));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    const body = await readFile(join(BUNDLE, "knowledge", cards[0]!), "utf8");
    expect(body).toContain("id:");
    expect(body).toContain("triggers:");
    expect(body).toContain("overrides_training:");
  });

  it("recipes dir has at least 1 TOML recipe with [scaffold].hcl", async () => {
    const recipes = await readdir(join(BUNDLE, "recipes"));
    expect(recipes.length).toBeGreaterThanOrEqual(1);
    const body = await readFile(join(BUNDLE, "recipes", recipes[0]!), "utf8");
    expect(body).toContain("[scaffold]");
    expect(body).toContain("[[pitfalls]]");
  });
});

describe("manifest entry shape (per discover-types.ts contract)", () => {
  it("aws_s3_bucket has split-resource companions", async () => {
    const m = JSON.parse(await readFile(join(BUNDLE, "aws", "MANIFEST.json"), "utf8")) as {
      resources: Record<string, { recommended_companions: string[] }>;
    };
    const entry = m.resources.aws_s3_bucket;
    expect(entry).toBeTruthy();
    expect(entry?.recommended_companions).toEqual(
      expect.arrayContaining([
        "aws_s3_bucket_versioning",
        "aws_s3_bucket_server_side_encryption_configuration",
      ]),
    );
  });

  it("aws_eks_cluster declares a vpc_config block (top-level args + block separation)", async () => {
    const m = JSON.parse(await readFile(join(BUNDLE, "aws", "MANIFEST.json"), "utf8")) as {
      resources: Record<
        string,
        { required_args: { name: string }[]; blocks: Record<string, unknown> }
      >;
    };
    const entry = m.resources.aws_eks_cluster;
    expect(entry?.required_args.map((a) => a.name)).toEqual(
      expect.arrayContaining(["name", "role_arn", "vpc_config"]),
    );
    expect(entry?.blocks.vpc_config).toBeTruthy();
  });

  it("cloudflare_dns_record has the v5-rename import_syntax", async () => {
    const m = JSON.parse(await readFile(join(BUNDLE, "cloudflare", "MANIFEST.json"), "utf8")) as {
      resources: Record<string, { import_syntax: { command: string; id_format: string } | null }>;
    };
    const entry = m.resources.cloudflare_dns_record;
    expect(entry?.import_syntax?.command).toContain("cloudflare_dns_record");
    expect(entry?.import_syntax?.id_format).toBe("<zone_id>/<record_id>");
  });
});
