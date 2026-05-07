// Smoke coverage for `vegastack registry list/status`. Network is allowed
// to fail silently (the implementation falls back to the static PACKS list).

import { describe, expect, it } from "vitest";
import {
  runRegistryList,
  runRegistryStatus,
} from "../../src/commands/registry.js";
import { withTmpDir } from "../setup.js";

describe("vegastack registry (smoke)", () => {
  it("runRegistryList --json returns 0", async () => {
    await withTmpDir(async (dir) => {
      const prevCwd = process.cwd();
      const prevReg = process.env.VEGASTACK_REGISTRY_DIR;
      process.env.VEGASTACK_REGISTRY_DIR = dir;
      // Force the network probe to a closed port so the catch-fallback fires.
      const prevUrl = process.env.VEGASTACK_REGISTRY_URL;
      process.env.VEGASTACK_REGISTRY_URL = "http://127.0.0.1:1";
      process.chdir(dir);
      try {
        const code = await runRegistryList({ json: true });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
        if (prevReg === undefined) delete process.env.VEGASTACK_REGISTRY_DIR;
        else process.env.VEGASTACK_REGISTRY_DIR = prevReg;
        if (prevUrl === undefined) delete process.env.VEGASTACK_REGISTRY_URL;
        else process.env.VEGASTACK_REGISTRY_URL = prevUrl;
      }
    });
  });

  it("runRegistryStatus delegates to list and returns 0", async () => {
    await withTmpDir(async (dir) => {
      const prevCwd = process.cwd();
      const prevReg = process.env.VEGASTACK_REGISTRY_DIR;
      const prevUrl = process.env.VEGASTACK_REGISTRY_URL;
      process.env.VEGASTACK_REGISTRY_DIR = dir;
      process.env.VEGASTACK_REGISTRY_URL = "http://127.0.0.1:1";
      process.chdir(dir);
      try {
        const code = await runRegistryStatus({ json: true });
        expect(code).toBe(0);
      } finally {
        process.chdir(prevCwd);
        if (prevReg === undefined) delete process.env.VEGASTACK_REGISTRY_DIR;
        else process.env.VEGASTACK_REGISTRY_DIR = prevReg;
        if (prevUrl === undefined) delete process.env.VEGASTACK_REGISTRY_URL;
        else process.env.VEGASTACK_REGISTRY_URL = prevUrl;
      }
    });
  });
});
