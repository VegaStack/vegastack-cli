// Smoke coverage for `vegastack generate`.

import { describe, expect, it } from "vitest";
import { runGenerate } from "../../src/commands/generate.js";
import { withTmpDir } from "../setup.js";

describe("vegastack generate (smoke)", () => {
  it("runs --agent --dry-run for a github+vercel intent", async () => {
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

  it("emits Agent Mode lookup-plan commands", async () => {
    await withTmpDir(async (dir) => {
      const prevCwd = process.cwd();
      const captured: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
        if (typeof chunk === "string" || chunk instanceof Uint8Array) {
          captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
          return true;
        }
        return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;
      process.chdir(dir);
      try {
        const code = await runGenerate(["kubernetes"], { dryRun: true, json: true });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
        process.stdout.write = origWrite;
      }
      const body = JSON.parse(captured.join("")) as { lookup_plan?: { command?: string }[] };
      expect(body.lookup_plan?.map((p) => p.command)).toEqual([
        'vegastack ask --agent --pack kubernetes "Deployment Service probes resources env secrets"',
      ]);
    });
  });
});
