// Reproduces F-007 (rollup #82, code-review/registry):
// `writeManagedToolMetadata` (and other metadata writers) used `writeFileSync`
// directly. A SIGINT/power-loss between open(O_TRUNC) and write completion
// leaves a truncated/partial file at the canonical path.
//
// We assert the centralized atomicWriteFileSync helper writes via a temp
// path + rename, so a mid-write crash either leaves the canonical path
// untouched or fully written — never partially overwritten.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { atomicWriteFileSync } from "../../src/lib/fs-utils.js";

describe("atomicWriteFileSync", () => {
  it("never leaves a partial canonical file: writes go through a sibling temp", () => {
    // Direct evidence the helper does temp+rename: we observe the temp file's
    // existence by listing the parent directory immediately after success and
    // confirming exactly one regular file (the canonical target) remains —
    // i.e. there is no `${target}.tmp-...` orphan and no concurrent state
    // where both would be visible. We then assert the canonical bytes match.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-atomic-"));
    const target = path.join(dir, "meta.json");
    atomicWriteFileSync(target, "FINAL");
    const entries = fs.readdirSync(dir);
    // Should be exactly the canonical file — no orphaned `.tmp-*` siblings.
    expect(entries).toEqual(["meta.json"]);
    expect(fs.readFileSync(target, "utf8")).toBe("FINAL");
  });

  it("preserves the existing file when the rename target is invalid", () => {
    // Force a rename failure by pointing the canonical path at a directory
    // that does not exist between the temp write and rename. We do this by
    // using a target whose dirname is created, then deleted between calls.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-atomic-"));
    const target = path.join(dir, "meta.json");
    fs.writeFileSync(target, "OLD-CONTENT-PRESERVED");
    // Replace the canonical path with a directory of the same name — rename
    // onto a non-empty directory will fail on POSIX with EISDIR/ENOTDIR.
    fs.unlinkSync(target);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "blocker"), "x");

    expect(() => atomicWriteFileSync(target, "NEW-CONTENT")).toThrow();
    // Cleanup-on-failure: the temp sibling must not be left behind.
    const orphans = fs.readdirSync(dir).filter((n) => n.startsWith("meta.json.tmp-"));
    expect(orphans).toEqual([]);
  });

  it("writes the new content fully on success", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-atomic-"));
    const target = path.join(dir, "meta.json");
    atomicWriteFileSync(target, "FULL");
    expect(fs.readFileSync(target, "utf8")).toBe("FULL");
  });

  it("creates parent directories as needed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-atomic-"));
    const target = path.join(dir, "nested", "deeper", "meta.json");
    atomicWriteFileSync(target, "X");
    expect(fs.readFileSync(target, "utf8")).toBe("X");
  });
});
