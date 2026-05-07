import { describe, expect, it } from "vitest";
import { parseCommandArgv } from "../../src/commands/preview.js";

describe("preview --command tokenizer (no shell)", () => {
  it("splits a plain command into argv", () => {
    expect(parseCommandArgv("npm run dev")).toEqual(["npm", "run", "dev"]);
  });

  it("honours single and double quoted segments", () => {
    expect(parseCommandArgv('node -e "console.log(1)"')).toEqual([
      "node",
      "-e",
      "console.log(1)",
    ]);
    expect(parseCommandArgv("node -e 'a b c'")).toEqual(["node", "-e", "a b c"]);
  });

  it("refuses unquoted shell metacharacters that enable injection", () => {
    expect(() => parseCommandArgv("npm run dev; touch pwned")).toThrow(/shell metacharacter/i);
    expect(() => parseCommandArgv("npm run dev && touch pwned")).toThrow(/shell metacharacter/i);
    expect(() => parseCommandArgv("npm run dev | cat")).toThrow(/shell metacharacter/i);
    expect(() => parseCommandArgv("echo `whoami`")).toThrow(/shell metacharacter/i);
    expect(() => parseCommandArgv("echo $(whoami)")).toThrow(/shell metacharacter/i);
    expect(() => parseCommandArgv("npm run dev > /tmp/x")).toThrow(/shell metacharacter/i);
  });

  it("allows metacharacters inside quoted strings (passed literally to argv)", () => {
    expect(parseCommandArgv('node -e "process.stdout.write(\\"a;b\\")"')[2]).toContain(";");
  });

  it("rejects empty or whitespace-only commands", () => {
    expect(() => parseCommandArgv("")).toThrow();
    expect(() => parseCommandArgv("   ")).toThrow();
  });
});
