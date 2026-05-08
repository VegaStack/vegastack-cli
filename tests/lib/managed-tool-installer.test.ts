import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installManagedTool,
  managedToolVersion,
  readManagedToolMetadata,
  resolveManagedToolBin,
  type ManagedToolInstall,
} from "../../src/lib/managed-tool-installer.js";
import {
  MANAGED_TOOLS_MANIFEST,
  managedToolTarget,
  type ManagedToolTarget,
} from "../../src/lib/managed-tools-manifest.js";
import { _clearTrustedRootCacheForTests, managedToolMetadataPath } from "../../src/lib/paths.js";
import { resolveRipgrepBin } from "../../src/lib/ripgrep.js";
import { withTmpDir } from "../setup.js";

const ORIGINAL_PATH = process.env.PATH;

describe("managed tool installer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VEGASTACK_CONFIG_DIR;
    delete process.env.VEGASTACK_TOOLS_DIR;
    delete process.env.VEGASTACK_TEST_BIN;
    delete process.env.VEGASTACK_RG_BIN;
    delete process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS;
    process.env.PATH = ORIGINAL_PATH;
    _clearTrustedRootCacheForTests();
  });

  it("installs a binary asset with verified sha metadata and reuses it on the next call", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();

      const tool = MANAGED_TOOLS_MANIFEST.tools["osv-scanner"];
      const originalVersion = tool.version;
      const target = managedToolTarget("osv-scanner");
      if (!target || target.archive !== "binary") throw new Error("osv-scanner target unavailable");
      const originalTarget = { ...target };

      const body = Buffer.from("#!/usr/bin/env sh\necho osv-scanner test\n");
      const sha = sha256(body);
      tool.version = "v0.0.0-test";
      Object.assign(target, {
        asset: "osv-scanner-test",
        archive: "binary",
        sha256: sha,
      } satisfies Partial<ManagedToolTarget>);

      let fetches = 0;
      vi.stubGlobal("fetch", async () => {
        fetches += 1;
        return new Response(body, { status: 200 });
      });

      try {
        const installed = await installManagedTool("osv-scanner");
        expect(installed.version).toBe("v0.0.0-test");
        expect(installed.asset_sha256).toBe(sha);
        expect(installed.bin_sha256).toBe(sha);
        expect(fs.readFileSync(installed.bin)).toEqual(body);
        expect(readManagedToolMetadata("osv-scanner")).toMatchObject({
          name: "osv-scanner",
          version: "v0.0.0-test",
          asset: "osv-scanner-test",
        });

        const reused = await installManagedTool("osv-scanner");
        expect(reused).toEqual(installed);
        expect(fetches).toBe(1);
      } finally {
        tool.version = originalVersion;
        Object.assign(target, originalTarget);
      }
    });
  });

  it("resolves override, verified metadata, and PATH fallback in that order", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();

      const override = writeExecutable(path.join(dir, "override-tool"), "override\n");
      process.env.VEGASTACK_TEST_BIN = override;
      expect(resolveManagedToolBin("actionlint", "VEGASTACK_TEST_BIN", "actionlint")).toBe(
        override,
      );

      delete process.env.VEGASTACK_TEST_BIN;
      const target = managedToolTarget("actionlint");
      expect(target).not.toBeNull();
      const bin = writeExecutable(path.join(dir, "managed-actionlint"), "managed\n");
      writeManagedMetadata("actionlint", {
        name: "actionlint",
        version: MANAGED_TOOLS_MANIFEST.tools.actionlint.version,
        bin,
        asset: target!.asset,
        asset_sha256: target!.sha256,
        bin_sha256: sha256(fs.readFileSync(bin)),
        sha256: target!.sha256,
        installed_at: "2026-05-08T00:00:00.000Z",
        source: "https://example.test/actionlint",
      });
      expect(resolveManagedToolBin("actionlint", "VEGASTACK_TEST_BIN", "actionlint")).toBe(bin);

      fs.writeFileSync(bin, "tampered\n");
      const pathBin = writeExecutable(path.join(dir, "path-bin", "actionlint"), "path\n");
      process.env.PATH = `${path.dirname(pathBin)}${path.delimiter}${process.env.PATH ?? ""}`;
      expect(resolveManagedToolBin("actionlint", "VEGASTACK_TEST_BIN", "actionlint")).toBe(pathBin);
    });
  });

  it("ignores invalid metadata shapes and reports nonzero version commands as unavailable", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();

      fs.mkdirSync(path.dirname(managedToolMetadataPath("trivy")), { recursive: true });
      fs.writeFileSync(managedToolMetadataPath("trivy"), '{"name":"wrong","bin":42}\n');
      expect(readManagedToolMetadata("trivy")).toBeNull();

      const failing = writeExecutable(path.join(dir, "fails"), "#!/usr/bin/env sh\nexit 7\n");
      expect(managedToolVersion(failing)).toBeNull();
    });
  });
});

describe("ripgrep resolver", () => {
  afterEach(() => {
    delete process.env.VEGASTACK_CONFIG_DIR;
    delete process.env.VEGASTACK_RG_BIN;
    delete process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS;
    process.env.PATH = ORIGINAL_PATH;
    _clearTrustedRootCacheForTests();
  });

  it("does not trust PATH ripgrep unless explicitly allowed", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();
      const rg = writeExecutable(
        path.join(dir, "bin", process.platform === "win32" ? "rg.exe" : "rg"),
        "rg\n",
      );
      process.env.PATH = `${path.dirname(rg)}${path.delimiter}${process.env.PATH ?? ""}`;

      expect(resolveRipgrepBin()).toBeNull();
      process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS = "1";
      expect(resolveRipgrepBin()).toBe(rg);
    });
  });
});

function writeManagedMetadata(name: string, metadata: ManagedToolInstall): void {
  fs.mkdirSync(path.dirname(managedToolMetadataPath(name)), { recursive: true });
  fs.writeFileSync(managedToolMetadataPath(name), `${JSON.stringify(metadata, null, 2)}\n`);
}

function writeExecutable(file: string, contents: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
  return file;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
