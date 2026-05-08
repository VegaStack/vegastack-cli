// `vegastack init` — project-local harness setup.
//
// This command keeps heavy registry content in the user cache and writes only
// committed .vegastack/vegastack.yml plus small pointers in project agent files.

import prompts from "prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildInitPlan,
  loadLocalRegistryPackDefinitions,
  PACKS,
  writeInitFiles,
} from "../lib/project.js";
import { log, printError } from "../lib/log.js";
import { installScanPreCommitHook } from "./scan.js";
import { ALL_RENDERER_NAMES } from "../agents/index.js";
import { detectHost } from "../lib/host-detect.js";
import { sharedInstructionsDir } from "../lib/paths.js";
import { installCloudflared, type CloudflaredInstall } from "../lib/cloudflared.js";
import {
  isRegistryEntryInstalled,
  listPublishedPackDefinitions,
  syncRegistryEntry,
} from "../lib/registry.js";
import { installRipgrep, type RipgrepInstall } from "../lib/ripgrep.js";
import { VegaStackError } from "../lib/errors.js";
import { defaultScanConfig, writeProjectScanConfig } from "../lib/scan/config.js";
import { detectScanChecks } from "../lib/scan/detect.js";
import { installScanTool, type ScanToolName } from "../lib/scan-tools.js";
import { buildProjectRefreshPlan, writeProjectRefreshPlan } from "../lib/project-state.js";
import { readProjectConfigIfExists, writeProjectConfig } from "../lib/project-config.js";

export interface InitOptions {
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  noDownload: boolean;
  scan?: boolean | undefined;
  scanHook: boolean;
  tunnels: boolean;
  skills: boolean;
}

export async function runInit(opts: InitOptions): Promise<number> {
  try {
    const cwd = process.cwd();
    const packs = await listPublishedPackDefinitions().catch(() =>
      loadLocalRegistryPackDefinitions(PACKS),
    );
    const plan = buildInitPlan(cwd, undefined, packs);
    const installed = new Set(
      plan.selected.filter((p) => isRegistryEntryInstalled(p.name)).map((p) => p.name),
    );
    const detectedAgents = detectInstalledAgents();

    if (opts.json && !opts.yes && !opts.dryRun) {
      throw new VegaStackError(
        "ValidationError",
        "`vegastack init --agent` requires --yes or --dry-run",
        { context: { command: "init", json: true } },
      );
    }

    if (!plan.scan.git && !opts.yes && !opts.dryRun) {
      const r = await prompts({
        type: "confirm",
        name: "continue",
        message: "No .git directory detected. Continue initializing VegaStack here?",
        initial: false,
      });
      if (r.continue !== true) {
        log.info("init cancelled");
        return 0;
      }
    }

    const scanDetection = detectScanChecks(cwd);
    let enableScan = opts.scan ?? true;
    let scanHook = opts.scanHook;
    if (!opts.json)
      printPlan(
        plan,
        installed,
        opts.noDownload,
        enableScan,
        scanHook,
        opts.tunnels,
        detectedAgents,
        scanDetection,
      );

    if (!opts.yes && !opts.dryRun) {
      const r = await prompts({
        type: "confirm",
        name: "apply",
        message: "Write .vegastack/vegastack.yml and shared instruction pointers?",
        initial: true,
      });
      if (r.apply !== true) {
        log.info("init cancelled");
        return 0;
      }

      if (opts.scan === undefined) {
        const scan = await prompts({
          type: "confirm",
          name: "enable",
          message:
            "Enable VegaStack scan? This installs pinned OSS scanners for secrets, actions, dependencies, containers, Kubernetes, and IaC based on this repo.",
          initial: true,
        });
        enableScan = scan.enable === true;
      }
      if (enableScan && !scanHook) {
        const hook = await prompts({
          type: "confirm",
          name: "enable",
          message: "Install the fast staged pre-commit scan hook?",
          initial: true,
        });
        scanHook = hook.enable === true;
      }
    }

    if (opts.dryRun) {
      if (opts.json) {
        log.json({
          dry_run: true,
          plan,
          installed_registry_packs: [...installed].sort(),
          scan: {
            enabled: enableScan,
            detected_checks: scanDetection.checks,
            pre_commit_hook: enableScan ? scanHook : false,
          },
          skills: {
            enabled: opts.skills,
            detected_agents: detectedAgents.map((a) => a.agent),
          },
          preview: {
            enabled: opts.tunnels,
            engine: opts.tunnels ? "cloudflared" : undefined,
          },
        });
      } else {
        log.info("dry run: no files written");
      }
      return 0;
    }

    if (!opts.noDownload) {
      for (const selected of plan.selected) {
        if (installed.has(selected.name)) continue;
        log.step(`installing ${selected.name} Registry pack into the shared VegaStack cache`);
        await syncRegistryEntry(selected.name);
      }
    }

    let ripgrep: RipgrepInstall | { error: string } | null = null;
    let cloudflared: CloudflaredInstall | { error: string } | null = null;
    try {
      log.step("installing managed ripgrep for deterministic registry search");
      ripgrep = await installRipgrep();
    } catch (e) {
      ripgrep = { error: e instanceof Error ? e.message : String(e) };
      log.warn(`managed ripgrep install skipped: ${ripgrep.error}`);
    }

    if (!opts.noDownload && opts.tunnels) {
      try {
        log.step("installing managed cloudflared for preview tunnels");
        cloudflared = await installCloudflared();
      } catch (e) {
        cloudflared = { error: e instanceof Error ? e.message : String(e) };
        log.warn(`managed cloudflared install skipped: ${cloudflared.error}`);
      }
    }

    writeInitFiles(plan);
    writeProjectRefreshPlan(buildProjectRefreshPlan(cwd));
    writePreviewMetadata(cwd, opts.tunnels, cloudflared);

    const scanSetup = enableScan
      ? await enableProjectScan(cwd, {
          install: !opts.noDownload,
          hook: scanHook,
          detection: scanDetection.checks,
        })
      : null;
    const instructionEntrypoints = opts.skills
      ? appendProjectInstructionEntrypoints(cwd, detectedAgents)
      : [];

    const result = {
      ok: true,
      project_config: path.join(cwd, ".vegastack", "vegastack.yml"),
      selected_registry_packs: plan.selected.map((p) => p.name),
      registry_cache_root: plan.registryCacheRoot,
      shared_instructions: {
        directory: sharedInstructionsDir(),
        files: [
          path.join(sharedInstructionsDir(), "AGENTS.md"),
          path.join(sharedInstructionsDir(), "CLAUDE.md"),
        ],
      },
      scan: scanSetup
        ? {
            enabled: true,
            written: scanSetup.written,
            tools: scanSetup.tools,
          }
        : { enabled: false },
      ripgrep,
      preview: {
        enabled: opts.tunnels,
        cloudflared,
        notice:
          "Cloudflare Quick Tunnels are temporary development previews. Custom hostnames require Cloudflare login and a domain/zone you control.",
      },
      skills: {
        enabled: opts.skills,
        detected_agents: detectedAgents.map((a) => ({
          agent: a.agent,
          evidence: a.evidence,
        })),
        instruction_entrypoints: instructionEntrypoints,
      },
    };

    if (opts.json) log.json(result);
    else {
      log.ok(`wrote ${result.project_config}`);
      log.info(`agents can read shared VegaStack instructions in ${sharedInstructionsDir()}`);
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function printPlan(
  plan: ReturnType<typeof buildInitPlan>,
  installed: Set<string>,
  noDownload: boolean,
  enableScan: boolean,
  scanHook: boolean,
  tunnels: boolean,
  detectedAgents: ReturnType<typeof detectInstalledAgents>,
  scanDetection: ReturnType<typeof detectScanChecks>,
): void {
  process.stderr.write("\nDetected project stack:\n\n");
  if (plan.scan.detected.length === 0) {
    process.stderr.write("  No supported packs detected yet.\n");
  }
  for (const p of plan.scan.detected) {
    const selected = plan.selected.some((s) => s.name === p.name);
    const mark = selected ? "[x]" : "[ ]";
    const suffix = p.status === "available" ? "" : " (planned)";
    process.stderr.write(`  ${mark} ${p.title}${suffix}\n`);
    process.stderr.write(`      found: ${p.reasons.join(", ")}\n`);
  }

  process.stderr.write("\nVegaStack Registry cache:\n");
  process.stderr.write(`  ${plan.registryCacheRoot}\n`);
  for (const selected of plan.selected) {
    const note = installed.has(selected.name)
      ? `${selected.title} Registry pack already installed.`
      : noDownload
        ? `${selected.title} Registry pack missing; --no-download set, so init will only write state.`
        : `${selected.title} Registry pack missing; init will download it into the shared cache.`;
    process.stderr.write(`  ${note}\n`);
  }
  process.stderr.write("\nProject files:\n");
  process.stderr.write(`  ${plan.files.projectConfig}\n`);
  process.stderr.write(`  shared instructions: ${sharedInstructionsDir()}\n`);
  process.stderr.write("\nVegaStack scan:\n");
  process.stderr.write(
    enableScan
      ? "  Security scanning will be enabled with pinned open-source scanners.\n"
      : "  Security scanning will be skipped.\n",
  );
  if (enableScan) {
    const checks = Object.keys(scanDetection.checks);
    process.stderr.write(
      `  Detected checks: ${checks.length > 0 ? checks.join(", ") : "secrets"}\n`,
    );
    process.stderr.write(
      "  Uses Gitleaks, Trivy, OSV-Scanner, actionlint, and zizmor where applicable.\n",
    );
    process.stderr.write(`  Pre-commit hook: ${scanHook ? "yes" : "no"}\n`);
  }
  process.stderr.write("\nPreview tunnels:\n");
  process.stderr.write(
    !tunnels
      ? "  Managed cloudflared install skipped because --no-tunnels is set.\n"
      : noDownload
        ? "  Managed cloudflared install skipped because --no-download is set.\n"
        : "  Managed cloudflared will be installed for `vegastack preview --tunnel`.\n",
  );
  process.stderr.write(
    "  Quick Tunnels are temporary development previews, not production hosting.\n",
  );
  process.stderr.write("\nAgent skill setup:\n");
  if (detectedAgents.length === 0) {
    process.stderr.write("  No installed agent hosts detected; skill install will be skipped.\n");
  } else {
    for (const agent of detectedAgents) {
      process.stderr.write(`  ${agent.agent}: ${agent.evidence}\n`);
    }
    process.stderr.write(
      "  Project AGENTS.md / CLAUDE.md pointers will be appended when applicable.\n",
    );
  }
  const planned = PACKS.filter((p) => p.status === "planned").map((p) => p.name);
  if (planned.length > 0) {
    process.stderr.write("\nPlanned Registry packs not installable yet:\n");
    process.stderr.write(`  ${planned.join(", ")}\n`);
  }
  process.stderr.write("\n");
}

interface DetectedAgent {
  agent: string;
  evidence: string;
}

function detectInstalledAgents(): DetectedAgent[] {
  return ALL_RENDERER_NAMES.map((agent) => detectHost(agent))
    .filter((status) => status.installed)
    .map((status) => ({ agent: status.agent, evidence: status.evidence }));
}

async function enableProjectScan(
  cwd: string,
  opts: {
    install: boolean;
    hook: boolean;
    detection: Partial<Record<ScanToolConfigKey, boolean>>;
  },
): Promise<{ written: string[]; tools: Record<string, unknown> }> {
  const written: string[] = [];
  const scan = defaultScanConfig(opts.detection);
  scan.pre_commit.enabled = opts.hook;
  scan.pre_commit.mode = opts.hook ? "fast-staged" : "none";
  if (writeProjectScanConfig(cwd, scan)) written.push(".vegastack/vegastack.yml");
  if (opts.hook && installScanPreCommitHook(cwd, false)) written.push(".git/hooks/pre-commit");

  const tools: Record<string, unknown> = {};
  if (opts.install) {
    for (const tool of toolsForScanConfig(scan)) {
      try {
        log.step(`installing managed ${tool} for VegaStack scan`);
        tools[tool] = await installScanTool(tool);
      } catch (e) {
        tools[tool] = { error: e instanceof Error ? e.message : String(e) };
        log.warn(`managed ${tool} install skipped: ${(tools[tool] as { error: string }).error}`);
      }
    }
  }
  return { written, tools };
}

type ScanToolConfigKey =
  | "actions"
  | "containers"
  | "dependencies"
  | "iac"
  | "kubernetes"
  | "secrets";

function toolsForScanConfig(scan: ReturnType<typeof defaultScanConfig>): ScanToolName[] {
  const out = new Set<ScanToolName>();
  if (scan.checks.secrets.enabled) out.add("gitleaks");
  if (scan.checks.actions.enabled) {
    out.add("actionlint");
    out.add("zizmor");
  }
  if (scan.checks.dependencies.enabled) {
    out.add("osv-scanner");
    out.add("trivy");
  }
  if (scan.checks.containers.enabled || scan.checks.kubernetes.enabled || scan.checks.iac.enabled) {
    out.add("trivy");
  }
  return [...out];
}

function appendProjectInstructionEntrypoints(cwd: string, agents: DetectedAgent[]): string[] {
  const written: string[] = [];
  const names = new Set(agents.map((a) => a.agent));
  if (names.has("codex")) {
    appendManagedInstructionBlock(
      path.join(cwd, "AGENTS.md"),
      "AGENTS.md-compatible agents",
      displaySharedInstructionPath("AGENTS.md"),
    );
    written.push("AGENTS.md");
  }
  if (names.has("claude-code")) {
    appendManagedInstructionBlock(
      path.join(cwd, "CLAUDE.md"),
      "Claude Code",
      displaySharedInstructionPath("CLAUDE.md"),
    );
    written.push("CLAUDE.md");
  }
  return written;
}

function appendManagedInstructionBlock(file: string, label: string, target: string): void {
  const begin = "<!-- vegastack:start -->";
  const end = "<!-- vegastack:end -->";
  const block = `${begin}

## VegaStack

This project uses VegaStack for grounded infrastructure, cloud, CI/CD, Terraform, Kubernetes, Docker, Supabase, deployment, and security guidance.

${label} should read shared VegaStack instructions at \`${target}\`.

If \`vegastack\` or that instruction file is missing, ask the user to install and set up VegaStack:

\`\`\`bash
npm i -g @vegastack/cli
vegastack setup
\`\`\`

Use the project config at \`.vegastack/vegastack.yml\`.

${end}
`;
  // Refuse to follow symlinks pointing outside cwd. Prevents `vegastack init`
  // from silently rewriting a sensitive shared file if a user (or attacker
  // with write access to the project) has replaced AGENTS.md/CLAUDE.md with
  // a symlink. We resolve the realpath of the parent dir + basename so a
  // missing file is still allowed (creating it under cwd is fine).
  try {
    const realParent = fs.realpathSync(path.dirname(file));
    const cwdReal = fs.realpathSync(process.cwd());
    const candidate = path.join(realParent, path.basename(file));
    if (
      !candidate.startsWith(cwdReal + path.sep) &&
      candidate !== path.join(cwdReal, path.basename(file))
    ) {
      throw new Error(`refusing to write outside project: ${file}`);
    }
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
      const target = fs.realpathSync(file);
      if (!target.startsWith(cwdReal + path.sep)) {
        throw new Error(`refusing to follow out-of-tree symlink: ${file} -> ${target}`);
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("refusing")) throw e;
    /* parent dir or cwd missing — fall through and let writeFileSync surface it */
  }

  let raw = "";
  let mode: number | undefined;
  try {
    raw = fs.readFileSync(file, "utf8");
    try {
      mode = fs.statSync(file).mode & 0o777;
    } catch {
      /* ignore */
    }
  } catch {
    /* file absent */
  }
  const next = raw.includes(begin)
    ? raw.replace(new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`), block)
    : `${raw.trimEnd()}${raw.trim() ? "\n\n" : ""}${block}`;
  // Atomic write: tmp file + rename. Avoids a torn read if an editor saves the
  // file concurrently with init.
  const tmp = `${file}.vegastack-tmp`;
  fs.writeFileSync(tmp, next, "utf8");
  if (mode !== undefined) {
    try {
      fs.chmodSync(tmp, mode);
    } catch {
      /* best-effort */
    }
  }
  fs.renameSync(tmp, file);
}

function displaySharedInstructionPath(file: string): string {
  return `~/.vegastack/instructions/${file}`;
}

function writePreviewMetadata(
  cwd: string,
  enabled: boolean,
  cloudflared: CloudflaredInstall | { error: string } | null,
): void {
  const project = readProjectConfigIfExists(cwd) ?? { schema_version: 1 };
  project.preview = {
    enabled,
    engine: "cloudflared",
    engine_url: "https://github.com/cloudflare/cloudflared",
    cloudflare_docs:
      "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
    quick_tunnel_notice:
      "Quick Tunnels are intended for temporary testing and development previews, not production hosting.",
    custom_hostname_notice:
      "Custom hostnames require Cloudflare login and a domain/zone you control.",
  };
  void cloudflared;
  writeProjectConfig(cwd, project);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
