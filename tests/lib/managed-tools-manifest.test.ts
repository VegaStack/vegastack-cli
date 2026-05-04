import { describe, expect, it } from "vitest";
import { MANAGED_TOOLS_MANIFEST, managedToolTarget } from "../../src/lib/managed-tools-manifest.js";

describe("managed tools manifest", () => {
  it("has one target for the current platform for every managed tool", () => {
    expect(managedToolTarget("cloudflared")).not.toBeNull();
    expect(managedToolTarget("gitleaks")).not.toBeNull();
    expect(managedToolTarget("ripgrep")).not.toBeNull();
  });

  it("pins every target to a concrete asset checksum", () => {
    for (const [name, tool] of Object.entries(MANAGED_TOOLS_MANIFEST.tools)) {
      expect(tool.version, name).toMatch(/^v?\d/);
      expect(tool.targets.length, name).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const target of tool.targets) {
        const key = `${target.platform}/${target.arch}`;
        expect(seen.has(key), `${name} duplicate ${key}`).toBe(false);
        seen.add(key);
        if (name !== "cloudflared") {
          expect(target.asset, `${name} ${key}`).toContain(tool.version.replace(/^v/, ""));
        }
        expect(target.sha256, `${name} ${key}`).toMatch(/^[a-f0-9]{64}$/);
      }
    }
  });
});
