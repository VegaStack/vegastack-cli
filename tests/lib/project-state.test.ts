import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autoRefreshProjectState,
  buildProjectRefreshPlan,
  writeProjectRefreshPlan,
} from "../../src/lib/project-state.js";
import { projectConfigPath, projectDetectionCachePath } from "../../src/lib/paths.js";
import { readProjectConfig, writeProjectConfig } from "../../src/lib/project-config.js";
import { withTmpDir } from "../setup.js";

const oldEnv = { ...process.env };

afterEach(() => {
  process.env = { ...oldEnv };
});

describe("project config refresh", () => {
  it("caches current detection without mutating committed vegastack.yml", async () => {
    await withTmpDir((dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home", ".vegastack");
      writeProjectConfig(dir, { schema_version: 1, registry: { entries: {} } });
      const before = fs.readFileSync(projectConfigPath(dir), "utf8");
      fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:22-alpine\n");

      const plan = autoRefreshProjectState(dir, { quiet: true });

      expect(plan?.changed).toBe(true);
      expect(fs.readFileSync(projectConfigPath(dir), "utf8")).toBe(before);
      expect(fs.existsSync(projectDetectionCachePath(dir))).toBe(true);
    });
  });

  it("does not create project config before init", async () => {
    await withTmpDir((dir) => {
      fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:22-alpine\n");

      const plan = autoRefreshProjectState(dir, { quiet: true });

      expect(plan).toBeUndefined();
      expect(fs.existsSync(projectConfigPath(dir))).toBe(false);
    });
  });

  it("recovers from stale auto-refresh locks", async () => {
    await withTmpDir((dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home", ".vegastack");
      writeProjectConfig(dir, { schema_version: 1, registry: { entries: {} } });
      const lock = `${projectDetectionCachePath(dir)}.lock`;
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      fs.writeFileSync(lock, "");
      const stale = new Date(Date.now() - 60_000);
      fs.utimesSync(lock, stale, stale);
      fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:22-alpine\n");

      const plan = autoRefreshProjectState(dir, { quiet: true });

      expect(plan?.changed).toBe(true);
      expect(fs.existsSync(lock)).toBe(false);
    });
  });

  it("refresh plan writes shared config only when explicitly applied", async () => {
    await withTmpDir((dir) => {
      writeProjectConfig(dir, { schema_version: 1, registry: { entries: {} } });
      fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:22-alpine\n");

      const plan = buildProjectRefreshPlan(dir);
      writeProjectRefreshPlan(plan);

      expect(plan.cwd).toBe(dir);
      expect(readProjectConfig(dir).registry?.recommended_entries).toContain("docker");
    });
  });

  it("does not mark refresh changed for empty detected command metadata", async () => {
    await withTmpDir((dir) => {
      writeProjectConfig(dir, {
        schema_version: 1,
        registry: { entries: { docker: {} }, recommended_entries: ["docker"] },
      });
      fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:22-alpine\n");

      const plan = buildProjectRefreshPlan(dir);

      expect(plan.changed).toBe(false);
      expect(plan.next.project).toBeUndefined();
    });
  });
});
