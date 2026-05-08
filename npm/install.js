#!/usr/bin/env node
// Postinstall intentionally does not download Registry content or managed
// scanner/search binaries.
//
// Registry packs are installed explicitly with:
//   vegastack init
//
// We do perform a best-effort, non-fatal agent skill registration for already
// installed agent hosts so `/vegastack` is available immediately.

import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Defence-in-depth: honour `npm_config_ignore_scripts=true`. npm itself
// usually short-circuits before invoking postinstall when the user runs
// `npm i --ignore-scripts`, but some wrappers (yarn classic, shell scripts
// forwarding env) call postinstall directly. Honour the user's intent
// defensively. Audit security/F-006 in audit-1778150875.
if (process.env.npm_config_ignore_scripts === "true") {
  process.stderr.write("vegastack postinstall: npm_config_ignore_scripts=true; skipping.\n");
} else if (process.env.VEGASTACK_SKIP_POSTINSTALL === "1") {
  process.stderr.write("vegastack postinstall: VEGASTACK_SKIP_POSTINSTALL=1 set; nothing to do.\n");
} else {
  process.stderr.write(
    "vegastack postinstall: does not download Registry data; run `vegastack setup` for global tools and `vegastack init` in a project.\n",
  );
  if (process.env.VEGASTACK_SKIP_SKILL_INSTALL === "1") {
    process.stderr.write(
      "vegastack postinstall: VEGASTACK_SKIP_SKILL_INSTALL=1 set; skipping agent skill registration.\n",
    );
  } else {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cli = path.resolve(here, "..", "dist", "cli.js");
    if (!existsSync(cli)) {
      process.stderr.write(
        "vegastack postinstall: dist/cli.js missing; skipping agent skill registration.\n",
      );
    } else {
      const timeoutMs = Number.parseInt(
        process.env.VEGASTACK_POSTINSTALL_TIMEOUT_MS ?? "15000",
        10,
      );
      const r = spawnSync(process.execPath, [cli, "skills", "reconcile", "--scope", "global"], {
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...process.env,
          VEGASTACK_POSTINSTALL: "1",
        },
        encoding: "utf8",
        timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
      });
      // Cap forwarded stderr so a misbehaving `skills reconcile` cannot spam
      // npm's postinstall log buffer with megabytes of output. Audit
      // npm-shim/F-005 in audit-1778150875.
      if (r.stderr) {
        const cap = 4096;
        if (r.stderr.length > cap) {
          process.stderr.write(
            `${r.stderr.slice(0, cap)}\n…(truncated ${r.stderr.length - cap} bytes of postinstall stderr)\n`,
          );
        } else {
          process.stderr.write(r.stderr);
        }
      }
      if (r.error || (r.status ?? 0) !== 0) {
        const reason = r.error?.message ?? `exit ${r.status ?? "?"}`;
        process.stderr.write(
          `vegastack postinstall: agent skill registration skipped (${reason}). Run \`vegastack skills reconcile\` later.\n`,
        );
      }
    }
  }
}
