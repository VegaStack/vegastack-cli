import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dumpProjectConfig,
  projectRegistryEntryNames,
  readProjectConfig,
  writeProjectConfig,
} from "../../src/lib/project-config.js";
import { projectConfigPath } from "../../src/lib/paths.js";
import { withTmpDir } from "../setup.js";

describe("project config", () => {
  it("round-trips committed vegastack.yml with registry, commands, and scan config", async () => {
    await withTmpDir((dir) => {
      writeProjectConfig(dir, {
        schema_version: 1,
        registry: {
          entries: {
            docker: { source: "https://github.com/docker/docs" },
            terraform: { version: "2026.01.01" },
          },
          recommended_entries: ["terraform", "docker"],
        },
        project: {
          package_manager: "pnpm",
          commands: { install: "pnpm install --frozen-lockfile", build: "pnpm run build" },
        },
        scan: { enabled: true, checks: { secrets: { enabled: true } } },
        agents: { shared_instructions: "~/.vegastack/instructions" },
      });

      const raw = fs.readFileSync(projectConfigPath(dir), "utf8");
      expect(raw.startsWith("schema_version: 1\n")).toBe(true);
      expect(raw).toContain("registry:");
      expect(raw).toContain("terraform:");
      expect(raw).not.toContain("{");

      const config = readProjectConfig(dir);
      expect(projectRegistryEntryNames(config)).toEqual(["docker", "terraform"]);
      expect(config.project?.commands?.build).toBe("pnpm run build");
      expect(config.scan?.enabled).toBe(true);
    });
  });

  it("normalizes unsupported values out of YAML config", () => {
    const text = dumpProjectConfig({
      schema_version: 1,
      registry: {
        entries: {
          docker: { source: "docker-docs", version: "1" },
        },
      },
      project: { commands: { test: "npm test" } },
    });

    expect(text).toContain("schema_version: 1");
    expect(text).toContain("test: npm test");
  });

  it("sorts Registry packs for deterministic committed diffs", () => {
    const text = dumpProjectConfig({
      schema_version: 1,
      registry: {
        entries: {
          terraform: {},
          docker: {},
        },
      },
    });

    expect(text.indexOf("docker:")).toBeLessThan(text.indexOf("terraform:"));
  });
});
