import { afterEach, describe, expect, it } from "vitest";
import { clearRegistryCaches } from "../../src/lib/r2-registry.js";
import {
  handleRegistryGetKnowledgeCard,
  parseKnowledgeCard,
} from "../../src/tools/registry_get_knowledge_card.js";
import { makeEnv, SEED_BASIC } from "../_fixtures.js";

afterEach(() => clearRegistryCaches());

describe("registry_get_knowledge_card", () => {
  it("parses frontmatter into a KnowledgeCard", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleRegistryGetKnowledgeCard(env, { id: "aws-s3-native-state-locking" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.id).toBe("aws-s3-native-state-locking");
    expect(parsed.title).toBe("S3 native state locking (no DynamoDB)");
    expect(parsed.providers).toEqual(["aws"]);
    expect(parsed.overrides_training).toBe(true);
    expect(parsed.body).toContain("use_lockfile");
    // triggers parsed
    expect(parsed.triggers.length).toBeGreaterThanOrEqual(1);
  });

  it("returns error envelope for missing card", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleRegistryGetKnowledgeCard(env, { id: "does-not-exist" });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
    expect(parsed.code).toBe("NotFound");
  });

  it("rejects malformed ids before fetching", async () => {
    const env = makeEnv(SEED_BASIC);
    const out = await handleRegistryGetKnowledgeCard(env, { id: "../etc/passwd" } as { id: string });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.status).toBe("error");
    expect(parsed.code).toBe("BadRequest");
  });

  it("parseKnowledgeCard handles missing frontmatter gracefully", () => {
    const card = parseKnowledgeCard("plain", "Just a body, no frontmatter.");
    expect(card.id).toBe("plain");
    expect(card.title).toBe("plain");
    expect(card.body).toContain("Just a body");
  });
});
