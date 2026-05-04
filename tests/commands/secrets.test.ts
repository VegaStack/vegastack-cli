import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  enableProjectSecretScanning,
  gitleaksToml,
  secretScanningWorkflow,
} from "../../src/commands/secrets.js";
import { withTmpDir } from "../setup.js";

describe("secrets command templates", () => {
  it("extends the default Gitleaks rule set", () => {
    expect(gitleaksToml()).toContain("[extend]");
    expect(gitleaksToml()).toContain("useDefault = true");
    expect(gitleaksToml()).toContain("https://github.com/gitleaks/gitleaks");
  });

  it("generates a GitHub Actions workflow that scans full history", () => {
    const workflow = secretScanningWorkflow();
    expect(workflow).toContain("gitleaks/gitleaks-action@v2");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("GITHUB_TOKEN");
    expect(workflow).toContain("https://github.com/gitleaks/gitleaks");
  });

  it("stores secret scanning metadata in project.json instead of a separate security file", async () => {
    await withTmpDir(async (dir) => {
      const result = await enableProjectSecretScanning(dir, {
        install: false,
        force: false,
        noCi: false,
        hook: false,
      });

      expect(result.written).toContain(".vegastack/project.json");
      expect(fs.existsSync(path.join(dir, ".vegastack", "security.json"))).toBe(false);
      const project = JSON.parse(
        fs.readFileSync(path.join(dir, ".vegastack", "project.json"), "utf8"),
      ) as { security?: { secret_scanning?: { engine_url?: string } } };
      expect(project.security?.secret_scanning?.engine_url).toBe(
        "https://github.com/gitleaks/gitleaks",
      );
    });
  });
});
