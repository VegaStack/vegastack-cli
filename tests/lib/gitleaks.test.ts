// Smoke coverage for src/lib/gitleaks.ts.
//
// Goal: lift gitleaks.ts off 0% by exercising the pure helpers
// (resolveGitleaksBin, readGitleaksMetadata, gitleaksVersion). We do not
// drive the network/extraction pipeline (installGitleaks); that is covered
// indirectly by the managed-tools smoke and by the `setup` integration suite.

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  gitleaksVersion,
  readGitleaksMetadata,
  resolveGitleaksBin,
} from "../../src/lib/gitleaks.js";
import { withTmpDir } from "../setup.js";

const ENV_KEYS = [
  "VEGASTACK_REGISTRY_DIR",
  "VEGASTACK_GITLEAKS_BIN",
  "VEGASTACK_ALLOW_SYSTEM_TOOLS",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("gitleaks helpers (smoke)", () => {
  it("readGitleaksMetadata returns null when file is missing", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_REGISTRY_DIR = dir;
      expect(readGitleaksMetadata()).toBeNull();
    });
  });

  it("readGitleaksMetadata returns null when JSON is malformed", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_REGISTRY_DIR = dir;
      // Write a malformed metadata file so the JSON.parse path throws.
      const { gitleaksMetadataPath } = await import("../../src/lib/paths.js");
      const p = gitleaksMetadataPath();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "{not json");
      expect(readGitleaksMetadata()).toBeNull();
    });
  });

  it("resolveGitleaksBin honors VEGASTACK_GITLEAKS_BIN override when file exists", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_REGISTRY_DIR = dir;
      const fake = path.join(dir, "gitleaks-bin");
      fs.writeFileSync(fake, "#!/bin/sh\necho 1.0\n", { mode: 0o755 });
      process.env.VEGASTACK_GITLEAKS_BIN = fake;
      expect(resolveGitleaksBin()).toBe(fake);
    });
  });

  it("resolveGitleaksBin returns null when nothing is installed and system fallback is opted out", async () => {
    await withTmpDir(async (dir) => {
      process.env.VEGASTACK_REGISTRY_DIR = dir;
      delete process.env.VEGASTACK_GITLEAKS_BIN;
      delete process.env.VEGASTACK_ALLOW_SYSTEM_TOOLS;
      expect(resolveGitleaksBin()).toBeNull();
    });
  });

  it("gitleaksVersion returns null on a non-runnable binary", async () => {
    await withTmpDir(async (dir) => {
      // Pointing at a non-existent path makes spawnSync return non-zero.
      const ghost = path.join(dir, "no-such-binary");
      expect(gitleaksVersion(ghost)).toBeNull();
    });
  });
});
