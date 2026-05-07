// Filesystem helpers for cross-platform installation.
//
// Symlinks on Windows: `fs.symlinkSync` requires SeCreateSymbolicLinkPrivilege,
// which non-admin users don't have unless Developer Mode is enabled (Win10
// 1703+). When it's unavailable we fall back to a recursive copy, which is
// slower to refresh on `npm i -g @vegastack/cli@latest` but is the right
// tradeoff for a "things should just work" install experience.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type LinkStrategy = "symlink" | "copy";

export interface LinkResult {
  strategy: LinkStrategy;
  /** When strategy === "copy", whether the destination existed and was replaced. */
  replaced: boolean;
}

/**
 * Create `dest` so that it points at `src`. Tries a symlink first, falls back
 * to a recursive copy on Windows-without-symlink-perms (EPERM) or filesystems
 * that don't support symlinks (ENOTSUP / EACCES on some FAT/exFAT mounts).
 *
 * Caller is responsible for ensuring `dest` doesn't exist (use `removeIfExists`
 * first, or guard with `--force` semantics).
 */
export function linkOrCopyDir(src: string, dest: string): LinkResult {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  try {
    fs.symlinkSync(src, dest, "dir");
    return { strategy: "symlink", replaced: false };
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    // EPERM: Win10 non-admin, no Dev Mode.
    // ENOTSUP / EACCES: filesystems that don't support symlinks (FAT/exFAT,
    //   some bind-mounts, restricted containers).
    // EEXIST: caller didn't clean up — surface that as-is.
    if (code === "EEXIST") throw e;
    if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EACCES") throw e;

    fs.cpSync(src, dest, { recursive: true, dereference: false, errorOnExist: false, force: true });
    return { strategy: "copy", replaced: false };
  }
}

/**
 * Detect whether `dest` is a symlink that points at `expected`. Returns false
 * if `dest` is not a symlink, or points elsewhere, or doesn't exist.
 */
export function isSymlinkTo(dest: string, expected: string): boolean {
  try {
    if (!fs.lstatSync(dest).isSymbolicLink()) return false;
    return fs.readlinkSync(dest) === expected;
  } catch {
    return false;
  }
}

/** True iff `dest` exists OR is a dangling symlink.
 *
 * We deliberately distinguish ENOENT (the file isn't there) from every other
 * error (permission denied, I/O failure, etc). For permission errors, we
 * surface them: the caller is about to try to write here, and silently
 * pretending it doesn't exist would lead to a worse error downstream.
 */
export function existsOrLink(dest: string): boolean {
  try {
    fs.lstatSync(dest);
    return true;
  } catch (e) {
    const code = (e as Error & { code?: string }).code;
    if (code === "ENOENT") return false;
    throw e;
  }
}

/**
 * Remove `dest` whether it's a regular file, directory, or symlink.
 * Idempotent: returns silently if `dest` doesn't exist.
 */
export function removeIfExists(dest: string): void {
  if (!existsOrLink(dest)) return;
  fs.rmSync(dest, { recursive: true, force: true });
}

/**
 * Copy `src` to `dest`, optionally preserving any pre-existing destination
 * by renaming it to `<dest>.bak-<timestamp>-<random>`. Returns the backup
 * path if one was created, or null otherwise.
 *
 * The random suffix prevents collisions when two installers (or a tight loop
 * across multiple files) run within the same millisecond — `Date.now()` alone
 * is not enough on fast hardware.
 */
export function copyFileWithBackup(
  src: string,
  dest: string,
  options: { force: boolean },
): string | null {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    if (!options.force) {
      // Caller decides what to do; we signal "exists" via a typed error.
      throw new DestinationExistsError(dest);
    }
    const backup = `${dest}.bak-${backupSuffix()}`;
    fs.renameSync(dest, backup);
    fs.copyFileSync(src, dest);
    return backup;
  }
  fs.copyFileSync(src, dest);
  return null;
}

/**
 * Write a file atomically via temp + rename.
 *
 * `fs.writeFileSync(target, ...)` opens the destination with O_TRUNC and
 * then streams the bytes; a SIGINT, OOM, or power-loss between truncation
 * and write completion leaves a partial/corrupt file at the canonical path.
 * This helper writes to `${target}.tmp-${pid}-${rand}` first and then
 * `fs.renameSync` into place, which is atomic on POSIX and on NTFS for
 * same-volume renames. On rename failure the temp is removed and the
 * canonical path is left untouched.
 */
export function atomicWriteFileSync(target: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** Suffix used for backup files: timestamp + 6 random hex chars. */
function backupSuffix(): string {
  return `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

export class DestinationExistsError extends Error {
  readonly destPath: string;
  constructor(destPath: string) {
    super(`destination exists: ${destPath}`);
    this.name = "DestinationExistsError";
    this.destPath = destPath;
  }
}
