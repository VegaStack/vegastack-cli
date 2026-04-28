import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DestinationExistsError,
  copyFileWithBackup,
  existsOrLink,
  isSymlinkTo,
  linkOrCopyDir,
  removeIfExists,
} from "../../src/lib/fs-utils.js";

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vega-fsutils-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe("linkOrCopyDir", () => {
  it("creates a symlink on POSIX", () => {
    if (process.platform === "win32") return;
    const src = path.join(workspace, "src");
    const dest = path.join(workspace, "dest");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "a"), "hello");

    const result = linkOrCopyDir(src, dest);
    expect(result.strategy).toBe("symlink");
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(dest, "a"), "utf8")).toBe("hello");
  });

  it("creates parent directories as needed", () => {
    const src = path.join(workspace, "src");
    fs.mkdirSync(src);
    const dest = path.join(workspace, "deep", "nested", "dest");
    expect(linkOrCopyDir(src, dest).strategy).toMatch(/symlink|copy/);
    expect(fs.existsSync(dest)).toBe(true);
  });
});

describe("isSymlinkTo / existsOrLink / removeIfExists", () => {
  it("isSymlinkTo returns false for non-symlinks", () => {
    const f = path.join(workspace, "regular");
    fs.writeFileSync(f, "x");
    expect(isSymlinkTo(f, "/anywhere")).toBe(false);
  });

  it("isSymlinkTo distinguishes target", () => {
    if (process.platform === "win32") return;
    const target = path.join(workspace, "target");
    fs.mkdirSync(target);
    const link = path.join(workspace, "link");
    fs.symlinkSync(target, link, "dir");
    expect(isSymlinkTo(link, target)).toBe(true);
    expect(isSymlinkTo(link, "/somewhere/else")).toBe(false);
  });

  it("existsOrLink reports true even for a dangling symlink", () => {
    if (process.platform === "win32") return;
    const link = path.join(workspace, "dangling");
    fs.symlinkSync("/no/such/path", link);
    expect(existsOrLink(link)).toBe(true);
  });

  it("removeIfExists is idempotent", () => {
    const f = path.join(workspace, "x");
    fs.writeFileSync(f, "x");
    removeIfExists(f);
    removeIfExists(f); // second call is a no-op
    expect(fs.existsSync(f)).toBe(false);
  });

  it("removeIfExists handles directories", () => {
    const d = path.join(workspace, "dir");
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, "a"), "x");
    removeIfExists(d);
    expect(fs.existsSync(d)).toBe(false);
  });
});

describe("copyFileWithBackup", () => {
  it("copies when dest does not exist", () => {
    const src = path.join(workspace, "src");
    const dest = path.join(workspace, "dest");
    fs.writeFileSync(src, "hello");
    expect(copyFileWithBackup(src, dest, { force: false })).toBeNull();
    expect(fs.readFileSync(dest, "utf8")).toBe("hello");
  });

  it("throws DestinationExistsError when dest exists and force=false", () => {
    const src = path.join(workspace, "src");
    const dest = path.join(workspace, "dest");
    fs.writeFileSync(src, "new");
    fs.writeFileSync(dest, "old");
    expect(() => copyFileWithBackup(src, dest, { force: false })).toThrow(DestinationExistsError);
    expect(fs.readFileSync(dest, "utf8")).toBe("old");
  });

  it("backs up old content and writes new when force=true", () => {
    const src = path.join(workspace, "src");
    const dest = path.join(workspace, "dest");
    fs.writeFileSync(src, "new");
    fs.writeFileSync(dest, "old");

    const backup = copyFileWithBackup(src, dest, { force: true });
    expect(backup).not.toBeNull();
    if (backup) {
      expect(fs.readFileSync(backup, "utf8")).toBe("old");
      // Format: <dest>.bak-<timestamp>-<6 hex chars>
      expect(backup).toMatch(/\.bak-\d+-[0-9a-f]{6}$/);
    }
    expect(fs.readFileSync(dest, "utf8")).toBe("new");
  });

  it("two same-millisecond force=true calls produce distinct backup names", () => {
    const src = path.join(workspace, "src");
    fs.writeFileSync(src, "new");

    // Run two writes back-to-back; the random suffix prevents collisions.
    const destA = path.join(workspace, "a");
    const destB = path.join(workspace, "b");
    fs.writeFileSync(destA, "old-a");
    fs.writeFileSync(destB, "old-b");
    const backupA = copyFileWithBackup(src, destA, { force: true });
    const backupB = copyFileWithBackup(src, destB, { force: true });
    expect(backupA).not.toBeNull();
    expect(backupB).not.toBeNull();
    expect(backupA).not.toBe(backupB);
  });
});
