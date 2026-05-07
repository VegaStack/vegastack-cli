// Integration test: shell out to the built CLI and verify help/version output.
// This makes sure cli.ts wires up correctly end-to-end without depending on
// the docs Registry pack.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");
const CLI = path.join(PKG_ROOT, "dist", "cli.js");

function isolatedEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-home-")),
    VEGASTACK_REGISTRY_URL: "http://127.0.0.1:1",
    VEGASTACK_REGISTRY_DEV_TRUST: "1",
    NO_COLOR: "1",
  };
}

describe("vegastack CLI help / version", () => {
  it("dist/cli.js exists (run `npm run build` first)", () => {
    expect(fs.existsSync(CLI)).toBe(true);
  });

  it("`vegastack --version` matches package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    const r = spawnSync("node", [CLI, "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it("`vegastack --help` lists every command", () => {
    const r = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    for (const cmd of [
      "setup",
      "init",
      "detect",
      "refresh",
      "generate",
      "ask",
      "search",
      "doctor",
      "registry",
      "skills",
      "scan",
      "preview",
    ]) {
      expect(r.stdout).toContain(cmd);
    }
    expect(r.stdout).not.toMatch(/\n {2}install \[options\]/);
  });

  it("`vegastack --help` documents env vars and exit codes", () => {
    const r = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(r.stdout).toContain("VEGASTACK_REGISTRY_DIR");
    expect(r.stdout).toContain("~/.vegastack");
    expect(r.stdout).toContain("VEGASTACK_CLOUDFLARED_BIN");
    expect(r.stdout).toContain("VEGASTACK_TRIVY_BIN");
    expect(r.stdout).toContain("NO_COLOR");
    expect(r.stdout).toMatch(/Exit codes/);
  });

  it("`vegastack preview --help` discloses Cloudflare Tunnel usage", () => {
    const r = spawnSync("node", [CLI, "preview", "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Cloudflare Quick Tunnels");
    expect(r.stdout).toContain("cloudflare/cloudflared");
    expect(r.stdout).toContain("--hostname");
  });

  // Performance F-002: every `runX` should be loaded lazily so `--help` and
  // `--version` (and any `<cmd> --help`) don't pay the parse/link cost of
  // commander/init/scan/preview/update plus their transitive deps.
  // Static-import-graph check: parse dist/cli.js and assert no top-level
  // `from "./commands/<name>.js"` import remains for the heavy modules.
  it("dist/cli.js does not statically import command modules (lazy load)", () => {
    const built = fs.readFileSync(CLI, "utf8");
    const lazyOnly = [
      "init.js",
      "scan.js",
      "preview.js",
      "update.js",
      "ask.js",
      "search.js",
      "skills.js",
      "setup.js",
      "registry.js",
      "doctor.js",
      "generate.js",
      "refresh.js",
      "detect.js",
    ];
    for (const cmd of lazyOnly) {
      const staticPattern = new RegExp(
        `\\bfrom\\s+["']\\./commands/${cmd.replace(".", "\\.")}["']`,
      );
      expect(staticPattern.test(built), `dist/cli.js statically imports commands/${cmd}`).toBe(
        false,
      );
    }
  });

  it("`vegastack registry --help` lists registry actions", () => {
    const r = spawnSync("node", [CLI, "registry", "--help"], { encoding: "utf8" });
    expect(r.stdout).toContain("list");
    expect(r.stdout).toContain("update");
    expect(r.stdout).toContain("status");
    expect(r.stdout).not.toMatch(/\n\s+install\b/);
  });

  it("`vegastack skills --help` lists all actions", () => {
    const r = spawnSync("node", [CLI, "skills", "--help"], { encoding: "utf8" });
    expect(r.stdout).toContain("install");
    expect(r.stdout).toContain("uninstall");
    expect(r.stdout).toContain("status");
    expect(r.stdout).toContain("reconcile");
  });

  it("`vegastack scan --help` discloses scanner engines", () => {
    const r = spawnSync("node", [CLI, "scan", "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gitleaks/gitleaks");
    expect(r.stdout).toContain("aquasecurity/trivy");
    expect(r.stdout).toContain("google/osv-scanner");
    expect(r.stdout).toContain("rhysd/actionlint");
    expect(r.stdout).toContain("zizmorcore/zizmor");
  });

  it("`vegastack doctor --json` includes top-level ok even on failing checks", () => {
    const r = spawnSync("node", [CLI, "doctor", "--json"], {
      encoding: "utf8",
      env: isolatedEnv(),
    });
    expect(r.status).not.toBe(0);
    const parsed = JSON.parse(r.stdout) as { ok?: boolean; checks?: unknown[] };
    expect(parsed.ok).toBe(false);
    expect(Array.isArray(parsed.checks)).toBe(true);
  });

  it("`vegastack ask --entry` can be repeated for cross-pack queries", () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-registry-"));
    writeMiniPack(registryRoot, "cloudflare", "docs/worker.md", "Cloudflare Worker", [
      "worker",
      "deploy",
    ]);
    writeMiniPack(registryRoot, "github-actions", "docs/workflow.md", "GitHub Actions workflow", [
      "workflow",
      "deploy",
    ]);

    const r = spawnSync(
      "node",
      [
        CLI,
        "ask",
        "--entry",
        "cloudflare",
        "--entry",
        "github-actions",
        "--no-install-tools",
        "deploy worker workflow",
      ],
      {
        encoding: "utf8",
        env: {
          ...isolatedEnv(),
          VEGASTACK_REGISTRY_DIR: registryRoot,
          VEGASTACK_NO_MANAGED_TOOLS: "1",
        },
      },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      registry_entries: string[];
      results: { registry_entry: string }[];
    };
    expect(parsed.registry_entries).toEqual(["cloudflare", "github-actions"]);
    expect(new Set(parsed.results.map((result) => result.registry_entry))).toEqual(
      new Set(["cloudflare", "github-actions"]),
    );
  });

  it("rejects an invalid scope with a clear message", () => {
    const r = spawnSync("node", [CLI, "skills", "install", "--scope", "everywhere"], {
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/global.*project/);
  });

  it("does not expose legacy Terraform shortcuts", () => {
    const help = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(help.stdout).not.toMatch(/\n\s+terraform\b/);
    expect(help.stdout).not.toMatch(/\n\s+tf\b/);

    const r = spawnSync("node", [CLI, "terraform", ""], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/unknown command/i);
  });

  it("`vegastack init --dry-run --json` emits parseable JSON without prompts", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-init-"));
    fs.writeFileSync(path.join(cwd, "Dockerfile"), "FROM alpine\n");
    const r = spawnSync("node", [CLI, "init", "--dry-run", "--json"], {
      cwd,
      encoding: "utf8",
      env: isolatedEnv(),
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("\u001b[");
    const body = JSON.parse(r.stdout) as {
      dry_run?: boolean;
      plan?: { selected?: { name: string }[] };
    };
    expect(body.dry_run).toBe(true);
    expect(body.plan?.selected?.map((p) => p.name)).toContain("docker");
  });

  it("`vegastack init --dry-run` downloads by default unless --no-download is passed", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-init-"));
    fs.writeFileSync(path.join(cwd, "Dockerfile"), "FROM alpine\n");

    const defaultRun = spawnSync("node", [CLI, "init", "--dry-run", "--no-skills"], {
      cwd,
      encoding: "utf8",
      env: isolatedEnv(),
    });
    expect(defaultRun.status).toBe(0);
    expect(defaultRun.stderr).toContain("init will download it into the shared cache");
    expect(defaultRun.stderr).not.toContain("--no-download set");

    const noDownloadRun = spawnSync(
      "node",
      [CLI, "init", "--dry-run", "--no-download", "--no-skills"],
      {
        cwd,
        encoding: "utf8",
        env: isolatedEnv(),
      },
    );
    expect(noDownloadRun.status).toBe(0);
    expect(noDownloadRun.stderr).toContain("--no-download set");
  });

  it("`vegastack init --dry-run` shows scan enabled by default unless --no-scan is passed", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-init-"));
    fs.mkdirSync(path.join(cwd, ".git"));

    const defaultRun = spawnSync("node", [CLI, "init", "--dry-run", "--no-download"], {
      cwd,
      encoding: "utf8",
      env: isolatedEnv(),
    });
    expect(defaultRun.status).toBe(0);
    expect(defaultRun.stderr).toContain(
      "Security scanning will be enabled with pinned open-source scanners.",
    );

    const noScanRun = spawnSync("node", [CLI, "init", "--dry-run", "--no-download", "--no-scan"], {
      cwd,
      encoding: "utf8",
      env: isolatedEnv(),
    });
    expect(noScanRun.status).toBe(0);
    expect(noScanRun.stderr).toContain("Security scanning will be skipped.");
  });

  it("`vegastack init --json` requires --yes instead of prompting on stdout", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-init-"));
    const r = spawnSync("node", [CLI, "init", "--json"], {
      cwd,
      encoding: "utf8",
      env: isolatedEnv(),
    });
    expect(r.status).toBe(10);
    expect(r.stdout).not.toContain("\u001b[");
    const body = JSON.parse(r.stdout) as { kind?: string; message?: string };
    expect(body.kind).toBe("ValidationError");
    expect(body.message).toMatch(/requires --yes or --dry-run/);
  });

  it("`vegastack detect --json` reports package manager and recommended entries", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-detect-"));
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "yarn@4.5.1", scripts: { build: "next build" } }),
    );
    fs.writeFileSync(path.join(cwd, "yarn.lock"), "");
    const r = spawnSync("node", [CLI, "detect", "--json"], {
      cwd,
      encoding: "utf8",
      env: isolatedEnv(),
    });
    expect(r.status).toBe(0);
    const body = JSON.parse(r.stdout) as {
      stack?: { package_manager?: { name?: string } };
      registry?: { recommended_entries?: string[] };
    };
    expect(body.stack?.package_manager?.name).toBe("yarn");
    expect(body.registry?.recommended_entries).toContain("docker");
  });

  it("`vegastack generate --json` returns an agent contract without writing files", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-generate-"));
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "npm@10.0.0" }),
    );
    const r = spawnSync("node", [CLI, "generate", "github-action", "vercel", "--json"], {
      cwd,
      encoding: "utf8",
      env: isolatedEnv(),
    });
    expect(r.status).toBe(0);
    const body = JSON.parse(r.stdout) as {
      files?: { path?: string }[];
      agent_instructions?: string[];
    };
    expect(body.files?.[0]?.path).toContain(".github/workflows");
    expect(body.agent_instructions?.join(" ")).toContain("VegaStack");
  });
});

function writeMiniPack(
  registryRoot: string,
  entry: string,
  docPath: string,
  title: string,
  tokens: string[],
): void {
  const root = path.join(registryRoot, entry);
  const file = path.join(root, docPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(root, "index"), { recursive: true });
  const body = `# ${title}\n\n${tokens.join(" ")} deployment reference.\n`;
  fs.writeFileSync(file, body);
  const stat = fs.statSync(file);
  const manifest = {
    schema_version: 2,
    id: entry,
    docs_root: "docs",
    files: [{ path: docPath, title, bytes: stat.size, tokens }],
  };
  fs.writeFileSync(path.join(root, "MANIFEST.json"), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(root, "ARTIFACTS.json"),
    JSON.stringify({
      schema_version: 1,
      files: [{ path: docPath, bytes: stat.size, sha256: "test" }],
    }),
  );
  fs.writeFileSync(
    path.join(root, "index", "search.json"),
    JSON.stringify({
      schema_version: 1,
      records: [
        {
          id: `${docPath}#L1`,
          path: docPath,
          heading: title,
          start_line: 1,
          end_line: 3,
          tokens,
          excerpt: `${tokens.join(" ")} deployment reference.`,
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(root, "index", "rank_index.json"),
    JSON.stringify({
      schema_version: 1,
      records: [
        {
          section_id: `${docPath}#L1`,
          path: docPath,
          heading: title,
          start_line: 1,
          end_line: 3,
          path_class: "reference",
          rank_terms: tokens,
        },
      ],
    }),
  );
}
