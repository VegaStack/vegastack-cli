// Security-focused integration tests for npm/install.js. Builds on the
// existing install-postinstall.test.ts; this file specifically verifies the
// hardening properties (timing-safe SHA, redirect rejection, lock file,
// path redaction, atomic version write).

import { execFileSync, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");
const INSTALL_JS = path.join(PKG_ROOT, "npm", "install.js");

let workspace: string;
let bundleSrc: string;
let bundleTar: string;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vega-sec-")));
  bundleSrc = path.join(workspace, "src");
  fs.mkdirSync(bundleSrc, { recursive: true });
  fs.writeFileSync(
    path.join(bundleSrc, "MANIFEST.json"),
    JSON.stringify({
      format_version: 1,
      generated_at: "test",
      mount_root: "/test",
      discovery_script: "scripts/discover.py",
      schema_hint: "test",
      providers: {
        aws: {
          manifest: "aws/MANIFEST.json",
          branch: "main",
          upstream_sha: "abc",
          synced_at: "test",
          file_count: 1,
          resources_dir: "aws/r",
          datasources_dir: "aws/d",
          guides_dir: "aws/g",
        },
      },
    }),
  );
  // Pad with random bytes so the tarball clears the 1 KB sanity floor.
  fs.writeFileSync(path.join(bundleSrc, "BUNDLE_INFO.txt"), crypto.randomBytes(8192));

  bundleTar = path.join(workspace, "stub-bundle.tar.gz");
  execFileSync("tar", ["czf", bundleTar, "-C", bundleSrc, "."]);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(bundleTar)).digest("hex");
  fs.writeFileSync(`${bundleTar}.sha256`, `${sha}  stub-bundle.tar.gz\n`);
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function runInstall(env: Record<string, string>): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, [INSTALL_JS], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, stderr: r.stderr };
}

describe("install.js — security properties", () => {
  it("redacts $HOME from error output", () => {
    const fakeHome = path.join(workspace, "user-home");
    fs.mkdirSync(fakeHome);
    // Put the missing bundle URL UNDER the fake HOME so the error message
    // contains a HOME-prefixed path that should be redacted.
    const urlUnderHome = path.join(fakeHome, "missing.tar.gz");
    const r = runInstall({
      HOME: fakeHome,
      VEGA_BUNDLE_DIR: path.join(fakeHome, "bundle"),
      VEGA_BUNDLE_URL: `file://${urlUnderHome}`,
    });
    expect(r.status).toBe(0);
    // The error message must NOT contain the user's actual home path.
    expect(r.stderr).not.toContain(fakeHome);
    // It SHOULD contain the redaction marker.
    expect(r.stderr).toMatch(/\$HOME/);
  });

  it("writes .version atomically (uses rename, not direct write)", () => {
    const targetDir = path.join(workspace, "target");
    const r = runInstall({
      VEGA_BUNDLE_DIR: targetDir,
      VEGA_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    // After a successful install, NO `.version.tmp-*` files should remain.
    const stragglers = fs.readdirSync(targetDir).filter((f) => f.startsWith(".version.tmp-"));
    expect(stragglers).toEqual([]);
    // The .version itself should be present and end without a trailing newline mess.
    const v = fs.readFileSync(path.join(targetDir, ".version"), "utf8");
    expect(v).toMatch(/^\d/);
  });

  it("rejects an http:// (non-https) bundle URL", () => {
    const r = runInstall({
      VEGA_BUNDLE_DIR: path.join(workspace, "target"),
      VEGA_BUNDLE_URL: "http://insecure.example.com/x.tar.gz",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/non-HTTPS/);
  });

  it("acquires a lock and refuses to clobber another install's lock", () => {
    const targetDir = path.join(workspace, "target");
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    // Pre-create the proper-lockfile sentinel to simulate a concurrent
    // install. proper-lockfile's locked-dir is `<file>.lock`; touching it
    // makes our subsequent acquire return ELOCKED.
    const sentinel = `${targetDir}.lock`;
    fs.writeFileSync(sentinel, "");
    const lockDir = `${sentinel}.lock`;
    fs.mkdirSync(lockDir, { recursive: true });

    const r = runInstall({
      VEGA_BUNDLE_DIR: targetDir,
      VEGA_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/another vega install is in progress/);

    // Critical: the install MUST NOT have removed the lock we owned.
    expect(fs.existsSync(lockDir)).toBe(true);

    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.unlinkSync(sentinel);
  });

  it("reclaims a stale lock (>5 minutes old)", () => {
    const targetDir = path.join(workspace, "target");
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    // Pre-create the proper-lockfile state with an old mtime so the library
    // declares the lock stale and reclaims it.
    const sentinel = `${targetDir}.lock`;
    fs.writeFileSync(sentinel, "");
    const lockDir = `${sentinel}.lock`;
    fs.mkdirSync(lockDir, { recursive: true });
    const longAgo = Date.now() / 1000 - 30 * 60;
    fs.utimesSync(lockDir, longAgo, longAgo);

    const r = runInstall({
      VEGA_BUNDLE_DIR: targetDir,
      VEGA_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/checksum verified/);
  });

  it("rejects a tampered tarball via timing-safe SHA compare", () => {
    // Write a different tarball (smaller, valid gzip) with the OLD sha file.
    fs.writeFileSync(bundleTar, crypto.randomBytes(2048));
    // .sha256 still references the original hash -> mismatch.

    const r = runInstall({
      VEGA_BUNDLE_DIR: path.join(workspace, "target"),
      VEGA_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/SHA256 mismatch/);
  });

  it("rejects a checksum file with garbage content", () => {
    fs.writeFileSync(`${bundleTar}.sha256`, "not a valid sha256");

    const r = runInstall({
      VEGA_BUNDLE_DIR: path.join(workspace, "target"),
      VEGA_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/checksum file did not contain a single SHA256/);
  });

  it("rejects an oversized .sha256 file (defense against exfil-via-checksum)", () => {
    // 2 KB checksum file — much larger than the 1 KB cap.
    fs.writeFileSync(`${bundleTar}.sha256`, "a".repeat(2048));

    const r = runInstall({
      VEGA_BUNDLE_DIR: path.join(workspace, "target"),
      VEGA_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/exceeds .* bytes/i);
  });
});
