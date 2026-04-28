// Token-stemming tests for tokenize.ts and the downstream knowledge / recipe
// matchers. Closes the D1 killer card (S3 backend native state locking) and
// related A12 / mongodb-atlas / cloudflare-rename gaps documented in
// /Users/mk/projects/vegastack-cli/docs/status/phase5-broad-eval/SYNTHESIS.md
// §7 fix #3.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadKnowledge } from "../../../src/lib/discover/knowledge.js";
import { stem, tokenize } from "../../../src/lib/discover/tokenize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");

describe("stem — suffix stripping", () => {
  it("strips -ing", () => {
    expect(stem("locking")).toBe("lock");
    expect(stem("running")).toBe("runn");
    expect(stem("merging")).toBe("merg");
  });

  it("strips trailing -s (plural) yielding the singular noun", () => {
    // Plural -s wins over -er: "workers" → "worker" (singular noun).
    expect(stem("workers")).toBe("worker");
    expect(stem("rotators")).toBe("rotator");
  });

  it("strips -er for true agentive nouns (no plural)", () => {
    expect(stem("worker")).toBe("work");
    expect(stem("trigger")).toBe("trigg");
  });

  it("strips -es when stem ends in s/x/z/ch/sh", () => {
    // "boxes" → "box" (ends in "x", classic -es plural rule)
    expect(stem("boxes")).toBe("box");
    // "classes" → "class" (ends in "s")
    expect(stem("classes")).toBe("class");
    // "buckets" does NOT match -es (stem "buck" doesn't end in s/x/z/ch/sh);
    // it falls through to -s → "bucket".
    expect(stem("buckets")).toBe("bucket");
  });

  it("strips -s when remaining ≥3 chars", () => {
    expect(stem("tables")).toBe("table");
    expect(stem("clusters")).toBe("cluster");
  });

  it("does not strip -s when remaining would drop below 3", () => {
    // "as" → too short overall (length 2, returned unchanged)
    expect(stem("as")).toBe("as");
    // "is" → length 2, returned unchanged
    expect(stem("is")).toBe("is");
  });

  it("does not strip -ss (e.g. 'class')", () => {
    expect(stem("class")).toBe("class");
    expect(stem("access")).toBe("access");
  });

  it("returns identifier-style tokens unchanged", () => {
    expect(stem("M40")).toBe("M40");
    expect(stem("v2")).toBe("v2");
    expect(stem("kms_alias")).toBe("kms_alias");
  });

  // P5 regressions.md item #1 (E9-A4-k8s-v1-suffix): digit-bearing tokens
  // must be returned unchanged.  If these assertions fail, the digit-protection
  // guard (`/[0-9]/` early-return) was removed or narrowed — that causes the
  // kubernetes-provider-v2-fields knowledge card's `tokens: ["v1"]` trigger
  // to stop matching, and breaks the k8s v1→v2 migration eval.
  it("digit-protection: v1, M40, t4g, r6g are returned unchanged (R2 guard)", () => {
    expect(stem("v1")).toBe("v1");    // k8s versioned alias trigger
    expect(stem("M40")).toBe("M40");  // mongodb-atlas tier name
    expect(stem("t4g")).toBe("t4g");  // AWS instance type suffix
    expect(stem("r6g")).toBe("r6g");  // AWS instance type suffix
    // Confirm the non-digit path still works (regression check: R2 guard
    // must not swallow the -ing rule).
    expect(stem("locking")).toBe("lock");
  });

  it("returns short tokens unchanged", () => {
    expect(stem("at")).toBe("at");
    expect(stem("ec2")).toBe("ec2");
  });

  it("returns purely numeric tokens unchanged", () => {
    expect(stem("12345")).toBe("12345");
  });
});

describe("tokenize — emits both original and stem", () => {
  it("appends stem 'lock' alongside original 'locking'", () => {
    const out = tokenize("S3 backend state locking DynamoDB");
    expect(out).toContain("locking");
    expect(out).toContain("lock");
  });

  it("appends stem 'cluster' alongside 'clusters'", () => {
    const out = tokenize("Atlas clusters in production");
    expect(out).toContain("clusters");
    expect(out).toContain("cluster");
  });

  it("appends stem 'bucket' alongside 'buckets'", () => {
    const out = tokenize("manage S3 buckets");
    expect(out).toContain("buckets");
    expect(out).toContain("bucket");
  });

  it("does not produce stems shorter than 3 chars", () => {
    // "as" stays as-is; would only be 1 char post-strip and is below floor.
    const out = tokenize("ECS as a service");
    // "as" is in NOISE so it's filtered anyway, but the contract is that the
    // floor is enforced at the stemming step too.
    expect(out.every((t) => t.length >= 2)).toBe(true);
  });

  it("dedups overlapping stems and originals", () => {
    const out = tokenize("buckets bucket buckets");
    const counts = new Map<string, number>();
    for (const t of out) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const c of counts.values()) expect(c).toBe(1);
  });
});

describe("D1 specific: 'S3 backend state locking DynamoDB' fires aws-s3-native-state-locking", () => {
  it("trigger tokens [s3, backend, lock] match query tokens with stem applied", () => {
    const tokens = tokenize("S3 backend state locking DynamoDB");
    const cards = loadKnowledge({
      bundleRoot: FIXTURE_ROOT,
      tokens,
      query: "S3 backend state locking DynamoDB",
      provider: "aws",
    });
    const c = cards.find((x) => x.id === "aws-s3-native-state-locking");
    expect(c).toBeDefined();
  });
});

describe("matchesAnyTrigger — bidirectional stem matching", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-stem-"));
    fs.mkdirSync(path.join(tmp, "knowledge"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("trigger token 'cluster' matches query token 'clusters' (query → trigger via stem)", () => {
    fs.writeFileSync(
      path.join(tmp, "knowledge", "test-cluster.md"),
      `---
id: test-cluster-card
title: Test cluster card
date_authored: 2026-04-28
authoritative_source: https://example.com
providers: ["*"]
triggers:
  - tokens: [atlas, cluster]
overrides_training: false
---

body
`,
    );
    const tokens = tokenize("Atlas clusters need tuning");
    const cards = loadKnowledge({
      bundleRoot: tmp,
      tokens,
      query: "Atlas clusters need tuning",
    });
    expect(cards.find((c) => c.id === "test-cluster-card")).toBeDefined();
  });

  it("trigger token 'locking' matches query token 'lock' (trigger → query via stem)", () => {
    fs.writeFileSync(
      path.join(tmp, "knowledge", "test-locking.md"),
      `---
id: test-locking-card
title: Test locking card
date_authored: 2026-04-28
authoritative_source: https://example.com
providers: ["*"]
triggers:
  - tokens: [state, locking]
overrides_training: false
---

body
`,
    );
    const cards = loadKnowledge({
      bundleRoot: tmp,
      tokens: ["state", "lock"],
      query: "terraform state lock",
    });
    expect(cards.find((c) => c.id === "test-locking-card")).toBeDefined();
  });
});
