import { defineConfig } from "vitest/config";

// Scoped test setup for the onboarding pre-fill link + webhook feature --
// colocated *.test.ts files next to their source, node environment (no DOM
// needed server-side). Deliberately independent of the separate, unmerged
// test-suite snapshot branch's tests/ convention; this is a minimal setup
// for this feature only, not a resurrection of that broader suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Pre-existing hand-rolled script, not a real Vitest suite (no
    // describe/it -- it calls runAllTests() at module load and asserts via
    // console.assert against a real dev DB). Run separately via
    // `npx ts-node src/__tests__/webhook.test.ts` per its own header
    // comment, not part of this scoped feature's test run.
    exclude: ["**/node_modules/**", "src/__tests__/webhook.test.ts"],
  },
});
