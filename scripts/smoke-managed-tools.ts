import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { installManagedTools } from "../src/lib/managed-tools.js";
import { cloudflaredVersion, resolveCloudflaredBin } from "../src/lib/cloudflared.js";
import { gitleaksVersion, resolveGitleaksBin } from "../src/lib/gitleaks.js";
import { resolveRipgrepBin, ripgrepVersion } from "../src/lib/ripgrep.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-managed-tools-smoke-"));
process.env.VEGASTACK_CONFIG_DIR = path.join(tmp, "config");

try {
  const installed = await installManagedTools({ force: true });
  const rg = resolveRipgrepBin();
  const gitleaks = resolveGitleaksBin();
  const cloudflared = resolveCloudflaredBin();
  if (!rg || !gitleaks || !cloudflared)
    throw new Error("one or more managed tools did not install");

  const versions = {
    ripgrep: ripgrepVersion(rg),
    gitleaks: gitleaksVersion(gitleaks),
    cloudflared: cloudflaredVersion(cloudflared),
  };
  for (const [name, version] of Object.entries(versions)) {
    if (!version) throw new Error(`${name} did not execute`);
  }

  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repo });
  fs.writeFileSync(
    path.join(repo, "leak.env"),
    "GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwx\n",
  );
  const scan = spawnSync(gitleaks, ["dir", "--redact", "."], {
    cwd: repo,
    encoding: "utf8",
  });
  if ((scan.status ?? 0) === 0) {
    throw new Error("Gitleaks smoke secret was not detected");
  }

  process.stdout.write(`${JSON.stringify({ ok: true, installed, versions }, null, 2)}\n`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
