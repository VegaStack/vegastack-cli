// Security tests for npm/safe-tar.js — the wrapper that prevents path
// traversal, zip-slip, absolute-path entries, and bad gzip magic.
//
// We construct hand-crafted tarballs with the system `tar` binary, then
// invoke our safe extractor against them. Each adversarial fixture must be
// rejected; legitimate fixtures must extract cleanly.

import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, "..", "..");
const SAFE_TAR_MJS = path.join(PKG_ROOT, "npm", "safe-tar.js");

let workspace: string;

beforeEach(() => {
  workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-safe-tar-")));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

/** Spawn Node and call safeExtractTarGz on the supplied tarball. Returns combined stdout+stderr and exit code. */
function safeExtract(tarball: string, destDir: string): { ok: boolean; output: string } {
  const code = `
    import("${SAFE_TAR_MJS}").then(({ safeExtractTarGz }) => {
      try {
        const n = safeExtractTarGz(${JSON.stringify(tarball)}, ${JSON.stringify(destDir)});
        process.stdout.write("ENTRIES=" + n);
      } catch (e) {
        process.stdout.write("ERROR=" + (e?.message ?? e));
        process.exit(1);
      }
    });
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
  });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}` };
}

/** Build a normal, safe .tar.gz from a content tree. */
function buildSafeTarball(srcDir: string, tarball: string): void {
  execFileSync("tar", ["czf", tarball, "-C", srcDir, "."]);
}

describe("safe-tar — happy path", () => {
  it("extracts a normal tarball cleanly", () => {
    const src = path.join(workspace, "src");
    const dst = path.join(workspace, "dst");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "a.txt"), "hello");
    fs.mkdirSync(path.join(src, "sub"));
    fs.writeFileSync(path.join(src, "sub", "b.txt"), "world");

    const tarball = path.join(workspace, "ok.tar.gz");
    buildSafeTarball(src, tarball);

    fs.mkdirSync(dst);
    const r = safeExtract(tarball, dst);
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/ENTRIES=/);
    expect(fs.readFileSync(path.join(dst, "a.txt"), "utf8")).toBe("hello");
    expect(fs.readFileSync(path.join(dst, "sub", "b.txt"), "utf8")).toBe("world");
  });
});

describe("safe-tar — rejects malicious tarballs", () => {
  it("rejects a tarball with non-gzip magic bytes", () => {
    const fake = path.join(workspace, "fake.tar.gz");
    // Plain text, not gzipped.
    fs.writeFileSync(fake, "this is not a gzipped tar");
    const r = safeExtract(fake, workspace);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/not a gzip file/);
  });

  it("rejects a tarball with an absolute-path entry (/etc/passwd-style)", () => {
    if (process.platform === "win32") return; // tar can't add absolute Unix paths on Win
    const src = path.join(workspace, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "innocent"), "x");

    // Use `-P` (preserve absolute paths) and craft an entry whose name starts with `/`.
    const tarball = path.join(workspace, "evil.tar.gz");
    // Build a tarball that includes the file with an absolute name.
    const stagedAbs = "/tmp/vegastack-test-evil-payload";
    try {
      fs.writeFileSync(stagedAbs, "haha");
      execFileSync("tar", ["czPf", tarball, stagedAbs], { stdio: "pipe" });
    } finally {
      try {
        fs.unlinkSync(stagedAbs);
      } catch {
        /* ignore */
      }
    }

    const dst = path.join(workspace, "dst");
    fs.mkdirSync(dst);
    const r = safeExtract(tarball, dst);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/(absolute|escape)/i);
  });

  it("rejects a tarball with a `..` traversal entry", () => {
    if (process.platform === "win32") return;
    // Use a precomputed fixture instead of building the tarball at runtime —
    // `tar -C dir ../subdir` behaves differently between BSD tar (preserves
    // `../` in the stored entry name) and GNU tar (normalizes the path before
    // storing). The fixture was built once on macOS and contains a single
    // entry `../escape/x`, which `safeExtract` must reject regardless of the
    // host's tar implementation.
    const fixture = path.join(
      __dirname,
      "..",
      "fixtures",
      "safe-tar",
      "traversal.tar.gz",
    );
    const tarball = path.join(workspace, "trav.tar.gz");
    fs.copyFileSync(fixture, tarball);

    const dst = path.join(workspace, "dst");
    fs.mkdirSync(dst);
    const r = safeExtract(tarball, dst);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/(escape|absolute|\.\.)/i);
  });

  it("rejects a tarball with a symlink pointing outside the dest", () => {
    if (process.platform === "win32") return;
    const src = path.join(workspace, "src");
    fs.mkdirSync(src);
    // Symlink → /etc/passwd
    fs.symlinkSync("/etc/passwd", path.join(src, "leaky"));
    const tarball = path.join(workspace, "symlink.tar.gz");
    execFileSync("tar", ["czf", tarball, "-C", src, "."]);

    const dst = path.join(workspace, "dst");
    fs.mkdirSync(dst);
    const r = safeExtract(tarball, dst);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/(symlink|absolute|escape)/i);
    // Crucially: nothing was extracted.
    expect(fs.existsSync(path.join(dst, "leaky"))).toBe(false);
  });
});
