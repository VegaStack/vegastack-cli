// Integration test: run npm/install.js end-to-end against a stub bundle on disk
// (file:// URL). Verifies download → SHA256 verify → extract pipeline works.

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
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-install-it-"));
  // Build a tiny stub bundle.
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
  // Pad the stub so the tarball clears install.js's MIN_BUNDLE_BYTES (1024)
  // floor. Use random bytes — repeated content gzips to ~nothing.
  fs.writeFileSync(path.join(bundleSrc, "BUNDLE_INFO.txt"), crypto.randomBytes(8192));

  bundleTar = path.join(workspace, "stub-bundle.tar.gz");
  execFileSync("tar", ["czf", bundleTar, "-C", bundleSrc, "."]);

  // Sidecar checksum.
  const sha = crypto.createHash("sha256").update(fs.readFileSync(bundleTar)).digest("hex");
  fs.writeFileSync(`${bundleTar}.sha256`, `${sha}  stub-bundle.tar.gz\n`);
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function runInstall(env: Record<string, string>): { status: number; stderr: string } {
  const r = spawnSync("node", [INSTALL_JS], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, stderr: r.stderr };
}

describe("npm/install.js postinstall", () => {
  it("downloads, verifies, and extracts a stub bundle via file://", () => {
    const targetDir = path.join(workspace, "target");
    const r = runInstall({
      VEGASTACK_BUNDLE_DIR: targetDir,
      VEGASTACK_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("checksum verified");
    expect(fs.existsSync(path.join(targetDir, "MANIFEST.json"))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, ".version"), "utf8").trim()).toMatch(/^\d/);
  });

  it("aborts cleanly on a SHA mismatch (exits 0, never fails npm install, but reports error)", () => {
    // Tamper with the bundle.
    fs.appendFileSync(bundleTar, "extra bytes");
    const targetDir = path.join(workspace, "target");
    const r = runInstall({
      VEGASTACK_BUNDLE_DIR: targetDir,
      VEGASTACK_BUNDLE_URL: `file://${bundleTar}`,
    });
    // install.js never fails npm install — exit 0 always.
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/SHA256 mismatch/);
    expect(fs.existsSync(path.join(targetDir, "MANIFEST.json"))).toBe(false);
  });

  it("VEGASTACK_SKIP_POSTINSTALL=1 short-circuits the download", () => {
    const targetDir = path.join(workspace, "target");
    const r = runInstall({
      VEGASTACK_BUNDLE_DIR: targetDir,
      VEGASTACK_BUNDLE_URL: `file://${bundleTar}`,
      VEGASTACK_SKIP_POSTINSTALL: "1",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/skipping bundle download/);
    expect(fs.existsSync(targetDir)).toBe(false);
  });

  it("skips the download when bundle .version already matches", () => {
    const targetDir = path.join(workspace, "target");
    fs.mkdirSync(targetDir, { recursive: true });
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    fs.writeFileSync(path.join(targetDir, ".version"), pkg.version);
    const r = runInstall({
      VEGASTACK_BUNDLE_DIR: targetDir,
      VEGASTACK_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/already installed/);
  });

  it("rejects non-https URLs", () => {
    const r = runInstall({
      VEGASTACK_BUNDLE_DIR: path.join(workspace, "target"),
      VEGASTACK_BUNDLE_URL: `http://insecure.example.com/bundle.tar.gz`,
    });
    // Still exits 0 (postinstall never fails npm), but the error is logged.
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/non-HTTPS/);
  });

  it("rejects a tarball that's too small (likely an error page)", () => {
    fs.writeFileSync(bundleTar, "404"); // 3 bytes
    const sha = crypto.createHash("sha256").update(fs.readFileSync(bundleTar)).digest("hex");
    fs.writeFileSync(`${bundleTar}.sha256`, `${sha}  stub-bundle.tar.gz\n`);

    const r = runInstall({
      VEGASTACK_BUNDLE_DIR: path.join(workspace, "target"),
      VEGASTACK_BUNDLE_URL: `file://${bundleTar}`,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/suspiciously small/);
  });
});
