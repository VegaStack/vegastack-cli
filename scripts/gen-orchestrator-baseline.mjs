// Generates the orchestrator-baseline.json characterization fixture.
// Captures the public discover() envelope shape for a representative set
// of queries against the on-disk registry-mini fixture. Run on the
// pre-refactor commit, commit the JSON, then assert no diff after refactor.
//
// Usage: node scripts/gen-orchestrator-baseline.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { discover } from "../dist/lib/discover/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT = path.join(REPO_ROOT, "tests", "fixtures", "registry-mini");
const OUT = path.join(REPO_ROOT, "tests", "fixtures", "discover", "orchestrator-baseline.json");

const cases = [
  { name: "single-provider-explicit", args: { query: "s3 bucket", root: ROOT, provider: "aws" } },
  { name: "single-provider-detected-aws", args: { query: "create an aws s3 bucket", root: ROOT } },
  { name: "single-provider-detected-cf", args: { query: "cloudflare dns record", root: ROOT } },
  { name: "ambiguous-merge-aws-cf", args: { query: "s3 bucket on cloudflare", root: ROOT } },
  { name: "provider-undetected", args: { query: "totally unrelated query", root: ROOT } },
  { name: "unknown-explicit-provider", args: { query: "s3 bucket", root: ROOT, provider: "nope" } },
  { name: "max-cap", args: { query: "s3", root: ROOT, provider: "aws", max: 3 } },
  { name: "brief-mode", args: { query: "s3 bucket", root: ROOT, provider: "aws", brief: true } },
];

// Deterministic shape: drop timing fields, drop absolute paths.
function normalize(env) {
  if (!env) return env;
  const out = JSON.parse(JSON.stringify(env));
  if (out.timings) delete out.timings;
  // Strip provider-dir absolute paths to keep fixture portable. Files in the
  // envelope already use repo-relative paths.
  return out;
}

const result = {};
for (const c of cases) {
  // Re-import to clear any process-level caches between cases? Not needed —
  // the discoverer is pure given (query, root). Caches are correctness-safe.
  const r = await discover(c.args);
  result[c.name] = { input: c.args, output: normalize(r) };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote ${OUT}`);
