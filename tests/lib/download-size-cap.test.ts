import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { streamDownloadVerified } from "../../src/lib/fetch-with-timeout.js";

let server: http.Server | null = null;
let tmp = "";

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vegastack-download-cap-"));
});

async function listenStreaming(producer: (res: http.ServerResponse) => void): Promise<string> {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    producer(res);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server!.address();
  if (typeof addr !== "object" || addr === null) throw new Error("no address");
  return `http://127.0.0.1:${addr.port}/`;
}

describe("streamDownloadVerified", () => {
  it("aborts when streamed body exceeds maxBytes", async () => {
    const url = await listenStreaming((res) => {
      // stream way more than the cap, slowly, so the abort can fire
      let written = 0;
      const interval = setInterval(() => {
        if (!res.write(Buffer.alloc(1024, 0))) {
          // backpressure — wait
        }
        written += 1024;
        if (written > 1_000_000) {
          clearInterval(interval);
          res.end();
        }
      }, 1);
    });
    const target = path.join(tmp, "out.bin");
    await expect(
      streamDownloadVerified(url, target, { maxBytes: 4096 }),
    ).rejects.toMatchObject({ kind: "ArtifactCorrupt" });
    expect(fs.existsSync(target)).toBe(false);
  });

  it("writes the file and verifies sha256 + exact size when expected", async () => {
    const payload = Buffer.from("vegastack-payload");
    const sha = crypto.createHash("sha256").update(payload).digest("hex");
    const url = await listenStreaming((res) => {
      res.end(payload);
    });
    const target = path.join(tmp, "ok.bin");
    await streamDownloadVerified(url, target, {
      expectedSha: sha,
      expectedBytes: payload.byteLength,
      maxBytes: 1024,
    });
    expect(fs.readFileSync(target)).toEqual(payload);
  });

  it("rejects on checksum mismatch and removes the partial file", async () => {
    const payload = Buffer.from("hello");
    const url = await listenStreaming((res) => {
      res.end(payload);
    });
    const target = path.join(tmp, "bad.bin");
    await expect(
      streamDownloadVerified(url, target, {
        expectedSha: "0".repeat(64),
        expectedBytes: payload.byteLength,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ kind: "ChecksumMismatch" });
    expect(fs.existsSync(target)).toBe(false);
  });
});
