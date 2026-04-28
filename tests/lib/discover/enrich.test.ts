// Enrich unit tests against the bundle-mini fixture.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enrichFiles } from "../../../src/lib/discover/enrich.js";
import { loadManifest } from "../../../src/lib/discover/manifest.js";
import type { RankedFile } from "../../../src/lib/discover/merge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");
const AWS_DIR = path.join(FIXTURE_ROOT, "aws");

function fakeRanked(file: string, score = 200): RankedFile {
  return {
    path: path.join(AWS_DIR, file),
    score,
    reasons: [{ kind: "exact_resource", detail: "aws_s3_bucket" }],
    tier: "manifest",
  };
}

describe("enrichFiles", () => {
  it("returns a fileToResource map for stage 1l (closes F24)", () => {
    const manifest = loadManifest(AWS_DIR);
    const { fileToResource } = enrichFiles({
      ranked: [],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
    });
    expect(fileToResource.get("r/s3_bucket.html.markdown")).toBe("aws_s3_bucket");
    expect(fileToResource.get("r/eks_cluster.html.markdown")).toBe("aws_eks_cluster");
  });

  it("populates manifest_entry by default", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown")],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
    });
    expect(files[0]?.manifest_entry).toBeDefined();
    expect(files[0]?.manifest_entry?.type).toBe("resource");
    expect(files[0]?.manifest_entry?.recommended_companions).toEqual(
      expect.arrayContaining(["aws_s3_bucket_versioning"]),
    );
  });

  it("populates example_usage in default mode (when present in markdown)", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown")],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
    });
    // The fixture stub markdown contains "## Example Usage".
    expect(files[0]?.example_usage).toMatch(/Example Usage/);
  });

  it("computes score_norm 0..100", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown", 200)],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
    });
    expect(files[0]?.score_norm).toBeGreaterThanOrEqual(0);
    expect(files[0]?.score_norm).toBeLessThanOrEqual(100);
  });

  it("--raw mode keeps manifest_entry but blanks example_usage", () => {
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [fakeRanked("r/s3_bucket.html.markdown")],
      manifest,
      providerDir: AWS_DIR,
      enrich: false,
    });
    expect(files[0]?.manifest_entry).toBeDefined();
    expect(files[0]?.example_usage).toBe("");
  });

  it("synthesizes a minimal manifest_entry for files not in the manifest", () => {
    const manifest = loadManifest(AWS_DIR);
    const stranger: RankedFile = {
      path: path.join(AWS_DIR, "guides/some-guide.html.markdown"),
      score: 50,
      reasons: [{ kind: "guide_link", detail: "x" }],
      tier: "manifest",
    };
    const { files } = enrichFiles({
      ranked: [stranger],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
    });
    expect(files[0]?.manifest_entry).toBeDefined();
    expect(files[0]?.manifest_entry?.recommended_companions).toEqual([]);
    expect(files[0]?.manifest_entry?.blocks).toEqual({});
    expect(files[0]?.manifest_entry?.schema_origin).toBe("sdkv2");
  });
});
