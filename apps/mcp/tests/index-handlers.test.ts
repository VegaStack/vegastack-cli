// Audit F-001 (code-review/mcp): MCP transport handlers must be hoisted to
// module scope, not allocated per request. We verify this structurally by
// reading src/index.ts and asserting that `VegaStackMcp.serve(` /
// `VegaStackMcp.serveSSE(` appear at module scope (top-level), not inside
// the `fetch` handler.

// Vite's `?raw` query loads the file contents as a string at test time —
// no node:fs / @types/node required.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - vite ?raw query has no static type
import indexSrc from "../src/index.ts?raw";
import { describe, expect, it } from "vitest";

const src = indexSrc as string;

describe("MCP handler hoisting (F-001)", () => {
  it("constructs serve()/serveSSE() once at module scope", () => {
    const serveCount = (src.match(/VegaStackMcp\.serve\(/g) ?? []).length;
    const sseCount = (src.match(/VegaStackMcp\.serveSSE\(/g) ?? []).length;
    expect(serveCount).toBe(1);
    expect(sseCount).toBe(1);
  });

  it("does not allocate a transport handler inside the fetch loop", () => {
    const fetchMatch = src.match(/export default \{[\s\S]*?\} satisfies ExportedHandler/);
    expect(fetchMatch).not.toBeNull();
    const body = fetchMatch![0];
    expect(body).not.toContain("VegaStackMcp.serve(");
    expect(body).not.toContain("VegaStackMcp.serveSSE(");
  });
});
