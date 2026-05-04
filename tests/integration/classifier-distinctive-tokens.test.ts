// Integration tests for the distinctive_tokens tiebreaker + concept-alias
// pre-detection, using the REAL provider Registry pack (not mocks).
//
// Purpose: catch real-world drift between the Registry pack's MANIFEST.json
// distinctive_tokens / aliases.yaml content and the TS classifier. If these
// tests fail, either the Registry pack changed (Registry pack side) or the classifier
// logic regressed (TS side) — the error message identifies which.
//
// S2 shipped distinctive_tokens per-provider and concept-alias phrases for
// mongodb-atlas. S3 closes C6 in the TS harness by:
//   1. Loading manifest service_aliases into detectProvider() (buildProviderDetectionData)
//   2. Adding "atlas" and "elasticache" to DEFAULT_SERVICE_ALIASES
//   3. Scanning aliases.yaml files as a pre-detection fallback (detectProviderFromAliasFiles)
//
// These tests validate end-to-end that the TS pipeline behaves like Python's
// discover.py for the C6 failure cases.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../../src/lib/discover/index.js";

const TERRAFORM_DOCS_ROOT =
  process.env.VEGASTACK_TERRAFORM_DOCS_DIR_TEST ??
  path.join(
    process.env.VEGASTACK_REGISTRY_DIR ?? "/Users/mk/projects/vegastack-cli-registry/cli/packs",
    "terraform",
    "docs",
  );

const HAVE_TERRAFORM_DOCS = fs.existsSync(path.join(TERRAFORM_DOCS_ROOT, "MANIFEST.json"));

/** Helper: run discover() and return a summary. Throws a clear error when
 *  the result doesn't match expectations so CI output identifies the side
 *  (Registry pack vs TS classifier) that caused the failure. */
async function classify(query: string) {
  const r = await discover({ query, root: TERRAFORM_DOCS_ROOT });
  return {
    status: r.status,
    provider: r.status === "ok" ? r.provider : undefined,
    confidence: r.status === "ok" ? r.provider_confidence : undefined,
    candidates:
      r.status === "ambiguous" ? r.candidate_providers?.map((c) => c.provider) : undefined,
    code: r.status === "error" ? r.code : undefined,
  };
}

describe.runIf(HAVE_TERRAFORM_DOCS)(
  "classifier — distinctive_tokens + concept-alias integration (real Registry pack)",
  () => {
    // ── MongoDB Atlas C6 failure cases ─────────────────────────────────────

    it("'tune Atlas cluster cost' → mongodb-atlas (C6 failure case)", async () => {
      const r = await classify("tune Atlas cluster cost");
      expect(r.status, `Expected ok but got ${r.status} (code: ${r.code})`).toBe("ok");
      expect(
        r.provider,
        `Expected mongodb-atlas but got ${r.provider}. ` +
          `If this fails, either (a) 'atlas' was removed from DEFAULT_SERVICE_ALIASES ` +
          `or (b) the Registry pack no longer ships 'tune Atlas cluster' in mongodb-atlas/aliases.yaml.`,
      ).toBe("mongodb-atlas");
      expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("'M40 instance backup' → mongodb-atlas (concept-alias pre-detection)", async () => {
      const r = await classify("M40 instance backup");
      expect(r.status, `Expected ok but got ${r.status} (code: ${r.code})`).toBe("ok");
      expect(
        r.provider,
        `Expected mongodb-atlas but got ${r.provider}. ` +
          `If this fails, check mongodb-atlas/aliases.yaml for 'M40 instance' phrase.`,
      ).toBe("mongodb-atlas");
      expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("'online archive policy' → mongodb-atlas (concept-alias pre-detection)", async () => {
      const r = await classify("online archive policy");
      expect(r.status, `Expected ok but got ${r.status} (code: ${r.code})`).toBe("ok");
      expect(
        r.provider,
        `Expected mongodb-atlas but got ${r.provider}. ` +
          `If this fails, check mongodb-atlas/aliases.yaml for 'online archive' phrase.`,
      ).toBe("mongodb-atlas");
      expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    });

    // ── Snowflake ──────────────────────────────────────────────────────────

    it("'snowflake warehouse cost' → snowflake (confidence ≥ 0.7)", async () => {
      const r = await classify("snowflake warehouse cost");
      expect(r.status).toBe("ok");
      expect(r.provider).toBe("snowflake");
      expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    });

    // ── AWS elasticache — should NOT route to mongodb-atlas ───────────────

    it("'elasticache cluster failover' → aws (NOT mongodb-atlas)", async () => {
      const r = await classify("elasticache cluster failover");
      expect(r.status, `Expected ok but got ${r.status} (code: ${r.code})`).toBe("ok");
      expect(
        r.provider,
        `Expected aws but got ${r.provider}. ` +
          `'elasticache' is AWS-exclusive; if this fails, check DEFAULT_SERVICE_ALIASES ` +
          `and that the aws distinctive_tokens include 'elasticache'.`,
      ).toBe("aws");
      expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    });

    // ── Negative: kubernetes should not route to mongodb-atlas ────────────

    it("'kubernetes cluster service' → NOT mongodb-atlas ('atlas' not in query)", async () => {
      const r = await classify("kubernetes cluster service");
      // kubernetes is a canonical name so this should be unambiguous.
      // The important invariant: mongodb-atlas must NOT win.
      if (r.status === "ok") {
        expect(
          r.provider,
          `Got mongodb-atlas for 'kubernetes cluster service' — the word 'cluster' ` +
            `should not route to mongodb-atlas when 'atlas' is absent from the query.`,
        ).not.toBe("mongodb-atlas");
      } else if (r.status === "ambiguous") {
        // Ambiguous is also acceptable — as long as mongodb-atlas is not the
        // sole winner.
        const mongoInCandidates = r.candidates?.includes("mongodb-atlas") ?? false;
        const k8sInCandidates = r.candidates?.includes("kubernetes") ?? true;
        expect(k8sInCandidates).toBe(true);
        // If mongodb-atlas appears, kubernetes must also appear (no solo win
        // for mongodb-atlas).
        if (mongoInCandidates) {
          expect(k8sInCandidates).toBe(true);
        }
      }
    });

    // ── §3 Regression checks ───────────────────────────────────────────────

    it("'snowflake warehouse for analytics' → snowflake (regression check)", async () => {
      const r = await classify("snowflake warehouse for analytics");
      expect(r.status).toBe("ok");
      expect(r.provider).toBe("snowflake");
    });

    it("'Cloudflare D1 database' → cloudflare (regression check)", async () => {
      const r = await classify("Cloudflare D1 database");
      expect(r.status).toBe("ok");
      expect(
        r.provider,
        `Expected cloudflare but got ${r.provider}. ` +
          `'D1' should route to cloudflare via its distinctive_tokens or canonical name.`,
      ).toBe("cloudflare");
    });

    it("'AWS RDS Postgres encrypted' → aws (regression check)", async () => {
      const r = await classify("AWS RDS Postgres encrypted");
      expect(r.status).toBe("ok");
      expect(r.provider).toBe("aws");
    });

    it("'K8s deployment with liveness probe' → kubernetes (regression check)", async () => {
      const r = await classify("K8s deployment with liveness probe");
      expect(r.status).toBe("ok");
      expect(
        r.provider,
        `Expected kubernetes but got ${r.provider}. 'k8s' alias should route to kubernetes ` +
          `and NOT to aws via 'deployment' token.`,
      ).toBe("kubernetes");
    });

    // ── Manifest cache invalidation note ─────────────────────────────────
    // The TS harness uses mtime-based caching (src/lib/discover/manifest.ts).
    // After a registry update, the mtime changes and the
    // cache auto-invalidates on the next read — no manual cache busting needed.
    // The clearManifestCache() export is available for test isolation.
  },
);
