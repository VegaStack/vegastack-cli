import { describe, expect, it } from "vitest";
import { validateImageRef } from "../../src/commands/scan.js";

describe("validateImageRef — argv-injection guard", () => {
  it("accepts well-formed image refs", () => {
    for (const ref of [
      "alpine",
      "alpine:3.19",
      "library/alpine:3.19",
      "ghcr.io/vegastack/cli:0.1.13",
      "registry.example.com:5000/team/app:tag",
      "alpine@sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    ]) {
      expect(() => validateImageRef(ref)).not.toThrow();
    }
  });

  it("rejects refs that begin with `-` (would be treated as a flag by trivy)", () => {
    expect(() => validateImageRef("--config=/etc/passwd")).toThrow(/valid container image/i);
    expect(() => validateImageRef("-rm")).toThrow(/valid container image/i);
  });

  it("rejects refs with whitespace or shell metacharacters", () => {
    expect(() => validateImageRef("alpine; rm -rf /")).toThrow(/valid container image/i);
    expect(() => validateImageRef("alpine && evil")).toThrow(/valid container image/i);
    expect(() => validateImageRef("alpine | nc evil 1")).toThrow(/valid container image/i);
    expect(() => validateImageRef("alpine $(whoami)")).toThrow(/valid container image/i);
  });

  it("rejects empty refs", () => {
    expect(() => validateImageRef("")).toThrow(/valid container image/i);
  });
});
