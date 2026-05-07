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

import * as fs from "node:fs";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { VegaStackError } from "./errors.js";

// Tar entry types the `tar` npm package exposes via ReadEntry.type.
// Anything outside this allowlist is rejected (symlinks, hardlinks,
// character/block devices, fifos, GNU long-name extensions, etc.).
const ALLOWED_TAR_TYPES: ReadonlySet<string> = new Set(["File", "Directory"]);

/**
 * Reject any path that escapes the extraction root. Exported so callers
 * (and tests) can reuse the exact predicate.
 */
export function assertSafeRelativePath(value: string): void {
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
  const normalized = path.posix.normalize(trimmed);
  if (normalized.startsWith("..") || normalized.startsWith("/")) {
    throw new VegaStackError("ArtifactCorrupt", `unsafe archive entry path '${value}'`, {
      context: { path: value },
    });
  }
}

/**
 * Extract a gzipped tar archive, rejecting unsafe paths and non-regular
 * entry types BEFORE any bytes are written to disk.
 */
export function safeExtractTar(archivePath: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });

  // Pass 1: walk every entry header up-front using `tar.list` which
  // exposes the typed entry (`File`, `Directory`, `SymbolicLink`,
  // `Link` (hardlink), `CharacterDevice`, `BlockDevice`, `FIFO`, ...).
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
  // any bytes are written — defense in depth against TOCTOU between
  // listing and extraction.
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

// Bits used to detect symlink entries in zip headers. yauzl exposes
// externalFileAttributes as a 32-bit value where the upper 16 bits
// carry the unix mode when versionMadeBy >> 8 === 3 (unix).
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function entryIsDirectory(entry: Entry): boolean {
  return /\/$/.test(entry.fileName);
}

function entryIsSymlink(entry: Entry): boolean {
  const versionMadeBy = entry.versionMadeBy >>> 8;
  if (versionMadeBy !== 3) return false;
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & S_IFMT) === S_IFLNK;
}

/**
 * Extract a zip archive into `targetDir` using a JS-native parser
 * (yauzl) that validates every central-directory entry BEFORE any
 * bytes are written. Rejects:
 *   * Absolute paths and `..` traversal entries (zip-slip).
 *   * Backslash separators (Windows-style names).
 *   * Symbolic-link entries (via unix mode bits).
 *   * Encrypted entries (general-purpose bit 0).
 */
export function safeExtractZip(archivePath: string, targetDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fs.mkdirSync(targetDir, { recursive: true });
    yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(
          new VegaStackError("ArtifactCorrupt", "failed to open zip archive", {
            cause: err ?? undefined,
          }),
        );
        return;
      }
      const zf = zipfile as ZipFile;
      let settled = false;
      const fail = (e: unknown): void => {
        if (settled) return;
        settled = true;
        try {
          zf.close();
        } catch {
          /* ignore */
        }
        reject(
          e instanceof VegaStackError
            ? e
            : new VegaStackError("ArtifactCorrupt", "failed to extract zip archive", { cause: e }),
        );
      };
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      zf.on("error", fail);
      zf.on("end", done);

      zf.on("entry", (entry: Entry) => {
        try {
          if ((entry.generalPurposeBitFlag & 0x1) === 0x1) {
            throw new VegaStackError(
              "ArtifactCorrupt",
              `zip archive contains encrypted entry '${entry.fileName}'`,
              { context: { path: entry.fileName } },
            );
          }
          if (entryIsSymlink(entry)) {
            throw new VegaStackError(
              "ArtifactCorrupt",
              `zip archive contains symlink entry '${entry.fileName}'`,
              { context: { path: entry.fileName } },
            );
          }
          assertSafeRelativePath(entry.fileName);

          const root = path.resolve(targetDir);
          const dest = path.resolve(root, entry.fileName);
          const rel = path.relative(root, dest);
          if (rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new VegaStackError(
              "ArtifactCorrupt",
              `zip archive entry '${entry.fileName}' escapes target dir`,
              { context: { path: entry.fileName } },
            );
          }

          if (entryIsDirectory(entry)) {
            fs.mkdirSync(dest, { recursive: true });
            zf.readEntry();
            return;
          }

          fs.mkdirSync(path.dirname(dest), { recursive: true });
          zf.openReadStream(entry, (rsErr, readStream) => {
            if (rsErr || !readStream) {
              fail(rsErr ?? new Error("openReadStream returned null"));
              return;
            }
            const out = fs.createWriteStream(dest);
            pipeline(readStream, out)
              .then(() => zf.readEntry())
              .catch(fail);
          });
        } catch (e) {
          fail(e);
        }
      });

      zf.readEntry();
    });
  });
}
