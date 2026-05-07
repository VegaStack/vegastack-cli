import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { projectConfigPath } from "./paths.js";

export interface VegaStackProjectConfig {
  schema_version: 1;
  registry?: {
    entries?: Record<string, ProjectRegistryEntry>;
    recommended_entries?: string[];
  };
  project?: {
    package_manager?: string;
    commands?: Record<string, string>;
  };
  scan?: Record<string, unknown>;
  preview?: Record<string, unknown>;
  agents?: {
    shared_instructions?: string;
  };
}

export interface ProjectRegistryEntry {
  source?: string;
  version?: string;
}

export function projectConfigExists(cwd: string): boolean {
  return fs.existsSync(projectConfigPath(cwd));
}

export function readProjectConfig(cwd: string): VegaStackProjectConfig {
  const file = projectConfigPath(cwd);
  const parsed = yaml.load(fs.readFileSync(file, "utf8"));
  if (!isRecord(parsed)) return { schema_version: 1 };
  return normalizeProjectConfig(parsed);
}

export function readProjectConfigIfExists(cwd: string): VegaStackProjectConfig | undefined {
  if (!projectConfigExists(cwd)) return undefined;
  try {
    return readProjectConfig(cwd);
  } catch {
    return undefined;
  }
}

export function writeProjectConfig(cwd: string, config: VegaStackProjectConfig): void {
  const file = projectConfigPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, dumpProjectConfig(config));
}

export function dumpProjectConfig(config: VegaStackProjectConfig): string {
  return yaml.dump(normalizeProjectConfig(config as unknown as Record<string, unknown>), {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  });
}

export function projectRegistryEntryNames(config: VegaStackProjectConfig): string[] {
  return Object.keys(config.registry?.entries ?? {}).sort();
}

export function normalizeProjectConfig(raw: Record<string, unknown>): VegaStackProjectConfig {
  const out: VegaStackProjectConfig = { schema_version: 1 };
  const registry = isRecord(raw.registry) ? raw.registry : {};
  const entries = isRecord(registry.entries)
    ? Object.fromEntries(
        Object.entries(registry.entries)
          .filter(([, value]) => isRecord(value))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, value]) => [name, filterRegistryEntry(value as Record<string, unknown>)]),
      )
    : {};
  const recommended = Array.isArray(registry.recommended_entries)
    ? registry.recommended_entries.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (Object.keys(entries).length > 0 || recommended.length > 0) {
    out.registry = {
      ...(Object.keys(entries).length > 0 ? { entries } : {}),
      ...(recommended.length > 0 ? { recommended_entries: [...new Set(recommended)].sort() } : {}),
    };
  }

  const project = isRecord(raw.project) ? raw.project : {};
  const commands = isRecord(project.commands)
    ? Object.fromEntries(
        Object.entries(project.commands).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
  const packageManager =
    typeof project.package_manager === "string" ? project.package_manager : undefined;
  if (packageManager !== undefined || Object.keys(commands).length > 0) {
    out.project = {
      ...(packageManager ? { package_manager: packageManager } : {}),
      ...(Object.keys(commands).length > 0 ? { commands } : {}),
    };
  }

  if (isRecord(raw.scan)) out.scan = raw.scan;
  if (isRecord(raw.preview)) out.preview = raw.preview;
  if (isRecord(raw.agents)) {
    const shared = raw.agents.shared_instructions;
    if (typeof shared === "string") out.agents = { shared_instructions: shared };
  }
  return out;
}

function filterRegistryEntry(raw: Record<string, unknown>): ProjectRegistryEntry {
  return {
    ...(typeof raw.source === "string" ? { source: raw.source } : {}),
    ...(typeof raw.version === "string" ? { version: raw.version } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
