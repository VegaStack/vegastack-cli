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
        // Floor we want to maintain. Tighten as the suite grows.
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },

    // Snapshot dir co-located with each test.
    resolveSnapshotPath: (testPath, snapExt) =>
      testPath.replace(/\.test\.ts$/, `.test${snapExt}`),
  },
});
