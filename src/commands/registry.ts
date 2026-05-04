// `vegastack registry` — local VegaStack Registry management.

import {
  allInstalledRegistryEntryNames,
  ensureProjectInitialized,
  listPublishedRegistryEntryStatuses,
  readProjectRegistryEntryNames,
  syncRegistryEntry,
} from "../lib/registry.js";
import { log, printError } from "../lib/log.js";

export interface RegistryOptions {
  json?: boolean;
  force?: boolean;
}

export interface RegistryUpdateOptions extends RegistryOptions {
  entry?: string;
  all?: boolean;
}

export async function runRegistryList(opts: RegistryOptions = {}): Promise<number> {
  try {
    const entries = await listPublishedRegistryEntryStatuses();
    if (opts.json) {
      log.json({ registry: entries });
      return 0;
    }
    process.stderr.write("\nVegaStack Registry\n\n");
    for (const p of entries) {
      const state = p.installed ? "installed" : "not installed";
      const selected = p.selected ? ", selected" : "";
      const version = p.version ? `, ${p.version}` : "";
      process.stderr.write(`  ${p.name.padEnd(16)} ${state}${selected}${version}\n`);
      process.stderr.write(`  ${"".padEnd(16)} ${p.title} (${p.shape})\n`);
    }
    process.stderr.write("\n");
    return 0;
  } catch (e) {
    return printError(e);
  }
}

export async function runRegistryStatus(opts: RegistryOptions = {}): Promise<number> {
  return runRegistryList(opts);
}

export async function runRegistryUpdate(opts: RegistryUpdateOptions = {}): Promise<number> {
  try {
    const entries = resolveUpdateEntries(opts);
    const updated: string[] = [];
    for (const entry of entries) {
      await syncRegistryEntry(entry, opts.force ? { force: true } : {});
      updated.push(entry);
    }
    if (opts.json) {
      log.json({ ok: true, updated });
    } else {
      log.ok(`updated registry entries: ${updated.join(", ") || "(none)"}`);
    }
    return 0;
  } catch (e) {
    return printError(e);
  }
}

function resolveUpdateEntries(opts: RegistryUpdateOptions): string[] {
  if (opts.entry) return [opts.entry].sort();
  if (opts.all) return allInstalledRegistryEntryNames().sort();
  ensureProjectInitialized(process.cwd());
  return readProjectRegistryEntryNames(process.cwd()).sort();
}
