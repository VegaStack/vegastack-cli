import * as http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchWithTimeout } from "../../src/lib/fetch-with-timeout.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
          for (const sock of (s as unknown as { _connections?: unknown }) && []) void sock;
        }),
    ),
  );
});

async function hangingServer(): Promise<{ url: string }> {
  const server = http.createServer(() => {
    /* never respond */
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("no address");
  return { url: `http://127.0.0.1:${addr.port}` };
}

describe("fetchWithTimeout", () => {
  it("aborts a hung request within the timeout window", async () => {
    const { url } = await hangingServer();
    const t0 = Date.now();
    await expect(fetchWithTimeout(url, { timeoutMs: 200 })).rejects.toMatchObject({
      kind: "NetworkError",
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2_000);
  });

  it("returns the response when the server responds in time", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (typeof addr !== "object" || addr === null) throw new Error("no address");
    const url = `http://127.0.0.1:${addr.port}`;
    const r = await fetchWithTimeout(url, { timeoutMs: 2_000 });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok");
  });

  it("honours VEGASTACK_FETCH_TIMEOUT_MS env override when no explicit timeout passed", async () => {
    const prev = process.env.VEGASTACK_FETCH_TIMEOUT_MS;
    process.env.VEGASTACK_FETCH_TIMEOUT_MS = "150";
    try {
      const { url } = await hangingServer();
      await expect(fetchWithTimeout(url)).rejects.toMatchObject({ kind: "NetworkError" });
    } finally {
      if (prev === undefined) delete process.env.VEGASTACK_FETCH_TIMEOUT_MS;
      else process.env.VEGASTACK_FETCH_TIMEOUT_MS = prev;
    }
  });
});
