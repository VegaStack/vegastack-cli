// Recipe loader unit tests against the bundle-mini fixture.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRecipes } from "../../../src/lib/discover/recipes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "..", "..", "fixtures", "bundle-mini");

describe("loadRecipes — happy path", () => {
  it("parses TOML and returns recipes matching a token trigger", () => {
    const recipes = loadRecipes({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["ecs", "fargate", "alb", "autoscaling"],
      query: "ecs fargate alb autoscaling",
      provider: "aws",
    });
    expect(recipes.length).toBe(1);
    expect(recipes[0]?.id).toBe("scalable-backend-aws-ecs-fargate-rds-datadog");
    expect(recipes[0]?.providers).toEqual(["aws", "datadog"]);
    expect(recipes[0]?.scaffold_hcl).toContain("aws_ecs_cluster");
  });

  it("phrase-trigger matches case-insensitively", () => {
    const recipes = loadRecipes({
      bundleRoot: FIXTURE_ROOT,
      tokens: [],
      query: "ecs fargate behind alb with autoscaling",
      provider: "aws",
    });
    expect(recipes.length).toBe(1);
  });

  it("filters by provider when set", () => {
    const recipes = loadRecipes({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["ecs", "fargate", "alb", "autoscaling"],
      query: "ecs fargate alb autoscaling",
      provider: "cloudflare",
    });
    expect(recipes).toEqual([]);
  });

  it("returns recipes sorted alphabetically by id", () => {
    const recipes = loadRecipes({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["ecs", "fargate", "alb", "autoscaling"],
      query: "ecs fargate alb autoscaling",
    });
    const ids = recipes.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("returns pitfalls with severity preserved", () => {
    const recipes = loadRecipes({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["ecs", "fargate", "alb", "autoscaling"],
      query: "ecs fargate alb autoscaling",
      provider: "aws",
    });
    expect(recipes[0]?.pitfalls).toHaveLength(1);
    expect(recipes[0]?.pitfalls[0]?.severity).toBe("error");
  });

  it("no triggers fired → []", () => {
    const recipes = loadRecipes({
      bundleRoot: FIXTURE_ROOT,
      tokens: ["totally-unrelated"],
      query: "totally unrelated query",
    });
    expect(recipes).toEqual([]);
  });
});

describe("loadRecipes — empty / missing dirs", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-rec-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("missing recipes/ dir → []", () => {
    expect(loadRecipes({ bundleRoot: tmp, tokens: [], query: "" })).toEqual([]);
  });

  it("empty recipes/ dir → []", () => {
    fs.mkdirSync(path.join(tmp, "recipes"));
    expect(loadRecipes({ bundleRoot: tmp, tokens: [], query: "" })).toEqual([]);
  });

  it("malformed TOML is skipped (no throw)", () => {
    fs.mkdirSync(path.join(tmp, "recipes"));
    fs.writeFileSync(path.join(tmp, "recipes", "bad.toml"), "this is not [valid toml");
    expect(loadRecipes({ bundleRoot: tmp, tokens: [], query: "" })).toEqual([]);
  });
});
