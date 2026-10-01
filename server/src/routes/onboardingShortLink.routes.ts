import { Router, Request, Response } from "express";
import { prisma } from "../prisma";
import { decodeShortLinkToken } from "../lib/onboarding/shortLink";
import { buildApplyUrl } from "../lib/onboarding/buildApplyUrl";

export const onboardingShortLinkRouter = Router();

/**
 * ponytail: in-process fixed-window counter, not a shared store. It resets
 * on restart and each instance counts separately, so behind N instances the
 * real ceiling is N x LIMIT. That's fine for what this guards -- a public
 * read-only redirect whose token is a 122-bit UUIDv4, so there is nothing
 * here to brute-force, only a DB read to hammer. Upgrade path if this ever
 * needs to be exact: move the counter to Redis, or put the limit at the
 * edge/CDN. Deliberately not express-rate-limit: this server carries no
 * HTTP rate-limiting dependency today, and one redirect route doesn't earn
 * adding one.
 */
const WINDOW_MS = 60_000;
const LIMIT = 60;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string, now: number): boolean {
  const entry = hits.get(ip);
  if (!entry || now >= entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    // Sweep expired entries opportunistically so the Map can't grow without
    // bound across many distinct IPs -- there's no background timer here.
    if (hits.size > 10_000) {
      for (const [key, value] of hits) if (now >= value.resetAt) hits.delete(key);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

// GET /g/:token -- the shortened apply link embedded in outreach messages in
// place of the old static, unpersonalized apply URL. Public,
// unauthenticated, read-only (never changes any state): decodes the token
// back to a lead id, re-fetches the lead fresh, and 302-redirects to that
// lead's pre-filled apply URL.
//
// Re-fetching (rather than encoding the data into the link) is the point:
// the candidate always lands on a form reflecting the lead's CURRENT data,
// never a stale snapshot from whenever the message was drafted, and the
// candidate's own name/email never travel in the link itself.
//
// A human lands here directly in a browser, so failures get a short plain-
// text page, not a raw JSON error body.
onboardingShortLinkRouter.get("/:token", async (req: Request, res: Response) => {
  if (rateLimited(req.ip || "unknown", Date.now())) {
    return res.status(429).type("text/plain").send("Too many requests. Please try again in a minute.");
  }

  const leadId = decodeShortLinkToken(req.params.token);
  if (!leadId) {
    console.warn(`[onboarding short-link] rejected: malformed token "${req.params.token}"`);
    return res.status(404).type("text/plain").send("This link is invalid or has expired.");
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    console.warn(`[onboarding short-link] rejected: no lead for decoded token (lead_id=${leadId})`);
    return res.status(404).type("text/plain").send("This link is invalid or has expired.");
  }

  console.log(`[onboarding short-link] resolved token for lead ${lead.id}, redirecting to apply form`);
  return res.redirect(302, buildApplyUrl(lead));
});

// Exported for the route's own test, which exercises the limiter directly
// rather than spinning up an HTTP server.
export const __testing = { rateLimited, resetHits: () => hits.clear(), LIMIT, WINDOW_MS };
