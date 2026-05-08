import { describe, expect, it } from "vitest";
import { validateRegistryEntryName } from "../../src/commands/registry.js";

describe("validateRegistryEntryName — boundary validation", () => {
  it("accepts well-formed pack ids", () => {
    for (const n of ["vegastack", "discover", "scan", "agent-skills", "x", "a-b-c-1"]) {
      expect(() => validateRegistryEntryName(n)).not.toThrow();
    }
  });

  it("rejects traversal / scheme / slashed values", () => {
    expect(() => validateRegistryEntryName("../foo")).toThrow(/valid Registry pack/i);
    expect(() => validateRegistryEntryName("foo/bar")).toThrow(/valid Registry pack/i);
    expect(() => validateRegistryEntryName("http://evil/")).toThrow(/valid Registry pack/i);
    expect(() => validateRegistryEntryName("..")).toThrow(/valid Registry pack/i);
  });

  it("rejects uppercase, underscores, leading digit, empty", () => {
    expect(() => validateRegistryEntryName("Foo")).toThrow();
    expect(() => validateRegistryEntryName("a_b")).toThrow();
    expect(() => validateRegistryEntryName("1abc")).toThrow();
    expect(() => validateRegistryEntryName("")).toThrow();
  });
});
