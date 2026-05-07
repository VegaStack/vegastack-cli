// Anti-bluff TDD coverage for issue #75 — tar extraction must reject
// non-regular entries (symlinks, hardlinks, devices) and path traversal.
//
// We synthesize a tar archive at runtime that contains a symlink pointing
// at an out-of-tree location. A vulnerable extractor would create the
// symlink under the staging dir; the safe extractor must reject the
// archive before writing anything.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeExtractTar } from "../../src/lib/safe-extract.js";
import { VegaStackError } from "../../src/lib/errors.js";

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("safeExtractTar — issue #75 (entry-type defense)", () => {
  const traversalFixture = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "safe-tar",
    "traversal.tar.gz",
  );

  let symlinkArchive: string;
  let escapeWitness: string;
  let stagingParent: string;

  beforeAll(() => {
    // Build a tar.gz containing a symlink entry whose name passes
    // path validation but points to /tmp/<witness>.
    stagingParent = makeTmp("vs-tar-evil-");
    const buildDir = path.join(stagingParent, "build");
    fs.mkdirSync(buildDir, { recursive: true });
    escapeWitness = path.join(stagingParent, "escape-target.txt");

    // Create symlink "innocuous-name" -> escapeWitness inside buildDir
    fs.symlinkSync(escapeWitness, path.join(buildDir, "innocuous-name"));

    symlinkArchive = path.join(stagingParent, "evil.tar.gz");
    execFileSync("tar", ["-czf", symlinkArchive, "-C", buildDir, "innocuous-name"], {
      stdio: "pipe",
    });
  });

  afterAll(() => {
    try {
      fs.rmSync(stagingParent, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("rejects archives containing symlink entries", () => {
    const dest = makeTmp("vs-tar-extract-");
    try {
      expect(() => safeExtractTar(symlinkArchive, dest)).toThrow(VegaStackError);
      expect(() => safeExtractTar(symlinkArchive, dest)).toThrow(/symlink|hardlink|non-regular/i);
      // No symlink should have been created in the destination dir.
      const entries = fs.readdirSync(dest);
      expect(entries).toHaveLength(0);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("rejects archives with path traversal entries (existing fixture)", () => {
    const dest = makeTmp("vs-tar-extract-");
    try {
      expect(() => safeExtractTar(traversalFixture, dest)).toThrow(VegaStackError);
      expect(() => safeExtractTar(traversalFixture, dest)).toThrow(/unsafe|path/i);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("accepts archives containing only regular files and directories", () => {
    // Build a benign archive at runtime.
    const benignParent = makeTmp("vs-tar-benign-");
    try {
      const srcDir = path.join(benignParent, "payload");
      fs.mkdirSync(path.join(srcDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(srcDir, "a.txt"), "hello");
      fs.writeFileSync(path.join(srcDir, "sub", "b.txt"), "world");
      const archive = path.join(benignParent, "ok.tar.gz");
      execFileSync("tar", ["-czf", archive, "-C", srcDir, "."], { stdio: "pipe" });

      const dest = makeTmp("vs-tar-extract-");
      try {
        safeExtractTar(archive, dest);
        expect(fs.readFileSync(path.join(dest, "a.txt"), "utf8")).toBe("hello");
        expect(fs.readFileSync(path.join(dest, "sub", "b.txt"), "utf8")).toBe("world");
      } finally {
        fs.rmSync(dest, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(benignParent, { recursive: true, force: true });
    }
  });
});
