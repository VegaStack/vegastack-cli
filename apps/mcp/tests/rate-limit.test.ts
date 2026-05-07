// Reproduces audit issue #77: MCP worker had no rate limiting.
//
// We import the rate-limit middleware directly (Worker-native APIs only —
// no Node fs/child_process). Each test creates a fresh limiter so state
// doesn't leak between cases.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { createRateLimiter } from "../src/middleware.js";

function ipReq(ip: string, colo = "iad"): Request {
  return new Request("https://mcp.example.com/mcp", {
    method: "POST",
    headers: { "cf-connecting-ip": ip, "cf-ray": `r-${colo}` },
  });
}

describe("rate-limit middleware (#77)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("allows up to N requests per minute and 429s the (N+1)th from the same IP", async () => {
    const limit = 5;
    const rl = createRateLimiter({ limitPerMin: limit });

    for (let i = 0; i < limit; i++) {
      const r = await rl(ipReq("1.2.3.4"));
      expect(r, `request ${i + 1} should be allowed`).toBeNull();
    }
    const blocked = await rl(ipReq("1.2.3.4"));
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    const body = await blocked!.json();
    expect(body).toMatchObject({ error: "rate_limited" });
    expect(blocked!.headers.get("Retry-After")).toBeTruthy();
  });

  it("isolates buckets per IP", async () => {
    const rl = createRateLimiter({ limitPerMin: 2 });
    expect(await rl(ipReq("1.1.1.1"))).toBeNull();
    expect(await rl(ipReq("1.1.1.1"))).toBeNull();
    expect((await rl(ipReq("1.1.1.1")))!.status).toBe(429);
    // Different IP should still get a fresh bucket.
    expect(await rl(ipReq("2.2.2.2"))).toBeNull();
  });

  it("refills the bucket after the window elapses", async () => {
    const rl = createRateLimiter({ limitPerMin: 2 });
    expect(await rl(ipReq("9.9.9.9"))).toBeNull();
    expect(await rl(ipReq("9.9.9.9"))).toBeNull();
    expect((await rl(ipReq("9.9.9.9")))!.status).toBe(429);
    // Advance past the 60s window.
    vi.advanceTimersByTime(61_000);
    expect(await rl(ipReq("9.9.9.9"))).toBeNull();
  });

  it("falls back to a global bucket when cf-connecting-ip is missing", async () => {
    const rl = createRateLimiter({ limitPerMin: 1 });
    const req = new Request("https://mcp.example.com/mcp", { method: "POST" });
    expect(await rl(req)).toBeNull();
    expect((await rl(req))!.status).toBe(429);
  });
});
