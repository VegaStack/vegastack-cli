import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { installManagedTools } from "../src/lib/managed-tools.js";
import { cloudflaredVersion, resolveCloudflaredBin } from "../src/lib/cloudflared.js";
import { gitleaksVersion, resolveGitleaksBin } from "../src/lib/gitleaks.js";
import { resolveRipgrepBin, ripgrepVersion } from "../src/lib/ripgrep.js";
import { resolveScanToolBin, scanToolVersion } from "../src/lib/scan-tools.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-managed-tools-smoke-"));
// Save the original so the finally block restores it; otherwise running
// the smoke script in-process leaks a temp path into any caller that
// re-uses process.env after the script returns.
const previousConfigDir = process.env.VEGASTACK_CONFIG_DIR;
process.env.VEGASTACK_CONFIG_DIR = path.join(tmp, "config");

try {
  const installed = await installManagedTools({ force: true });
  const rg = resolveRipgrepBin();
  const gitleaks = resolveGitleaksBin();
  const cloudflared = resolveCloudflaredBin();
  const trivy = resolveScanToolBin("trivy");
  const osv = resolveScanToolBin("osv-scanner");
  const actionlint = resolveScanToolBin("actionlint");
  const zizmor = resolveScanToolBin("zizmor");
  if (!rg || !gitleaks || !cloudflared || !trivy || !osv || !actionlint || !zizmor)
    throw new Error("one or more managed tools did not install");

  const versions = {
    ripgrep: ripgrepVersion(rg),
    gitleaks: gitleaksVersion(gitleaks),
    cloudflared: cloudflaredVersion(cloudflared),
    trivy: scanToolVersion("trivy", trivy),
    "osv-scanner": scanToolVersion("osv-scanner", osv),
    actionlint: scanToolVersion("actionlint", actionlint),
    zizmor: scanToolVersion("zizmor", zizmor),
  };
  for (const [name, version] of Object.entries(versions)) {
    if (!version) throw new Error(`${name} did not execute`);
  }

  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const gitInit = spawnSync("git", ["init", "-q"], { cwd: repo });
  if (gitInit.error || (gitInit.status ?? 0) !== 0) {
    throw new Error(
      `git init failed: ${gitInit.error?.message ?? `exit ${gitInit.status ?? "?"}`}`,
    );
  }
  // Construct the synthetic fixture token at runtime so it never appears as a
  // single literal in source — gitleaks `generic-api-key` would otherwise hit
  // this file on every working-tree and full-history scan (audit secrets/F-001
  // in audit-1778150875). Entropy stays low enough not to trip the rule.
  const fakeTokenPrefix = "ghp_";
  const fakeTokenBody = "1234567890abcdef" + "ghijklmnopqrstuvwx";
  const fakeToken = fakeTokenPrefix + fakeTokenBody;
  fs.writeFileSync(path.join(repo, "leak.env"), `GITHUB_TOKEN=${fakeToken}\n`);
  const scan = spawnSync(gitleaks, ["dir", "--redact", "."], {
    cwd: repo,
    encoding: "utf8",
  });
  if ((scan.status ?? 0) === 0) {
    throw new Error("Gitleaks smoke secret was not detected");
  }

  fs.mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".github", "workflows", "bad.yml"),
    "on:\n  push:\n    branch: main\njobs:\n  test:\n    runs-on: linux-latest\n    steps:\n      - run: echo ${{ github.event.head_commit.message }}\n",
  );
  const actionlintRun = spawnSync(actionlint, [".github/workflows/bad.yml"], {
    cwd: repo,
    encoding: "utf8",
  });
  if ((actionlintRun.status ?? 0) === 0) {
    throw new Error("actionlint smoke workflow issue was not detected");
  }

  const zizmorRun = spawnSync(zizmor, ["--offline", "--format=json", ".github/workflows/bad.yml"], {
    cwd: repo,
    encoding: "utf8",
  });
  if ((zizmorRun.status ?? 0) !== 0 && !zizmorRun.stdout.trim().startsWith("[")) {
    throw new Error("zizmor smoke did not execute");
  }

  fs.writeFileSync(path.join(repo, "Dockerfile"), "FROM alpine\nUSER root\n");
  const trivyRun = spawnSync(
    trivy,
    ["config", "--format", "json", "--skip-check-update", "Dockerfile"],
    { cwd: repo, encoding: "utf8" },
  );
  if ((trivyRun.status ?? 0) !== 0 && !trivyRun.stdout.trim().startsWith("{")) {
    throw new Error("Trivy config smoke did not execute");
  }

  process.stdout.write(`${JSON.stringify({ ok: true, installed, versions }, null, 2)}\n`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (previousConfigDir === undefined) {
    delete process.env.VEGASTACK_CONFIG_DIR;
  } else {
    process.env.VEGASTACK_CONFIG_DIR = previousConfigDir;
  }
}
