import { Router, Request, Response } from "express";
import { UnipileService } from "../services/unipile.service";
import { processInboundMessage } from "../services/processInboundMessage";
import { authenticateJwt } from "../middleware/auth";

export const unipileRouter = Router();

// POST /api/unipile/connect — Mint hosted-auth link to connect LinkedIn/Email
unipileRouter.post("/connect", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { provider } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: "MISSING_PROVIDER", message: "Provider is required (LINKEDIN, GOOGLE, MAIL, OUTLOOK, EMAIL)" });
    }

    const userId = req.user!.id;
    const clientUrl = (req.headers.origin as string) || (req.headers.referer ? new URL(req.headers.referer as string).origin : undefined);
    const rolePath = req.user!.role === "owner" ? "/owner" : "/recruiter";
    const result = await UnipileService.mintHostedAuthLink(userId, provider, "create", clientUrl, rolePath);
    return res.json({ success: true, url: result.url, nonce: result.nonce });
  } catch (err: any) {
    // err.message alone is often just axios's generic "Request failed with
    // status code 404" -- Unipile's actual reason (bad DSN, plan limit,
    // invalid provider combo, etc.) lives in err.response.data and was being
    // discarded entirely, making failures like this unfixable from logs.
    console.error("[unipile] /connect failed:", req.user?.id, err?.response?.status, err?.response?.data || err.message);
    const status = err.statusCode || err?.response?.status || 500;
    const detail = err?.response?.data?.detail || err?.response?.data?.message;
    // Forward the real error code (CONNECTION_PENDING, ALREADY_CONNECTED)
    // instead of always flattening to CONNECT_FAILED -- the dialog needs
    // to tell these apart to offer "Cancel and retry" only where it applies.
    return res.status(status).json({ error: err.code || "CONNECT_FAILED", message: detail || err.message || "Failed to mint hosted link" });
  }
});

// POST /api/unipile/reconnect — Mint reconnect hosted-auth link
unipileRouter.post("/reconnect", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { provider } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: "MISSING_PROVIDER", message: "Provider is required" });
    }

    const userId = req.user!.id;
    const result = await UnipileService.mintHostedAuthLink(userId, provider, "reconnect");
    return res.json({ success: true, url: result.url, nonce: result.nonce });
  } catch (err: any) {
    console.error("[unipile] /reconnect failed:", req.user?.id, err?.response?.status, err?.response?.data || err.message);
    const status = err.statusCode || err?.response?.status || 500;
    const detail = err?.response?.data?.detail || err?.response?.data?.message;
    return res.status(status).json({ error: err.code || "RECONNECT_FAILED", message: detail || err.message || "Failed to mint reconnect link" });
  }
});

// POST /api/unipile/cancel-pending — clear the current user's own outstanding
// connect attempt (see UnipileService.cancelPendingAuthAttempt for the
// race it guards against). Idempotent: succeeds whether or not a pending
// attempt actually exists, so the dialog's retry button never has to
// special-case "already gone."
unipileRouter.post("/cancel-pending", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { provider } = req.body || {};
    if (!provider) {
      return res.status(400).json({ error: "MISSING_PROVIDER", message: "Provider is required" });
    }
    await UnipileService.cancelPendingAuthAttempt(req.user!.id, provider);
    return res.json({ success: true });
  } catch (err: any) {
    console.error("[unipile] /cancel-pending failed:", req.user?.id, err.message);
    return res.status(500).json({ error: "CANCEL_FAILED", message: err.message || "Failed to cancel pending connection attempt" });
  }
});

// GET /api/unipile/accounts — Get current recruiter's connected accounts
unipileRouter.get("/accounts", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const accounts = await UnipileService.getUserConnectedAccounts(userId);
    return res.json({ accounts });
  } catch (err: any) {
    return res.status(500).json({ error: "FETCH_ACCOUNTS_FAILED", message: err.message });
  }
});

// DELETE /api/unipile/accounts/:accountId — Disconnect account
unipileRouter.delete("/accounts/:accountId", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const userId = req.user!.id;
    const result: any = await UnipileService.disconnectAccount(userId, accountId);
    return res.json({
      success: true,
      message: result?.remoteDeleteFailed
        ? "Account disconnected locally; Unipile's own remote delete failed and may need manual cleanup"
        : "Account disconnected",
      remoteDeleteFailed: !!result?.remoteDeleteFailed,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "DISCONNECT_FAILED", message: err.message });
  }
});

// POST /api/unipile/webhook/:token — Webhook receiver (Public with token & secret verification)
unipileRouter.post("/webhook/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const secretHeader = req.headers["x-g3-webhook-secret"] as string | undefined;
    const result = await UnipileService.handleWebhookEvent(token, secretHeader, req.body);
    res.status(200).json({ status: "ok", result });

    // Fire-and-forget: enqueue async processing AFTER the 200 is sent.
    // This keeps the webhook response fast and avoids Unipile retry storms.
    if (result.inboundMessageId) {
      setImmediate(() => {
        processInboundMessage(result.inboundMessageId!).catch((err) =>
          console.error("[webhook] async processInboundMessage failed:", err)
        );
      });
    }
  } catch (err: any) {
    const status = err.statusCode || 400;
    return res.status(status).json({ error: "WEBHOOK_FAILED", message: err.message });
  }
});
