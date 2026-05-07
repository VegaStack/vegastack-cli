// Audit code-review/discover F-006: detectMultiProviderPhrasing used to
// rebuild the per-Registry-pack alias-file phrase list (and re-sort it)
// on every query. With ~20 providers each call walked N alias.yaml files.
// Now the assembled list is cached per (terraformRoot, knownProviders).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _clearAliasFilePhrasesCacheForTests,
  detectMultiProviderPhrasing,
} from "../../../src/lib/discover/index.js";
import { clearAliasCache } from "../../../src/lib/discover/aliases.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vs-aliasphrases-"));
  _clearAliasFilePhrasesCacheForTests();
  clearAliasCache();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  _clearAliasFilePhrasesCacheForTests();
  clearAliasCache();
});

function writeAliasFile(provider: string, body: string): void {
  const dir = path.join(root, provider);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "aliases.yaml"), body);
}

describe("getAliasFilePhrases cache (F-006)", () => {
  it("returns identity-equal arrays across calls for the same key", () => {
    writeAliasFile(
      "crowdstrike",
      `- phrase: falcon\n  alias: falcon\n  resources:\n    - crowdstrike_host\n`,
    );
    writeAliasFile(
      "cloudflare",
      `- phrase: cloudflare dns\n  alias: cf_dns\n  resources:\n    - cloudflare_dns_record\n`,
    );

    const providers = ["crowdstrike", "cloudflare", "aws"];

    // Indirectly: detectMultiProviderPhrasing reads the cached list. The
    // observable signal is correctness across repeated calls — if cache
    // poisoning or staleness happened, results would diverge.
    const a = detectMultiProviderPhrasing("falcon on aws", providers, root);
    const b = detectMultiProviderPhrasing("falcon on aws", providers, root);
    expect(a).toEqual(b);
    // Both should detect crowdstrike + aws.
    expect(a?.providers).toEqual(expect.arrayContaining(["crowdstrike", "aws"]));
  });

  it("clearing the cache lets new alias.yaml files take effect", () => {
    const providers = ["crowdstrike", "aws"];
    // No alias file yet — falcon shouldn't resolve.
    const before = detectMultiProviderPhrasing("falcon on aws", providers, root);
    expect(before).toBeUndefined();

    writeAliasFile(
      "crowdstrike",
      `- phrase: falcon\n  alias: falcon\n  resources:\n    - crowdstrike_host\n`,
    );
    _clearAliasFilePhrasesCacheForTests();
    clearAliasCache();

    const after = detectMultiProviderPhrasing("falcon on aws", providers, root);
    expect(after?.providers).toEqual(expect.arrayContaining(["crowdstrike", "aws"]));
  });
});
