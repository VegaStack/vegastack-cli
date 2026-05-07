// Anti-bluff TDD coverage for issue #76 — zip extraction must reject
// zip-slip (`..`) entries and absolute-path entries before any bytes
// land on disk. We synthesize the malicious zip at runtime so the
// fixture is auditable in this file.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeExtractZip } from "../../src/lib/safe-extract.js";
import { VegaStackError } from "../../src/lib/errors.js";

function makeTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("safeExtractZip — issue #76 (zip-slip defense)", () => {
  let stagingParent: string;
  let evilZip: string;
  let benignZip: string;

  beforeAll(() => {
    stagingParent = makeTmp("vs-zip-evil-");

    // --- evil zip: contains "../escape.txt" --------------------------
    const evilSrc = path.join(stagingParent, "evil-src");
    fs.mkdirSync(evilSrc, { recursive: true });
    // Create a file inside, then build the zip with a literal "../" name
    // by using the python -m zipfile trick is unavailable; instead we
    // invoke `zip` with a relative path that *contains* `..`.
    const inner = path.join(evilSrc, "inner");
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, "real.txt"), "real");
    // From inside `inner`, archive ../escape.txt — `zip` records the
    // literal "../escape.txt" path in the central directory.
    fs.writeFileSync(path.join(evilSrc, "escape.txt"), "ESCAPED");
    evilZip = path.join(stagingParent, "evil.zip");
    execFileSync("zip", ["-q", evilZip, "../escape.txt"], { cwd: inner, stdio: "pipe" });

    // --- benign zip: contains a regular nested file -------------------
    const benignSrc = path.join(stagingParent, "benign-src");
    fs.mkdirSync(path.join(benignSrc, "sub"), { recursive: true });
    fs.writeFileSync(path.join(benignSrc, "sub", "ok.txt"), "ok");
    benignZip = path.join(stagingParent, "benign.zip");
    execFileSync("zip", ["-qr", benignZip, "sub"], { cwd: benignSrc, stdio: "pipe" });
  });

  afterAll(() => {
    try {
      fs.rmSync(stagingParent, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("rejects zip archives containing path-traversal entries", async () => {
    const dest = makeTmp("vs-zip-extract-");
    const parent = path.dirname(dest);
    const witness = path.join(parent, "escape.txt");
    try {
      // Pre-condition: witness file does not exist.
      expect(fs.existsSync(witness)).toBe(false);
      let caught: unknown;
      try {
        await safeExtractZip(evilZip, dest);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(VegaStackError);
      // Either our explicit guard fires, or yauzl rejects the bogus entry
      // first via its own central-directory validator. In both cases the
      // error chain mentions the offending path or rejects extraction.
      const top = (caught as Error).message;
      const cause = (caught as { cause?: Error }).cause?.message ?? "";
      expect(`${top} :: ${cause}`).toMatch(/unsafe|escape|traversal|path|zip archive/i);
      // Post-condition: nothing escaped.
      expect(fs.existsSync(witness)).toBe(false);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
      try {
        fs.unlinkSync(witness);
      } catch {
        /* ignore */
      }
    }
  });

  it("extracts benign zip archives", async () => {
    const dest = makeTmp("vs-zip-extract-");
    try {
      await safeExtractZip(benignZip, dest);
      expect(fs.readFileSync(path.join(dest, "sub", "ok.txt"), "utf8")).toBe("ok");
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("rejects zip archives containing symlink entries", async () => {
    // Build a zip containing a symlink. `zip --symlinks` preserves the
    // symlink mode bits in externalFileAttributes — exactly the field
    // safeExtractZip's symlink guard inspects.
    const symParent = makeTmp("vs-zip-sym-");
    const src = path.join(symParent, "src");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(symParent, "target.txt"), "TARGET");
    fs.symlinkSync(path.join(symParent, "target.txt"), path.join(src, "link"));
    const symZip = path.join(symParent, "sym.zip");
    execFileSync("zip", ["-q", "--symlinks", symZip, "link"], {
      cwd: src,
      stdio: "pipe",
    });
    const dest = makeTmp("vs-zip-extract-");
    try {
      let caught: unknown;
      try {
        await safeExtractZip(symZip, dest);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(VegaStackError);
      const top = (caught as Error).message;
      const cause = (caught as { cause?: Error }).cause?.message ?? "";
      expect(`${top} :: ${cause}`).toMatch(/symlink|symbolic/i);
      // No file (symlink target) should land in dest.
      expect(fs.readdirSync(dest)).toHaveLength(0);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.rmSync(symParent, { recursive: true, force: true });
    }
  });
});
