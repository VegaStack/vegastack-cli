// Smoke coverage for `vegastack refresh` (dry-run only — apply path
// touches the project state writer which is exercised in project-state.test).

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { runRefresh } from "../../src/commands/refresh.js";
import { withTmpDir } from "../setup.js";

describe("vegastack refresh (smoke)", () => {
  it("runs --dry-run --json without crashing", async () => {
    await withTmpDir(async (dir) => {
      // Seed a minimal project so detection has something to compare against.
      fs.mkdirSync(path.join(dir, ".vegastack"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".vegastack", "vegastack.yml"),
        "schema_version: 1\nproject: smoke\n",
      );
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        const code = await runRefresh({ dryRun: true, yes: true, json: true });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });

  it("runs --dry-run in non-json mode", async () => {
    await withTmpDir(async (dir) => {
      fs.mkdirSync(path.join(dir, ".vegastack"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".vegastack", "vegastack.yml"),
        "schema_version: 1\nproject: smoke\n",
      );
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        const code = await runRefresh({ dryRun: true, yes: true, json: false });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });
});
