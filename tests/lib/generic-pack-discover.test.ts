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

  it("caps repeated sections from the same file so broad docs do not flood agent context", async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-generic-"));
    tmp.push(registryRoot);
    process.env.VEGASTACK_REGISTRY_DIR = registryRoot;
    process.env.VEGASTACK_NO_MANAGED_TOOLS = "1";

    const packRoot = path.join(registryRoot, "cloudflare");
    fs.mkdirSync(path.join(packRoot, "docs"), { recursive: true });
    fs.mkdirSync(path.join(packRoot, "index"), { recursive: true });
    fs.writeFileSync(
      path.join(packRoot, "docs", "commands.md"),
      Array.from({ length: 6 }, (_, i) => `## d1 command ${i}\n\nwrangler d1 binding command\n`).join("\n"),
    );
    fs.writeFileSync(
      path.join(packRoot, "docs", "bindings.md"),
      "## D1 binding\n\nConfigure a D1 database binding.\n",
    );
    fs.writeFileSync(
      path.join(packRoot, "MANIFEST.json"),
      JSON.stringify({
        schema_version: 2,
        id: "cloudflare",
        docs_root: "docs",
        files: [
          { path: "docs/commands.md", title: "Commands", tokens: ["wrangler", "d1", "binding"] },
          { path: "docs/bindings.md", title: "Bindings", tokens: ["d1", "binding"] },
        ],
      }),
    );
    const commandRecords = Array.from({ length: 6 }, (_, i) => ({
      id: `docs/commands.md#L${i * 3 + 1}`,
      path: "docs/commands.md",
      heading: `d1 command ${i}`,
      start_line: i * 3 + 1,
      end_line: i * 3 + 2,
      tokens: ["wrangler", "d1", "binding", "command"],
      excerpt: "wrangler d1 binding command",
    }));
    fs.writeFileSync(
      path.join(packRoot, "index", "search.json"),
      JSON.stringify({
        schema_version: 1,
        records: [
          ...commandRecords,
          {
            id: "docs/bindings.md#L1",
            path: "docs/bindings.md",
            heading: "D1 binding",
            start_line: 1,
            end_line: 3,
            tokens: ["d1", "binding", "database"],
            excerpt: "Configure a D1 database binding.",
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(packRoot, "index", "rank_index.json"),
      JSON.stringify({
        schema_version: 1,
        records: [
          ...commandRecords.map((record) => ({
            section_id: record.id,
            path: record.path,
            heading: record.heading,
            start_line: record.start_line,
            end_line: record.end_line,
            path_class: "cli-reference",
            rank_terms: record.tokens,
          })),
          {
            section_id: "docs/bindings.md#L1",
            path: "docs/bindings.md",
            heading: "D1 binding",
            start_line: 1,
            end_line: 3,
            path_class: "reference",
            rank_terms: ["d1", "binding", "database"],
          },
        ],
      }),
    );

    const result = await discoverGenericPacks("wrangler d1 binding", ["cloudflare"], 10, {
      installTools: false,
    });

    expect(result.results.filter((r) => r.path === "docs/commands.md")).toHaveLength(3);
    expect(result.results.some((r) => r.path === "docs/bindings.md")).toBe(true);
  });

  it("keeps evidence from multiple packs for cross-pack queries", async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-generic-"));
    tmp.push(registryRoot);
    process.env.VEGASTACK_REGISTRY_DIR = registryRoot;
    process.env.VEGASTACK_NO_MANAGED_TOOLS = "1";

    writePackWithOneSection(registryRoot, "cloudflare", {
      path: "docs/workers/github-actions.md",
      title: "Deploy Workers with GitHub Actions",
      tokens: ["cloudflare", "workers", "github", "actions", "deploy"],
      excerpt: "Deploy Cloudflare Workers using GitHub Actions.",
    });
    writePackWithOneSection(registryRoot, "github-actions", {
      path: "docs/workflows/deployments.md",
      title: "Deployment workflows",
      tokens: ["github", "actions", "workflow", "deploy", "environment"],
      excerpt: "Use GitHub Actions workflows for deployments.",
    });

    const result = await discoverGenericPacks(
      "deploy Cloudflare Worker with GitHub Actions",
      ["cloudflare", "github-actions"],
      6,
      { installTools: false },
    );

    expect(new Set(result.results.map((r) => r.registry_entry))).toEqual(
      new Set(["cloudflare", "github-actions"]),
    );
  });

  it("prefers sections that cover the query concepts over incidental generic token matches", async () => {
    const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-generic-"));
    tmp.push(registryRoot);
    process.env.VEGASTACK_REGISTRY_DIR = registryRoot;
    process.env.VEGASTACK_NO_MANAGED_TOOLS = "1";

    const packRoot = path.join(registryRoot, "cloudflare");
    fs.mkdirSync(path.join(packRoot, "docs"), { recursive: true });
    fs.mkdirSync(path.join(packRoot, "index"), { recursive: true });
    const sections = [
      {
        path: "docs/workers/ci-cd/github-actions.md",
        title: "Deploy Workers with GitHub Actions",
        tokens: ["deploy", "workers", "github", "actions"],
        excerpt: "Deploy Cloudflare Workers from a GitHub Actions workflow.",
      },
      {
        path: "docs/cloudflare-one/deploy-replicas.md",
        title: "Deploy cloudflared replicas",
        tokens: ["deploy", "cloudflare"],
        excerpt: "Deploy connector replicas for Cloudflare One availability.",
      },
      {
        path: "docs/email-security/link-actions.md",
        title: "Link actions settings",
        tokens: ["actions", "cloudflare"],
        excerpt: "Configure link actions for email security.",
      },
    ];
    for (const section of sections) {
      fs.mkdirSync(path.dirname(path.join(packRoot, section.path)), { recursive: true });
      fs.writeFileSync(path.join(packRoot, section.path), `# ${section.title}\n\n${section.excerpt}\n`);
    }
    fs.writeFileSync(
      path.join(packRoot, "MANIFEST.json"),
      JSON.stringify({
        schema_version: 2,
        id: "cloudflare",
        docs_root: "docs",
        files: sections.map((section) => ({
          path: section.path,
          title: section.title,
          tokens: section.tokens,
        })),
      }),
    );
    fs.writeFileSync(
      path.join(packRoot, "index", "search.json"),
      JSON.stringify({
        schema_version: 1,
        records: sections.map((section) => ({
          id: `${section.path}#L1`,
          path: section.path,
          heading: section.title,
          start_line: 1,
          end_line: 3,
          tokens: section.tokens,
          excerpt: section.excerpt,
        })),
      }),
    );
    fs.writeFileSync(
      path.join(packRoot, "index", "rank_index.json"),
      JSON.stringify({
        schema_version: 1,
        records: sections.map((section) => ({
          section_id: `${section.path}#L1`,
          path: section.path,
          heading: section.title,
          start_line: 1,
          end_line: 3,
          path_class: "guide",
          rank_terms: section.tokens,
        })),
      }),
    );

    const result = await discoverGenericPacks(
      "deploy Cloudflare Worker with GitHub Actions",
      ["cloudflare"],
      3,
      { installTools: false },
    );

    expect(result.results[0]?.path).toBe("docs/workers/ci-cd/github-actions.md");
    expect(result.results.some((r) => r.path === "docs/cloudflare-one/deploy-replicas.md")).toBe(
      false,
    );
  });
});

function writePackWithOneSection(
  registryRoot: string,
  entry: string,
  section: { path: string; title: string; tokens: string[]; excerpt: string },
): void {
  const packRoot = path.join(registryRoot, entry);
  const file = path.join(packRoot, section.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(packRoot, "index"), { recursive: true });
  fs.writeFileSync(file, `# ${section.title}\n\n${section.excerpt}\n`);
  fs.writeFileSync(
    path.join(packRoot, "MANIFEST.json"),
    JSON.stringify({
      schema_version: 2,
      id: entry,
      docs_root: "docs",
      files: [{ path: section.path, title: section.title, tokens: section.tokens }],
    }),
  );
  const record = {
    id: `${section.path}#L1`,
    path: section.path,
    heading: section.title,
    start_line: 1,
    end_line: 3,
    tokens: section.tokens,
    excerpt: section.excerpt,
  };
  fs.writeFileSync(
    path.join(packRoot, "index", "search.json"),
    JSON.stringify({ schema_version: 1, records: [record] }),
  );
  fs.writeFileSync(
    path.join(packRoot, "index", "rank_index.json"),
    JSON.stringify({
      schema_version: 1,
      records: [
        {
          section_id: record.id,
          path: section.path,
          heading: section.title,
          start_line: 1,
          end_line: 3,
          path_class: "reference",
          rank_terms: section.tokens,
        },
      ],
    }),
  );
}
