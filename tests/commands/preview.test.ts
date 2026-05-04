import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPreview } from "../../src/commands/preview.js";
import { quickTunnelNotice } from "../../src/lib/cloudflared.js";
import { withTmpDir } from "../setup.js";

const originalCloudflared = process.env.VEGASTACK_CLOUDFLARED_BIN;

afterEach(() => {
  if (originalCloudflared === undefined) delete process.env.VEGASTACK_CLOUDFLARED_BIN;
  else process.env.VEGASTACK_CLOUDFLARED_BIN = originalCloudflared;
  vi.restoreAllMocks();
});

describe("preview command", () => {
  it("returns an existing local URL without starting a tunnel", async () => {
    const server = await listen();
    const out = captureStdout();
    try {
      const code = await runPreview({
        url: server.url,
        tunnel: false,
        tunnelName: "vegastack-preview",
        timeout: 2,
        json: true,
        yes: true,
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(out.text()) as { local_url: string; tunnel: null };
      expect(parsed.local_url).toBe(server.url);
      expect(parsed.tunnel).toBeNull();
    } finally {
      await server.close();
    }
  });

  it("parses a Cloudflare Quick Tunnel URL from cloudflared", async () => {
    await withTmpDir(async (dir) => {
      const fake = path.join(dir, "cloudflared");
      fs.writeFileSync(
        fake,
        [
          "#!/usr/bin/env node",
          "const args = process.argv.slice(2);",
          "if (args.includes('--version')) { console.log('cloudflared version test'); process.exit(0); }",
          "if (args[0] === 'tunnel' && args[1] === '--url') {",
          "  console.error('ready: https://unit-test.trycloudflare.com');",
          "  setTimeout(() => process.exit(0), 25);",
          "}",
          "setTimeout(() => process.exit(0), 25);",
          "",
        ].join("\n"),
      );
      fs.chmodSync(fake, 0o755);
      process.env.VEGASTACK_CLOUDFLARED_BIN = fake;

      const server = await listen();
      const out = captureStdout();
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const code = await runPreview({
          url: server.url,
          tunnel: true,
          tunnelName: "vegastack-preview",
          timeout: 2,
          json: true,
          yes: true,
        });
        expect(code).toBe(0);
        const parsed = JSON.parse(out.text()) as {
          tunnel: { mode: string; url: string; notice: string };
        };
        expect(parsed.tunnel.mode).toBe("quick");
        expect(parsed.tunnel.url).toBe("https://unit-test.trycloudflare.com");
        expect(parsed.tunnel.notice).toBe(quickTunnelNotice());
      } finally {
        await server.close();
      }
    });
  });
});

function captureStdout(): { text: () => string } {
  let text = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    text += chunk.toString();
    return true;
  });
  return { text: () => text };
}

async function listen(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
