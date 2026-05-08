#!/usr/bin/env node
// Keep auxiliary version-stamped files in sync with package.json.
//
// Files synced:
//   - skills/vegastack/templates/gemini-extension.json (top-level "version").
//
// Wired from package.json:scripts.version-sync as
//   "version-sync": "changeset version && node scripts/sync-version.mjs"
// so every `npm run version-sync` propagates the new version.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const targetVersion = pkg.version;

const candidates = [join(repoRoot, "skills", "vegastack", "templates", "gemini-extension.json")];

let synced = 0;
for (const file of candidates) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const json = JSON.parse(text);
  if (json.version === targetVersion) {
    process.stdout.write(`sync-version: ${file} already at ${targetVersion}\n`);
    continue;
  }
  json.version = targetVersion;
  // Preserve trailing newline if the original file had one.
  const trailing = text.endsWith("\n") ? "\n" : "";
  writeFileSync(file, JSON.stringify(json, null, 2) + trailing);
  process.stdout.write(`sync-version: ${file} -> ${targetVersion}\n`);
  synced += 1;
}

if (synced === 0) {
  process.stdout.write("sync-version: no files needed updating\n");
}
