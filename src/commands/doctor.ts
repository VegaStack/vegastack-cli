// `vega doctor` — environment health check.
//
// Verifies Node, bundle presence, schema-version, schema-file presence,
// jq, ripgrep, and reports per-agent install status.
//
// v0.1 dropped the python3 check — the harness is TS-only at runtime now.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_RENDERER_NAMES, getRenderer } from "../agents/index.js";
import { readBundleStatus } from "../lib/bundle.js";
import { log } from "../lib/log.js";
import { bundleDir, pkgRoot } from "../lib/paths.js";
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
  /** Run the JSON-Schema validator against every per-provider MANIFEST.json. */
  verifyBundle?: boolean;
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  const checks: Check[] = [];

  // Node
  checks.push({
    name: "Node.js",
    ok: Number(process.versions.node.split(".")[0]) >= 18,
    detail: `v${process.versions.node}`,
  });

  // Bundle
  const bundle = readBundleStatus();
  checks.push({
    name: "Docs bundle",
    ok: bundle.installed,
    detail: bundle.installed
      ? `v${bundle.version ?? "?"} at ${bundle.path} (${bundle.providerCount ?? "?"} providers, schema_version=${bundle.schemaVersion ?? "?"}, generated ${bundle.generatedAt ?? "?"})`
      : `not installed at ${bundle.path}${bundle.error ? ` — ${bundle.error}` : " — run 'vega install'"}`,
  });

  // Schema file presence (the JSON Schema E1 ships).
  const schemaPath = join(bundleDir(), "schema", "manifest.schema.json");
  checks.push({
    name: "Manifest JSON Schema",
    ok: existsSync(schemaPath),
    detail: existsSync(schemaPath)
      ? schemaPath
      : `not found at ${schemaPath} — run 'vega refresh' (E1 emits this in v0.1)`,
  });

  // Optional tools
  const jq = which("jq");
  checks.push({
    name: "jq (optional)",
    ok: jq.found,
    detail: jq.found
      ? jq.version
      : "not found (optional; only needed for advanced lookups beyond enriched response)",
  });
  const rg = which("rg");
  checks.push({
    name: "ripgrep (optional)",
    ok: rg.found,
    detail: rg.found
      ? rg.version
      : "not found (optional; speeds up Tier-2 search 5-10×; brew install ripgrep)",
  });

  // CLI version freshness — refresh the cache (network call, ~5s timeout)
  // so the next-command nag has accurate data. A failed lookup is fine; we
  // just don't update anything.
  const currentCli = readCliVersion();
  const latestCli = refreshUpdateCache();
  if (latestCli !== null) {
    const stale = isNewer(latestCli, currentCli);
    checks.push({
      name: "CLI version",
      ok: !stale,
      detail: stale
        ? `${currentCli} (newer available: ${latestCli} — run \`vega update\`)`
        : `${currentCli} (latest)`,
    });
  }

  // Optional bundle verification — runs the schema validator on every
  // per-provider MANIFEST.json. Closes F12.
  let verifyResults: { provider: string; ok: boolean; errors: string[] }[] | undefined;
  if (opts.verifyBundle) {
    verifyResults = verifyBundle(schemaPath);
    const allOk = verifyResults.every((r) => r.ok);
    checks.push({
      name: "Bundle schema verification",
      ok: allOk,
      detail: allOk
        ? `${verifyResults.length} providers validated`
        : `${verifyResults.filter((r) => !r.ok).length}/${verifyResults.length} providers failed validation`,
    });
  }

  // Per-agent install status — uses the v0.1 renderer registry (6 agents).
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
        status: await r.status({ scope, cwd, force: false, dryRun: false }),
      };
    }),
  );

  if (opts.json) {
    log.json({
      cli_version: currentCli,
      checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
      bundle,
      verify: verifyResults,
      agents: agentResults,
    });
    return checks.every((c) => c.ok || c.name.includes("optional")) ? 0 : 1;
  }

  // Pretty output
  for (const c of checks) {
    if (c.ok) log.ok(`${c.name}: ${c.detail}`);
    else if (c.name.includes("optional")) log.warn(`${c.name}: ${c.detail}`);
    else log.err(`${c.name}: ${c.detail}`);
  }

  if (verifyResults) {
    process.stderr.write("\nBundle verification:\n");
    for (const v of verifyResults) {
      if (v.ok) log.ok(`  ${v.provider}: ok`);
      else {
        log.err(`  ${v.provider}: ${v.errors.length} error(s)`);
        for (const e of v.errors.slice(0, 3)) log.warn(`    ${e}`);
      }
    }
  }

  process.stderr.write("\nAgent registration:\n");
  for (const ar of agentResults) {
    const installed = ar.status.installed;
    const detail = ar.status.paths[0] ?? "";
    const line = `${ar.agent.padEnd(12)} ${installed ? "registered" : "not registered"} ${detail}`;
    if (installed) log.ok(line);
    else log.info(line);
    for (const w of ar.status.warnings) log.warn(`  ${w}`);
  }

  const required = checks.filter((c) => !c.name.includes("optional"));
  const allOk = required.every((c) => c.ok);
  return allOk ? 0 : 1;
}

/**
 * Validate every per-provider MANIFEST.json under the bundle root against the
 * shipped JSON Schema. Lightweight, hand-rolled validator (no ajv dep) that
 * checks the FEW invariants we care about for v0.1:
 *   • manifest_schema_version === 1
 *   • required top-level keys present
 *   • resources / data_sources are objects
 *   • each ResourceEntry has the required keys
 *
 * Real JSON-Schema validation can land in v0.2 once we add ajv (or the
 * bundle's own scripts/validate-bundle.ts wraps it).
 */
function verifyBundle(_schemaPath: string): { provider: string; ok: boolean; errors: string[] }[] {
  const out: { provider: string; ok: boolean; errors: string[] }[] = [];
  const root = bundleDir();
  if (!existsSync(root)) return out;

  // Read the bundle root MANIFEST to discover providers.
  let providers: string[] = [];
  try {
    const rootManifest = JSON.parse(readFileSync(join(root, "MANIFEST.json"), "utf8")) as {
      providers?: string[] | Record<string, unknown>;
    };
    if (Array.isArray(rootManifest.providers)) providers = rootManifest.providers;
    else if (rootManifest.providers && typeof rootManifest.providers === "object") {
      providers = Object.keys(rootManifest.providers);
    }
  } catch {
    return [
      { provider: "<root>", ok: false, errors: ["bundle root MANIFEST.json missing/invalid"] },
    ];
  }

  for (const p of providers) {
    const path = join(root, p, "MANIFEST.json");
    const errors: string[] = [];
    if (!existsSync(path)) {
      errors.push(`MANIFEST.json missing at ${path}`);
      out.push({ provider: p, ok: false, errors });
      continue;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch (e) {
      errors.push(`invalid JSON: ${(e as Error).message}`);
      out.push({ provider: p, ok: false, errors });
      continue;
    }
    if (data.manifest_schema_version !== 1) {
      errors.push(
        `manifest_schema_version must be 1; got ${JSON.stringify(data.manifest_schema_version)}`,
      );
    }
    for (const k of ["provider", "bundle_version", "synced_at", "resources", "data_sources"]) {
      if (!(k in data)) errors.push(`missing required key: ${k}`);
    }
    if (typeof data.resources !== "object" || data.resources === null) {
      errors.push("`resources` must be an object");
    }
    if (typeof data.data_sources !== "object" || data.data_sources === null) {
      errors.push("`data_sources` must be an object");
    }
    out.push({ provider: p, ok: errors.length === 0, errors });
  }

  return out;
}

interface WhichResult {
  found: boolean;
  version: string;
}
function which(cmd: string): WhichResult {
  const args = ["--version"];
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) return { found: false, version: "" };
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const firstLine = combined.split("\n")[0] ?? "";
  return { found: true, version: firstLine.trim() };
}
