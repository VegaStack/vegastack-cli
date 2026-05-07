#!/usr/bin/env node
// vegastack -- bin entry. Delegates to the compiled CLI in dist/cli.js.
// If dist/ is missing (rare -- published package always includes it),
// prints a recovery hint and exits 1. If Registry data is missing, the
// CLI itself surfaces the problem via `vegastack doctor`.

import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(PKG_ROOT, "dist", "cli.js");

if (!existsSync(CLI_PATH)) {
  process.stderr.write(`vegastack: missing ${CLI_PATH}.\n`);
  process.stderr.write(
    `vegastack: this is unexpected for a published package -- try \`npm i -g @vegastack/cli@latest\`.\n`,
  );
  process.exit(1);
}

// Use dynamic import so we honor the package's "type": "module".
const url = pathToFileURL(CLI_PATH).href;
import(url).catch((e) => {
  process.stderr.write(`vegastack: failed to load CLI: ${e?.message ?? e}\n`);
  // If the CLI threw a structured error with an `exitCode`, preserve it
  // so callers see the documented exit code instead of a hard 1.
  const code = typeof e?.exitCode === "number" ? e.exitCode : 1;
  process.exit(code);
});
