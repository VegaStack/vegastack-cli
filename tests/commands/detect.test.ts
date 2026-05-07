// Smoke coverage for `vegastack detect`.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { runDetect } from "../../src/commands/detect.js";
import { withTmpDir } from "../setup.js";

describe("vegastack detect (smoke)", () => {
  it("runs in --json mode without crashing on an empty repo", async () => {
    await withTmpDir(async (dir) => {
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        const code = await runDetect({ json: true });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });

  it("runs in non-json mode and prints a project summary", async () => {
    await withTmpDir(async (dir) => {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "smoke", version: "0.0.0" }),
      );
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        const code = await runDetect({ json: false });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });
});
