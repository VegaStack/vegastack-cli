// `vegastack search <query>` — deterministic exact Registry source lookup.

import {
  allInstalledRegistryEntryNames,
  ensureProjectInitialized,
  readProjectRegistryEntryNames,
} from "../lib/registry.js";
import { VegaStackError } from "../lib/errors.js";
import { log, printError } from "../lib/log.js";
import { searchRegistry } from "../lib/registry-search.js";

export interface SearchCommandOptions {
  all: boolean;
  entries?: string;
  max?: number;
  regex: boolean;
  ignoreCase: boolean;
  pretty: boolean;
  installTools: boolean;
}

export async function runSearch(query: string, opts: SearchCommandOptions): Promise<number> {
  if (!query || query.trim() === "") {
    return printError(new VegaStackError("ValidationError", 'usage: vegastack search "<query>"'));
  }
  try {
    const entries = resolveSearchEntries(opts);
    const searchOpts: Parameters<typeof searchRegistry>[0] = {
      entries,
      query,
      regex: opts.regex,
      ignoreCase: opts.ignoreCase,
      installTools: opts.installTools,
    };
    if (opts.max !== undefined) searchOpts.max = opts.max;
    const result = await searchRegistry(searchOpts);
    process.stdout.write(
      (opts.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)) + "\n",
    );
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function resolveSearchEntries(opts: SearchCommandOptions): string[] {
  if (opts.entries) {
    return opts.entries
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .sort();
  }
  if (opts.all) {
    const names = allInstalledRegistryEntryNames().sort();
    log.info(`searching all installed registry entries: ${names.join(", ") || "(none)"}`);
    return names;
  }
  ensureProjectInitialized(process.cwd());
  const names = readProjectRegistryEntryNames(process.cwd());
  log.info(`searching project registry entries: ${names.join(", ") || "(none)"}`);
  return names;
}
