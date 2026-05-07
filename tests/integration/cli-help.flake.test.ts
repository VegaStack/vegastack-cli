// Regression test for issue #60: cli-help integration suite was flaky under
// the default fork pool because parallel `node dist/cli.js` invocations were
// racing on shared global state (registry cache, ~/.vegastack, etc.). This test
// spawns the CLI N times with isolated HOME dirs and asserts that every child
// exits cleanly. Under the original race, a subset would non-deterministically
// exit with status 1.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");
const CLI = path.join(PKG_ROOT, "dist", "cli.js");

describe("cli-help parallel safety (issue #60)", () => {
  it("`vegastack init --dry-run --json` exits 0 across 20 parallel invocations", () => {
    expect(fs.existsSync(CLI), "build dist/cli.js first").toBe(true);

    const N = 20;
    const children = Array.from({ length: N }).map(() => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-flake-home-"));
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-flake-cwd-"));
      fs.writeFileSync(path.join(cwd, "Dockerfile"), "FROM alpine\n");
      const r = spawnSync("node", [CLI, "init", "--dry-run", "--json"], {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          VEGASTACK_REGISTRY_URL: "http://127.0.0.1:1",
          VEGASTACK_REGISTRY_DEV_TRUST: "1",
          NO_COLOR: "1",
        },
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    });

    const failures = children.map((c, i) => ({ ...c, i })).filter((c) => c.status !== 0);
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[issue-60] ${failures.length}/${N} children failed:`,
        JSON.stringify(failures.slice(0, 3), null, 2),
      );
    }
    expect(failures.length, `${failures.length}/${N} parallel CLI children failed`).toBe(0);
  }, 60_000);
});
