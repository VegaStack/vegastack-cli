// Integration test for `scripts/generate-skill-from-bundle.ts`. Runs the
// generator against a fixture template + fixture bundle MANIFEST.json and
// asserts the rendered output matches expectations.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderSkill, resolveBundleSummary } from "../../scripts/generate-skill-from-bundle.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-skill-render-"));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("generate-skill-from-bundle", () => {
  it("substitutes BUNDLE_VERSION + PROVIDERS_COUNT + PROVIDER_LIST", () => {
    const tpl = [
      "Bundle: ${BUNDLE_VERSION}",
      "Count: ${PROVIDERS_COUNT}",
      "Providers: ${PROVIDER_LIST}",
      "",
    ].join("\n");

    const out = renderSkill(tpl, {
      bundleVersion: "2026.04.28",
      providers: ["aws", "cloudflare"],
    });

    expect(out).toContain("Bundle: 2026.04.28");
    expect(out).toContain("Count: 2");
    expect(out).toContain("Providers: AWS, Cloudflare");
  });

  it("falls back to dev defaults when MANIFEST.json is absent", () => {
    const summary = resolveBundleSummary(path.join(workdir, "no-such-manifest.json"));
    expect(summary.bundleVersion).toBe("dev");
    expect(summary.providers.length).toBeGreaterThanOrEqual(31);
    expect(summary.providers).toContain("aws");
    expect(summary.providers).toContain("cloudflare");
  });

  it("reads bundle_version + providers from a real MANIFEST.json", () => {
    const manifestPath = path.join(workdir, "MANIFEST.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        bundle_version: "2026.05.01",
        providers: ["aws", "gcp"],
      }),
      "utf8",
    );
    const summary = resolveBundleSummary(manifestPath);
    expect(summary.bundleVersion).toBe("2026.05.01");
    expect(summary.providers).toEqual(["aws", "gcp"]);
  });

  it("handles providers as an object (legacy shape)", () => {
    const manifestPath = path.join(workdir, "MANIFEST.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        bundle_version: "2026.04.28",
        providers: { aws: {}, cloudflare: {}, azure: {} },
      }),
      "utf8",
    );
    const summary = resolveBundleSummary(manifestPath);
    expect(summary.providers).toContain("aws");
    expect(summary.providers).toContain("cloudflare");
    expect(summary.providers).toContain("azure");
  });

  it("regenerated SKILL.md matches the on-disk SKILL.md (CI gate)", () => {
    // Re-rendering from the canonical template must produce the same bytes
    // as the committed SKILL.md. PRs that hand-edit SKILL.md without
    // updating the template will fail this test.
    const repoRoot = path.resolve(
      import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
      "..",
      "..",
    );
    const templatePath = path.join(repoRoot, "bundle", "skill-source", "SKILL.md.template");
    const skillPath = path.join(repoRoot, "skills", "vegastack", "SKILL.md");

    const tpl = fs.readFileSync(templatePath, "utf8");
    const summary = resolveBundleSummary(path.join(repoRoot, "bundle", "MANIFEST.json"));
    const rendered = renderSkill(tpl, summary);
    const onDisk = fs.readFileSync(skillPath, "utf8");

    expect(onDisk).toBe(rendered);
  });
});
