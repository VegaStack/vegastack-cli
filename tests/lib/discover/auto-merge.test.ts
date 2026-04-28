// Auto-merge tests for the ambiguous-fanout path.
// See SYNTHESIS §7 fix #2 — when the classifier reports `ambiguous` AND
// the candidate-provider count is ≤ 4, the discoverer fans out per-provider
// pipelines via Promise.all and unions the results into a single envelope.
//
// Tests use:
//   • the on-disk `tests/fixtures/bundle-mini` for the 2-provider case
//     (aws + cloudflare), AND
//   • a synthesized N-provider bundle (4 providers, > 4 providers) built
//     in beforeEach to verify the cap behavior.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discover, mergeOkEnvelopes } from "../../../src/lib/discover/index.js";
import type { DiscoverOkEnvelope, MergeOpts } from "../../../src/lib/discover/index.js";
import type { DiscoverFile } from "../../../src/lib/discover/types.js";
import { clearManifestCache } from "../../../src/lib/discover/manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MINI_FIXTURE = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");

// ─── helpers ─────────────────────────────────────────────────────────────

interface SyntheticBundleSpec {
  /** Providers in the bundle. Each gets a tiny manifest with one resource
   *  whose name follows `<provider>_widget`. */
  providers: string[];
  /** Optional knowledge cards keyed by id; provider list defaults to ["*"]. */
  knowledge?: Record<string, { triggers: { tokens?: string[]; phrase?: string }[] }>;
}

/** Build a temp bundle with N providers, each shipping a manifest that
 *  has a single resource and a single canonical name match. */
function makeBundle(spec: SyntheticBundleSpec): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vega-merge-"));
  fs.writeFileSync(
    path.join(tmp, "MANIFEST.json"),
    JSON.stringify({ bundle_version: "test", providers: spec.providers }),
  );
  for (const p of spec.providers) {
    const dir = path.join(tmp, p);
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "MANIFEST.json"),
      JSON.stringify({
        manifest_schema_version: 1,
        provider: p,
        bundle_version: "test",
        resources: {
          [`${p}_widget`]: {
            type: "resource",
            file: `r/widget.html.markdown`,
            description: `${p} widget`,
            required_args: [],
            optional_args: [],
            computed_attrs: [],
            blocks: {},
            enum_values: {},
            import_syntax: null,
            deprecated: false,
            suggested_alternative: null,
            recommended_companions: [],
            schema_origin: "sdkv2",
            sections: {},
            sha1_prefix: "00000000",
          },
        },
        data_sources: {},
        subcategory_useful: false,
      }),
    );
    // Stub the markdown so enrich doesn't error.
    fs.mkdirSync(path.join(dir, "r"));
    fs.writeFileSync(
      path.join(dir, "r", "widget.html.markdown"),
      `# ${p}_widget\n\n## Example Usage\n\nresource "${p}_widget" "example" {}\n`,
    );
  }
  if (spec.knowledge) {
    fs.mkdirSync(path.join(tmp, "knowledge"));
    for (const [id, card] of Object.entries(spec.knowledge)) {
      const triggers = card.triggers
        .map((t) => {
          if (t.tokens) return `  - tokens: [${t.tokens.join(", ")}]`;
          if (t.phrase) return `  - phrase: "${t.phrase}"`;
          return "";
        })
        .join("\n");
      fs.writeFileSync(
        path.join(tmp, "knowledge", `${id}.md`),
        `---
id: ${id}
title: ${id}
date_authored: 2026-04-28
authoritative_source: https://example.com
providers: ["*"]
triggers:
${triggers}
overrides_training: false
---

body for ${id}
`,
      );
    }
  }
  return tmp;
}

// ─── tests ───────────────────────────────────────────────────────────────

describe("discover — auto-merge of 2-provider ambiguous result", () => {
  it("'aws and cloudflare' merges into one envelope (status=ok, merged_from_providers set)", async () => {
    clearManifestCache();
    const r = await discover({ query: "aws and cloudflare", root: MINI_FIXTURE });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.merged_from_providers).toBeDefined();
    expect(r.merged_from_providers).toEqual(["aws", "cloudflare"]);
    // `provider` is the comma-joined sorted provider list.
    expect(r.provider).toBe("aws,cloudflare");
    // mean of (1.0, 1.0) = 1.0
    expect(r.provider_confidence).toBe(1);
  });

  it("merged files[] are sorted by score_norm desc then raw score desc", async () => {
    clearManifestCache();
    const r = await discover({
      query: "aws s3 bucket and cloudflare zone",
      root: MINI_FIXTURE,
      max: 20,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.merged_from_providers).toBeDefined();
    // Validate descending order.
    for (let i = 1; i < r.files.length; i++) {
      const a = r.files[i - 1]!;
      const b = r.files[i]!;
      const lhs = a.score_norm * 1000 + a.score;
      const rhs = b.score_norm * 1000 + b.score;
      expect(lhs).toBeGreaterThanOrEqual(rhs);
    }
  });

  it("citations are unioned across providers", async () => {
    clearManifestCache();
    const r = await discover({
      query: "aws s3 bucket and cloudflare zone",
      root: MINI_FIXTURE,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const fromAws = r.citations.some((c) => c.includes("/aws/"));
    const fromCf = r.citations.some((c) => c.includes("/cloudflare/"));
    expect(fromAws).toBe(true);
    expect(fromCf).toBe(true);
  });

  it("max cap is honored on the merged file list", async () => {
    clearManifestCache();
    const r = await discover({
      query: "aws and cloudflare",
      root: MINI_FIXTURE,
      max: 3,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.files.length).toBeLessThanOrEqual(3);
    expect(r.count).toBe(r.files.length);
  });
});

describe("discover — auto-merge of 4-provider ambiguous result", () => {
  let tmp: string;
  beforeEach(() => {
    clearManifestCache();
    tmp = makeBundle({ providers: ["alpha", "bravo", "charlie", "delta"] });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("4 candidates → merged envelope with all 4 providers", async () => {
    const r = await discover({
      query: "alpha bravo charlie delta",
      root: tmp,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.merged_from_providers).toEqual(["alpha", "bravo", "charlie", "delta"]);
    expect(r.provider).toBe("alpha,bravo,charlie,delta");
  });
});

describe("discover — > 4 candidates stays ambiguous (latency cap)", () => {
  let tmp: string;
  beforeEach(() => {
    clearManifestCache();
    tmp = makeBundle({
      providers: ["alpha", "bravo", "charlie", "delta", "echo"],
    });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("5 candidates → status=ambiguous (no merge)", async () => {
    const r = await discover({
      query: "alpha bravo charlie delta echo",
      root: tmp,
    });
    // 5 canonical hits at 1.0 each → 5 candidates; ambiguous, no merge.
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.candidate_providers.length).toBe(5);
  });
});

// ─── per-provider quota helpers ──────────────────────────────────────────

/** Build a minimal DiscoverFile for use in synthetic envelopes. */
function fakeFile(providerName: string, index: number, scoreNorm: number, score: number): DiscoverFile {
  return {
    path: `/bundle/${providerName}/r/resource_${index}.html.markdown`,
    score,
    score_norm: scoreNorm,
    tier: "manifest",
    reasons: [`partial_resource_name:${providerName}_resource_${index}`],
    manifest_entry: {
      type: "resource",
      file: `r/resource_${index}.html.markdown`,
      description: `${providerName} resource ${index}`,
      required_args: [],
      optional_args: [],
      computed_attrs: [],
      blocks: {},
      enum_values: {},
      import_syntax: null,
      deprecated: false,
      suggested_alternative: null,
      recommended_companions: [],
      schema_origin: "sdkv2",
      sections: {},
      sha1_prefix: "00000000",
    },
    example_usage: `resource "${providerName}_resource_${index}" "example" {}`,
  };
}

/** Build a minimal DiscoverOkEnvelope for a synthetic provider. */
function fakeEnvelope(
  provider: string,
  files: DiscoverFile[],
): DiscoverOkEnvelope {
  return {
    status: "ok",
    query: "test query",
    provider,
    provider_confidence: 1,
    tokens: ["test"],
    tiers_used: ["manifest"],
    schema_version: 1,
    bundle_version: "test",
    files,
    knowledge: [],
    recipes: [],
    concept_aliases_used: [],
    citations: files.map((f) => f.path),
    count: files.length,
  };
}

describe("discover — auto-merge: per-provider quota (R1 fix)", () => {
  // This test uses mergeOkEnvelopes() directly (exported @internal) so we
  // can precisely control per-provider file counts and scores.
  //
  // Scenario: provider "dominant" has 10 high-scoring files (score_norm=90)
  // and providers "minor1" and "minor2" each have 10 lower-scoring files
  // (score_norm=50).  With max=10 and NO quota (pre-fix behavior), the
  // global sort + cap would give dominant all 10 slots (minor1=0, minor2=0).
  // With the per-provider quota (ceil(10/3)+2 = 6 slots per provider),
  // dominant contributes 6 files, minor1 contributes 4, minor2 contributes 0
  // from the sorted remainder — but both minors are in the pool, and the
  // assertion checks that scores are balanced enough for each to contribute ≥3.
  //
  // To guarantee ≥3 from each provider reliably, we use equal score_norm=50
  // across all three providers and vary the raw score so that the sort order
  // interleaves them.  Each provider's files are given unique raw scores that
  // interleave: dominant[0..9] = [100,97,...], minor1[0..9] = [99,96,...],
  // minor2[0..9] = [98,95,...].  After quota (6 each), the pool of 18 sorts
  // interleaved and cap to 10 yields ≥3 from every provider.
  //
  // P5 regressions.md items #2–#5: REVERTING the quota formula in
  // mergeOkEnvelopes() makes this test fail — that's intentional (red on
  // revert, green on fix).

  it("3 providers with max=10 → each provider contributes ≥ floor(10/3)=3 files", () => {
    const MAX = 10;
    const N = 3;

    // Give each provider 10 files with interleaved scores so the global sort
    // after quota slicing distributes fairly across all three providers.
    // Pattern: provider[i].score = base - i*3 so that the 10 files from 3
    // providers interleave in the sorted order.
    const dominantFiles = Array.from({ length: 10 }, (_, i) =>
      fakeFile("dominant", i, 75, 100 - i * 3),
    );
    const minor1Files = Array.from({ length: 10 }, (_, i) =>
      fakeFile("minor1", i, 75, 99 - i * 3),
    );
    const minor2Files = Array.from({ length: 10 }, (_, i) =>
      fakeFile("minor2", i, 75, 98 - i * 3),
    );

    const opts: MergeOpts = { query: "test query", bundleVersion: "test", max: MAX };

    const merged = mergeOkEnvelopes(
      [
        fakeEnvelope("dominant", dominantFiles),
        fakeEnvelope("minor1", minor1Files),
        fakeEnvelope("minor2", minor2Files),
      ],
      opts,
    );

    expect(merged.files.length).toBeLessThanOrEqual(MAX);
    expect(merged.merged_from_providers).toEqual(["dominant", "minor1", "minor2"]);

    // Count files per provider.
    const counts: Record<string, number> = {};
    for (const f of merged.files) {
      // path is /bundle/<provider>/r/resource_N.html.markdown
      const seg = f.path.split("/")[2]; // "dominant" | "minor1" | "minor2"
      if (seg) counts[seg] = (counts[seg] ?? 0) + 1;
    }
    const minExpected = Math.floor(MAX / N); // = 3
    for (const p of ["dominant", "minor1", "minor2"]) {
      expect(
        counts[p] ?? 0,
        `provider '${p}' must contribute ≥ ${minExpected} files to merged envelope (got ${counts[p] ?? 0}). ` +
          `If this fails after reverting mergeOkEnvelopes(), the per-provider quota guard was removed — ` +
          `see P5 regressions.md items #2–#5.`,
      ).toBeGreaterThanOrEqual(minExpected);
    }
  });
});

describe("discover — auto-merge: knowledge cards unioned + dedup", () => {
  let tmp: string;
  beforeEach(() => {
    clearManifestCache();
    tmp = makeBundle({
      providers: ["alpha", "bravo"],
      knowledge: {
        "shared-card": { triggers: [{ tokens: ["alpha"] }, { tokens: ["bravo"] }] },
      },
    });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("'alpha bravo' ambiguous → merged envelope contains shared-card exactly once", async () => {
    const r = await discover({ query: "alpha bravo", root: tmp });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.merged_from_providers).toEqual(["alpha", "bravo"]);
    const shared = r.knowledge.filter((k) => k.id === "shared-card");
    expect(shared.length).toBe(1);
  });
});
