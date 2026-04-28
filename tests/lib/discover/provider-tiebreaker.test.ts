// Provider classifier tiebreaker tests.
// See SYNTHESIS §7 fix #6 — when the confidence-based classifier would
// emit `ambiguous` AND the query contains a generic noun (cluster /
// service / warehouse / instance / database / dataset), the classifier
// breaks the tie by counting per-provider distinctive_tokens hits.

import { describe, expect, it } from "vitest";
import { PROVIDER_TIEBREAK_SCORE, detectProvider } from "../../../src/lib/discover/provider.js";

const KNOWN = ["aws", "azure", "cloudflare", "gcp", "kubernetes", "mongodb-atlas", "snowflake"];

/** Helper: build a Map<string, Set<string>> from a plain object literal. */
function buildDist(obj: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)] as const));
}

describe("detectProvider — distinctive_token tiebreaker", () => {
  // We force ambiguity by passing a serviceAliases override that maps the
  // generic noun to two providers at once. Then the tiebreaker uses the
  // distinctive_tokens map to pick the winner.

  it("'Atlas cluster' → mongodb-atlas (atlas wins as distinctive token)", () => {
    const r = detectProvider("Atlas cluster needs tuning", {
      knownProviders: KNOWN,
      // Make both mongodb-atlas and snowflake claim "cluster" via alias —
      // this forces ambiguity at score 0.6 for both.
      serviceAliases: [
        ["cluster", "mongodb-atlas"],
        ["cluster", "snowflake"],
      ],
      distinctiveTokensByProvider: buildDist({
        "mongodb-atlas": ["atlas", "mongodb"],
        snowflake: ["snowflake", "warehouse"],
      }),
    });
    expect(r.ambiguous).toBe(false);
    expect(r.provider).toBe("mongodb-atlas");
    expect(r.score).toBe(PROVIDER_TIEBREAK_SCORE);
    expect(r.via).toBe("tiebreaker");
  });

  it("'Snowflake warehouse' → snowflake (snowflake wins as distinctive)", () => {
    // "snowflake" is canonical so this would naturally be unambiguous.
    // Force a tie by adding aws as an alias for "warehouse" too.
    const r = detectProvider("snowflake warehouse cost", {
      knownProviders: KNOWN,
      serviceAliases: [
        ["warehouse", "snowflake"],
        ["warehouse", "aws"],
      ],
      distinctiveTokensByProvider: buildDist({
        snowflake: ["snowflake", "warehouse"],
        aws: ["s3", "ec2", "lambda"],
      }),
    });
    // Either canonical wins outright (no ambiguity) OR tiebreaker picks
    // snowflake. Both are acceptable; we just require the answer is
    // snowflake.
    expect(r.provider).toBe("snowflake");
  });

  it("'Elasticache cluster' → aws (elasticache is aws-distinctive)", () => {
    const r = detectProvider("elasticache cluster scaling", {
      knownProviders: KNOWN,
      serviceAliases: [
        ["cluster", "aws"],
        ["cluster", "kubernetes"],
      ],
      distinctiveTokensByProvider: buildDist({
        aws: ["elasticache", "ec2", "s3"],
        kubernetes: ["pod", "deployment", "ingress"],
      }),
    });
    expect(r.ambiguous).toBe(false);
    expect(r.provider).toBe("aws");
    expect(r.via).toBe("tiebreaker");
    expect(r.score).toBe(PROVIDER_TIEBREAK_SCORE);
  });

  it("'BigQuery dataset' → gcp (bigquery is gcp-distinctive)", () => {
    const r = detectProvider("bigquery dataset partitioning", {
      knownProviders: KNOWN,
      serviceAliases: [
        ["dataset", "gcp"],
        ["dataset", "aws"],
      ],
      distinctiveTokensByProvider: buildDist({
        gcp: ["bigquery", "pubsub", "gke"],
        aws: ["s3", "ec2", "athena"],
      }),
    });
    expect(r.ambiguous).toBe(false);
    expect(r.provider).toBe("gcp");
    expect(r.via).toBe("tiebreaker");
  });

  it("falls back to ambiguous when neither provider has a distinctive_token match", () => {
    const r = detectProvider("generic cluster topic", {
      knownProviders: KNOWN,
      serviceAliases: [
        ["cluster", "aws"],
        ["cluster", "azure"],
      ],
      distinctiveTokensByProvider: buildDist({
        aws: ["s3", "ec2"],
        azure: ["aks-foo", "vnet"],
      }),
    });
    // Neither "s3"/"ec2" nor "aks-foo"/"vnet" appears in the query, so
    // the tiebreaker can't pick a winner — falls back to ambiguous.
    expect(r.ambiguous).toBe(true);
  });

  it("falls back to ambiguous when both providers tie on distinctive_token count", () => {
    const r = detectProvider("foo cluster bar", {
      knownProviders: KNOWN,
      serviceAliases: [
        ["cluster", "aws"],
        ["cluster", "gcp"],
      ],
      distinctiveTokensByProvider: buildDist({
        aws: ["foo", "ec2"],
        gcp: ["bar", "gke"],
      }),
    });
    // Both providers match exactly one token — tiebreaker can't decide.
    expect(r.ambiguous).toBe(true);
  });

  it("does NOT fire the tiebreaker when no generic noun is present", () => {
    const r = detectProvider("foo bar", {
      knownProviders: KNOWN,
      serviceAliases: [
        ["foo", "aws"],
        ["foo", "gcp"],
      ],
      distinctiveTokensByProvider: buildDist({
        aws: ["foo"],
        gcp: ["bar", "gke"],
      }),
    });
    // No "cluster" / "service" / "warehouse" / etc. in query, so the
    // tiebreaker is suppressed and the classifier returns ambiguous.
    expect(r.ambiguous).toBe(true);
  });
});
