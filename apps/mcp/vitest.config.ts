// vitest config for the vegastack-mcp Worker.
//
// Web-research notes (2026-04-28):
//   * @cloudflare/vitest-pool-workers@0.15.0 is the current stable.
//   * Pool-workers requires vitest@4.x and a wrangler config reference.
//   * For unit-only tests that don't touch the actual Workers runtime (R2, DO),
//     we fall back to the default node pool with mocked Env. The pool-workers
//     pool is wired up but the unit tests below don't depend on runtime.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true,
    environment: "node",
  },
});
