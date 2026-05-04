// Smoke test for evals/runner.ts. Mocks the model entirely; verifies scoring
// and lift computation end-to-end against a 3-prompt fixture.

import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resource_present,
  no_resource,
  cites_card,
  cites_recipe,
  cites_path,
  computeLift,
  summarize,
  type PromptScore,
} from "../../evals/lib/score.js";
import { JUDGE_SYSTEM_PROMPT, buildJudgePrompt, parseJudgeJson } from "../../evals/lib/judge.js";
import { mockRun } from "../../evals/lib/anthropic-runner.js";

const FIXTURE_EVALS = {
  schema_version: 1,
  skill_name: "vegastack-cli",
  evals: [
    {
      id: "T1-s3",
      archetype: "A1",
      title: "S3",
      prompt: "Create an aws_s3_bucket named foo.",
      expectations: [
        { id: "has_bucket", kind: "resource_present", value: "aws_s3_bucket" },
        { id: "no_legacy", kind: "no_resource", value: "aws_s3_bucket_inline_versioning" },
      ],
    },
    {
      id: "T2-cf",
      archetype: "A12",
      title: "CF rename",
      prompt: "Is cloudflare_record still a thing?",
      expectations: [
        { id: "uses_dns", kind: "resource_present", value: "cloudflare_dns_record" },
        { id: "no_legacy", kind: "no_resource", value: "cloudflare_record" },
        { id: "cites_card", kind: "cites_card", value: "cloudflare-resource-renames-v5" },
      ],
    },
    {
      id: "T3-eks",
      archetype: "A5",
      title: "EKS",
      prompt: "Spin up an EKS dev cluster.",
      expectations: [
        { id: "has_cluster", kind: "resource_present", value: "aws_eks_cluster" },
        { id: "has_role", kind: "resource_present", value: "aws_iam_role" },
      ],
    },
  ],
};

describe("score primitives", () => {
  const goodHcl = `
    resource "aws_s3_bucket" "ex" { bucket = "foo" }
    resource "aws_eks_cluster" "k" { name = "k"; role_arn = "arn"; vpc_config {} }
  `;

  it("resource_present detects declared resources", () => {
    expect(resource_present(goodHcl, "aws_s3_bucket").passed).toBe(true);
    expect(resource_present(goodHcl, "aws_lb_v2").passed).toBe(false);
  });

  it("no_resource flips on unwanted resource", () => {
    expect(no_resource(goodHcl, "aws_lb_v2").passed).toBe(true);
    expect(no_resource(goodHcl, "aws_s3_bucket").passed).toBe(false);
  });

  it("cites_card matches by id substring", () => {
    const text = "See knowledge card aws-s3-native-state-locking for details.";
    expect(cites_card(text, "aws-s3-native-state-locking", []).passed).toBe(true);
    expect(cites_card(text, "missing-card", []).passed).toBe(false);
  });

  it("cites_recipe matches by id substring", () => {
    const text = "Recipe ref: scalable-backend-aws-ecs-fargate-rds-datadog";
    expect(cites_recipe(text, "scalable-backend-aws-ecs-fargate-rds-datadog", []).passed).toBe(
      true,
    );
  });

  it("cites_path matches by substring", () => {
    expect(cites_path("from aws/r/eks_cluster.html.markdown", "aws/r/eks_cluster").passed).toBe(
      true,
    );
    expect(cites_path("nope", "aws/r/eks_cluster").passed).toBe(false);
  });
});

describe("lift formula", () => {
  it("zero baseline → with_skill becomes the lift directly", () => {
    expect(computeLift(0, 0.5)).toBeCloseTo(0.5);
  });
  it("perfect baseline → lift floor honored (denominator 0.01)", () => {
    expect(computeLift(1, 1)).toBeCloseTo(0);
  });
  it("standard case", () => {
    // baseline 0.4, with_skill 0.7 → 0.3 / 0.6 = 0.5
    expect(computeLift(0.4, 0.7)).toBeCloseTo(0.5);
  });
});

describe("summarize", () => {
  it("aggregates per-archetype and overall", () => {
    const baseline: PromptScore[] = [
      { id: "1", archetype: "A1", passed: 1, total: 2, pct: 0.5, expectations: [] },
      { id: "2", archetype: "A1", passed: 0, total: 2, pct: 0, expectations: [] },
      { id: "3", archetype: "A12", passed: 0, total: 1, pct: 0, expectations: [] },
    ];
    const withSkill: PromptScore[] = [
      { id: "1", archetype: "A1", passed: 2, total: 2, pct: 1, expectations: [] },
      { id: "2", archetype: "A1", passed: 1, total: 2, pct: 0.5, expectations: [] },
      { id: "3", archetype: "A12", passed: 1, total: 1, pct: 1, expectations: [] },
    ];
    const s = summarize(baseline, withSkill);
    expect(s.baseline_pct).toBeCloseTo(1 / 5);
    expect(s.with_skill_pct).toBeCloseTo(4 / 5);
    expect(s.per_archetype.A1?.lift_pct).toBeGreaterThan(0);
    expect(s.per_archetype.A12?.with_skill_pct).toBe(1);
  });
});

describe("judge prompt is locked", () => {
  it("has the required directives", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("strict");
    expect(JUDGE_SYSTEM_PROMPT).toContain("JSON only");
    expect(JUDGE_SYSTEM_PROMPT).toContain("passed");
  });
  it("buildJudgePrompt embeds the truncated response", () => {
    const out = buildJudgePrompt({
      expectation_id: "x",
      question: "Does the response include aws_s3_bucket?",
      hcl_snippet: "",
      full_response: "x".repeat(7000),
    });
    expect(out).toContain("Question: Does the response include aws_s3_bucket?");
    expect(out.length).toBeLessThan(7000);
  });
  it("parseJudgeJson tolerates fenced output", () => {
    expect(parseJudgeJson('```json\n{"passed":true,"reasoning":"ok"}\n```').passed).toBe(true);
    expect(parseJudgeJson('{"passed":false,"reasoning":"no"}').passed).toBe(false);
    expect(parseJudgeJson("yes").passed).toBe(true);
  });
});

describe("anthropic-runner mock fallback", () => {
  it("returns deterministic shape", () => {
    const r = mockRun("create an s3 bucket", "baseline", {});
    expect(r.tool_calls).toBe(0);
    expect(r.stop_reason).toBe("end_turn");
    expect(typeof r.response_text).toBe("string");
  });
  it("accepts seeded fixtures", () => {
    const r = mockRun("create an s3 bucket", "with-skill", {
      "create an s3 bucket": {
        baseline: "no",
        "with-skill": 'resource "aws_s3_bucket" "x" { bucket = "x" }',
      },
    });
    expect(r.response_text).toContain("aws_s3_bucket");
  });
});

describe("end-to-end runner via --mock", () => {
  it("emits a JSON report with summary + per-archetype lift", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vegastack-eval-test-"));
    const evalsPath = join(dir, "evals.json");
    const outPath = join(dir, "report.json");
    await writeFile(evalsPath, JSON.stringify(FIXTURE_EVALS), "utf8");
    const argv = [
      "node",
      "runner",
      "--mode",
      "both",
      "--mock",
      "--evals",
      evalsPath,
      "--output",
      outPath,
      "--concurrency",
      "2",
    ];
    const original = process.argv;
    process.argv = argv;
    try {
      const { main } = await import("../../evals/runner.js");
      const code = await main();
      expect(code).toBe(0);
    } finally {
      process.argv = original;
    }
    // Canonical EvalReport shape from docs/contracts/eval-report.ts
    // (closes punch-list #2 — the runner now emits exactly what the
    // dashboard's parseReport() expects).
    const report = JSON.parse(await readFile(outPath, "utf8")) as {
      schema_version: 1;
      date: string;
      registry_version: string;
      cli_version: string;
      model: string;
      prompt_count: number;
      lift: number;
      baseline_pass_rate: number;
      with_skill_pass_rate: number;
      archetypes: { archetype: string; lift: number }[];
      prompts: { id: string; archetype: string; lift: number }[];
      knowledge_cards: unknown[];
      recipes: unknown[];
      duration_s: number;
    };
    expect(report.schema_version).toBe(1);
    expect(report.prompt_count).toBe(3);
    expect(report.prompts).toHaveLength(3);
    expect(typeof report.lift).toBe("number");
    expect(typeof report.baseline_pass_rate).toBe("number");
    expect(typeof report.with_skill_pass_rate).toBe("number");
    expect(report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(report.archetypes)).toBe(true);
  });
});
