import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("apps/dashboard/wrangler.toml", () => {
  it("does not ship REPLACE_WITH_* placeholders (#78)", () => {
    // Why: a fresh checkout running `wrangler deploy` against the committed
    // wrangler.toml would fail because Cloudflare rejects placeholder KV
    // namespace IDs. Either the IDs are real (committed) or the binding
    // is commented out so the deploy succeeds without it. Either way, no
    // `REPLACE_WITH_*` token may remain active in the file.
    const filePath = path.resolve(__dirname, "..", "..", "apps", "dashboard", "wrangler.toml");
    const text = fs.readFileSync(filePath, "utf8");
    // Strip TOML comments before scanning so example values inside `#`
    // documentation lines are tolerated.
    const stripped = text
      .split("\n")
      .map((line) => (line.trimStart().startsWith("#") ? "" : line))
      .join("\n");
    expect(stripped).not.toMatch(/REPLACE_WITH_/);
  });
});
