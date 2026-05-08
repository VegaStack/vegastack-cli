// Regression test for the production bug surfaced by true E2E on 2026-05-08:
//
// `vegastack ask "<query>"` (no --pack, no --all) was failing with
//   ValidationError: no Registry packs are selected in .vegastack/vegastack.yml
// even when .vegastack/vegastack.yml had `registry.entries: { docker: ..., ... }`.
//
// Root cause: commander's `.option("--pack <names>", collect, [])` defaults
// `opts.pack` to `[]` when the flag is absent. cli.ts then forwarded that empty
// array as `entries` into the resolver, and `_shared.ts` checked `if (opts.entries)`
// which is truthy for `[]` in JS — so the project-config code path was bypassed
// and the resolver returned `[]` ⇒ "no Registry packs are selected".
//
// Two fixes (defense-in-depth):
//   1. cli.ts only forwards `opts.pack` when length > 0
//   2. _shared.ts treats empty arrays as "no override given"
//
// This test pins fix (2) directly. Fix (1) is exercised by the existing
// integration tests for `ask` / `search`.

import { describe, expect, it } from "vitest";
import { resolveRegistryEntriesFromOptions } from "../../src/commands/_shared.js";

describe("resolveRegistryEntriesFromOptions: empty entries[] is treated as 'no override'", () => {
  it("falls through to project-config resolution when entries is an empty array", () => {
    // Without a .vegastack/vegastack.yml, this should throw the
    // "VegaStack project harness not initialized" ValidationError —
    // NOT the "(empty entries) bypass" hit that the bug exhibited.
    expect(() => resolveRegistryEntriesFromOptions({ entries: [], all: false })).toThrow(
      /not initialized in this directory|--pack <pack>/,
    );
  });

  it("falls through to project-config resolution when entries is undefined", () => {
    expect(() => resolveRegistryEntriesFromOptions({ all: false })).toThrow(
      /not initialized in this directory|--pack <pack>/,
    );
  });
});
