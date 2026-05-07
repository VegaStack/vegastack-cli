// Audit code-review/lib-core F-004: realpathIfExists used to swallow ALL
// realpath errors and fall back to the unresolved input — including EACCES
// and EIO, which left the TOCTOU window open. The fix narrows the catch
// to ENOENT only.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateSafeFilePath } from "../../src/lib/validate.js";

let tmp: string;
let lockedDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vs-validate-eacces-"));
});
afterEach(() => {
  // Restore perms before cleanup so rm can recurse.
  if (lockedDir) {
    try {
      fs.chmodSync(lockedDir, 0o755);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("realpathIfExists narrows error fall-through (F-004)", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "rejects with ValidationError when realpath hits EACCES on an intermediate component",
    () => {
      // Create: <tmp>/locked/inner/file.txt, then chmod 0 on `locked` so
      // realpath through it fails with EACCES.
      lockedDir = path.join(tmp, "locked");
      const inner = path.join(lockedDir, "inner");
      fs.mkdirSync(inner, { recursive: true });
      const file = path.join(inner, "file.txt");
      fs.writeFileSync(file, "hi");

      // After this chmod the user can no longer traverse `locked`, so
      // realpathSync(file) throws EACCES.
      fs.chmodSync(lockedDir, 0o000);

      // Sanity: confirm realpathSync actually throws EACCES on this platform.
      let realpathThrew: (Error & { code?: string }) | undefined;
      try {
        fs.realpathSync(file);
      } catch (e) {
        realpathThrew = e as Error & { code?: string };
      }
      // If the platform doesn't enforce search perms (e.g. some CI envs),
      // skip the assertion rather than fail with a misleading error.
      if (!realpathThrew || realpathThrew.code !== "EACCES") return;

      // Validate against an allowed-root that requires realpath to traverse
      // the locked dir → realpathIfExists triggers and must NOT silently
      // fall through; it should surface a ValidationError.
      expect(() =>
        validateSafeFilePath(file, { allowedRoots: [lockedDir], cwd: tmp, mustExist: true }),
      ).toThrow();
    },
  );
});
