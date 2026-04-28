// v1-suffix matcher tests — closes S7 W1 (E9-A4-k8s-v1-suffix).
//
// The kubernetes provider ships *_v1 suffixed resources alongside the
// unsuffixed legacy forms (`kubernetes_deployment_v1` vs
// `kubernetes_deployment`). Knowledge cards trigger on these versioned
// names. S1's stem() digit guard ensures `stem("v1") === "v1"` so a
// trigger token `["v1"]` does not get stripped to `["v"]` (which would
// match v2/v3 by accident).
//
// These tests verify the digit-guard is applied symmetrically on BOTH
// sides of the match (trigger token AND query token), and that digit
// specificity is preserved (v1 trigger does NOT match v2 query).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadKnowledge } from "../../../src/lib/discover/knowledge.js";
import { tokenize } from "../../../src/lib/discover/tokenize.js";

describe("v1-suffix matcher — symmetric digit guard", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-v1suffix-"));
    fs.mkdirSync(path.join(tmp, "knowledge"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function writeCard(id: string, triggers: string): void {
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

body
`,
    );
  }

  it("trigger ['kubernetes_deployment_v1'] matches a query containing 'kubernetes_deployment_v1'", () => {
    writeCard("k8s-dep-v1", "  - tokens: [kubernetes_deployment_v1]");
    const query = "Migrate to kubernetes_deployment_v1";
    const tokens = tokenize(query);
    const cards = loadKnowledge({ bundleRoot: tmp, tokens, query });
    expect(cards.find((c) => c.id === "k8s-dep-v1")).toBeDefined();
  });

  it("trigger ['v1'] matches a query containing the bare token 'v1'", () => {
    writeCard("v1-bare", "  - tokens: [v1]");
    // tokenize will produce ['migrate', 'use', 'v1'] — 'v1' must survive
    // because stem("v1") returns "v1" unchanged (digit guard).
    const query = "migrate to use v1";
    const tokens = tokenize(query);
    expect(tokens).toContain("v1");
    const cards = loadKnowledge({ bundleRoot: tmp, tokens, query });
    expect(cards.find((c) => c.id === "v1-bare")).toBeDefined();
  });

  it("trigger ['v1'] does NOT match a query containing only 'v2' (digit specificity preserved)", () => {
    writeCard("v1-bare", "  - tokens: [v1]");
    const query = "migrate to use v2";
    const tokens = tokenize(query);
    expect(tokens).toContain("v2");
    expect(tokens).not.toContain("v1");
    const cards = loadKnowledge({ bundleRoot: tmp, tokens, query });
    // The card MUST NOT fire — if the digit guard is reverted, both v1 and v2
    // would stem to "v" and this assertion would fail with the card present.
    expect(cards.find((c) => c.id === "v1-bare")).toBeUndefined();
  });

  it("trigger ['v1'] matches via the same stem() used by tokenize() (no second-stemmer drift)", () => {
    // Construct a token set directly to verify matchesAnyTrigger uses the same
    // stem() implementation as tokenize. If a second stemmer were imported on
    // the trigger side that did NOT have the digit guard, "v1" would stem to
    // "v" and fail to match a query token of "v1".
    writeCard("v1-bare", "  - tokens: [v1]");
    const cards = loadKnowledge({
      bundleRoot: tmp,
      tokens: ["v1"],
      query: "v1",
    });
    expect(cards.find((c) => c.id === "v1-bare")).toBeDefined();
  });
});
