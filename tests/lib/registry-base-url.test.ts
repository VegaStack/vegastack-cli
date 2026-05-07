// Reproduces #72: VEGASTACK_REGISTRY_URL must be validated against an https
// allowlist. Without this guard, a malicious env (CI secret leak, devcontainer,
// shell rc) can downgrade the catalog fetch to http:// or redirect it to an
// attacker-controlled host before sigstore verification runs on the response.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRegistryBaseUrl } from "../../src/lib/registry.js";
import { VegaStackError } from "../../src/lib/errors.js";

const ENV_KEYS = ["VEGASTACK_REGISTRY_URL", "VEGASTACK_REGISTRY_DEV_TRUST"] as const;

describe("resolveRegistryBaseUrl (#72)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns the default URL when env is unset", () => {
    expect(resolveRegistryBaseUrl()).toBe("https://cli-registry.vegastack.com/cli");
  });

  it("accepts the canonical https registry host", () => {
    process.env.VEGASTACK_REGISTRY_URL = "https://cli-registry.vegastack.com/cli/";
    expect(resolveRegistryBaseUrl()).toBe("https://cli-registry.vegastack.com/cli");
  });

  it("rejects http:// (downgrade attack)", () => {
    process.env.VEGASTACK_REGISTRY_URL = "http://cli-registry.vegastack.com/cli";
    expect(() => resolveRegistryBaseUrl()).toThrow(VegaStackError);
    try {
      resolveRegistryBaseUrl();
    } catch (e) {
      expect((e as VegaStackError).kind).toBe("ValidationError");
    }
  });

  it("rejects file:// scheme", () => {
    process.env.VEGASTACK_REGISTRY_URL = "file:///etc/passwd";
    expect(() => resolveRegistryBaseUrl()).toThrow(VegaStackError);
  });

  it("rejects an arbitrary https host not in the allowlist", () => {
    process.env.VEGASTACK_REGISTRY_URL = "https://evil.example.com/cli";
    expect(() => resolveRegistryBaseUrl()).toThrow(VegaStackError);
  });

  it("rejects a malformed URL", () => {
    process.env.VEGASTACK_REGISTRY_URL = "not a url";
    expect(() => resolveRegistryBaseUrl()).toThrow(VegaStackError);
  });

  it("allows arbitrary URLs when VEGASTACK_REGISTRY_DEV_TRUST=1", () => {
    process.env.VEGASTACK_REGISTRY_URL = "http://127.0.0.1:1";
    process.env.VEGASTACK_REGISTRY_DEV_TRUST = "1";
    expect(resolveRegistryBaseUrl()).toBe("http://127.0.0.1:1");
  });

  it("strips trailing slashes", () => {
    process.env.VEGASTACK_REGISTRY_URL = "https://cli-registry.vegastack.com/cli///";
    expect(resolveRegistryBaseUrl()).toBe("https://cli-registry.vegastack.com/cli");
  });
});
