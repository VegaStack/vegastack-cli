import prompts from "prompts";
import * as fs from "node:fs";
import { reconcileDetectedAgentSkills } from "../lib/agent-skill-reconcile.js";
import {
  globalConfigPath,
  registryCacheRoot,
  toolsCacheRoot,
  vegastackConfigRoot,
} from "../lib/paths.js";
import { installManagedTools } from "../lib/managed-tools.js";
import type { ManagedToolName } from "../lib/managed-tools.js";
import { binaryOnPath } from "../lib/host-detect.js";
import { log, printError } from "../lib/log.js";
import { writeSharedInstructionFiles } from "../lib/project.js";

export interface SetupOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}

interface SetupPlan {
  config_root: string;
  config_path: string;
  registry_cache_root: string;
  tools_cache_root: string;
  detected_tools: Record<string, boolean>;
  recommended_managed_tools: ManagedToolName[];
  optional_managed_tools: ManagedToolName[];
}

export async function runSetup(opts: SetupOptions): Promise<number> {
  try {
    let plan = buildSetupPlan();
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
    const config = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      setup_completed: true,
      config_root: vegastackConfigRoot(),
      managed_tools: plan.recommended_managed_tools,
      detected_tools: plan.detected_tools,
    };
    fs.writeFileSync(globalConfigPath(), `${JSON.stringify(config, null, 2)}\n`);

    const result = { ok: true, plan, config, skills, managed_tools: managedTools };
    if (opts.json) log.json(result);
    else {
      log.ok(`wrote ${globalConfigPath()}`);
      log.info("run `vegastack init` inside a project or `/vegastack init` inside an agent");
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
}
