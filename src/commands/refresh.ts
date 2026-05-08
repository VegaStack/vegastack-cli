import prompts from "prompts";
import { buildProjectRefreshPlan, writeProjectRefreshPlan } from "../lib/project-state.js";
import { log, printError } from "../lib/log.js";

export interface RefreshOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
}

export async function runRefresh(opts: RefreshOptions): Promise<number> {
  try {
    const plan = buildProjectRefreshPlan(process.cwd());
    if (opts.dryRun) {
      if (opts.json) log.json({ dry_run: true, ...plan });
      else printRefreshSummary(plan, true);
      return 0;
    }

    if (!opts.yes && !opts.json) {
      printRefreshSummary(plan, false);
      const r = await prompts({
        type: "confirm",
        name: "apply",
        message: "Update .vegastack/vegastack.yml with current detection?",
        initial: true,
      });
      if (r.apply !== true) {
        log.info("refresh cancelled");
        return 0;
      }
    }

    writeProjectRefreshPlan(plan);
    if (opts.json) log.json({ ok: true, ...plan });
    else log.ok(`updated ${plan.project_config}`);
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function printRefreshSummary(
  plan: ReturnType<typeof buildProjectRefreshPlan>,
  dryRun: boolean,
): void {
  log.info(`${dryRun ? "would update" : "update"} ${plan.project_config}`);
  log.info(`changed: ${plan.changed ? "yes" : "no"}`);
  log.info(
    `recommended Registry packs: ${plan.detection.registry.recommended_entries.join(", ") || "none"}`,
  );
}
