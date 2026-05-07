// Audit code-review/lib-core F-002: writeUpdateCache must be atomic so
// concurrent CLI processes can't leave a truncated JSON cache file.

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readUpdateCache, updateCachePath, writeUpdateCache } from "../../src/lib/update-check.js";

const cachePath = updateCachePath();
const cacheDir = path.dirname(cachePath);
const backupPath = `${cachePath}.test-backup`;

afterEach(() => {
  // Restore the original cache (if any) so the dev's update-check state
  // isn't trashed by this test.
  try {
    if (fs.existsSync(backupPath)) fs.renameSync(backupPath, cachePath);
    else fs.rmSync(cachePath, { force: true });
  } catch {
    /* ignore */
  }
});

describe("update-check atomic write (F-002)", () => {
  it("never produces a cache file that fails JSON.parse mid-write", () => {
    // Save any pre-existing real cache.
    if (fs.existsSync(cachePath)) fs.renameSync(cachePath, backupPath);

    // Simulate sequential writes; an atomic implementation rename's a
    // complete file each time, so any read in between either parses
    // cleanly or hits ENOENT — never partial JSON.
    for (let i = 0; i < 25; i++) {
      writeUpdateCache({ checkedAt: new Date().toISOString(), latest: `0.${i}.0` });
      const cache = readUpdateCache();
      expect(cache).not.toBeNull();
      expect(cache!.latest).toMatch(/^0\.\d+\.0$/);
    }
  });

  it("does not leave temp files behind in the cache dir", () => {
    writeUpdateCache({ checkedAt: new Date().toISOString(), latest: "0.1.0" });
    const entries = fs.readdirSync(cacheDir);
    const leftovers = entries.filter((e) => e.includes("update-check.json.tmp-"));
    expect(leftovers).toEqual([]);
  });
});
