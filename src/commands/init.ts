// `vegastack init` — project-local harness setup.
//
// This command keeps heavy registry content in the user cache and writes only
// project state + instructions under .vegastack/ so users can inspect what agents
// are being asked to read.

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
import { enableProjectSecretScanning } from "./secrets.js";
import { ALL_RENDERER_NAMES, getRenderer } from "../agents/index.js";
import type { InstallResult, Scope } from "../agents/index.js";
import { detectHost } from "../lib/host-detect.js";
import { projectInstructionsDir } from "../lib/paths.js";
import { installCloudflared, type CloudflaredInstall } from "../lib/cloudflared.js";
import {
  isRegistryEntryInstalled,
  listPublishedPackDefinitions,
  syncRegistryEntry,
} from "../lib/registry.js";
import { installRipgrep, type RipgrepInstall } from "../lib/ripgrep.js";
import { VegaStackError } from "../lib/errors.js";

export interface InitOptions {
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  noDownload: boolean;
  secrets?: boolean | undefined;
  secretsHook: boolean;
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
        "`vegastack init --json` requires --yes or --dry-run",
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

    let enableSecrets = opts.secrets ?? opts.yes;
    if (!opts.json)
      printPlan(
        plan,
        installed,
        opts.noDownload,
        enableSecrets,
        opts.secretsHook,
        opts.tunnels,
        detectedAgents,
      );

    if (!opts.yes && !opts.dryRun) {
      const r = await prompts({
        type: "confirm",
        name: "apply",
        message: "Write .vegastack project state and instruction files?",
        initial: true,
      });
      if (r.apply !== true) {
        log.info("init cancelled");
        return 0;
      }

      if (opts.secrets === undefined) {
        const secrets = await prompts({
          type: "confirm",
          name: "enable",
          message:
            "Enable secret scanning with Gitleaks? This writes .gitleaks.toml, GitHub Actions CI, and installs Gitleaks.",
          initial: true,
        });
        enableSecrets = secrets.enable === true;
      }
    }

    if (opts.dryRun) {
      if (opts.json) {
        log.json({
          dry_run: true,
          plan,
          installed_registry_entries: [...installed].sort(),
          secret_scanning: {
            enabled: enableSecrets,
            engine: enableSecrets ? "gitleaks" : undefined,
            pre_commit_hook: enableSecrets ? opts.secretsHook : false,
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
    if (!opts.noDownload) {
      try {
        log.step("installing managed ripgrep for deterministic registry search");
        ripgrep = await installRipgrep();
      } catch (e) {
        ripgrep = { error: e instanceof Error ? e.message : String(e) };
        log.warn(`managed ripgrep install skipped: ${ripgrep.error}`);
      }
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
    writePreviewMetadata(cwd, opts.tunnels, cloudflared);

    const secretScanning = enableSecrets
      ? await enableProjectSecretScanning(cwd, {
          install: true,
          force: false,
          noCi: false,
          hook: opts.secretsHook,
        })
      : null;
    const skills = opts.skills ? await installDetectedAgentSkills(cwd, detectedAgents) : [];
    const instructionEntrypoints = opts.skills
      ? appendProjectInstructionEntrypoints(cwd, detectedAgents)
      : [];

    const result = {
      ok: true,
      project_dir: path.join(cwd, ".vegastack"),
      selected_registry_entries: plan.selected.map((p) => p.name),
      registry_cache_root: plan.registryCacheRoot,
      instructions: plan.files.instructions,
      secret_scanning: secretScanning
        ? {
            enabled: true,
            written: secretScanning.written,
            gitleaks: secretScanning.gitleaks,
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
        installed: skills,
        instruction_entrypoints: instructionEntrypoints,
      },
    };

    if (opts.json) log.json(result);
    else {
      log.ok(`wrote ${result.project_dir}`);
      log.info(`agents can read project instructions in ${projectInstructionsDir(cwd)}`);
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
  enableSecrets: boolean,
  secretsHook: boolean,
  tunnels: boolean,
  detectedAgents: ReturnType<typeof detectInstalledAgents>,
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
  process.stderr.write(`  ${plan.files.projectJson}\n`);
  process.stderr.write(`  ${plan.files.lockJson}\n`);
  process.stderr.write(`  ${plan.files.instructions.join("\n  ")}\n`);
  process.stderr.write("\nSecret scanning:\n");
  process.stderr.write(
    enableSecrets
      ? "  Gitleaks secret scanning will be enabled and installed.\n"
      : "  Gitleaks secret scanning will be skipped.\n",
  );
  if (enableSecrets) {
    process.stderr.write("  Writes .gitleaks.toml and .github/workflows/secret-scanning.yml.\n");
    process.stderr.write(`  Pre-commit hook: ${secretsHook ? "yes" : "no"}\n`);
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
    process.stderr.write("  Matching skills will be installed automatically.\n");
  }
  const planned = PACKS.filter((p) => p.status === "planned").map((p) => p.name);
  if (planned.length > 0) {
    process.stderr.write("\nPlanned registry entries not installable yet:\n");
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

async function installDetectedAgentSkills(
  cwd: string,
  agents: DetectedAgent[],
): Promise<InstallResult[]> {
  const out: InstallResult[] = [];
  for (const agent of agents) {
    const renderer = getRenderer(agent.agent);
    if (!renderer) continue;
    if (!renderer.supportsScope("project")) {
      out.push({
        agent: agent.agent,
        installed: false,
        paths: [],
        notes: [
          "Skipped automatic skill install because this agent only supports global install. Project instructions were still appended when applicable.",
        ],
        warnings: [],
      });
      continue;
    }
    const scope: Scope = "project";
    const result = await renderer.install({ cwd, scope, force: false, dryRun: false });
    out.push(result);
    if (result.installed) log.ok(`${renderer.displayName}: skill installed (${scope})`);
    for (const warning of result.warnings) log.warn(`${renderer.displayName}: ${warning}`);
  }
  return out;
}

function appendProjectInstructionEntrypoints(cwd: string, agents: DetectedAgent[]): string[] {
  const written: string[] = [];
  const names = new Set(agents.map((a) => a.agent));
  if (names.has("codex")) {
    appendManagedInstructionBlock(
      path.join(cwd, "AGENTS.md"),
      "AGENTS.md-compatible agents",
      displayProjectInstructionPath(cwd, "AGENTS.md"),
    );
    written.push("AGENTS.md");
  }
  if (names.has("claude-code")) {
    appendManagedInstructionBlock(
      path.join(cwd, "CLAUDE.md"),
      "Claude Code",
      displayProjectInstructionPath(cwd, "CLAUDE.md"),
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

${label} should read \`${target}\` before infrastructure, cloud, CI/CD, Terraform, Kubernetes, Docker, Supabase, or deployment work.

${end}
`;
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    /* file absent */
  }
  const next = raw.includes(begin)
    ? raw.replace(new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`), block)
    : `${raw.trimEnd()}${raw.trim() ? "\n\n" : ""}${block}`;
  fs.writeFileSync(file, next, "utf8");
}

function displayProjectInstructionPath(cwd: string, file: string): string {
  return path.join(projectInstructionsDir(cwd), file);
}

function writePreviewMetadata(
  cwd: string,
  enabled: boolean,
  cloudflared: CloudflaredInstall | { error: string } | null,
): void {
  const file = path.join(cwd, ".vegastack", "project.json");
  let project: Record<string, unknown> = {};
  try {
    project = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    project = { schema_version: 1, project_root: cwd };
  }
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
    cloudflared,
  };
  fs.writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
