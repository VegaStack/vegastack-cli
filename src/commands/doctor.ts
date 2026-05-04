// `vegastack doctor` — environment health check.
//
// Verifies Node, local Registry cache, managed tools, CLI freshness, and
// per-agent registration. Optional Registry verification checks artifact
// integrity against each installed entry's ARTIFACTS.json.

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

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const checks: Check[] = [];

  checks.push({
    name: "Node.js",
    ok: Number(process.versions.node.split(".")[0]) >= 18,
    detail: `v${process.versions.node}`,
  });

  const installedEntries = allInstalledRegistryEntryNames();
  checks.push({
    name: "VegaStack Registry cache",
    ok: installedEntries.length > 0,
    detail:
      installedEntries.length > 0
        ? `${installedEntries.length} installed: ${installedEntries.join(", ")}`
        : "no Registry entries installed — run 'vegastack init'",
  });

  for (const entry of installedEntries) {
    const version = readRegistryEntryVersion(entry, registryEntryDir(entry));
    checks.push({
      name: `Registry version: ${entry}`,
      ok: version !== undefined,
      detail: version ?? "missing pack_version in MANIFEST.json — run 'vegastack registry update'",
    });
  }

  checks.push(...(await registryCatalogChecks(installedEntries)));

  const jq = which("jq");
  checks.push({
    name: "jq (optional)",
    ok: jq.found,
    detail: jq.found
      ? jq.version
      : "not found (optional; only needed for advanced manual JSON lookups)",
  });

  const managedRg = readRipgrepMetadata();
  const rgBin = resolveRipgrepBin();
  checks.push({
    name: "ripgrep",
    ok: rgBin !== null,
    detail: rgBin
      ? `${ripgrepVersion(rgBin) ?? "unknown version"} at ${rgBin}${
          managedRg ? ` (managed ${managedRg.asset})` : ""
        }`
      : `not installed for ${supportedRipgrepTarget()} — run 'vegastack init'`,
  });

  const managedCloudflared = readCloudflaredMetadata();
  const cloudflaredBin = resolveCloudflaredBin();
  checks.push({
    name: "cloudflared (optional)",
    ok: cloudflaredBin !== null,
    detail: cloudflaredBin
      ? `${cloudflaredVersion(cloudflaredBin) ?? "unknown version"} at ${cloudflaredBin}${
          managedCloudflared ? ` (managed ${managedCloudflared.asset})` : ""
        }`
      : "not installed (optional; run 'vegastack init' or use VEGASTACK_CLOUDFLARED_BIN for preview tunnels)",
  });

  const currentCli = readCliVersion();
  const latestCli = refreshUpdateCache();
  if (latestCli !== null) {
    const stale = isNewer(latestCli, currentCli);
    checks.push({
      name: "CLI version",
      ok: !stale,
      detail: stale
        ? `${currentCli} (newer available: ${latestCli} — run \`vegastack update\`)`
        : `${currentCli} (latest)`,
    });
  }

  let verifyResults: VerifyResult[] | undefined;
  if (opts.verifyRegistry) {
    verifyResults = verifyInstalledRegistry(installedEntries);
    const allOk = verifyResults.every((r) => r.ok);
    checks.push({
      name: "Registry artifact verification",
      ok: allOk,
      detail: allOk
        ? `${verifyResults.length} entries verified`
        : `${verifyResults.filter((r) => !r.ok).length}/${verifyResults.length} entries failed verification`,
    });
  }

  const cwd = process.cwd();
  const agentResults = await Promise.all(
    ALL_RENDERER_NAMES.map(async (n) => {
      const r = getRenderer(n);
      if (!r)
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
      const scope: "global" | "project" = r.supportsScope("global") ? "global" : "project";
      return {
        agent: n,
        scope,
        host: detectHost(n),
        status: await r.status({ scope, cwd, force: false, dryRun: false }),
      };
    }),
  );

  if (opts.json) {
    log.json({
      cli_version: currentCli,
      checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
      registry_entries: installedEntries,
      verify: verifyResults,
      agents: agentResults,
    });
    return exitCode(checks);
  }

  for (const c of checks) {
    if (c.ok) log.ok(`${c.name}: ${c.detail}`);
    else if (c.name.includes("optional")) log.warn(`${c.name}: ${c.detail}`);
    else log.err(`${c.name}: ${c.detail}`);
  }

  if (verifyResults) {
    process.stderr.write("\nRegistry verification:\n");
    for (const v of verifyResults) {
      if (v.ok) log.ok(`  ${v.entry}: ok`);
      else {
        log.err(`  ${v.entry}: ${v.errors.length} error(s)`);
        for (const e of v.errors.slice(0, 3)) log.warn(`    ${e}`);
      }
    }
  }

  process.stderr.write("\nAgent registration:\n");
  for (const ar of agentResults) {
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

  return exitCode(checks);
}

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
      const remote = catalog.entries[entry];
      if (!remote) {
        checks.push({
          name: `Published Registry pack: ${entry}`,
          ok: false,
          detail: "installed locally but missing from published REGISTRY.json",
        });
        continue;
      }
      const localVersion = readRegistryEntryVersion(entry, registryEntryDir(entry));
      const remoteVersion = remote.pack_version ?? remote.version;
      checks.push({
        name: `Published Registry version: ${entry}`,
        ok:
          localVersion !== undefined &&
          remoteVersion !== undefined &&
          localVersion === remoteVersion,
        detail:
          localVersion === undefined
            ? "local version missing"
            : remoteVersion === undefined
              ? "published version missing"
              : localVersion === remoteVersion
                ? localVersion
                : `local ${localVersion}, published ${remoteVersion} — run 'vegastack registry update ${entry}'`,
      });
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

function verifyInstalledRegistry(entries: string[]): VerifyResult[] {
  return entries.map((entry) => verifyRegistryEntry(entry));
}

function verifyRegistryEntry(entry: string): VerifyResult {
  const root = registryEntryDir(entry);
  const errors: string[] = [];
  const manifestPath = join(root, "MANIFEST.json");
  const artifactsPath = join(root, "ARTIFACTS.json");

  const manifest = readJsonObject(manifestPath, errors);
  if (manifest) {
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

  const artifacts = readJsonObject(artifactsPath, errors) as
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
  for (const item of artifacts.files) {
    if (!item || typeof item !== "object") {
      errors.push("ARTIFACTS.json contains a non-object file entry");
      continue;
    }
    const file = item as { path?: unknown; bytes?: unknown; sha256?: unknown };
    if (typeof file.path !== "string" || !safeRelativePath(file.path)) {
      errors.push(`unsafe artifact path: ${JSON.stringify(file.path)}`);
      continue;
    }
    if (typeof file.bytes !== "number" || !Number.isInteger(file.bytes) || file.bytes < 0) {
      errors.push(`invalid byte count for ${file.path}`);
      continue;
    }
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      errors.push(`invalid sha256 for ${file.path}`);
      continue;
    }
    const target = join(root, file.path);
    if (!existsSync(target)) {
      errors.push(`missing artifact ${file.path}`);
      continue;
    }
    const bytes = statSync(target).size;
    const digest = createHash("sha256").update(readFileSync(target)).digest("hex");
    if (bytes !== file.bytes || digest !== file.sha256) {
      errors.push(`checksum mismatch for ${file.path}`);
    }
  }
  return { entry, ok: errors.length === 0, errors };
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

interface WhichResult {
  found: boolean;
  version: string;
}

function which(cmd: string): WhichResult {
  const result = spawnSync(cmd, ["--version"], { encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) return { found: false, version: "" };
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const firstLine = combined.split("\n")[0] ?? "";
  return { found: true, version: firstLine.trim() };
}
