#!/usr/bin/env node
// scripts/check-bundle-pin.js — guards `npm publish` against shipping the
// `expectedBundleSha = "sha256-PENDING-FIRST-RELEASE"` placeholder.
//
// Closes audit punch-list #4 (A2 must-fix): without this guard, v0.1.0
// would publish to npm with a placeholder SHA and the install-time
// verification path would fall back to TOFU on first install (the .sha256
// sidecar fetched over the same TLS endpoint as the tarball).
//
// Wired into `package.json#scripts.prepublishOnly`. npm runs this BEFORE
// publishing the package, so any non-zero exit blocks the publish.
//
// Bypass for legitimate cases (e.g. testing the publish pipeline itself):
//   VEGASTACK_ALLOW_PENDING_BUNDLE_SHA=1 npm publish
//
// Override the package.json path (for tests):
//   VEGASTACK_PACKAGE_JSON=/path/to/package.json node scripts/check-bundle-pin.js

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER_SHA = "sha256-PENDING-FIRST-RELEASE";
const PLACEHOLDER_VERSION = "0.0.0";

function main() {
  if (process.env.VEGASTACK_ALLOW_PENDING_BUNDLE_SHA === "1") {
    process.stderr.write(
      "[check-bundle-pin] VEGASTACK_ALLOW_PENDING_BUNDLE_SHA=1 — bypassing the placeholder check.\n",
    );
    return 0;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = process.env.VEGASTACK_PACKAGE_JSON ?? join(here, "..", "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (err) {
    process.stderr.write(
      `[check-bundle-pin] failed to read ${pkgPath}: ${err && err.message ? err.message : String(err)}\n`,
    );
    return 1;
  }

  const sha = pkg.expectedBundleSha;
  const ver = pkg.expectedBundleVersion;
  const errors = [];

  if (typeof sha !== "string" || sha === PLACEHOLDER_SHA) {
    errors.push(
      `expectedBundleSha is the placeholder "${PLACEHOLDER_SHA}"; the bundle has not been pinned yet.`,
    );
  } else if (!/^sha256-[a-f0-9]{64}$/i.test(sha)) {
    errors.push(
      `expectedBundleSha "${sha}" does not match the expected pattern sha256-<64 hex chars>.`,
    );
  }
  if (typeof ver !== "string" || ver === PLACEHOLDER_VERSION) {
    errors.push(
      `expectedBundleVersion is the placeholder "${PLACEHOLDER_VERSION}"; bundle CalVer must be pinned (e.g. "2026.04.28").`,
    );
  } else if (!/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}(\.[0-9]+)?$/.test(ver)) {
    errors.push(
      `expectedBundleVersion "${ver}" does not match the CalVer pattern YYYY.MM.DD[.N].`,
    );
  }

  if (errors.length > 0) {
    process.stderr.write(
      "\n[check-bundle-pin] BLOCKED: cannot publish until the bundle is pinned.\n\n",
    );
    for (const e of errors) process.stderr.write(`  ✗ ${e}\n`);
    process.stderr.write(
      "\nFix: run `npm run tag-release` after the daily bundle cron has produced a real SHA + CalVer,\n",
    );
    process.stderr.write(
      "     OR set VEGASTACK_ALLOW_PENDING_BUNDLE_SHA=1 to publish a TOFU build (NOT recommended).\n\n",
    );
    return 1;
  }

  process.stderr.write(
    `[check-bundle-pin] OK — bundle pinned: ${ver} ${sha}\n`,
  );
  return 0;
}

process.exit(main());
