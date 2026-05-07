import { describe, it, expect } from "vitest";
import { onRequest } from "../src/middleware";

/**
 * Why: the dashboard ships with no defense-in-depth response headers.
 * Add a thin Astro middleware that sets:
 *   - Content-Security-Policy (with rsms.me allow + 'unsafe-inline' TODO)
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Permissions-Policy (minimal — disable camera/mic/geolocation)
 */
describe("security headers middleware", () => {
  async function run(): Promise<Response> {
    const ctx = {
      url: new URL("https://cli-evals.vegastack.com/"),
      request: new Request("https://cli-evals.vegastack.com/"),
    } as Parameters<typeof onRequest>[0];
    return onRequest(ctx, async () => new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
  }

  it("sets X-Content-Type-Options: nosniff", async () => {
    const r = await run();
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sets a strict Referrer-Policy", async () => {
    const r = await run();
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets a minimal Permissions-Policy", async () => {
    const r = await run();
    const pp = r.headers.get("permissions-policy") ?? "";
    expect(pp).toMatch(/camera=\(\)/);
    expect(pp).toMatch(/microphone=\(\)/);
    expect(pp).toMatch(/geolocation=\(\)/);
  });

  it("sets a Content-Security-Policy that allows the rsms.me Inter stylesheet", async () => {
    const r = await run();
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp.length).toBeGreaterThan(0);
    expect(csp).toMatch(/default-src/);
    // External Inter font CSS + woff
    expect(csp).toMatch(/rsms\.me/);
    // No object/embed allowed
    expect(csp).toMatch(/object-src 'none'/);
    // frame-ancestors locked down
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  it("does not clobber existing content-type", async () => {
    const r = await run();
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
  });
});
