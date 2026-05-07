// `vegastack doctor` — environment health check.
//
// Verifies Node, local Registry cache, managed tools, CLI freshness, and
// per-agent registration. Optional Registry verification checks artifact
// integrity against each installed entry's ARTIFACTS.json.
//
// Structure: `runDoctor` is a thin orchestrator. Each subsystem check is a
// pure helper returning `Check[]` (or `Check | null`). The non-JSON renderer
// is `printHumanOutput`; the JSON renderer is `emitJson`. This split keeps
// `runDoctor` at cyclomatic complexity ≤ 15 (rollup #82).

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALL_RENDERER_NAMES, getRenderer } from "../agents/index.js";
import {
  cloudflaredVersion,
  readCloudflaredMetadata,
  resolveCloudflaredBin,
} from "../lib/cloudflared.js";
import { detectHost } from "../lib/host-detect.js";
import { log } from "../lib/log.js";
import { pkgRoot, registryEntryDir } from "../lib/paths.js";
import {
  allInstalledRegistryEntryNames,
  fetchPublishedRegistryCatalog,
  readRegistryEntryVersion,
} from "../lib/registry.js";
import {
  readRipgrepMetadata,
  resolveRipgrepBin,
  ripgrepVersion,
  supportedRipgrepTarget,
} from "../lib/ripgrep.js";
import { isNewer, refreshUpdateCache } from "../lib/update-check.js";

function readCliVersion(): string {
  try {
    const pj = JSON.parse(readFileSync(join(pkgRoot(), "package.json"), "utf8")) as {
      version?: string;
    };
    return pj.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface DoctorOptions {
  json: boolean;
  verifyRegistry?: boolean;
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface VerifyResult {
  entry: string;
  ok: boolean;
  errors: string[];
}

interface AgentResult {
  agent: string;
  scope?: "global" | "project";
  host?: ReturnType<typeof detectHost>;
  status: {
    agent: string;
    installed: boolean;
    paths: string[];
    notes: string[];
    warnings: string[];
  };
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const installedEntries = allInstalledRegistryEntryNames();
  const currentCli = readCliVersion();

  const checks: Check[] = [
    nodeCheck(),
    ...registryCacheChecks(installedEntries),
    ...(await registryCatalogChecks(installedEntries)),
    jqCheck(),
    ripgrepCheck(),
    cloudflaredCheck(),
  ];
  const cliCheck = cliVersionCheck(currentCli);
  if (cliCheck) checks.push(cliCheck);

  const verifyResults = opts.verifyRegistry ? verifyInstalledRegistry(installedEntries) : undefined;
  if (verifyResults) checks.push(verifyAggregateCheck(verifyResults));

  const agentResults = await collectAgentResults();

  if (opts.json) {
    return emitJson({ checks, currentCli, installedEntries, verifyResults, agentResults });
  }

  printHumanOutput({ checks, verifyResults, agentResults });
  return exitCode(checks);
}

// ---------- Subsystem checks ----------

function nodeCheck(): Check {
  return {
    name: "Node.js",
    ok: Number(process.versions.node.split(".")[0]) >= 18,
    detail: `v${process.versions.node}`,
  };
}

function registryCacheChecks(installedEntries: string[]): Check[] {
  const checks: Check[] = [
    {
      name: "VegaStack Registry cache",
      ok: installedEntries.length > 0,
      detail:
        installedEntries.length > 0
          ? `${installedEntries.length} installed: ${installedEntries.join(", ")}`
          : "no Registry entries installed — run 'vegastack init'",
    },
  ];
  for (const entry of installedEntries) {
    const version = readRegistryEntryVersion(entry, registryEntryDir(entry));
    checks.push({
      name: `Registry version: ${entry}`,
      ok: version !== undefined,
      detail: version ?? "missing pack_version in MANIFEST.json — run 'vegastack registry update'",
    });
  }
  return checks;
}

function jqCheck(): Check {
  const jq = which("jq");
  return {
    name: "jq (optional)",
    ok: jq.found,
    detail: jq.found
      ? jq.version
      : "not found (optional; only needed for advanced manual JSON lookups)",
  };
}

function ripgrepCheck(): Check {
  const managed = readRipgrepMetadata();
  const bin = resolveRipgrepBin();
  return {
    name: "ripgrep",
    ok: bin !== null,
    detail: bin
      ? `${ripgrepVersion(bin) ?? "unknown version"} at ${bin}${
          managed ? ` (managed ${managed.asset})` : ""
        }`
      : `not installed for ${supportedRipgrepTarget()} — run 'vegastack init'`,
  };
}

function cloudflaredCheck(): Check {
  const managed = readCloudflaredMetadata();
  const bin = resolveCloudflaredBin();
  return {
    name: "cloudflared (optional)",
    ok: bin !== null,
    detail: bin
      ? `${cloudflaredVersion(bin) ?? "unknown version"} at ${bin}${
          managed ? ` (managed ${managed.asset})` : ""
        }`
      : "not installed (optional; run 'vegastack init' or use VEGASTACK_CLOUDFLARED_BIN for preview tunnels)",
  };
}

function cliVersionCheck(currentCli: string): Check | null {
  const latest = refreshUpdateCache();
  if (latest === null) return null;
  const stale = isNewer(latest, currentCli);
  return {
    name: "CLI version",
    ok: !stale,
    detail: stale
      ? `${currentCli} (newer available: ${latest} — run \`vegastack update\`)`
      : `${currentCli} (latest)`,
  };
}

function verifyAggregateCheck(verifyResults: VerifyResult[]): Check {
  const failed = verifyResults.filter((r) => !r.ok).length;
  const allOk = failed === 0;
  return {
    name: "Registry artifact verification",
    ok: allOk,
    detail: allOk
      ? `${verifyResults.length} entries verified`
      : `${failed}/${verifyResults.length} entries failed verification`,
  };
}

async function collectAgentResults(): Promise<AgentResult[]> {
  const cwd = process.cwd();
  return Promise.all(
    ALL_RENDERER_NAMES.map(async (n) => {
      const r = getRenderer(n);
      if (!r) {
        return {
          agent: n,
          status: {
            agent: n,
            installed: false,
            paths: [],
            notes: ["unknown agent"],
            warnings: [],
          },
        };
      }
      const scope: "global" | "project" = r.supportsScope("global") ? "global" : "project";
      return {
        agent: n,
        scope,
        host: detectHost(n),
        status: await r.status({ scope, cwd, force: false, dryRun: false }),
      };
    }),
  );
}

// ---------- Renderers ----------

function emitJson(args: {
  checks: Check[];
  currentCli: string;
  installedEntries: string[];
  verifyResults: VerifyResult[] | undefined;
  agentResults: AgentResult[];
}): number {
  const ok = exitCode(args.checks) === 0;
  log.json({
    ok,
    cli_version: args.currentCli,
    checks: args.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
    registry_entries: args.installedEntries,
    verify: args.verifyResults,
    agents: args.agentResults,
  });
  return ok ? 0 : 1;
}

function printHumanOutput(args: {
  checks: Check[];
  verifyResults: VerifyResult[] | undefined;
  agentResults: AgentResult[];
}): void {
  for (const c of args.checks) printCheckLine(c);
  if (args.verifyResults) printVerifyDetail(args.verifyResults);
  printAgentSection(args.agentResults);
}

function printCheckLine(c: Check): void {
  if (c.ok) log.ok(`${c.name}: ${c.detail}`);
  else if (c.name.includes("optional")) log.warn(`${c.name}: ${c.detail}`);
  else log.err(`${c.name}: ${c.detail}`);
}

function printVerifyDetail(verifyResults: VerifyResult[]): void {
  process.stderr.write("\nRegistry verification:\n");
  for (const v of verifyResults) {
    if (v.ok) {
      log.ok(`  ${v.entry}: ok`);
      continue;
    }
    log.err(`  ${v.entry}: ${v.errors.length} error(s)`);
    for (const e of v.errors.slice(0, 3)) log.warn(`    ${e}`);
  }
}

function printAgentSection(agentResults: AgentResult[]): void {
  process.stderr.write("\nAgent registration:\n");
  for (const ar of agentResults) printAgentRow(ar);
}

function printAgentRow(ar: AgentResult): void {
  const skillRegistered = ar.status.installed;
  const hostInstalled = ar.host?.installed ?? false;
  const path0 = ar.status.paths[0] ?? "";
  const hostMark = hostInstalled ? "host ok" : "host -";
  const skillMark = skillRegistered ? "skill ok" : "skill -";
  const line = `${ar.agent.padEnd(12)} ${hostMark}  ${skillMark}  ${path0}`;
  if (hostInstalled && skillRegistered) log.ok(line);
  else log.info(line);
  if (hostInstalled && !skillRegistered) {
    log.info(`  -> run \`vegastack skills install --agent ${ar.agent}\` to register`);
  } else if (!hostInstalled && skillRegistered) {
    log.info(
      `  -> host not detected (${ar.host?.evidence ?? "?"}); skill is an orphan, safe to remove`,
    );
  }
  for (const w of ar.status.warnings) log.warn(`  ${w}`);
}

// ---------- Registry catalog (network) ----------

async function registryCatalogChecks(installedEntries: string[]): Promise<Check[]> {
  if (installedEntries.length === 0) return [];
  try {
    const catalog = await fetchPublishedRegistryCatalog();
    const checks: Check[] = [
      {
        name: "Registry catalog signature",
        ok: true,
        detail: "published REGISTRY.json verified",
      },
    ];
    for (const entry of installedEntries) {
      checks.push(publishedEntryCheck(entry, catalog));
    }
    return checks;
  } catch (e) {
    return [
      {
        name: "Registry catalog signature (optional)",
        ok: false,
        detail: `could not fetch/verify published catalog: ${(e as Error).message}`,
      },
    ];
  }
}

interface PublishedCatalog {
  entries: Record<string, { pack_version?: string; version?: string } | undefined>;
}

function publishedEntryCheck(entry: string, catalog: PublishedCatalog): Check {
  const remote = catalog.entries[entry];
  if (!remote) {
    return {
      name: `Published Registry pack: ${entry}`,
      ok: false,
      detail: "installed locally but missing from published REGISTRY.json",
    };
  }
  const localVersion = readRegistryEntryVersion(entry, registryEntryDir(entry));
  const remoteVersion = remote.pack_version ?? remote.version;
  return {
    name: `Published Registry version: ${entry}`,
    ok: localVersion !== undefined && remoteVersion !== undefined && localVersion === remoteVersion,
    detail: publishedVersionDetail(entry, localVersion, remoteVersion),
  };
}

function publishedVersionDetail(
  entry: string,
  localVersion: string | undefined,
  remoteVersion: string | undefined,
): string {
  if (localVersion === undefined) return "local version missing";
  if (remoteVersion === undefined) return "published version missing";
  if (localVersion === remoteVersion) return localVersion;
  return `local ${localVersion}, published ${remoteVersion} — run 'vegastack registry update ${entry}'`;
}

// ---------- Registry artifact verification ----------

function verifyInstalledRegistry(entries: string[]): VerifyResult[] {
  return entries.map((entry) => verifyRegistryEntry(entry));
}

function verifyRegistryEntry(entry: string): VerifyResult {
  const root = registryEntryDir(entry);
  const errors: string[] = [];
  const manifest = readJsonObject(join(root, "MANIFEST.json"), errors);
  if (manifest) verifyManifest(manifest, entry, errors);

  const artifacts = readJsonObject(join(root, "ARTIFACTS.json"), errors) as
    | { schema_version?: unknown; files?: unknown }
    | undefined;
  if (!artifacts) return { entry, ok: errors.length === 0, errors };
  if (artifacts.schema_version !== 1) {
    errors.push(
      `ARTIFACTS.json schema_version must be 1; got ${JSON.stringify(artifacts.schema_version)}`,
    );
  }
  if (!Array.isArray(artifacts.files)) {
    errors.push("ARTIFACTS.json files must be an array");
    return { entry, ok: errors.length === 0, errors };
  }
  for (const item of artifacts.files) verifyArtifactFile(item, root, errors);
  return { entry, ok: errors.length === 0, errors };
}

function verifyManifest(manifest: Record<string, unknown>, entry: string, errors: string[]): void {
  if (manifest.schema_version !== 2) {
    errors.push(
      `MANIFEST.json schema_version must be 2; got ${JSON.stringify(manifest.schema_version)}`,
    );
  }
  if (manifest.id !== entry) {
    errors.push(`MANIFEST.json id must be ${entry}; got ${JSON.stringify(manifest.id)}`);
  }
  if (typeof manifest.pack_version !== "string" || manifest.pack_version.length === 0) {
    errors.push("MANIFEST.json missing pack_version");
  }
}

function verifyArtifactFile(item: unknown, root: string, errors: string[]): void {
  if (!item || typeof item !== "object") {
    errors.push("ARTIFACTS.json contains a non-object file entry");
    return;
  }
  const file = item as { path?: unknown; bytes?: unknown; sha256?: unknown };
  if (typeof file.path !== "string" || !safeRelativePath(file.path)) {
    errors.push(`unsafe artifact path: ${JSON.stringify(file.path)}`);
    return;
  }
  if (typeof file.bytes !== "number" || !Number.isInteger(file.bytes) || file.bytes < 0) {
    errors.push(`invalid byte count for ${file.path}`);
    return;
  }
  if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
    errors.push(`invalid sha256 for ${file.path}`);
    return;
  }
  const target = join(root, file.path);
  if (!existsSync(target)) {
    errors.push(`missing artifact ${file.path}`);
    return;
  }
  const bytes = statSync(target).size;
  const digest = createHash("sha256").update(readFileSync(target)).digest("hex");
  if (bytes !== file.bytes || digest !== file.sha256) {
    errors.push(`checksum mismatch for ${file.path}`);
  }
}

function readJsonObject(file: string, errors: string[]): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${file} must be a JSON object`);
      return undefined;
    }
    return raw as Record<string, unknown>;
  } catch (e) {
    errors.push(`${file} missing/invalid: ${(e as Error).message}`);
    return undefined;
  }
}

function safeRelativePath(value: string): boolean {
  return (
    value !== "" &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

function exitCode(checks: Check[]): number {
  const required = checks.filter((c) => !c.name.includes("optional"));
  return required.every((c) => c.ok) ? 0 : 1;
}

export interface WhichResult {
  found: boolean;
  version: string;
}

export function which(cmd: string): WhichResult {
  // On Windows, executables are named foo.exe / foo.cmd / foo.bat. Calling
  // spawnSync("jq", …) without shell:true returns ENOENT because Node does
  // not honour PATHEXT itself. Use shell:true on Windows so the system
  // resolver finds the right extension; this is safe because `cmd` is a
  // hard-coded internal value (no user input reaches this function).
  const useShell = process.platform === "win32";
  const result = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: useShell });
  if (result.error !== undefined || result.status !== 0) return { found: false, version: "" };
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const firstLine = combined.split("\n")[0] ?? "";
  return { found: true, version: firstLine.trim() };
}
