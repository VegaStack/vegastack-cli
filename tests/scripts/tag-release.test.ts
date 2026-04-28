import { describe, it, expect } from "vitest";
// @ts-expect-error — JS module without .d.ts; OK for test consumption.
import { pinBundleIntoPackage } from "../../scripts/tag-release.js";

describe("tag-release: pinBundleIntoPackage", () => {
  const baseManifest = {
    manifest_schema_version: 1,
    channels: {
      latest: {
        bundle_version: "2026.04.28",
        bundle_sha256:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      },
      stable: {
        bundle_version: "2026.04.20",
        bundle_sha256:
          "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      },
    },
  };

  it("pins to the requested channel and returns true on change", () => {
    const pkg: Record<string, string> = {
      expectedBundleVersion: "0.0.0",
      expectedBundleSha: "sha256-PENDING-FIRST-RELEASE",
    };
    const changed = pinBundleIntoPackage(pkg, baseManifest, "latest");
    expect(changed).toBe(true);
    expect(pkg.expectedBundleVersion).toBe("2026.04.28");
    expect(pkg.expectedBundleSha).toBe(
      "sha256-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    );
  });

  it("supports the 'stable' channel selection", () => {
    const pkg: Record<string, string> = {
      expectedBundleVersion: "x",
      expectedBundleSha: "y",
    };
    pinBundleIntoPackage(pkg, baseManifest, "stable");
    expect(pkg.expectedBundleVersion).toBe("2026.04.20");
    expect(pkg.expectedBundleSha).toMatch(/^sha256-fedcba/);
  });

  it("returns false when nothing changed (idempotent re-runs)", () => {
    const pkg: Record<string, string> = {
      expectedBundleVersion: "2026.04.28",
      expectedBundleSha:
        "sha256-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    };
    expect(pinBundleIntoPackage(pkg, baseManifest, "latest")).toBe(false);
  });

  it("preserves an already 'sha256-' prefixed value rather than double-prefixing", () => {
    const manifest = {
      channels: {
        latest: {
          bundle_version: "2026.04.28",
          bundle_sha256:
            "sha256-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        },
      },
    };
    const pkg: Record<string, string> = {
      expectedBundleVersion: "0.0.0",
      expectedBundleSha: "old",
    };
    pinBundleIntoPackage(pkg, manifest, "latest");
    const sha = pkg.expectedBundleSha ?? "";
    expect(sha.startsWith("sha256-sha256-")).toBe(false);
    expect(sha.startsWith("sha256-")).toBe(true);
  });

  it("tolerates a flat manifest shape (no channels wrapper)", () => {
    const flat = {
      bundle_version: "2026.04.28",
      bundle_sha256:
        "1111111111111111111111111111111111111111111111111111111111111111",
    };
    const pkg: Record<string, string> = {
      expectedBundleVersion: "0.0.0",
      expectedBundleSha: "old",
    };
    expect(pinBundleIntoPackage(pkg, flat, "latest")).toBe(true);
    expect(pkg.expectedBundleVersion).toBe("2026.04.28");
  });

  it("returns false (and does not mutate) when the channel is missing", () => {
    const pkg: Record<string, string> = {
      expectedBundleVersion: "0.0.0",
      expectedBundleSha: "old",
    };
    const changed = pinBundleIntoPackage(pkg, baseManifest, "nightly");
    expect(changed).toBe(false);
    expect(pkg.expectedBundleVersion).toBe("0.0.0");
  });

  it("returns false when the channel entry is missing required fields", () => {
    const partial = {
      channels: { latest: { bundle_version: "2026.04.28" } }, // no sha
    };
    const pkg: Record<string, string> = {
      expectedBundleVersion: "0.0.0",
      expectedBundleSha: "old",
    };
    expect(pinBundleIntoPackage(pkg, partial, "latest")).toBe(false);
  });
});
