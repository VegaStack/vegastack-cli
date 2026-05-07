// Audit code-review/lib-core F-001: env-var-driven path roots must reject
// dangerous chars (control / bidi-override / NUL) and refuse relative paths.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _clearTrustedRootCacheForTests,
  registryCacheRoot,
  toolsCacheRoot,
  vegastackConfigRoot,
} from "../../src/lib/paths.js";

const KEYS = [
  ["VEGASTACK_CONFIG_DIR", vegastackConfigRoot],
  ["VEGASTACK_REGISTRY_DIR", registryCacheRoot],
  ["VEGASTACK_TOOLS_DIR", toolsCacheRoot],
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const [k] of KEYS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  _clearTrustedRootCacheForTests();
});
afterEach(() => {
  for (const [k] of KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _clearTrustedRootCacheForTests();
});

describe("paths env-var validation (F-001)", () => {
  for (const [key, fn] of KEYS) {
    it(`${key} rejects bidi-override (U+202E) characters`, () => {
      process.env[key] = "/tmp/x‮/etc";
      expect(() => fn()).toThrow(/control or bidi-override|ValidationError/i);
    });

    it(`${key} rejects C0 control characters (U+0001)`, () => {
      // Env vars on POSIX cannot carry NUL, but other C0 controls round-trip.
      process.env[key] = "/tmp/x/etc";
      expect(() => fn()).toThrow(/control or bidi-override|ValidationError/i);
    });

    it(`${key} rejects relative paths`, () => {
      process.env[key] = "../escape";
      expect(() => fn()).toThrow(/absolute path/i);
    });

    it(`${key} accepts a clean absolute path`, () => {
      process.env[key] = "/tmp/clean-vegastack-root";
      expect(fn()).toContain("/tmp/clean-vegastack-root");
    });
  }
});
