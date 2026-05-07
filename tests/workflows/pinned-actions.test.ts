// Reproduces #64: every `uses:` reference in .github/workflows/ must be pinned
// to a 40-char commit SHA, not a floating tag (`@v4`, `@v4.1.0`). Floating tags
// are mutable — a compromised maintainer or a re-pushed tag can swap out the
// action body without any audit trail. The fix is mechanical (look up SHA,
// rewrite); this test exists so a regression on a future workflow edit fails
// loudly instead of silently re-introducing an unpinned action.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

const SHA_RE = /^[0-9a-f]{40}$/;
const USES_RE = /^\s*-?\s*uses:\s*([^\s#]+)/;

function workflowFiles(): string[] {
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => path.join(WORKFLOWS_DIR, f));
}

function stripComments(line: string): string {
  // Drop the YAML inline comment so a SHA reference like `@<sha> # v4.1.0`
  // doesn't get parsed as part of the ref.
  return line.replace(/\s+#.*$/, "");
}

function isLocalReference(ref: string): boolean {
  // `uses: ./.github/workflows/foo.yml` and `uses: ./local-action` are local
  // and don't need pinning.
  return ref.startsWith("./") || ref.startsWith("../");
}

describe("workflow action pinning (#64)", () => {
  it("every `uses:` reference is pinned to a 40-char commit SHA", () => {
    const violations: string[] = [];
    for (const file of workflowFiles()) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((rawLine, idx) => {
        const line = stripComments(rawLine);
        // Skip lines that are entirely comments
        if (/^\s*#/.test(rawLine)) return;
        const m = USES_RE.exec(line);
        if (!m) return;
        const ref = m[1];
        if (!ref || isLocalReference(ref)) return;
        const at = ref.lastIndexOf("@");
        if (at < 0) {
          violations.push(`${path.basename(file)}:${idx + 1} missing @<sha>: ${ref}`);
          return;
        }
        const sha = ref.slice(at + 1);
        if (!SHA_RE.test(sha)) {
          violations.push(`${path.basename(file)}:${idx + 1} not a SHA: ${ref}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("every pinned action carries a `# vX.Y.Z` version comment for human review", () => {
    const violations: string[] = [];
    for (const file of workflowFiles()) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (/^\s*#/.test(line)) return;
        const m = USES_RE.exec(stripComments(line));
        if (!m) return;
        const ref = m[1];
        if (!ref || isLocalReference(ref)) return;
        if (!/#\s*v?\d/.test(line)) {
          violations.push(`${path.basename(file)}:${idx + 1} missing version comment: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
