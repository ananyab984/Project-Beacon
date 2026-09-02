import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { ClayService } from "../services/clay.service";
import { config } from "../config";
import { verifyLeadSignature } from "../lib/onboarding/callbackToken";
import { markLeadOnboarded } from "../services/lead.service";
import { ApiError } from "../lib/apiError";

export const webhooksRouter = Router();

// POST /api/webhooks/clay/:token — Clay's outbound "Enrich person" result
// (Public with token & secret verification, same two-factor pattern as
// /api/unipile/webhook/:token — see UnipileService.handleWebhookEvent).
webhooksRouter.post("/clay/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const secretHeader = req.headers["x-g3-webhook-secret"] as string | undefined;
    // TEMP DIAGNOSTIC -- remove once the secret-header mismatch is resolved.
    // Logs length + first/last 4 chars only, never the full secret.
    console.log(
      "[clay] received secret header:",
      secretHeader
        ? `len=${secretHeader.length} value=${secretHeader.slice(0, 4)}...${secretHeader.slice(-4)}`
        : "MISSING (no x-g3-webhook-secret header at all)",
      "| all header keys:", Object.keys(req.headers).join(", ")
    );
    const result = await ClayService.handleWebhookEvent(token, secretHeader, req.body);
    return res.status(200).json({ status: "ok", result });
  } catch (err: any) {
    console.error("[clay] webhook failed:", err?.message || err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: "WEBHOOK_FAILED", message: err.message });
  }
});

// This route is only ever expected to be hit by one caller (G3's apply
// form, once per completed onboarding) -- a generous but real ceiling
// still blocks a flood/abuse scenario without risking a legitimate
// submission getting rate-limited.
const onboardingWebhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED" },
});

// GET /api/webhooks/onboarding-complete/:token — G3's apply form calls this
// exactly as we handed it to them in `callback_url` on successful
// submission (see buildCallbackUrl) -- no custom headers on their side, so
// (unlike the header-based two-factor pattern above) the whole
// verification signal has to live in the URL itself: an opaque path token
// (same idea as Unipile's /webhook/:token) plus a per-lead HMAC `sig` query
// param, so a leaked/observed callback URL for one lead can't be replayed
// against a different lead_id.
webhooksRouter.get(
  "/onboarding-complete/:token",
  onboardingWebhookLimiter,
  async (req: Request, res: Response) => {
    const { token } = req.params;
    const leadId = typeof req.query.lead_id === "string" ? req.query.lead_id : undefined;
    const sig = typeof req.query.sig === "string" ? req.query.sig : undefined;

    if (token !== config.onboardingWebhookPathToken) {
      console.warn("[onboarding webhook] rejected: invalid path token");
      return res.status(401).json({ error: "INVALID_TOKEN" });
    }

    if (!leadId || !sig) {
      console.warn(`[onboarding webhook] rejected: malformed request (lead_id=${leadId ?? "MISSING"}, sig=${sig ? "present" : "MISSING"})`);
      return res.status(400).json({ error: "MALFORMED_REQUEST", message: "lead_id and sig are required" });
    }

    if (!verifyLeadSignature(leadId, sig)) {
      console.warn(`[onboarding webhook] rejected: invalid signature for lead_id=${leadId}`);
      return res.status(401).json({ error: "INVALID_SIGNATURE" });
    }

    try {
      const result = await markLeadOnboarded(leadId);

      // Ack fast -- same idiom as the Unipile webhook route above and
      // lead.routes.ts's enrichment trigger: respond first, do any slower
      // follow-up (e.g. a future recruiter notification) after, via
      // setImmediate, so G3's caller never risks timing out or retrying a
      // request we're still processing.
      res.status(200).json({ status: "ok", alreadyOnboarded: result.alreadyOnboarded });

      if (result.alreadyOnboarded) {
        console.log(`[onboarding webhook] lead ${leadId} already ONBOARDED -- no-op`);
      } else {
        console.log(
          `[onboarding webhook] lead ${leadId} marked ONBOARDED` +
            (result.stageHistorySkipped ? " (StageHistory row skipped -- no recruiter on file to attribute it to)" : "")
        );
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.statusCode === 404) {
        console.warn(`[onboarding webhook] rejected: unknown lead_id=${leadId}`);
        return res.status(404).json({ error: "LEAD_NOT_FOUND" });
      }
      console.error("[onboarding webhook] failed:", err?.message || err);
      return res.status(500).json({ error: "INTERNAL_ERROR" });
    }
  }
);
