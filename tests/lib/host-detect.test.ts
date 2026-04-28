// Pure-function tests only. The detection functions read $PATH and HOME,
// which we can't override mid-process without polluting global state, so we
// only assert structural invariants that hold regardless of the host machine.

import { describe, expect, it } from "vitest";
import { detectHost } from "../../src/lib/host-detect.js";

describe("detectHost", () => {
  it("returns a HostStatus for every known agent", () => {
    for (const a of ["claude-code", "codex", "cursor", "gemini", "continue", "aider"]) {
      const r = detectHost(a);
      expect(r.agent).toBe(a);
      expect(typeof r.installed).toBe("boolean");
      expect(typeof r.evidence).toBe("string");
      expect(r.evidence.length).toBeGreaterThan(0);
    }
  });

  it("flags unknown agents as not installed", () => {
    const r = detectHost("nonexistent-agent");
    expect(r.installed).toBe(false);
    expect(r.evidence).toBe("unknown agent");
  });

  it("evidence string mentions PATH or a config path on success", () => {
    // We can't force any agent to be installed, but if any happens to be
    // present on the dev machine, the evidence should point at PATH or a path.
    const any = detectHost("claude-code");
    if (any.installed) {
      expect(any.evidence).toMatch(/PATH|\//);
    }
  });
});
