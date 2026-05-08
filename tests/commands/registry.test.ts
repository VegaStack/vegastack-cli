import { beforeEach, describe, expect, it, vi } from "vitest";

const registryMocks = vi.hoisted(() => ({
  allInstalledRegistryEntryNames: vi.fn(),
  ensureProjectInitialized: vi.fn(),
  listPublishedRegistryEntryStatuses: vi.fn(),
  readProjectRegistryEntryNames: vi.fn(),
  syncRegistryEntry: vi.fn(),
}));

const logMocks = vi.hoisted(() => ({
  json: vi.fn(),
  ok: vi.fn(),
  printError: vi.fn(() => 1),
}));

vi.mock("../../src/lib/registry.js", () => registryMocks);
vi.mock("../../src/lib/log.js", () => ({
  log: {
    json: logMocks.json,
    ok: logMocks.ok,
  },
  printError: logMocks.printError,
}));

describe("registry command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registryMocks.syncRegistryEntry.mockResolvedValue(undefined);
  });

  it("lists published registry entries as JSON", async () => {
    registryMocks.listPublishedRegistryEntryStatuses.mockResolvedValue([
      { name: "docker", installed: true, selected: true, title: "Docker", shape: "registry-entry" },
    ]);
    const { runRegistryList } = await import("../../src/commands/registry.js");

    await expect(runRegistryList({ json: true })).resolves.toBe(0);
    expect(logMocks.json).toHaveBeenCalledWith({
      registry: [
        {
          name: "docker",
          installed: true,
          selected: true,
          title: "Docker",
          shape: "registry-entry",
        },
      ],
    });
  });

  it("updates an explicit validated entry", async () => {
    const { runRegistryUpdate } = await import("../../src/commands/registry.js");

    await expect(
      runRegistryUpdate({ entry: "github-actions", force: true, json: true }),
    ).resolves.toBe(0);
    expect(registryMocks.syncRegistryEntry).toHaveBeenCalledWith("github-actions", { force: true });
    expect(logMocks.json).toHaveBeenCalledWith({ ok: true, updated: ["github-actions"] });
  });

  it("updates selected project entries in sorted order by default", async () => {
    registryMocks.readProjectRegistryEntryNames.mockReturnValue(["terraform", "docker"]);
    const { runRegistryUpdate } = await import("../../src/commands/registry.js");

    await expect(runRegistryUpdate({ json: true })).resolves.toBe(0);
    expect(registryMocks.ensureProjectInitialized).toHaveBeenCalledWith(process.cwd());
    expect(syncedEntries()).toEqual(["docker", "terraform"]);
  });

  it("updates all installed entries without requiring project initialization", async () => {
    registryMocks.allInstalledRegistryEntryNames.mockReturnValue(["terraform", "aws"]);
    const { runRegistryUpdate } = await import("../../src/commands/registry.js");

    await expect(runRegistryUpdate({ all: true, json: true })).resolves.toBe(0);
    expect(registryMocks.ensureProjectInitialized).not.toHaveBeenCalled();
    expect(syncedEntries()).toEqual(["aws", "terraform"]);
  });

  it("rejects traversal-shaped registry entry names at the command boundary", async () => {
    const { validateRegistryEntryName, runRegistryUpdate } =
      await import("../../src/commands/registry.js");

    expect(() => validateRegistryEntryName("../terraform")).toThrow(/valid registry entry name/);
    await expect(runRegistryUpdate({ entry: "../terraform" })).resolves.toBe(1);
    expect(registryMocks.syncRegistryEntry).not.toHaveBeenCalled();
    expect(logMocks.printError).toHaveBeenCalled();
  });
});

function syncedEntries(): string[] {
  return registryMocks.syncRegistryEntry.mock.calls.map((call) => String(call[0]));
}
