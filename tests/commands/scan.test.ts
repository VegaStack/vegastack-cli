import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  installScanPreCommitHook,
  buildScanReportPayloadForTesting,
  removeScanPreCommitHook,
  runScanEnable,
  scanToolsForConfigForTesting,
  selectScanCategoriesForTesting,
  toSarifForTesting,
} from "../../src/commands/scan.js";
import { defaultScanConfig, readProjectScanConfig } from "../../src/lib/scan/config.js";
import { detectScanChecks } from "../../src/lib/scan/detect.js";
import { projectConfigPath } from "../../src/lib/paths.js";
import { writeProjectConfig } from "../../src/lib/project-config.js";
import { withTmpDir } from "../setup.js";

describe("scan config and detection", () => {
  it("detects scan areas from common repo files", async () => {
    await withTmpDir(async (dir) => {
      fs.mkdirSync(path.join(dir, ".git"));
      fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
      fs.writeFileSync(path.join(dir, "package-lock.json"), "{}\n");
      fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM alpine\n");
      fs.mkdirSync(path.join(dir, "k8s"));

      const detection = detectScanChecks(dir);
      expect(detection.checks.secrets).toBe(true);
      expect(detection.checks.actions).toBe(true);
      expect(detection.checks.dependencies).toBe(true);
      expect(detection.checks.containers).toBe(true);
      expect(detection.checks.kubernetes).toBe(true);
      expect(detection.checks.iac).toBe(true);
    });
  });

  it("stores consolidated scan metadata in vegastack.yml", async () => {
    await withTmpDir(async (dir) => {
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        const status = await runScanEnable({
          install: false,
          force: false,
          hook: false,
          json: false,
        });
        expect(status).toBe(0);
        expect(fs.existsSync(projectConfigPath(dir))).toBe(true);
        expect(fs.existsSync(path.join(dir, ".vegastack", "security.json"))).toBe(false);
        expect(fs.existsSync(path.join(dir, ".vegastack", "project.json"))).toBe(false);
        expect(fs.existsSync(path.join(dir, ".gitleaks.toml"))).toBe(false);
        const config = readProjectScanConfig(dir);
        expect(config.tools.gitleaks?.repo).toBe("https://github.com/gitleaks/gitleaks");
        expect(config.tools.trivy?.license).toBe("Apache-2.0");
      } finally {
        process.chdir(cwd);
      }
    });
  });

  it("installs and removes a VegaStack pre-commit hook block", async () => {
    await withTmpDir(async (dir) => {
      fs.mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
      expect(installScanPreCommitHook(dir, false)).toBe(true);
      const hook = fs.readFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "utf8");
      expect(hook).toContain("vegastack scan --staged");
      expect(removeScanPreCommitHook(dir)).toBe(true);
      expect(fs.readFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "utf8")).not.toContain(
        "vegastack scan --staged",
      );
    });
  });

  it("respects a repository core.hooksPath when installing hooks", async () => {
    await withTmpDir(async (dir) => {
      spawnSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      spawnSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: dir, stdio: "ignore" });

      expect(installScanPreCommitHook(dir, false)).toBe(true);
      expect(fs.existsSync(path.join(dir, ".githooks", "pre-commit"))).toBe(true);
      expect(fs.existsSync(path.join(dir, ".git", "hooks", "pre-commit"))).toBe(false);
      expect(removeScanPreCommitHook(dir)).toBe(true);
      expect(fs.readFileSync(path.join(dir, ".githooks", "pre-commit"), "utf8")).not.toContain(
        "vegastack scan --staged",
      );
    });
  });

  it("deep merges partial scan config without dropping defaults", async () => {
    await withTmpDir(async (dir) => {
      writeProjectConfig(dir, {
        schema_version: 1,
        scan: {
          offline: true,
          checks: {
            actions: { enabled: false },
            dependencies: { engines: ["osv-scanner"] },
          },
          tools: {
            trivy: {
              native_config_path: "config/trivy.yaml",
              extra_args: ["--ignore-unfixed"],
            },
            zizmor: { ignore_native_config: true },
          },
        },
      });

      const config = readProjectScanConfig(dir);
      expect(config.offline).toBe(true);
      expect(config.checks.actions.enabled).toBe(false);
      expect(config.checks.actions.engines).toEqual(["actionlint", "zizmor"]);
      expect(config.checks.dependencies.enabled).toBe(false);
      expect(config.checks.dependencies.engines).toEqual(["osv-scanner"]);
      expect(config.tools.trivy?.license).toBe("Apache-2.0");
      expect(config.tools.trivy?.native_config_path).toBe("config/trivy.yaml");
      expect(config.tools.trivy?.extra_args).toEqual(["--ignore-unfixed"]);
      expect(config.tools.zizmor?.ignore_native_config).toBe(true);
    });
  });

  it("uses the configured fast staged checks instead of every enabled scan", () => {
    const config = defaultScanConfig({
      secrets: true,
      actions: true,
      dependencies: true,
      containers: true,
      iac: true,
      kubernetes: true,
    });
    config.pre_commit.enabled = true;
    config.pre_commit.mode = "fast-staged";
    config.pre_commit.checks = ["secrets", "actions"];

    expect(selectScanCategoriesForTesting([], config, { staged: true })).toEqual([
      "secrets",
      "actions",
    ]);
    expect(selectScanCategoriesForTesting(["dependencies"], config, { staged: true })).toEqual([
      "dependencies",
    ]);
  });

  it("does not run default scans when project scan is disabled", () => {
    const config = defaultScanConfig({ secrets: true });
    config.enabled = false;
    expect(selectScanCategoriesForTesting([], config, { staged: false })).toEqual([]);
    expect(selectScanCategoriesForTesting(["secrets"], config, { staged: false })).toEqual([
      "secrets",
    ]);
    expect(scanToolsForConfigForTesting(config)).toEqual([]);
  });

  it("renders a SARIF envelope for scanner findings", () => {
    const sarif = toSarifForTesting([
      {
        check: "secrets",
        tool: "gitleaks",
        severity: "high",
        title: "Generic API key",
        message: "redacted",
        path: "leak.env",
        line: 1,
        rule_id: "generic-api-key",
      },
    ]) as { version?: string; runs?: unknown[] };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs?.length).toBe(1);
    expect(JSON.stringify(sarif)).toContain("generic-api-key");
  });

  it("keeps the JSON scan report contract stable and redacted", () => {
    const config = defaultScanConfig({ secrets: true });
    const payload = buildScanReportPayloadForTesting(
      [
        {
          check: "secrets",
          tool: "gitleaks",
          status: 1,
          stdout: '[{"Secret":"ghp_rawsecret","File":"leak.env"}]',
          stderr: "",
          findings: [
            {
              check: "secrets",
              tool: "gitleaks",
              severity: "high",
              title: "Generic API key",
              message: "Gitleaks detected a potential secret. The matched value is redacted.",
              path: "leak.env",
              line: 1,
              rule_id: "generic-api-key",
            },
          ],
        },
      ],
      config,
      false,
      ["secrets"],
    );

    expect(payload.ok).toBe(false);
    expect(payload.selected).toEqual(["secrets"]);
    expect(payload.summary).toMatchObject({ findings: 1, tool_failures: 0, high: 1 });
    expect(payload.findings[0]).toMatchObject({
      check: "secrets",
      tool: "gitleaks",
      path: "leak.env",
      rule_id: "generic-api-key",
    });
    expect(payload.tools).toEqual([{ check: "secrets", tool: "gitleaks", status: 1 }]);
    expect(payload.failures).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("ghp_rawsecret");
  });

  it("only requires tools for enabled checks and configured engines", () => {
    const config = defaultScanConfig({ secrets: true, actions: true, dependencies: true });
    config.checks.actions.engines = ["actionlint"];
    config.checks.dependencies.engines = ["osv-scanner"];

    expect(scanToolsForConfigForTesting(config).sort()).toEqual([
      "actionlint",
      "gitleaks",
      "osv-scanner",
    ]);
  });

  it("rejects --output paths that escape the user's allowed roots (#70)", async () => {
    // Why: `vegastack scan --output /etc/passwd` (or `--output ../escape.json`
    // forwarded by a CI caller) used to write the SARIF/JSON payload anywhere
    // on disk with no containment check. Arbitrary file overwrite.
    const { validateScanOutputPathForTesting } = await import("../../src/commands/scan.js");
    await withTmpDir(async (tmp) => {
      // Within cwd: accepted, returns absolute path
      expect(validateScanOutputPathForTesting("./report.json", tmp)).toMatch(/report\.json$/);
      expect(validateScanOutputPathForTesting("report.json", tmp)).toMatch(/report\.json$/);
      // Escaping cwd to a path outside home + tmp + cwd: rejected
      expect(() => validateScanOutputPathForTesting("/etc/passwd", tmp)).toThrow(
        /outside the allowed roots|ValidationError/,
      );
    });
  });
});
