import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBundleStatus, requireBundle } from "../../src/lib/bundle.js";
import { VegaError } from "../../src/lib/errors.js";

let workspace: string;
let originalEnv: string | undefined;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vega-bundle-test-"));
  originalEnv = process.env.VEGA_BUNDLE_DIR;
  process.env.VEGA_BUNDLE_DIR = workspace;
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  if (originalEnv !== undefined) process.env.VEGA_BUNDLE_DIR = originalEnv;
  else delete process.env.VEGA_BUNDLE_DIR;
});

const VALID_ROOT = {
  format_version: 1,
  generated_at: "270426 17:50:07 IST",
  mount_root: "/mnt/tf-providers",
  discovery_script: "scripts/discover.py",
  schema_hint: "...",
  providers: {
    aws: {
      manifest: "aws/MANIFEST.json",
      branch: "main",
      upstream_sha: "abc123",
      synced_at: "270426",
      file_count: 100,
      resources_dir: "aws/r",
      datasources_dir: "aws/d",
      guides_dir: "aws/guides",
    },
    "1password": {
      manifest: "1password/MANIFEST.json",
      branch: "main",
      upstream_sha: "def456",
      synced_at: "270426",
      file_count: 4,
      resources_dir: "1password/resources",
      datasources_dir: "1password/data-sources",
      // No guides_dir — must be optional
    },
  },
};

function writeBundle(rootContent: unknown, options?: { providerSchema?: number }): void {
  fs.writeFileSync(path.join(workspace, "MANIFEST.json"), JSON.stringify(rootContent));
  fs.writeFileSync(path.join(workspace, ".version"), "0.1.0");

  if (options?.providerSchema !== undefined) {
    const aws = path.join(workspace, "aws");
    fs.mkdirSync(aws, { recursive: true });
    fs.writeFileSync(
      path.join(aws, "MANIFEST.json"),
      JSON.stringify({ schema_version: options.providerSchema }),
    );
  }
}

describe("readBundleStatus", () => {
  it("reports not-installed when bundle dir missing", () => {
    fs.rmSync(workspace, { recursive: true, force: true });
    const status = readBundleStatus();
    expect(status.installed).toBe(false);
    expect(status.path).toBe(workspace);
  });

  it("reports the version even when MANIFEST is missing", () => {
    fs.writeFileSync(path.join(workspace, ".version"), "0.1.0");
    const status = readBundleStatus();
    expect(status.installed).toBe(false);
    expect(status.version).toBe("0.1.0");
    expect(status.error).toContain("MANIFEST.json missing");
  });

  it("reports installed=true for a valid bundle", () => {
    writeBundle(VALID_ROOT, { providerSchema: 4 });
    const status = readBundleStatus();
    expect(status.installed).toBe(true);
    expect(status.providerCount).toBe(2);
    expect(status.schemaVersion).toBe(4);
    expect(status.version).toBe("0.1.0");
    expect(status.generatedAt).toBe("270426 17:50:07 IST");
  });

  it("captures invalid JSON without throwing", () => {
    fs.writeFileSync(path.join(workspace, "MANIFEST.json"), "{ not json");
    const status = readBundleStatus();
    expect(status.installed).toBe(false);
    expect(status.error).toContain("MANIFEST.json invalid");
  });

  it("captures a structurally invalid manifest without throwing", () => {
    writeBundle({ ...VALID_ROOT, format_version: 99 });
    const status = readBundleStatus();
    expect(status.installed).toBe(false);
    expect(status.error).toContain("99");
  });
});

describe("requireBundle", () => {
  it("throws BundleMissing when bundle dir missing", () => {
    fs.rmSync(workspace, { recursive: true, force: true });
    expect(() => requireBundle()).toThrow(VegaError);
    try {
      requireBundle();
    } catch (e) {
      expect((e as VegaError).kind).toBe("BundleMissing");
    }
  });

  it("throws BundleCorrupt when MANIFEST.json is missing", () => {
    expect(() => requireBundle()).toThrow(/MANIFEST.json missing/);
  });

  it("throws BundleCorrupt for non-JSON content", () => {
    fs.writeFileSync(path.join(workspace, "MANIFEST.json"), "garbage");
    try {
      requireBundle();
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as VegaError).kind).toBe("BundleCorrupt");
    }
  });

  it("throws BundleVersionMismatch for unsupported format_version", () => {
    writeBundle({ ...VALID_ROOT, format_version: 99 });
    try {
      requireBundle();
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as VegaError).kind).toBe("BundleVersionMismatch");
    }
  });

  it("rejects providers entry that's not an object", () => {
    writeBundle({ ...VALID_ROOT, providers: [] });
    expect(() => requireBundle()).toThrow(/providers/);
  });

  it("rejects empty providers map", () => {
    writeBundle({ ...VALID_ROOT, providers: {} });
    expect(() => requireBundle()).toThrow(/zero providers/);
  });

  it("accepts a valid bundle and exposes parsed providers", () => {
    writeBundle(VALID_ROOT, { providerSchema: 4 });
    const { manifest } = requireBundle();
    expect(Object.keys(manifest.providers)).toEqual(expect.arrayContaining(["aws", "1password"]));
    expect(manifest.providers.aws?.file_count).toBe(100);
    // 1password has no guides_dir — must be undefined, not throw
    expect(manifest.providers["1password"]?.guides_dir).toBeUndefined();
  });

  it("rejects when a required provider field is missing", () => {
    const broken = JSON.parse(JSON.stringify(VALID_ROOT)) as typeof VALID_ROOT;
    delete (broken.providers.aws as { branch?: string }).branch;
    writeBundle(broken);
    expect(() => requireBundle()).toThrow(/branch/);
  });

  it("rejects optional field with wrong type", () => {
    const broken = JSON.parse(JSON.stringify(VALID_ROOT)) as {
      providers: Record<string, Record<string, unknown>>;
    };
    const aws = broken.providers.aws;
    if (!aws) throw new Error("VALID_ROOT.providers.aws went missing");
    aws.guides_dir = 42;
    writeBundle(broken);
    expect(() => requireBundle()).toThrow(/guides_dir.*string/);
  });
});
