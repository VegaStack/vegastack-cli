import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  gitleaksVersion,
  readGitleaksMetadata,
  resolveGitleaksBin,
  type GitleaksInstall,
} from "../../src/lib/gitleaks.js";
import { MANAGED_TOOLS_MANIFEST, managedToolTarget } from "../../src/lib/managed-tools-manifest.js";
import { _clearTrustedRootCacheForTests, gitleaksMetadataPath } from "../../src/lib/paths.js";
import { withTmpDir } from "../setup.js";

const ORIGINAL_PATH = process.env.PATH;

describe("gitleaks resolver", () => {
  afterEach(() => {
    delete process.env.VEGASTACK_CONFIG_DIR;
    delete process.env.VEGASTACK_GITLEAKS_BIN;
    delete process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS;
    process.env.PATH = ORIGINAL_PATH;
    _clearTrustedRootCacheForTests();
  });

  it("prefers explicit overrides when the path exists", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();
      const override = writeExecutable(path.join(dir, "gitleaks-override"), "override\n");

      process.env.VEGASTACK_GITLEAKS_BIN = override;

      expect(resolveGitleaksBin()).toBe(override);
    });
  });

  it("resolves verified managed metadata and rejects tampered binaries", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();
      const target = managedToolTarget("gitleaks");
      expect(target).not.toBeNull();
      const bin = writeExecutable(path.join(dir, "managed-gitleaks"), "gitleaks\n");
      writeMetadata({
        version: MANAGED_TOOLS_MANIFEST.tools.gitleaks.version,
        bin,
        asset: target!.asset,
        asset_sha256: target!.sha256,
        bin_sha256: sha256(fs.readFileSync(bin)),
        sha256: target!.sha256,
        installed_at: "2026-05-08T00:00:00.000Z",
      });

      expect(resolveGitleaksBin()).toBe(bin);

      fs.writeFileSync(bin, "tampered\n");
      expect(resolveGitleaksBin()).toBeNull();
    });
  });

  it("only trusts PATH when the operator explicitly opts in", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();
      const pathBin = writeExecutable(
        path.join(dir, "bin", process.platform === "win32" ? "gitleaks.exe" : "gitleaks"),
        "path\n",
      );
      process.env.PATH = `${path.dirname(pathBin)}${path.delimiter}${process.env.PATH ?? ""}`;

      expect(resolveGitleaksBin()).toBeNull();
      process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS = "1";
      expect(resolveGitleaksBin()).toBe(pathBin);
    });
  });

  it("returns null for invalid metadata and failed version commands", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();
      fs.mkdirSync(path.dirname(gitleaksMetadataPath()), { recursive: true });
      fs.writeFileSync(gitleaksMetadataPath(), '{"version":1,"bin":false}\n');
      expect(readGitleaksMetadata()).toBeNull();

      const failing = writeExecutable(
        path.join(dir, "gitleaks-fails"),
        "#!/usr/bin/env sh\nexit 2\n",
      );
      expect(gitleaksVersion(failing)).toBeNull();
    });
  });
});

function writeMetadata(metadata: GitleaksInstall): void {
  fs.mkdirSync(path.dirname(gitleaksMetadataPath()), { recursive: true });
  fs.writeFileSync(gitleaksMetadataPath(), `${JSON.stringify(metadata, null, 2)}\n`);
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
