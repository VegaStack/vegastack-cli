#!/usr/bin/env node
// Idempotent tag-and-push helper invoked by changesets/action on the
// "Version Packages" PR merge.
//
// On vega-bot release cut, this script:
//   1. Fetches the current bundle CalVer + sha256 from
//      https://bundles.vegastack.com/manifest.json (latest channel by default).
//   2. Writes them into package.json as `expectedBundleVersion` and
//      `expectedBundleSha`. E2 reads these at runtime to verify the
//      bundle on disk matches what the CLI was tagged against.
//   3. Commits the package.json bump (only if changed).
//   4. Creates `vX.Y.Z` git tag (idempotent — skips if it already exists
//      locally or on origin) and pushes it. The tag push triggers
//      .github/workflows/release.yml which performs the OIDC publish.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const PKG_PATH = resolve("package.json");
const MANIFEST_URL =
  process.env.VEGA_BUNDLE_MANIFEST_URL || "https://bundles.vegastack.com/manifest.json";
const CHANNEL = process.env.VEGA_RELEASE_CHANNEL || "latest";

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return {
    ok: result.status === 0,
    out: result.stdout?.trim() ?? "",
    err: result.stderr?.trim() ?? "",
  };
}

async function fetchBundleManifest(url) {
  // Use Node's global fetch (Node 18+).
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return await res.json();
  } catch (err) {
    console.warn(`WARNING: could not fetch bundle manifest at ${url}: ${err.message}`);
    console.warn("Skipping bundle pin update; tag will be cut without expectedBundleSha refresh.");
    return null;
  }
}

export function pinBundleIntoPackage(pkg, manifest, channel) {
  // Manifest shape (per E1 / brief §7):
  // {
  //   "channels": {
  //     "latest": { "bundle_version": "2026.04.28", "bundle_sha256": "abc..." },
  //     "stable": { ... }   // v0.2+
  //   }
  // }
  // Tolerate both shapes (channeled vs flat) for forward-compat.
  const channelEntry =
    manifest?.channels?.[channel] ?? (manifest?.bundle_version ? manifest : null);
  if (!channelEntry) {
    console.warn(`WARNING: bundle manifest has no '${channel}' channel; not updating pin.`);
    return false;
  }
  const ver = channelEntry.bundle_version;
  const sha = channelEntry.bundle_sha256;
  if (!ver || !sha) {
    console.warn(
      "WARNING: bundle manifest missing bundle_version or bundle_sha256; not updating pin.",
    );
    return false;
  }
  const formattedSha = sha.startsWith("sha256-") ? sha : `sha256-${sha}`;
  const before = {
    v: pkg.expectedBundleVersion,
    s: pkg.expectedBundleSha,
  };
  pkg.expectedBundleVersion = ver;
  pkg.expectedBundleSha = formattedSha;
  if (before.v === ver && before.s === formattedSha) {
    console.log(`bundle pin unchanged (${ver}, ${formattedSha}); no commit needed`);
    return false;
  }
  console.log(`pinning bundle: ${before.v} -> ${ver}, ${before.s} -> ${formattedSha}`);
  return true;
}

async function main() {
  const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  const tag = `v${pkg.version}`;

  // Step 1+2: pin bundle CalVer + sha into package.json (best effort).
  const manifest = await fetchBundleManifest(MANIFEST_URL);
  let pinChanged = false;
  if (manifest) {
    pinChanged = pinBundleIntoPackage(pkg, manifest, CHANNEL);
    if (pinChanged) {
      writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    }
  }

  // Step 3: commit package.json if it changed.
  if (pinChanged) {
    const add = run("git", ["add", "package.json"]);
    if (!add.ok) {
      console.error(`git add failed: ${add.err}`);
      process.exit(1);
    }
    const commit = run("git", [
      "commit",
      "-m",
      `chore: pin bundle ${pkg.expectedBundleVersion} for ${tag}`,
    ]);
    if (!commit.ok) {
      console.warn(`git commit reported: ${commit.err || commit.out}`);
    }
    const push = run("git", ["push", "origin", "HEAD"], { stdio: "inherit" });
    if (!push.ok) {
      console.error(`git push of bundle pin failed: ${push.err}`);
      // Continue — the tag is the load-bearing artifact.
    }
  }

  // Step 4: idempotent tag-and-push.
  if (run("git", ["rev-parse", tag]).ok) {
    console.log(`tag ${tag} already exists locally; skipping`);
    process.exit(0);
  }
  if (run("git", ["ls-remote", "--exit-code", "--tags", "origin", tag]).ok) {
    console.log(`tag ${tag} already exists on origin; skipping`);
    process.exit(0);
  }

  console.log(`creating tag ${tag}`);
  const t = run("git", ["tag", tag]);
  if (!t.ok) {
    console.error(`git tag failed: ${t.err}`);
    process.exit(1);
  }

  console.log(`pushing tag ${tag} to origin`);
  const p = run("git", ["push", "origin", tag], { stdio: "inherit" });
  if (!p.ok) {
    console.error(`git push failed: ${p.err}`);
    process.exit(1);
  }
}

// Only execute when invoked as the script entry point, not when imported
// by tests.
const isEntryPoint = (() => {
  try {
    const argv1 = resolve(process.argv[1] ?? "");
    const here = new URL(import.meta.url).pathname;
    return argv1 === resolve(here);
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
