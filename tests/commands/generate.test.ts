// Smoke coverage for `vegastack generate`.

import { describe, expect, it } from "vitest";
import { runGenerate } from "../../src/commands/generate.js";
import { withTmpDir } from "../setup.js";

describe("vegastack generate (smoke)", () => {
  it("runs --json --dry-run for a github+vercel intent", async () => {
    await withTmpDir(async (dir) => {
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        const code = await runGenerate(["github", "actions", "vercel"], {
          dryRun: true,
          json: true,
        });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });

  it("falls back to a generic ops-file intent when input is empty", async () => {
    await withTmpDir(async (dir) => {
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        const code = await runGenerate([], { dryRun: false, json: true });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });

  it("emits a kubernetes contract for kubernetes intent", async () => {
    await withTmpDir(async (dir) => {
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        const code = await runGenerate(["kubernetes"], { dryRun: true, json: true });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });
});
