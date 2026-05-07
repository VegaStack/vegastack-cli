// Centralized archive-extraction with anti-traversal and entry-type defenses.
//
// Both tar and zip extractors must defend against:
//   * Absolute paths (`/etc/passwd`)
//   * Path traversal (`../escape`)
//   * Backslash separators (Windows-style names)
//   * Non-regular entry types (symlinks, hardlinks, device nodes, fifos, ...)
//
// The tar path historically used `tar -tzf` for prelisting which does NOT
// reveal entry types, so a malicious archive could ship a symlink that
// `tar -xzf` would happily create. The zip path historically shelled out to
// `unzip` / PowerShell `Expand-Archive` with no validation at all.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { VegaStackError } from "./errors.js";

/**
 * Reject any path that escapes the extraction root.
 * Exported so callers (and tests) can reuse the exact predicate.
 */
export function assertSafeRelativePath(value: string): void {
  // Strip leading "./" segments and trailing "/" so directory entries
  // like "./" or "foo/" are treated as their content paths.
  let trimmed = value;
  while (trimmed.startsWith("./")) trimmed = trimmed.slice(2);
  if (trimmed.endsWith("/")) trimmed = trimmed.slice(0, -1);
  if (trimmed === "" || trimmed === ".") return;
  if (
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    trimmed.split("/").includes("..")
  ) {
    throw new VegaStackError("ArtifactCorrupt", `unsafe archive entry path '${value}'`, {
      context: { path: value },
    });
  }
  // Belt-and-braces: after normalization the path must not start with '..'.
  const normalized = path.posix.normalize(trimmed);
  if (normalized.startsWith("..") || normalized.startsWith("/")) {
    throw new VegaStackError("ArtifactCorrupt", `unsafe archive entry path '${value}'`, {
      context: { path: value },
    });
  }
}

/**
 * Extract a gzipped tar archive into `targetDir`, rejecting unsafe paths
 * and non-regular entry types BEFORE any bytes are written to disk.
 *
 * NOTE (RED step for #75): the prelisting uses `tar -tzf` which prints
 * names only — it cannot detect symlinks/hardlinks/device entries. A
 * follow-up commit replaces this with verbose listing parsing.
 */
export function safeExtractTar(archivePath: string, targetDir: string): void {
  let listing: string;
  try {
    listing = execFileSync("tar", ["-tzf", archivePath], {
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e) {
    throw new VegaStackError("ArtifactCorrupt", "failed to list tar archive", { cause: e });
  }
  for (const line of listing.split(/\r?\n/)) {
    if (!line) continue;
    assertSafeRelativePath(line);
  }
  try {
    execFileSync("tar", ["-xzf", archivePath, "-C", targetDir], { stdio: "pipe" });
  } catch (e) {
    throw new VegaStackError("ArtifactCorrupt", "failed to extract tar archive", { cause: e });
  }
}

/**
 * Extract a zip archive into `targetDir`, rejecting unsafe paths.
 *
 * NOTE (RED step for #76): this currently shells out to `unzip` /
 * `Expand-Archive` with no entry validation. A follow-up commit
 * replaces it with a JS-native zip extractor that validates every
 * entry header before writing.
 */
export function safeExtractZip(archivePath: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    if (process.platform === "win32") {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(targetDir)} -Force`,
        ],
        { stdio: "pipe" },
      );
      return;
    }
    execFileSync("unzip", ["-q", archivePath, "-d", targetDir], { stdio: "pipe" });
  } catch (e) {
    throw new VegaStackError("ArtifactCorrupt", "failed to extract zip archive", { cause: e });
  }
}
