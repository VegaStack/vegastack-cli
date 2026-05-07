import { describe, expect, it, vi } from "vitest";
import { killPreviewChild } from "../../src/commands/preview.js";

interface FakeChild {
  pid: number | undefined;
  kill: (signal?: string | number) => boolean;
}

describe("killPreviewChild — process-group / taskkill semantics", () => {
  it("on POSIX, signals the negative pid (process group)", () => {
    if (process.platform === "win32") return;
    const seen: { pid: number; sig: string }[] = [];
    const origKill = process.kill.bind(process);
    (process as unknown as { kill: (pid: number, sig?: string | number) => true }).kill = (
      pid: number,
      sig?: string | number,
    ): true => {
      seen.push({ pid, sig: String(sig ?? "SIGTERM") });
      return true;
    };
    try {
      const child: FakeChild = { pid: 12345, kill: vi.fn(() => true) };
      killPreviewChild(child);
      expect(seen[0]?.pid).toBe(-12345);
      expect(seen[0]?.sig).toBe("SIGTERM");
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      process.kill = origKill;
    }
  });

  it("on POSIX, falls back to child.kill when process.kill throws", () => {
    if (process.platform === "win32") return;
    const origKill = process.kill.bind(process);
    (process as unknown as { kill: () => never }).kill = (): never => {
      throw new Error("ESRCH");
    };
    try {
      const childKill = vi.fn(() => true);
      const child: FakeChild = { pid: 99, kill: childKill };
      killPreviewChild(child);
      expect(childKill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      process.kill = origKill;
    }
  });

  it("when pid is missing, falls back to child.kill directly", () => {
    const childKill = vi.fn(() => true);
    const child: FakeChild = { pid: undefined, kill: childKill };
    killPreviewChild(child);
    expect(childKill).toHaveBeenCalledWith("SIGTERM");
  });
});
