#!/usr/bin/env node
// vega — bin entry. Delegates to the compiled CLI in dist/cli.js.
// If dist/ is missing (rare — published package always includes it), runs
// install.js to recover. If the docs bundle is missing, the CLI itself
// surfaces the problem via `vega doctor`.

import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(PKG_ROOT, "dist", "cli.js");

if (!existsSync(CLI_PATH)) {
  process.stderr.write(`vega: missing ${CLI_PATH}.\n`);
  process.stderr.write(
    `vega: this is unexpected for a published package — try \`npm i -g @vegastack/cli@latest\`.\n`,
  );
  process.exit(1);
}

// Use dynamic import so we honor the package's "type": "module".
const url = pathToFileURL(CLI_PATH).href;
import(url).catch((e) => {
  process.stderr.write(`vega: failed to load CLI: ${e?.message ?? e}\n`);
  process.exit(1);
});
