// `vegastack update` — update the broad local VegaStack surface: project Registry
// entries, managed OS-specific tools, and the npm-installed CLI itself.
//
// `--check` only refreshes the version cache and prints a status line — useful
// for the doctor flow and for CI scripts that want to know without installing.

import { spawnCmdSync } from "../lib/spawn-cmd.js";
import prompts from "prompts";
import {
  allInstalledRegistryEntryNames,
  readProjectRegistryEntryNames,
  syncRegistryEntry,
} from "../lib/registry.js";
import {
  inspectDetectedAgentSkills,
  printAgentSkillInspection,
  printAgentSkillReconcile,
  reconcileDetectedAgentSkills,
} from "../lib/agent-skill-reconcile.js";
import { installManagedTools } from "../lib/managed-tools.js";
import { log, printError } from "../lib/log.js";
import {
  fetchLatestVersion,
  isNewer,
  readUpdateCache,
  refreshUpdateCache,
} from "../lib/update-check.js";

const PKG_NAME = "@vegastack/cli";

export interface UpdateOpts {
  check: boolean;
  current: string;
  cli: boolean;
  registry: boolean;
  tools: boolean;
  allRegistry: boolean;
  force: boolean;
  yes: boolean;
  json: boolean;
}

export async function runUpdate(opts: UpdateOpts): Promise<number> {
  try {
    if (opts.check) {
      const latest = refreshUpdateCache() ?? readUpdateCache()?.latest ?? null;
      if (latest === null) {
        log.warn(
          `could not reach the npm registry to check for updates (current: ${opts.current})`,
        );
        return 0;
      }
      if (isNewer(latest, opts.current)) {
        log.info(`update available: ${opts.current} → ${latest} (run \`vegastack update\`)`);
      } else {
        log.ok(`up to date (${opts.current})`);
      }
      return 0;
    }

    const registry = opts.registry ? await updateRegistry(opts) : { updated: [] };
    let cliUpdated = false;
    if (opts.cli) {
      cliUpdated = updateCli(opts);
    }

    let tools: Awaited<ReturnType<typeof installManagedTools>> | null = null;
    if (opts.tools) {
      if (cliUpdated && opts.cli) {
        const finalized = runPostCliToolUpdate(opts);
        if (finalized) {
          if (opts.json)
            log.json({ ok: true, registry, cli_updated: cliUpdated, tools: "finalized" });
          return 0;
        }
      }
      log.step("updating managed tools from this CLI's pinned manifest");
      tools = await installManagedTools({ force: opts.force });
    }

    const agents = await updateDetectedAgentSkills(opts);

    if (opts.json) {
      log.json({ ok: true, registry, cli_updated: cliUpdated, tools, agents });
    } else {
      if (registry.updated.length > 0)
        log.ok(`updated Registry packs: ${registry.updated.join(", ")}`);
      if (tools) log.ok("updated managed tools");
      if (!opts.cli) log.info("CLI self-update skipped because --no-cli is set");
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

async function updateDetectedAgentSkills(
  opts: UpdateOpts,
): Promise<Awaited<ReturnType<typeof reconcileDetectedAgentSkills>> | null> {
  const inspected = await inspectDetectedAgentSkills({ cwd: process.cwd(), scope: "global" });

  if (opts.json) {
    if (opts.yes && inspected.missing.length > 0) {
      return reconcileDetectedAgentSkills({
        cwd: process.cwd(),
        scope: "global",
        force: opts.force,
        dryRun: false,
      });
    }
    return { ...inspected, installed: [] };
  }

  if (inspected.detected.length === 0) {
    log.info("no detected agent hosts for global skill reconciliation");
    return { ...inspected, installed: [] };
  }

  if (inspected.missing.length === 0) {
    printAgentSkillInspection(inspected);
    return { ...inspected, installed: [] };
  }

  if (!opts.yes && process.stdin.isTTY && process.stderr.isTTY) {
    printAgentSkillInspection(inspected);
    const r = await prompts({
      type: "confirm",
      name: "install",
      message: `Install VegaStack skill for ${inspected.missing
        .map((a) => a.displayName)
        .join(", ")}?`,
      initial: true,
    });
    if (r.install !== true) {
      log.info("agent skill reconciliation skipped");
      return { ...inspected, installed: [] };
    }
  } else if (!opts.yes) {
    log.info(
      "detected agent hosts missing VegaStack skill; run `vegastack update --yes` or `vegastack skills reconcile` to install",
    );
    return { ...inspected, installed: [] };
  }

  const reconciled = await reconcileDetectedAgentSkills({
    cwd: process.cwd(),
    scope: "global",
    force: opts.force,
    dryRun: false,
  });
  printAgentSkillReconcile(reconciled);
  return reconciled;
}

function updateCli(opts: UpdateOpts): boolean {
  const latest = fetchLatestVersion();
  if (latest === null) {
    log.warn(`could not query the npm registry; attempting install anyway`);
  } else if (!isNewer(latest, opts.current)) {
    log.ok(`CLI already on latest (${opts.current})`);
    return false;
  } else {
    log.step(`upgrading CLI ${opts.current} → ${latest}`);
  }

  const args = ["i", "-g", `${PKG_NAME}@latest`];
  log.step(`running: npm ${args.join(" ")}`);
  const r = spawnCmdSync("npm", args, { stdio: "inherit" });
  if (r.error !== undefined) {
    throw r.error;
  }
  if ((r.status ?? 0) !== 0) {
    throw new Error(`npm exited ${r.status ?? "?"}; see output above`);
  }

  refreshUpdateCache();
  log.ok("CLI upgraded");
  return true;
}

async function updateRegistry(opts: UpdateOpts): Promise<{ updated: string[] }> {
  const entries = resolveRegistryEntries(opts);
  const updated: string[] = [];
  for (const entry of entries) {
    log.step(`updating Registry pack ${entry}`);
    await syncRegistryEntry(entry, opts.force ? { force: true } : {});
    updated.push(entry);
  }
  if (updated.length === 0) log.info("no Registry packs selected for update");
  return { updated };
}

function resolveRegistryEntries(opts: UpdateOpts): string[] {
  if (opts.allRegistry) return allInstalledRegistryEntryNames().sort();
  try {
    return readProjectRegistryEntryNames(process.cwd()).sort();
  } catch {
    return allInstalledRegistryEntryNames().sort();
  }
}

function runPostCliToolUpdate(opts: UpdateOpts): boolean {
  const args = ["update", "--no-cli", "--no-registry"];
  if (opts.force) args.push("--force");
  if (opts.yes) args.push("--yes");
  if (opts.json) args.push("--agent");
  log.step(`running post-upgrade managed tool reconciliation: vegastack ${args.join(" ")}`);
  const r = spawnCmdSync("vegastack", args, { stdio: "inherit" });
  if (r.error !== undefined || (r.status ?? 0) !== 0) {
    log.warn(
      "post-upgrade tool reconciliation with the new CLI failed; falling back to current CLI manifest",
    );
    return false;
  }
  return true;
}
