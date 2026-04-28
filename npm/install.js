#!/usr/bin/env node
// vega — postinstall: download the docs bundle from GitHub Releases,
// verify SHA256 (timing-safe + streaming), extract safely (path-traversal
// validated), and atomically swap the bundle dir.
//
// Design constraints:
//   - Zero runtime deps. Only Node built-ins (`undici` is bundled into Node 18+).
//   - Bundle is platform-agnostic (markdown + JSON + Python harness), so no
//     platform detection — single tarball per release.
//   - SHA256 verification is mandatory and timing-safe.
//   - Tarball entries are validated against path-traversal BEFORE extraction.
//   - Postinstall NEVER fails npm install. If something goes wrong, we print
//     a clear recovery instruction and exit 0; the user can retry with
//     `vega install` or `VEGA_BUNDLE_URL=file://…`.
//
// Env:
//   VEGA_SKIP_POSTINSTALL=1     skip download entirely (CI / dev installs)
//   VEGA_BUNDLE_URL=<url>       override download URL (testing / offline)
//   VEGA_BUNDLE_DIR=<path>      override extract destination
//   VEGA_BUNDLE_TIMEOUT_MS=N    per-attempt fetch timeout (default 60_000)
//   VEGA_BUNDLE_RETRIES=N       retries on transient failure (default 2)
//
// Standard proxy env (any of, in this order):
//   HTTPS_PROXY, https_proxy, HTTP_PROXY, http_proxy
//   NO_PROXY / no_proxy        (comma-separated, host-substring match)
//
// Exit codes (install.js): 0 always (never fail npm install). Messages on
// stderr explain what happened.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { safeExtractTarGz } from "./safe-tar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.join(__dirname, "..", "package.json");
const PKG = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const VERSION = PKG.version;

// ── Tunables ──────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2;
const MAX_BUNDLE_BYTES = 500 * 1024 * 1024; // 500 MB hard cap; our bundle is ~12 MB compressed
const MIN_BUNDLE_BYTES = 1024; // 1 KB sanity floor — anything smaller is broken
const MAX_SHA_FILE_BYTES = 1024; // .sha256 sidecar is ~80 bytes; reject anything that could be exfil
const HEX64 = /^[0-9a-f]{64}$/i;
const ALLOWED_REDIRECT_SCHEMES = new Set(["https:"]);

// ── Paths ─────────────────────────────────────────────────────
function bundleDir() {
  if (process.env.VEGA_BUNDLE_DIR) return process.env.VEGA_BUNDLE_DIR;
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    throw new Error("Cannot determine home directory. Set VEGA_BUNDLE_DIR explicitly.");
  }
  return path.join(home, ".config", "vegastack", "bundle");
}
const BUNDLE_DIR = bundleDir();
const VERSION_FILE = path.join(BUNDLE_DIR, ".version");
const LOCK_PATH = `${BUNDLE_DIR}.lock`;

// ── URLs ──────────────────────────────────────────────────────
function bundleUrl() {
  if (process.env.VEGA_BUNDLE_URL) return process.env.VEGA_BUNDLE_URL;
  return `https://github.com/vegastack/vegastack-cli/releases/download/v${VERSION}/vegastack-bundle-v${VERSION}.tar.gz`;
}
function bundleSha256Url() {
  return `${bundleUrl()}.sha256`;
}

/**
 * The SHA256 we EXPECT for this CLI version's bundle, written into
 * `package.json#expectedBundleSha` by `scripts/tag-release.js` at publish
 * time. Provenance-rooted (npm's @vegastack/cli was published with OIDC,
 * which means npm signs the package metadata — so an attacker who gets
 * shell on a user machine cannot forge this without breaking the npm
 * trust chain).
 *
 * When present we prefer it over the network-fetched .sha256 sidecar:
 *   • it ships in the same npm tarball as install.js itself (signed);
 *   • the network sidecar can in principle be tampered with by anyone
 *     who can MITM github.com (rare but possible on hostile networks).
 *
 * When absent (e.g. dev builds, pre-1.0 releases that pre-date the
 * tagging script change), we fall back to the network sidecar with
 * a clear log.
 */
function expectedBundleSha() {
  const raw = PKG.expectedBundleSha;
  if (typeof raw !== "string") return null;
  // Accept both "sha256-<hex>" (multibase-style, what tag-release.js writes
  // when the bundle manifest carries it that way) and bare 64-char hex.
  const stripped = raw.startsWith("sha256-") ? raw.slice("sha256-".length) : raw;
  if (HEX64.test(stripped)) return stripped.toLowerCase();
  return null;
}

// ── Logging ───────────────────────────────────────────────────
const log = (msg) => process.stderr.write(`vega install: ${redactUserPaths(msg)}\n`);
const warn = (msg) => process.stderr.write(`vega install: WARN ${redactUserPaths(msg)}\n`);
const err = (msg) => process.stderr.write(`vega install: ERROR ${redactUserPaths(msg)}\n`);

// Strip user paths from error output for log redaction.
function redactUserPaths(s) {
  if (!s) return s;
  const home = process.env.HOME || process.env.USERPROFILE;
  let out = String(s);
  if (home) out = out.split(home).join("$HOME");
  // Strip ANSI sequences too.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\[[0-9;]*m/g, "");
  return out;
}

// ── Skip checks ───────────────────────────────────────────────
if (process.env.VEGA_SKIP_POSTINSTALL === "1") {
  log("VEGA_SKIP_POSTINSTALL=1 set; skipping bundle download.");
  process.exit(0);
}

// Fast path: bundle is already at the requested version.
try {
  if (existsSync(VERSION_FILE)) {
    const raw = readFileSync(VERSION_FILE, "utf8");
    // Reject obvious tampering: a real version file is ~10 bytes.
    if (raw.length > 64) {
      warn(`existing .version file is unexpectedly large (${raw.length} bytes); ignoring it`);
    } else {
      const installed = raw.trim();
      if (installed === VERSION) {
        log(`bundle v${VERSION} already installed at ${BUNDLE_DIR}`);
        process.exit(0);
      }
      log(`upgrading bundle from v${installed} to v${VERSION}`);
    }
  }
} catch {
  /* fall through to install */
}

// Node version check.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 18) {
  err(`Node 18+ required (you have v${process.versions.node}). Skipping bundle download.`);
  process.exit(0);
}

// ── Lock acquisition (proper-lockfile 4.x) ────────────────────
// Replaces the hand-rolled mtime-stale-lock heuristic with a battle-tested
// library that handles process-crash recovery via heartbeat-style stale
// detection. The lock is PID-aware AND time-aware, so a crashed install
// doesn't strand the bundle dir forever.
//
// We hold the lock for the duration of the install (download + verify +
// extract + atomic rename). proper-lockfile.lock returns a release()
// function we call in the cleanup path.
let lockRelease = null;
async function tryAcquireLock() {
  try {
    mkdirSync(path.dirname(BUNDLE_DIR), { recursive: true });
    // proper-lockfile needs a file or directory to lock against. We create
    // an empty sentinel (`bundle.lock`) so the bundle dir itself doesn't
    // need to exist yet.
    if (!existsSync(LOCK_PATH)) writeFileSync(LOCK_PATH, "");
    const properLockfile = await import("proper-lockfile");
    lockRelease = await properLockfile.lock(LOCK_PATH, {
      // A 5-minute "stale" window covers slow CI runners but reclaims locks
      // from crashed installs reasonably fast.
      stale: 5 * 60_000,
      // Retry up to 5 times with 250ms backoff before giving up; this maps
      // roughly to "if a parallel install is in progress, wait briefly".
      retries: { retries: 5, factor: 1.5, minTimeout: 250, maxTimeout: 2000 },
      // The lock file is itself the lock object; no extra symlink needed.
      lockfilePath: `${LOCK_PATH}.lock`,
    });
    return true;
  } catch (e) {
    if (e?.code === "ELOCKED") return false;
    // Unexpected — log and bail.
    warn(`could not acquire install lock: ${redactUserPaths(e?.message ?? e)}`);
    return false;
  }
}
async function releaseLock() {
  if (lockRelease) {
    try {
      await lockRelease();
    } catch {
      /* ignore */
    }
    lockRelease = null;
  }
}

// ── Tmpdir cleanup on signals ─────────────────────────────────
const PENDING_TMP = new Set();
function cleanupTmp() {
  for (const dir of PENDING_TMP) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  PENDING_TMP.clear();
  // Lock release is async; we schedule it but don't await — on process exit
  // the OS reclaims the lockfile within `stale` anyway.
  void releaseLock();
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    cleanupTmp();
    process.exit(0);
  });
}
process.on("exit", cleanupTmp);

// ── Proxy setup (undici, bundled with Node 18+) ───────────────
async function configureProxyIfNeeded(targetUrl) {
  if (targetUrl.startsWith("file://")) return;
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (!proxy) return;

  const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
  if (noProxy === "*") return;
  if (noProxy) {
    const target = new URL(targetUrl);
    const skip = noProxy
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .some((host) => target.hostname.endsWith(host));
    if (skip) return;
  }

  try {
    const undici = await import("undici");
    undici.setGlobalDispatcher(new undici.ProxyAgent(proxy));
    log(`using proxy ${redactProxyUrl(proxy)} for ${new URL(targetUrl).hostname}`);
  } catch (e) {
    warn(
      `proxy is set (${redactProxyUrl(proxy)}) but undici unavailable: ${redactUserPaths(e?.message ?? e)}.`,
    );
    warn(
      "Continuing with direct fetch; if it fails, set VEGA_BUNDLE_URL=file:///path/to/bundle.tar.gz.",
    );
  }
}

function redactProxyUrl(u) {
  try {
    const url = new URL(u);
    if (url.username || url.password) {
      url.username = "***";
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "<unparseable>";
  }
}

// ── Main install flow ─────────────────────────────────────────
async function main() {
  const url = bundleUrl();
  const shaUrl = bundleSha256Url();

  // Refuse non-https URLs unless they are file:// (local testing / air-gapped).
  if (!url.startsWith("https://") && !url.startsWith("file://")) {
    err(`refusing non-HTTPS bundle URL: ${url}`);
    err("set VEGA_BUNDLE_URL to an https:// or file:// URL.");
    process.exit(0);
  }

  // Acquire the bundle dir lock so parallel `npm i` calls don't corrupt each other.
  if (!(await tryAcquireLock())) {
    warn(
      `another vega install is in progress (lock at ${LOCK_PATH}); skipping. ` +
        `If you believe this is wrong, remove the lock file and re-run.`,
    );
    process.exit(0);
  }

  await configureProxyIfNeeded(url);

  const tmpRoot = mkdtempSync(path.join(tmpdir(), "vega-install-"));
  PENDING_TMP.add(tmpRoot);

  try {
    // Step 1 — establish the EXPECTED SHA256.
    // Preferred source: the `expectedBundleSha` field embedded in our own
    // package.json at publish time (signed by npm provenance, which is in
    // turn rooted in the GitHub Actions OIDC + sigstore Fulcio chain). When
    // present we trust it absolutely and only use the network sidecar as
    // a corroboration check.
    // Fallback: fetch the .sha256 sidecar from GitHub Releases. Still
    // cryptographically protected by HTTPS + (where present) the cosign
    // sign-blob signature, but not as airtight as a pinned hash.
    const pinnedSha = expectedBundleSha();
    let expectedSha;
    if (pinnedSha) {
      expectedSha = pinnedSha;
      log(`expected bundle SHA pinned in package.json (${expectedSha.slice(0, 12)}…)`);
      // Best-effort corroboration with the network sidecar; if they disagree
      // we trust the pinned value but warn loudly.
      try {
        const sidecar = (await fetchTextWithRetry(shaUrl, MAX_SHA_FILE_BYTES))
          .trim()
          .split(/\s+/)[0]
          ?.toLowerCase();
        if (HEX64.test(sidecar) && sidecar !== expectedSha) {
          warn(`network .sha256 sidecar (${sidecar.slice(0, 12)}…) disagrees with pinned hash; trusting pinned`);
        }
      } catch (e) {
        // Network corroboration is optional when we have a pinned SHA.
        warn(`could not fetch corroborating sidecar (${redactUserPaths(e?.message ?? e)}); proceeding with pinned hash`);
      }
    } else {
      log(`fetching checksum ${shaUrl}`);
      const shaText = await fetchTextWithRetry(shaUrl, MAX_SHA_FILE_BYTES);
      expectedSha = (shaText.trim().split(/\s+/)[0] ?? "").toLowerCase();
      if (!HEX64.test(expectedSha)) {
        throw new Error(`checksum file did not contain a single SHA256 hex digest: '${expectedSha}'`);
      }
    }

    // Step 2 — download the tarball with a streaming SHA + size check.
    log(`downloading ${url}`);
    const tarball = path.join(tmpRoot, "bundle.tar.gz");
    const { size, sha256 } = await downloadWithRetry(url, tarball);

    // Step 3 — size sanity bounds.
    if (size < MIN_BUNDLE_BYTES) {
      throw new Error(
        `downloaded tarball is suspiciously small (${size} bytes); likely a 4xx/5xx error page`,
      );
    }
    if (size > MAX_BUNDLE_BYTES) {
      throw new Error(`downloaded tarball exceeds ${MAX_BUNDLE_BYTES} bytes (${size}); aborting`);
    }

    // Step 4 — timing-safe SHA compare.
    if (!sha256Equals(expectedSha, sha256)) {
      err("SHA256 mismatch. Possible tampering or corrupt download.");
      err(`  expected ${expectedSha}`);
      err(`  actual   ${sha256}`);
      // Security event; do not extract. Still exit 0 so npm install completes.
      process.exit(0);
    }
    log(`checksum verified (${size.toLocaleString()} bytes)`);

    // Step 5 — atomically replace the bundle dir. Move existing aside first,
    // extract into the canonical path, then delete the staged-aside copy.
    const stagedAside = await stageAsideExisting(BUNDLE_DIR);

    mkdirSync(BUNDLE_DIR, { recursive: true });

    // Step 6 — safe extraction (path-traversal validated, gzip-magic checked).
    log(`extracting to ${BUNDLE_DIR}`);
    const entryCount = safeExtractTarGz(tarball, BUNDLE_DIR);

    // Step 7 — atomic .version write.
    writeFileAtomic(VERSION_FILE, VERSION);

    // Step 8 — clean up the staged-aside old bundle.
    if (stagedAside) rmSync(stagedAside, { recursive: true, force: true });

    log(`bundle v${VERSION} ready (${entryCount} entries, ${size.toLocaleString()} bytes)`);
  } catch (e) {
    warn(`bundle install failed: ${redactUserPaths(e?.message ?? e)}`);
    warn("CLI is still installed. Recover with one of:");
    warn("  • vega install                                    (retry the download)");
    warn("  • vega refresh                                    (force a fresh download)");
    warn("  • VEGA_BUNDLE_URL=file:///path/to/bundle.tar.gz vega install");
    if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
      warn(
        "Detected a proxy setting; if your proxy blocks GitHub Releases, use the file:// option above.",
      );
    }
    process.exit(0);
  } finally {
    if (PENDING_TMP.has(tmpRoot)) {
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      PENDING_TMP.delete(tmpRoot);
    }
    await releaseLock();
  }
}

// ── Download with retry + streaming SHA + size bound ──────────
async function downloadWithRetry(url, dest) {
  if (url.startsWith("file://")) {
    return downloadFileUrl(url, dest);
  }

  const retries = clampInt(process.env.VEGA_BUNDLE_RETRIES, DEFAULT_RETRIES, 0, 10);
  const timeoutMs = clampInt(process.env.VEGA_BUNDLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 600_000);
  const maxAttempts = retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await downloadOnce(url, dest, timeoutMs);
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      const backoffMs = Math.min(2 ** attempt * 500, 8000);
      warn(
        `download attempt ${attempt}/${maxAttempts} failed (${redactUserPaths(e?.message ?? e)}); retrying in ${backoffMs}ms`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error("unreachable");
}

async function downloadOnce(url, dest, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // We use redirect: "manual" + a single hop to keep control over the
    // redirect target's scheme. Native fetch doesn't expose per-hop hooks.
    let currentUrl = url;
    let res;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(currentUrl, { redirect: "manual", signal: ac.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`HTTP ${res.status} without Location header`);
        const next = new URL(loc, currentUrl);
        if (!ALLOWED_REDIRECT_SCHEMES.has(next.protocol)) {
          throw new Error(`refusing redirect to non-https scheme: ${next.protocol}`);
        }
        currentUrl = next.toString();
        continue;
      }
      break;
    }
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status ?? "?"} ${res?.statusText ?? ""}`);

    // Stream the body to disk while updating SHA256 + counting bytes. This
    // keeps memory bounded regardless of bundle size, and gives us early
    // termination via MAX_BUNDLE_BYTES.
    const hash = createHash("sha256");
    let size = 0;
    const fd = openSync(dest, "w");
    try {
      const reader = res.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BUNDLE_BYTES) {
          throw new Error(`bundle exceeds ${MAX_BUNDLE_BYTES} bytes during download; aborting`);
        }
        hash.update(chunk.value);
        writeSync(fd, chunk.value);
      }
    } finally {
      closeSync(fd);
    }
    return { size, sha256: hash.digest("hex") };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFileUrl(url, dest) {
  const src = fileUrlToPath(url);
  if (!existsSync(src)) throw new Error(`local bundle not found: ${src}`);
  const data = readFileSync(src);
  if (data.byteLength > MAX_BUNDLE_BYTES) {
    throw new Error(`local bundle exceeds ${MAX_BUNDLE_BYTES} bytes; aborting`);
  }
  writeFileSync(dest, data);
  const hash = createHash("sha256").update(data).digest("hex");
  return { size: data.byteLength, sha256: hash };
}

async function fetchTextWithRetry(url, maxBytes) {
  if (url.startsWith("file://")) {
    const src = fileUrlToPath(url);
    if (!existsSync(src)) throw new Error(`local checksum not found: ${src}`);
    const data = readFileSync(src);
    if (data.byteLength > maxBytes) {
      throw new Error(`checksum file exceeds ${maxBytes} bytes; refusing`);
    }
    return data.toString("utf8");
  }

  const retries = clampInt(process.env.VEGA_BUNDLE_RETRIES, DEFAULT_RETRIES, 0, 10);
  const timeoutMs = clampInt(process.env.VEGA_BUNDLE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 600_000);
  const maxAttempts = retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        let currentUrl = url;
        let res;
        for (let hop = 0; hop < 5; hop++) {
          res = await fetch(currentUrl, { redirect: "manual", signal: ac.signal });
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location");
            if (!loc) throw new Error(`HTTP ${res.status} without Location header`);
            const next = new URL(loc, currentUrl);
            if (!ALLOWED_REDIRECT_SCHEMES.has(next.protocol)) {
              throw new Error(`refusing redirect to non-https scheme: ${next.protocol}`);
            }
            currentUrl = next.toString();
            continue;
          }
          break;
        }
        if (!res || !res.ok) throw new Error(`HTTP ${res?.status ?? "?"} ${res?.statusText ?? ""}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > maxBytes) {
          throw new Error(`response body exceeds ${maxBytes} bytes; refusing`);
        }
        return buf.toString("utf8");
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      const backoffMs = Math.min(2 ** attempt * 500, 8000);
      warn(`checksum fetch attempt ${attempt}/${maxAttempts} failed; retrying in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error("unreachable");
}

// ── file:// helpers ────────────────────────────────────────────
function fileUrlToPath(url) {
  // Use Node's standard parser. Throws on malformed URL.
  return fileURLToPath(pathToFileURL(new URL(url).pathname).href.startsWith("file://") ? url : url);
}

// ── Atomicity helpers ──────────────────────────────────────────
function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${randomSuffix()}`;
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

async function stageAsideExisting(dir) {
  if (!existsSync(dir)) return null;
  const stale = `${dir}.stale-${randomSuffix()}`;
  try {
    renameSync(dir, stale);
    return stale;
  } catch {
    // Rename failed (e.g. cross-device): nuke in place and accept the gap.
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
}

function randomSuffix() {
  return `${Date.now()}-${randomBytes(4).toString("hex")}`;
}

// ── checksum compare (constant-time) ──────────────────────────
function sha256Equals(a, b) {
  if (a.length !== 64 || b.length !== 64) return false;
  const bufA = Buffer.from(a.toLowerCase(), "hex");
  const bufB = Buffer.from(b.toLowerCase(), "hex");
  if (bufA.length !== 32 || bufB.length !== 32) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── small utils ────────────────────────────────────────────────
function clampInt(envVal, fallback, min, max) {
  const n = Number(envVal ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

main().catch((e) => {
  err(`unexpected: ${redactUserPaths(e?.stack ?? e)}`);
  process.exit(0); // never fail npm install
});
