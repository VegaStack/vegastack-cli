// scripts/generate-skill-from-bundle.ts
//
// Mirrors the gws-cli `generate_skills.rs` pattern (R2 §6) at a smaller scale:
// reads a single canonical SKILL.md template from `bundle/skill-source/` and
// emits a final, token-substituted SKILL.md to `skills/vegastack/SKILL.md`.
//
// The generator is intentionally tiny: no mustache, no handlebars, no
// dependencies. We only need ${TOKEN} replacement and a stable provider list,
// and pulling in a templating engine for that adds dep + supply-chain risk.
//
// CI invocation:
//
//   npm run generate-skill -- --check
//
// `--check` regenerates the SKILL.md to a temp file and diffs against the
// committed copy; non-zero exit if they differ. PRs that hand-edit
// SKILL.md without updating the template will fail.
//
// Direct invocation:
//
//   npm run generate-skill           # writes skills/vegastack/SKILL.md
//   npm run generate-skill -- --out /tmp/SKILL.md
//
// Tokens substituted (see template):
//   ${BUNDLE_VERSION}    — from bundle/MANIFEST.json.bundle_version, fallback "dev"
//   ${PROVIDERS_COUNT}   — len(bundle/MANIFEST.json.providers), fallback 31
//   ${PROVIDER_LIST}     — comma-joined "AWS, Azure, …" rendered from providers

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

// ── Path helpers ─────────────────────────────────────────────────────

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(REPO_ROOT, "bundle", "skill-source", "SKILL.md.template");
const DEFAULT_OUT = path.join(REPO_ROOT, "skills", "vegastack", "SKILL.md");
const BUNDLE_MANIFEST = path.join(REPO_ROOT, "bundle", "MANIFEST.json");

// Fallback list — used when bundle/MANIFEST.json isn't on disk yet (CI build,
// fresh clone). Mirrors the v0.1-overrides.md provider list of 2026-04-28.
const FALLBACK_PROVIDERS = [
  "1password",
  "ansible",
  "auth0",
  "aws",
  "azure",
  "clickhouse",
  "cloudflare",
  "crowdstrike",
  "datadog",
  "digitalocean",
  "external",
  "gcp",
  "github",
  "gitlab",
  "grafana",
  "helm",
  "kubernetes",
  "local",
  "mongodb-atlas",
  "netlify",
  "okta",
  "pagerduty",
  "pinecone",
  "random",
  "redis-cloud",
  "snowflake",
  "splunk",
  "time",
  "tls",
  "vault",
  "vercel",
];

// ── Provider name pretty-print ───────────────────────────────────────

const PROVIDER_DISPLAY: Record<string, string> = {
  "1password": "1Password",
  ansible: "Ansible",
  auth0: "Auth0",
  aws: "AWS",
  azure: "Azure",
  clickhouse: "ClickHouse",
  cloudflare: "Cloudflare",
  crowdstrike: "CrowdStrike",
  datadog: "Datadog",
  digitalocean: "DigitalOcean",
  external: "External",
  gcp: "GCP",
  github: "GitHub",
  gitlab: "GitLab",
  grafana: "Grafana",
  helm: "Helm",
  kubernetes: "Kubernetes",
  local: "Local",
  "mongodb-atlas": "MongoDB Atlas",
  netlify: "Netlify",
  okta: "Okta",
  pagerduty: "PagerDuty",
  pinecone: "Pinecone",
  random: "Random",
  "redis-cloud": "Redis Cloud",
  snowflake: "Snowflake",
  splunk: "Splunk",
  time: "Time",
  tls: "TLS",
  vault: "Vault",
  vercel: "Vercel",
};

function pretty(p: string): string {
  return PROVIDER_DISPLAY[p] ?? p;
}

// ── Token resolution ─────────────────────────────────────────────────

interface BundleSummary {
  bundleVersion: string;
  providers: string[];
}

export function resolveBundleSummary(manifestPath = BUNDLE_MANIFEST): BundleSummary {
  if (!fs.existsSync(manifestPath)) {
    return { bundleVersion: "dev", providers: FALLBACK_PROVIDERS.slice() };
  }
  try {
    const json = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      bundle_version?: string;
      providers?: unknown;
    };
    const bundleVersion = typeof json.bundle_version === "string" ? json.bundle_version : "dev";
    let providers: string[] = FALLBACK_PROVIDERS.slice();
    if (Array.isArray(json.providers)) {
      providers = json.providers.filter((p): p is string => typeof p === "string");
    } else if (json.providers && typeof json.providers === "object") {
      providers = Object.keys(json.providers as Record<string, unknown>);
    }
    providers.sort();
    return { bundleVersion, providers };
  } catch (e) {
    process.stderr.write(`warn: bundle MANIFEST.json unparseable (${(e as Error).message}); falling back\n`);
    return { bundleVersion: "dev", providers: FALLBACK_PROVIDERS.slice() };
  }
}

export function renderSkill(template: string, summary: BundleSummary): string {
  const providerList = summary.providers.map(pretty).join(", ");
  return template
    .replaceAll("${BUNDLE_VERSION}", summary.bundleVersion)
    .replaceAll("${PROVIDERS_COUNT}", String(summary.providers.length))
    .replaceAll("${PROVIDER_LIST}", providerList);
}

// ── CLI entry ────────────────────────────────────────────────────────

interface CliOptions {
  out: string;
  check: boolean;
  templatePath: string;
  manifestPath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    out: DEFAULT_OUT,
    check: false,
    templatePath: TEMPLATE_PATH,
    manifestPath: BUNDLE_MANIFEST,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") opts.check = true;
    else if (a === "--out") opts.out = argv[++i] ?? opts.out;
    else if (a === "--template") opts.templatePath = argv[++i] ?? opts.templatePath;
    else if (a === "--manifest") opts.manifestPath = argv[++i] ?? opts.manifestPath;
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: generate-skill-from-bundle [--check] [--out PATH] [--template PATH] [--manifest PATH]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`unknown arg: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

export function runCli(argv = process.argv.slice(2)): number {
  const opts = parseArgs(argv);
  if (!fs.existsSync(opts.templatePath)) {
    process.stderr.write(`template missing: ${opts.templatePath}\n`);
    return 2;
  }
  const tpl = fs.readFileSync(opts.templatePath, "utf8");
  const summary = resolveBundleSummary(opts.manifestPath);
  const rendered = renderSkill(tpl, summary);

  if (opts.check) {
    if (!fs.existsSync(opts.out)) {
      process.stderr.write(`check failed: ${opts.out} not present; run without --check first\n`);
      return 1;
    }
    const onDisk = fs.readFileSync(opts.out, "utf8");
    if (onDisk === rendered) {
      process.stdout.write(`ok: ${opts.out} matches the template render\n`);
      return 0;
    }
    process.stderr.write(`check failed: ${opts.out} differs from template render\n`);
    process.stderr.write("re-run `npm run generate-skill` and commit the result.\n");
    return 1;
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, rendered, "utf8");
  process.stdout.write(`wrote ${opts.out} (${rendered.length} bytes, ${summary.providers.length} providers)\n`);
  return 0;
}

const isMain = import.meta.url === url.pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  process.exit(runCli());
}
