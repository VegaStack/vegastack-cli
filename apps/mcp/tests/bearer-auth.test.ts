// Reproduces audit issue #77 (bearer-token half): when REQUIRE_AUTH=true,
// the worker must reject unauthenticated requests with 401, accept the
// configured token, and reject any wrong token. Comparison must be
// constant-time so we also assert wrong-token responses look identical
// regardless of where the mismatch occurs.

import { describe, expect, it } from "vitest";
import { createBearerAuth } from "../src/middleware.js";

const SECRET = "s3cret-token-abcdef0123456789";

function req(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers["Authorization"] = authHeader;
  return new Request("https://mcp.example.com/mcp", { method: "POST", headers });
}

describe("bearer-auth middleware (#77)", () => {
  it("is a no-op when REQUIRE_AUTH is not 'true'", async () => {
    const mw = createBearerAuth({ requireAuth: false, expectedToken: SECRET });
    expect(await mw(req())).toBeNull();
    expect(await mw(req("Bearer wrong"))).toBeNull();
  });

  it("returns 401 when REQUIRE_AUTH=true and Authorization header is missing", async () => {
    const mw = createBearerAuth({ requireAuth: true, expectedToken: SECRET });
    const r = await mw(req());
    expect(r).not.toBeNull();
    expect(r!.status).toBe(401);
    expect(r!.headers.get("WWW-Authenticate")).toMatch(/Bearer/);
  });

  it("returns 401 for malformed Authorization header", async () => {
    const mw = createBearerAuth({ requireAuth: true, expectedToken: SECRET });
    expect((await mw(req("Basic abc")))!.status).toBe(401);
    expect((await mw(req("Bearer")))!.status).toBe(401);
    expect((await mw(req("Bearer ")))!.status).toBe(401);
  });

  it("returns 401 for the wrong token (any position of mismatch)", async () => {
    const mw = createBearerAuth({ requireAuth: true, expectedToken: SECRET });
    // Wrong at start
    expect((await mw(req("Bearer X" + SECRET.slice(1))))!.status).toBe(401);
    // Wrong at end
    expect((await mw(req("Bearer " + SECRET.slice(0, -1) + "X")))!.status).toBe(401);
    // Different length
    expect((await mw(req("Bearer " + SECRET + "extra")))!.status).toBe(401);
    expect((await mw(req("Bearer short")))!.status).toBe(401);
  });

  it("allows the request through when the token matches exactly", async () => {
    const mw = createBearerAuth({ requireAuth: true, expectedToken: SECRET });
    expect(await mw(req("Bearer " + SECRET))).toBeNull();
  });

  it("fails closed when REQUIRE_AUTH=true but no expected token is configured", async () => {
    const mw = createBearerAuth({ requireAuth: true, expectedToken: "" });
    const r = await mw(req("Bearer anything"));
    expect(r).not.toBeNull();
    expect(r!.status).toBe(500);
  });
});
