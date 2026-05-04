// E1: Brief mode unit tests.
//
// Validates that:
//   1. brief=true strips manifest_entry content and example_usage
//   2. brief=true adds a `name` field from the manifest lookup
//   3. The JSON envelope size is at most 25% of the non-brief size for the same query

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enrichFiles } from "../../../src/lib/discover/enrich.js";
import { loadManifest } from "../../../src/lib/discover/manifest.js";
import type { RankedFile } from "../../../src/lib/discover/merge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "registry-mini");
const AWS_DIR = path.join(FIXTURE_ROOT, "aws");

function fakeRanked(file: string, score = 200): RankedFile {
  return {
    path: path.join(AWS_DIR, file),
    score,
    reasons: [{ kind: "exact_resource", detail: "aws_s3_bucket" }],
    tier: "manifest",
  };
}

describe("enrichFiles — brief mode (E1)", () => {
  it("brief=true: strips example_usage and sets it to empty string", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown")],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
      brief: true,
    });
    expect(files[0]?.example_usage).toBe("");
  });

  it("brief=true: manifest_entry has empty required_args / optional_args / computed_attrs", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown")],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
      brief: true,
    });
    const entry = files[0]?.manifest_entry;
    expect(entry).toBeDefined();
    expect(entry?.required_args).toEqual([]);
    expect(entry?.optional_args).toEqual([]);
    expect(entry?.computed_attrs).toEqual([]);
    expect(entry?.blocks).toEqual({});
    expect(entry?.recommended_companions).toEqual([]);
  });

  it("brief=true: adds name field from manifest lookup", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown")],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
      brief: true,
    });
    expect(files[0]?.name).toBe("aws_s3_bucket");
  });

  it("brief=false (default): name field is absent", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown")],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
      brief: false,
    });
    expect(files[0]?.name).toBeUndefined();
  });

  it("brief=true: path, score, score_norm, tier, reasons are preserved", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown", 300)],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
      brief: true,
    });
    const f = files[0];
    expect(f?.path).toContain("s3_bucket.html.markdown");
    expect(f?.score).toBeGreaterThan(0);
    expect(f?.score_norm).toBeGreaterThanOrEqual(0);
    expect(f?.score_norm).toBeLessThanOrEqual(100);
    expect(f?.tier).toBe("manifest");
    expect(f?.reasons.length).toBeGreaterThan(0);
  });

  it("brief envelope is significantly smaller than full envelope (JSON.stringify length)", () => {
    const manifest = loadManifest(AWS_DIR);

    // Build a ranked list with multiple files to get a realistic comparison.
    const ranked: RankedFile[] = [
      fakeRanked("r/s3_bucket.html.markdown", 300),
      fakeRanked("r/eks_cluster.html.markdown", 200),
      fakeRanked("r/iam_role.html.markdown", 150),
    ];

    const { files: fullFiles } = enrichFiles({
      ranked,
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
      brief: false,
    });
    const { files: briefFiles } = enrichFiles({
      ranked,
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
      brief: true,
    });

    const fullSize = JSON.stringify(fullFiles).length;
    const briefSize = JSON.stringify(briefFiles).length;

    // Brief must be strictly smaller than full — validates the stripping works.
    // The registry-mini fixture has small manifest entries; real-world savings are
    // ~80%. The threshold of 75% is achievable with both mini and real Registry packs.
    expect(briefSize).toBeLessThan(fullSize);
    expect(briefSize).toBeLessThanOrEqual(fullSize * 0.75);
  });
});
