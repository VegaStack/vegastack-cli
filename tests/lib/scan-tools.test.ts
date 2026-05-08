import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executableExists,
  ensureScanTool,
  resolveScanToolBin,
  runTool,
  scanToolVersion,
} from "../../src/lib/scan-tools.js";
import { _clearTrustedRootCacheForTests } from "../../src/lib/paths.js";
import { withTmpDir } from "../setup.js";

describe("scan tools", () => {
  afterEach(() => {
    delete process.env.VEGASTACK_CONFIG_DIR;
    delete process.env.VEGASTACK_ACTIONLINT_BIN;
    _clearTrustedRootCacheForTests();
  });

  it("resolves scanner overrides and checks executable presence", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();
      const bin = writeExecutable(path.join(dir, "actionlint"), "#!/usr/bin/env sh\necho ok\n");
      process.env.VEGASTACK_ACTIONLINT_BIN = bin;

      expect(resolveScanToolBin("actionlint")).toBe(bin);
      expect(executableExists(bin)).toBe(true);
      expect(executableExists(path.join(dir, "missing"))).toBe(false);
    });
  });

  it("turns vanished binaries into status 127 instead of a generic failure", async () => {
    await withTmpDir(async (dir) => {
      const missing = path.join(dir, "missing-tool");
      const result = runTool(missing, ["--version"], { cwd: dir });

      expect(result.status).toBe(127);
      expect(result.stderr).toContain("not found");
      expect(result.stdout).toBe("");
    });
  });

  it("throws a clear error when installation is disabled and a scanner is missing", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_CONFIG_DIR = path.join(dir, "home");
      _clearTrustedRootCacheForTests();

      await expect(ensureScanTool("zizmor", { installTools: false })).rejects.toThrow(
        "zizmor is not installed",
      );
    });
  });

  it("uses scanner-specific version arguments", async () => {
    await withTmpDir(async (dir) => {
      const bin = writeExecutable(
        path.join(dir, "version-tool"),
        "#!/usr/bin/env sh\nprintf '%s\\n' \"$1\"\n",
      );

      expect(scanToolVersion("gitleaks", bin)).toBe("version");
      expect(scanToolVersion("actionlint", bin)).toBe("--version");
    });
  });
});

function writeExecutable(file: string, contents: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  if (process.platform !== "win32") fs.chmodSync(file, 0o755);
  return file;
}
