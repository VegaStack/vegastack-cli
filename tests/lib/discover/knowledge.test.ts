// Knowledge-card loader unit tests against the bundle-mini fixture.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadKnowledge } from "../../../src/lib/discover/knowledge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");

describe("loadKnowledge — happy path", () => {
  it("parses frontmatter and returns cards matching a token trigger", () => {
    const cards = loadKnowledge({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["s3", "backend", "lock"],
      query: "s3 backend lock",
      provider: "aws",
    });
    expect(cards.length).toBeGreaterThan(0);
    const c = cards.find((x) => x.id === "aws-s3-native-state-locking");
    expect(c).toBeDefined();
    expect(c!.title).toMatch(/native state locking/i);
    expect(c!.providers).toContain("aws");
    expect(c!.body).toMatch(/use_lockfile = true/);
    expect(c!.overrides_training).toBe(true);
  });

  it("phrase-trigger matches case-insensitively against the original query", () => {
    const cards = loadKnowledge({
      bundleRoot: FIXTURE_ROOT,
      tokens: [],
      query: "Do I need dynamodb FOR terraform state lock",
      provider: "aws",
    });
    expect(cards.find((c) => c.id === "aws-s3-native-state-locking")).toBeDefined();
  });

  it("returns [] when no triggers match", () => {
    const cards = loadKnowledge({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["unrelated"],
      query: "completely different query",
      provider: "aws",
    });
    expect(cards.find((c) => c.id === "aws-s3-native-state-locking")).toBeUndefined();
  });

  it("filters by provider", () => {
    const cards = loadKnowledge({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["s3", "backend", "lock"],
      query: "s3 backend lock",
      provider: "cloudflare",
    });
    // The card's providers=[aws]; cloudflare query should not see it.
    expect(cards.find((c) => c.id === "aws-s3-native-state-locking")).toBeUndefined();
  });

  it("returns deterministically sorted cards", () => {
    const cards = loadKnowledge({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["s3", "backend", "lock"],
      query: "s3 backend lock",
      provider: "aws",
    });
    const ids = cards.map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("loadKnowledge — empty / missing dirs", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-kn-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("missing knowledge/ dir → []", () => {
    const cards = loadKnowledge({ bundleRoot: tmp, tokens: ["s3"], query: "s3" });
    expect(cards).toEqual([]);
  });

  it("empty knowledge/ dir → []", () => {
    fs.mkdirSync(path.join(tmp, "knowledge"));
    const cards = loadKnowledge({ bundleRoot: tmp, tokens: ["s3"], query: "s3" });
    expect(cards).toEqual([]);
  });

  it("malformed frontmatter is skipped (no throw)", () => {
    fs.mkdirSync(path.join(tmp, "knowledge"));
    fs.writeFileSync(path.join(tmp, "knowledge", "bad.md"), "no frontmatter here");
    const cards = loadKnowledge({ bundleRoot: tmp, tokens: [], query: "" });
    expect(cards).toEqual([]);
  });
});
