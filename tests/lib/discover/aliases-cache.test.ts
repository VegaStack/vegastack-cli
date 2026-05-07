import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAliasCache, loadAliases } from "../../../src/lib/discover/aliases.js";

describe("loadAliases — mtime cache", () => {
  let tmp: string;
  let provDir: string;
  let aliasFile: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-alias-cache-"));
    provDir = path.join(tmp, "aws");
    fs.mkdirSync(provDir);
    aliasFile = path.join(provDir, "aliases.yaml");
    fs.writeFileSync(
      aliasFile,
      "- phrase: static website\n  alias: s3_static_site\n  resources:\n    - aws_s3_bucket\n",
    );
    clearAliasCache();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    clearAliasCache();
  });

  it("returns the same array instance across calls when mtime is unchanged", () => {
    const a = loadAliases({ terraformRoot: tmp, provider: "aws" });
    const b = loadAliases({ terraformRoot: tmp, provider: "aws" });
    expect(a).toBe(b);
  });

  it("recomputes when mtime changes", () => {
    const a = loadAliases({ terraformRoot: tmp, provider: "aws" });
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(aliasFile, future, future);
    fs.writeFileSync(
      aliasFile,
      "- phrase: changed\n  alias: changed_alias\n  resources:\n    - aws_changed\n",
    );
    const b = loadAliases({ terraformRoot: tmp, provider: "aws" });
    expect(b).not.toBe(a);
    expect(b[0]!.alias).toBe("changed_alias");
  });

  it("missing file returns the same empty array on repeat calls", () => {
    const a = loadAliases({ terraformRoot: tmp, provider: "no-such" });
    const b = loadAliases({ terraformRoot: tmp, provider: "no-such" });
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });
});
