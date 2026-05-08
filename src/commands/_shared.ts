// Shared helpers for `vegastack ask` and `vegastack search` (and other commands
// that resolve Registry packs from CLI flags + project config).

import { allInstalledRegistryEntryNames, ensureProjectInitialized } from "../lib/registry.js";
import { resolveProjectEntriesWithDetection } from "../lib/auto-detect-entries.js";
import { log } from "../lib/log.js";
import { projectConfigExists } from "../lib/project-config.js";
import { VegaStackError } from "../lib/errors.js";

export interface EntryResolutionOptions {
  all: boolean;
  entries?: string | string[];
}

/** Normalize a comma- or list-separated entry-name input into a sorted, deduped array. */
export function normalizeEntryNames(value: string | string[]): string[] {
  const names = [
    ...new Set(
      (Array.isArray(value) ? value : [value])
        .flatMap((entry) => entry.split(","))
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  ].sort();
  for (const name of names) validateEntryName(name);
  return names;
}

/**
 * Resolve Registry packs from CLI options. Used by `ask`, `search`, and any
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
    log.info(`${logLabel} all installed Registry packs: ${names.join(", ") || "(none)"}`);
    return names;
  }
  if (!projectConfigExists(process.cwd())) {
    throw new VegaStackError(
      "ValidationError",
      "VegaStack project harness not initialized in this directory. Run `vegastack init`, or pass `--pack <pack>` for a scoped lookup, or pass `--all` to search installed packs.",
      { context: { cwd: process.cwd(), expected: ".vegastack/vegastack.yml" } },
    );
  }
  ensureProjectInitialized(process.cwd());
  const names = resolveProjectEntriesWithDetection(process.cwd());
  log.info(`${logLabel} project Registry packs: ${names.join(", ") || "(none)"}`);
  return names;
}

function validateEntryName(name: string): void {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) {
    throw new VegaStackError("ValidationError", `'${name}' is not a valid Registry pack name`);
  }
}
