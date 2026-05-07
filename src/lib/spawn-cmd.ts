import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";

/**
 * Cross-platform-safe wrapper around `spawnSync` for binaries that ship as
 * `.cmd` / `.bat` shims on Windows — npm, npx, yarn, pnpm, and vegastack
 * itself once it's globally installed.
 *
 * **Why this exists.** Node 20.10+ refuses to exec `.cmd`/`.bat` files via
 * `spawn`/`spawnSync` without `shell: true` as part of the CVE-2024-27980
 * mitigation. Bare `spawnSync("npm", args)` on Windows therefore fails with
 * ENOENT for every npm-installed binary, breaking `vegastack update` and
 * `vegastack scan` self-update on every Windows host.
 *
 * The fix is `shell: true` on win32 only. **The cost** is that args are
 * passed through `cmd.exe`'s parser, so this helper MUST NOT be used with
 * user-controlled `cmd` or `args`. All current call sites pass hardcoded
 * package-management constants — no user input flows in.
 *
 * If you need to pass user input to a subprocess, use `spawnSync` directly
 * with `shell: false` (the safe default) and resolve the binary via
 * `which`/`fs.access` first.
 *
 * Audit refs: #61, #62, #63, #66, #67.
 */
export function spawnCmdSync(
  cmd: string,
  args: readonly string[],
  options?: SpawnSyncOptions,
): SpawnSyncReturns<string> {
  // Hard guard: no metacharacters in cmd or args. Cheap defense in depth so
  // future callers can't accidentally introduce shell injection by changing
  // a hardcoded string to a variable. If you trip this, either sanitize the
  // input or use spawnSync directly with shell:false.
  if (/[;&|`$<>\n\r]/.test(cmd)) {
    throw new Error(`spawnCmdSync: refused unsafe cmd containing shell metacharacters: ${cmd}`);
  }
  for (const a of args) {
    if (/[;&|`$<>\n\r]/.test(a)) {
      throw new Error(`spawnCmdSync: refused unsafe arg containing shell metacharacters: ${a}`);
    }
  }

  if (process.platform === "win32") {
    return spawnSync(cmd, args as string[], {
      encoding: "utf8",
      ...options,
      shell: true,
    }) as SpawnSyncReturns<string>;
  }
  return spawnSync(cmd, args as string[], {
    encoding: "utf8",
    ...options,
  }) as SpawnSyncReturns<string>;
}
