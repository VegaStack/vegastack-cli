import { describe, expect, it } from "vitest";
import { EXIT_CODES, VegaStackError, asVegaStackError } from "../../src/lib/errors.js";

describe("VegaStackError", () => {
  it("maps every kind to a unique exit code", () => {
    const codes = Object.values(EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("Unknown is the catch-all for plain errors", () => {
    const e = asVegaStackError(new Error("boom"));
    expect(e).toBeInstanceOf(VegaStackError);
    expect(e.kind).toBe("Unknown");
    expect(e.exitCode).toBe(EXIT_CODES.Unknown);
    expect(e.message).toBe("boom");
  });

  it("preserves an existing VegaStackError unchanged", () => {
    const original = new VegaStackError("RegistryEntryMissing", "x");
    expect(asVegaStackError(original)).toBe(original);
  });

  it("wraps a string throw", () => {
    const e = asVegaStackError("oops");
    expect(e.kind).toBe("Unknown");
    expect(e.message).toBe("oops");
  });

  it("toJSON has a stable shape", () => {
    const e = new VegaStackError("RegistryEntryMissing", "missing", {
      context: { dir: "/x" },
    });
    const json = e.toJSON();
    expect(json).toMatchObject({
      kind: "RegistryEntryMissing",
      message: "missing",
      exitCode: EXIT_CODES.RegistryEntryMissing,
      context: { dir: "/x" },
    });
    expect(typeof json.hint).toBe("string");
    expect(json.hint.length).toBeGreaterThan(10);
  });

  it("includes cause chain", () => {
    const root = new Error("root cause");
    const e = new VegaStackError("DiscoverError", "wrapped", { cause: root });
    expect(e.toJSON().cause).toBe("root cause");
  });

  it("RegistryVersionMismatch hint mentions both expected and actual", () => {
    const e = new VegaStackError("RegistryVersionMismatch", "x", {
      context: { expected: 4, actual: 5 },
    });
    expect(e.hint()).toMatch(/expected.*4/);
    expect(e.hint()).toMatch(/got.*5/);
  });

  it.each([
    ["RegistryEntryMissing", "vegastack init"],
    ["NetworkError", "network"],
    ["ChecksumMismatch", "SHA256"],
    ["PythonMissing", "python3"],
    ["AgentInstallError", "--force"],
    ["ValidationError", "validated"],
  ] as const)("hint for %s mentions %s", (kind, mustInclude) => {
    const e = new VegaStackError(kind, "x");
    expect(e.hint()).toContain(mustInclude);
  });
});
