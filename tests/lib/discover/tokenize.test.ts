import { describe, expect, it } from "vitest";
import { tokenize, tokenizeWithAliases } from "../../../src/lib/discover/tokenize.js";

describe("tokenize", () => {
  it("lowercases and extracts word-ish tokens", () => {
    expect(tokenize("Create EC2 Instance!")).toEqual(expect.arrayContaining(["ec2", "instance"]));
  });

  it("filters NOISE words and short tokens", () => {
    const out = tokenize("how to create a thing on aws");
    expect(out).not.toContain("how");
    expect(out).not.toContain("to");
    expect(out).not.toContain("a");
    expect(out).not.toContain("on");
  });

  it("expands TOKEN_EXPANSIONS", () => {
    const out = tokenize("eip");
    expect(out).toEqual(expect.arrayContaining(["eip", "elastic_ip"]));
  });

  it("strips canonical provider name AND each space-split component (closes F25)", () => {
    // mongodb-atlas → strips both "mongodb" and "atlas"
    const out = tokenize("mongodb atlas user", "mongodb-atlas");
    expect(out).not.toContain("mongodb");
    expect(out).not.toContain("atlas");
    expect(out).toContain("user");
  });

  it("strips collapsed canonical name (no hyphens)", () => {
    const out = tokenize("mongodbatlas user", "mongodb-atlas");
    expect(out).not.toContain("mongodbatlas");
    expect(out).toContain("user");
  });

  it("dedups while preserving insertion order", () => {
    const out = tokenize("alb alb alb");
    const albCount = out.filter((t) => t === "alb").length;
    expect(albCount).toBe(1);
  });

  it("handles k8s → kubernetes + container", () => {
    const out = tokenize("k8s deployment");
    expect(out).toEqual(expect.arrayContaining(["k8s", "kubernetes", "container", "deployment"]));
  });
});

describe("tokenizeWithAliases — phrase rewrites BEFORE token splitting", () => {
  it("matches alias phrase and appends the alias to tokens", () => {
    const result = tokenizeWithAliases(
      "I want to protect from bots on my site",
      "cloudflare",
      {
        aliases: [
          {
            phrase: "protect from bots",
            alias: "bot_protection",
            resources: ["cloudflare_bot_management"],
            provider: "cloudflare",
          },
        ],
      },
    );
    expect(result.aliasMatches).toHaveLength(1);
    expect(result.tokens).toContain("bot_protection");
  });

  it("returns empty aliasMatches when nothing fires", () => {
    const result = tokenizeWithAliases("create an s3 bucket", "aws", {
      aliases: [
        {
          phrase: "protect from bots",
          alias: "bot_protection",
          resources: [],
          provider: "cloudflare",
        },
      ],
    });
    expect(result.aliasMatches).toHaveLength(0);
  });
});
