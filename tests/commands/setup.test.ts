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
  detectHost: vi.fn((name: string) => ({ name, installed: false, evidence: "missing" })),
}));

vi.mock("../../src/lib/registry.js", () => ({
  allInstalledRegistryEntryNames: vi.fn(() => []),
  allPublishedRegistryEntryNames: vi.fn(async () => ["docker", "github-actions"]),
  syncRegistryEntry: vi.fn(async () => undefined),
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
        'vegastack ask --agent "<user request>"',
      );
    });
  });

  // Defence-in-depth: the global config records the absolute config_root,
  // detected tools, and managed-tool versions. On a multi-user host these
  // shouldn't be world-readable. Apply 0o600 on POSIX; Windows ignores POSIX
  // bits so the assertion is gated.
  it.skipIf(process.platform === "win32")(
    "writes the global config with owner-only mode (0o600)",
    async () => {
      await withTmpDir(async (dir) => {
        process.env.VEGASTACK_CONFIG_DIR = path.join(dir, ".vegastack");
        const code = await runSetup({ dryRun: false, yes: true, json: true });
        expect(code).toBe(0);
        const stat = fs.statSync(globalConfigPath());
        // Mask off file-type bits, compare permission bits only.
        expect(stat.mode & 0o777).toBe(0o600);
      });
    },
  );

  it("can install every published Registry pack during setup", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, ".vegastack");
      const registry = await import("../../src/lib/registry.js");

      const code = await runSetup({
        dryRun: false,
        yes: true,
        json: true,
        downloadAllRegistry: true,
      });

      expect(code).toBe(0);
      expect(registry.syncRegistryEntry).toHaveBeenCalledWith("docker", {});
      expect(registry.syncRegistryEntry).toHaveBeenCalledWith("github-actions", {});
    });
  });

  it("prints non-interactive first-run guidance instead of mutating global setup", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, ".vegastack");
      const { runDefaultCommand } = await import("../../src/commands/setup.js");

      const code = await runDefaultCommand({ json: true });

      expect(code).toBe(0);
      expect(fs.existsSync(globalConfigPath())).toBe(false);
    });
  });

  it("returns Agent Mode next steps when first-run setup is incomplete", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, ".vegastack");
      const writes: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
        if (typeof chunk === "string" || chunk instanceof Uint8Array) {
          writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
          return true;
        }
        return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;
      try {
        const { runDefaultCommand } = await import("../../src/commands/setup.js");
        const code = await runDefaultCommand({ json: true });
        expect(code).toBe(0);
      } finally {
        process.stdout.write = origWrite;
      }

      const payload = JSON.parse(writes.join("")) as { next?: string[] };
      expect(payload.next).toEqual([
        "vegastack setup --yes --agent",
        "vegastack registry install --all --agent",
        "vegastack init --yes --agent",
      ]);
    });
  });
});
