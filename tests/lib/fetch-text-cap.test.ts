// Reproduces F-010 (rollup #82, code-review/registry):
// `fetchText` did not cap response size before parsing/signature-verifying.
// A hostile mirror could pin memory by streaming a multi-GB body.
//
// We assert the registry catalog fetch path rejects oversized bodies
// with ArtifactCorrupt before signature verification happens.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchTextWithCap } from "../../src/lib/fetch-with-timeout.js";

describe("fetchTextWithCap", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      const total = 4 * 1024 * 1024; // 4 MiB
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-length": String(total),
      });
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      let written = 0;
      const pump = (): void => {
        while (written < total) {
          const ok = res.write(chunk);
          written += chunk.byteLength;
          if (!ok) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects bodies that exceed the cap with ArtifactCorrupt", async () => {
    await expect(
      fetchTextWithCap(`http://127.0.0.1:${port}/`, { maxBytes: 1024 * 1024 }),
    ).rejects.toMatchObject({ kind: "ArtifactCorrupt" });
  });

  it("returns the body when within the cap", async () => {
    // Use a 16 MiB cap to allow the 4 MiB body through.
    const text = await fetchTextWithCap(`http://127.0.0.1:${port}/`, {
      maxBytes: 16 * 1024 * 1024,
    });
    expect(text.length).toBe(4 * 1024 * 1024);
  });
});
