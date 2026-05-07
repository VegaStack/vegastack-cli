// Guards against runDoctor's cyclomatic-complexity regression (rollup #82).
// Executes ESLint with the project's complexity threshold (15) on doctor.ts.
// Failing this test means a future change re-bloated runDoctor (or another
// function in doctor.ts) past the limit.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

describe("doctor.ts cyclomatic complexity is bounded (rollup #82)", () => {
  it("runDoctor and helpers all stay at or below complexity 15", () => {
    const r = spawnSync(
      "npx",
      [
        "eslint",
        "--rule",
        '{"complexity":["error",15]}',
        "src/commands/doctor.ts",
      ],
      { cwd: REPO, encoding: "utf8" },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(r.status, `eslint complexity check failed:\n${out}`).toBe(0);
  }, 60_000);
});
