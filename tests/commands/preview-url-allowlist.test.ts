import { describe, expect, it } from "vitest";
import { validatePreviewUrl } from "../../src/commands/preview.js";

describe("preview --url allowlist (SSRF guard)", () => {
  it("accepts http(s) loopback hosts", () => {
    for (const u of [
      "http://localhost:3000",
      "http://127.0.0.1:8080/",
      "http://[::1]:5173/",
      "https://localhost:4321",
    ]) {
      expect(() => validatePreviewUrl(u)).not.toThrow();
    }
  });

  it("rejects cloud-metadata link-local addresses", () => {
    expect(() => validatePreviewUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
      /SSRF|loopback|allow-private-host/i,
    );
  });

  it("rejects RFC1918 / private hosts and arbitrary internal hostnames", () => {
    expect(() => validatePreviewUrl("http://10.0.0.1/")).toThrow(/loopback|allow-private-host/i);
    expect(() => validatePreviewUrl("http://192.168.1.1/")).toThrow(/loopback|allow-private-host/i);
    expect(() => validatePreviewUrl("http://internal-jenkins/")).toThrow(
      /loopback|allow-private-host/i,
    );
  });

  it("rejects non-http(s) schemes (file://, gopher://, etc.)", () => {
    expect(() => validatePreviewUrl("file:///etc/passwd")).toThrow(/http\(s\)|protocol/i);
    expect(() => validatePreviewUrl("gopher://localhost/")).toThrow(/http\(s\)|protocol/i);
  });

  it("rejects malformed URL strings", () => {
    expect(() => validatePreviewUrl("not a url")).toThrow(/valid URL|http\(s\)/i);
  });

  it("allows non-loopback hosts only when allowPrivateHost=true", () => {
    expect(() => validatePreviewUrl("http://10.0.0.1/", { allowPrivateHost: true })).not.toThrow();
    expect(() =>
      validatePreviewUrl("http://internal-jenkins/", { allowPrivateHost: true }),
    ).not.toThrow();
  });
});
