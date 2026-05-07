import { describe, expect, it } from "vitest";
import { buildWorkflowToolArgv } from "../../src/commands/scan.js";

describe("buildWorkflowToolArgv — argv-injection guard for actionlint/zizmor", () => {
  it("inserts a `--` separator between flags and user-controlled file paths", () => {
    const argv = buildWorkflowToolArgv(
      ["-format", "json"],
      [".github/workflows/ci.yml", ".github/workflows/release.yml"],
    );
    const dashIdx = argv.indexOf("--");
    expect(dashIdx).toBeGreaterThan(0);
    // every entry after `--` is a file path, not a flag
    for (const entry of argv.slice(dashIdx + 1)) {
      expect(entry.startsWith("-")).toBe(false);
    }
    expect(argv.slice(dashIdx + 1)).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
    ]);
  });

  it("filters out any path that starts with `-` (defence-in-depth)", () => {
    // A path that begins with `-` would be interpreted as a flag by
    // actionlint/zizmor. Even though our scanActions caller also pre-filters,
    // buildWorkflowToolArgv enforces the same invariant.
    const argv = buildWorkflowToolArgv([], [".github/workflows/ok.yml", "-evil.yml"]);
    expect(argv).toEqual(["--", ".github/workflows/ok.yml"]);
  });

  it("emits only `--` when no workflow files remain", () => {
    expect(buildWorkflowToolArgv(["--format=json"], [])).toEqual(["--format=json", "--"]);
  });
});
