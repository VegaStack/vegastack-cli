#!/usr/bin/env node
// Postinstall intentionally does not download Registry content or managed
// scanner/search binaries.
//
// Registry entries are installed explicitly with:
//   vegastack init
//
// We do perform a best-effort, non-fatal agent skill registration for already
// installed agent hosts so `/vegastack` is available immediately.

import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (process.env.npm_config_ignore_scripts === "true") {
  // npm normally short-circuits before invoking us when --ignore-scripts is
  // set, but some wrappers (yarn classic, shell scripts forwarding env) call
  // postinstall directly. Honour the user's intent defensively.
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
      if (r.stderr) process.stderr.write(r.stderr);
      if (r.error || (r.status ?? 0) !== 0) {
        const reason = r.error?.message ?? `exit ${r.status ?? "?"}`;
        process.stderr.write(
          `vegastack postinstall: agent skill registration skipped (${reason}). Run \`vegastack skills reconcile\` later.\n`,
        );
      }
    }
  }
}
