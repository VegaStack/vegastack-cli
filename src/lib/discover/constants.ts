// Constants for the native TypeScript discoverer.
//
// In v0.1 (the first public release) we keep ONLY:
//   • stop-word noise list
//   • bigram-stage thresholds
//   • path-weight table (where the doc lives → multiplier)
//   • a small set of pipeline tunables
//   • the tier-2 grep skip-list of overly generic tokens
//
// Everything provider-specific (SUBCAT_KEYWORDS, PRIMARY_RESOURCES,
// SERVICE_ALIASES, PROVIDER_SUBSTRING phrases) lives in the per-provider
// MANIFEST.json now — emitted by E1 and consumed by the loaders. This
// closes the "hand-curated tables embedded in code" smell and lets the
// CLI ship without re-publishing every time a provider table changes.

// ── Pipeline tunables ──────────────────────────────────────────────────

/** A Tier-1 hit must score at least this much (raw) to count toward the
 *  legacy `TIER1_MIN_RESULTS` gate. v0.1 prefers the new score_norm gate. */
export const TIER1_CONFIDENCE_THRESHOLD = 50;

/** If Tier-1 produced this many high-confidence hits, the count gate
 *  considered the answer "good enough". v0.1 uses a quality gate instead;
 *  this constant is retained for the legacy fallback path. */
export const TIER1_MIN_RESULTS = 3;

/** Per-provider score-norm gate: top-1 must reach this to skip Tier-2. */
export const SCORE_NORM_TOP1_GATE = 50;

/** Per-provider score-norm gate: top-3 average must reach this to skip Tier-2. */
export const SCORE_NORM_TOP3_AVG_GATE = 30;

export const MAX_RESULTS_DEFAULT = 20;

/** Reason kinds where multiple identical hits on the same file collapse. */
export const DEDUPE_REASON_KINDS: ReadonlySet<string> = new Set([
  "subcat_keyword",
  "subcategory_peer",
  "synthetic_subcat",
]);

/** Canonical-name multiplier applied to exact_resource and primary_resource hits. */
export const CANONICAL_MULTIPLIER = 1.5;

// ── Provider detection (confidence model) ─────────────────────────────

/** Anti-detection list. English-word providers cap at ANTI_DETECT_CAP unless
 *  a 2-token corroborator is present (e.g. "time_static", "random_id"). */
export const ANTI_DETECT_PROVIDERS: ReadonlySet<string> = new Set([
  "time",
  "local",
  "random",
  "external",
  "helm",
]);

export const ANTI_DETECT_CAP = 0.2;

/** Provider confidence weights per matching stage. */
export const PROVIDER_CONFIDENCE = {
  /** canonical name as a standalone token (e.g. "aws"). */
  canonical: 1.0,
  /** PROVIDER_SUBSTRING phrase match (e.g. "mongodb atlas"). */
  substring: 0.9,
  /** SERVICE_ALIASES match (e.g. "eks" → aws). */
  alias: 0.6,
} as const;

/** Two providers within this score gap are reported as ambiguous. */
export const AMBIGUOUS_GAP = 0.2;

/** Phrase → canonical provider name. Multi-word phrases that aren't simply the
 *  canonical name. Augmented at runtime by the bundle-resolved provider list. */
export const PROVIDER_SUBSTRING_PHRASES: readonly (readonly [string, string])[] = [
  ["mongodb atlas", "mongodb-atlas"],
  ["redis cloud", "redis-cloud"],
  ["1 password", "1password"],
];

/** When provider X is detected, drop providers Y from the candidate list.
 *  Resolves obvious co-detections like "1password vault" → drop vault. */
export const PROVIDER_CONTEXT_EXCLUSIONS: Readonly<Record<string, ReadonlySet<string>>> =
  Object.freeze({
    "1password": new Set(["vault"]),
    vault: new Set(["tls"]),
  });

/** Default (built-in) service alias → provider table. The bundle's per-provider
 *  MANIFEST.json `service_aliases` adds to this; this list keeps a minimal
 *  sensible default for cases where a fresh bundle hasn't filled them in yet. */
export const DEFAULT_SERVICE_ALIASES: readonly (readonly [string, string])[] = [
  // AWS – the most common service shorthands
  ["ec2", "aws"],
  ["eks", "aws"],
  ["iam", "aws"],
  ["s3", "aws"],
  ["rds", "aws"],
  ["lambda", "aws"],
  ["dynamodb", "aws"],
  ["dynamo", "aws"],
  ["ecr", "aws"],
  ["ecs", "aws"],
  ["fargate", "aws"],
  ["cloudfront", "aws"],
  ["route53", "aws"],
  ["vpc", "aws"],
  ["kms", "aws"],
  ["sqs", "aws"],
  ["sns", "aws"],
  ["alb", "aws"],
  ["nlb", "aws"],
  ["elb", "aws"],
  ["acm", "aws"],
  ["ebs", "aws"],
  ["amazon", "aws"],
  // ElastiCache is AWS-exclusive in the Terraform ecosystem.
  ["elasticache", "aws"],
  // Azure
  ["aks", "azure"],
  // GCP
  ["gke", "gcp"],
  ["pubsub", "gcp"],
  ["gcs", "gcp"],
  ["bigquery", "gcp"],
  // DigitalOcean
  ["droplet", "digitalocean"],
  // Vault – PKI is vault-specific
  ["pki", "vault"],
  // Misc
  ["k8s", "kubernetes"],
  ["mongo", "mongodb-atlas"],
  ["mongodb", "mongodb-atlas"],
  // "atlas" alone unambiguously refers to MongoDB Atlas in the Terraform
  // ecosystem (Kubernetes Atlas / HashiCorp Atlas are both discontinued).
  // Closes C6 in the TS harness — "tune Atlas cluster cost" now scores 0.6
  // for mongodb-atlas enabling the distinctive_tokens tiebreaker to fire.
  ["atlas", "mongodb-atlas"],
  ["redis", "redis-cloud"],
];

/** 2-token corroborators that allow an anti-detect provider to score full
 *  confidence (otherwise capped at ANTI_DETECT_CAP). */
export const ANTI_DETECT_CORROBORATORS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  {
    time: ["time_static", "time_rotating", "time_offset", "time_sleep"],
    local: ["local_file", "local_sensitive_file"],
    random: ["random_id", "random_string", "random_password", "random_pet", "random_uuid"],
    external: ["external_data"],
    helm: ["helm chart", "helm_release", "helm release"],
  },
);

// ── Tokenization ──────────────────────────────────────────────────────

/** Stop words filtered out of the tokenized query. */
export const NOISE: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "how",
  "to",
  "create",
  "get",
  "list",
  "use",
  "with",
  "and",
  "or",
  "for",
  "in",
  "on",
  "do",
  "i",
  "we",
  "my",
  "is",
  "it",
  "that",
  "this",
  "set",
  "up",
  "configure",
  "need",
  "want",
  "make",
]);

/** Token → expanded synonyms. Applied to every token after the noise filter.
 *  Kept compact; provider-specific expansions belong in the bundle. */
export const TOKEN_EXPANSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  eip: ["eip", "elastic_ip"],
  elb: ["load_balancer", "alb", "nlb", "elb", "lb"],
  alb: ["alb", "lb", "load_balancer"],
  nlb: ["nlb", "lb", "load_balancer"],
  sg: ["security_group"],
  asg: ["autoscaling_group"],
  acm: ["acm", "certificate"],
  r53: ["route53"],
  cf: ["cloudfront"],
  k8s: ["kubernetes", "container"],
  pvc: ["persistent_volume_claim"],
  sa: ["service_account"],
  cm: ["config_map"],
  ztna: ["zero_trust"],
  zt: ["zero_trust"],
  approle: ["approle", "approle_auth_backend"],
  horizontal: ["hpa"],
  autoscaler: ["hpa"],
  grants: ["grant", "privileges"],
  repo: ["repository"],
  configmap: ["config_map"],
  domain: ["project_domain", "dns_record"],
  logs: ["logs_pipeline", "logs_custom_pipeline"],
  log: ["logs"],
  loadbalancer: ["lb", "loadbalancer"],
  ssl: ["certificate"],
  waf: ["firewall", "ruleset"],
  webhook: ["event", "extension"],
});

// ── Path weighting ────────────────────────────────────────────────────

/** Path-substring → multiplier. First match wins. */
export const PATH_WEIGHTS: readonly (readonly [string, number])[] = [
  ["guides/", 0.3],
  ["functions/", 0.2],
  ["/d/", 0.8],
  ["/data-sources/", 0.8],
  ["/r/", 1.0],
  ["/resources/", 1.0],
  ["index.", 0.5],
];

// ── Tier-2 ────────────────────────────────────────────────────────────

/** Tokens too generic to grep for (would flood with false positives). */
export const TIER2_GREP_SKIP: ReadonlySet<string> = new Set([
  "web",
  "app",
  "data",
  "log",
  "node",
  "run",
  "new",
  "old",
  "main",
  "base",
  "core",
  "root",
  "home",
  "host",
  "port",
  "name",
  "type",
  "mode",
  "size",
  "zone",
  "path",
  "tags",
  "info",
  "item",
  "list",
  "view",
  "role",
  "rule",
  "auth",
]);

// ── Intent gating for Tier-1 stage 1i ────────────────────────────────

export const INTENT_KEYWORDS: ReadonlySet<string> = new Set([
  "migrate",
  "upgrade",
  "version",
  "breaking",
  "move",
]);

// ── Theoretical maximum raw score per provider — used to compute score_norm.
// We cap at a generous upper bound so a perfect aws_s3_bucket primary+exact+
// peers+args combo lands at score_norm ≈ 100. Tunable per-provider via
// ProviderManifest.bundle_version-keyed override (future work).
export const THEORETICAL_MAX_SCORE = 400;
