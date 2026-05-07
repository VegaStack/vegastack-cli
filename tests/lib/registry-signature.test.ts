import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SIGNATURE_FILE = path.join(REPO_ROOT, "src", "lib", "registry-signature.ts");

describe("registry-signature module — architectural", () => {
  it("does NOT statically import sigstore at the top of the module (perf — see #84)", () => {
    // Why: sigstore is ~50ms to load on warm machines and ~80ms on cold ones.
    // It is only used by `vegastack registry update` and `vegastack update`,
    // not by `--help`, `--version`, or any other command. A static import at
    // the top of registry-signature.ts pulls sigstore into the cold-start
    // dependency graph for every CLI invocation. The module must keep its
    // sigstore reference behind a dynamic import inside the verify function.
    const src = fs.readFileSync(SIGNATURE_FILE, "utf8");
    // Strip line comments so we don't false-positive on `// import ... from "sigstore"` examples
    const stripped = src.replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/^import\s+.*from\s+["']sigstore["']/m);
  });
});

describe("verifyRegistryCatalogSignature — silent-disable warning (#58)", () => {
  const ORIGINAL_VERIFY = process.env.VEGASTACK_REGISTRY_VERIFY;
  const writes: string[] = [];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    writes.length = 0;
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;
    process.env.VEGASTACK_REGISTRY_VERIFY = "0";
  });
  afterEach(() => {
    process.stderr.write = originalWrite;
    if (ORIGINAL_VERIFY === undefined) delete process.env.VEGASTACK_REGISTRY_VERIFY;
    else process.env.VEGASTACK_REGISTRY_VERIFY = ORIGINAL_VERIFY;
  });

  it("emits a stderr warning when VEGASTACK_REGISTRY_VERIFY=0 disables sigstore verification", async () => {
    // Why: silent degradation of a security-critical control violates the
    // anti-bluff philosophy. When a user explicitly opts out of signature
    // verification, the CLI must say so (once, on stderr) so it appears in
    // logs and review trails.
    const mod = await import("../../src/lib/registry-signature.js");
    await mod.verifyRegistryCatalogSignature({
      catalogBytes: Buffer.from("anything"),
      signatureText: '{"placeholder": true}',
      catalogUrl: "https://example.invalid/catalog.json",
    });
    const all = writes.join("");
    expect(all).toMatch(/VEGASTACK_REGISTRY_VERIFY/);
    expect(all).toMatch(/disabled|skipped|bypass/i);
  });
});
