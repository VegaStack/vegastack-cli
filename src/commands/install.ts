// `vegastack install` — explicitly run the bundle download. The npm postinstall
// runs the same install.js, but users may want to retry after a failure or
// install offline via VEGASTACK_BUNDLE_URL.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { VegastackError } from "../lib/errors.js";
import { log, printError } from "../lib/log.js";
import { bundleVersionFile, pkgRoot } from "../lib/paths.js";

export interface InstallOptions {
  force: boolean;
}

export async function runInstall(opts: InstallOptions): Promise<number> {
  try {
    const installer = path.join(pkgRoot(), "npm", "install.js");
    if (!fs.existsSync(installer)) {
      throw new VegastackError("BundleCorrupt", `installer script missing at ${installer}`, {
        context: { installer },
      });
    }

    if (opts.force) {
      // install.js skips when .version matches; remove it to force a re-download.
      const verFile = bundleVersionFile();
      if (fs.existsSync(verFile)) fs.rmSync(verFile);
    }

    log.step(`running ${installer}`);
    const env = { ...process.env };
    delete env.VEGASTACK_SKIP_POSTINSTALL;
    // Use process.execPath rather than `node` from PATH — defends against a
    // malicious `node` shim earlier on the user's PATH.
    const result = spawnSync(process.execPath, [installer], { stdio: "inherit", env });
    if (result.error !== undefined) {
      throw new VegastackError("Unknown", `install failed to launch: ${result.error.message}`, {
        cause: result.error,
      });
    }
    return result.status ?? 0;
  } catch (e) {
    return printError(e);
  }
}
