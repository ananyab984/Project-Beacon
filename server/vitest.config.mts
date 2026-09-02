import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname, ".."),
  resolve: {
    alias: {
      "@server": resolve(__dirname, "src"),
      "@server-root": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/server/src/**/*.test.ts"],
    // webhook.test.ts predates this suite -- a hand-rolled manual script
    // (console.assert + a self-invoking runner) that hits a live DB, not a
    // real Vitest file (no describe/it blocks). Migrating it to mocked
    // Prisma is tracked as Phase 3 backlog (Unipile reply tracking), not
    // silently broken here.
    exclude: ["**/node_modules/**", "tests/server/src/__tests__/webhook.test.ts"],
    setupFiles: ["server/src/__tests__/setup.ts"],
    testTimeout: 15000,
    // Disabling cross-file parallelism narrows (but doesn't fully eliminate)
    // a rare, non-reproducible-in-isolation flake seen under this suite's
    // full run (roughly 1-in-4 to 1-in-8 runs, landing on a different,
    // otherwise-100%-reliable-standalone test each time -- confirmed not a
    // real logic bug: every test that has ever failed here passes
    // consistently both alone and via `-t`). `retry` below is the honest
    // safety net for whatever environment-level nondeterminism remains.
    fileParallelism: false,
    retry: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./server/coverage",
      // Broken out per feature area (not one aggregate number) so gaps are
      // visible at a glance -- see the coverage summary deliverable.
      include: [
        "server/src/lib/**",
        "server/src/services/**",
        "server/src/routes/**",
        "server/src/jobs/**",
        "server/src/drafting/**",
        "server/src/middleware/**",
      ],
      exclude: [
        "server/src/**/*.test.ts",
        "server/src/__tests__/**",
        "server/src/index.ts",
        "server/src/scripts/**",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
