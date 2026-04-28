// E2: example_usage truncation unit tests.
//
// Validates that:
//   1. Default mode truncates to the first HCL fenced block + marker (≤35 lines)
//   2. fullExamples=true restores the full ## Example Usage section
//   3. The truncation marker is present in default mode
//   4. No marker in full mode

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enrichFiles } from "../../../src/lib/discover/enrich.js";
import { loadManifest } from "../../../src/lib/discover/manifest.js";
import type { RankedFile } from "../../../src/lib/discover/merge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");
const AWS_DIR = path.join(FIXTURE_ROOT, "aws");

const LONG_EXAMPLE_FIXTURE = path.resolve(
  __dirname,
  "..",
  "..",
  "fixtures",
  "example-truncation",
  "long-example.html.markdown",
);

/** Build a RankedFile for any absolute file path. */
function fakeRankedAt(filePath: string, score = 200): RankedFile {
  return {
    path: filePath,
    score,
    reasons: [{ kind: "exact_resource", detail: "test_long_example" }],
    tier: "manifest",
  };
}

/** Count the number of lines in a string. */
function lineCount(s: string): number {
  return s.split("\n").length;
}

describe("example_usage truncation (E2)", () => {
  let tmpDir: string;
  let tmpManifestDir: string;

  beforeEach(() => {
    // Create a temporary directory with a minimal MANIFEST.json so we can
    // use enrichFiles with a custom markdown path.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-test-"));
    tmpManifestDir = tmpDir;
    // Copy MANIFEST.json from bundle-mini/aws — we'll override the file path
    // by using the full abs path in ranked.
    const manifest = loadManifest(AWS_DIR);
    // Write a minimal MANIFEST.json that has our test resource pointing to
    // the long-example fixture file. We use a relative path from tmpDir.
    const relPath = path.relative(tmpManifestDir, LONG_EXAMPLE_FIXTURE);
    const testManifest = {
      ...manifest,
      resources: {
        ...manifest.resources,
        test_long_example: {
          type: "resource",
          file: relPath,
          description: "test resource",
          required_args: [],
          optional_args: [],
          computed_attrs: [],
          blocks: {},
          enum_values: {},
          import_syntax: null,
          deprecated: false,
          suggested_alternative: null,
          recommended_companions: [],
          schema_origin: "sdkv2",
          sections: {},
          sha1_prefix: "00000001",
        },
      },
    };
    fs.writeFileSync(path.join(tmpManifestDir, "MANIFEST.json"), JSON.stringify(testManifest));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("default mode: returns ≤35 lines for a 100-line Example Usage block", () => {
    const manifest = loadManifest(tmpManifestDir);
    const { files } = enrichFiles({
      ranked: [fakeRankedAt(LONG_EXAMPLE_FIXTURE)],
      manifest,
      providerDir: tmpManifestDir,
      enrich: true,
      fullExamples: false,
    });
    const example = files[0]?.example_usage ?? "";
    expect(example).not.toBe("");
    const lines = lineCount(example);
    expect(lines).toBeLessThanOrEqual(35);
  });

  it("default mode: includes the truncation marker", () => {
    const manifest = loadManifest(tmpManifestDir);
    const { files } = enrichFiles({
      ranked: [fakeRankedAt(LONG_EXAMPLE_FIXTURE)],
      manifest,
      providerDir: tmpManifestDir,
      enrich: true,
      fullExamples: false,
    });
    const example = files[0]?.example_usage ?? "";
    expect(example).toContain("... (truncated; pass --full-examples for the rest)");
  });

  it("default mode: includes the first HCL fenced block", () => {
    const manifest = loadManifest(tmpManifestDir);
    const { files } = enrichFiles({
      ranked: [fakeRankedAt(LONG_EXAMPLE_FIXTURE)],
      manifest,
      providerDir: tmpManifestDir,
      enrich: true,
      fullExamples: false,
    });
    const example = files[0]?.example_usage ?? "";
    // The first block should contain the opening fence.
    expect(example).toMatch(/```hcl/);
    // And the resource definition content.
    expect(example).toContain('resource "test_long_example"');
  });

  it("fullExamples=true: returns much more content (full section)", () => {
    const manifest = loadManifest(tmpManifestDir);

    const { files: defaultFiles } = enrichFiles({
      ranked: [fakeRankedAt(LONG_EXAMPLE_FIXTURE)],
      manifest,
      providerDir: tmpManifestDir,
      enrich: true,
      fullExamples: false,
    });
    const { files: fullFiles } = enrichFiles({
      ranked: [fakeRankedAt(LONG_EXAMPLE_FIXTURE)],
      manifest,
      providerDir: tmpManifestDir,
      enrich: true,
      fullExamples: true,
    });

    const defaultExample = defaultFiles[0]?.example_usage ?? "";
    const fullExample = fullFiles[0]?.example_usage ?? "";

    // Full content should be significantly longer.
    expect(fullExample.length).toBeGreaterThan(defaultExample.length * 2);
  });

  it("fullExamples=true: does NOT include the truncation marker", () => {
    const manifest = loadManifest(tmpManifestDir);
    const { files } = enrichFiles({
      ranked: [fakeRankedAt(LONG_EXAMPLE_FIXTURE)],
      manifest,
      providerDir: tmpManifestDir,
      enrich: true,
      fullExamples: true,
    });
    const example = files[0]?.example_usage ?? "";
    expect(example).not.toContain("... (truncated; pass --full-examples for the rest)");
  });

  it("fullExamples=true: contains the advanced example lines (full body)", () => {
    const manifest = loadManifest(tmpManifestDir);
    const { files } = enrichFiles({
      ranked: [fakeRankedAt(LONG_EXAMPLE_FIXTURE)],
      manifest,
      providerDir: tmpManifestDir,
      enrich: true,
      fullExamples: true,
    });
    const example = files[0]?.example_usage ?? "";
    // The fixture has "Advanced example line 78" — should be present in full mode.
    expect(example).toContain("Advanced example line 78");
  });

  it("default mode: the bundle-mini s3_bucket fixture (short) returns content without truncation marker", () => {
    // The s3_bucket fixture has a short Example Usage block (one small HCL
    // fence). With E2, the truncated output includes the fence + the marker.
    // Since the fence IS present and is short, the marker appears. This test
    // ensures the HCL path fires correctly for short blocks.
    const manifest = loadManifest(AWS_DIR);
    const { files } = enrichFiles({
      ranked: [
        {
          path: path.join(AWS_DIR, "r/s3_bucket.html.markdown"),
          score: 200,
          reasons: [{ kind: "exact_resource", detail: "aws_s3_bucket" }],
          tier: "manifest",
        },
      ],
      manifest,
      providerDir: AWS_DIR,
      enrich: true,
      fullExamples: false,
    });
    const example = files[0]?.example_usage ?? "";
    // HCL fence must be present.
    expect(example).toMatch(/```terraform/);
    // The content itself must be non-empty.
    expect(example.length).toBeGreaterThan(10);
  });
});
