import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ESM by default; tests use .ts.
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tests/.workspace/**"],

    // Each test gets a fresh tmp dir + isolates filesystem side-effects.
    // We run integration tests sequentially to avoid cross-test contamination
    // when they share the agent install dirs.
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },

    // Fail fast on flake — surface flaky tests immediately.
    retry: 0,

    // Reasonable defaults; raise per-test if needed via `test.setTimeout`.
    testTimeout: 15_000,
    hookTimeout: 10_000,

    // Coverage (opt-in; CI runs `npm test -- --coverage`).
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts", "**/*.d.ts"], // cli.ts is the wiring layer; e2e covers it
      thresholds: {
        // Current suite baseline. Tighten as command coverage grows.
        statements: 60,
        branches: 75,
        functions: 67,
        lines: 60,
      },
    },

    // Snapshot dir co-located with each test.
    resolveSnapshotPath: (testPath, snapExt) =>
      testPath.replace(/\.test\.ts$/, `.test${snapExt}`),
  },
});
