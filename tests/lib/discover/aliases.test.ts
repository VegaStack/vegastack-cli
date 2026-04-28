// Concept-alias loader unit tests against the bundle-mini fixture.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aliasesToConceptMatches, loadAliases } from "../../../src/lib/discover/aliases.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");

describe("loadAliases — happy path", () => {
  it("parses YAML with phrase, alias, resources[]", () => {
    const aliases = loadAliases({ bundleRoot: FIXTURE_ROOT, provider: "aws" });
    expect(aliases.length).toBeGreaterThan(0);
    const a = aliases.find((x) => x.alias === "s3_static_site");
    expect(a).toBeDefined();
    expect(a!.phrase).toBe("static website");
    expect(a!.resources).toContain("aws_s3_bucket");
    expect(a!.provider).toBe("aws");
  });

  it("loads cloudflare aliases", () => {
    const aliases = loadAliases({ bundleRoot: FIXTURE_ROOT, provider: "cloudflare" });
    expect(aliases.length).toBeGreaterThan(0);
  });

  it("missing aliases.yaml → [] (not an error)", () => {
    const aliases = loadAliases({ bundleRoot: FIXTURE_ROOT, provider: "no-such-provider" });
    expect(aliases).toEqual([]);
  });
});

describe("loadAliases — malformed input handling", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vega-alias-"));
    fs.mkdirSync(path.join(tmp, "aws"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("empty aliases.yaml → []", () => {
    fs.writeFileSync(path.join(tmp, "aws", "aliases.yaml"), "");
    expect(loadAliases({ bundleRoot: tmp, provider: "aws" })).toEqual([]);
  });

  it("malformed YAML → []", () => {
    fs.writeFileSync(path.join(tmp, "aws", "aliases.yaml"), "{[invalid yaml");
    expect(loadAliases({ bundleRoot: tmp, provider: "aws" })).toEqual([]);
  });

  it("non-array YAML → []", () => {
    fs.writeFileSync(path.join(tmp, "aws", "aliases.yaml"), "key: value");
    expect(loadAliases({ bundleRoot: tmp, provider: "aws" })).toEqual([]);
  });

  it("entries missing required fields are skipped", () => {
    fs.writeFileSync(
      path.join(tmp, "aws", "aliases.yaml"),
      "- phrase: ok\n  alias: a\n- phrase: only-phrase\n",
    );
    const aliases = loadAliases({ bundleRoot: tmp, provider: "aws" });
    // First entry missing resources → dropped. Second missing alias → dropped.
    expect(aliases).toEqual([]);
  });
});

describe("aliasesToConceptMatches", () => {
  it("converts AliasRewrite[] to ConceptAliasMatch[] envelope shape", () => {
    const matches = aliasesToConceptMatches([
      {
        phrase: "static website",
        alias: "s3_static_site",
        resources: ["aws_s3_bucket", "aws_s3_bucket_website_configuration"],
        provider: "aws",
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matched_alias).toBe("s3_static_site");
    expect(matches[0]?.provider).toBe("aws");
    expect(matches[0]?.phrase).toBe("static website");
    expect(matches[0]?.resources).toContain("aws_s3_bucket");
  });
});
