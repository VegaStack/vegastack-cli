import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_BYTES,
  clearKnowledgeCache,
  loadKnowledge,
} from "../../../src/lib/discover/knowledge.js";

describe("loadKnowledge — mtime cache + size guard", () => {
  let tmp: string;
  let dir: string;
  let card: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-knowledge-cache-"));
    dir = path.join(tmp, "knowledge");
    fs.mkdirSync(dir);
    card = path.join(dir, "a.md");
    fs.writeFileSync(card, "---\nid: a\ntitle: A\ntriggers:\n  - phrase: hello\n---\nbody\n");
    clearKnowledgeCache();
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    clearKnowledgeCache();
  });

  it("returns cached parse when file content changes but mtime is preserved", () => {
    const fixed = Math.floor(Date.now() / 1000);
    fs.utimesSync(card, fixed, fixed);
    const args = { terraformRoot: tmp, tokens: ["hello"], query: "hello" };
    const a = loadKnowledge(args);
    expect(a[0]!.title).toBe("A");
    fs.writeFileSync(card, "---\nid: a\ntitle: ROTATED\ntriggers:\n  - phrase: hello\n---\nbody\n");
    fs.utimesSync(card, fixed, fixed);
    const b = loadKnowledge(args);
    expect(b[0]!.title).toBe("A");
  });

  it("recomputes when mtime changes", () => {
    const a = loadKnowledge({ terraformRoot: tmp, tokens: ["hello"], query: "hello" });
    expect(a[0]!.title).toBe("A");
    const future = new Date(Date.now() + 5_000);
    fs.writeFileSync(card, "---\nid: a\ntitle: B\ntriggers:\n  - phrase: hello\n---\nbody\n");
    fs.utimesSync(card, future, future);
    const b = loadKnowledge({ terraformRoot: tmp, tokens: ["hello"], query: "hello" });
    expect(b[0]!.title).toBe("B");
  });

  it("skips cards larger than MAX_KNOWLEDGE_BYTES", () => {
    const huge = path.join(dir, "huge.md");
    const front = "---\nid: huge\ntitle: H\ntriggers:\n  - phrase: huge\n---\n";
    fs.writeFileSync(huge, front + "x".repeat(MAX_KNOWLEDGE_BYTES + 10));
    const cards = loadKnowledge({ terraformRoot: tmp, tokens: ["huge"], query: "huge" });
    expect(cards.find((c) => c.id === "huge")).toBeUndefined();
  });
});
