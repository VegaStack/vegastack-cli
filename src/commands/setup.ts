import prompts from "prompts";
import * as fs from "node:fs";
import { reconcileDetectedAgentSkills } from "../lib/agent-skill-reconcile.js";
import { ALL_RENDERER_NAMES } from "../agents/index.js";
import {
  globalConfigPath,
  registryCacheRoot,
  toolsCacheRoot,
  vegastackConfigRoot,
} from "../lib/paths.js";
import { installManagedTools } from "../lib/managed-tools.js";
import type { ManagedToolName } from "../lib/managed-tools.js";
import { binaryOnPath, detectHost } from "../lib/host-detect.js";
import { log, printError } from "../lib/log.js";
import { writeSharedInstructionFiles } from "../lib/project.js";
import {
  allInstalledRegistryEntryNames,
  allPublishedRegistryEntryNames,
  syncRegistryEntry,
} from "../lib/registry.js";
import { projectConfigExists } from "../lib/project-config.js";

export interface SetupOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  downloadAllRegistry?: boolean;
}

interface SetupPlan {
  config_root: string;
  config_path: string;
  registry_cache_root: string;
  tools_cache_root: string;
  detected_tools: Record<string, boolean>;
  recommended_managed_tools: ManagedToolName[];
  optional_managed_tools: ManagedToolName[];
  download_all_registry: boolean;
}

export async function runSetup(opts: SetupOptions): Promise<number> {
  try {
    let plan = { ...buildSetupPlan(), download_all_registry: Boolean(opts.downloadAllRegistry) };
    if (!opts.yes && !opts.dryRun && !opts.json) {
      printSetupPlan(plan);
      const tools = await prompts({
        type: "multiselect",
        name: "items",
        message: "Install managed tools now?",
        choices: [
          ...plan.recommended_managed_tools.map((tool) => ({
            title: `${tool} (recommended)`,
            value: tool,
            selected: true,
          })),
          ...plan.optional_managed_tools.map((tool) => ({
            title: String(tool),
            value: tool,
            selected: false,
          })),
        ],
      });
      const selected = Array.isArray(tools.items)
        ? tools.items.filter((tool): tool is ManagedToolName => isManagedToolName(tool))
        : plan.recommended_managed_tools;
      plan = {
        ...plan,
        recommended_managed_tools: selected,
        optional_managed_tools: [],
      };
      const registry = await prompts({
        type: "confirm",
        name: "downloadAll",
        message: "Download all VegaStack Registry packs for offline/power-user use?",
        initial: false,
      });
      plan = { ...plan, download_all_registry: registry.downloadAll === true };
    }

    if (opts.dryRun) {
      if (opts.json) log.json({ dry_run: true, plan });
      else printSetupPlan(plan);
      return 0;
    }

    fs.mkdirSync(vegastackConfigRoot(), { recursive: true });
    fs.mkdirSync(registryCacheRoot(), { recursive: true });
    fs.mkdirSync(toolsCacheRoot(), { recursive: true });
    writeSharedInstructionFiles();
    const skills = await reconcileDetectedAgentSkills({
      cwd: process.cwd(),
      scope: "global",
      force: false,
      dryRun: false,
    });
    const managedTools = await installManagedTools({ include: plan.recommended_managed_tools });
    const registry = plan.download_all_registry
      ? await installAllRegistryPacks({ force: false })
      : { installed: [], skipped: true };
    const config = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      setup_completed: true,
      config_root: vegastackConfigRoot(),
      managed_tools: plan.recommended_managed_tools,
      detected_tools: plan.detected_tools,
      registry: {
        download_all: plan.download_all_registry,
      },
    };
    // Persist with owner-only mode (0600) on POSIX so a multi-user host
    // doesn't leak the config (which records the absolute config_root and the
    // active managed-tool set) to other accounts. Windows ignores POSIX bits.
    fs.writeFileSync(globalConfigPath(), `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(globalConfigPath(), 0o600);
      } catch {
        /* best-effort tightening on pre-existing files */
      }
    }

    const result = { ok: true, plan, config, skills, managed_tools: managedTools, registry };
    if (opts.json) log.json(result);
    else {
      log.ok(`wrote ${globalConfigPath()}`);
      if (registry.installed.length > 0)
        log.ok(`installed Registry packs: ${registry.installed.length}`);
      log.info("run `vegastack init` inside a project or `/vegastack init` inside an agent");
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

export async function runDefaultCommand(opts: { json: boolean }): Promise<number> {
  try {
    if (!fs.existsSync(globalConfigPath())) {
      if (process.stdin.isTTY && process.stderr.isTTY) {
        return await runSetup({ dryRun: false, yes: false, json: opts.json });
      }
      const plan = buildSetupPlan();
      const payload = {
        ok: false,
        setup_completed: false,
        plan,
        next: [
          "vegastack setup --yes --agent",
          "vegastack registry install --all --agent",
          "vegastack init --yes --agent",
        ],
      };
      if (opts.json) log.json(payload);
      else {
        log.info("global setup has not been completed.");
        log.info("run `vegastack` in an interactive terminal, or run `vegastack setup --yes`.");
        log.info("optional power-user cache: `vegastack registry install --all`.");
      }
      return 0;
    }

    const installedPacks = allInstalledRegistryEntryNames();
    const detectedAgents = ALL_RENDERER_NAMES.map((agent) => detectHost(agent))
      .filter((host) => host.installed)
      .map((host) => host.agent)
      .sort();
    const projectInitialized = projectConfigExists(process.cwd());
    const status = {
      ok: true,
      setup_completed: true,
      config_path: globalConfigPath(),
      registry_cache_root: registryCacheRoot(),
      tools_cache_root: toolsCacheRoot(),
      installed_registry_packs: installedPacks,
      installed_registry_count: installedPacks.length,
      detected_agents: detectedAgents,
      project_initialized: projectInitialized,
      next: projectInitialized
        ? ['vegastack ask --agent "<query>"', 'vegastack search --agent --pack <pack> "<literal>"']
        : [
            "vegastack init --yes --agent",
            'vegastack ask --agent --pack <pack> "<query>"',
            "vegastack registry install --all --agent",
          ],
    };
    if (opts.json) log.json(status);
    else {
      log.ok(`setup complete: ${globalConfigPath()}`);
      log.info(`registry cache: ${registryCacheRoot()} (${installedPacks.length} packs installed)`);
      log.info(`detected agents: ${detectedAgents.join(", ") || "none"}`);
      log.info(
        projectInitialized
          ? 'project initialized; try `vegastack ask "<query>"`'
          : "project not initialized; run `vegastack init` or use `ask --pack <pack>`",
      );
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function isManagedToolName(value: unknown): value is ManagedToolName {
  return (
    value === "ripgrep" ||
    value === "gitleaks" ||
    value === "trivy" ||
    value === "osv-scanner" ||
    value === "actionlint" ||
    value === "zizmor" ||
    value === "cloudflared"
  );
}

function buildSetupPlan(): SetupPlan {
  return {
    config_root: vegastackConfigRoot(),
    config_path: globalConfigPath(),
    registry_cache_root: registryCacheRoot(),
    tools_cache_root: toolsCacheRoot(),
    detected_tools: {
      gh: binaryOnPath("gh"),
      git: binaryOnPath("git"),
      docker: binaryOnPath("docker"),
      kubectl: binaryOnPath("kubectl"),
      helm: binaryOnPath("helm"),
    },
    recommended_managed_tools: ["ripgrep"],
    optional_managed_tools: [
      "gitleaks",
      "trivy",
      "osv-scanner",
      "actionlint",
      "zizmor",
      "cloudflared",
    ],
    download_all_registry: false,
  };
}

function printSetupPlan(plan: SetupPlan): void {
  log.info(`global config: ${plan.config_path}`);
  log.info(`registry cache: ${plan.registry_cache_root}`);
  log.info(`tools cache: ${plan.tools_cache_root}`);
  log.info(`recommended managed tools: ${plan.recommended_managed_tools.join(", ")}`);
  if (!plan.detected_tools.gh)
    log.info(
      "GitHub CLI `gh` not found; install it separately if GitHub repo automation is needed",
    );
  log.info(`download all Registry packs: ${plan.download_all_registry ? "yes" : "no"}`);
}

async function installAllRegistryPacks(opts: {
  force: boolean;
}): Promise<{ installed: string[]; skipped?: boolean }> {
  const entries = await allPublishedRegistryEntryNames();
  const installed: string[] = [];
  for (const entry of entries) {
    await syncRegistryEntry(entry, opts.force ? { force: true } : {});
    installed.push(entry);
  }
  return { installed };
}
