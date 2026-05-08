import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allInstalledRegistryEntryNames,
  assertRegistryEntriesInstalled,
  ensureProjectInitialized,
  isRegistryEntryInstalled,
  listRegistryEntryStatuses,
  readProjectRegistryEntryNames,
  readRegistryEntryVersion,
  registryEntryDefinition,
} from "../../src/lib/registry.js";
import {
  _clearTrustedRootCacheForTests,
  projectConfigPath,
  registryEntryDir,
} from "../../src/lib/paths.js";
import { writeProjectConfig } from "../../src/lib/project-config.js";
import { withTmpDir } from "../setup.js";

describe("registry state helpers", () => {
  afterEach(() => {
    delete process.env.VEGASTACK_CONFIG_DIR;
    delete process.env.VEGASTACK_REGISTRY_DIR;
    _clearTrustedRootCacheForTests();
  });

  it("requires a committed project config before reading selected packs", async () => {
    await withTmpDir((dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();

      expect(() => ensureProjectInitialized(dir)).toThrow(/not initialized/);
      writeProjectConfig(dir, {
        schema_version: 1,
        registry: { entries: { terraform: {}, docker: {} } },
      });

      expect(fs.existsSync(projectConfigPath(dir))).toBe(true);
      expect(readProjectRegistryEntryNames(dir)).toEqual(["docker", "terraform"]);
    });
  });

  it("checks Registry packs for both manifest and docs before use", async () => {
    await withTmpDir((dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();
      const docker = registryEntryDir("docker");
      fs.mkdirSync(docker, { recursive: true });
      fs.writeFileSync(path.join(docker, "MANIFEST.json"), '{"version":"2026.05.08"}\n');

      expect(isRegistryEntryInstalled("docker")).toBe(true);
      expect(readRegistryEntryVersion("docker", docker)).toBe("2026.05.08");
      expect(() => assertRegistryEntriesInstalled(["docker"])).toThrow(/does not contain docs/);

      fs.mkdirSync(path.join(docker, "docs"), { recursive: true });
      expect(() => assertRegistryEntriesInstalled(["docker"])).not.toThrow();
    });
  });

  it("lists selected, installed, and local-only Registry packs deterministically", async () => {
    await withTmpDir((dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();
      writeProjectConfig(dir, {
        schema_version: 1,
        registry: { entries: { docker: {}, "local-pack": {} } },
      });
      writeInstalledEntry("docker", {
        title: "Docker Docs",
        shape: "registry-entry",
        pack_version: "pack-1",
      });
      writeInstalledEntry("local-pack", {
        title: "Local Pack",
        shape: "registry-entry",
        source: { type: "local", path: "/tmp/local-pack" },
      });

      expect(allInstalledRegistryEntryNames()).toContain("local-pack");
      const statuses = listRegistryEntryStatuses(dir);
      const docker = statuses.find((status) => status.name === "docker");
      const local = statuses.find((status) => status.name === "local-pack");

      expect(docker).toMatchObject({
        name: "docker",
        installed: true,
        selected: true,
        version: "pack-1",
      });
      expect(local).toMatchObject({
        name: "local-pack",
        title: "Local Pack",
        installed: true,
        selected: true,
        source: "/tmp/local-pack",
      });
      expect(statuses.map((status) => status.name)).toEqual(
        [...statuses.map((status) => status.name)].sort(),
      );
    });
  });

  it("looks up published registry definitions by name", () => {
    expect(registryEntryDefinition("terraform")?.name).toBe("terraform");
    expect(registryEntryDefinition("missing-pack")).toBeUndefined();
  });
});

function writeInstalledEntry(name: string, manifest: Record<string, unknown>): void {
  const root = registryEntryDir(name);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
