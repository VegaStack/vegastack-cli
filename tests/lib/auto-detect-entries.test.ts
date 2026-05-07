import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProjectEntriesWithDetection } from "../../src/lib/auto-detect-entries.js";
import { writeProjectConfig } from "../../src/lib/project-config.js";
import { projectDetectionCachePath } from "../../src/lib/paths.js";
import { withTmpDir } from "../setup.js";

const oldEnv = { ...process.env };

afterEach(() => {
  process.env = { ...oldEnv };
});

describe("resolveProjectEntriesWithDetection", () => {
  it("adds only installed detected entries and reports stale project detection", async () => {
    await withTmpDir((dir) => {
      const registryDir = path.join(dir, "registry");
      process.env.VEGASTACK_REGISTRY_DIR = registryDir;
      fs.mkdirSync(path.join(registryDir, "docker"), { recursive: true });
      fs.writeFileSync(
        path.join(registryDir, "docker", "MANIFEST.json"),
        JSON.stringify({ schema_version: 2, id: "docker", docs_root: "docs" }),
      );

      writeProjectConfig(dir, { schema_version: 1, registry: { entries: { terraform: {} } } });
      fs.mkdirSync(path.dirname(projectDetectionCachePath(dir)), { recursive: true });
      fs.writeFileSync(
        projectDetectionCachePath(dir),
        JSON.stringify({ detection: { fingerprint: "previous" } }),
      );
      fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:22-alpine\n");
      fs.writeFileSync(path.join(dir, ".gitlab-ci.yml"), "test:\n  script: echo ok\n");

      let stderr = "";
      const writeSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation((chunk: string | Uint8Array) => {
          stderr += String(chunk);
          return true;
        });
      try {
        expect(resolveProjectEntriesWithDetection(dir)).toEqual(["docker", "terraform"]);
      } finally {
        writeSpy.mockRestore();
      }

      expect(stderr).toContain("auto-detected supplemental registry entries: docker");
      expect(stderr).toContain("detected additional registry entries not installed: gitlab-ci");
      expect(stderr).toContain("project detection changed since last refresh");
    });
  });
});
