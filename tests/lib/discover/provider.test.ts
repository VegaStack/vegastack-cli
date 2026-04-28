// Provider detection unit tests (v0.1 confidence model).

import { describe, expect, it } from "vitest";
import { detectProvider } from "../../../src/lib/discover/provider.js";

const KNOWN = [
  "1password",
  "aws",
  "azure",
  "cloudflare",
  "datadog",
  "digitalocean",
  "gcp",
  "github",
  "kubernetes",
  "mongodb-atlas",
  "redis-cloud",
  "vault",
  "tls",
  "time",
  "local",
  "random",
  "external",
  "helm",
];

describe("detectProvider — canonical name matches", () => {
  it.each([
    ["I want to deploy on AWS", "aws", 1.0],
    ["set up an azure resource", "azure", 1.0],
    ["cloudflare DNS record", "cloudflare", 1.0],
  ])("'%s' → %s @ %f", (q, expected, conf) => {
    const r = detectProvider(q, { knownProviders: KNOWN });
    expect(r.provider).toBe(expected);
    expect(r.score).toBe(conf);
    expect(r.via).toBe("canonical");
    expect(r.ambiguous).toBe(false);
  });
});

describe("detectProvider — substring phrase matches", () => {
  it("mongodb atlas user → mongodb-atlas via substring", () => {
    const r = detectProvider("mongodb atlas user", { knownProviders: KNOWN });
    expect(r.provider).toBe("mongodb-atlas");
    expect(r.score).toBeGreaterThanOrEqual(0.9);
  });
  it("redis cloud subscription → redis-cloud", () => {
    const r = detectProvider("redis cloud subscription", { knownProviders: KNOWN });
    expect(r.provider).toBe("redis-cloud");
  });
});

describe("detectProvider — service-alias matches", () => {
  it.each([
    ["create an EKS cluster", "aws"],
    ["GKE node pool", "gcp"],
    ["AKS cluster", "azure"],
    ["spin up a droplet", "digitalocean"],
    ["mongo replica set", "mongodb-atlas"],
    ["k8s deployment", "kubernetes"],
    ["S3 bucket", "aws"],
    ["pubsub topic", "gcp"],
  ])("'%s' → %s", (q, expected) => {
    const r = detectProvider(q, { knownProviders: KNOWN });
    expect(r.provider).toBe(expected);
    expect(r.score).toBeGreaterThanOrEqual(0.6);
  });
});

describe("detectProvider — ambiguity handling", () => {
  it("returns candidates when two canonicals are within 0.2", () => {
    const r = detectProvider("connect aws to azure", { knownProviders: KNOWN });
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toBeDefined();
    const ps = (r.candidates ?? []).map((c) => c.provider);
    expect(ps).toEqual(expect.arrayContaining(["aws", "azure"]));
  });

  it("PROVIDER_CONTEXT_EXCLUSIONS drops vault when 1password is detected", () => {
    const r = detectProvider("1password vault secret", { knownProviders: KNOWN });
    expect(r.provider).toBe("1password");
    expect(r.ambiguous).toBe(false);
  });

  it("returns score 0 for completely unknown queries", () => {
    const r = detectProvider("hello world banana", { knownProviders: KNOWN });
    expect(r.provider).toBeUndefined();
    expect(r.score).toBe(0);
  });
});

describe("detectProvider — word boundaries", () => {
  it("doesn't match aws inside 'awsteam'", () => {
    const r = detectProvider("awsteam meeting", { knownProviders: KNOWN });
    expect(r.provider).toBeUndefined();
  });
  it("matches aws as standalone token even with punctuation", () => {
    const r = detectProvider("AWS, please", { knownProviders: KNOWN });
    expect(r.provider).toBe("aws");
  });
});

describe("detectProvider — anti-detection caps", () => {
  it("'time' alone caps at 0.2", () => {
    const r = detectProvider("what time is it", { knownProviders: KNOWN });
    if (r.provider === "time") {
      expect(r.score).toBeLessThanOrEqual(0.2);
    }
  });
  it("'time_static' corroborator removes the cap", () => {
    const r = detectProvider("create a time_static resource", { knownProviders: KNOWN });
    expect(r.provider).toBe("time");
    expect(r.score).toBeGreaterThan(0.2);
  });
  it("'random_id' corroborator surfaces 'random' provider", () => {
    const r = detectProvider("use random_id for a unique suffix", { knownProviders: KNOWN });
    expect(r.provider).toBe("random");
    expect(r.score).toBeGreaterThan(0.2);
  });
  it("'helm chart' corroborator removes the cap", () => {
    const r = detectProvider("install nginx as a helm chart", { knownProviders: KNOWN });
    expect(r.provider).toBe("helm");
    expect(r.score).toBeGreaterThan(0.2);
  });
});

describe("detectProvider — gap-based ambiguity", () => {
  it("two canonical hits within 0.2 → ambiguous", () => {
    const r = detectProvider("aws and gcp deployment", { knownProviders: KNOWN });
    expect(r.ambiguous).toBe(true);
    const ps = (r.candidates ?? []).map((c) => c.provider);
    expect(ps).toEqual(expect.arrayContaining(["aws", "gcp"]));
  });

  it("a canonical 1.0 plus an alias 0.6 → NOT ambiguous (gap = 0.4)", () => {
    // "aws and ec2" — aws is canonical (1.0), ec2 also maps to aws (alias),
    // so both stages produce aws ⇒ best is aws, second_best non-existent.
    const r = detectProvider("aws and ec2 deployment", { knownProviders: KNOWN });
    expect(r.provider).toBe("aws");
    expect(r.ambiguous).toBe(false);
  });
});
