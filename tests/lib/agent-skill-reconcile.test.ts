// Smoke coverage for src/lib/agent-skill-reconcile.ts.
//
// Exercises inspect/reconcile against an empty environment (no agent hosts
// detected) and the two printers. The deeper "host installed" branches
// belong with each renderer's own test suite.

import { describe, expect, it } from "vitest";
import {
  inspectDetectedAgentSkills,
  printAgentSkillInspection,
  printAgentSkillReconcile,
  reconcileDetectedAgentSkills,
} from "../../src/lib/agent-skill-reconcile.js";
import { withTmpDir } from "../setup.js";

describe("agent-skill-reconcile (smoke)", () => {
  // Note: we do NOT mutate process.env.HOME here. paths.ts caches HOME at
  // module-load time (via os.homedir()), so changing the env later is a
  // foot-gun that races with other suites whose tests rely on HOME being a
  // sandbox they own (e.g. tests/agents/codex.test.ts).
  it("inspectDetectedAgentSkills returns a populated shape on a fresh cwd", async () => {
    await withTmpDir(async (dir) => {
      const result = await inspectDetectedAgentSkills({ cwd: dir, scope: "project" });
      expect(result.scope).toBe("project");
      expect(result.cwd).toBe(dir);
      expect(Array.isArray(result.detected)).toBe(true);
      expect(Array.isArray(result.missing)).toBe(true);
      expect(Array.isArray(result.skipped)).toBe(true);
    });
  });

  it("reconcileDetectedAgentSkills returns an installed array (smoke)", async () => {
    await withTmpDir(async (dir) => {
      const result = await reconcileDetectedAgentSkills({
        cwd: dir,
        scope: "project",
        dryRun: true,
      });
      expect(Array.isArray(result.installed)).toBe(true);
    });
  });

  it("print helpers do not throw on an empty inspection", () => {
    const empty = {
      scope: "project" as const,
      cwd: "/tmp",
      detected: [],
      missing: [],
      skipped: [],
    };
    expect(() => printAgentSkillInspection(empty)).not.toThrow();
    expect(() => printAgentSkillReconcile({ ...empty, installed: [] })).not.toThrow();
  });
});
