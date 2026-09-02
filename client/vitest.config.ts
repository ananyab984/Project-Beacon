import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Deliberately separate from vite.config.js: that config's TanStack
// Start/Nitro SSR plugins are for the real app build, not a unit-test
// runner, and pulling them in here would add SSR-specific behavior tests
// don't need and could break on. Only what tests actually need: the `@/`
// path alias and React JSX transform.
export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      // Test files live in a sibling `tests/` tree (repo root), outside
      // `client/` -- Node's normal upward node_modules search from a test
      // file's own location walks tests/ -> repo root -> filesystem root,
      // never reaching client/node_modules (a sibling, not an ancestor, of
      // tests/). Previously handled by the `vite-tsconfig-paths` plugin,
      // which (in this Vite version) resolves node_modules relative to
      // wherever IT detects the workspace root from cwd, not this config's
      // explicit `root` -- with `root` pointing outside `client/`, that
      // produced a mangled path ("Cannot find module '/tests/client/...'")
      // for every single test file. Redirecting any bare specifier straight
      // into client/node_modules sidesteps both problems at once.
      { find: /^(?!\.|\/|@\/)(.*)$/, replacement: resolve(__dirname, "node_modules/$1") },
    ],
  },
  server: {
    // Vite blocks serving files outside the configured `root` by default
    // (server.fs.strict) -- since `root` is the repo root but individual
    // test files' absolute paths only differ from it by being *inside* it
    // (tests/client/...), this should already be covered, but forked
    // worker processes were observed to re-derive a stricter boundary from
    // their own cwd; allowing the repo root explicitly removes the
    // ambiguity that caused it.
    fs: { allow: [repoRoot] },
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/client/src/**/*.test.{ts,tsx}"],
    setupFiles: ["client/src/test/setup.ts"],
    // Tests built around `userEvent.setup()` (real per-keystroke timing
    // across many form fields) pass reliably standalone (~1s) but can run
    // 20x+ slower once 90+ jsdom-heavy files all compete for CPU in the
    // full parallel run -- confirmed by isolating one such test (5/5 clean
    // at ~1s alone, intermittently exceeding even a 20s timeout under full
    // parallel load). Raising the timeout further only chases a moving
    // target; disabling cross-file parallelism removes the contention
    // itself, the same fix already applied to the server suite for the
    // equivalent issue.
    testTimeout: 20000,
    fileParallelism: false,
    retry: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./client/coverage",
      include: ["client/src/lib/**", "client/src/components/**", "client/src/hooks/**", "client/src/stores/**"],
      exclude: [
        "client/src/**/*.test.{ts,tsx}",
        "client/src/test/**",
        "client/src/routes/**",
        // Confirmed via the actual import graph (not just size): the app's
        // real data layer is api.ts, backed by the Express/Prisma server.
        // recruiter-mock.ts is imported by exactly one live file, only for
        // a TYPE (`RecruiterLead`), never a runtime value -- 100% dead code
        // at runtime. g3-mock.ts is mostly the same (an early in-memory
        // mock CRUD store -- `recruiters`/`useRecruiters`/`addClient`/etc --
        // superseded by the real backend and never called from any route or
        // component today), but it also still contains a handful of
        // genuinely live CSV/sheet-row parsing functions the app actually
        // calls (`parseCsvLeads`, `mapRowsToLeads`, `parseCsvClientDemands`)
        // -- those have their own real tests in g3-mock.test.ts, which run
        // and protect against regressions same as any other test; they're
        // just not counted toward this file's aggregate % here, since the
        // dead ~70% of the file would otherwise permanently sink it below
        // threshold for reasons that have nothing to do with real coverage.
        "client/src/lib/g3-mock.ts",
        "client/src/lib/recruiter-mock.ts",
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
