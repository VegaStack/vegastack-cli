import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ESM by default; tests use .ts.
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tests/.workspace/**"],

    // Each test gets a fresh tmp dir + isolates filesystem side-effects.
    // We run integration tests sequentially to avoid cross-test contamination
    // when they share the agent install dirs.
    //
    // singleFork: true is required to keep the cli-help integration suite
    // (which spawns `node dist/cli.js` children) stable. With singleFork:false
    // parallel forks contend on shared filesystem state and the suite fails
    // non-deterministically — see issue #60 and the parallel-safety regression
    // test in tests/integration/cli-help.flake.test.ts.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },

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
        // Global floor — pinned just below current suite levels so a
        // regression (a deleted test, a new untested branch) trips the gate.
        // The categories.md §7 target is ≥75% lines / ≥80% branches overall
        // and ≥85% lines on `src/lib/`; we are tracking toward that as
        // command-level smoke coverage lands (audit rollup-I, F-002/F-004/F-005).
        // Documented deviation: a handful of commands (`init`, `doctor`,
        // `update`, `skills`, `terraform-discover`) and deep registry install
        // paths still need more tests —
        // see issue #82 test-coverage findings.
        statements: 72,
        branches: 75,
        functions: 80,
        lines: 72,
      },
    },

    // Snapshot dir co-located with each test.
    resolveSnapshotPath: (testPath, snapExt) =>
      testPath.replace(/\.test\.ts$/, `.test${snapExt}`),
  },
});
