// Reproduces F-007 (rollup #82, code-review/registry):
// `writeManagedToolMetadata` (and other metadata writers) used `writeFileSync`
// directly. A SIGINT/power-loss between open(O_TRUNC) and write completion
// leaves a truncated/partial file at the canonical path.
//
// We assert the centralized atomicWriteFileSync helper writes via a temp
// path + rename, so a mid-write crash either leaves the canonical path
// untouched or fully written — never partially overwritten.

import { describe, expect, it, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { atomicWriteFileSync } from "../../src/lib/fs-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("atomicWriteFileSync", () => {
  it("writes via temp+rename so the canonical path is never partially overwritten", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-atomic-"));
    const target = path.join(dir, "meta.json");
    fs.writeFileSync(target, "OLD-CONTENT-PRESERVED");

    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("simulated crash mid-rename");
    });

    expect(() => atomicWriteFileSync(target, "NEW-CONTENT")).toThrow(/simulated crash/);

    // Canonical file untouched: old content preserved (never partially clobbered).
    expect(fs.readFileSync(target, "utf8")).toBe("OLD-CONTENT-PRESERVED");
    renameSpy.mockRestore();
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
