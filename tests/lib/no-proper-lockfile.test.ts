// Architectural test: proper-lockfile must not appear as a dep or in any source/test
// import. Pinned by audit F-001 (rollup B / code-quality).

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("proper-lockfile is fully removed", () => {
  it("is not declared in root package.json (deps or devDeps)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["proper-lockfile"]).toBeUndefined();
    expect(pkg.devDependencies?.["@types/proper-lockfile"]).toBeUndefined();
  });

  it("is not imported from any source/test/script file", () => {
    const result = execSync(
      `git grep -nIE "proper-lockfile" -- src tests scripts apps npm ':!tests/lib/no-proper-lockfile.test.ts' || true`,
      { cwd: repoRoot, encoding: "utf8" },
    ).trim();
    expect(result).toBe("");
  });
});
