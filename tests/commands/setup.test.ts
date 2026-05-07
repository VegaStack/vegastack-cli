import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSetup } from "../../src/commands/setup.js";
import { globalConfigPath, sharedInstructionsDir } from "../../src/lib/paths.js";
import { withTmpDir } from "../setup.js";

vi.mock("../../src/lib/managed-tools.js", () => ({
  installManagedTools: vi.fn(async () => [{ name: "ripgrep", status: "mocked" }]),
}));

vi.mock("../../src/lib/agent-skill-reconcile.js", () => ({
  reconcileDetectedAgentSkills: vi.fn(async () => []),
}));

vi.mock("../../src/lib/host-detect.js", () => ({
  binaryOnPath: vi.fn(() => false),
}));

const oldEnv = { ...process.env };

afterEach(() => {
  process.env = { ...oldEnv };
  vi.clearAllMocks();
});

describe("setup command", () => {
  it("creates global config roots and shared instructions used by project pointers", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, ".vegastack");

      const code = await runSetup({ dryRun: false, yes: true, json: true });

      expect(code).toBe(0);
      expect(fs.existsSync(globalConfigPath())).toBe(true);
      expect(fs.readFileSync(path.join(sharedInstructionsDir(), "AGENTS.md"), "utf8")).toContain(
        ".vegastack/vegastack.yml",
      );
      expect(fs.readFileSync(path.join(sharedInstructionsDir(), "CLAUDE.md"), "utf8")).toContain(
        'vegastack ask "<user request>"',
      );
    });
  });
});
