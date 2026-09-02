import { afterEach, vi } from "vitest";

// Global Vitest setup. `config.ts` loads `server/.env` directly via dotenv
// regardless of cwd (path resolved from __dirname), so real dev credentials
// are already available to every test -- nothing to stub here for that.
// This file exists as the one place to add global mocks/env overrides as
// the suite grows, rather than repeating them per test file.
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// Several test files pair `vi.useFakeTimers()`/`vi.useRealTimers()` inline
// around a retry-backoff assertion rather than in a try/finally -- if the
// assertion between them ever throws, real timers never get restored and
// fake time can bleed into whatever test runs next. This is the safety net:
// unconditionally restore real timers after every single test, regardless
// of whether the test itself remembered to.
afterEach(() => {
  vi.useRealTimers();
});
