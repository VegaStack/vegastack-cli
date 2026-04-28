// Integration tests for the native TypeScript discoverer (v0.1 envelope).
// Requires the upstream provider bundle on disk; skipped if not present.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { discover } from "../../src/lib/discover/index.js";

const BUNDLE_ROOT =
  process.env.VEGASTACK_BUNDLE_DIR_TEST ??
  "/Users/mk/projects/engg-vegastack-agent-tf-providers/terraform-providers";

const HAVE_BUNDLE = fs.existsSync(path.join(BUNDLE_ROOT, "MANIFEST.json"));

describe.runIf(HAVE_BUNDLE)("native discoverer — happy path", () => {
  it("S3 bucket query surfaces an S3-related resource in top-3", async () => {
    const r = await discover({ query: "create an S3 bucket with versioning", root: BUNDLE_ROOT });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.provider).toBe("aws");
    expect(r.files.length).toBeGreaterThan(0);
    // Note: exact #1 ordering depends on E1 shipping primary_resources in
    // the bundle MANIFEST.json. Until then, any s3_bucket-prefixed page in
    // top-3 satisfies the contract.
    const top3 = r.files
      .slice(0, 3)
      .map((f) => f.path)
      .join("|");
    expect(top3).toMatch(/s3_bucket/);
    expect(r.files[0]?.score).toBeGreaterThan(50);
    expect(r.files[0]?.score_norm).toBeGreaterThanOrEqual(0);
    expect(r.schema_version).toBe(1);
    expect(typeof r.bundle_version).toBe("string");
  });

  it("EC2 query surfaces aws_instance somewhere in top-5", async () => {
    const r = await discover({ query: "EC2 instance for dev", root: BUNDLE_ROOT });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.provider).toBe("aws");
    const top5 = r.files
      .slice(0, 5)
      .map((f) => f.path)
      .join("|");
    expect(top5).toMatch(/instance\./);
  });

  it("Cloudflare DNS query → cloudflare_dns_record (the modern v5 resource)", async () => {
    const r = await discover({
      query: "cloudflare DNS A record",
      root: BUNDLE_ROOT,
      max: 5,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.provider).toBe("cloudflare");
    const paths = r.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("dns_record"))).toBe(true);
  });

  it("Kubernetes deployment query is provider-scoped", async () => {
    const r = await discover({ query: "kubernetes deployment with replicas", root: BUNDLE_ROOT });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.provider).toBe("kubernetes");
  });

  it("ambiguous detection auto-merges ≤4 candidate providers (closes A7)", async () => {
    // v0.1.1: when the classifier reports `ambiguous` with ≤4 candidates,
    // the discoverer fans out per-provider and unions the result.
    const r = await discover({ query: "aws azure deployment", root: BUNDLE_ROOT });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.merged_from_providers).toBeDefined();
    expect(r.merged_from_providers).toEqual(expect.arrayContaining(["aws", "azure"]));
    // `provider` is the comma-joined sorted list.
    expect(r.provider).toBe(r.merged_from_providers!.join(","));
  });

  it("error envelope when no provider detectable", async () => {
    const r = await discover({ query: "hello world", root: BUNDLE_ROOT });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.error).toMatch(/Could not detect provider/);
    expect(r.code).toBe("ProviderUndetected");
  });
});

describe.runIf(HAVE_BUNDLE)("enrichment", () => {
  it("inlines manifest_entry by default", async () => {
    const r = await discover({ query: "S3 bucket", root: BUNDLE_ROOT, max: 3 });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const top = r.files[0];
    expect(top?.manifest_entry).toBeDefined();
    expect(top?.manifest_entry).toHaveProperty("type");
    expect(top?.manifest_entry).toHaveProperty("file");
  });

  it("--raw mode (enrich:false) still synthesizes manifest_entry but no example body", async () => {
    const r = await discover({
      query: "S3 bucket",
      root: BUNDLE_ROOT,
      max: 3,
      enrich: false,
    });
    if (r.status !== "ok") return;
    expect(r.files[0]?.path).toBeDefined();
    expect(r.files[0]?.example_usage).toBe("");
  });
});

describe.runIf(HAVE_BUNDLE)("debug timings", () => {
  it("debug:true attaches timings", async () => {
    const r = await discover({
      query: "aws_instance",
      root: BUNDLE_ROOT,
      max: 3,
      debug: true,
    });
    if (r.status !== "ok") return;
    expect(r.timings).toBeDefined();
    expect(r.timings?.tier1_ms).toBeGreaterThanOrEqual(0);
    expect(r.timings?.total_ms).toBeGreaterThan(0);
  });

  it("debug:false omits timings", async () => {
    const r = await discover({ query: "aws_instance", root: BUNDLE_ROOT, max: 3, debug: false });
    if (r.status !== "ok") return;
    expect(r.timings).toBeUndefined();
  });
});

describe.runIf(HAVE_BUNDLE)("provided --provider overrides detection", () => {
  it("picks the supplied provider even on a bare query", async () => {
    const r = await discover({
      query: "instance",
      provider: "azure",
      root: BUNDLE_ROOT,
      max: 3,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.provider).toBe("azure");
    expect(r.provider_confidence).toBe(1);
  });

  it("rejects an unknown --provider against the bundle's provider list", async () => {
    const r = await discover({
      query: "anything",
      provider: "not-a-real-provider",
      root: BUNDLE_ROOT,
    });
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.code).toBe("ProviderUnknown");
  });
});
