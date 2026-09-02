import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../prisma";
import { decodeShortLinkToken } from "../lib/onboarding/shortLink";
import { buildApplyUrl } from "../lib/onboarding/buildApplyUrl";

export const onboardingShortLinkRouter = Router();

// A candidate could plausibly click a shared/forwarded link a handful of
// times while filling out the form across sessions -- generous, but a
// real ceiling against a scraping/enumeration attempt.
const shortLinkLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /g/:token -- the shortened apply link embedded in outreach messages
// in place of the old static, unpersonalized apply_url. Public,
// unauthenticated, read-only (never changes any state) -- decodes the
// token back to a lead id, re-fetches the lead fresh, and 302-redirects to
// the real, freshly-built https://app.global3.io/apply link for them.
//
// A human lands here directly in a browser, so failures get a short plain-
// text page, not a raw JSON error body.
onboardingShortLinkRouter.get("/:token", shortLinkLimiter, async (req: Request, res: Response) => {
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
