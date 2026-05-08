// Regression test for the production bug surfaced by true E2E on 2026-05-08:
// `vegastack registry install --all` failed on every pack with
//   ArtifactCorrupt: unexpected file in registry archive: ARTIFACTS.json
// because verifyExtractedArtifacts() built its allowlist solely from
// artifacts.files[] and the index file (`ARTIFACTS.json`) cannot list itself.
//
// Fix: seed the allowlist with `ARTIFACTS.json`. This test invokes the real
// `verifyExtractedArtifacts` from src/lib/registry.ts so a regression that
// removes the seed (or otherwise rejects the index) will fail.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyExtractedArtifacts, type ArtifactIndex } from "../../src/lib/registry.js";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-artifacts-allowlist-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writePackLayout(root: string, files: { path: string; body: string }[]): ArtifactIndex {
  for (const f of files) {
    const target = path.join(root, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.body);
  }
  const artifacts: ArtifactIndex = {
    schema_version: 1,
    files: files.map((f) => ({
      path: f.path,
      bytes: Buffer.byteLength(f.body),
      sha256: sha256(Buffer.from(f.body)),
    })),
  };
  fs.writeFileSync(path.join(root, "ARTIFACTS.json"), JSON.stringify(artifacts, null, 2));
  return artifacts;
}

describe("verifyExtractedArtifacts (production code)", () => {
  it("accepts a layout that includes ARTIFACTS.json plus everything in artifacts.files[]", () => {
    const artifacts = writePackLayout(tmpRoot, [
      { path: "MANIFEST.json", body: '{"schema_version":1}' },
      { path: "docs/foo.md", body: "# foo\n" },
      { path: "docs/bar/baz.md", body: "# baz\n" },
    ]);
    expect(() => verifyExtractedArtifacts(tmpRoot, artifacts)).not.toThrow();
  });

  it("rejects a smuggled file not listed in artifacts.files[]", () => {
    const artifacts = writePackLayout(tmpRoot, [{ path: "docs/foo.md", body: "# foo\n" }]);
    fs.writeFileSync(path.join(tmpRoot, "post-install.sh"), "echo evil");
    expect(() => verifyExtractedArtifacts(tmpRoot, artifacts)).toThrow(
      /unexpected file in registry archive: post-install\.sh/,
    );
  });

  it("rejects when a listed file is missing", () => {
    const artifacts = writePackLayout(tmpRoot, [{ path: "docs/foo.md", body: "# foo\n" }]);
    fs.unlinkSync(path.join(tmpRoot, "docs/foo.md"));
    expect(() => verifyExtractedArtifacts(tmpRoot, artifacts)).toThrow(
      /registry archive missing docs\/foo\.md/,
    );
  });

  it("rejects when a listed file has a tampered sha256", () => {
    const artifacts = writePackLayout(tmpRoot, [{ path: "docs/foo.md", body: "# foo\n" }]);
    fs.writeFileSync(path.join(tmpRoot, "docs/foo.md"), "# tampered\n");
    expect(() => verifyExtractedArtifacts(tmpRoot, artifacts)).toThrow(
      /registry artifact checksum mismatch for docs\/foo\.md/,
    );
  });
});
