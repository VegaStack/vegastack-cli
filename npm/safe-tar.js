// Safe wrapper around the system `tar` binary.
//
// Threat model: an attacker-controlled tarball can ship entries that escape
// the extraction directory ("zip-slip"):
//   • absolute paths        ("/etc/passwd")
//   • parent traversal       ("../../escape")
//   • symlinks pointing out  ("link -> /etc/passwd")
//   • hardlinks               ditto
//   • absolute-target links  ("link -> /tmp/x")
//   • device files            (real risk if running as root)
//
// Different `tar` implementations handle these inconsistently. Strategy:
// don't trust the extractor. Run a LIST pass first, validate every entry's
// path & link target, abort on the slightest concern, then run EXTRACT with
// the safest available flags.
//
// New in v0.1: SINGLE-PASS listing via `tar -tvzf`. The legacy code did two
// passes (`tzf` + `tvzf`) and aligned them by index, which is fragile when
// either side emits synthetic entries (PaxHeader, LIBARCHIVE.xattr, mtree
// extended headers). The single-pass parser explicitly skips those synthetic
// entries before alignment is even considered, eliminating the desync risk.
// Closes F16.
//
// Synthetic entries we explicitly skip (per BSD tar / libarchive + GNU tar
// docs — see WebSearch in commit log):
//
//   • `pax_global_header`           — pax extended-header stream
//   • `./PaxHeader/...`             — per-entry pax header (BSD tar form)
//   • `*PaxHeaders.*`               — per-entry pax header (alt form)
//   • `././@LongLink`               — GNU tar long-name placeholder
//   • `././@LongSymLink`            — GNU tar long-symlink placeholder
//   • `LIBARCHIVE.xattr.*`          — libarchive xattr metadata
//   • `SCHILY.xattr.*`              — Schily tar xattr metadata
//   • mtree headers (lines ending with `\\` and starting with `#mtree`)
//
// These never represent real files; they carry metadata for the next entry.

import { spawnSync } from "node:child_process";
import { openSync, closeSync, readSync } from "node:fs";
import * as path from "node:path";

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** Verify a file starts with the gzip magic bytes. */
export function assertGzipMagic(file) {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(4);
    const n = readSync(fd, buf, 0, 4, 0);
    if (n < 2 || buf[0] !== GZIP_MAGIC_0 || buf[1] !== GZIP_MAGIC_1) {
      throw new Error(
        `not a gzip file (magic=${buf.subarray(0, 2).toString("hex")}, expected 1f8b)`,
      );
    }
  } finally {
    closeSync(fd);
  }
}

/** Type characters tar uses in the leading column of `-tvzf` output. */
const VALID_TYPES = new Set(["d", "l", "h", "p", "c", "b", "s", "-"]);

/** Synthetic-entry path patterns to skip. First match wins. */
const SYNTHETIC_PATH_PATTERNS = [
  /^pax_global_header$/i,
  /(^|\/)PaxHeader(\/|$)/,
  /(^|\/)PaxHeaders\.[^/]+(\/|$)/,
  /(^|\/)@LongLink$/,
  /(^|\/)@LongSymLink$/,
  /^LIBARCHIVE\.xattr\./,
  /^SCHILY\.xattr\./,
  /^\.\/\.\.@/, // BSD tar @-prefixed metadata
];

/** Decide whether a tar entry path is a synthetic header. */
export function isSyntheticEntry(entryPath) {
  if (typeof entryPath !== "string" || entryPath.length === 0) return true;
  for (const rx of SYNTHETIC_PATH_PATTERNS) if (rx.test(entryPath)) return true;
  return false;
}

/**
 * List the entries in a .tar.gz without extracting.
 * Returns an array of `{ path, link, type }` records; synthetic entries
 * (Pax / mtree / xattr headers) are filtered out.
 *
 * Single-pass over `tar -tvzf <tarball>`. Each line:
 *
 *   drwxr-xr-x  0 user group        0 Apr 27 12:00 some/dir/
 *   -rw-r--r--  0 user group     1024 Apr 27 12:00 some/file.txt
 *   lrwxrwxrwx  0 user group        0 Apr 27 12:00 link -> target
 *
 * The first character is the entry type. The path is everything between
 * the date/time field and (if present) the literal " -> ". We anchor the
 * "path starts here" position by counting whitespace-separated columns
 * BEFORE the path: bsdtar emits 7 columns, gnutar emits 6 (no group on
 * some configurations). To be robust we walk from the end backwards:
 *   • split off the optional ` -> <target>` link suffix;
 *   • everything to the left contains [type+mode] [user/group] [size]
 *     [date+time] [path].
 */
export function listTarEntries(tarball) {
  const r = spawnSync("tar", ["-tvzf", tarball], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`tar listing failed (status ${r.status}): ${r.stderr}`);
  }

  const entries = [];
  for (const rawLine of r.stdout.split("\n")) {
    const line = rawLine.replace(/[\r]+$/, "");
    if (line.length === 0) continue;
    if (!VALID_TYPES.has(line[0])) continue; // skip "total ..." headers etc.

    const type = line[0];
    let entryPath;
    let link;

    // Split off "<path> -> <target>" if present.
    const linkIdx = line.lastIndexOf(" -> ");
    if (linkIdx > 0) {
      link = line.slice(linkIdx + 4);
      const lhs = line.slice(0, linkIdx);
      entryPath = extractPath(lhs);
    } else {
      entryPath = extractPath(line);
    }

    if (entryPath === undefined) continue;
    if (isSyntheticEntry(entryPath)) continue;

    entries.push({ type, path: entryPath, link });
  }

  return entries;
}

/**
 * Given a `tar -tvzf` line (without the link-target suffix), pull out the
 * path. The path begins immediately after the time field. Both BSD and GNU
 * tar emit a time-like token (HH:MM, YYYY, or "Mon DD YYYY HH:MM"). We find
 * the LAST whitespace-separated token whose previous neighbour is one of
 * those formats; everything after it is the path.
 */
function extractPath(line) {
  // The simple, robust heuristic: find the year-or-time token (matches
  // /\b(?:\d{4}|\d{1,2}:\d{2})\b/) and treat the rest of the line after the
  // FIRST whitespace following that token as the path.
  const rx = /\b(?:\d{4}|\d{1,2}:\d{2})\b/g;
  let last;
  for (let m; (m = rx.exec(line)); ) last = m;
  if (!last) return undefined;
  // Skip the matched token and any following whitespace.
  const after = line.slice(last.index + last[0].length).replace(/^\s+/, "");
  if (after.length === 0) return undefined;
  return after;
}

/**
 * Validate that every tarball entry is safe to extract into `destDir`.
 * Throws on the first unsafe entry. Returns the entry count on success.
 */
export function assertSafeTarEntries(entries, destDir) {
  const destResolved = path.resolve(destDir);

  for (const e of entries) {
    if (typeof e.path !== "string" || e.path === "") {
      throw new Error(`tar entry has empty path`);
    }

    if (path.isAbsolute(e.path)) {
      throw new Error(`tar entry path is absolute: ${e.path}`);
    }

    if (/^[A-Za-z]:[\\/]|^\\\\/.test(e.path)) {
      throw new Error(`tar entry path contains a drive letter or UNC share: ${e.path}`);
    }

    const resolved = path.resolve(destResolved, e.path);
    if (!isWithin(resolved, destResolved)) {
      throw new Error(`tar entry escapes destination: ${e.path} → ${resolved}`);
    }

    if (e.type === "c" || e.type === "b" || e.type === "p" || e.type === "s") {
      throw new Error(`tar entry has refusable type '${e.type}': ${e.path}`);
    }

    if ((e.type === "l" || e.type === "h") && typeof e.link === "string") {
      if (path.isAbsolute(e.link)) {
        throw new Error(
          `tar ${e.type === "l" ? "symlink" : "hardlink"} has absolute target: ${e.path} -> ${e.link}`,
        );
      }
      const linkResolved = path.resolve(path.dirname(resolved), e.link);
      if (!isWithin(linkResolved, destResolved)) {
        throw new Error(
          `tar ${e.type === "l" ? "symlink" : "hardlink"} target escapes destination: ${e.path} -> ${e.link}`,
        );
      }
    }
  }
  return entries.length;
}

/**
 * Extract `tarball` into `destDir`. Performs (in order):
 *   1. gzip magic bytes check
 *   2. tar LIST pass + path/link validation (assertSafeTarEntries)
 *   3. tar EXTRACT with the safest available flags
 *
 * Throws on any policy violation; the destination dir is left empty.
 */
export function safeExtractTarGz(tarball, destDir) {
  assertGzipMagic(tarball);

  const entries = listTarEntries(tarball);
  if (entries.length === 0) {
    throw new Error("tar listing produced zero entries (unexpectedly empty bundle?)");
  }
  assertSafeTarEntries(entries, destDir);

  // We've already path-validated. Pass only flags both GNU tar and BSD tar
  // (macOS, FreeBSD) accept. BSD tar doesn't recognize --no-overwrite-dir or
  // --no-same-permissions, so we don't include them.
  const args = ["xzf", tarball, "-C", destDir, "--no-same-owner"];

  const result = spawnSync("tar", args, { encoding: "utf8" });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        "tar binary not found on PATH. On Windows, ensure Win10 1809+ (which ships tar.exe) or install bsdtar via git-bash.",
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`tar extract failed (status ${result.status}): ${result.stderr}`);
  }

  return entries.length;
}

function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
