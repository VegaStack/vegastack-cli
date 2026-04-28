import { describe, expect, it } from "vitest";
import { pathWeight } from "../../../src/lib/discover/path-weight.js";

describe("pathWeight", () => {
  it.each([
    ["aws/r/s3_bucket.html.markdown", 1.0],
    ["cloudflare/resources/dns_record.md", 1.0],
    ["aws/d/instance.html.markdown", 0.8],
    ["cloudflare/data-sources/zones.md", 0.8],
    ["aws/index.html.markdown", 0.5],
    ["aws/guides/migration.md", 0.3],
    ["aws/functions/strlen.md", 0.2],
    ["bare/file.md", 1.0], // no pattern → default 1.0
  ])("'%s' → %f", (filepath, expected) => {
    expect(pathWeight(filepath)).toBe(expected);
  });

  it("first match wins (mirrors Python)", () => {
    // 'guides/' appears before '/r/' in PATH_WEIGHTS, so a path that contains
    // both 'guides/' and '/r/' substrings gets the lower weight.
    // Such a path is contrived but documents the precedence rule.
    expect(pathWeight("path/with/guides/r/anywhere.md")).toBe(0.3);
  });
});
