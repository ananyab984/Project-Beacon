import type { Request, Response } from "express";
import { prisma } from "../prisma";

// Must clear a COLD first query -- Prisma opening its connection plus Neon
// waking from auto-suspend -- measured at 2.6-3.1s from a distant client
// (warm: ~0.3s). Still inside the 5s timeout Docker's HEALTHCHECK and
// docker-compose give /health, and those need 3 failures in a row (30s
// apart) before calling the container unhealthy, so one slow wake-up never
// takes the service out on its own.
const DB_TIMEOUT_MS = 4000;

/** True if the database answers within timeoutMs. `probe` is injectable for tests. */
export async function isDatabaseReachable(
  timeoutMs = DB_TIMEOUT_MS,
  probe: () => Promise<unknown> = () => prisma.$queryRaw`SELECT 1`
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return true;
  } catch (err: any) {
    console.warn(`[health] database check failed: ${err?.message || err}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /health (audit AUDIT-31). Render's healthCheckPath, Docker's
 * HEALTHCHECK and the keepalive ping all read this. It used to answer
 * "healthy" unconditionally, so a deploy that couldn't reach its database
 * was marked live and kept getting traffic. Now a 503 when the database
 * doesn't answer -- every caller above treats any non-2xx as unhealthy.
 * The body never includes the underlying error (it's public).
 */
export async function healthHandler(_req: Request, res: Response) {
  if (await isDatabaseReachable()) return res.json({ status: "healthy", db: "up" });
  return res.status(503).json({ status: "unhealthy", db: "down" });
}
