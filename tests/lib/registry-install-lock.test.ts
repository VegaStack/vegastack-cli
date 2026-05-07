// Reproduces F-006 (rollup #82, code-review/registry):
// `installPublishedRegistryEntry` had no file-locking around the
// rename-into-place block. Two concurrent `vegastack init` runs could both
// reach the rename critical-section and clobber each other.
//
// We test the centralized `acquireRegistryInstallLock` helper that the
// install path uses to serialize concurrent installers per entry.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { acquireRegistryInstallLock } from "../../src/lib/registry-install-lock.js";

describe("acquireRegistryInstallLock", () => {
  it("serializes concurrent calls for the same name", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-lock-"));
    const events: string[] = [];

    const slow = async (label: string): Promise<void> => {
      const release = await acquireRegistryInstallLock(dir, "alpha");
      try {
        events.push(`enter:${label}`);
        await new Promise((r) => setTimeout(r, 30));
        events.push(`exit:${label}`);
      } finally {
        release();
      }
    };

    await Promise.all([slow("A"), slow("B")]);
    // A's enter must be paired with A's exit before B enters (or vice versa).
    const aEnter = events.indexOf("enter:A");
    const aExit = events.indexOf("exit:A");
    const bEnter = events.indexOf("enter:B");
    const bExit = events.indexOf("exit:B");
    const interleaved = (aEnter < bEnter && bEnter < aExit) || (bEnter < aEnter && aEnter < bExit);
    expect(interleaved).toBe(false);
  });

  it("permits independent locks on different names to proceed in parallel", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-lock-"));
    const releaseA = await acquireRegistryInstallLock(dir, "alpha");
    // A different name must NOT be blocked by alpha's lock.
    const releaseB = await acquireRegistryInstallLock(dir, "beta");
    releaseA();
    releaseB();
    expect(true).toBe(true);
  });

  it("treats stale locks (older than threshold) as expired", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-lock-"));
    // Pre-create a lock dir with an old mtime to simulate a stale lock from
    // a crashed sibling process.
    const lockDir = path.join(dir, "alpha.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    const old = new Date(Date.now() - 11 * 60 * 1000); // 11 minutes ago
    fs.utimesSync(lockDir, old, old);

    const release = await acquireRegistryInstallLock(dir, "alpha", {
      staleAfterMs: 10 * 60 * 1000,
      // Quick poll so the test doesn't wait long.
      pollIntervalMs: 5,
      timeoutMs: 1000,
    });
    release();
    expect(true).toBe(true);
  });
});
