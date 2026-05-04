import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverGenericPacks } from "../../src/lib/generic-pack-discover.js";

const tmp: string[] = [];
const oldEnv = { ...process.env };

afterEach(() => {
  process.env = { ...oldEnv };
  for (const dir of tmp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("discoverGenericPacks", () => {
  it("uses entity and rank indexes for deterministic section pre-ranking", async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-generic-"));
    tmp.push(registryRoot);
    process.env.VEGASTACK_REGISTRY_DIR = registryRoot;
    process.env.VEGASTACK_NO_MANAGED_TOOLS = "1";

    const packRoot = path.join(registryRoot, "jenkins");
    fs.mkdirSync(path.join(packRoot, "docs"), { recursive: true });
    fs.mkdirSync(path.join(packRoot, "index"), { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "docs", "pipeline.md"),
      [
        "# Pipeline Syntax",
        "",
        "Use withCredentials in a Jenkinsfile when binding credentials to a Pipeline step.",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(packRoot, "docs", "overview.md"),
      "# Overview\n\nGeneral Jenkins administration overview.\n",
    );
    fs.writeFileSync(
      path.join(packRoot, "MANIFEST.json"),
      JSON.stringify({
        schema_version: 2,
        id: "jenkins",
        docs_root: "docs",
        files: [
          { path: "docs/pipeline.md", title: "Pipeline Syntax", tokens: ["pipeline"] },
          { path: "docs/overview.md", title: "Overview", tokens: ["overview"] },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(packRoot, "index", "search.json"),
      JSON.stringify({
        schema_version: 1,
        records: [
          {
            id: "docs/pipeline.md#L1",
            path: "docs/pipeline.md",
            heading: "Pipeline Syntax",
            start_line: 1,
            end_line: 3,
            tokens: ["pipeline", "withcredentials", "credentials", "jenkinsfile"],
            excerpt: "Use withCredentials in a Jenkinsfile when binding credentials.",
          },
          {
            id: "docs/overview.md#L1",
            path: "docs/overview.md",
            heading: "Overview",
            start_line: 1,
            end_line: 3,
            tokens: ["overview", "administration"],
            excerpt: "General Jenkins administration overview.",
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(packRoot, "index", "entities.json"),
      JSON.stringify({
        schema_version: 1,
        entities: [
          {
            id: "jenkins_step:withCredentials",
            kind: "jenkins_step",
            name: "withCredentials",
            tokens: ["withcredentials", "credentials"],
            aliases: ["secret wrapper", "credential binding"],
            sections: ["docs/pipeline.md#L1"],
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(packRoot, "index", "rank_index.json"),
      JSON.stringify({
        schema_version: 1,
        records: [
          {
            section_id: "docs/pipeline.md#L1",
            path: "docs/pipeline.md",
            heading: "Pipeline Syntax",
            start_line: 1,
            end_line: 3,
            path_class: "reference",
            entity_refs: ["jenkins_step:withCredentials"],
            rank_terms: ["pipeline", "credentials", "jenkinsfile"],
          },
          {
            section_id: "docs/overview.md#L1",
            path: "docs/overview.md",
            heading: "Overview",
            start_line: 1,
            end_line: 3,
            path_class: "docs",
            entity_refs: [],
            rank_terms: ["overview", "administration"],
          },
        ],
      }),
    );

    const result = await discoverGenericPacks("jenkins secret wrapper", ["jenkins"], 3, {
      installTools: false,
    });

    expect(result.status).toBe("ok");
    expect(result.results[0]).toMatchObject({
      registry_entry: "jenkins",
      path: "docs/pipeline.md",
      section_id: "docs/pipeline.md#L1",
    });
    expect(result.results[0]?.match_reasons).toContain("entity:jenkins_step:withCredentials");
    expect(result.results[0]?.score).toBeGreaterThan(0);
  });
});
