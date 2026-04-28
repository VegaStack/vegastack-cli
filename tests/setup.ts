// Shared vitest setup. Imported via `import "../setup.js"` from individual
// test files when they need a clean tmp workspace.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Create an isolated tmp dir for a test, auto-cleaned at process exit. */
export function makeTmpDir(prefix = "vegastack-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.on("exit", () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });
  return dir;
}

/** Run a function with a tmp dir, guaranteeing cleanup even on throw. */
export async function withTmpDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-test-"));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Resolve the package root by climbing from this file's location. */
export const PKG_ROOT = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "..",
);
