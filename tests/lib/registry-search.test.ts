import { describe, expect, it } from "vitest";
import { searchTermsForQuery } from "../../src/lib/registry-search.js";

describe("searchTermsForQuery", () => {
  it("keeps short infrastructure product tokens in exact-search phrases", () => {
    expect(searchTermsForQuery("wrangler d1 binding", 10)).toEqual(
      expect.arrayContaining(["wrangler d1 binding", "d1 binding"]),
    );
    expect(searchTermsForQuery("wrangler d1 binding", 10)).not.toContain("d1");
    expect(searchTermsForQuery("ec2 s3 iam setup", 10)).toEqual(
      expect.arrayContaining(["ec2 s3 iam setup", "ec2 s3 iam", "s3 iam setup"]),
    );
    expect(searchTermsForQuery("ec2 s3 iam setup", 10)).not.toContain("setup");
    expect(searchTermsForQuery("d1", 10)).toEqual(["d1"]);
  });
});
