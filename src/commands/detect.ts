import { detectProject } from "../lib/detect.js";
import { log, printError } from "../lib/log.js";

export interface DetectOptions {
  json: boolean;
}

export async function runDetect(opts: DetectOptions): Promise<number> {
  try {
    const detection = detectProject(process.cwd());
    if (opts.json) {
      log.json(detection);
    } else {
      printDetectionSummary(detection);
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function printDetectionSummary(detection: ReturnType<typeof detectProject>): void {
  log.info(`project: ${detection.root}`);
  log.info(`status: ${detection.status}`);
  if (detection.stack.package_manager) {
    log.info(
      `package manager: ${detection.stack.package_manager.name} (${detection.stack.package_manager.evidence.join(", ")})`,
    );
  }
  if (detection.stack.frameworks.length > 0) {
    log.info(`frameworks: ${detection.stack.frameworks.map((f) => f.name).join(", ")}`);
  }
  if (detection.deploy.targets.length > 0) log.info(`deploy: ${detection.deploy.targets.join(", ")}`);
  if (detection.ci.providers.length > 0) log.info(`ci: ${detection.ci.providers.join(", ")}`);
  log.info(`recommended registry entries: ${detection.registry.recommended_entries.join(", ") || "none"}`);
  if (detection.stale?.changed) {
    log.warn("cached project detection differs from current repo; run `vegastack refresh` to update .vegastack/vegastack.yml");
  }
}
