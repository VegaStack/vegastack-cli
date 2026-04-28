// `vegastack refresh` — pull the latest bundle, even if our recorded version matches.
// Useful when the upstream bundle was updated but the npm package didn't bump.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { VegastackError } from "../lib/errors.js";
import { log, printError } from "../lib/log.js";
import { bundleVersionFile, pkgRoot } from "../lib/paths.js";

export async function runRefresh(): Promise<number> {
  try {
    const verFile = bundleVersionFile();
    if (fs.existsSync(verFile)) {
      log.step(`removing ${verFile} to force re-download`);
      fs.rmSync(verFile);
    }

    const installer = path.join(pkgRoot(), "npm", "install.js");
    if (!fs.existsSync(installer)) {
      throw new VegastackError("BundleCorrupt", `installer script missing at ${installer}`, {
        context: { installer },
      });
    }

    log.step(`running ${installer}`);
    const env = { ...process.env };
    delete env.VEGASTACK_SKIP_POSTINSTALL;
    // Use process.execPath rather than `node` from PATH — defends against a
    // malicious `node` shim earlier on the user's PATH.
    const result = spawnSync(process.execPath, [installer], { stdio: "inherit", env });
    if (result.error !== undefined) {
      throw new VegastackError("Unknown", `refresh failed to launch: ${result.error.message}`, {
        cause: result.error,
      });
    }
    return result.status ?? 0;
  } catch (e) {
    return printError(e);
  }
}
