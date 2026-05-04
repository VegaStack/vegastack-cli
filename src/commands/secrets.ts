import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  installGitleaks,
  readGitleaksMetadata,
  resolveGitleaksBin,
  gitleaksVersion,
} from "../lib/gitleaks.js";
import { log, printError } from "../lib/log.js";
import { projectManifestPath } from "../lib/paths.js";

const GITLEAKS_REPO_URL = "https://github.com/gitleaks/gitleaks";

export interface SecretsEnableOptions {
  install: boolean;
  force: boolean;
  noCi: boolean;
  hook: boolean;
  json: boolean;
}

export interface SecretsScanOptions {
  history: boolean;
  staged: boolean;
  json: boolean;
}

export interface SecretScanningResult {
  written: string[];
  gitleaks: Awaited<ReturnType<typeof installGitleaks>> | null;
}

export async function runSecretsEnable(opts: SecretsEnableOptions): Promise<number> {
  try {
    const cwd = process.cwd();
    const result = await enableProjectSecretScanning(cwd, opts);

    if (opts.json) {
      log.json({
        ok: true,
        written: result.written,
        gitleaks: result.gitleaks ?? readGitleaksMetadata(),
      });
    } else {
      for (const file of result.written) log.ok(`wrote ${file}`);
      if (result.written.length === 0)
        log.info("secret scanning files already exist; use --force to overwrite");
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

export async function enableProjectSecretScanning(
  cwd: string,
  opts: Pick<SecretsEnableOptions, "install" | "force" | "noCi" | "hook">,
): Promise<SecretScanningResult> {
  const written: string[] = [];
  if (writeFileIfNeeded(path.join(cwd, ".gitleaks.toml"), gitleaksToml(), opts.force)) {
    written.push(".gitleaks.toml");
  }
  if (!opts.noCi) {
    const workflow = path.join(cwd, ".github", "workflows", "secret-scanning.yml");
    if (writeFileIfNeeded(workflow, secretScanningWorkflow(), opts.force)) {
      written.push(".github/workflows/secret-scanning.yml");
    }
  }
  if (writeProjectSecurityMetadata(cwd, { ci: !opts.noCi, hook: opts.hook })) {
    written.push(".vegastack/project.json");
  }

  let installed: Awaited<ReturnType<typeof installGitleaks>> | null = null;
  if (opts.install) {
    log.step(
      `installing VegaStack-pinned Gitleaks release for this OS/architecture (${GITLEAKS_REPO_URL})`,
    );
    installed = await installGitleaks({ force: opts.force });
    log.ok(`Gitleaks ${installed.version} installed at ${installed.bin}`);
  }

  if (opts.hook) {
    const hook = installPreCommitHook(cwd, opts.force);
    if (hook) written.push(".git/hooks/pre-commit");
  }
  return { written, gitleaks: installed };
}

export async function runSecretsScan(opts: SecretsScanOptions): Promise<number> {
  try {
    let bin = resolveGitleaksBin();
    if (!bin) {
      log.step(`Gitleaks not found; installing VegaStack-pinned release from ${GITLEAKS_REPO_URL}`);
      bin = (await installGitleaks()).bin;
    }
    const configArgs = fs.existsSync(path.join(process.cwd(), ".gitleaks.toml"))
      ? ["--config", path.join(process.cwd(), ".gitleaks.toml")]
      : [];
    const reportArgs = opts.json ? ["--report-format", "json"] : [];
    const args = opts.staged
      ? ["stdin", "--redact", ...reportArgs, ...configArgs]
      : opts.history
        ? ["git", "--redact", "--log-opts=--all", ...reportArgs, ...configArgs, "."]
        : ["dir", "--redact", ...reportArgs, ...configArgs, "."];
    const result = opts.staged
      ? spawnSync("git", ["diff", "--cached"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 })
      : null;
    if (result && result.status !== 0) {
      log.err(result.stderr.trim() || "failed to read staged git diff");
      return result.status ?? 1;
    }
    const scan = spawnSync(bin, args, {
      encoding: "utf8",
      input: result?.stdout,
      stdio: opts.staged ? ["pipe", "inherit", "inherit"] : "inherit",
    });
    return scan.status ?? 1;
  } catch (e) {
    return printError(e);
  }
}

export async function runSecretsDoctor(opts: { json: boolean }): Promise<number> {
  try {
    const cwd = process.cwd();
    const bin = resolveGitleaksBin();
    const checks = [
      {
        name: "Gitleaks binary",
        ok: bin !== null,
        detail: bin ? `${bin} (${gitleaksVersion(bin) ?? "version unknown"})` : "not installed",
      },
      {
        name: "Gitleaks config",
        ok: fs.existsSync(path.join(cwd, ".gitleaks.toml")),
        detail: fs.existsSync(path.join(cwd, ".gitleaks.toml")) ? ".gitleaks.toml" : "missing",
      },
      {
        name: "Secret scanning CI",
        ok: fs.existsSync(path.join(cwd, ".github", "workflows", "secret-scanning.yml")),
        detail: fs.existsSync(path.join(cwd, ".github", "workflows", "secret-scanning.yml"))
          ? ".github/workflows/secret-scanning.yml"
          : "missing",
      },
      {
        name: "Pre-commit hook",
        ok: fs.existsSync(path.join(cwd, ".git", "hooks", "pre-commit")),
        detail: fs.existsSync(path.join(cwd, ".git", "hooks", "pre-commit"))
          ? ".git/hooks/pre-commit"
          : "not installed",
      },
    ];
    if (opts.json) {
      log.json({ checks, gitleaks: readGitleaksMetadata() });
    } else {
      for (const check of checks) {
        if (check.ok) log.ok(`${check.name}: ${check.detail}`);
        else log.warn(`${check.name}: ${check.detail}`);
      }
    }
    return checks.filter((c) => c.name !== "Pre-commit hook").every((c) => c.ok) ? 0 : 1;
  } catch (e) {
    return printError(e);
  }
}

export function gitleaksToml(): string {
  return `# VegaStack secret scanning uses Gitleaks for detection.
# Upstream: ${GITLEAKS_REPO_URL}

title = "VegaStack secret scanning"

[extend]
useDefault = true
`;
}

export function secretScanningWorkflow(): string {
  return `name: Secret Scanning

# VegaStack secret scanning uses Gitleaks for detection.
# Upstream: ${GITLEAKS_REPO_URL}

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  gitleaks:
    name: Gitleaks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}

function writeProjectSecurityMetadata(cwd: string, value: { ci: boolean; hook: boolean }): boolean {
  const file = projectManifestPath(cwd);
  const project = readProjectManifest(file);
  const next = {
    ...project,
    schema_version: 1,
    generated_at:
      typeof project.generated_at === "string" ? project.generated_at : new Date().toISOString(),
    project_root: typeof project.project_root === "string" ? project.project_root : cwd,
    security: {
      ...(isRecord(project.security) ? project.security : {}),
      secret_scanning: {
        enabled: true,
        engine: "gitleaks",
        engine_url: GITLEAKS_REPO_URL,
        disclosure:
          "VegaStack wraps Gitleaks for secret detection; Gitleaks owns the detection engine and default rules.",
        config: ".gitleaks.toml",
        ci: value.ci,
        pre_commit_hook: value.hook,
      },
    },
  };
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const after = `${JSON.stringify(next, null, 2)}\n`;
  if (before === after) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(file), ".gitignore"), "*\n");
  fs.writeFileSync(file, after);
  return true;
}

function readProjectManifest(file: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function installPreCommitHook(cwd: string, force: boolean): boolean {
  const gitDir = path.join(cwd, ".git");
  if (!fs.existsSync(gitDir)) {
    log.warn("pre-commit hook skipped: .git directory not found");
    return false;
  }
  const hookPath = path.join(gitDir, "hooks", "pre-commit");
  const body = `#!/bin/sh
set -eu

if command -v vegastack >/dev/null 2>&1; then
  vegastack secrets scan --staged
else
  echo "vegastack not found; skipping secret scan" >&2
fi
`;
  if (fs.existsSync(hookPath) && !force) {
    log.warn("pre-commit hook already exists; use --force to overwrite");
    return false;
  }
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, body);
  fs.chmodSync(hookPath, 0o755);
  return true;
}

function writeFileIfNeeded(file: string, content: string, force: boolean): boolean {
  if (fs.existsSync(file) && !force) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}
