import { PrismaClient } from "@prisma/client";

/** Up to ENRICHMENT_CONCURRENCY (default 16; 32+ on bigger instances) leads finish at about the same
 *  time, each writing several rows; Prisma's default pool (~2 x CPU + 1) then
 *  times out waiting for a connection (P2024). Give it an explicit pool unless
 *  DATABASE_URL already sets one. 20 stays far under Neon's connection cap. */
export function withConnectionPool(url: string | undefined): string | undefined {
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=20&pool_timeout=20`;
}

const url = withConnectionPool(process.env.DATABASE_URL);
export const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
