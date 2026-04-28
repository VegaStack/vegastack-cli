import { afterEach, describe, expect, it } from "vitest";
import { clearBundleCaches } from "../../src/lib/r2-bundle.js";
import { handleTfGetRecipe, parseRecipeToml } from "../../src/tools/tf_get_recipe.js";
import { makeEnv, SEED_BASIC } from "../_fixtures.js";

afterEach(() => clearBundleCaches());

describe("tf_get_recipe", () => {
  it("parses providers, triggers, scaffold, pitfalls", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTfGetRecipe(env, { id: "scalable-backend-aws-ecs-fargate" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.id).toBe("scalable-backend-aws-ecs-fargate");
    expect(parsed.providers).toEqual(["aws", "datadog"]);
    expect(parsed.scaffold_hcl).toContain('resource "aws_ecs_cluster"');
    expect(parsed.pitfalls.length).toBe(1);
    expect(parsed.pitfalls[0].severity).toBe("warn");
    // both phrase and tokens triggers
    const hasPhrase = parsed.triggers.some((t: { phrase?: string }) => t.phrase === "scalable backend");
    expect(hasPhrase).toBe(true);
  });

  it("returns error envelope for missing recipe", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleTfGetRecipe(env, { id: "nope" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
    expect(parsed.code).toBe("NotFound");
  });

  it("parseRecipeToml is idempotent on minimal input", () => {
    const r = parseRecipeToml("empty", 'providers = []\nscaffold_hcl = ""');
    expect(r.providers).toEqual([]);
    expect(r.scaffold_hcl).toBe("");
    expect(r.pitfalls).toEqual([]);
  });
});
