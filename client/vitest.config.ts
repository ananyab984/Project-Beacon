import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Deliberately separate from vite.config.js: that config's TanStack
// Start/Nitro SSR plugins are for the real app build, not a unit-test
// runner, and pulling them in here would add SSR-specific behavior tests
// don't need and could break on. Only what tests actually need: the `@/`
// path alias and React JSX transform.
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/lib/**", "src/components/**", "src/hooks/**", "src/stores/**"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/routes/**"],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
