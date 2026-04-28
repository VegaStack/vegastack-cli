// `vega update` — install the latest @vegastack/cli over the current install.
// Wraps `npm i -g @vegastack/cli@latest` so users don't have to remember the
// package name or registry routing (their ~/.npmrc handles it).
//
// `--check` only refreshes the version cache and prints a status line — useful
// for the doctor flow and for CI scripts that want to know without installing.

import { spawnSync } from "node:child_process";
import { log, printError } from "../lib/log.js";
import {
  fetchLatestVersion,
  isNewer,
  readUpdateCache,
  refreshUpdateCache,
} from "../lib/update-check.js";

const PKG_NAME = "@vegastack/cli";

export interface UpdateOpts {
  check: boolean;
  current: string;
}

export async function runUpdate(opts: UpdateOpts): Promise<number> {
  try {
    if (opts.check) {
      const latest = refreshUpdateCache() ?? readUpdateCache()?.latest ?? null;
      if (latest === null) {
        log.warn(
          `could not reach the npm registry to check for updates (current: ${opts.current})`,
        );
        return 0;
      }
      if (isNewer(latest, opts.current)) {
        log.info(`update available: ${opts.current} → ${latest} (run \`vega update\`)`);
      } else {
        log.ok(`up to date (${opts.current})`);
      }
      return 0;
    }

    const latest = fetchLatestVersion();
    if (latest === null) {
      log.warn(`could not query the npm registry; attempting install anyway`);
    } else if (!isNewer(latest, opts.current)) {
      log.ok(`already on latest (${opts.current})`);
      return 0;
    } else {
      log.step(`upgrading ${opts.current} → ${latest}`);
    }

    const args = ["i", "-g", `${PKG_NAME}@latest`];
    log.step(`running: npm ${args.join(" ")}`);
    const r = spawnSync("npm", args, { stdio: "inherit" });
    if (r.error !== undefined) {
      log.warn(`npm failed to launch: ${r.error.message}`);
      return 1;
    }
    if ((r.status ?? 0) !== 0) {
      log.warn(`npm exited ${r.status ?? "?"}; see output above`);
      return r.status ?? 1;
    }

    // Refresh cache so subsequent `vega doctor` reflects the install.
    refreshUpdateCache();
    log.ok(`upgraded — re-run any in-flight command to use the new version`);
    return 0;
  } catch (e) {
    return printError(e);
  }
}
