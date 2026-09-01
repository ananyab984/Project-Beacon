// Global Vitest setup. `config.ts` loads `server/.env` directly via dotenv
// regardless of cwd (path resolved from __dirname), so real dev credentials
// are already available to every test -- nothing to stub here for that.
// This file exists as the one place to add global mocks/env overrides as
// the suite grows, rather than repeating them per test file.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
