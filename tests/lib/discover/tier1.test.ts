// Per-stage Tier-1 unit tests against the bundle-mini fixture.

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadManifest } from "../../../src/lib/discover/manifest.js";
import { tier1 } from "../../../src/lib/discover/tier1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");
const AWS_DIR = path.join(FIXTURE_ROOT, "aws");
const CF_DIR = path.join(FIXTURE_ROOT, "cloudflare");

function paths(map: ReadonlyMap<string, unknown>): string[] {
  return Array.from(map.keys()).map((p) => path.basename(p));
}

describe("tier1 — exact_resource", () => {
  it("matches stripped resource name (s3_bucket)", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["s3_bucket"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    const ps = paths(out);
    expect(ps).toContain("s3_bucket.html.markdown");
    const entry = Array.from(out.values()).find((v) =>
      v.reasons.some((r) => r.kind === "exact_resource"),
    );
    expect(entry).toBeDefined();
  });

  it("matches full resource name (aws_s3_bucket)", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["aws_s3_bucket"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    expect(paths(out)).toContain("s3_bucket.html.markdown");
  });
});

describe("tier1 — primary_resource (manifest-driven)", () => {
  it("'s3' token fires primary_resource:aws_s3_bucket", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["s3"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    const found = Array.from(out.entries()).find(([p]) => p.endsWith("s3_bucket.html.markdown"));
    expect(found).toBeDefined();
    expect(found![1].reasons.some((r) => r.kind === "primary_resource")).toBe(true);
  });
});

describe("tier1 — subcategory_peer fanout (closes F9)", () => {
  it("primary_resource hit also fans out subcat peers", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["s3"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    const ps = paths(out);
    expect(ps).toContain("s3_bucket_versioning.html.markdown");
    expect(ps).toContain("s3_bucket_public_access_block.html.markdown");
    const peer = Array.from(out.entries()).find(([p]) =>
      p.endsWith("s3_bucket_versioning.html.markdown"),
    );
    expect(peer![1].reasons.some((r) => r.kind === "subcategory_peer")).toBe(true);
  });

  it("exact_resource hit also fans out subcat peers", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["s3_bucket_versioning"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    expect(paths(out)).toContain("s3_bucket.html.markdown");
  });
});

describe("tier1 — name_partial", () => {
  it("'cluster' fires name_partial against aws_eks_cluster", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["cluster"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    const eks = Array.from(out.entries()).find(([p]) => p.endsWith("eks_cluster.html.markdown"));
    expect(eks).toBeDefined();
    expect(eks![1].reasons.some((r) => r.kind === "name_partial")).toBe(true);
  });
});

describe("tier1 — subcat_keyword (manifest-driven)", () => {
  it("'eks' lights up the EKS subcategory peers via subcat_keywords", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["eks"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    const ps = paths(out);
    expect(ps).toContain("eks_cluster.html.markdown");
    expect(ps).toContain("eks_node_group.html.markdown");
  });
});

describe("tier1 — argument_index", () => {
  it("'function_name' matches lambda via argument_index", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["function_name"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    const lf = Array.from(out.entries()).find(([p]) =>
      p.endsWith("lambda_function.html.markdown"),
    );
    expect(lf).toBeDefined();
    expect(lf![1].reasons.some((r) => r.kind === "argument_index")).toBe(true);
  });
});

describe("tier1 — recommended_companions (1l)", () => {
  it("S3 bucket hit surfaces companion resources", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["s3"],
      provider: "aws",
      providerDir: AWS_DIR,
    });
    const ps = paths(out);
    expect(ps).toContain("s3_bucket_versioning.html.markdown");
    expect(ps).toContain("s3_bucket_server_side_encryption_configuration.html.markdown");
    expect(ps).toContain("s3_bucket_public_access_block.html.markdown");

    const versioning = Array.from(out.entries()).find(([p]) =>
      p.endsWith("s3_bucket_versioning.html.markdown"),
    );
    expect(versioning![1].reasons.some((r) => r.kind === "recommended_companion")).toBe(true);
  });

  it("uses pre-built fileToResource map when supplied (closes F24)", () => {
    const manifest = loadManifest(AWS_DIR);
    const fileToResource = new Map<string, string>();
    for (const [name, entry] of Object.entries(manifest.resources)) {
      fileToResource.set(entry.file, name);
    }
    const out = tier1({
      manifest,
      tokens: ["s3"],
      provider: "aws",
      providerDir: AWS_DIR,
      fileToResource,
    });
    expect(paths(out)).toContain("s3_bucket_versioning.html.markdown");
  });
});

describe("tier1 — alias_resource widening", () => {
  it("matched alias surfaces alias.resources via alias_resource reason", () => {
    const manifest = loadManifest(AWS_DIR);
    const out = tier1({
      manifest,
      tokens: ["dummy"],
      provider: "aws",
      providerDir: AWS_DIR,
      aliasMatches: [
        {
          phrase: "static website",
          alias: "s3_static_site",
          provider: "aws",
          resources: ["aws_s3_bucket_website_configuration"],
        },
      ],
    });
    const ws = Array.from(out.entries()).find(([p]) =>
      p.endsWith("s3_bucket_website_configuration.html.markdown"),
    );
    expect(ws).toBeDefined();
    expect(ws![1].reasons.some((r) => r.kind === "alias_resource")).toBe(true);
  });
});

describe("tier1 — cloudflare", () => {
  it("'dns' fires primary_resource for cloudflare_dns_record", () => {
    const manifest = loadManifest(CF_DIR);
    const out = tier1({
      manifest,
      tokens: ["dns"],
      provider: "cloudflare",
      providerDir: CF_DIR,
    });
    const dns = Array.from(out.entries()).find(([p]) =>
      p.endsWith("dns_record.html.markdown"),
    );
    expect(dns).toBeDefined();
    expect(dns![1].reasons.some((r) => r.kind === "primary_resource")).toBe(true);
  });
});
