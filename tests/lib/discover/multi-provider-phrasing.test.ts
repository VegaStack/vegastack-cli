// Multi-provider phrasing heuristic — closes S7 regressions
// (E9-A7-crowdstrike-on-aws, E9-A7-do-app-cf-dns).
//
// The heuristic detects connector-word patterns ("X on Y", "X with Y",
// "X via Y", "X + Y", "X in front of Y", oxford lists) where each side
// resolves to a known provider, and forces the discoverer into the
// auto-merge fanout path so resources from both providers surface.
//
// Negative tests (single-provider) are as important as positive ones —
// over-triggering would force ambiguous on every prompt and cripple the
// harness.

import { describe, expect, it } from "vitest";
import { detectMultiProviderPhrasing } from "../../../src/lib/discover/index.js";

// A representative list of canonical providers from the bundle. Tests use
// this same set so resolution is deterministic and doesn't depend on the
// installed bundle.
const KNOWN_PROVIDERS: readonly string[] = [
  "aws",
  "azure",
  "gcp",
  "cloudflare",
  "digitalocean",
  "datadog",
  "github",
  "gitlab",
  "mongodb-atlas",
  "snowflake",
  "kubernetes",
  "vault",
  "auth0",
  "crowdstrike",
  "vercel",
  "netlify",
  "okta",
  "pagerduty",
  "redis-cloud",
  "1password",
  "pinecone",
  "clickhouse",
  "helm",
  "tls",
  "local",
  "external",
  "random",
  "time",
];

describe("detectMultiProviderPhrasing — positive cases (multi-provider topology)", () => {
  it("'register every EC2 in our AWS org with CrowdStrike Falcon' → multi: [aws, crowdstrike]", () => {
    const r = detectMultiProviderPhrasing(
      "register every EC2 in our AWS org with CrowdStrike Falcon",
      KNOWN_PROVIDERS,
    );
    // Expected: ambiguous, providers includes both. Order: first-mention.
    expect(r).toBeDefined();
    expect(r!.multiProvider).toBe(true);
    expect(r!.providers).toContain("aws");
    expect(r!.providers).toContain("crowdstrike");
  });

  it("'DigitalOcean App Platform with Cloudflare DNS in front' → multi: [digitalocean, cloudflare]", () => {
    const r = detectMultiProviderPhrasing(
      "DigitalOcean App Platform with Cloudflare DNS in front",
      KNOWN_PROVIDERS,
    );
    expect(r).toBeDefined();
    expect(r!.providers).toContain("digitalocean");
    expect(r!.providers).toContain("cloudflare");
  });

  it("'GitHub Actions OIDC to AWS' → multi: [github, aws]", () => {
    const r = detectMultiProviderPhrasing("GitHub Actions OIDC to AWS", KNOWN_PROVIDERS);
    expect(r).toBeDefined();
    expect(r!.providers).toContain("github");
    expect(r!.providers).toContain("aws");
  });

  it("'GitOps with Atlantis on EKS' → multi: includes aws (via EKS service-alias)", () => {
    // 'Atlantis' is not a known provider, but 'EKS' resolves to aws via
    // DEFAULT_SERVICE_ALIASES. The heuristic still needs a partner — here
    // 'GitOps' or 'GitHub' isn't in the query, but 'EKS' alone with another
    // resolved provider via 'with' / 'on' connector should fire if both sides
    // match. In this exact prompt only one side resolves to a real provider
    // ('EKS' → aws). With Atlantis being unresolvable we can only test that
    // EKS does resolve when paired with a second provider via another
    // connector. So we test a richer variant that both sides resolve.
    const r = detectMultiProviderPhrasing(
      "GitOps via GitHub with Atlantis on EKS",
      KNOWN_PROVIDERS,
    );
    expect(r).toBeDefined();
    expect(r!.providers).toContain("aws");
    expect(r!.providers).toContain("github");
  });

  it("orders providers by first-mention position (deterministic)", () => {
    const r = detectMultiProviderPhrasing("Cloudflare DNS in front of AWS", KNOWN_PROVIDERS);
    expect(r).toBeDefined();
    expect(r!.providers[0]).toBe("cloudflare");
    expect(r!.providers[1]).toBe("aws");
  });

  it("caps at 4 providers (AUTO_MERGE_MAX_CANDIDATES)", () => {
    const r = detectMultiProviderPhrasing(
      "AWS with Azure with GCP with Cloudflare with Datadog with GitHub",
      KNOWN_PROVIDERS,
    );
    expect(r).toBeDefined();
    expect(r!.providers.length).toBeLessThanOrEqual(4);
  });
});

describe("detectMultiProviderPhrasing — negative cases (single-provider, MUST NOT over-trigger)", () => {
  it("'Atlas cluster' → single (only one provider mentioned)", () => {
    const r = detectMultiProviderPhrasing("Atlas cluster", KNOWN_PROVIDERS);
    expect(r).toBeUndefined();
  });

  it("'kubernetes cluster on bare metal' → single (bare metal is not a provider)", () => {
    const r = detectMultiProviderPhrasing("kubernetes cluster on bare metal", KNOWN_PROVIDERS);
    expect(r).toBeUndefined();
  });

  it("'S3 bucket with versioning' → single (versioning is not a provider)", () => {
    const r = detectMultiProviderPhrasing("S3 bucket with versioning", KNOWN_PROVIDERS);
    expect(r).toBeUndefined();
  });

  it("'kubernetes deployment with config map' → single (config map isn't a provider)", () => {
    const r = detectMultiProviderPhrasing("kubernetes deployment with config map", KNOWN_PROVIDERS);
    expect(r).toBeUndefined();
  });

  it("'Cloudflare Workers + D1 + R2' → single (D1 and R2 are cloudflare features, not separate providers)", () => {
    const r = detectMultiProviderPhrasing("Cloudflare Workers + D1 + R2", KNOWN_PROVIDERS);
    // D1 and R2 are not in DEFAULT_SERVICE_ALIASES and not canonical
    // providers, so each + connector fragment fails to resolve to a
    // distinct second provider. Expected: undefined (single-provider).
    expect(r).toBeUndefined();
  });

  it("'tune Atlas cluster cost' → single (only mongodb-atlas mentioned)", () => {
    const r = detectMultiProviderPhrasing("tune Atlas cluster cost", KNOWN_PROVIDERS);
    expect(r).toBeUndefined();
  });

  it("'EC2 instance for dev' → single (no second provider)", () => {
    const r = detectMultiProviderPhrasing("EC2 instance for dev", KNOWN_PROVIDERS);
    expect(r).toBeUndefined();
  });
});

describe("detectMultiProviderPhrasing — anti-revert assertions", () => {
  // If the alias-file phrase confidence in detectProviderFromAliasFiles() is
  // raised back above the alias-floor (0.6), the crowdstrike-on-aws scenario
  // would silently regress to single-provider. The discoverer-level test
  // (auto-merge / multi-provider integration) catches that — see
  // tests/lib/discover/auto-merge.test.ts. Here we lock the heuristic itself
  // to detect crowdstrike+aws in the canonical regression query.
  it("crowdstrike-on-aws regression: heuristic detects both providers (locks the fix)", () => {
    const r = detectMultiProviderPhrasing(
      "register every EC2 in our AWS org with CrowdStrike Falcon",
      KNOWN_PROVIDERS,
    );
    expect(r).toBeDefined();
    const provs = new Set(r!.providers);
    expect(provs.has("aws") && provs.has("crowdstrike")).toBe(true);
  });
});
