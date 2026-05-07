// Shared helpers for `vegastack ask` and `vegastack search` (and other commands
// that resolve registry entries from CLI flags + project config).

import { allInstalledRegistryEntryNames, ensureProjectInitialized } from "../lib/registry.js";
import { resolveProjectEntriesWithDetection } from "../lib/auto-detect-entries.js";
import { log } from "../lib/log.js";

export interface EntryResolutionOptions {
  all: boolean;
  entries?: string | string[];
}

/** Normalize a comma- or list-separated entry-name input into a sorted, deduped array. */
export function normalizeEntryNames(value: string | string[]): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [value])
        .flatMap((entry) => entry.split(","))
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  ].sort();
}

/**
 * Resolve registry entries from CLI options. Used by `ask`, `search`, and any
 * other command that follows the `--all` / `--entries` / project-default
 * convention. The `logLabel` is only used to surface the resolved entries to
 * the user.
 */
export function resolveRegistryEntriesFromOptions(
  opts: EntryResolutionOptions,
  logLabel = "searching",
): string[] {
  if (opts.entries) {
    return normalizeEntryNames(opts.entries);
  }
  if (opts.all) {
    const names = allInstalledRegistryEntryNames().sort();
    log.info(`${logLabel} all installed registry entries: ${names.join(", ") || "(none)"}`);
    return names;
  }
  ensureProjectInitialized(process.cwd());
  const names = resolveProjectEntriesWithDetection(process.cwd());
  log.info(`${logLabel} project registry entries: ${names.join(", ") || "(none)"}`);
  return names;
}
