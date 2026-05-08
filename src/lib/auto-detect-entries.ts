import { detectProject } from "./detect.js";
import { isRegistryEntryInstalled, readProjectRegistryEntryNames } from "./registry.js";
import { log } from "./log.js";

export function resolveProjectEntriesWithDetection(cwd: string): string[] {
  const locked = new Set(readProjectRegistryEntryNames(cwd));
  const detection = detectProject(cwd);
  const supplemental: string[] = [];
  const missing: string[] = [];

  for (const entry of detection.registry.recommended_entries) {
    if (locked.has(entry)) continue;
    if (isRegistryEntryInstalled(entry)) {
      locked.add(entry);
      supplemental.push(entry);
    } else {
      missing.push(entry);
    }
  }

  if (supplemental.length > 0) {
    log.info(`auto-detected supplemental Registry packs: ${supplemental.sort().join(", ")}`);
  }
  if (missing.length > 0) {
    log.warn(
      `detected additional Registry packs not installed: ${[...new Set(missing)].sort().join(", ")}; run \`vegastack refresh\` and \`vegastack registry update\``,
    );
  }
  if (detection.stale?.changed) {
    log.warn("project detection changed since last refresh; run `vegastack refresh`");
  }
  return [...locked].sort();
}
