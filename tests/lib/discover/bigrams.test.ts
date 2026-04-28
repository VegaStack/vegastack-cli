import { describe, expect, it } from "vitest";
import { bigrams } from "../../../src/lib/discover/bigrams.js";

describe("bigrams", () => {
  it("matches the documented Python algorithm", () => {
    expect(bigrams("example")).toEqual(["ex", "xa", "am", "mp", "pl", "le"]);
  });

  it("returns empty for length < 2", () => {
    expect(bigrams("")).toEqual([]);
    expect(bigrams("a")).toEqual([]);
  });

  it("length-2 produces a single bigram", () => {
    expect(bigrams("ab")).toEqual(["ab"]);
  });

  it("preserves duplicates (sliding window)", () => {
    expect(bigrams("aaa")).toEqual(["aa", "aa"]);
  });
});
