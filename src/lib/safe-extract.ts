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
import * as tar from "tar";
import { VegaStackError } from "./errors.js";

// Tar entry types the `tar` npm package exposes via ReadEntry.type.
// Anything outside this allowlist is rejected (symlinks, hardlinks,
// character/block devices, fifos, GNU long-name extensions, etc.).
const ALLOWED_TAR_TYPES: ReadonlySet<string> = new Set(["File", "Directory"]);

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
  fs.mkdirSync(targetDir, { recursive: true });

  // Pass 1: walk every entry header up-front using `tar.list`, which
  // exposes the typed entry (`File`, `Directory`, `SymbolicLink`,
  // `Link` (hardlink), `CharacterDevice`, `BlockDevice`, `FIFO`, ...).
  // Any non-regular entry or unsafe path is rejected before extraction.
  try {
    tar.list({
      file: archivePath,
      sync: true,
      onentry: (entry) => {
        const type = String(entry.type);
        if (!ALLOWED_TAR_TYPES.has(type)) {
          throw new VegaStackError(
            "ArtifactCorrupt",
            `tar archive contains disallowed ${describeTarType(type)} entry '${entry.path}'`,
            { context: { path: String(entry.path), type } },
          );
        }
        assertSafeRelativePath(String(entry.path));
        const linkpath = (entry as unknown as { linkpath?: string }).linkpath;
        if (linkpath) {
          // Belt-and-braces: tar headers may carry a linkpath even for
          // entries we just typed as File; reject any non-empty value.
          throw new VegaStackError(
            "ArtifactCorrupt",
            `tar archive entry '${entry.path}' carries link target '${linkpath}'`,
            { context: { path: String(entry.path), linkpath } },
          );
        }
      },
    });
  } catch (e) {
    if (e instanceof VegaStackError) throw e;
    throw new VegaStackError("ArtifactCorrupt", "failed to list tar archive", { cause: e });
  }

  // Pass 2: extract. `filter` re-validates each entry header just before
  // any bytes are written — defense in depth against TOCTOU between the
  // listing pass and the extraction pass on the same on-disk archive.
  try {
    tar.extract({
      file: archivePath,
      cwd: targetDir,
      sync: true,
      preserveOwner: false,
      strict: true,
      filter: (entryPath, stat) => {
        const type = String((stat as unknown as { type?: string }).type ?? "");
        if (type && !ALLOWED_TAR_TYPES.has(type)) return false;
        try {
          assertSafeRelativePath(entryPath);
        } catch {
          return false;
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof VegaStackError) throw e;
    throw new VegaStackError("ArtifactCorrupt", "failed to extract tar archive", { cause: e });
  }
}

function describeTarType(type: string): string {
  switch (type) {
    case "SymbolicLink":
      return "symlink";
    case "Link":
      return "hardlink";
    case "CharacterDevice":
    case "BlockDevice":
      return "device";
    case "FIFO":
      return "fifo";
    default:
      return `non-regular (${type || "unknown"})`;
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
