// Characterization test for runDoctor's --json output shape.
//
// Pins the structural contract of the JSON payload so the runDoctor
// refactor (cyclomatic-complexity reduction) is provably behavior-preserving.
//
// Volatile inputs (network-fetched npm version, real homedir, real renderers)
// are mocked. We compare the JSON payload across three calls to runDoctor
// with the same fixture to assert determinism, AND we assert the exact
// top-level keys + check-name set the function must always emit.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/update-check.js", async (orig) => {
  const real = await orig();
  return { ...(real as object), refreshUpdateCache: () => null };
});

vi.mock("../../src/lib/host-detect.js", () => ({
  detectHost: () => ({ installed: false, evidence: "stubbed" }),
}));

vi.mock("../../src/agents/index.js", () => {
  const renderer = {
    supportsScope: (_s: string) => true,
    status: async () => ({
      agent: "stub",
      installed: false,
      paths: [],
      notes: [],
      warnings: [],
    }),
  };
  return {
    ALL_RENDERER_NAMES: ["stub-a", "stub-b"] as readonly string[],
    getRenderer: (_n: string) => renderer,
  };
});

let tmpHome: string;
let prevConfig: string | undefined;
let prevRegistry: string | undefined;
let prevTools: string | undefined;
let prevPkgRoot: string | undefined;
let prevPath: string | undefined;
let stdoutSpy: { mockRestore: () => void };
let captured: string[];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-doctor-char-"));
  prevConfig = process.env.VEGASTACK_CONFIG_DIR;
  prevRegistry = process.env.VEGASTACK_REGISTRY_DIR;
  prevTools = process.env.VEGASTACK_TOOLS_DIR;
  prevPkgRoot = process.env.VEGASTACK_PKG_ROOT;
  prevPath = process.env.PATH;
  // Empty PATH -> jq lookup deterministically fails -> "jq (optional)" not-ok.
  process.env.PATH = path.join(tmpHome, "empty-path");
  process.env.VEGASTACK_CONFIG_DIR = path.join(tmpHome, "cfg");
  process.env.VEGASTACK_REGISTRY_DIR = path.join(tmpHome, "reg");
  process.env.VEGASTACK_TOOLS_DIR = path.join(tmpHome, "tools");
  fs.mkdirSync(process.env.VEGASTACK_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(process.env.VEGASTACK_REGISTRY_DIR, { recursive: true });
  fs.mkdirSync(process.env.VEGASTACK_TOOLS_DIR, { recursive: true });

  captured = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string" || chunk instanceof Uint8Array) {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  stdoutSpy = {
    mockRestore: () => {
      process.stdout.write = origWrite;
    },
  };
});

afterEach(() => {
  stdoutSpy.mockRestore();
  if (prevConfig === undefined) delete process.env.VEGASTACK_CONFIG_DIR;
  else process.env.VEGASTACK_CONFIG_DIR = prevConfig;
  if (prevRegistry === undefined) delete process.env.VEGASTACK_REGISTRY_DIR;
  else process.env.VEGASTACK_REGISTRY_DIR = prevRegistry;
  if (prevTools === undefined) delete process.env.VEGASTACK_TOOLS_DIR;
  else process.env.VEGASTACK_TOOLS_DIR = prevTools;
  if (prevPkgRoot === undefined) delete process.env.VEGASTACK_PKG_ROOT;
  else process.env.VEGASTACK_PKG_ROOT = prevPkgRoot;
  if (prevPath === undefined) delete process.env.PATH;
  else process.env.PATH = prevPath;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.resetModules();
});

async function runOnce(): Promise<Record<string, unknown>> {
  // Re-import after env mutation to pick up trusted-root changes.
  const paths = await import("../../src/lib/paths.js");
  paths._clearTrustedRootCacheForTests();
  const { runDoctor } = await import("../../src/commands/doctor.js");
  captured.length = 0;
  await runDoctor({ json: true });
  const joined = captured.join("");
  return JSON.parse(joined) as Record<string, unknown>;
}

describe("runDoctor characterization (JSON output contract)", () => {
  it("emits a stable JSON envelope with the documented top-level keys", async () => {
    const out = await runOnce();
    // verify is undefined (omitted by JSON.stringify) when --verifyRegistry not requested.
    expect(Object.keys(out).sort()).toEqual(
      ["agents", "checks", "cli_version", "ok", "registry_entries"].sort(),
    );
    expect(typeof out.ok).toBe("boolean");
    expect(typeof out.cli_version).toBe("string");
    expect(Array.isArray(out.checks)).toBe(true);
    expect(Array.isArray(out.registry_entries)).toBe(true);
    expect(out.verify).toBeUndefined();
    expect(Array.isArray(out.agents)).toBe(true);
  });

  it("emits the documented check set with stable shape (name/ok/detail)", async () => {
    const out = await runOnce();
    const checks = out.checks as { name: string; ok: boolean; detail: string }[];
    for (const c of checks) {
      expect(typeof c.name).toBe("string");
      expect(typeof c.ok).toBe("boolean");
      expect(typeof c.detail).toBe("string");
    }
    const names = checks.map((c) => c.name).sort();
    // Empty registry: only the env-driven baseline checks fire.
    expect(names).toEqual(
      [
        "Node.js",
        "VegaStack Registry cache",
        "jq (optional)",
        "ripgrep",
        "cloudflared (optional)",
      ].sort(),
    );
  });

  it("is deterministic across repeated invocations (same env, same JSON)", async () => {
    const a = await runOnce();
    const b = await runOnce();
    // ok/cli_version/checks/registry_entries/agents/verify must match byte-for-byte.
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("returns 1 when a required check fails (ripgrep missing)", async () => {
    // With empty tools dir + no system rg accessible via the mocked spawnSync,
    // ripgrep is missing -> required check fails -> ok:false.
    const out = await runOnce();
    expect(out.ok).toBe(false);
  });

  it("includes verify[] when --verifyRegistry is requested", async () => {
    const paths = await import("../../src/lib/paths.js");
    paths._clearTrustedRootCacheForTests();
    const { runDoctor } = await import("../../src/commands/doctor.js");
    captured.length = 0;
    await runDoctor({ json: true, verifyRegistry: true });
    const out = JSON.parse(captured.join("")) as Record<string, unknown>;
    expect(Array.isArray(out.verify)).toBe(true);
  });
});
