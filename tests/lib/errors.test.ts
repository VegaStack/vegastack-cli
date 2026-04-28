import { describe, expect, it } from "vitest";
import { EXIT_CODES, VegaError, asVegaError } from "../../src/lib/errors.js";

describe("VegaError", () => {
  it("maps every kind to a unique exit code", () => {
    const codes = Object.values(EXIT_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("Unknown is the catch-all for plain errors", () => {
    const e = asVegaError(new Error("boom"));
    expect(e).toBeInstanceOf(VegaError);
    expect(e.kind).toBe("Unknown");
    expect(e.exitCode).toBe(EXIT_CODES.Unknown);
    expect(e.message).toBe("boom");
  });

  it("preserves an existing VegaError unchanged", () => {
    const original = new VegaError("BundleMissing", "x");
    expect(asVegaError(original)).toBe(original);
  });

  it("wraps a string throw", () => {
    const e = asVegaError("oops");
    expect(e.kind).toBe("Unknown");
    expect(e.message).toBe("oops");
  });

  it("toJSON has a stable shape", () => {
    const e = new VegaError("BundleMissing", "missing", {
      context: { dir: "/x" },
    });
    const json = e.toJSON();
    expect(json).toMatchObject({
      kind: "BundleMissing",
      message: "missing",
      exitCode: EXIT_CODES.BundleMissing,
      context: { dir: "/x" },
    });
    expect(typeof json.hint).toBe("string");
    expect(json.hint.length).toBeGreaterThan(10);
  });

  it("includes cause chain", () => {
    const root = new Error("root cause");
    const e = new VegaError("DiscoverError", "wrapped", { cause: root });
    expect(e.toJSON().cause).toBe("root cause");
  });

  it("BundleVersionMismatch hint mentions both expected and actual", () => {
    const e = new VegaError("BundleVersionMismatch", "x", {
      context: { expected: 4, actual: 5 },
    });
    expect(e.hint()).toMatch(/expected.*4/);
    expect(e.hint()).toMatch(/got.*5/);
  });

  it.each([
    ["BundleMissing", "vega install"],
    ["NetworkError", "HTTPS_PROXY"],
    ["ChecksumMismatch", "SHA256"],
    ["PythonMissing", "python3"],
    ["AgentInstallError", "--force"],
    ["ValidationError", "validated"],
  ] as const)("hint for %s mentions %s", (kind, mustInclude) => {
    const e = new VegaError(kind, "x");
    expect(e.hint()).toContain(mustInclude);
  });
});
