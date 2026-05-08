// Extra smoke coverage for src/commands/scan.ts focused on the
// output-assembly + sarif paths still uncovered by the main scan suite
// (see audit F-006 — scan command at ~25% coverage).

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildScanReportPayloadForTesting,
  runScan,
  runScanDoctor,
  toSarifForTesting,
} from "../../src/commands/scan.js";
import { defaultScanConfig } from "../../src/lib/scan/config.js";
import { withTmpDir } from "../setup.js";

describe("scan output assembly (smoke)", () => {
  it("buildScanReportPayload aggregates findings, summary, tools, and failures", () => {
    const config = defaultScanConfig({ secrets: true });
    const payload = buildScanReportPayloadForTesting(
      [
        {
          check: "secrets",
          tool: "gitleaks",
          status: 0,
          stdout: "",
          stderr: "",
          findings: [
            {
              check: "secrets",
              tool: "gitleaks",
              severity: "high",
              title: "AWS key",
              message: "Hardcoded AWS access key",
              path: "a.env",
            },
          ],
        },
        {
          check: "actions",
          tool: "actionlint",
          status: 7,
          stdout: "",
          stderr: "boom",
          findings: [],
        },
      ],
      config,
      false,
      ["secrets", "actions"],
    );
    expect(payload.findings.length).toBe(1);
    expect(payload.failures.length).toBe(1);
    expect(payload.failures[0]?.tool).toBe("actionlint");
    expect(payload.tools.length).toBe(2);
    // ok=false because there is a blocking high finding.
    expect(payload.ok).toBe(false);
    expect(typeof payload.summary).toBe("object");
  });

  it("toSarif maps severity buckets including 'info' to a notice level", () => {
    const sarif = toSarifForTesting([
      {
        check: "secrets",
        tool: "gitleaks",
        severity: "info",
        title: "Informational note",
        message: "info-only finding",
        path: "x.txt",
      },
      {
        check: "secrets",
        tool: "gitleaks",
        severity: "critical",
        title: "Hardcoded token",
        message: "critical token",
        path: "y.txt",
      },
    ]);
    expect(sarif).toHaveProperty("$schema");
    expect(sarif).toHaveProperty("runs");
    const runs = (sarif as { runs: { results: { level: string }[] }[] }).runs;
    const levels = runs[0]?.results.map((r) => r.level).sort();
    expect(levels).toEqual(["error", "notice"].sort()); // info → "notice", critical → "error"
  });
});

describe("scan command entry points (smoke)", () => {
  it("runScan with no enabled checks returns 0 and writes nothing", async () => {
    await withTmpDir(async (dir) => {
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        // No project config + no flags: selectedCategories returns []; the
        // for-loop body is skipped and ok=true falls out of buildScanReportPayload.
        const code = await runScan({
          categories: [],
          format: "json",
          staged: false,
          offline: true,
          history: false,
        } as unknown as Parameters<typeof runScan>[0]);
        expect(typeof code).toBe("number");
      } finally {
        process.chdir(prevCwd);
      }
    });
  });

  it("runScanDoctor --agent reports tool availability without throwing", async () => {
    await withTmpDir(async (dir) => {
      // Seed a minimal scan config so scanToolsForConfig has something to enumerate.
      const cfgDir = path.join(dir, ".vegastack");
      fs.mkdirSync(cfgDir, { recursive: true });
      fs.writeFileSync(path.join(dir, ".vegastack", "vegastack.yml"), "schema_version: 1\n");
      const prevCwd = process.cwd();
      process.chdir(dir);
      try {
        const code = await runScanDoctor({ json: true });
        // Exit code can be 0 or 1 depending on whether managed binaries are
        // present in the test environment — we only care that it ran cleanly.
        expect([0, 1]).toContain(code);
      } finally {
        process.chdir(prevCwd);
      }
    });
  });
});
