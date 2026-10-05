import os from "node:os";
import { prisma } from "../prisma";

/**
 * Cross-instance cron lock (audit AUDIT-33). Every background job runs
 * in-process via node-cron, so two g3-server instances used to run every job
 * twice -- two digests per contractor, two nudges per recruiter, two scoring
 * passes. Now each scheduled run ("tick") is claimed once, in the database,
 * and only the instance that claimed it runs the job.
 *
 * The lock is on the TICK, not on the job:
 *  - A lock released when the job finishes would let a second instance whose
 *    clock is a moment behind grab it straight after a fast job (a digest
 *    takes seconds) and send it again -- the exact duplicate this prevents.
 *  - A lock held for the job's full length would, after a crash or redeploy
 *    mid-run, block that job until it expired (enrichment polls can run
 *    ~68 minutes).
 * A tick id has neither problem: the next tick is a new id, so nothing can
 * get stuck, and a tick already claimed can never be claimed again.
 *
 * Stored as rows in the existing system_config table (key/value text), so
 * there is no migration. Keys include NODE_ENV, so a dev server pointed at
 * the same database never takes production's ticks (or vice versa).
 *
 * ponytail: overlap of one long run with the NEXT tick on another instance is
 * not prevented here -- per instance the in-memory guards already stop it,
 * and for enrichment the atomic per-lead claim stops double-processing, so
 * the remaining cost is extra concurrency during a backlog when scaled out.
 * Upgrade path if that ever matters: a renewed lease held for the run.
 */

const ENV = (process.env.NODE_ENV || "development").trim();
const HOLDER = `${os.hostname()}:${process.pid}`;

/** The scheduled minute a tick belongs to. Every instance's cron fires on the
 *  same wall-clock minute; rounding (not flooring) absorbs normal clock skew
 *  between machines and the few ms node-cron fires late. */
export function tickId(now = Date.now()): string {
  return new Date(Math.round(now / 60_000) * 60_000).toISOString();
}

/** True for exactly one caller per (job, tick) across every instance. One
 *  atomic statement: the row is only overwritten by a strictly later tick.
 *  COLLATE "C" makes the text comparison plain byte order, which is
 *  chronological order for same-format ISO timestamps. */
export async function claimTick(name: string, tick = tickId()): Promise<boolean> {
  const key = `cron_tick:${ENV}:${name}`;
  const rows = await prisma.$queryRaw<unknown[]>`
    INSERT INTO system_config ("key", "value", "notes") VALUES (${key}, ${tick}, ${HOLDER})
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "notes" = EXCLUDED."notes"
    WHERE system_config."value" COLLATE "C" < EXCLUDED."value" COLLATE "C"
    RETURNING "key"`;
  return rows.length === 1;
}

/** Runs `job` only if this instance claimed the current tick. A failed claim
 *  (database unreachable) rejects, so the caller's existing .catch logs it --
 *  the job could not have run without the database anyway. */
export async function runOncePerTick(name: string, job: () => Promise<unknown>): Promise<void> {
  if (!(await claimTick(name))) {
    console.log(`[jobs] ${name}: another instance already took this run, skipping`);
    return;
  }
  await job();
}
