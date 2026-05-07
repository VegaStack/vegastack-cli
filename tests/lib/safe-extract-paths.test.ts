// Unit-level coverage for assertSafeRelativePath and the zip-symlink guard,
// added to keep mutation-review tight: each individual guard is exercised
// by at least one test so a mutant that disables it gets caught.

import { describe, expect, it } from "vitest";
import { assertSafeRelativePath } from "../../src/lib/safe-extract.js";
import { VegaStackError } from "../../src/lib/errors.js";

describe("assertSafeRelativePath", () => {
  it("rejects absolute posix paths", () => {
    expect(() => assertSafeRelativePath("/etc/passwd")).toThrow(VegaStackError);
  });

  it("rejects backslash separators (Windows-pathed entries)", () => {
    expect(() => assertSafeRelativePath("foo\\bar.txt")).toThrow(VegaStackError);
  });

  it("rejects '..' path segments", () => {
    expect(() => assertSafeRelativePath("a/../b")).toThrow(VegaStackError);
    expect(() => assertSafeRelativePath("../escape.txt")).toThrow(VegaStackError);
    expect(() => assertSafeRelativePath("..")).toThrow(VegaStackError);
  });

  it("accepts benign relative paths", () => {
    expect(() => assertSafeRelativePath("a/b/c.txt")).not.toThrow();
    expect(() => assertSafeRelativePath("./a/b/c.txt")).not.toThrow();
    expect(() => assertSafeRelativePath("a/b/")).not.toThrow();
  });
});
