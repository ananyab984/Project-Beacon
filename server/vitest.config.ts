import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // webhook.test.ts predates this suite -- a hand-rolled manual script
    // (console.assert + a self-invoking runner) that hits a live DB, not a
    // real Vitest file (no describe/it blocks). Migrating it to mocked
    // Prisma is tracked as Phase 3 backlog (Unipile reply tracking), not
    // silently broken here.
    exclude: ["**/node_modules/**", "src/__tests__/webhook.test.ts"],
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      // Broken out per feature area (not one aggregate number) so gaps are
      // visible at a glance -- see the coverage summary deliverable.
      include: [
        "src/lib/**",
        "src/services/**",
        "src/routes/**",
        "src/jobs/**",
        "src/drafting/**",
        "src/middleware/**",
      ],
      exclude: [
        "src/**/*.test.ts",
        "src/__tests__/**",
        "src/index.ts",
        "src/scripts/**",
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
